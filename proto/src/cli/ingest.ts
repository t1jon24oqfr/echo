import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseTelegram } from '../parsers/telegram.js';
import { parseWhatsApp } from '../parsers/whatsapp.js';
import { parseInstagram } from '../parsers/instagram.js';
import { segment } from '../segment.js';
import { computeStats, describeLangMix } from '../stats.js';
import type { Corpus, Msg } from '../types.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const source = arg('source');
const input = arg('in');
const me = arg('me');
const personaArg = arg('persona');
const months = arg('months') ? Number(arg('months')) : undefined;
const out = arg('out') ?? 'data/corpus.json';

if (!source || !input) {
  console.log(`Usage: npm run ingest -- --source telegram|whatsapp|instagram --in <export file> --me "Your Name" [--persona "Their Name"] [--months 12] [--out data/corpus.json]

  telegram  -> result.json from Telegram Desktop "Export chat history"
  whatsapp  -> _chat.txt from the export zip
  instagram -> message_1.json from the "Download your information" archive`);
  process.exit(1);
}

let messages: Msg[];
switch (source) {
  case 'telegram':
    messages = parseTelegram(resolve(input));
    break;
  case 'whatsapp':
    messages = parseWhatsApp(resolve(input));
    break;
  case 'instagram':
    messages = parseInstagram(resolve(input));
    break;
  default:
    console.error(`Unknown source: ${source}`);
    process.exit(1);
}

if (!messages.length) {
  console.error('No messages parsed — check the file format.');
  process.exit(1);
}

const authors = [...new Set(messages.map((m) => m.author))];
const counts = Object.fromEntries(authors.map((a) => [a, messages.filter((m) => m.author === a).length]));

if (!me || !authors.includes(me)) {
  console.log(`Authors found (pass yours via --me "Name"):`);
  for (const a of authors) console.log(`  - "${a}" (${counts[a]} messages)`);
  process.exit(me ? 1 : 0);
}

const personaAuthor =
  personaArg ?? authors.filter((a) => a !== me).sort((a, b) => counts[b] - counts[a])[0];
if (!personaAuthor) {
  console.error('Could not determine the persona author (only one participant in the chat?).');
  process.exit(1);
}

const conversations = segment(messages, months);
const kept = conversations.flatMap((c) => c.messages);
const stats = computeStats(kept);

const corpus: Corpus = { source, personaAuthor, userAuthor: me, conversations, stats };
mkdirSync(dirname(resolve(out)), { recursive: true });
writeFileSync(resolve(out), JSON.stringify(corpus));

console.log(`\nIngested ${stats.totalMessages} messages (${stats.from} → ${stats.to}), ${conversations.length} conversations${months ? `, last ${months} months` : ''}.`);
console.log(`Voice notes: ${stats.voiceNotes}, media: ${stats.media}`);
console.log(`\nPersona: "${personaAuthor}"  |  You: "${me}"`);
const ps = stats.byAuthor[personaAuthor];
if (ps) {
  console.log(`  ${personaAuthor}: ${ps.messages} msgs, median ${ps.medianWords} words, ${ps.emojiPerMessage} emoji/msg (${ps.topEmoji.map(([e]) => e).join(' ')})`);
  console.log(`  language mix: ${describeLangMix(ps.langMix)}`);
}
console.log(`\nWrote ${out}. Next: npm run build-persona`);
