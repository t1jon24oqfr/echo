// R7 — Layer-1 stylometry harness: over-fluency metrics, band, in-band scoring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  styleVector,
  styleBand,
  compareToBand,
  extraMetrics,
} from '../dist/engine/eval-style.js';

test('extraMetrics: repetitive text has low TTR + high top-5 coverage', () => {
  const repetitive = ['ok ok ok', 'ok da ok', 'da da ok', 'ok ok da'];
  const diverse = ['the quick brown fox', 'jumps over lazy dogs', 'azure mountain whispers', 'velvet thunder rolls'];
  const r = extraMetrics(repetitive);
  const d = extraMetrics(diverse);
  assert.ok(r.ttr < d.ttr, 'repetitive should have lower type-token ratio');
  assert.ok(r.top5coverage > d.top5coverage, 'repetitive should have higher top-5 coverage');
});

test('extraMetrics: burstiness is higher when message lengths vary', () => {
  const even = ['a b', 'c d', 'e f', 'g h'];
  const bursty = ['hi', 'a b c d e f g h i j k l', 'ok', 'yep'];
  assert.ok(extraMetrics(bursty).burstiness > extraMetrics(even).burstiness);
});

test('styleVector captures no-trailing-period + bracket-smiles', () => {
  const v = styleVector(['привіт)))', 'як ти', 'все ок)']);
  assert.ok(v.noTrailingPeriod > 0.9, 'none of these end with punctuation');
  assert.ok(v.bracketSmiles > 0.5, 'bracket smiles present');
});

test('band: identical windows give a tight band that the same style passes', () => {
  const msgs = ['привіт як ти)', 'що робиш', 'я вдома', 'нормально)', 'ага', 'давай'];
  const band = styleBand(styleVector(msgs), styleVector(msgs));
  const cmp = compareToBand(styleVector(msgs), band);
  assert.equal(cmp.passed, cmp.total, 'same-style should be fully in-band');
});

test('band: an obviously different (verbose, polished) style fails most features', () => {
  // Terse Ukrainian texting (bracket-smiles, no end punctuation, repetitive).
  const real = [
    'привіт)', 'як ти там', 'я норм', 'що робиш', 'ну окей', 'давай тоді', 'ага)',
    'пізніше напишу', 'не знаю', 'та норм все', 'ок)', 'скучив', 'дзвони пізніше',
    'буду вдома', 'добраніч)', 'цьом', 'ну шо', 'давай', 'окей)', 'ага давай',
  ];
  const band = styleBand(styleVector(real.slice(0, 10)), styleVector(real.slice(10)));
  const polished = styleVector([
    'Hello there, I would be delighted to discuss this matter with you in considerable detail.',
    'Furthermore, the weather today is exceptionally pleasant and agreeable for a long walk.',
    'I appreciate your thoughtful message and look forward to continuing our conversation.',
    'Additionally, please let me know if there is anything else I can assist you with.',
  ]);
  const cmp = compareToBand(polished, band);
  // The discriminating features must clearly fail; a couple of trivially-shared
  // zero features (no emoji, no Russian) may pass, so assert a clear minority.
  assert.ok(cmp.passRate < 0.5, `polished style should mostly fail, got ${cmp.passRate}`);
});
