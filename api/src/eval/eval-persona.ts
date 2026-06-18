/**
 * Layer-1 persona-realism harness (CLI).
 *
 *   npm run eval:persona <corpus.json> [--author "Name"] [--generated replies.txt]
 *
 * <corpus.json> is a build Corpus ({personaAuthor,userAuthor,conversations:[{messages}]})
 * or {personaAuthor, messages:[{author,text,ts}]}. We take the PERSONA's messages,
 * sort by time, hold out the last ~30% as two disjoint windows A & B, and compute
 * the self-consistency BAND (the person's own window-to-window variation).
 *
 * If --generated is given (one generated reply per line — produced by replaying
 * the held-out incoming user turns through the live chat path), we score it
 * against the band: how many style features land "inside the person's own range".
 * Without it, we print the band + the early-vs-late drift so you can sanity-check
 * the corpus before wiring generation. Pure + offline; zero API cost.
 */
import { readFileSync } from 'node:fs';
import {
  styleVector,
  styleBand,
  compareToBand,
  STYLE_FEATURES,
  type StyleVector,
} from '../engine/eval-style.js';

interface RawMsg {
  author: string;
  text: string;
  ts?: number;
}

function loadMessages(path: string): { personaAuthor: string; userAuthor?: string; messages: RawMsg[] } {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  let messages: RawMsg[] = [];
  if (Array.isArray(raw.messages)) {
    messages = raw.messages as RawMsg[];
  } else if (Array.isArray(raw.conversations)) {
    for (const c of raw.conversations as { messages: RawMsg[] }[]) messages.push(...(c.messages ?? []));
  } else if (Array.isArray(raw)) {
    messages = raw as unknown as RawMsg[];
  }
  return {
    personaAuthor: (raw.personaAuthor as string) ?? '',
    userAuthor: raw.userAuthor as string | undefined,
    messages,
  };
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fmt(v: number): string {
  return v.toFixed(v >= 10 ? 1 : 3).padStart(8);
}

function printVec(label: string, v: StyleVector): void {
  const parts = STYLE_FEATURES.map((f) => `${f}=${(v[f] as number).toFixed(3)}`);
  console.log(`  ${label.padEnd(10)} ${parts.join('  ')}`);
}

function main(): void {
  const corpusPath = process.argv[2];
  if (!corpusPath || corpusPath.startsWith('--')) {
    console.error('usage: npm run eval:persona <corpus.json> [--author "Name"] [--generated replies.txt]');
    process.exit(2);
  }
  const { personaAuthor: detected, messages } = loadMessages(corpusPath);
  const personaAuthor = arg('--author') ?? detected;
  if (!personaAuthor) {
    console.error('Could not determine the persona author — pass --author "Name".');
    process.exit(2);
  }

  const personaMsgs = messages
    .filter((m) => m.author === personaAuthor && (m.text ?? '').trim().length > 0)
    .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
    .map((m) => m.text);

  console.log(`\nPersona: "${personaAuthor}"  — ${personaMsgs.length} messages\n`);
  if (personaMsgs.length < 40) {
    console.log('⚠  Fewer than 40 persona messages — the self-consistency band is unreliable.');
    console.log('   (Below ~500 real messages, treat Layer-1 as directional only, never a Turing number.)\n');
  }

  // Hold out the last ~30%, split into two disjoint windows A (older) and B (newer).
  const holdoutStart = Math.floor(personaMsgs.length * 0.7);
  const holdout = personaMsgs.slice(holdoutStart);
  const mid = Math.floor(holdout.length / 2);
  const windowA = holdout.slice(0, mid);
  const windowB = holdout.slice(mid);
  if (windowA.length < 5 || windowB.length < 5) {
    console.log('⚠  Holdout windows too small to form a band; showing the whole-corpus vector only.\n');
    printVec('all', styleVector(personaMsgs));
    return;
  }

  const vecA = styleVector(windowA);
  const vecB = styleVector(windowB);
  const band = styleBand(vecA, vecB);

  console.log('Real self-consistency (two held-out windows):');
  printVec('window A', vecA);
  printVec('window B', vecB);
  console.log('\nPASS band per feature (generated must land inside):');
  for (const f of STYLE_FEATURES) {
    console.log(`  ${f.padEnd(18)} [${fmt(band[f].lo)} , ${fmt(band[f].hi)} ]`);
  }

  const genPath = arg('--generated');
  if (!genPath) {
    console.log(
      '\nNo --generated file. To score the model: replay the held-out incoming user turns\n' +
        'through the chat path, save one generated reply per line, and re-run with\n' +
        '--generated <file>. The harness then reports how many features land in-band.\n',
    );
    return;
  }

  const genTexts = readFileSync(genPath, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  const genVec = styleVector(genTexts);
  const cmp = compareToBand(genVec, band);
  console.log(`\nGenerated (${genTexts.length} replies):`);
  printVec('generated', genVec);
  console.log('\nIn-band check:');
  for (const r of cmp.results) {
    const mark = r.pass ? '✓' : '✗';
    console.log(
      `  ${mark} ${r.feature.padEnd(18)} value=${r.value.toFixed(3)}  band=[${r.band.lo.toFixed(3)}, ${r.band.hi.toFixed(3)}]`,
    );
  }
  console.log(`\nLayer-1 pass rate: ${cmp.passed}/${cmp.total} (${(cmp.passRate * 100).toFixed(0)}%)`);
  console.log('"good" is a high in-band rate, NOT 1.0 — the band already encodes the person\'s own variance.\n');
  process.exit(cmp.passRate >= 0.6 ? 0 : 1);
}

main();
