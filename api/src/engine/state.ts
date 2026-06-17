// Echo — Phase 2 Inner-Life State Engine (PURE, deterministic core).
//
// Binding source: docs/specs/2026-06-16-living-persona-design.md §3 (advanceState,
// computeEnergy, appraise) and §5 (closeness). Every function here is PURE: NO
// Date.now(), NO Math.random() inside — the clock and rng are INJECTED so the whole
// engine is reproducible and unit-testable. The service layer (persona-state.service)
// does all I/O and supplies the clock/rng.
//
// COMPUTE-ON-READ contract: advanceState integrates the persistent state forward by
// an arbitrary dt in CLOSED FORM (exp decay, never per-minute iteration). The
// emotion-decay + mood-toward-baseline steps form an exact semigroup so
// advance(advance(s,a),b) == advance(s,a+b) (see state.test.ts).

import { octantLabel, type CharacterPassport, type PAD } from './passport';

export { octantLabel } from './passport';

// ----------------------------------------------------------------------------
// Injected effects
// ----------------------------------------------------------------------------

/** Injected clock — the ONLY source of "now" inside the engine. */
export interface Clock {
  now(): Date;
}

/** Deterministic [0,1) generator (mulberry32). */
export type Rng = () => number;

/** A real-clock implementation for production callers. */
export const systemClock: Clock = { now: () => new Date() };

/** Build a fixed clock at a given instant (tests + per-request snapshots). */
export function fixedClock(at: Date | number | string): Clock {
  const d = at instanceof Date ? at : new Date(at);
  return { now: () => new Date(d.getTime()) };
}

// ----------------------------------------------------------------------------
// Math helpers
// ----------------------------------------------------------------------------

const TWO_PI = 2 * Math.PI;

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
export function clamp01(x: number): number {
  return clamp(x, 0, 1);
}
/** Exponential decay FACTOR over dt_min minutes with half-life H minutes. */
export function half(dtMin: number, H: number): number {
  return Math.pow(0.5, dtMin / H);
}

// ----------------------------------------------------------------------------
// TUNABLE CONSTANTS (global K). Per-persona overrides live in Passport.tuning
// (mirrors the redis-config A/B pattern). resolveK merges them.
// ----------------------------------------------------------------------------

export interface KConstants {
  // emotion half-lives (minutes — affective chronometry)
  H_emotion_pos: number;
  H_emotion_neg: number;
  H_emotion_slow: number;
  // mood half-lives (minutes — P~48h, A~6h, D~72h)
  H_mood_P: number;
  H_mood_A: number;
  H_mood_D: number;
  // ALMA mood-change
  k_pull: number;
  T_mc: number;
  // appraisal
  lambda_surprise: number;
  gain_neuro: number;
  maxEventDelta: number;
  // energy two-process
  tau_wake_h: number;
  tau_sleep_h: number;
  circAmp: number;
  circAcrophase_h: number;
  ultraAmp: number;
  inertiaPenalty: number;
  inertiaTau_h: number;
  // closeness
  k_up: number;
  eta_floor_reconnect: number;
  tau0_days: number;
  alpha_strength: number;
  dailyGainCap: number;
}

export const K: KConstants = {
  H_emotion_pos: 11,
  H_emotion_neg: 6,
  H_emotion_slow: 45,
  H_mood_P: 2880,
  H_mood_A: 360,
  H_mood_D: 4320,
  k_pull: 0.7,
  T_mc: 10,
  lambda_surprise: 0.5,
  gain_neuro: 0.5,
  maxEventDelta: 0.3,
  tau_wake_h: 20,
  tau_sleep_h: 4.5,
  circAmp: 0.2,
  circAcrophase_h: 16.0,
  ultraAmp: 0.15,
  inertiaPenalty: 0.6,
  inertiaTau_h: 0.5,
  k_up: 6,
  eta_floor_reconnect: 35,
  tau0_days: 14,
  alpha_strength: 0.25,
  dailyGainCap: 8,
};

/** Merge a passport's tuning overrides over the global K (omitted -> global). */
export function resolveK(passport?: Pick<CharacterPassport, 'tuning'> | null): KConstants {
  const t = (passport as { tuning?: Partial<KConstants> } | null | undefined)?.tuning;
  if (!t || typeof t !== 'object') return K;
  const out: KConstants = { ...K };
  for (const key of Object.keys(K) as (keyof KConstants)[]) {
    const v = (t as Partial<KConstants>)[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

// OCC -> PAD unit directions (ALMA/Gebhard table) — per-persona overridable later.
export const PAD_DIR: Record<string, [number, number, number]> = {
  joy: [0.4, 0.2, 0.1],
  sadness: [-0.6, -0.4, -0.5],
  anger: [-0.51, 0.59, 0.25],
  fear: [-0.64, 0.6, -0.43],
  pride: [0.4, 0.3, 0.3],
  gratitude: [0.4, 0.2, -0.3],
  love: [0.5, 0.3, 0.2],
  hope: [0.2, 0.2, -0.1],
  relief: [0.2, -0.3, 0.4],
  disappointment: [-0.3, -0.2, -0.4],
  resentment: [-0.2, -0.3, -0.2],
  surprise: [0.2, 0.5, 0.1],
};

// ----------------------------------------------------------------------------
// Active-emotion record (matches the JSON stored in PersonaState.emotions)
// ----------------------------------------------------------------------------

export interface ActiveEmotion {
  type: string;
  intensity: number; // [0,1]
  p: number;
  a: number;
  d: number;
  halflifeMin: number;
  createdAt: string; // ISO
}

// The mutable engine-facing view of a PersonaState row (only the fields the math
// touches). The service maps the Prisma row to/from this and supplies stateAt.
export interface StateView {
  moodP: number;
  moodA: number;
  moodD: number;
  baseP: number;
  baseA: number;
  baseD: number;
  emotions: string; // JSON ActiveEmotion[]
  closeness: number;
  peakCloseness: number;
  stage: number;
  sleepPressureS: number;
  lastWakeAt: Date;
  lastSleepAt: Date | null;
  asleep: boolean;
  stateAt: Date;
  lastDecayDay: string | null;
  version: number;
}

export interface DerivedState {
  energy: number; // [0,1]
  mood: PAD; // tanh-clamped current mood
  octant: { label: string; adverb: string };
  centerI: number; // emotion-center intensity
}

export type AdvancedState = StateView & { _derived: DerivedState };

// ----------------------------------------------------------------------------
// Timezone-aware clock helpers (Luxon — DST/antimeridian correct, per §3/§4).
// Imported lazily to keep this module dependency-light for pure-math callers.
// ----------------------------------------------------------------------------
import { DateTime } from 'luxon';

/** Local YYYY-MM-DD for the clock instant in the given IANA tz. */
export function localDateStr(clock: Clock, tz: string): string {
  return DateTime.fromJSDate(clock.now(), { zone: tz }).toFormat('yyyy-MM-dd');
}

/** Local hour as a float (e.g. 14.5 = 14:30) in the given IANA tz. */
export function localHourFloat(clock: Clock, tz: string): number {
  const dt = DateTime.fromJSDate(clock.now(), { zone: tz });
  return dt.hour + dt.minute / 60 + dt.second / 3600;
}

/** Minutes since local midnight in the given IANA tz (for agenda lookup). */
export function localMinsSinceMidnight(clock: Clock, tz: string): number {
  const dt = DateTime.fromJSDate(clock.now(), { zone: tz });
  return dt.hour * 60 + dt.minute;
}

function hoursSince(from: Date | null | undefined, clock: Clock): number {
  if (!from) return 0;
  return Math.max(0, (clock.now().getTime() - from.getTime()) / 3_600_000);
}
function daysSince(from: Date | null | undefined, clock: Clock): number {
  if (!from) return 0;
  return Math.max(0, (clock.now().getTime() - from.getTime()) / 86_400_000);
}

// ----------------------------------------------------------------------------
// computeEnergy — Borbély S + Folkard C + ultradian U + sleep-inertia W -> [0,1]
// (design spec §3). Recomputed on every read, never stored.
// ----------------------------------------------------------------------------

export function computeEnergy(
  s: Pick<StateView, 'asleep' | 'sleepPressureS' | 'lastWakeAt' | 'lastSleepAt'>,
  passport: { timezone: string; chronotype: { MSF: number } },
  clock: Clock,
  k: KConstants = K,
): number {
  const tz = passport.timezone;
  const hLocal = localHourFloat(clock, tz);
  // owl (high MSF) shifts the whole curve LATER. 4.87 = population-mean MSF.
  const phase = passport.chronotype.MSF - 4.87;
  const h = (((hLocal - phase) % 24) + 24) % 24;

  // Process C — circadian cosine (acrophase ~16:00, trough ~04:00) in [-1,1].
  const C = Math.cos((TWO_PI * (h - k.circAcrophase_h)) / 24);
  // Process U — 12h ultradian -> the ~14:00 post-lunch dip, in [-1,1].
  const U = Math.cos((TWO_PI * (h - k.circAcrophase_h)) / 12);

  // Process S — homeostatic debt, closed-form from last wake/sleep timestamps.
  let debt: number;
  if (s.asleep) {
    const tAsleepH = hoursSince(s.lastSleepAt, clock);
    debt = s.sleepPressureS * Math.exp(-tAsleepH / k.tau_sleep_h); // recharging
  } else {
    const tAwakeH = hoursSince(s.lastWakeAt, clock);
    debt = 1 - (1 - s.sleepPressureS) * Math.exp(-tAwakeH / k.tau_wake_h); // accruing
  }

  // Process W — sleep inertia: groggy first ~45-60 min after wake.
  const tSinceWakeH = s.asleep ? 99 : hoursSince(s.lastWakeAt, clock);
  const inertia = k.inertiaPenalty * Math.exp(-tSinceWakeH / k.inertiaTau_h);

  const raw = 0.55 * C + k.ultraAmp * U - 0.45 * debt - inertia;
  return clamp01(0.5 + 0.5 * raw);
}

// ----------------------------------------------------------------------------
// advanceState — the ONE pure function called at the top of every read (§3).
// Pure: clock & rng injected. Closed-form integration over dtSec.
// ----------------------------------------------------------------------------

export interface AdvanceContext {
  /** IANA tz + chronotype the energy/decay-day logic needs. */
  timezone: string;
  chronotype: { MSF: number };
  /** memorial disables closeness decay + (in the service) activity sim. */
  mode: 'memorial' | 'reconnect';
  /** relationship.decayEnabled (forced false in memorial). */
  decayEnabled: boolean;
  /** lastUserAt for the idle-decay clock (null = never -> no decay). */
  lastUserAt: Date | null;
  /** per-persona K overrides (Passport.tuning). */
  tuning?: Partial<KConstants>;
}

export function advanceState(
  s: StateView,
  dtSec: number,
  ctx: AdvanceContext,
  clock: Clock,
  _rng: Rng,
): AdvancedState {
  const k = resolveK({ tuning: ctx.tuning } as Pick<CharacterPassport, 'tuning'>);
  const dtMin = Math.max(0, dtSec) / 60;
  let m: [number, number, number] = [s.moodP, s.moodA, s.moodD];
  const b: [number, number, number] = [s.baseP, s.baseA, s.baseD];

  // STEP 1 — decay each active emotion toward 0; drop the negligible ones.
  let em: ActiveEmotion[] = parseEmotions(s.emotions);
  em = em
    .map((e) => ({ ...e, intensity: e.intensity * half(dtMin, e.halflifeMin) }))
    .filter((e) => e.intensity >= 0.02);

  // STEP 2 — virtual emotion center (intensity-weighted avg) + center intensity.
  let vec: [number, number, number] = [0, 0, 0];
  let wsum = 0;
  for (const e of em) {
    vec[0] += e.intensity * e.p;
    vec[1] += e.intensity * e.a;
    vec[2] += e.intensity * e.d;
    wsum += e.intensity;
  }
  const centerI = em.length ? clamp01(wsum / em.length) : 0;
  if (wsum > 0) vec = [vec[0] / wsum, vec[1] / wsum, vec[2] / wsum];

  // STEP 3 — mood decays toward baseline (per-axis half-lives; arousal fastest).
  const Hm = [k.H_mood_P, k.H_mood_A, k.H_mood_D];
  for (let i = 0; i < 3; i++) m[i] += (b[i] - m[i]) * (1 - half(dtMin, Hm[i]));

  // STEP 4 — ALMA pull toward emotion center (only if emotions active).
  if (wsum > 0) {
    const pf = k.k_pull * centerI * (1 - half(dtMin, k.T_mc));
    for (let i = 0; i < 3; i++) m[i] += (vec[i] - m[i]) * pf;
  }

  // STEP 5 — soft-clamp with tanh ONLY when an axis would exceed [-1,1] (a
  // saturation guard, not a per-tick squash). Applying tanh every tick would
  // break the closed-form semigroup (double-tanh != single-tanh); restricting it
  // to the out-of-range case keeps advance(advance(s,a),b)==advance(s,a+b) exact
  // for in-range moods while still avoiding saturation-stick at the extremes.
  for (let i = 0; i < 3; i++) if (m[i] > 1 || m[i] < -1) m[i] = Math.tanh(m[i]);

  // STEP 6 — ENERGY (two-process), recomputed not stored.
  const energy = computeEnergy(s, { timezone: ctx.timezone, chronotype: ctx.chronotype }, clock, k);

  // STEP 7 — CLOSENESS decay once/day toward floor (skipped in memorial mode).
  let c = s.closeness;
  const today = localDateStr(clock, ctx.timezone);
  if (ctx.decayEnabled && ctx.mode !== 'memorial' && s.lastDecayDay !== today) {
    const daysIdle = Math.max(0, daysSince(ctx.lastUserAt, clock) - 2); // 2-day grace
    if (daysIdle > 0) {
      const tau = k.tau0_days + k.alpha_strength * s.peakCloseness; // strong bonds fade slower
      const floor = k.eta_floor_reconnect;
      c = floor + (c - floor) * Math.exp(-daysIdle / tau);
    }
  }

  const mood: PAD = { P: m[0], A: m[1], D: m[2] };
  return {
    ...s,
    moodP: m[0],
    moodA: m[1],
    moodD: m[2],
    emotions: JSON.stringify(em),
    closeness: c,
    lastDecayDay: today,
    stateAt: clock.now(),
    _derived: { energy, mood, octant: octantLabel(mood), centerI },
  };
}

// ----------------------------------------------------------------------------
// appraise — event -> active-emotion impulse (NO LLM; rule table) (§3).
// ----------------------------------------------------------------------------

export interface AppraisalEvent {
  type: keyof typeof PAD_DIR | string;
  base: number; // base intensity [0,1]
  outcome?: number; // observed outcome (for surprise term)
  expected?: number; // expected outcome
}

export function appraise(
  event: AppraisalEvent,
  passport: { ocean: { N: number } },
  _closeness: number,
  clock: Clock,
  k: KConstants = K,
): ActiveEmotion {
  // ocean.N here is SLIDER space 0..100 (Passport.ocean). Map to [0,1].
  const N = clamp01(passport.ocean.N / 100);
  const gain = 1 + k.gain_neuro * N;
  const outcome = typeof event.outcome === 'number' ? event.outcome : 0;
  const expected = typeof event.expected === 'number' ? event.expected : 0;
  const surprise = 1 + k.lambda_surprise * Math.abs(outcome - expected);
  const I = clamp01(event.base * surprise * gain);
  const dir = PAD_DIR[event.type] ?? [0, 0, 0];
  const [p, a, d] = dir;
  const H =
    event.type === 'resentment'
      ? k.H_emotion_slow
      : p > 0
        ? k.H_emotion_pos
        : k.H_emotion_neg;
  return {
    type: event.type,
    intensity: I,
    p,
    a,
    d,
    halflifeMin: H,
    createdAt: clock.now().toISOString(),
  };
}

/** Push an appraised emotion into a state's emotion list (cap intensity). */
export function pushEmotion(s: StateView, e: ActiveEmotion): StateView {
  const em = parseEmotions(s.emotions);
  em.push({ ...e, intensity: clamp01(e.intensity) });
  // keep the list bounded (drop the oldest negligible ones first)
  const trimmed = em
    .filter((x) => x.intensity >= 0.02)
    .slice(-16);
  return { ...s, emotions: JSON.stringify(trimmed) };
}

// ----------------------------------------------------------------------------
// CLOSENESS model (design spec §5). Pure deltas; the service writes AffectEvent.
// ----------------------------------------------------------------------------

export interface ExchangeFeatures {
  /** depth ∈ [0.3,1.0] — emotional disclosure > facts. */
  depth: number;
  /** reciprocity ∈ {0.7 low-effort, 1.0 normal, 1.5 replied-to-nudge}. */
  reciprocity: number;
  /** gap in days since lastUserAt (for the re-engagement bonus). */
  gapDays: number;
  /** modality depth multiplier (voice 1.3, photo 1.4, long heartfelt 1.2). */
  modalityMult?: number;
  /** closeness already gained today (for the daily cap). */
  gainedToday?: number;
}

/**
 * Per-exchange closeness gain (Reis & Shaver IPMI). Weights emotional DEPTH /
 * disclosure, NOT sentiment valence — a sad heartfelt message INCREASES closeness.
 * Diminishing returns via (1 - c/100); re-engagement bonus rewards return.
 * Returns the clamped delta to apply (respecting the daily cap).
 */
export function closenessGain(
  c: number,
  f: ExchangeFeatures,
  k: KConstants = K,
): number {
  const depth = clamp(f.depth * (f.modalityMult ?? 1), 0.3, 1.0);
  let delta = k.k_up * depth * f.reciprocity * (1 - c / 100);
  // RE-ENGAGEMENT bonus: first message after a >3-day gap (reward, never punish).
  if (f.gapDays > 3) delta += Math.min(8, 1.5 * f.gapDays);
  // DAILY GAIN CAP (Replika anti-grind / love-bombing whiplash guard).
  const gainedToday = Math.max(0, f.gainedToday ?? 0);
  const remaining = Math.max(0, k.dailyGainCap - gainedToday);
  return clamp(delta, 0, remaining);
}

/**
 * Stage tiers (Social Penetration ladder) with HYSTERESIS to prevent flicker.
 * Advance only when c > threshold+5; regress only when c < threshold-5.
 * `pinnedMaxStage` is a hard CEILING the auto-stage can never exceed.
 */
const STAGE_THRESHOLDS = [25, 45, 70, 90]; // boundaries for stages 1->2,2->3,3->4,4->5
export function classifyStage(c: number, prev: number, pinnedMaxStage = 5): number {
  let stage = clamp(Math.round(prev) || 1, 1, 5);
  // try to advance
  while (stage < 5 && c > STAGE_THRESHOLDS[stage - 1] + 5) stage++;
  // try to regress
  while (stage > 1 && c < STAGE_THRESHOLDS[stage - 2] - 5) stage--;
  return clamp(Math.min(stage, pinnedMaxStage), 1, 5);
}

// ----------------------------------------------------------------------------
// Seeded RNG — mulberry32(fnv1a(seed)). Same day reproducible, differs day-to-day.
// (Reuses the FNV-1a algorithm already in personas.service.ts.)
// ----------------------------------------------------------------------------

export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Day-stable seeded rng: mulberry32(fnv1a(`${personaId}:${localDate}`)). */
export function dayRng(personaId: string, localDate: string): Rng {
  return mulberry32(fnv1a(`${personaId}:${localDate}`));
}

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

export function parseEmotions(raw: string | null | undefined): ActiveEmotion[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (e): e is ActiveEmotion =>
        !!e && typeof e === 'object' && typeof (e as ActiveEmotion).intensity === 'number',
    );
  } catch {
    return [];
  }
}

/** Energy descriptor bucket for the prompt (groggy<0.3 / low<0.5 / ok<0.7 / lively). */
export function energyDescriptor(energy: number): string {
  if (energy < 0.3) return 'groggy';
  if (energy < 0.5) return 'a bit tired';
  if (energy < 0.7) return 'ok';
  return 'lively';
}
