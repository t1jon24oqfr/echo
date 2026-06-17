import { Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import type { Persona } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { parsePassport, type CharacterPassport, octantLabel } from '../engine/passport';
import { completeJson, EXTRACT_MODEL, hasApiKey } from '../engine/llm';
import { dayRng, type Clock, type Rng, systemClock, localDateStr, localMinsSinceMidnight } from '../engine/state';
import { memoryImportance } from './memory.service';

// One agenda block as stored in DailyAgenda.blocks (JSON array).
export interface AgendaBlock {
  activity: string; // canonical key: 'sleep'|'work'|'commute'|'gym'|'meal'|'free'|...
  label: string; // human label ("at work", "winding down")
  startMin: number; // minutes since local midnight [0,1440)
  durMin: number; // minutes
  valence: number; // [-1,1]
  arousal: number; // [-1,1]
  busy: boolean;
}

export interface CurrentActivity {
  activity: string;
  label: string;
  busy: boolean;
  valence: number;
  arousal: number;
  nextLabel: string;
  minsUntilNext: number;
}

interface CacheEntry {
  localDate: string;
  blocks: AgendaBlock[];
}

@Injectable()
export class AgendaService {
  private readonly logger = new Logger(AgendaService.name);
  // In-process cache so the hot path (presence/state read) is a pure clock lookup,
  // never a DB round-trip. Invalidated when the local date rolls over.
  private readonly cache = new Map<string, CacheEntry>();
  // Coalesce concurrent generations for the same (persona, day).
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(private readonly prisma: PrismaService) {}

  // --------------------------------------------------------------------------
  // currentActivitySync — ZERO LLM, ZERO DB: pure clock lookup over the cached
  // agenda. Cache miss -> kick a lazy ensureToday (fire-and-forget) and return
  // null (presence/prompt degrade gracefully to energy-only until it's ready).
  // --------------------------------------------------------------------------
  currentActivitySync(personaId: string, tz: string, clock: Clock = systemClock): CurrentActivity | null {
    const localDate = localDateStr(clock, tz);
    const entry = this.cache.get(personaId);
    if (!entry || entry.localDate !== localDate) {
      void this.ensureToday(personaId).catch(() => undefined);
      return null;
    }
    return this.lookup(entry.blocks, localMinsSinceMidnight(clock, tz));
  }

  /** Pure block lookup: which block is "now" + the next one. */
  private lookup(blocks: AgendaBlock[], mins: number): CurrentActivity | null {
    if (!blocks.length) return null;
    const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin);
    let cur: AgendaBlock | null = null;
    for (const b of sorted) {
      const end = b.startMin + b.durMin;
      // handle the wrap-around sleep block (start+dur may exceed 1440)
      if (b.startMin <= mins && mins < end) {
        cur = b;
        break;
      }
      if (end > 1440 && mins < end - 1440) {
        cur = b; // we're in the post-midnight tail of a wrap block
        break;
      }
    }
    if (!cur) cur = sorted[sorted.length - 1]; // fallback to last (wrap/sleep)
    const curEnd = cur.startMin + cur.durMin;
    let minsUntilNext = curEnd - mins;
    if (minsUntilNext < 0) minsUntilNext += 1440;
    // next block = the one starting at/after curEnd (mod day)
    const next =
      sorted.find((b) => b.startMin >= curEnd % 1440) ?? sorted[0];
    return {
      activity: cur.activity,
      label: cur.label,
      busy: cur.busy,
      valence: cur.valence,
      arousal: cur.arousal,
      nextLabel: next.label,
      minsUntilNext: Math.max(0, Math.round(minsUntilNext)),
    };
  }

  // --------------------------------------------------------------------------
  // ensureToday — generate (or load) the DailyAgenda for the persona's local day.
  // COST CONTROL: clone+jitter a same-weekday template (byLLM=false) when one
  // exists; otherwise ONE DeepSeek call. Memorial mode: skip entirely.
  // --------------------------------------------------------------------------
  async ensureToday(personaId: string, clockIn?: Clock): Promise<void> {
    const clock = clockIn ?? systemClock;
    const persona = await this.prisma.persona.findUnique({ where: { id: personaId } });
    if (!persona || persona.status !== 'ready') return;
    const passport = parsePassport(persona.passport);
    const tz = passport?.timezone ?? persona.timezone ?? 'Europe/Kyiv';
    const mode = (passport?.mode ?? persona.mode) === 'reconnect' ? 'reconnect' : 'memorial';
    if (mode === 'memorial') return; // no fabricated daily activities (remembrance)

    const localDate = localDateStr(clock, tz);
    // Cache already current?
    const cached = this.cache.get(personaId);
    if (cached && cached.localDate === localDate) return;

    const key = `${personaId}:${localDate}`;
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const job = this.generateOrLoad(persona, passport, tz, localDate, clock)
      .catch((e) => this.logger.warn(`agenda ensureToday failed for ${personaId}: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  private async generateOrLoad(
    persona: Persona,
    passport: CharacterPassport | null,
    tz: string,
    localDate: string,
    clock: Clock,
  ): Promise<void> {
    // 1) Already persisted for today?
    const row = await this.prisma.dailyAgenda.findUnique({
      where: { personaId_localDate: { personaId: persona.id, localDate } },
    });
    if (row) {
      this.cache.set(persona.id, { localDate, blocks: safeBlocks(row.blocks) });
      return;
    }

    const rng = dayRng(persona.id, localDate);
    const weekday = DateTime.fromISO(localDate, { zone: tz }).weekday; // 1..7

    // 2) Clone a same-weekday template from a prior week (Agentic Plan Caching).
    const template = await this.prisma.dailyAgenda.findFirst({
      where: { personaId: persona.id },
      orderBy: { createdAt: 'desc' },
    });
    let blocks: AgendaBlock[] | null = null;
    let byLLM = false;
    let seedSummary: string | null = null;

    const templateMatchesWeekday =
      template && DateTime.fromISO(template.localDate, { zone: template.timezone }).weekday === weekday;

    if (templateMatchesWeekday) {
      blocks = jitterBlocks(safeBlocks(template.blocks), rng);
    } else {
      // 3) ONE DeepSeek call (or a deterministic skeleton fallback if no key).
      seedSummary = await this.lastReflectionSummary(persona.id);
      blocks = await this.generateViaLLM(persona, passport, tz, localDate, weekday, seedSummary, rng);
      byLLM = blocks !== null && hasApiKey();
      if (!blocks) blocks = this.skeletonAgenda(passport, rng);
    }

    blocks = normalizeBlocks(blocks);
    await this.prisma.dailyAgenda
      .create({
        data: {
          personaId: persona.id,
          localDate,
          timezone: tz,
          blocks: JSON.stringify(blocks),
          seedSummary,
          byLLM,
        },
      })
      .catch(() => undefined); // unique-race: another worker created it; cache below still fine
    this.cache.set(persona.id, { localDate, blocks });
    this.logger.log(`agenda for ${persona.id} ${localDate} (byLLM=${byLLM}, ${blocks.length} blocks)`);
  }

  private async generateViaLLM(
    persona: Persona,
    passport: CharacterPassport | null,
    tz: string,
    localDate: string,
    weekday: number,
    seedSummary: string | null,
    _rng: Rng,
  ): Promise<AgendaBlock[] | null> {
    if (!hasApiKey()) return null;
    const name = passport?.name || persona.name;
    const occupation = passport?.occupation || '';
    const traits = (passport?.speechStyle ?? []).slice(0, 4).join(', ');
    const routine = (passport?.routineSkeleton ?? [])
      .map((r) => `${r.label} ~${r.approxStart} for ${r.approxDur}min (busy=${r.busy})`)
      .join('; ');
    const chrono = passport?.chronotype ?? { MSF: 4.5, sleepDurationH: 7.5 };
    const dayName = DateTime.fromISO(localDate, { zone: tz }).toFormat('cccc');
    try {
      const blocks = await completeJson<AgendaBlock[]>({
        model: EXTRACT_MODEL,
        maxTokens: 900,
        temperature: 0.6,
        messages: [
          {
            role: 'system',
            content:
              'You generate a believable time-boxed daily plan for a real person, as a JSON array of contiguous blocks that sum to 1440 minutes (a full day) INCLUDING a wrap-around sleep block. Return ONLY valid JSON.',
          },
          {
            role: 'user',
            content: `Person: ${name}${occupation ? `, ${occupation}` : ''}. Style/traits: ${traits || 'n/a'}.
Chronotype MSF=${chrono.MSF} (2.5 lark .. 7.5 owl), sleeps ~${chrono.sleepDurationH}h. Timezone ${tz}. Day: ${dayName} (${localDate}).
Routine skeleton: ${routine || '(none — invent a plausible ordinary day)'}.
${seedSummary ? `Yesterday: ${seedSummary}` : ''}
Output a JSON array of 6-12 contiguous blocks covering the WHOLE 1440-minute day with an explicit sleep block (e.g. bedtime ~23:30 to wake ~07:30, possibly wrapping past midnight):
[{"activity":"sleep|work|commute|gym|meal|errands|free|social|chores","label":"short human label e.g. 'at work'","startMin":<0-1439>,"durMin":<minutes>,"valence":<-1..1>,"arousal":<-1..1>,"busy":<true|false>}]
Contiguous (each startMin = previous startMin+durMin, the sleep block wraps the night), durations sum to 1440. Granularity 30-120 min.`,
          },
        ],
      });
      if (!Array.isArray(blocks) || !blocks.length) return null;
      return blocks;
    } catch (e) {
      this.logger.warn(`agenda LLM failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  /** Deterministic skeleton from the passport routine + chronotype (no LLM). */
  private skeletonAgenda(passport: CharacterPassport | null, rng: Rng): AgendaBlock[] {
    const chrono = passport?.chronotype ?? { MSF: 4.5, sleepDurationH: 7.5 };
    const jit = (n: number) => Math.round((rng() - 0.5) * 2 * n);
    // wake = wrap24(MSF - sleepDuration/2); bedtime = wrap24(MSF + sleepDuration/2)
    const wakeH = wrap24(chrono.MSF - chrono.sleepDurationH / 2);
    const bedH = wrap24(chrono.MSF + chrono.sleepDurationH / 2);
    const wakeMin = clampMin(Math.round(wakeH * 60) + jit(25));
    const bedMin = clampMin(Math.round(bedH * 60) + jit(25));
    // Build a simple awake span from wake to bed; sleep wraps the rest.
    const blocks: AgendaBlock[] = [];
    // morning routine
    blocks.push({ activity: 'free', label: 'morning routine', startMin: wakeMin, durMin: 90, valence: 0.1, arousal: 0.1, busy: false });
    // work / day (busy)
    blocks.push({ activity: 'work', label: 'at work', startMin: clampMin(wakeMin + 90), durMin: 480, valence: 0.0, arousal: 0.2, busy: true });
    // evening free
    blocks.push({ activity: 'free', label: 'evening, free time', startMin: clampMin(wakeMin + 90 + 480), durMin: Math.max(60, distanceMins(clampMin(wakeMin + 90 + 480), bedMin)), valence: 0.2, arousal: 0.0, busy: false });
    // sleep (wrap)
    blocks.push({ activity: 'sleep', label: 'asleep', startMin: bedMin, durMin: distanceMins(bedMin, wakeMin), valence: 0.0, arousal: -0.6, busy: true });
    return blocks;
  }

  // --------------------------------------------------------------------------
  // Nightly reflection (1 DeepSeek call/day) — at simulated bedtime OR when
  // importanceSinceReflect > 150. Writes 2-4 'reflection' Memory rows + a day
  // summary seed for tomorrow. Resets the accumulator + cooldown. Skip memorial.
  // --------------------------------------------------------------------------
  async maybeReflect(personaId: string, clockIn?: Clock): Promise<boolean> {
    const clock = clockIn ?? systemClock;
    const persona = await this.prisma.persona.findUnique({ where: { id: personaId } });
    if (!persona || persona.status !== 'ready') return false;
    const passport = parsePassport(persona.passport);
    const mode = (passport?.mode ?? persona.mode) === 'reconnect' ? 'reconnect' : 'memorial';
    if (mode === 'memorial') return false;
    if (!hasApiKey()) return false;

    const state = await this.prisma.personaState.findUnique({ where: { personaId } });
    if (!state) return false;

    const tz = passport?.timezone ?? persona.timezone ?? 'Europe/Kyiv';
    const localDate = localDateStr(clock, tz);
    const entry = this.cache.get(personaId);
    const mins = localMinsSinceMidnight(clock, tz);
    const cur = entry && entry.localDate === localDate ? this.lookup(entry.blocks, mins) : null;
    const atBedtime = cur?.activity === 'sleep';
    const overload = state.importanceSinceReflect > 150;
    if (!atBedtime && !overload) return false;

    // Cooldown: at most one reflection per ~18h (prevent runaway).
    if (state.lastReflectAt && clock.now().getTime() - state.lastReflectAt.getTime() < 18 * 3_600_000) {
      return false;
    }

    const recent = await this.prisma.memory.findMany({
      where: { personaId },
      orderBy: { id: 'desc' },
      take: 25,
      select: { text: true, importance: true },
    });
    if (!recent.length) return false;

    try {
      const result = await completeJson<{ reflections: { text: string; keywords?: string[] }[]; summary: string }>({
        model: EXTRACT_MODEL,
        maxTokens: 600,
        messages: [
          {
            role: 'system',
            content:
              'You are a reflective memory subsystem. Given recent memories of one person, synthesize 2-4 higher-level INSIGHT statements (not restatements) and a 1-2 sentence summary of the day. Return ONLY valid JSON.',
          },
          {
            role: 'user',
            content: `Recent memories of ${passport?.name || persona.name}:
${recent.map((m) => `- ${m.text}`).join('\n')}

Return: {"reflections":[{"text":"a higher-level insight in the person's voice","keywords":["2-5 lowercase"]}],"summary":"1-2 sentence day summary"}`,
          },
        ],
      });
      const reflections = Array.isArray(result?.reflections) ? result.reflections.slice(0, 4) : [];
      const moodLabel = octantLabel({ P: state.moodP, A: state.moodA, D: state.moodD }).label;
      if (reflections.length) {
        await this.prisma.memory.createMany({
          data: reflections
            .filter((r) => r && typeof r.text === 'string' && r.text.trim().length >= 3)
            .map((r) => ({
              personaId,
              text: r.text.trim(),
              keywords: JSON.stringify(Array.isArray(r.keywords) ? r.keywords : []),
              date: localDate.slice(0, 7),
              importance: memoryImportance(r.text),
              kind: 'reflection',
              emotionTag: moodLabel,
            })),
        });
      }
      // Persist the day-summary as tomorrow's seed on today's agenda row + reset accumulator.
      if (result?.summary) {
        await this.prisma.dailyAgenda
          .updateMany({ where: { personaId, localDate }, data: { seedSummary: result.summary } })
          .catch(() => undefined);
      }
      await this.prisma.personaState.updateMany({
        where: { personaId },
        data: { importanceSinceReflect: 0, lastReflectAt: clock.now() },
      });
      this.logger.log(`reflection for ${personaId}: +${reflections.length} insights`);
      return true;
    } catch (e) {
      this.logger.warn(`reflection failed for ${personaId}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  private async lastReflectionSummary(personaId: string): Promise<string | null> {
    const prev = await this.prisma.dailyAgenda.findFirst({
      where: { personaId, seedSummary: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { seedSummary: true },
    });
    return prev?.seedSummary ?? null;
  }
}

// ----------------------------------------------------------------------------
// pure helpers
// ----------------------------------------------------------------------------

function safeBlocks(raw: string): AgendaBlock[] {
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? (arr as AgendaBlock[]) : [];
  } catch {
    return [];
  }
}

/** Jitter each block's startMin by ±~12 min (seeded) and renormalize contiguity. */
function jitterBlocks(blocks: AgendaBlock[], rng: Rng): AgendaBlock[] {
  if (!blocks.length) return blocks;
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin);
  const first = sorted[0];
  let cursor = clampMin(first.startMin + Math.round((rng() - 0.5) * 24));
  return sorted.map((b, i) => {
    const out = { ...b, startMin: i === 0 ? cursor : cursor };
    cursor = clampMin(cursor + b.durMin);
    return out;
  });
}

/** Make blocks contiguous + sum to 1440 (the last block absorbs the remainder). */
function normalizeBlocks(blocks: AgendaBlock[]): AgendaBlock[] {
  const cleaned = (blocks ?? [])
    .filter((b) => b && typeof b.startMin === 'number' && typeof b.durMin === 'number' && b.durMin > 0)
    .map((b) => ({
      activity: String(b.activity ?? 'free'),
      label: String(b.label ?? b.activity ?? 'free'),
      startMin: clampMin(Math.round(b.startMin)),
      durMin: Math.max(1, Math.round(b.durMin)),
      valence: clampSigned(Number(b.valence ?? 0)),
      arousal: clampSigned(Number(b.arousal ?? 0)),
      busy: Boolean(b.busy),
    }))
    .sort((a, b) => a.startMin - b.startMin);
  if (!cleaned.length) return cleaned;
  // Force contiguity from the first block; the final block wraps to fill 1440.
  let cursor = cleaned[0].startMin;
  const out: AgendaBlock[] = [];
  let total = 0;
  for (let i = 0; i < cleaned.length; i++) {
    const b = { ...cleaned[i], startMin: cursor };
    out.push(b);
    cursor = (cursor + b.durMin) % 1440;
    total += b.durMin;
  }
  // adjust the last block so the day sums to exactly 1440
  const diff = 1440 - total;
  if (diff !== 0) {
    const last = out[out.length - 1];
    last.durMin = Math.max(1, last.durMin + diff);
  }
  return out;
}

function clampMin(m: number): number {
  return ((Math.round(m) % 1440) + 1440) % 1440;
}
function clampSigned(x: number): number {
  return Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
}
function wrap24(h: number): number {
  return ((h % 24) + 24) % 24;
}
/** forward minutes from a to b on a 1440 clock (>0). */
function distanceMins(a: number, b: number): number {
  let d = b - a;
  if (d <= 0) d += 1440;
  return d;
}
