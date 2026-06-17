// Echo — Phase 2 proactive gate (design spec §5/§9). PURE, LLM-FREE.
//
// The EVERY_MINUTE cron is now a thin gate that decides WHETHER she texts first,
// HUMAN-paced and subordinate to MAX_CONSECUTIVE_PROACTIVE + quiet-hours. The
// opener WORDING is the only LLM touch, generated only when this gate fires.

import type { Rng } from '../engine/state';

export interface ProactiveGateInput {
  /** live closeness [0,100]. */
  closeness: number;
  /** live closeness stage 1..5. */
  stage: number;
  /** live energy [0,1]. */
  energy: number;
  /** she is asleep / in the sleep block (hard skip). */
  asleep: boolean;
  /** current agenda block is busy (work/commute/...) — prefer a free slot. */
  busy: boolean;
  /** hours since the user last wrote (silence). */
  silenceHours: number;
  /** Passport relationship.proactivityScale (0.5..2.0). */
  proactivityScale: number;
  /** Passport boundaries.paused ('right to retire'). */
  paused: boolean;
  /** memorial mode — no living-day proactivity. */
  memorial: boolean;
}

export interface ProactiveDecision {
  send: boolean;
  reason: string;
  /** the human-paced base gap (hours) for the NEXT schedule, for logging/telemetry. */
  baseGapHours: number;
}

/**
 * HUMAN-paced base gap (design §5/§10):
 *   nextGapHours = clamp(20·(1.6 − 0.7·c/100)·proactivityScale, 8, 96)
 * Strong bonds text a little more often; still always 8-96h, never minutes.
 */
export function baseGapHours(closeness: number, proactivityScale: number): number {
  const c = clamp(closeness, 0, 100);
  const scale = clamp(proactivityScale, 0.5, 2.0);
  return clamp(20 * (1.6 - 0.7 * (c / 100)) * scale, 8, 96);
}

/**
 * shouldTextFirst — the gate. Pure (rng injected). Caller has ALREADY enforced
 * MAX_CONSECUTIVE_PROACTIVE and the nextNudgeAt due-time; this adds the
 * state-coherent checks (asleep/paused/memorial/energy) + a Poisson firing coin
 * so the exact minute varies. Returns the base gap for the next reschedule too.
 */
export function shouldTextFirst(inp: ProactiveGateInput, rng: Rng): ProactiveDecision {
  const gap = baseGapHours(inp.closeness, inp.proactivityScale);

  if (inp.memorial) return { send: false, reason: 'memorial', baseGapHours: gap };
  if (inp.paused) return { send: false, reason: 'paused', baseGapHours: gap };
  if (inp.asleep) return { send: false, reason: 'asleep', baseGapHours: gap };
  // Low energy -> she wouldn't reach out right now.
  if (inp.energy < 0.3) return { send: false, reason: 'low-energy', baseGapHours: gap };
  // Busy block: only reach out if the silence is long enough to justify it.
  if (inp.busy && inp.silenceHours < gap * 1.25) {
    return { send: false, reason: 'busy', baseGapHours: gap };
  }
  // Need enough silence to have a human reason (the due-time already roughly
  // enforces this; double-check against the base gap so config changes are safe).
  if (inp.silenceHours < gap * 0.5) {
    return { send: false, reason: 'too-soon', baseGapHours: gap };
  }

  // Poisson firing coin: p = 1 - exp(-λ·dt). With a per-minute tick, pick λ so an
  // eligible persona fires within ~1-2h of becoming due (a few % per minute),
  // scaled gently by energy + closeness so livelier/closer reach out a bit sooner.
  const lambdaPerMin = 0.02 * (0.6 + 0.5 * inp.energy) * (0.7 + 0.6 * (inp.closeness / 100));
  const p = 1 - Math.exp(-lambdaPerMin);
  const send = rng() < p;
  return { send, reason: send ? 'fire' : 'hold', baseGapHours: gap };
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
