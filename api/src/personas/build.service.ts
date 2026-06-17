import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { StorageService } from './storage.service';
import { PersonasService } from './personas.service';
import { AvatarService } from './avatar.service';
import type { Corpus, CorpusStats, MemoryItem, PersonaCard } from '../engine/types';
import { buildPersonaCard, extractMemories } from '../engine/extract';
import { pickExemplars } from '../engine/exemplars';
import { complete, completeJson, EXTRACT_MODEL, hasApiKey } from '../engine/llm';
import { describeLangMix } from '../engine/stats';
import { tokens } from '../engine/prompt';
import { memoryImportance } from './memory.service';
import {
  normalizePassport,
  type CharacterPassport,
  type Ocean,
  type Chronotype,
  type RoutineBlock,
  type Provenance,
} from '../engine/passport';
import { renderConv } from '../engine/segment';

@Injectable()
export class BuildService {
  private readonly logger = new Logger(BuildService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly personas: PersonasService,
    private readonly avatars: AvatarService,
  ) {}

  async start(userId: string, personaId: string): Promise<{ status: 'building' }> {
    const persona = await this.personas.getOwned(userId, personaId);
    if (persona.status === 'building') {
      throw new ConflictException('Build already in progress');
    }
    const corpus = await this.storage.readCorpus(personaId);
    if (!corpus) {
      if (persona.status === 'ready' || persona.status === 'failed') {
        throw new ConflictException('Corpus no longer available — re-upload the chat export');
      }
      throw new BadRequestException('Upload a chat export first');
    }

    await this.prisma.persona.update({
      where: { id: personaId },
      data: { status: 'building', stage: 'card' },
    });

    void this.run(personaId, persona.relationship, corpus).catch(async (e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(`Build failed for ${personaId}: ${message}`);
      await this.prisma.persona
        .update({
          where: { id: personaId },
          data: { status: 'failed', stage: message.slice(0, 300) },
        })
        .catch(() => undefined);
    });

    return { status: 'building' };
  }

  private async run(personaId: string, relationship: string, corpus: Corpus): Promise<void> {
    const { conversations, personaAuthor, userAuthor, stats } = corpus;
    const setStage = (stage: string) =>
      this.prisma.persona.update({ where: { id: personaId }, data: { stage } });

    const exemplars = pickExemplars(conversations, personaAuthor);
    let card: PersonaCard;
    let memories: MemoryItem[];
    let demo: boolean;

    if (hasApiKey()) {
      if (!process.env.MAX_MEMORY_CALLS) process.env.MAX_MEMORY_CALLS = '12';
      card = await buildPersonaCard(conversations, personaAuthor, userAuthor, stats);
      await setStage('exemplars');
      await setStage('memories');
      memories = await extractMemories(conversations, personaAuthor, userAuthor);
      demo = false;
    } else {
      // Demo/stub: no API key — build from computed stats + exemplars so the flow stays clickable.
      await delay(300);
      card = stubCard(personaAuthor, userAuthor, stats, relationship);
      await setStage('exemplars');
      await delay(300);
      await setStage('memories');
      const lastDate = conversations.length
        ? new Date(conversations[conversations.length - 1].end)
        : new Date();
      memories = stubMemories(exemplars, personaAuthor, lastDate);
      await delay(300);
      demo = true;
    }

    // Infer voice gender (drives the preset TTS fallback). Cheap one-token
    // classification when a key is present; defaults to 'female' if unknown.
    const voiceGender = await this.inferVoiceGender(card, demo);

    await this.prisma.$transaction([
      this.prisma.memory.deleteMany({ where: { personaId } }),
      this.prisma.memory.createMany({
        data: memories.map((m) => ({
          personaId,
          text: m.text,
          keywords: JSON.stringify(m.keywords ?? []),
          date: m.date || null,
          importance: memoryImportance(m.text, m.date),
        })),
      }),
      this.prisma.persona.update({
        where: { id: personaId },
        data: {
          stage: 'avatars',
          demo,
          card: JSON.stringify(card),
          exemplars: JSON.stringify(exemplars),
          stats: JSON.stringify(stats),
          personaAuthor,
          userAuthor,
          voiceGender,
        },
      }),
    ]);

    // Character Passport auto-fill (Phase 1): ONE extra DeepSeek analysis over
    // the same sample for ocean/chronotype/routine, mirrored style from card +
    // stats. Best-effort — NEVER fails the build (heuristic neutral fallback).
    await this.buildPassport(personaId, card, stats, conversations, personaAuthor).catch((e) => {
      this.logger.warn(`passport auto-fill failed (continuing): ${e instanceof Error ? e.message : String(e)}`);
    });

    // Avatar pack is best-effort: never blocks 'ready'.
    await this.avatars.generatePack(personaId);

    await this.prisma.persona.update({
      where: { id: personaId },
      data: { status: 'ready', stage: null },
    });

    // Privacy policy: raw corpus is deleted after a successful build.
    await this.storage.deleteCorpus(personaId);
  }

  /**
   * Best-effort gender of the persona's voice ('female' | 'male'), used to pick
   * the preset TTS voice. One tiny classification via the extract LLM from the
   * card's name/relationship/traits; falls back to 'female' on any uncertainty
   * or in demo/no-key mode. Never throws.
   */
  private async inferVoiceGender(card: PersonaCard, demo: boolean): Promise<string> {
    if (demo || !hasApiKey()) return 'female';
    try {
      const ctx = [
        `name: ${card.name}`,
        `relationship to user: ${card.relationship_to_user}`,
        `traits: ${(card.traits ?? []).join('; ')}`,
        `pet names: ${(card.pet_names ?? []).join(', ')}`,
      ].join('\n');
      const out = await complete({
        model: EXTRACT_MODEL,
        maxTokens: 4,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'Classify the likely gender of the described person for voice selection. Reply with exactly one word: female, male, or unknown. No punctuation.',
          },
          { role: 'user', content: ctx },
        ],
      });
      const g = out.trim().toLowerCase();
      if (g.startsWith('male')) return 'male';
      if (g.startsWith('female')) return 'female';
      return 'female';
    } catch (e) {
      this.logger.warn(`voice gender inference failed: ${e instanceof Error ? e.message : String(e)}`);
      return 'female';
    }
  }

  /** Public wrapper so ProfileService.regenerate can re-run the auto-fill. */
  async buildPassportPublic(
    personaId: string,
    card: PersonaCard,
    stats: CorpusStats,
    conversations: Corpus['conversations'],
    personaAuthor: string,
  ): Promise<void> {
    return this.buildPassport(personaId, card, stats, conversations, personaAuthor);
  }

  /** Best-effort corpus read for regenerate (raw corpus is deleted post-build). */
  async tryReadCorpusForRegen(
    personaId: string,
  ): Promise<{ conversations: Corpus['conversations'] } | null> {
    const corpus = await this.storage.readCorpus(personaId).catch(() => null);
    return corpus ? { conversations: corpus.conversations } : null;
  }

  /**
   * Build & store the Phase-1 Character Passport. ONE extra DeepSeek call (when a
   * key exists) estimates ocean/chronotype/routineSkeleton over the same sample;
   * style fields are mirrored from the card + corpus stats; timezone/chronotype
   * are nudged by the persona's active-hours histogram from message timestamps.
   * Every field is marked provenance 'auto'. Heuristic neutral fallback when no
   * key. NEVER throws — caller wraps it, but we also swallow internally.
   */
  private async buildPassport(
    personaId: string,
    card: PersonaCard,
    stats: CorpusStats,
    conversations: Corpus['conversations'],
    personaAuthor: string,
  ): Promise<void> {
    const persona = await this.prisma.persona.findUnique({ where: { id: personaId } });
    const mode: 'memorial' | 'reconnect' = persona?.mode === 'reconnect' ? 'reconnect' : 'memorial';
    const baseTz = persona?.timezone ?? 'Europe/Kyiv';

    // Histogram of the persona's local-ish active hours (UTC; cheap owl/lark + tz hint).
    const hist = activeHourHistogram(conversations, personaAuthor);

    let ocean: Ocean | null = null;
    let chronotype: Chronotype | null = null;
    let routineSkeleton: RoutineBlock[] | null = null;

    if (hasApiKey()) {
      const sample = sampleForPassport(conversations);
      try {
        const out = await completeJson<{
          ocean?: Partial<Ocean>;
          ocean_justification?: Record<string, string>;
          chronotype?: { MSF?: number; sleepDurationH?: number };
          routineSkeleton?: Array<Partial<RoutineBlock>>;
        }>({
          model: EXTRACT_MODEL,
          maxTokens: 1200,
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content:
                'You are a careful personality analyst. From real chat history of ONE person you estimate Big-Five (OCEAN) scores 0..100, a chronotype, and a rough daily routine skeleton. Be evidence-based and conservative (use 50 when unsure). Return ONLY valid JSON, no markdown.',
            },
            {
              role: 'user',
              content: `Analyze "${personaAuthor}". Their active-hours histogram (local-ish, 0..23h -> message count): ${JSON.stringify(hist)}.
Return JSON exactly:
{
  "ocean": { "O": 0-100, "C": 0-100, "E": 0-100, "A": 0-100, "N": 0-100 },
  "ocean_justification": { "O": "one line", "C": "...", "E": "...", "A": "...", "N": "..." },
  "chronotype": { "MSF": 2.5-7.5, "sleepDurationH": 6-9 },   // MSF: 2.5=strong lark .. 7.5=strong owl; infer owl-ness from when they are active
  "routineSkeleton": [ { "label": "work/gym/etc", "approxStart": "HH:MM", "approxDur": minutes, "busy": true|false, "valence": -1..1, "arousal": -1..1 } ]  // 3-6 contiguous-ish blocks from mentions of work/study/gym/sleep
}

CHAT EXCERPTS:
${sample}`,
            },
          ],
        });
        if (out?.ocean) ocean = clampOcean(out.ocean);
        if (out?.chronotype) chronotype = clampChronotype(out.chronotype);
        if (Array.isArray(out?.routineSkeleton) && out.routineSkeleton.length) {
          routineSkeleton = sanitizeRoutine(out.routineSkeleton);
        }
      } catch (e) {
        this.logger.warn(`passport LLM analysis failed (heuristic fallback): ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Heuristic fallbacks (no key OR partial LLM output).
    if (!ocean) ocean = { O: 50, C: 50, E: 50, A: 50, N: 50 };
    if (!chronotype) chronotype = chronotypeFromHistogram(hist);
    // routineSkeleton omitted -> normalizePassport supplies a sensible default.

    const ps = stats.byAuthor[personaAuthor];
    const partial: Partial<CharacterPassport> = {
      name: card.name,
      relationshipToUser: card.relationship_to_user,
      occupation: extractOccupation(card),
      locale: '',
      timezone: baseTz, // tz inference left at build default unless explicit offsets known
      mode,
      speechStyle: card.speech_style ?? [],
      languageMixNotes: card.language_mix_notes ?? '',
      emojiAndPunctuation: card.emoji_and_punctuation ?? '',
      medianWords: ps?.medianWords ?? 6,
      emojiPerMessage: ps?.emojiPerMessage ?? 0,
      burstAvg: ps?.burstAvg ?? 1,
      topEmoji: ps ? ps.topEmoji.map(([e]) => e) : [],
      ocean,
      chronotype,
      ...(routineSkeleton ? { routineSkeleton } : {}),
      relationship: {
        closenessSeed: mode === 'memorial' ? 70 : 40,
        pinnedMaxStage: 4,
        decayEnabled: mode !== 'memorial',
        proactivityScale: 1.0,
      },
    };

    const passport = normalizePassport(partial);
    // Mark EVERY top-level field provenance 'auto'.
    passport._provenance = autoProvenance();
    passport._version = 1;

    await this.prisma.persona.update({
      where: { id: personaId },
      data: { passport: JSON.stringify(passport), passportVersion: 1 },
    });
    this.logger.log(`passport auto-filled for persona ${personaId} (mode=${mode}, llm=${hasApiKey()})`);
  }
}

/** Top-level passport fields all set to provenance 'auto' at build. */
function autoProvenance(): Record<string, Provenance> {
  const fields = [
    'name', 'relationshipToUser', 'occupation', 'locale', 'timezone', 'mode',
    'speechStyle', 'languageMixNotes', 'emojiAndPunctuation', 'medianWords',
    'emojiPerMessage', 'burstAvg', 'topEmoji', 'ocean', 'baselinePAD',
    'chronotype', 'routineSkeleton', 'relationship', 'boundaries', 'knobs',
  ];
  const out: Record<string, Provenance> = {};
  for (const f of fields) out[f] = 'auto';
  return out;
}

function clampOcean(o: Partial<Ocean>): Ocean {
  const c = (v: unknown): number => {
    const n = typeof v === 'number' ? v : 50;
    return Math.max(0, Math.min(100, Math.round(n)));
  };
  return { O: c(o.O), C: c(o.C), E: c(o.E), A: c(o.A), N: c(o.N) };
}

function clampChronotype(ch: { MSF?: number; sleepDurationH?: number }): Chronotype {
  const msf = typeof ch.MSF === 'number' ? Math.max(2.5, Math.min(7.5, ch.MSF)) : 4.5;
  const sleep = typeof ch.sleepDurationH === 'number' ? Math.max(6, Math.min(9, ch.sleepDurationH)) : 7.5;
  return { MSF: msf, sleepDurationH: sleep };
}

function sanitizeRoutine(rows: Array<Partial<RoutineBlock>>): RoutineBlock[] {
  return rows
    .slice(0, 6)
    .map((r) => ({
      label: typeof r.label === 'string' && r.label ? r.label.slice(0, 60) : 'block',
      approxStart: typeof r.approxStart === 'string' && /^\d{1,2}:\d{2}$/.test(r.approxStart) ? r.approxStart : '09:00',
      approxDur: typeof r.approxDur === 'number' && r.approxDur > 0 ? Math.min(1440, Math.round(r.approxDur)) : 120,
      busy: Boolean(r.busy),
      valence: typeof r.valence === 'number' ? Math.max(-1, Math.min(1, r.valence)) : 0,
      arousal: typeof r.arousal === 'number' ? Math.max(-1, Math.min(1, r.arousal)) : 0,
    }))
    .filter((r) => r.label);
}

/** Per-hour message counts (0..23, UTC) for the persona — owl/lark + tz signal. */
function activeHourHistogram(conversations: Corpus['conversations'], personaAuthor: string): number[] {
  const hist = new Array(24).fill(0);
  for (const c of conversations) {
    for (const m of c.messages) {
      if (m.author !== personaAuthor) continue;
      const h = new Date(m.ts).getUTCHours();
      hist[h]++;
    }
  }
  return hist;
}

/**
 * Cheap chronotype from the active-hours histogram: later peaks of activity ->
 * owl-ier (higher MSF). Maps the activity centroid (weighted-circular mean hour)
 * onto MSF 2.5..7.5. Falls back to 4.5 (neutral) on no data.
 */
function chronotypeFromHistogram(hist: number[]): Chronotype {
  const total = hist.reduce((a, b) => a + b, 0);
  if (!total) return { MSF: 4.5, sleepDurationH: 7.5 };
  // Circular mean of activity hours (handles the late-night wrap).
  let sx = 0;
  let sy = 0;
  for (let h = 0; h < 24; h++) {
    const ang = (2 * Math.PI * h) / 24;
    sx += hist[h] * Math.cos(ang);
    sy += hist[h] * Math.sin(ang);
  }
  let meanH = (Math.atan2(sy, sx) * 24) / (2 * Math.PI);
  if (meanH < 0) meanH += 24;
  // Activity centroid 12:00 -> MSF 4.5; later centroid -> owl. Map 9..21h -> 2.5..7.5.
  const msf = Math.max(2.5, Math.min(7.5, 4.5 + (meanH - 14) * 0.4));
  return { MSF: msf, sleepDurationH: 7.5 };
}

/** Best-effort occupation from card facts/traits (looks for a work-ish fact). */
function extractOccupation(card: PersonaCard): string {
  const hay = [...(card.facts ?? []), ...(card.recurring_topics ?? [])];
  const re = /(works?|working|job|studies|student|teacher|engineer|doctor|nurse|manager|designer|developer|працює|робот|вчитель|студент|лікар|інженер)/i;
  const hit = hay.find((f) => re.test(f));
  return hit ? hit.slice(0, 120) : '';
}

/** A compact recent+spread sample for the passport LLM call (cap ~12k chars). */
function sampleForPassport(convs: Corpus['conversations']): string {
  const parts: string[] = [];
  const recent = convs.slice(-6);
  const earlier = convs.slice(0, -6);
  const step = Math.max(1, Math.floor(earlier.length / 4));
  const sampled = earlier.filter((_, i) => i % step === 0).slice(0, 4);
  for (const c of [...sampled, ...recent]) parts.push(renderConv(c, 20));
  let out = parts.join('\n\n');
  if (out.length > 12000) out = out.slice(out.length - 12000);
  return out;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function stubCard(
  personaAuthor: string,
  userAuthor: string,
  stats: CorpusStats,
  relationship?: string,
): PersonaCard {
  const ps = stats.byAuthor[personaAuthor];
  const speech: string[] = [];
  const traits: string[] = ['attentive to small details', 'writes the way they speak'];
  if (ps) {
    speech.push(`usually ${ps.medianWords <= 5 ? 'short' : 'longer'} messages (~${ps.medianWords} words)`);
    if (ps.burstAvg > 1.5) speech.push(`writes in bursts of ~${ps.burstAvg} messages`);
    if (ps.noTrailingPeriod > 0.6) speech.push('almost never ends with a period');
    if (ps.bracketSmiles > 0.1) speech.push('smiles with brackets ")"');
    if (ps.emojiPerMessage > 0.2)
      speech.push(`loves emoji: ${ps.topEmoji.slice(0, 4).map(([e]) => e).join(' ')}`);
  }
  return {
    name: personaAuthor,
    relationship_to_user: relationship ?? 'someone close',
    traits,
    speech_style: speech.length ? speech : ['ordinary messenger style'],
    language_mix_notes: ps ? describeLangMix(ps.langMix) : '',
    emoji_and_punctuation: ps
      ? `${ps.emojiPerMessage} emoji per message; top: ${ps.topEmoji.slice(0, 6).map(([e]) => e).join(' ') || '(almost no emoji)'}`
      : '',
    pet_names: [],
    inside_jokes: [],
    recurring_topics: [],
    dynamics_with_user: `chats with ${userAuthor}`,
    facts: [],
  };
}

function stubMemories(exemplars: string[], personaAuthor: string, lastDate: Date): MemoryItem[] {
  const date = lastDate.toISOString().slice(0, 7);
  const out: MemoryItem[] = [];
  const prefix = `${personaAuthor}: `;
  for (const ex of exemplars) {
    for (const line of ex.split('\n')) {
      if (!line.startsWith(prefix)) continue;
      const text = line.slice(prefix.length).trim();
      if (text.length < 20 || text.startsWith('[')) continue;
      out.push({ text, keywords: tokens(text).slice(0, 5), date });
      break; // one memory per exemplar
    }
    if (out.length >= 12) break;
  }
  return out;
}
