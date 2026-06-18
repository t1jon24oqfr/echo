// N12 — (user context → real persona reply) pair extraction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectReplyPairs } from '../dist/personas/build.service.js';

const msg = (author: string, text: string, ts: number) => ({ author, text, ts, kind: 'text' as const });

test('collectReplyPairs: pairs the user turn with the persona reply (burst collapsed)', () => {
  const convs = [
    {
      start: 0,
      end: 10,
      messages: [
        msg('Maya', 'привіт', 1), // no preceding user turn → skipped
        msg('Oleg', 'як справи?', 2),
        msg('Maya', 'норм)', 3),
        msg('Maya', 'а ти?', 4), // burst → joined into the same reply
        msg('Oleg', 'теж ок', 5),
        msg('Maya', 'клас', 6),
      ],
    },
  ];
  const pairs = collectReplyPairs(convs, 'Maya', 50);
  assert.equal(pairs.length, 2);
  assert.deepEqual(pairs[0], { context: 'як справи?', reply: 'норм)\nа ти?' });
  assert.deepEqual(pairs[1], { context: 'теж ок', reply: 'клас' });
});

test('collectReplyPairs: caps + spreads across the corpus', () => {
  const messages = [];
  for (let i = 0; i < 60; i++) {
    messages.push(msg('Oleg', `q${i}`, i * 2));
    messages.push(msg('Maya', `a${i}`, i * 2 + 1));
  }
  const pairs = collectReplyPairs([{ start: 0, end: 1000, messages }], 'Maya', 10);
  assert.equal(pairs.length, 10);
  // spread: first and last of the 60 should be represented near the ends
  assert.equal(pairs[0].context, 'q0');
  assert.ok(Number(pairs[9].context.slice(1)) >= 50, 'last sample should be late in the history');
});
