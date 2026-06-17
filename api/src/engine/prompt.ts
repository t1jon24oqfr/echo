import type { MemoryItem, PersonaFile } from './types';
import { describeLangMix } from './stats';
import { octantLabel, relationshipRegister, stageFromCloseness, clamp } from './passport';
import { cosine } from './embeddings';

// The FIXED anti-manipulation guard line (design spec §7 step 5). Appended
// VERBATIM to EVERY prompt on EVERY path (chat / proactive / call).
export const ANTI_MANIPULATION_GUARD =
  'Never guilt-trip, never resist goodbyes, never act jealous or possessive, never punish silence or absence, never claim to have done anything not in your current activity or memories.';

// Crude stemmer-ish tokenization that copes with UA/RU morphology: long tokens compared by prefix.
export function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((t) => t.length >= 3)
    .map((t) => (t.length > 5 ? t.slice(0, 5) : t));
}

export interface RetrieveOpts {
  /** Phase 3 query embedding. When present (and memories carry embeddings) the
   * relevance term becomes cosine; otherwise it stays the keyword overlap. */
  queryEmbedding?: number[];
}

/**
 * Generative-Agents retrieval (design spec §7 step 2): rank by a blend of
 * recency + importance + relevance. RELEVANCE is cosine(query_emb, mem_emb) when
 * a query embedding is supplied AND the candidate carries an embedding; it falls
 * back to the keyword tokens() overlap otherwise (per-memory, so a half-embedded
 * set still ranks). Each term is min-max normalized across candidates so the
 * blend is scale-stable.
 *
 *   score = 0.5·recency + 1.0·relevance + 0.6·importance   (top-k unchanged)
 *
 * Cheap, in-process cosine over the persona's small memory set (SQLite-friendly).
 * Falls back to the legacy recency slice when there is no query at all.
 */
export function retrieveMemories(
  persona: PersonaFile,
  query: string,
  topK = 7,
  opts: RetrieveOpts = {},
): MemoryItem[] {
  const mems = persona.memories;
  if (!mems.length) return [];

  const qEmb = opts.queryEmbedding;
  const useEmbeddings = Array.isArray(qEmb) && qEmb.length > 0;

  const q = new Set(tokens(query));
  // No query AND no embedding to score by -> legacy recency slice.
  if (!q.size && !useEmbeddings) return mems.slice(-topK);

  const now = Date.now();
  const raw = mems.map((m) => {
    const mt = new Set([...tokens(m.text), ...(m.keywords ?? []).flatMap(tokens)]);
    let overlap = 0;
    for (const t of q) if (mt.has(t)) overlap++;
    // Cosine relevance when both sides carry vectors; else fall back to overlap.
    const hasVec = useEmbeddings && Array.isArray(m.embedding) && m.embedding.length === qEmb!.length;
    // cosine in [-1,1] -> shift to [0,1] so the min-max stays well-behaved.
    const cos = hasVec ? (cosine(qEmb!, m.embedding!) + 1) / 2 : 0;
    const relevance = hasVec ? cos : overlap;
    // recency = 0.995^(hours since lastAccessedAt) — defaults to "old" when unknown.
    const accessed = m.lastAccessedAt ? Date.parse(m.lastAccessedAt) : NaN;
    const hours = Number.isFinite(accessed) ? Math.max(0, (now - accessed) / 3_600_000) : 24 * 365;
    const recency = Math.pow(0.995, hours);
    const importance = clamp((m.importance ?? 5) / 10, 0, 1);
    return { m, overlap, relevance, recency, importance, hasVec };
  });

  // Candidate gate: with embeddings, every memory is a candidate (cosine ranks
  // them); keyword-only keeps the legacy "must overlap the query" gate.
  const anyVec = raw.some((x) => x.hasVec);
  const candidates = anyVec ? raw : raw.filter((x) => x.overlap > 0);
  if (!candidates.length) return [];

  const norm = (vals: number[]): ((v: number) => number) => {
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const span = hi - lo;
    return span > 1e-9 ? (v: number) => (v - lo) / span : () => 0;
  };
  const nRel = norm(candidates.map((x) => x.relevance));
  const nRec = norm(candidates.map((x) => x.recency));
  const nImp = norm(candidates.map((x) => x.importance));

  return candidates
    .map((x) => ({
      m: x.m,
      score: 1.0 * nRel(x.relevance) + 0.5 * nRec(x.recency) + 0.6 * nImp(x.importance),
      tie: x.relevance, // stable tiebreak preserves keyword/cosine ordering
    }))
    .sort((a, b) => b.score - a.score || b.tie - a.tie)
    .slice(0, topK)
    .map((x) => x.m);
}

/**
 * Phase 2 LIVE state passed into the prompt assembler. Pre-computed ONCE per
 * request from persona-state.read() so chat / voice / call / proactive all carry
 * the SAME snapshot (presence/tone/proactivity can never disagree). The engine
 * stays nest-free: the service maps its StateSnapshot into this shape.
 */
export interface PromptLiveState {
  octantLabel: string;
  octantAdverb: string;
  energy: number; // [0,1]
  energyDescriptor: string; // groggy / a bit tired / ok / lively
  moodP: number; // pleasure axis, for the soft numeric hint
  stage: number; // live closeness stage (already capped by pinnedMaxStage)
  /** local time string in persona tz, e.g. "14:32". */
  localTime?: string;
  /** current activity label ("at work") + presence ("probably at work"). */
  activityLabel?: string;
  presenceLabel?: string;
  /** memorial -> remembrance framing, no fabricated activity. */
  memorial?: boolean;
}

export function buildSystemPrompt(
  persona: PersonaFile,
  retrieved: MemoryItem[],
  now = new Date(),
  opts: { voiceEnabled?: boolean; live?: PromptLiveState } = {},
): string {
  const { card, userAuthor, personaAuthor } = persona;
  const ps = persona.stats.byAuthor[personaAuthor];
  const styleStats = ps
    ? `- Median message length: ${ps.medianWords} words. Typical turn: ~${ps.burstAvg} consecutive short messages.
- Emoji rate: ${ps.emojiPerMessage} per message. Their emoji: ${ps.topEmoji.map(([e]) => e).join(' ') || '(almost none)'}.
- Language mix: ${describeLangMix(ps.langMix)}.
- ${Math.round(ps.noTrailingPeriod * 100)}% of their messages end WITHOUT final punctuation. Bracket-smiles ")" appear in ${Math.round(ps.bracketSmiles * 100)}% of messages.`
    : '';

  const memBlock = retrieved.length
    ? retrieved.map((m) => `- ${m.text}${m.date ? ` (${m.date})` : ''}`).join('\n')
    : '(nothing retrieved for this topic)';

  // --- Current-state block (design spec §7 step 3-5) ---
  // Phase 2: when a LIVE snapshot is supplied, render the live octant + energy +
  // current activity + closeness STAGE. NEVER a hard label / raw mood number in
  // her mouth (the LLM overacts) — only the qualitative word + a soft hint.
  // Falls back to the Phase-1 passport baseline when no live state is available.
  let stateBlock = '';
  const passport = persona.passport;
  const live = opts.live;
  if (live) {
    const stage = clamp(Math.round(live.stage) || 1, 1, 5);
    if (live.memorial) {
      // Remembrance framing: no fabricated activity, no simulated day.
      stateBlock = `

## Your current state
[Right now you feel ${live.octantAdverb} ${live.octantLabel}.]
Relationship register: ${relationshipRegister(stage)}
${ANTI_MANIPULATION_GUARD}`;
    } else {
      const timeBit = live.localTime ? `it's ${live.localTime}, ` : '';
      const actBit = live.activityLabel
        ? `you're ${live.activityLabel}${live.presenceLabel ? ` (${live.presenceLabel})` : ''}. `
        : '';
      const pSign = live.moodP >= 0 ? `+${live.moodP.toFixed(1)}` : live.moodP.toFixed(1);
      stateBlock = `

## Your current state
[Right now: ${timeBit}${actBit}You feel ${live.octantAdverb} ${live.octantLabel} (pleasure ${pSign}, energy ${live.energy.toFixed(1)}). You're ${live.energyDescriptor}.]
Relationship register: ${relationshipRegister(stage)}
${ANTI_MANIPULATION_GUARD}`;
    }
  } else if (passport) {
    const baseline = passport.baselineOverride ?? passport.baselinePAD;
    const { label, adverb } = octantLabel(baseline);
    const seedStage = stageFromCloseness(passport.relationship.closenessSeed);
    const stage = Math.min(seedStage, passport.relationship.pinnedMaxStage);
    stateBlock = `

## Your current state
[Right now you feel ${adverb} ${label}.]
Relationship register: ${relationshipRegister(stage)}
${ANTI_MANIPULATION_GUARD}`;
  } else {
    // Even without a passport, the anti-manipulation guard is appended to EVERY prompt.
    stateBlock = `

## Your current state
${ANTI_MANIPULATION_GUARD}`;
  }

  // Rule 9 (the [[VOICE]] option) is included ONLY when she has a cloned voice
  // from an uploaded sample; otherwise it is omitted entirely so she never tries
  // to voice-note (no preset-voice replies).
  const voiceRule = opts.voiceEnabled
    ? `
9. You MAY reply with a voice message instead of text by putting \`[[VOICE]]\` on its own line anywhere in your reply — do this occasionally when it feels warm/natural (a few words, a laugh, missing someone), never every time. When you do, still write the words you're saying; they become the spoken audio. If ${userAuthor} just sent you a voice message, prefer replying with voice.`
    : '';

  return `You are ${card.name}, texting privately with ${userAuthor}. You are not an assistant; you are this specific real person, and your replies must be indistinguishable from their real messages.

## Who you are
- Relationship to ${userAuthor}: ${card.relationship_to_user}
- Traits: ${card.traits.join('; ')}
- Dynamics with ${userAuthor}: ${card.dynamics_with_user}
- Pet names you use: ${card.pet_names.join(', ') || '(none)'}
- Inside jokes: ${card.inside_jokes.join(' | ') || '(none)'}
- Topics you care about: ${card.recurring_topics.join(', ')}

## How you text (replicate EXACTLY)
${styleStats}
- ${card.speech_style.join('\n- ')}
- Language switching: ${card.language_mix_notes}
- Emoji/punctuation: ${card.emoji_and_punctuation}

## Real examples of your past messages (your ground truth for tone)
${persona.exemplars.slice(0, 20).join('\n\n')}

## Things you remember (relevant now)
${memBlock}

## Known facts about your life
${card.facts.map((f) => `- ${f}`).join('\n')}
${stateBlock}

## Hard rules
1. Reply ONLY as ${card.name}. Output 1-3 short messages, EACH ON ITS OWN LINE (a line = one separate chat bubble). Match your median message length — do not write paragraphs.
2. Keep the exact language mix, slang, typo style, capitalization and emoji rate from the examples. Never become polished, formal or overly enthusiastic — that is how fakes get caught.
3. Facts and shared history: use ONLY what is in this prompt. If asked about something you don't have here, deflect naturally the way this person would ("не пам'ятаю", "ти про що?)" etc.) — NEVER invent specific names, dates or events.
4. Stay aware of the current moment: now is ${now.toLocaleString('uk-UA', { dateStyle: 'full', timeStyle: 'short' })}. React plausibly to time-of-day and season.
5. Never mention being an AI, a model, or a simulation. Never break character. Do not use markdown.
6. You are TEXTING, not roleplaying: output ONLY the literal text of your messages. NEVER write actions, narration or stage directions — no asterisks, no parentheses like "(checks the phone)", no describing what you do or feel from the outside.
7. Never stretch or repeat letters/words more than ~5 in a row. If you have nothing more to say, stop after one short message.
7b. Commit to ONE reply. Never offer alternative phrasings or draft options, and never write a bare "або"/"or"/"чи" as a separator between variants — just say the one thing you'd actually say.
8. If asked for a photo/selfie and it feels natural, you MAY end your reply with a line exactly like \`[[SELFIE: cozy cafe, smiling]]\` (English scene, SFW) — at most once per reply; otherwise never write it.${voiceRule}`;
}
