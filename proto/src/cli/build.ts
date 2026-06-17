import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Corpus, PersonaFile } from '../types.js';
import { buildPersonaCard, extractMemories } from '../extract.js';
import { pickExemplars } from '../exemplars.js';
import { EXTRACT_MODEL } from '../llm.js';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const corpusPath = arg('corpus', 'data/corpus.json');
const outPath = arg('out', 'data/persona.json');

const corpus = JSON.parse(readFileSync(resolve(corpusPath), 'utf8')) as Corpus;
const { personaAuthor, userAuthor, conversations, stats } = corpus;

console.log(`Building persona "${personaAuthor}" with ${EXTRACT_MODEL}…`);

console.log('1/3 persona card…');
const card = await buildPersonaCard(conversations, personaAuthor, userAuthor, stats);
console.log(`  traits: ${card.traits.slice(0, 4).join('; ')}…`);

console.log('2/3 exemplars…');
const exemplars = pickExemplars(conversations, personaAuthor);
console.log(`  picked ${exemplars.length} snippets`);

console.log('3/3 memories…');
const memories = await extractMemories(conversations, personaAuthor, userAuthor);
console.log(`  extracted ${memories.length} memories`);

const persona: PersonaFile = {
  builtAt: new Date().toISOString(),
  source: corpus.source,
  personaAuthor,
  userAuthor,
  card,
  exemplars,
  memories,
  stats,
};
writeFileSync(resolve(outPath), JSON.stringify(persona, null, 2));
console.log(`\nWrote ${outPath}. Next: npm run chat`);
