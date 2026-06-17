// Phase 3 embeddings + retrieval ordering test (node --test). The cosine math
// and the retrieveMemories cosine-blend ordering are PURE -> deterministic. The
// network embed path is NOT exercised here (verified via curl in the runbook).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cosine, parseEmbedding, serializeEmbedding } from '../dist/engine/embeddings.js';
import { retrieveMemories } from '../dist/engine/prompt.js';

// ---- COSINE ----------------------------------------------------------------

test('cosine: identical vectors = 1, orthogonal = 0, opposite = -1', () => {
  assert.ok(Math.abs(cosine([1, 0, 0], [1, 0, 0]) - 1) < 1e-9);
  assert.ok(Math.abs(cosine([1, 0], [0, 1])) < 1e-9);
  assert.ok(Math.abs(cosine([1, 0], [-1, 0]) + 1) < 1e-9);
  // scale-invariant
  assert.ok(Math.abs(cosine([2, 0], [5, 0]) - 1) < 1e-9);
});

test('cosine: defensive on length mismatch / zero vectors', () => {
  assert.equal(cosine([1, 2, 3], [1, 2]), 0);
  assert.equal(cosine([0, 0], [1, 1]), 0);
  assert.equal(cosine([], [1]), 0);
});

test('parse/serialize embedding round-trips (to 6 sig-figs)', () => {
  const v = [0.123456789, -0.5, 1];
  const round = parseEmbedding(serializeEmbedding(v));
  assert.ok(round);
  assert.ok(Math.abs(round![0] - 0.123457) < 1e-6);
  assert.equal(parseEmbedding(null), null);
  assert.equal(parseEmbedding('not json'), null);
  assert.equal(parseEmbedding('[]'), null);
});

// ---- RETRIEVAL ORDERING (cosine when embeddings present) -------------------

function persona(memories: any[]): any {
  return { memories };
}

test('retrieveMemories: cosine relevance ranks the semantically-closest memory first', () => {
  // query embedding points "north"; memA aligns with it, memB is orthogonal,
  // memC opposes. Recency/importance equal so cosine decides the order.
  const now = new Date().toISOString();
  const mems = [
    { id: 'B', text: 'orthogonal note', keywords: [], date: '', importance: 5, lastAccessedAt: now, embedding: [0, 1] },
    { id: 'C', text: 'opposite note', keywords: [], date: '', importance: 5, lastAccessedAt: now, embedding: [-1, 0] },
    { id: 'A', text: 'aligned note', keywords: [], date: '', importance: 5, lastAccessedAt: now, embedding: [1, 0] },
  ];
  const out = retrieveMemories(persona(mems), 'anything', 3, { queryEmbedding: [1, 0] });
  assert.equal(out[0].id, 'A', 'most-aligned memory ranks first');
  assert.equal(out[out.length - 1].id, 'C', 'opposite memory ranks last');
});

test('retrieveMemories: FALLS BACK to keyword overlap when no query embedding', () => {
  const now = new Date().toISOString();
  const mems = [
    { id: 'X', text: 'we went to the lake house in summer', keywords: ['lake', 'summer'], date: '', importance: 5, lastAccessedAt: now },
    { id: 'Y', text: 'tax paperwork is due', keywords: ['tax'], date: '', importance: 5, lastAccessedAt: now },
  ];
  const out = retrieveMemories(persona(mems), 'tell me about the lake', 3);
  assert.ok(out.length >= 1);
  assert.equal(out[0].id, 'X', 'keyword overlap on "lake" surfaces the right memory');
});

test('retrieveMemories: cosine path includes ALL memories (not gated by keyword overlap)', () => {
  const now = new Date().toISOString();
  // query embedding present, but query string shares NO tokens with the memory
  // texts — the keyword gate would return []; the cosine path must still rank.
  const mems = [
    { id: 'A', text: 'zzz', keywords: [], date: '', importance: 5, lastAccessedAt: now, embedding: [1, 0] },
    { id: 'B', text: 'qqq', keywords: [], date: '', importance: 5, lastAccessedAt: now, embedding: [0.2, 0.98] },
  ];
  const out = retrieveMemories(persona(mems), 'completely unrelated words', 2, { queryEmbedding: [1, 0] });
  assert.equal(out.length, 2, 'cosine path ranks all memories, not just keyword matches');
  assert.equal(out[0].id, 'A');
});
