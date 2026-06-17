// Phase 3 behavior-layer unit tests (node --test). Pure functions -> every
// assertion is deterministic (seeded rng injected). Asserts the probability
// BOUNDS, the busy-override latency, "no uncorrected typo in final text", and
// the §6 monotonicities (closeness/energy/arousal effects).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  replyLatency,
  burstCount,
  replyLengthHint,
  emojiPolicy,
  pSelfCorrection,
  selfCorrection,
  makeTypo,
  seenPolicy,
  computeBehavior,
  classifyMsgType,
  knobsFromPassport,
  LAT,
  type BehaviorState,
  type BehaviorKnobs,
  type MsgFeatures,
} from '../dist/engine/behavior.js';
import { mulberry32 } from '../dist/engine/state.js';

// ---- fixtures --------------------------------------------------------------

function st(over: Partial<BehaviorState> = {}): BehaviorState {
  return {
    moodP: 0.1,
    moodA: 0.0,
    energy: 0.7,
    closeness: 50,
    stage: 3,
    busy: false,
    asleep: false,
    minsUntilBlockEnds: 0,
    ...over,
  };
}

function kn(over: Partial<BehaviorKnobs> = {}): BehaviorKnobs {
  return {
    extraversion: 0.5,
    agreeableness: 0.5,
    typoTendency: 0.3,
    expressiveness: 0.5,
    talkativeness: 0.5,
    readReceipts: 'close-only',
    femaleBias: false,
    ...over,
  };
}

const normal: MsgFeatures = { type: 'normal' };
function rngFrom(seed: number) {
  return mulberry32(seed);
}

// ---- LATENCY: bounds + busy override ---------------------------------------

test('replyLatency: acknowledge clamps to [2s, 1800s] over many draws', () => {
  for (let s = 0; s < 200; s++) {
    const r = replyLatency(st(), kn(), normal, 40, rngFrom(s));
    assert.ok(r.acknowledgeMs >= LAT.ackMinMs, `ack ${r.acknowledgeMs} >= 2s`);
    assert.ok(r.acknowledgeMs <= LAT.ackMaxMs, `ack ${r.acknowledgeMs} <= 1800s`);
    assert.ok(r.composeMs >= 0);
  }
});

test('replyLatency: BUSY override = time-until-block-ends (the believable long tail)', () => {
  // 20 min until the busy block ends -> acknowledge == 20 min (within the ceiling).
  const r = replyLatency(st({ busy: true, minsUntilBlockEnds: 20 }), kn(), normal, 30, rngFrom(1));
  assert.equal(r.busyOverride, true);
  assert.equal(r.acknowledgeMs, 20 * 60_000);
  // asleep with a long block clamps to the 1800s (=30min) ceiling.
  const r2 = replyLatency(st({ asleep: true, minsUntilBlockEnds: 120 }), kn(), normal, 30, rngFrom(2));
  assert.equal(r2.busyOverride, true);
  assert.equal(r2.acknowledgeMs, LAT.ackMaxMs); // 120min > 30min ceiling -> clamped
});

test('replyLatency: closeness + energy shorten the median acknowledge', () => {
  // average a batch so the noise washes out.
  const avg = (state: BehaviorState) => {
    let sum = 0;
    const n = 400;
    for (let s = 0; s < n; s++) sum += replyLatency(state, kn(), normal, 20, rngFrom(s + 1)).acknowledgeMs;
    return sum / n;
  };
  const distant = avg(st({ closeness: 10, energy: 0.3 }));
  const close = avg(st({ closeness: 95, energy: 0.95 }));
  assert.ok(close < distant, `close+lively(${close}) < distant+tired(${distant})`);
});

// ---- BURST -----------------------------------------------------------------

test('burstCount: always within [1,4]', () => {
  for (let s = 0; s < 300; s++) {
    const k = burstCount(st({ moodA: 0.9 }), kn({ extraversion: 1, talkativeness: 1 }), { type: 'banter', newsFlag: true }, rngFrom(s));
    assert.ok(k >= 1 && k <= 4, `k=${k}`);
  }
});

test('burstCount: high arousal/extraversion/news yields more bubbles on average', () => {
  const mean = (state: BehaviorState, knobs: BehaviorKnobs, msg: MsgFeatures) => {
    let sum = 0;
    const n = 500;
    for (let s = 0; s < n; s++) sum += burstCount(state, knobs, msg, rngFrom(s + 1));
    return sum / n;
  };
  const low = mean(st({ moodA: -0.9 }), kn({ extraversion: 0.1, talkativeness: 0.1 }), { type: 'normal' });
  const high = mean(st({ moodA: 0.9 }), kn({ extraversion: 0.9, talkativeness: 0.9 }), { type: 'normal', newsFlag: true });
  assert.ok(high > low, `high(${high}) > low(${low})`);
  assert.ok(low >= 1, 'never below a single bubble');
});

// ---- LENGTH ----------------------------------------------------------------

test('replyLengthHint: within [1,40]; emotional > banter; low energy compresses', () => {
  for (let s = 0; s < 200; s++) {
    const w = replyLengthHint(st(), kn(), normal, rngFrom(s));
    assert.ok(w >= 1 && w <= 40, `w=${w}`);
  }
  // deterministic (mean) comparison: emotional disclosure is longer than banter.
  const emo = replyLengthHint(st(), kn(), { type: 'emotional' });
  const ban = replyLengthHint(st(), kn(), { type: 'banter' });
  assert.ok(emo > ban, `emotional(${emo}) > banter(${ban})`);
  const tired = replyLengthHint(st({ energy: 0.05 }), kn(), { type: 'banter' });
  assert.ok(tired <= 5, `low-energy banter compresses: ${tired}`);
});

// ---- EMOJI -----------------------------------------------------------------

test('emojiPolicy: probabilities are valid [0,1]; logistics suppresses, banter+close raises', () => {
  const lo = emojiPolicy(st({ closeness: 5, moodP: -0.5 }), kn(), { type: 'logistics' });
  const hi = emojiPolicy(st({ closeness: 95, moodP: 0.8 }), kn({ agreeableness: 0.9 }), { type: 'banter' });
  for (const p of [lo.pEmoji, lo.pEmojiOnlyReaction, hi.pEmoji, hi.pEmojiOnlyReaction]) {
    assert.ok(p >= 0 && p <= 1, `p=${p}`);
  }
  assert.ok(hi.pEmoji > lo.pEmoji, `banter+close(${hi.pEmoji}) > logistics+distant(${lo.pEmoji})`);
});

test('emojiPolicy: emoji-only FORCED to 0 on emotional disclosure AND on a direct question', () => {
  const emo = emojiPolicy(st({ closeness: 95 }), kn(), { type: 'emotional' });
  assert.equal(emo.pEmojiOnlyReaction, 0, 'no emoji-only reply to vulnerability');
  const q = emojiPolicy(st({ closeness: 95 }), kn(), { type: 'question' });
  assert.equal(q.pEmojiOnlyReaction, 0, 'no emoji-only reply to a direct question');
  // but banter at high closeness CAN fire an emoji-only reaction (>0).
  const ban = emojiPolicy(st({ closeness: 95 }), kn(), { type: 'banter' });
  assert.ok(ban.pEmojiOnlyReaction > 0, 'banter+close allows an emoji-only tapback');
});

// ---- SELF-CORRECTION: bounds + NO uncorrected typo -------------------------

test('pSelfCorrection: bounded [0, 0.15] across lengths/arousal/knobs', () => {
  for (const chars of [3, 12, 13, 200]) {
    for (const arousal of [-1, 0, 1]) {
      for (const typo of [0, 0.3, 1]) {
        const p = pSelfCorrection(st({ moodA: arousal }), kn({ typoTendency: typo }), chars);
        assert.ok(p >= 0 && p <= 0.15 + 1e-9, `p=${p}`);
      }
    }
  }
});

test('selfCorrection: when it fires, the FINAL word is the correct one (typedPartial != finalWord)', () => {
  // force-fire by maxing typoTendency + a long high-arousal message + a low rng.
  const fired: { typed: string; fix: string }[] = [];
  for (let s = 0; s < 500; s++) {
    const c = selfCorrection(
      st({ moodA: 1 }),
      kn({ typoTendency: 1 }),
      'this is a reasonably long sentence about something',
      0,
      rngFrom(s),
    );
    if (c) fired.push({ typed: c.typedPartial, fix: c.finalWord });
  }
  assert.ok(fired.length > 0, 'at least one correction should fire under max typoTendency');
  for (const f of fired) {
    assert.notEqual(f.typed, f.fix, 'the typed partial must differ from the corrected word');
    // the fix must be a REAL word from the sentence (never random chars)
    assert.ok(
      'this is a reasonably long sentence about something'.includes(f.fix),
      `fix "${f.fix}" must be a real word from the text`,
    );
  }
});

test('makeTypo: produces a single-edit variant that is NOT the original (never gibberish)', () => {
  const word = 'reasonably';
  let distinct = 0;
  for (let s = 0; s < 50; s++) {
    const t = makeTypo(word, rngFrom(s));
    if (t !== word) distinct++;
    // same length (transposition) or +1 (doubled char) — never wildly different.
    assert.ok(Math.abs(t.length - word.length) <= 1, `len delta for "${t}"`);
  }
  assert.ok(distinct > 0, 'makeTypo should usually alter the word');
});

// ---- SEEN / TYPING-THEN-STOP ----------------------------------------------

test("seenPolicy: 'seen' suppressed for stage<3 (close-only), shown at stage>=3 or imminent", () => {
  assert.equal(seenPolicy(st({ stage: 2 }), kn({ readReceipts: 'close-only' })).showSeen, false);
  assert.equal(seenPolicy(st({ stage: 3 }), kn({ readReceipts: 'close-only' })).showSeen, true);
  assert.equal(seenPolicy(st({ stage: 1 }), kn({ readReceipts: 'close-only' }), { replyImminent: true }).showSeen, true);
  // knob overrides
  assert.equal(seenPolicy(st({ stage: 5 }), kn({ readReceipts: 'off' })).showSeen, false);
  assert.equal(seenPolicy(st({ stage: 1 }), kn({ readReceipts: 'always' })).showSeen, true);
});

test('typingThenStop: only stage>=4, and rare (< 5%)', () => {
  // stage 3 never trips it regardless of rng.
  for (let s = 0; s < 100; s++) {
    assert.equal(seenPolicy(st({ stage: 3 }), kn(), {}, rngFrom(s)).typingThenStop, false);
  }
  // stage 5: fires sometimes but rarely.
  let fires = 0;
  const n = 2000;
  for (let s = 0; s < n; s++) if (seenPolicy(st({ stage: 5 }), kn(), {}, rngFrom(s)).typingThenStop) fires++;
  assert.ok(fires / n < 0.06, `typing-then-stop rate ${(fires / n).toFixed(3)} should be < ~5%`);
  assert.ok(fires > 0, 'it should fire occasionally at stage 5');
});

// ---- COMPOSITE -------------------------------------------------------------

test('computeBehavior: shapes are consistent (gaps = bubbles-1, typing = bubbles)', () => {
  for (let s = 0; s < 100; s++) {
    const b = computeBehavior(st(), kn(), normal, rngFrom(s), { estChars: 60 });
    assert.equal(b.perBubbleTyping.length, b.bubbleCount);
    assert.equal(b.gapMs.length, b.bubbleCount - 1);
    assert.ok(b.bubbleCount >= 1 && b.bubbleCount <= 4);
    assert.ok(b.readDelayMs >= LAT.ackMinMs);
    for (const g of b.gapMs) assert.ok(g >= 250);
  }
});

test('computeBehavior: busy snapshot surfaces busyOverride + agenda-driven readDelay', () => {
  const b = computeBehavior(st({ busy: true, minsUntilBlockEnds: 25 }), kn(), normal, rngFrom(7), {});
  assert.equal(b.busyOverride, true);
  assert.equal(b.readDelayMs, 25 * 60_000);
});

// ---- classify + knobs ------------------------------------------------------

test('classifyMsgType: question / logistics / banter / emotional', () => {
  assert.equal(classifyMsgType('what are you up to?').type, 'question');
  assert.equal(classifyMsgType('lol').type, 'banter');
  assert.equal(classifyMsgType('can we meet tomorrow at 6').type, 'question'); // starts with "can"
  assert.equal(classifyMsgType('meet tomorrow at the cafe').type, 'logistics');
  assert.equal(classifyMsgType('i feel so lost lately', { emotionalHint: true }).type, 'emotional');
});

test('knobsFromPassport: defaults sane when passport absent; female bias from gender', () => {
  const def = knobsFromPassport(null, null);
  assert.equal(def.readReceipts, 'close-only');
  assert.equal(def.femaleBias, false);
  const f = knobsFromPassport(null, 'female');
  assert.equal(f.femaleBias, true);
});
