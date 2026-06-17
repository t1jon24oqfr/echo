// Echo — Character Passport (Phase 1).
//
// Canonical, versioned, user-editable character definition stored as JSON on
// Persona.passport. The SINGLE tunable source the prompt assembler reads.
// Phase 1 ships: the type, oceanToBaseline() (Mehrabian regression, EXACTLY per
// design spec §3), octantLabel() (deadzone classifier per §3), default knobs,
// normalizePassport() (fills defaults + recomputes baselinePAD when ocean is
// present), and the mode invariants (§ relationship seeds).
//
// NO state engine / energy / closeness evolution here — those are Phases 2-3.

export type Provenance = 'auto' | 'edited';

export interface Ocean {
  /** Each 0..100 (slider space). Mapped to [-1,1] before the Mehrabian formula. */
  O: number;
  C: number;
  E: number;
  A: number;
  N: number;
}

export interface PAD {
  P: number; // pleasure [-1,1]
  A: number; // arousal [-1,1]
  D: number; // dominance [-1,1]
}

export interface Chronotype {
  /** MSF mid-sleep-on-free-days, hours (2.5 lark .. 7.5 owl). */
  MSF: number;
  sleepDurationH: number; // 6..9
}

export interface RoutineBlock {
  dow?: 'weekday' | 'weekend' | number; // optional day-of-week scope
  label: string;
  approxStart: string; // "HH:MM" local
  approxDur: number; // minutes
  busy: boolean;
  valence: number; // [-1,1]
  arousal: number; // [-1,1]
}

export interface Relationship {
  closenessSeed: number; // 40 reconnect | 70 memorial
  pinnedMaxStage: number; // 1..5 — CEILING the user controls
  decayEnabled: boolean; // FORCED false in memorial mode
  proactivityScale: number; // 0.5..2.0
}

export interface Boundaries {
  paused: boolean; // 'right to retire' — mutes proactivity, framed as rest
  proactivityDailyCap: number; // hard cap (4)
  quietHours?: { start: number; end: number }; // optional explicit override
}

export interface Knobs {
  talkativeness: number; // 0..100
  warmth: number;
  expressiveness: number;
  moodReactivity: number;
  moodStability: number;
  initiative: number;
  typoTendency: number;
  readReceipts: 'off' | 'close-only' | 'always';
}

export interface CharacterPassport {
  // --- IDENTITY ---
  name: string;
  relationshipToUser: string;
  occupation: string;
  locale: string;
  timezone: string; // IANA
  mode: 'memorial' | 'reconnect';

  // --- VOICE / STYLE (mirrored from CorpusStats + PersonaCard) ---
  speechStyle: string[];
  languageMixNotes: string;
  emojiAndPunctuation: string;
  medianWords: number;
  emojiPerMessage: number;
  burstAvg: number;
  topEmoji: string[];

  // --- PERSONALITY ---
  ocean: Ocean; // sliders 0..100
  baselinePAD: PAD; // derived from ocean via oceanToBaseline (cached)
  baselineOverride?: PAD; // power-user direct override

  // --- CHRONOTYPE / SLEEP ---
  chronotype: Chronotype;

  // --- WORLD / SCHEDULE SKELETON ---
  routineSkeleton: RoutineBlock[];

  // --- RELATIONSHIP ---
  relationship: Relationship;

  // --- BOUNDARIES / ETHICS ---
  boundaries: Boundaries;

  // --- BEHAVIOR KNOBS ---
  knobs: Knobs;

  // --- LEXICON (optional, multilingual octant phrasing) ---
  octantLexicon?: Record<string, string>;

  // --- TUNABLE CONSTANTS (per-persona overrides of global K; redis-config A/B
  // pattern). Omitted -> the engine uses the global K block. Phase 2: passed to
  // resolveK() in engine/state.ts. Free-form numeric map of K keys. ---
  tuning?: Record<string, number>;

  // --- PROVENANCE / VERSIONING ---
  _provenance: Record<string, Provenance>;
  _version: number;
}

// ----------------------------------------------------------------------------
// Math helpers
// ----------------------------------------------------------------------------

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Slider 0..100 -> [-1,1] (the space the Mehrabian regression expects). */
function slider01ToSigned(v: number): number {
  return clamp((v - 50) / 50, -1, 1);
}

// ----------------------------------------------------------------------------
// OCEAN -> baseline PAD (Mehrabian 1996) — EXACTLY per design spec §3.
// Input o = {O,C,E,A,N}, each ALREADY in [-1,1]. ×0.5 scale + clamp.
// ----------------------------------------------------------------------------

export function oceanToBaseline(o: Ocean): PAD {
  let P = 0.21 * o.E + 0.59 * o.A + 0.19 * o.N;
  let A = 0.15 * o.O + 0.3 * o.A - 0.57 * o.N;
  let D = 0.25 * o.O + 0.17 * o.C + 0.6 * o.E - 0.32 * o.A;
  return {
    P: clamp(0.5 * P, -1, 1),
    A: clamp(0.5 * A, -1, 1),
    D: clamp(0.5 * D, -1, 1),
  };
}

/** Convenience: take ocean in SLIDER space (0..100) and produce baseline PAD. */
export function baselineFromOceanSliders(ocean: Ocean): PAD {
  return oceanToBaseline({
    O: slider01ToSigned(ocean.O),
    C: slider01ToSigned(ocean.C),
    E: slider01ToSigned(ocean.E),
    A: slider01ToSigned(ocean.A),
    N: slider01ToSigned(ocean.N),
  });
}

// ----------------------------------------------------------------------------
// mood -> octant label (deadzone classifier, theta=0.15) — per design spec §3.
// ----------------------------------------------------------------------------

const OCTANT_TABLE: Record<string, string> = {
  '1,1,1': 'exuberant',
  '-1,-1,-1': 'bored',
  '1,1,-1': 'dependent',
  '-1,-1,1': 'disdainful',
  '1,-1,1': 'relaxed',
  '-1,1,-1': 'anxious',
  '1,-1,-1': 'docile',
  '-1,1,1': 'hostile',
};

export function octantLabel(m: PAD): { label: string; adverb: string } {
  const th = 0.15;
  const sgn = (x: number): number => (x > th ? 1 : x < -th ? -1 : 0);
  const key = `${sgn(m.P)},${sgn(m.A)},${sgn(m.D)}`;
  const label = OCTANT_TABLE[key] ?? 'content';
  const mag = Math.hypot(m.P, m.A, m.D) / Math.sqrt(3);
  const adverb = mag < 0.25 ? 'slightly' : mag < 0.55 ? 'quite' : 'very';
  return { label, adverb };
}

// ----------------------------------------------------------------------------
// Relationship register (closeness STAGE keyed; capped by pinnedMaxStage).
// Phase 1 has no live closeness — stage is derived from closenessSeed.
// Tiers (design §5): 1 <25, 2 25–45, 3 45–70, 4 70–90, 5 ≥90.
// ----------------------------------------------------------------------------

export function stageFromCloseness(c: number): number {
  if (c >= 90) return 5;
  if (c >= 70) return 4;
  if (c >= 45) return 3;
  if (c >= 25) return 2;
  return 1;
}

export function relationshipRegister(stage: number): string {
  if (stage <= 2) return 'still getting reacquainted; friendly but not presumptuous';
  if (stage === 3) return 'warm and familiar; casual';
  return 'close; inside-jokes, pet-names OK';
}

// ----------------------------------------------------------------------------
// Defaults
// ----------------------------------------------------------------------------

export function defaultKnobs(): Knobs {
  return {
    talkativeness: 50,
    warmth: 60,
    expressiveness: 50,
    moodReactivity: 50,
    moodStability: 50,
    initiative: 50,
    typoTendency: 30,
    readReceipts: 'close-only',
  };
}

function defaultOcean(): Ocean {
  return { O: 50, C: 50, E: 50, A: 50, N: 50 };
}

function defaultRoutineSkeleton(): RoutineBlock[] {
  return [
    { label: 'morning routine', approxStart: '08:00', approxDur: 90, busy: false, valence: 0.1, arousal: 0.1 },
    { label: 'work / day', approxStart: '09:30', approxDur: 480, busy: true, valence: 0.0, arousal: 0.2 },
    { label: 'evening / free time', approxStart: '18:00', approxDur: 300, busy: false, valence: 0.2, arousal: 0.0 },
    { label: 'wind down', approxStart: '23:00', approxDur: 60, busy: false, valence: 0.1, arousal: -0.3 },
  ];
}

// ----------------------------------------------------------------------------
// Mode invariants (design §5): memorial -> decayEnabled=false, closenessSeed=70;
// reconnect -> decayEnabled=true, closenessSeed=40. Always re-enforced.
// ----------------------------------------------------------------------------

function enforceModeInvariants(rel: Relationship, mode: 'memorial' | 'reconnect'): Relationship {
  if (mode === 'memorial') {
    return { ...rel, decayEnabled: false, closenessSeed: 70 };
  }
  // reconnect: decay enabled; seed defaults to 40 unless the user pinned it.
  return {
    ...rel,
    decayEnabled: rel.decayEnabled ?? true,
    closenessSeed: typeof rel.closenessSeed === 'number' ? rel.closenessSeed : 40,
  };
}

// ----------------------------------------------------------------------------
// normalizePassport — fill defaults from a partial; ALWAYS recompute baselinePAD
// whenever ocean is present; re-enforce mode invariants. Idempotent.
// ----------------------------------------------------------------------------

export function normalizePassport(partial: Partial<CharacterPassport>): CharacterPassport {
  const mode: 'memorial' | 'reconnect' = partial.mode === 'memorial' ? 'memorial' : 'reconnect';

  const ocean: Ocean = { ...defaultOcean(), ...(partial.ocean ?? {}) };
  // baselinePAD is DERIVED — recompute from ocean sliders unless a power-user override exists.
  const baselineOverride = partial.baselineOverride;
  const baselinePAD: PAD = baselineOverride
    ? { P: clamp(baselineOverride.P, -1, 1), A: clamp(baselineOverride.A, -1, 1), D: clamp(baselineOverride.D, -1, 1) }
    : baselineFromOceanSliders(ocean);

  const chronotype: Chronotype = {
    MSF: typeof partial.chronotype?.MSF === 'number' ? clamp(partial.chronotype.MSF, 2.5, 7.5) : 4.5,
    sleepDurationH:
      typeof partial.chronotype?.sleepDurationH === 'number'
        ? clamp(partial.chronotype.sleepDurationH, 6, 9)
        : 7.5,
  };

  const routineSkeleton =
    Array.isArray(partial.routineSkeleton) && partial.routineSkeleton.length
      ? partial.routineSkeleton
      : defaultRoutineSkeleton();

  const relSeed: Relationship = {
    closenessSeed:
      typeof partial.relationship?.closenessSeed === 'number'
        ? clamp(partial.relationship.closenessSeed, 0, 100)
        : mode === 'memorial'
          ? 70
          : 40,
    pinnedMaxStage:
      typeof partial.relationship?.pinnedMaxStage === 'number'
        ? clamp(Math.round(partial.relationship.pinnedMaxStage), 1, 5)
        : 4,
    decayEnabled:
      typeof partial.relationship?.decayEnabled === 'boolean'
        ? partial.relationship.decayEnabled
        : mode !== 'memorial',
    proactivityScale:
      typeof partial.relationship?.proactivityScale === 'number'
        ? clamp(partial.relationship.proactivityScale, 0.5, 2.0)
        : 1.0,
  };
  const relationship = enforceModeInvariants(relSeed, mode);

  const boundaries: Boundaries = {
    paused: Boolean(partial.boundaries?.paused),
    proactivityDailyCap:
      typeof partial.boundaries?.proactivityDailyCap === 'number'
        ? clamp(Math.round(partial.boundaries.proactivityDailyCap), 0, 24)
        : 4,
    ...(partial.boundaries?.quietHours ? { quietHours: partial.boundaries.quietHours } : {}),
  };

  const knobs: Knobs = { ...defaultKnobs(), ...(partial.knobs ?? {}) };
  // readReceipts must be one of the allowed enum values.
  if (!['off', 'close-only', 'always'].includes(knobs.readReceipts)) knobs.readReceipts = 'close-only';

  return {
    name: partial.name ?? '',
    relationshipToUser: partial.relationshipToUser ?? '',
    occupation: partial.occupation ?? '',
    locale: partial.locale ?? '',
    timezone: partial.timezone ?? 'Europe/Kyiv',
    mode,

    speechStyle: Array.isArray(partial.speechStyle) ? partial.speechStyle : [],
    languageMixNotes: partial.languageMixNotes ?? '',
    emojiAndPunctuation: partial.emojiAndPunctuation ?? '',
    medianWords: typeof partial.medianWords === 'number' ? partial.medianWords : 6,
    emojiPerMessage: typeof partial.emojiPerMessage === 'number' ? partial.emojiPerMessage : 0,
    burstAvg: typeof partial.burstAvg === 'number' ? partial.burstAvg : 1,
    topEmoji: Array.isArray(partial.topEmoji) ? partial.topEmoji : [],

    ocean,
    baselinePAD,
    ...(baselineOverride ? { baselineOverride } : {}),

    chronotype,
    routineSkeleton,
    relationship,
    boundaries,
    knobs,
    ...(partial.octantLexicon ? { octantLexicon: partial.octantLexicon } : {}),
    ...(partial.tuning && typeof partial.tuning === 'object' ? { tuning: partial.tuning } : {}),

    _provenance: partial._provenance ?? {},
    _version: typeof partial._version === 'number' ? partial._version : 1,
  };
}

/**
 * Deep-merge a partial patch into a stored passport (shallow per top-level key,
 * with one level of object merge for the nested config objects). Used by PATCH.
 * Returns a NEW object; does not mutate inputs. Re-normalization (and baseline
 * recompute) is the caller's responsibility via normalizePassport().
 */
export function mergePassport(
  base: CharacterPassport,
  patch: Partial<CharacterPassport>,
): Partial<CharacterPassport> {
  const out: Partial<CharacterPassport> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const key = k as keyof CharacterPassport;
    const cur = (base as unknown as Record<string, unknown>)[k];
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      cur &&
      typeof cur === 'object' &&
      !Array.isArray(cur)
    ) {
      (out as Record<string, unknown>)[k] = { ...(cur as object), ...(v as object) };
    } else {
      (out as Record<string, unknown>)[k] = v;
    }
    void key;
  }
  return out;
}

/**
 * Parse a stored passport JSON string into a normalized CharacterPassport.
 * Returns null when the column is empty or unparseable (so the prompt assembler
 * simply omits the passport-driven block). Always normalizes (defaults filled,
 * baselinePAD recomputed) so downstream readers see a complete object.
 */
export function parsePassport(raw: string | null | undefined): CharacterPassport | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Partial<CharacterPassport>;
    if (!obj || typeof obj !== 'object') return null;
    return normalizePassport(obj);
  } catch {
    return null;
  }
}

/**
 * Diff two passports and return the set of top-level field names that changed.
 * Used by PATCH to flip touched fields to provenance 'edited'.
 */
export function changedFields(
  before: Partial<CharacterPassport>,
  after: CharacterPassport,
): string[] {
  const keys: (keyof CharacterPassport)[] = [
    'name',
    'relationshipToUser',
    'occupation',
    'locale',
    'timezone',
    'mode',
    'speechStyle',
    'languageMixNotes',
    'emojiAndPunctuation',
    'medianWords',
    'emojiPerMessage',
    'burstAvg',
    'topEmoji',
    'ocean',
    'baselinePAD',
    'baselineOverride',
    'chronotype',
    'routineSkeleton',
    'relationship',
    'boundaries',
    'knobs',
    'octantLexicon',
  ];
  const changed: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed.push(k);
  }
  return changed;
}
