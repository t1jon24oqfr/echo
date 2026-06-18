// R2/R4 — retrieval knowledge-cutoff gate, fact pinning, reflection boost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retrieveMemories } from '../dist/engine/prompt.js';
import type { MemoryItem, PersonaFile } from '../dist/engine/types.js';

function persona(memories: MemoryItem[], knowledgeCutoff?: string): PersonaFile {
  return { memories, knowledgeCutoff } as unknown as PersonaFile;
}
const mem = (text: string, extra: Partial<MemoryItem> = {}): MemoryItem => ({
  text,
  keywords: [],
  date: '',
  ...extra,
});

test('knowledge-cutoff gate: memories dated after the cutoff are never surfaced', () => {
  const p = persona(
    [
      mem('went to Paris in spring', { date: '2024-06', keywords: ['paris'] }),
      mem('started a new job', { date: '2025-03', keywords: ['paris', 'job'] }),
    ],
    '2024-12',
  );
  const out = retrieveMemories(p, 'paris', 5);
  const texts = out.map((m) => m.text);
  assert.ok(texts.includes('went to Paris in spring'));
  assert.ok(!texts.some((t) => t.includes('new job')), 'post-cutoff memory leaked');
});

test('undated (timeless) memories survive the cutoff gate', () => {
  const p = persona([mem('loves the sea', { keywords: ['sea'] })], '2020-01');
  assert.equal(retrieveMemories(p, 'sea', 5).length, 1);
});

test('kind=fact is pinned: surfaced even with zero query overlap', () => {
  const p = persona([
    mem('our dog is named Rex', { kind: 'fact', keywords: ['dog', 'rex'] }),
    mem('we argued about money once', { keywords: ['money', 'argue'] }),
  ]);
  const out = retrieveMemories(p, 'how is the family doing', 5);
  assert.ok(out.some((m) => m.text.includes('Rex')), 'pinned fact was not always-resident');
});

test('reflection boost: a reflection outranks an equally-relevant episodic memory', () => {
  const p = persona([
    mem('teases when affectionate', { kind: 'reflection', importance: 5, keywords: ['tease'] }),
    mem('teased me yesterday', { kind: 'episodic', importance: 5, keywords: ['tease'] }),
  ]);
  const out = retrieveMemories(p, 'tease', 1);
  assert.equal(out[0].text, 'teases when affectionate');
});
