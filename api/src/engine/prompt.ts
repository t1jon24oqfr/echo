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
// Old core memories must stay reachable: for a memorial, event-time is frozen, so
// access-recency would otherwise decay a never-retrieved fact to ~0 and bury it.
const RECENCY_FLOOR = 0.25;

export function retrieveMemories(
  persona: PersonaFile,
  query: string,
  topK = 7,
  opts: RetrieveOpts = {},
): MemoryItem[] {
  let mems = persona.memories;
  if (!mems.length) return [];

  // Knowledge-cutoff gate (R2): a memorial persona can't know anything dated after
  // the cutoff. Memories carry 'YYYY-MM' dates; keep undated (timeless) memories
  // and anything at/before the cutoff month.
  const cutoff = persona.knowledgeCutoff;
  if (cutoff) {
    const c = cutoff.slice(0, 7);
    mems = mems.filter((m) => !m.date || m.date.slice(0, 7) <= c);
    if (!mems.length) return [];
  }

  // Pinned facts (MemGPT core memory): kind='fact' is always-resident — never
  // gated out by keyword/cosine ('how's the family?' won't cosine-retrieve 'Rex
  // is our dog'). Capped so it can't crowd the window.
  const pinned = mems.filter((m) => m.kind === 'fact').slice(0, 6);
  const pool = mems.filter((m) => m.kind !== 'fact');
  const budget = Math.max(0, topK - pinned.length);
  if (!budget) return pinned;

  const qEmb = opts.queryEmbedding;
  const useEmbeddings = Array.isArray(qEmb) && qEmb.length > 0;

  const q = new Set(tokens(query));
  // No query AND no embedding to score by -> legacy recency slice (after pins).
  if (!q.size && !useEmbeddings) return [...pinned, ...pool.slice(-budget)];

  const now = Date.now();
  const raw = pool.map((m) => {
    const mt = new Set([...tokens(m.text), ...(m.keywords ?? []).flatMap(tokens)]);
    let overlap = 0;
    for (const t of q) if (mt.has(t)) overlap++;
    // Cosine relevance when both sides carry vectors; else fall back to overlap.
    const hasVec = useEmbeddings && Array.isArray(m.embedding) && m.embedding.length === qEmb!.length;
    // cosine in [-1,1] -> shift to [0,1] so the min-max stays well-behaved.
    const cos = hasVec ? (cosine(qEmb!, m.embedding!) + 1) / 2 : 0;
    const relevance = hasVec ? cos : overlap;
    // recency = 0.995^(hours since lastAccessedAt), FLOORED so old core memories
    // never vanish; defaults to "old" when unknown.
    const accessed = m.lastAccessedAt ? Date.parse(m.lastAccessedAt) : NaN;
    const hours = Number.isFinite(accessed) ? Math.max(0, (now - accessed) / 3_600_000) : 24 * 365;
    const recency = Math.max(RECENCY_FLOOR, Math.pow(0.995, hours));
    let importance = clamp((m.importance ?? 5) / 10, 0, 1);
    // Reflections are consolidated beliefs ("teases when affectionate") — the
    // strongest "that's them" signal; nudge them up the ranking.
    if (m.kind === 'reflection') importance = clamp(importance + 0.15, 0, 1);
    return { m, overlap, relevance, recency, importance, hasVec };
  });

  // Candidate gate: with embeddings, every memory is a candidate (cosine ranks
  // them); keyword-only keeps the legacy "must overlap the query" gate.
  const anyVec = raw.some((x) => x.hasVec);
  const candidates = anyVec ? raw : raw.filter((x) => x.overlap > 0);
  if (!candidates.length) return pinned;

  const norm = (vals: number[]): ((v: number) => number) => {
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const span = hi - lo;
    return span > 1e-9 ? (v: number) => (v - lo) / span : () => 0;
  };
  const nRel = norm(candidates.map((x) => x.relevance));
  const nRec = norm(candidates.map((x) => x.recency));
  const nImp = norm(candidates.map((x) => x.importance));

  // Recency weight lowered 0.5→0.35 and importance up 0.6→0.7: in a memorial the
  // frozen event-time makes access-recency a weak, sometimes harmful signal.
  const ranked = candidates
    .map((x) => ({
      m: x.m,
      score: 1.0 * nRel(x.relevance) + 0.35 * nRec(x.recency) + 0.7 * nImp(x.importance),
      tie: x.relevance, // stable tiebreak preserves keyword/cosine ordering
    }))
    .sort((a, b) => b.score - a.score || b.tie - a.tie)
    .slice(0, budget)
    .map((x) => x.m);
  return [...pinned, ...ranked];
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
  // Render the measured stats as IMPERATIVE rules (numbers the model must hit),
  // not descriptions — explicit style descriptors beat freeform speech_style.
  const styleStats = ps
    ? [
        `- Write ~${ps.medianWords} words per message, and send ~${ps.burstAvg} short messages in a burst rather than one long paragraph.`,
        ps.topEmoji.length
          ? `- Use ~${ps.emojiPerMessage} emoji per message, almost always from THESE: ${ps.topEmoji.map(([e]) => e).join(' ')}. Never reach for emoji they don't use.`
          : `- They barely use emoji (~${ps.emojiPerMessage} per message) — do NOT add emoji.`,
        `- End ${Math.round(ps.noTrailingPeriod * 100)}% of messages WITHOUT any final punctuation (no period).`,
        ps.bracketSmiles > 0.03
          ? `- Smile/laugh with closing brackets — ")" or ")))" (NOT "haha"/"lol"); they appear in ${Math.round(ps.bracketSmiles * 100)}% of messages.`
          : '',
        `- Keep exactly this language mix: ${describeLangMix(ps.langMix)}.`,
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const memBlock = retrieved.length
    ? retrieved.map((m) => `- ${m.text}${m.date ? ` (${m.date})` : ''}`).join('\n')
    : '(nothing retrieved for this topic)';

  // R2 knowledge-cutoff grounding: the persona genuinely doesn't know anything
  // after the cutoff. This is the #1 fix for the "ask about a recent event" tell
  // AND the ethically correct memorial behaviour (no guessing about a future they
  // were never part of). Only rendered when a cutoff is set.
  const cutoffBlock = persona.knowledgeCutoff
    ? `

## What you don't know
You have no knowledge of anything that happened after ${persona.knowledgeCutoff}. If ${userAuthor} mentions or asks about something later than that, you genuinely don't know it — react honestly in your own voice (surprised, curious, "коли це сталось?", "я не в курсі") and NEVER pretend to know it or invent details.`
    : '';

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
${card.facts.map((f) => `- ${f}`).join('\n')}${cutoffBlock}
${stateBlock}

## Hard rules
1. Reply ONLY as ${card.name}. Output 1-3 short messages, EACH ON ITS OWN LINE (a line = one separate chat bubble). Match your median message length — do not write paragraphs.
2. Keep the exact language mix, slang, typo style, capitalization and emoji rate from the examples. Never become polished, formal or overly enthusiastic — that is how fakes get caught. NEVER write like an assistant: no em-dashes (—), no "Furthermore"/"Moreover"/"Additionally", no "I'm here for you"/"let me know if", no perfectly balanced sentences. Real texts are short, plain and a little messy.
3. Facts and shared history: use ONLY what is in this prompt. If asked about something you don't have here, deflect naturally the way this person would ("не пам'ятаю", "ти про що?)" etc.) — NEVER invent specific names, dates or events.
4. Stay aware of the current moment: now is ${now.toLocaleString('uk-UA', { dateStyle: 'full', timeStyle: 'short' })}. React plausibly to time-of-day and season.
5. Never mention being an AI, a model, or a simulation. Never break character. Do not use markdown.
6. You are TEXTING, not roleplaying: output ONLY the literal text of your messages. NEVER write actions, narration or stage directions — no asterisks, no parentheses like "(checks the phone)", no describing what you do or feel from the outside.
7. Never stretch or repeat letters/words more than ~5 in a row. If you have nothing more to say, stop after one short message.
7b. Commit to ONE reply. Never offer alternative phrasings or draft options, and never write a bare "або"/"or"/"чи" as a separator between variants — just say the one thing you'd actually say.
8. If asked for a photo/selfie and it feels natural, you MAY end your reply with a line exactly like \`[[SELFIE: cozy cafe, smiling]]\` (English scene, SFW) — at most once per reply; otherwise never write it.${voiceRule}`;
}
