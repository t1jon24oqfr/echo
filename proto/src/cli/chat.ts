import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { PersonaFile } from '../types.js';
import { buildSystemPrompt, retrieveMemories } from '../prompt.js';
import { CHAT_MODEL, streamChat, type ChatMessage } from '../llm.js';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const persona = JSON.parse(readFileSync(resolve(arg('persona', 'data/persona.json')), 'utf8')) as PersonaFile;
let temperature = Number(arg('temp', '0.8'));
let debug = false;

const name = persona.card.name || persona.personaAuthor;
console.log(`\nЧат з «${name}» (модель: ${CHAT_MODEL}). Команди: /debug, /temp 0.7, /exit\n`);
console.log('\x1b[2m[ШІ-відтворення — це не реальна людина]\x1b[0m\n');

const history: ChatMessage[] = [];
const rl = createInterface({ input: process.stdin, output: process.stdout });

for (;;) {
  const input = (await rl.question('\x1b[36mти> \x1b[0m')).trim();
  if (!input) continue;
  if (input === '/exit') break;
  if (input === '/debug') {
    debug = !debug;
    console.log(`debug ${debug ? 'on' : 'off'}`);
    continue;
  }
  if (input.startsWith('/temp')) {
    temperature = Number(input.split(/\s+/)[1] ?? temperature);
    console.log(`temperature = ${temperature}`);
    continue;
  }

  const recentText = history.slice(-6).map((m) => m.content).join('\n');
  const retrieved = retrieveMemories(persona, `${recentText}\n${input}`);
  const system = buildSystemPrompt(persona, retrieved);
  if (debug) {
    console.log('\x1b[2m--- retrieved memories ---');
    for (const m of retrieved) console.log(`  ${m.text}`);
    console.log(`--- system prompt: ${system.length} chars ---\x1b[0m`);
  }

  history.push({ role: 'user', content: input });
  const messages: ChatMessage[] = [{ role: 'system', content: system }, ...history.slice(-30)];

  let buffer = '';
  let printedPrefix = false;
  const flushLines = (final: boolean) => {
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      printBubble(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
    if (final && buffer.trim()) printBubble(buffer);
  };
  const printBubble = (line: string) => {
    const t = line.trim();
    if (!t) return;
    if (!printedPrefix) printedPrefix = true;
    console.log(`\x1b[33m${name}>\x1b[0m ${t}`);
  };

  try {
    const full = await streamChat({ model: CHAT_MODEL, messages, temperature }, (tok) => {
      buffer += tok;
      flushLines(false);
    });
    flushLines(true);
    history.push({ role: 'assistant', content: full.trim() });
  } catch (e) {
    console.error(`\n[error] ${(e as Error).message}`);
    history.pop();
  }
  console.log();
}

rl.close();
