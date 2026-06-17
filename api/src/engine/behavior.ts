// Echo — Phase 3 Behavior Layer (PURE micro-behavior functions).
//
// Binding source: docs/specs/2026-06-16-living-persona-design.md §6 (the exact
// probability functions / constants) + FEATURES_V12_BEHAVIOR.md. Every function
// here is PURE: NO Date.now(), NO Math.random() inside — the seeded rng is
// INJECTED so a given persona-day is reproducible and unit-testable. These turn
// the live State snapshot + Passport knobs + message-type into OBSERVABLE
// texting micro-behaviors (latency, burst, length, emoji, self-correction,
// 'seen'). ZERO LLM cost; the LLM only renders text.
//
// THE #1 LEVER (Beyond Words, arXiv 2510.08912): delay ALONE reads "dumb";
// delay + a VISIBLE SELF-CORRECTION (type->backspace->fix) reads "natural".
// So: state-driven delay + occasional visible correction; NEVER uncorrected typos.

import { clamp, clamp01, resolveK, type KConstants, type Rng } from './state';
import type { CharacterPassport } from './passport';

// ----------------------------------------------------------------------------
// Inputs
// ----------------------------------------------------------------------------

/** The slim live-state view the behavior functions read (from StateSnapshot). */
export interface BehaviorState {
  /** mood pleasure axis [-1,1] (valence). */
  moodP: number;
  /** mood arousal axis [-1,1]. */
  moodA: number;
  /** energy [0,1] (two-process). */
  energy: number;
  /** closeness [0,100]. */
  closeness: number;
  /** live closeness stage 1..5 (already capped by pinnedMaxStage). */
  stage: number;
  /** current agenda block busy (work/commute/...) — drives the busy override. */
  busy: boolean;
  /** she is asleep / in the sleep block — drives the busy override long tail. */
  asleep: boolean;
  /** minutes until the current (busy/sleep) block ends — believable long tail. */
  minsUntilBlockEnds: number;
}

/** Inbound message classification that conditions every behavior draw. */
export type MsgType = 'emotional' | 'question' | 'banter' | 'logistics' | 'normal';

export interface MsgFeatures {
  type: MsgType;
  /** the user just replied to an unread proactive nudge / a plain acknowledgement. */
  isAck?: boolean;
  /** a breaking-news / exciting-event flag bumps burst λ (rare). */
  newsFlag?: boolean;
}

/** Behavior coefficients read off the Passport knobs (0..100 -> [0,1]) + OCEAN. */
export interface BehaviorKnobs {
  extraversion: number; // OCEAN E, [0,1]
  agreeableness: number; // OCEAN A, [0,1]
  /** knobs.typoTendency [0,1] — scales P(visible self-correction), NOT typos. */
  typoTendency: number;
  /** knobs.expressiveness [0,1] — bumps emoji count. */
  expressiveness: number;
  /** knobs.talkativeness [0,1] — bumps burst λ + length mean. */
  talkativeness: number;
  /** knobs.readReceipts gating mode. */
  readReceipts: 'off' | 'close-only' | 'always';
  /** female personas have a slightly higher emoji baseline (research). */
  femaleBias: boolean;
}

// ----------------------------------------------------------------------------
// Knob extraction — map a Passport to BehaviorKnobs (defaults when absent).
// ----------------------------------------------------------------------------

export function knobsFromPassport(
  passport: CharacterPassport | null | undefined,
  gender?: string | null,
): BehaviorKnobs {
  const k = passport?.knobs;
  const o = passport?.ocean;
  return {
    extraversion: o ? clamp01(o.E / 100) : 0.5,
    agreeableness: o ? clamp01(o.A / 100) : 0.5,
    typoTendency: k ? clamp01(k.typoTendency / 100) : 0.3,
    expressiveness: k ? clamp01(k.expressiveness / 100) : 0.5,
    talkativeness: k ? clamp01(k.talkativeness / 100) : 0.5,
    readReceipts: k?.readReceipts ?? 'close-only',
    femaleBias: (gender ?? '').toLowerCase().startsWith('f'),
  };
}

// ----------------------------------------------------------------------------
// math helpers (local; mirror the engine's clamp utilities)
// ----------------------------------------------------------------------------

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Standard-normal draw via Box–Muller from two seeded uniforms. */
function gaussian(rng: Rng, mean: number, sd: number): number {
  let u1 = rng();
  if (u1 < 1e-12) u1 = 1e-12;
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + sd * z;
}

/** Knuth Poisson sampler (small λ — k is then clamped low anyway). */
function poisson(rng: Rng, lambda: number): number {
  const L = Math.exp(-Math.max(0, lambda));
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L && k < 64);
  return k - 1;
}

/** Gamma(shape k, scale θ) via Marsaglia & Tsang (k>=1) / boost for k<1. */
function gamma(rng: Rng, shape: number, scale: number): number {
  if (shape < 1) {
    const g = gamma(rng, shape + 1, scale);
    let u = rng();
    if (u < 1e-12) u = 1e-12;
    return g * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = gaussian(rng, 0, 1);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    let u = rng();
    if (u < 1e-12) u = 1e-12;
    if (u < 1 - 0.0331 * x * x * x * x) return d * v * scale;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}

// ----------------------------------------------------------------------------
// 1) REPLY LATENCY (two-phase, heavy-tailed — §6.1)
//    gap = ACKNOWLEDGE (log-normal) + COMPOSE (chars-driven typing).
//    BUSY OVERRIDE: in a busy/asleep block, acknowledge = time-until-block-ends
//    (the believable "she has her own life" long tail). <250ms only for instant
//    emoji reactions to signal strong connection.
// ----------------------------------------------------------------------------

export interface LatencyConstants {
  /** base μ of the acknowledge log-normal (natural log of seconds). */
  baseMu: number;
  sigma: number; // 0.9
  a: number; // closeness coefficient (0.6)
  b: number; // energy coefficient (0.4)
  ackMinMs: number; // 2s clamp
  ackMaxMs: number; // 1800s clamp
}

export const LAT: LatencyConstants = {
  baseMu: 2.6, // exp(2.6) ≈ 13.5s median present+neutral
  sigma: 0.9,
  a: 0.6,
  b: 0.4,
  ackMinMs: 2000,
  ackMaxMs: 1_800_000,
};

export interface ReplyLatency {
  acknowledgeMs: number;
  composeMs: number;
  /** true when the acknowledge tail came from the agenda (busy/asleep), not rng. */
  busyOverride: boolean;
}

export function replyLatency(
  state: BehaviorState,
  knobs: BehaviorKnobs,
  msg: MsgFeatures,
  chars: number,
  rng: Rng,
  lat: LatencyConstants = LAT,
): ReplyLatency {
  // --- COMPOSE: chars · (1000/cps) · energyFactor; WPM~N(38,8) clamp[25,90]. ---
  const wpm = clamp(gaussian(rng, 38, 8), 25, 90);
  const cps = (wpm * 5) / 60; // chars per second
  // energyFactor ∈ [0.8 high-E .. 1.6 tired]: tired => slower thumbs.
  const energyFactor = 1.6 - 0.8 * clamp01(state.energy);
  const composeMs = Math.max(0, Math.round((Math.max(0, chars) * (1000 / cps)) * energyFactor));

  // --- INSTANT emoji reaction: <250ms, signals strong connection (close only). ---
  if (msg.type === 'banter' || msg.isAck) {
    // (the caller decides whether to actually emit an emoji-only reaction; this
    // just allows the sub-250ms fast lane when one is fired downstream.)
  }

  // --- BUSY OVERRIDE: acknowledge = time-until-block-ends (agenda, not rng). ---
  if (state.asleep || state.busy) {
    const tail = Math.max(0, Math.round(state.minsUntilBlockEnds * 60_000));
    // Still clamp to the absolute ceiling so a 6h sleep block doesn't produce an
    // absurd single timer; the frontend pacer also caps its own wait.
    const acknowledgeMs = clamp(tail, lat.ackMinMs, lat.ackMaxMs);
    return { acknowledgeMs, composeMs, busyOverride: true };
  }

  // --- ACKNOWLEDGE: clamp(exp(μ + σ·Z), 2s, 1800s); μ reduced by closeness+E. ---
  const mu = lat.baseMu - lat.a * (state.closeness / 100) - lat.b * clamp01(state.energy);
  const z = gaussian(rng, 0, 1);
  const draw = Math.exp(mu + lat.sigma * z) * 1000; // -> ms
  const acknowledgeMs = clamp(Math.round(draw), lat.ackMinMs, lat.ackMaxMs);
  return { acknowledgeMs, composeMs, busyOverride: false };
}

// ----------------------------------------------------------------------------
// 2) BURST / DOUBLE-TEXT count (§6.2)
//    k = 1 + Poisson(λ), λ = 0.3 + 0.7·arousal + 0.4·extraversion + 0.8·news,
//    clamp k ≤ 4. Low arousal -> single bubble.
// ----------------------------------------------------------------------------

export function burstCount(
  state: BehaviorState,
  knobs: BehaviorKnobs,
  msg: MsgFeatures,
  rng: Rng,
): number {
  // arousal axis [-1,1] -> [0,1] for the λ term.
  const arousal01 = clamp01((state.moodA + 1) / 2);
  // talkativeness gently nudges extraversion's contribution.
  const extra = clamp01(0.5 * knobs.extraversion + 0.5 * knobs.talkativeness);
  const lambda = 0.3 + 0.7 * arousal01 + 0.4 * extra + 0.8 * (msg.newsFlag ? 1 : 0);
  const k = 1 + poisson(rng, lambda);
  return clamp(k, 1, 4);
}

// ----------------------------------------------------------------------------
// 3) MESSAGE LENGTH hint (§6.3) — target words, surfaced as a SOFT directive.
//    len_words ~ Gamma, mean = 8·(0.6+0.8·E)·(0.7+0.6·extraversion)·typeMult.
//    Low energy compresses to 1-3 words; cap ~40. NOT a hard truncate.
// ----------------------------------------------------------------------------

const TYPE_MULT: Record<MsgType, number> = {
  emotional: 1.6,
  question: 1.0,
  banter: 0.6,
  logistics: 0.8,
  normal: 1.0,
};

export function replyLengthHint(
  state: BehaviorState,
  knobs: BehaviorKnobs,
  msg: MsgFeatures,
  rng?: Rng,
): number {
  const E = clamp01(state.energy);
  const extra = clamp01(0.6 * knobs.extraversion + 0.4 * knobs.talkativeness);
  const typeMult = TYPE_MULT[msg.type] ?? 1.0;
  const mean = 8 * (0.6 + 0.8 * E) * (0.7 + 0.6 * extra) * typeMult;
  // Sample around the mean when an rng is supplied (variance per message); the
  // expected value IS the mean so the deterministic (no-rng) path is the mean.
  let words = mean;
  if (rng) {
    const shape = 4; // moderate dispersion (CV = 1/sqrt(4) = 0.5)
    const scale = mean / shape;
    words = gamma(rng, shape, scale);
  }
  return clamp(Math.round(words), 1, 40);
}

// ----------------------------------------------------------------------------
// 4) EMOJI POLICY (§6.4)
//    P(emoji)=σ(−1.2 +1.8·c +1.0·valence +0.8·agreeableness +0.7·banter −1.5·logistics)
//    P(emoji-only)=0.12·banter_or_ack·c·(1−emotional) FORCED 0 on emotional / question.
// ----------------------------------------------------------------------------

export interface EmojiPolicy {
  pEmoji: number;
  pEmojiOnlyReaction: number;
  /** count|present ~ 1 + Poisson(0.4·arousal). Surfaced for the renderer. */
  emojiCountHint: number;
}

export function emojiPolicy(
  state: BehaviorState,
  knobs: BehaviorKnobs,
  msg: MsgFeatures,
  rng?: Rng,
): EmojiPolicy {
  const c = clamp01(state.closeness / 100);
  const valence = clamp(state.moodP, -1, 1);
  const isBanter = msg.type === 'banter' ? 1 : 0;
  const isLogistics = msg.type === 'logistics' ? 1 : 0;
  const isEmotional = msg.type === 'emotional' ? 1 : 0;
  const isQuestion = msg.type === 'question' ? 1 : 0;

  let z =
    -1.2 +
    1.8 * c +
    1.0 * valence +
    0.8 * knobs.agreeableness +
    0.7 * isBanter -
    1.5 * isLogistics;
  // expressiveness knob + female baseline lift the curve a touch.
  z += 0.6 * (knobs.expressiveness - 0.5) + (knobs.femaleBias ? 0.25 : 0);
  const pEmoji = clamp01(sigmoid(z));

  // P(emoji-ONLY reaction): banter/ack only, scaled by closeness, killed by
  // emotional-disclosure OR a direct question (cold/uncanny otherwise).
  const banterOrAck = isBanter || msg.isAck ? 1 : 0;
  let pEmojiOnly = 0.12 * banterOrAck * c * (1 - isEmotional);
  if (isEmotional || isQuestion) pEmojiOnly = 0; // FORCED 0

  // count|present ~ 1 + Poisson(0.4·arousal)
  const arousal01 = clamp01((state.moodA + 1) / 2);
  const emojiCountHint = rng
    ? clamp(1 + poisson(rng, 0.4 * arousal01), 1, 4)
    : Math.round(1 + 0.4 * arousal01);

  return { pEmoji, pEmojiOnlyReaction: clamp01(pEmojiOnly), emojiCountHint };
}

// ----------------------------------------------------------------------------
// 5) VISIBLE SELF-CORRECTION (§6.5) — the high-value behavior.
//    P = clamp(0.05 + 0.07·(len>12) + 0.04·high_arousal, 0, 0.15), scaled by the
//    typoTendency knob. Operate on ONE word; never random chars; FINAL TEXT has
//    NO typo (the correction is purely a render-time animation of a real word).
// ----------------------------------------------------------------------------

export interface SelfCorrection {
  /** which output bubble carries the correction (caller maps to an index). */
  bubbleIndex: number;
  /** the partially-typed (intentionally-misspelt) word the user briefly sees. */
  typedPartial: string;
  /** how many chars to backspace before the fix. */
  backspaceN: number;
  /** the CORRECT word that lands in the final text (no typo ever persists). */
  finalWord: string;
}

const P_CORRECT_BASE = 0.05;
const P_CORRECT_LEN = 0.07;
const P_CORRECT_AROUSAL = 0.04;
const P_CORRECT_CAP = 0.15;

/**
 * Probability of a visible self-correction for a reply of `chars` length at the
 * current arousal, scaled by the persona's typoTendency knob (1.0 == nominal).
 */
export function pSelfCorrection(state: BehaviorState, knobs: BehaviorKnobs, chars: number): number {
  const highArousal = clamp01((state.moodA + 1) / 2) > 0.66 ? 1 : 0;
  const base = P_CORRECT_BASE + P_CORRECT_LEN * (chars > 12 ? 1 : 0) + P_CORRECT_AROUSAL * highArousal;
  // typoTendency 0..1 scales around its 0.3 default (so default ≈ unchanged).
  const scale = 0.5 + (knobs.typoTendency / 0.3) * 0.5; // 0.5 @0 .. 1.0 @0.3 .. ~2.2 @1
  return clamp(base * clamp(scale, 0.3, 2.0), 0, P_CORRECT_CAP);
}

/**
 * Decide + build a self-correction for the chosen bubble's TEXT. Picks ONE real
 * word from `bubbleText`, fabricates a believable single-char typo of it (a
 * transposition or an adjacent-key swap — never random gibberish), and returns
 * the type/backspace/fix ops. The FINAL text is the caller's untouched text — we
 * never mutate it, so an uncorrected typo can never ship. Returns null when the
 * probability coin doesn't fire or no correctable word exists.
 */
export function selfCorrection(
  state: BehaviorState,
  knobs: BehaviorKnobs,
  bubbleText: string,
  bubbleIndex: number,
  rng: Rng,
): SelfCorrection | null {
  const chars = bubbleText.length;
  const p = pSelfCorrection(state, knobs, chars);
  if (rng() >= p) return null;

  // Pick a correctable word: length >= 4, alphabetic, not the very first token
  // (a mid-sentence stumble reads more natural). Choose deterministically via rng.
  const wordRe = /[\p{L}]{4,}/gu;
  const words: { word: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = wordRe.exec(bubbleText))) words.push({ word: m[0] });
  if (!words.length) return null;
  const pick = words[Math.floor(rng() * words.length)];
  const finalWord = pick.word;

  const typedPartial = makeTypo(finalWord, rng);
  if (typedPartial === finalWord) return null; // couldn't fabricate a distinct typo

  return {
    bubbleIndex,
    typedPartial,
    backspaceN: typedPartial.length, // delete the wrong word, retype the right one
    finalWord,
  };
}

/**
 * Fabricate ONE believable single-edit typo of `word`: adjacent-char
 * transposition (preferred) or a doubled letter. NEVER random characters — the
 * goal is the "oops, fixed it" cue, and the corrected word is always the real one.
 */
export function makeTypo(word: string, rng: Rng): string {
  const chars = [...word];
  if (chars.length < 4) return word;
  // 50/50: transpose two adjacent middle chars, or double a middle char.
  if (rng() < 0.6) {
    // transposition of i and i+1 (avoid the first char so it reads natural)
    const i = 1 + Math.floor(rng() * (chars.length - 2));
    if (chars[i] === chars[i + 1]) return doubleChar(chars, rng); // no visible change
    const tmp = chars[i];
    chars[i] = chars[i + 1];
    chars[i + 1] = tmp;
    return chars.join('');
  }
  return doubleChar(chars, rng);
}

function doubleChar(chars: string[], rng: Rng): string {
  const i = 1 + Math.floor(rng() * (chars.length - 1));
  return [...chars.slice(0, i), chars[i - 1], ...chars.slice(i)].join('');
}

// ----------------------------------------------------------------------------
// 6) "SEEN" RECEIPTS (§6.6) — closeness-gated to avoid "left on read" anxiety.
//    Show 'seen' only when a reply is imminent OR closeness stage >= 3. The knob
//    readReceipts can FORCE off / always.
// 7) TYPING-THEN-STOP (§6.7) — P < 0.05, stage >= 4 only (rare hesitation cue).
// ----------------------------------------------------------------------------

export interface SeenPolicy {
  showSeen: boolean;
  typingThenStop: boolean;
}

const P_TYPING_THEN_STOP = 0.04; // < 0.05

export function seenPolicy(
  state: BehaviorState,
  knobs: BehaviorKnobs,
  opts: { replyImminent?: boolean } = {},
  rng?: Rng,
): SeenPolicy {
  let showSeen: boolean;
  switch (knobs.readReceipts) {
    case 'off':
      showSeen = false;
      break;
    case 'always':
      showSeen = true;
      break;
    case 'close-only':
    default:
      showSeen = Boolean(opts.replyImminent) || state.stage >= 3;
      break;
  }

  // typing-then-stop: stage >= 4 only, and rare (a hesitation cue). Frequent use
  // induces real anxiety (same mechanism as read-receipt dread) — keep it tiny.
  let typingThenStop = false;
  if (state.stage >= 4 && rng) typingThenStop = rng() < P_TYPING_THEN_STOP;

  return { showSeen, typingThenStop };
}

// ----------------------------------------------------------------------------
// COMPOSITE — the full per-turn behavior decision the chat SSE emits.
// One call computes everything off ONE rng stream so a persona-day is stable.
// ----------------------------------------------------------------------------

export interface BehaviorEvent {
  /** read-delay (acknowledge) before the first typing indicator, ms. */
  readDelayMs: number;
  /** per-bubble typing duration (compose) in ms, one entry per bubble. */
  perBubbleTyping: number[];
  /** inter-bubble gaps in ms (length = bubbleCount-1). */
  gapMs: number[];
  bubbleCount: number;
  /** true when the long acknowledge came from the agenda (busy/asleep). */
  busyOverride: boolean;
  /** soft word target surfaced to the LLM ("keep it ~N words"). */
  replyLengthHint: number;
  /** P(emoji) / P(emoji-only) for this turn (caller rolls the emoji-only coin). */
  emoji: EmojiPolicy;
  seen: SeenPolicy;
}

export interface ComputeBehaviorOpts {
  /** total character estimate of the planned reply (for compose timing). */
  estChars?: number;
  replyImminent?: boolean;
}

/**
 * Compute the whole per-turn behavior bundle from the live state + knobs + the
 * inbound message. The rng is the day-stable seeded stream; draws are sequenced
 * so the same (persona, day, turn) reproduces. Pure — no clock, no Math.random.
 */
export function computeBehavior(
  state: BehaviorState,
  knobs: BehaviorKnobs,
  msg: MsgFeatures,
  rng: Rng,
  opts: ComputeBehaviorOpts = {},
): BehaviorEvent {
  const bubbleCount = burstCount(state, knobs, msg, rng);
  const lengthHint = replyLengthHint(state, knobs, msg, rng);

  // Distribute the character estimate across bubbles for per-bubble compose time.
  const estChars = Math.max(1, Math.round(opts.estChars ?? lengthHint * 5.5));
  const perBubbleChars = Math.max(1, Math.round(estChars / bubbleCount));

  const lat = replyLatency(state, knobs, msg, perBubbleChars, rng);
  const perBubbleTyping: number[] = [];
  for (let i = 0; i < bubbleCount; i++) {
    // re-draw WPM jitter per bubble so typing speed varies (anti "too perfect").
    const l = replyLatency(state, knobs, msg, perBubbleChars, rng);
    perBubbleTyping.push(l.composeMs);
  }
  // inter-bubble gaps: short pauses between sends, longer when tired.
  const gapMs: number[] = [];
  for (let i = 0; i < bubbleCount - 1; i++) {
    const base = 500 + 1500 * (1.6 - 0.8 * clamp01(state.energy) - 0.8);
    gapMs.push(Math.max(250, Math.round(base + gaussian(rng, 0, 300))));
  }

  const emoji = emojiPolicy(state, knobs, msg, rng);
  const seen = seenPolicy(state, knobs, { ...(opts.replyImminent !== undefined ? { replyImminent: opts.replyImminent } : {}) }, rng);

  return {
    readDelayMs: lat.acknowledgeMs,
    perBubbleTyping,
    gapMs,
    bubbleCount,
    busyOverride: lat.busyOverride,
    replyLengthHint: lengthHint,
    emoji,
    seen,
  };
}

// ----------------------------------------------------------------------------
// MESSAGE-TYPE classification — cheap, lexicon-free heuristic of the inbound
// turn. Emotional-disclosure and direct-question detection MUST be reliable
// (they force emoji-only to 0). Reuses simple punctuation + length signals; the
// richer UA/RU/EN feeling lexicon lives in appraisal.ts (passed via emotionalHint).
// ----------------------------------------------------------------------------

export function classifyMsgType(
  text: string,
  opts: { emotionalHint?: boolean; isAck?: boolean; newsFlag?: boolean } = {},
): MsgFeatures {
  const t = (text ?? '').trim();
  const lower = t.toLowerCase();
  const words = t ? t.split(/\s+/).length : 0;

  // A direct question: ends with '?' or starts with a wh-/yes-no opener.
  const isQuestion =
    /\?\s*$/.test(t) ||
    /^(who|what|when|where|why|how|do|did|are|is|can|could|would|will|хто|що|коли|де|чому|як|чи|ты|вы|когда|почему)\b/i.test(
      lower,
    );

  // logistics: schedule/where/time/plan words.
  const isLogistics =
    /\b(meet|when|where|time|tomorrow|today|address|call|send|pay|order|book|зустр|коли|де|завтра|сьогодні|адрес|подзвон)\b/i.test(
      lower,
    ) && words <= 14;

  // emotional disclosure: the caller's lexicon hint wins; otherwise long+first-person.
  const emotional = Boolean(opts.emotionalHint);

  let type: MsgType = 'normal';
  if (emotional) type = 'emotional';
  else if (isQuestion) type = 'question';
  else if (isLogistics) type = 'logistics';
  else if (words <= 4) type = 'banter';

  return {
    type,
    ...(opts.isAck ? { isAck: true } : {}),
    ...(opts.newsFlag ? { newsFlag: true } : {}),
  };
}

// ----------------------------------------------------------------------------
// Per-persona K passthrough — behavior latency constants can be overridden via
// Passport.tuning the same way the state engine's K is (redis-config A/B pattern).
// Keys: latency_baseMu, latency_sigma, latency_a, latency_b. Omitted -> defaults.
// ----------------------------------------------------------------------------

export function resolveLatency(passport: CharacterPassport | null | undefined): LatencyConstants {
  const t = (passport as { tuning?: Record<string, number> } | null | undefined)?.tuning;
  if (!t) return LAT;
  const num = (k: string, d: number): number =>
    typeof t[k] === 'number' && Number.isFinite(t[k]) ? (t[k] as number) : d;
  return {
    baseMu: num('latency_baseMu', LAT.baseMu),
    sigma: num('latency_sigma', LAT.sigma),
    a: num('latency_a', LAT.a),
    b: num('latency_b', LAT.b),
    ackMinMs: LAT.ackMinMs,
    ackMaxMs: LAT.ackMaxMs,
  };
}

// Re-export so callers building a per-day rng also honor passport K (state engine).
export function kForPassport(passport: CharacterPassport | null | undefined): KConstants {
  return resolveK(passport ?? null);
}
