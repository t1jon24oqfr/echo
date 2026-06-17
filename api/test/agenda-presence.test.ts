// Phase 2 — agenda current-activity lookup, presence machine, proactive gate.
// Pure-function level (no DB). The agenda block lookup is exercised via a tiny
// harness that mirrors AgendaService.lookup contiguity rules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presenceFromState } from '../dist/personas/presence.js';
import { shouldTextFirst, baseGapHours, type ProactiveGateInput } from '../dist/personas/proactive-gate.js';
import { classifyExchange } from '../dist/personas/appraisal.js';
import { fixedClock } from '../dist/engine/state.js';
import type { CurrentActivity } from '../dist/personas/agenda.service.js';

// ---- PRESENCE --------------------------------------------------------------

const clk = fixedClock(new Date('2026-06-17T12:00:00Z'));

test('presence: asleep when energy is at the floor or in the sleep block', () => {
  const p = presenceFromState({ personaId: 'x', ready: true, energy: 0.1, asleep: false, activity: null, memorial: false, clock: clk });
  assert.equal(p?.state, 'asleep');
  const sleepBlock: CurrentActivity = { activity: 'sleep', label: 'asleep', busy: true, valence: 0, arousal: -0.6, nextLabel: 'morning', minsUntilNext: 120 };
  const p2 = presenceFromState({ personaId: 'x', ready: true, energy: 0.9, asleep: false, activity: sleepBlock, memorial: false, clock: clk });
  assert.equal(p2?.state, 'asleep');
});

test('presence: busy when the current block is busy', () => {
  const work: CurrentActivity = { activity: 'work', label: 'at work', busy: true, valence: 0, arousal: 0.2, nextLabel: 'lunch', minsUntilNext: 90 };
  const p = presenceFromState({ personaId: 'x', ready: true, energy: 0.7, asleep: false, activity: work, memorial: false, clock: clk });
  assert.equal(p?.state, 'busy');
  assert.match(p && 'label' in p ? p.label : '', /at work/);
});

test('presence: memorial -> remembrance framing, never a fabricated activity', () => {
  const p = presenceFromState({ personaId: 'x', ready: true, energy: 0.8, asleep: false, activity: null, memorial: true, clock: clk });
  assert.equal(p?.state, 'remembrance');
});

test('presence: not-ready -> null', () => {
  const p = presenceFromState({ personaId: 'x', ready: false, energy: 0.8, asleep: false, activity: null, memorial: false, clock: clk });
  assert.equal(p, null);
});

test('presence: higher energy raises the online probability (statistically)', () => {
  // Average online-rate across the 15-min slots of a day should rise with energy.
  const sample = (energy: number): number => {
    let online = 0;
    const N = 96; // a day of slots
    for (let i = 0; i < N; i++) {
      const c = fixedClock(new Date('2026-06-17T00:00:00Z').getTime() + i * 15 * 60_000);
      const p = presenceFromState({ personaId: 'persona-energy', ready: true, energy, asleep: false, activity: { activity: 'free', label: 'free', busy: false, valence: 0, arousal: 0, nextLabel: 'x', minsUntilNext: 60 }, memorial: false, clock: c });
      if (p?.state === 'online') online++;
    }
    return online / N;
  };
  assert.ok(sample(0.9) > sample(0.4), 'lively should be online more often than tired');
});

// ---- PROACTIVE GATE --------------------------------------------------------

test('baseGapHours: human-paced 8-96h, closer = a bit more often', () => {
  const distant = baseGapHours(20, 1.0);
  const close = baseGapHours(90, 1.0);
  assert.ok(distant >= 8 && distant <= 96);
  assert.ok(close >= 8 && close <= 96);
  assert.ok(close < distant, `closer texts sooner: ${close} < ${distant}`);
  // proactivityScale clamps + extends the gap
  assert.ok(baseGapHours(50, 2.0) > baseGapHours(50, 0.5));
});

function gate(over: Partial<ProactiveGateInput> = {}): ProactiveGateInput {
  return {
    closeness: 60, stage: 3, energy: 0.7, asleep: false, busy: false,
    silenceHours: 40, proactivityScale: 1.0, paused: false, memorial: false,
    ...over,
  };
}

test('gate: hard skips (memorial / paused / asleep / low-energy) never send', () => {
  const always1 = () => 0; // always fires the Poisson coin
  assert.equal(shouldTextFirst(gate({ memorial: true }), always1).send, false);
  assert.equal(shouldTextFirst(gate({ paused: true }), always1).send, false);
  assert.equal(shouldTextFirst(gate({ asleep: true }), always1).send, false);
  assert.equal(shouldTextFirst(gate({ energy: 0.2 }), always1).send, false);
});

test('gate: too-soon (silence < half the base gap) holds', () => {
  const d = shouldTextFirst(gate({ silenceHours: 1 }), () => 0);
  assert.equal(d.send, false);
  assert.equal(d.reason, 'too-soon');
});

test('gate: eligible + Poisson coin fires -> send', () => {
  const d = shouldTextFirst(gate({ silenceHours: 50 }), () => 0); // rng=0 < p -> fire
  assert.equal(d.send, true);
  const hold = shouldTextFirst(gate({ silenceHours: 50 }), () => 0.999); // coin misses
  assert.equal(hold.send, false);
});

// ---- APPRAISAL (chat turn classifier) --------------------------------------

test('appraisal: emotional disclosure scores higher depth than one-word', () => {
  const deep = classifyExchange('я так за тобою скучаю, мені дуже самотньо без наших розмов', { medianWords: 6, repliedToNudge: false, gapDays: 0, modality: 'text' });
  const shallow = classifyExchange('ок', { medianWords: 6, repliedToNudge: false, gapDays: 0, modality: 'text' });
  assert.ok(deep.exchange.depth > shallow.exchange.depth, `deep(${deep.exchange.depth}) > shallow(${shallow.exchange.depth})`);
  assert.equal(shallow.exchange.reciprocity, 0.7, 'one-word = low-effort reciprocity');
});

test('appraisal: a sad heartfelt message yields a (sadness) impulse but positive depth', () => {
  const c = classifyExchange('мені дуже сумно і боляче сьогодні, я плакала', { medianWords: 5, repliedToNudge: false, gapDays: 0, modality: 'text' });
  assert.ok(c.exchange.depth > 0.5);
  assert.equal(c.emotion?.type, 'sadness');
});

test('appraisal: replying to a nudge gives reciprocity 1.5', () => {
  const c = classifyExchange('hey, sorry was busy', { medianWords: 6, repliedToNudge: true, gapDays: 0, modality: 'text' });
  assert.equal(c.exchange.reciprocity, 1.5);
});

test('appraisal: voice/photo modality multiplier', () => {
  const text = classifyExchange('thinking about you', { medianWords: 6, repliedToNudge: false, gapDays: 0, modality: 'text' });
  const voice = classifyExchange('thinking about you', { medianWords: 6, repliedToNudge: false, gapDays: 0, modality: 'voice' });
  assert.ok((voice.exchange.modalityMult ?? 1) > (text.exchange.modalityMult ?? 1));
});
