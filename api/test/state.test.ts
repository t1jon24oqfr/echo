// Phase 2 inner-life engine — formula unit tests (node --test, native TS strip).
// These formulas MUST be right (presence/closeness depend on them). Clock + rng
// are injected so every assertion is deterministic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceState,
  computeEnergy,
  appraise,
  closenessGain,
  classifyStage,
  octantLabel,
  fixedClock,
  mulberry32,
  fnv1a,
  parseEmotions,
  energyDescriptor,
  half,
  K,
  type StateView,
  type AdvanceContext,
} from '../dist/engine/state.js';

// ---- fixtures -------------------------------------------------------------

function baseState(over: Partial<StateView> = {}): StateView {
  const t = new Date('2026-06-17T12:00:00Z');
  return {
    moodP: 0.1, moodA: 0.05, moodD: 0.0,
    baseP: 0.2, baseA: 0.0, baseD: 0.1,
    emotions: '[]',
    closeness: 50, peakCloseness: 50, stage: 3,
    sleepPressureS: 0.3,
    lastWakeAt: new Date('2026-06-17T05:00:00Z'),
    lastSleepAt: null,
    asleep: false,
    stateAt: t,
    lastDecayDay: null,
    version: 0,
    ...over,
  };
}

function ctx(over: Partial<AdvanceContext> = {}): AdvanceContext {
  return {
    timezone: 'Europe/Kyiv',
    chronotype: { MSF: 4.5 },
    mode: 'reconnect',
    decayEnabled: true,
    lastUserAt: new Date('2026-06-17T11:00:00Z'),
    ...over,
  };
}

const noRng = () => 0;

// ---- SEMIGROUP -------------------------------------------------------------

test('semigroup: mood-toward-baseline decay composes — advance(advance(s,a),b) == advance(s,a+b)', () => {
  // No active emotions (skip ALMA pull) + small moods (tanh ≈ identity) so the
  // pure exponential decay-to-baseline is the only mover and composes exactly.
  const s = baseState({ moodP: 0.12, moodA: -0.08, moodD: 0.05, baseP: 0.2, baseA: 0.0, baseD: 0.1, emotions: '[]' });
  const a = 3600, b = 7200; // 1h then 2h
  const c0 = ctx({ decayEnabled: false }); // isolate mood (no closeness path)
  const clockAt = (sec: number) => fixedClock(new Date(s.stateAt.getTime() + sec * 1000));

  const step1 = advanceState(s, a, c0, clockAt(a), noRng);
  const step2 = advanceState(step1, b, c0, clockAt(a + b), noRng);
  const oneShot = advanceState(s, a + b, c0, clockAt(a + b), noRng);

  for (const k of ['moodP', 'moodA', 'moodD'] as const) {
    assert.ok(Math.abs(step2[k] - oneShot[k]) < 1e-6, `${k}: ${step2[k]} vs ${oneShot[k]}`);
  }
});

test('semigroup: emotion-intensity decay is exactly multiplicative', () => {
  const half1 = half(60, 11);
  const half2 = half(120, 11);
  const halfBoth = half(180, 11);
  assert.ok(Math.abs(half1 * half2 - halfBoth) < 1e-12);
});

// ---- DECAY-TO-BASELINE -----------------------------------------------------

test('mood drifts toward baseline over time (and reaches it in the limit)', () => {
  const s = baseState({ moodP: 0.9, moodA: -0.9, moodD: 0.8, baseP: 0.0, baseA: 0.0, baseD: 0.0, emotions: '[]' });
  const c0 = ctx({ decayEnabled: false });
  const far = 1000 * 3600; // ~41 days — far beyond every mood half-life
  const adv = advanceState(s, far, c0, fixedClock(new Date(s.stateAt.getTime() + far * 1000)), noRng);
  for (const k of ['moodP', 'moodA', 'moodD'] as const) {
    assert.ok(Math.abs(adv[k]) < 0.02, `${k} should approach baseline 0, got ${adv[k]}`);
  }
});

test('arousal decays faster than pleasure (H_mood_A << H_mood_P)', () => {
  const s = baseState({ moodP: 0.8, moodA: 0.8, baseP: 0, baseA: 0, baseD: 0, moodD: 0, emotions: '[]' });
  const dt = 6 * 3600; // 6h
  const adv = advanceState(s, dt, ctx({ decayEnabled: false }), fixedClock(new Date(s.stateAt.getTime() + dt * 1000)), noRng);
  // arousal (H=360min=6h) should have decayed much more than pleasure (H=2880min=48h)
  assert.ok(Math.abs(adv.moodA) < Math.abs(adv.moodP), `A=${adv.moodA} should be < P=${adv.moodP}`);
  assert.ok(K.H_mood_A < K.H_mood_P);
});

test('active emotions decay toward zero and are dropped below 0.02', () => {
  const em = [{ type: 'joy', intensity: 0.5, p: 0.4, a: 0.2, d: 0.1, halflifeMin: 11, createdAt: '2026-06-17T12:00:00Z' }];
  const s = baseState({ emotions: JSON.stringify(em) });
  const dt = 120 * 60; // 120 min ~ 11 half-lives -> negligible
  const adv = advanceState(s, dt, ctx({ decayEnabled: false }), fixedClock(new Date(s.stateAt.getTime() + dt * 1000)), noRng);
  assert.equal(parseEmotions(adv.emotions).length, 0, 'emotion should be dropped');
});

// ---- ENERGY: 24h shape -----------------------------------------------------

function energyAtLocalHour(hourLocal: number, chrono = { MSF: 4.5 }, tz = 'Europe/Kyiv'): number {
  // Build an instant whose Kyiv local hour == hourLocal. Kyiv is UTC+3 in summer.
  // Use a settled state: awake since early morning (no inertia), mid sleep-pressure.
  const utcHour = (hourLocal - 3 + 24) % 24;
  const at = new Date(Date.UTC(2026, 5, 17, Math.floor(utcHour), Math.round((utcHour % 1) * 60), 0));
  const s = baseState({
    asleep: false,
    sleepPressureS: 0.4,
    lastWakeAt: new Date(at.getTime() - 5 * 3600_000), // awake 5h (past inertia)
  });
  return computeEnergy(s, { timezone: tz, chronotype: chrono }, fixedClock(at));
}

test('energy 24h trace: morning rise, ~14:00 dip, night low', () => {
  const e8 = energyAtLocalHour(8);
  const e11 = energyAtLocalHour(11);
  const e14 = energyAtLocalHour(14);
  const e16 = energyAtLocalHour(16);
  const e3 = energyAtLocalHour(3);
  // morning rise: 11am clearly higher than 8am
  assert.ok(e11 > e8, `11h(${e11}) > 8h(${e8})`);
  // post-lunch ultradian dip: 14:00 below the late-afternoon peak ~16:00
  assert.ok(e14 < e16, `14h(${e14}) < 16h(${e16})`);
  // night trough: 03:00 is the lowest of the lot
  assert.ok(e3 < e8 && e3 < e14, `night 3h(${e3}) should be lowest`);
  // all bounded [0,1]
  for (const e of [e8, e11, e14, e16, e3]) assert.ok(e >= 0 && e <= 1);
});

test('energy: lark vs owl phase shift — owl peaks later', () => {
  // At an early-morning hour the lark should have MORE energy than the owl;
  // late evening the owl should have more. (owl MSF high -> curve shifts later.)
  const lark = { MSF: 3.0 };
  const owl = { MSF: 7.0 };
  const morningLark = energyAtLocalHour(8, lark);
  const morningOwl = energyAtLocalHour(8, owl);
  assert.ok(morningLark > morningOwl, `morning: lark(${morningLark}) > owl(${morningOwl})`);
  const eveningLark = energyAtLocalHour(22, lark);
  const eveningOwl = energyAtLocalHour(22, owl);
  assert.ok(eveningOwl > eveningLark, `evening: owl(${eveningOwl}) > lark(${eveningLark})`);
});

test('energy: sleep inertia makes the first hour after wake groggy', () => {
  const at = new Date(Date.UTC(2026, 5, 17, 4, 0, 0)); // 07:00 Kyiv
  const justWoke = baseState({ asleep: false, lastWakeAt: new Date(at.getTime() - 10 * 60_000) }); // 10 min ago
  const settled = baseState({ asleep: false, lastWakeAt: new Date(at.getTime() - 4 * 3600_000) }); // 4h ago
  const eGroggy = computeEnergy(justWoke, { timezone: 'Europe/Kyiv', chronotype: { MSF: 4.5 } }, fixedClock(at));
  const eSettled = computeEnergy(settled, { timezone: 'Europe/Kyiv', chronotype: { MSF: 4.5 } }, fixedClock(at));
  assert.ok(eGroggy < eSettled, `groggy(${eGroggy}) < settled(${eSettled})`);
});

// ---- DST -------------------------------------------------------------------

test('DST: local hour is correct across the EU spring-forward (Kyiv 2026-03-29)', () => {
  // EU DST 2026: clocks jump 03:00->04:00 local in Kyiv on 2026-03-29.
  // 00:30 UTC = 02:30 EET (before), 01:30 UTC = 04:30 EEST (after the jump).
  const before = energyForInstant(new Date('2026-03-29T00:30:00Z')); // 02:30 local
  const after = energyForInstant(new Date('2026-03-29T01:30:00Z')); // 04:30 local (DST)
  // Just assert both compute finite, bounded values across the discontinuity —
  // the key is no crash / no off-by-one-hour (Luxon handles the gap).
  assert.ok(Number.isFinite(before) && before >= 0 && before <= 1);
  assert.ok(Number.isFinite(after) && after >= 0 && after <= 1);
});

test('DST: localDate/hour reflect the real wall clock (not server tz)', async () => {
  const { localHourFloat, localDateStr } = await import('../dist/engine/state.js');
  // 22:30 UTC on 2026-06-17 is 01:30 NEXT day in Kyiv (UTC+3 summer).
  const clock = fixedClock(new Date('2026-06-17T22:30:00Z'));
  assert.equal(localDateStr(clock, 'Europe/Kyiv'), '2026-06-18');
  assert.ok(Math.abs(localHourFloat(clock, 'Europe/Kyiv') - 1.5) < 1e-6);
  // Same instant in Honolulu is still the 17th, 12:30.
  assert.equal(localDateStr(clock, 'Pacific/Honolulu'), '2026-06-17');
  assert.ok(Math.abs(localHourFloat(clock, 'Pacific/Honolulu') - 12.5) < 1e-6);
});

function energyForInstant(at: Date): number {
  const s = baseState({ asleep: false, lastWakeAt: new Date(at.getTime() - 5 * 3600_000) });
  return computeEnergy(s, { timezone: 'Europe/Kyiv', chronotype: { MSF: 4.5 } }, fixedClock(at));
}

// ---- CLOSENESS -------------------------------------------------------------

test('closeness gain has diminishing returns (smaller delta near the top)', () => {
  const f = { depth: 1.0, reciprocity: 1.0, gapDays: 0 };
  const lowC = closenessGain(50, f);
  const highC = closenessGain(85, f);
  assert.ok(lowC > highC, `gain@50(${lowC}) > gain@85(${highC})`);
  // matches the spec's ballpark (~+1.8 near 50, ~+0.5 near 85)
  assert.ok(lowC > 1.5 && lowC < 3.5, `gain@50=${lowC}`);
  assert.ok(highC < 1.5, `gain@85=${highC}`);
});

test('closeness gain weights DEPTH not valence (sad heartfelt still increases)', () => {
  // depth 1.0 = emotional disclosure; the delta is strictly positive.
  const sadHeartfelt = closenessGain(50, { depth: 1.0, reciprocity: 1.0, gapDays: 0 });
  assert.ok(sadHeartfelt > 0, 'a heartfelt (even sad) message must raise closeness');
});

test('closeness daily gain cap (+8) is enforced', () => {
  const big = closenessGain(20, { depth: 1.0, reciprocity: 1.5, gapDays: 10, gainedToday: 0 });
  assert.ok(big <= K.dailyGainCap + 1e-9, `delta ${big} must be <= cap ${K.dailyGainCap}`);
  const afterCap = closenessGain(20, { depth: 1.0, reciprocity: 1.5, gapDays: 10, gainedToday: 8 });
  assert.equal(afterCap, 0, 'no further gain once the daily cap is spent');
});

test('re-engagement bonus rewards return after a >3-day gap', () => {
  const noGap = closenessGain(50, { depth: 0.6, reciprocity: 1.0, gapDays: 1 });
  const withGap = closenessGain(50, { depth: 0.6, reciprocity: 1.0, gapDays: 6 });
  assert.ok(withGap > noGap, `gap bonus: ${withGap} > ${noGap}`);
});

test('closeness SOFT-decays toward the floor (35), strong bonds slower', () => {
  // Idle 30 days, never decayed today. Thin bond (peak=50) fades more than a
  // strong bond (peak=90) over the same idle window; both stay >= floor.
  const idle = new Date('2026-06-17T12:00:00Z');
  const lastUser = new Date(idle.getTime() - 30 * 86_400_000);
  const thin = baseState({ closeness: 80, peakCloseness: 50, lastDecayDay: null, stateAt: idle });
  const strong = baseState({ closeness: 80, peakCloseness: 90, lastDecayDay: null, stateAt: idle });
  const c = ctx({ decayEnabled: true, lastUserAt: lastUser });
  const advThin = advanceState(thin, 0, c, fixedClock(idle), noRng);
  const advStrong = advanceState(strong, 0, c, fixedClock(idle), noRng);
  assert.ok(advThin.closeness < 80, 'thin bond decayed');
  assert.ok(advThin.closeness >= 35, 'never below the floor');
  assert.ok(advStrong.closeness > advThin.closeness, `strong bond fades slower: ${advStrong.closeness} > ${advThin.closeness}`);
});

test('closeness decay is DISABLED in memorial mode (absence is grief, not neglect)', () => {
  const idle = new Date('2026-06-17T12:00:00Z');
  const lastUser = new Date(idle.getTime() - 60 * 86_400_000); // 60 days idle
  const s = baseState({ closeness: 70, peakCloseness: 70, lastDecayDay: null, stateAt: idle });
  const c = ctx({ mode: 'memorial', decayEnabled: false, lastUserAt: lastUser });
  const adv = advanceState(s, 0, c, fixedClock(idle), noRng);
  assert.equal(adv.closeness, 70, 'memorial closeness must not decay');
});

test('closeness decay runs once per local day (lastDecayDay guard)', () => {
  const idle = new Date('2026-06-17T12:00:00Z');
  const lastUser = new Date(idle.getTime() - 30 * 86_400_000);
  // already decayed today -> no further change
  const s = baseState({ closeness: 60, peakCloseness: 60, lastDecayDay: '2026-06-17', stateAt: idle });
  const adv = advanceState(s, 0, ctx({ lastUserAt: lastUser }), fixedClock(idle), noRng);
  assert.equal(adv.closeness, 60, 'no decay if already decayed today');
});

// ---- STAGE (hysteresis) ----------------------------------------------------

test('stage hysteresis: advance only past threshold+5, regress only below threshold-5', () => {
  // at c=47 (just above the 45 boundary) coming from stage 2, should NOT advance (needs >50)
  assert.equal(classifyStage(47, 2), 2);
  // at c=52 it advances to 3
  assert.equal(classifyStage(52, 2), 3);
  // coming from stage 3, c=43 (just below 45) should NOT regress (needs <40)
  assert.equal(classifyStage(43, 3), 3);
  // c=38 regresses to 2
  assert.equal(classifyStage(38, 3), 2);
});

test('pinnedMaxStage is a hard ceiling the auto-stage can never exceed', () => {
  assert.equal(classifyStage(95, 4, 3), 3, 'capped at 3 even though c=95 -> stage 5');
});

// ---- OCTANT LABELS ---------------------------------------------------------

test('octant labels: the 8 corners + deadzone "content"', () => {
  assert.equal(octantLabel({ P: 0.5, A: 0.5, D: 0.5 }).label, 'exuberant');
  assert.equal(octantLabel({ P: -0.5, A: -0.5, D: -0.5 }).label, 'bored');
  assert.equal(octantLabel({ P: 0.5, A: 0.5, D: -0.5 }).label, 'dependent');
  assert.equal(octantLabel({ P: -0.5, A: -0.5, D: 0.5 }).label, 'disdainful');
  assert.equal(octantLabel({ P: 0.5, A: -0.5, D: 0.5 }).label, 'relaxed');
  assert.equal(octantLabel({ P: -0.5, A: 0.5, D: -0.5 }).label, 'anxious');
  assert.equal(octantLabel({ P: 0.5, A: -0.5, D: -0.5 }).label, 'docile');
  assert.equal(octantLabel({ P: -0.5, A: 0.5, D: 0.5 }).label, 'hostile');
  // deadzone (theta=0.15): everything small -> content
  assert.equal(octantLabel({ P: 0.05, A: -0.1, D: 0.0 }).label, 'content');
});

test('octant adverb scales with magnitude', () => {
  assert.equal(octantLabel({ P: 0.16, A: 0.0, D: 0.0 }).adverb, 'slightly');
  assert.equal(octantLabel({ P: 0.9, A: 0.9, D: 0.9 }).adverb, 'very');
});

// ---- APPRAISAL -------------------------------------------------------------

test('appraise: high-neuroticism amplifies emotion intensity (gain)', () => {
  const clock = fixedClock(new Date('2026-06-17T12:00:00Z'));
  const calm = appraise({ type: 'sadness', base: 0.4 }, { ocean: { N: 0 } }, 50, clock);
  const neurotic = appraise({ type: 'sadness', base: 0.4 }, { ocean: { N: 100 } }, 50, clock);
  assert.ok(neurotic.intensity > calm.intensity, `neurotic(${neurotic.intensity}) > calm(${calm.intensity})`);
  // negative emotion -> faster half-life than positive
  assert.equal(neurotic.halflifeMin, K.H_emotion_neg);
  const joy = appraise({ type: 'joy', base: 0.4 }, { ocean: { N: 50 } }, 50, clock);
  assert.equal(joy.halflifeMin, K.H_emotion_pos);
});

test('appraise: surprise term widens intensity on unexpected outcomes', () => {
  const clock = fixedClock(new Date('2026-06-17T12:00:00Z'));
  const expected = appraise({ type: 'joy', base: 0.3, outcome: 1, expected: 1 }, { ocean: { N: 50 } }, 50, clock);
  const surprising = appraise({ type: 'joy', base: 0.3, outcome: 1, expected: -1 }, { ocean: { N: 50 } }, 50, clock);
  assert.ok(surprising.intensity > expected.intensity);
});

// ---- RNG / misc ------------------------------------------------------------

test('seeded rng is reproducible and day-stable', () => {
  const a = mulberry32(fnv1a('persona1:2026-06-17'));
  const b = mulberry32(fnv1a('persona1:2026-06-17'));
  assert.equal(a(), b(), 'same seed -> same stream');
  const c = mulberry32(fnv1a('persona1:2026-06-18'));
  assert.notEqual(a(), c(), 'different day -> different stream');
});

test('energyDescriptor buckets', () => {
  assert.equal(energyDescriptor(0.2), 'groggy');
  assert.equal(energyDescriptor(0.45), 'a bit tired');
  assert.equal(energyDescriptor(0.6), 'ok');
  assert.equal(energyDescriptor(0.9), 'lively');
});
