// N1/N2 — code-switch detection + signature-phrase mining.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCodeSwitched } from '../dist/engine/stats.js';
import { mineSignaturePhrases } from '../dist/engine/phrases.js';

test('isCodeSwitched: detects Cyrillic+Latin in one message', () => {
  assert.equal(isCodeSwitched('ну це fail'), true);
  assert.equal(isCodeSwitched('давай catch up завтра'), true);
  assert.equal(isCodeSwitched('просто привіт)'), false);
  assert.equal(isCodeSwitched('see you later'), false);
  assert.equal(isCodeSwitched('окей 😊'), false); // emoji isn't latin
});

test('mineSignaturePhrases: surfaces the persona-distinctive habits, not shared words', () => {
  // Persona over-uses "ну шо" and ")))"; the other author uses neither.
  const persona = [
    ...Array(8).fill('ну шо там'),
    ...Array(6).fill('ахах)))'),
    ...Array(5).fill('давай тоді'),
    'привіт', 'як ти', 'ну добре',
  ];
  const other = [
    ...Array(10).fill('привіт як справи'),
    ...Array(8).fill('добре дякую'),
    'до зустрічі',
  ];
  const sig = mineSignaturePhrases(persona, other, 8);
  assert.ok(sig.some((p) => p.includes('ну шо')), `expected "ну шо" in ${JSON.stringify(sig)}`);
  assert.ok(sig.some((p) => p.includes(')))') || p.includes('ахах')), `expected laugh token in ${JSON.stringify(sig)}`);
  // A word BOTH use a lot ("привіт") must not rank as a persona signature.
  assert.ok(!sig.includes('привіт'), 'shared word leaked as a signature');
});

test('mineSignaturePhrases: returns [] for a tiny corpus', () => {
  assert.deepEqual(mineSignaturePhrases(['hi', 'ok'], ['hello']), []);
});
