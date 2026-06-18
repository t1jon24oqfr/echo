/**
 * Generation-replay (N8) — closes the Layer-1 loop.
 *
 *   npm run replay:persona <corpus.json> [--out replies.txt] [--author "Name"] [--max 50]
 *
 * Builds a persona from the EARLY ~70% of a corpus (so the held-out tail is never
 * seen), then replays the held-out incoming user turns through the real engine
 * prompt + model and writes the generated persona replies (one per line). Feed
 * that file to `npm run eval:persona <corpus.json> --generated replies.txt` to get
 * the in-band style score. Needs OPENROUTER_API_KEY (real generation).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Conversation, Msg, PersonaFile } from '../engine/types.js';
import { computeStats } from '../engine/stats.js';
import { pickExemplars } from '../engine/exemplars.js';
import { buildPersonaCard } from '../engine/extract.js';
import { buildSystemPrompt, retrieveMemories } from '../engine/prompt.js';
import { complete, CHAT_MODEL, hasApiKey, type ChatMessage } from '../engine/llm.js';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface CorpusFile {
  personaAuthor?: string;
  userAuthor?: string;
  conversations?: Conversation[];
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path || path.startsWith('--')) {
    console.error('usage: npm run replay:persona <corpus.json> [--out replies.txt] [--author "Name"] [--max 50]');
    process.exit(2);
  }
  if (!hasApiKey()) {
    console.error('OPENROUTER_API_KEY is required to generate replies.');
    process.exit(2);
  }
  const corpus = JSON.parse(readFileSync(path, 'utf8')) as CorpusFile;
  const convs = corpus.conversations ?? [];
  const personaAuthor = arg('--author') ?? corpus.personaAuthor ?? '';
  const userAuthor = corpus.userAuthor ?? '';
  const max = Number(arg('--max') ?? '50');
  const out = arg('--out') ?? `${path.replace(/\.json$/, '')}.generated.txt`;
  if (!personaAuthor || !convs.length) {
    console.error('Need conversations + a persona author (pass --author).');
    process.exit(2);
  }

  // Time-split: train = conversations ending before the persona's 70th-percentile
  // message time; the rest is held out (and never fed into the build).
  const personaTimes = convs
    .flatMap((c) => c.messages)
    .filter((m) => m.author === personaAuthor)
    .map((m) => m.ts)
    .sort((a, b) => a - b);
  if (personaTimes.length < 30) {
    console.error(`Only ${personaTimes.length} persona messages — too few to split meaningfully.`);
    process.exit(2);
  }
  const cutoff = personaTimes[Math.floor(personaTimes.length * 0.7)];
  const train = convs.filter((c) => c.end <= cutoff);
  const holdout = convs.filter((c) => c.end > cutoff);
  console.log(`train: ${train.length} convs, holdout: ${holdout.length} convs (cutoff ${new Date(cutoff).toISOString().slice(0, 10)})`);

  const trainMsgs: Msg[] = train.flatMap((c) => c.messages);
  const stats = computeStats(trainMsgs);
  const exemplars = pickExemplars(train, personaAuthor);
  console.log('building persona card from the train split…');
  const card = await buildPersonaCard(train, personaAuthor, userAuthor, stats);
  const persona: PersonaFile = {
    builtAt: new Date(cutoff).toISOString(),
    source: 'eval',
    personaAuthor,
    userAuthor,
    card,
    exemplars,
    memories: [],
    stats,
  };

  // Replay: for each held-out persona reply, generate one from the preceding turn.
  const generated: string[] = [];
  outer: for (const c of holdout) {
    const msgs = c.messages.filter((m) => m.kind === 'text' && m.text);
    for (let i = 1; i < msgs.length; i++) {
      if (msgs[i].author !== personaAuthor) continue;
      if (msgs[i - 1].author === personaAuthor) continue; // need a user turn to reply to
      const history: ChatMessage[] = msgs.slice(Math.max(0, i - 8), i).map((m) => ({
        role: m.author === personaAuthor ? ('assistant' as const) : ('user' as const),
        content: m.text,
      }));
      const retrieved = retrieveMemories(persona, msgs[i - 1].text, 7);
      const system = buildSystemPrompt(persona, retrieved, new Date(cutoff));
      try {
        const reply = await complete({
          model: CHAT_MODEL,
          temperature: 0.8,
          maxTokens: 200,
          messages: [{ role: 'system', content: system }, ...history],
        });
        const firstLine = reply.split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? '';
        if (firstLine) {
          generated.push(firstLine);
          if (generated.length % 10 === 0) console.log(`  generated ${generated.length}…`);
        }
      } catch (e) {
        console.error('  generation error:', e instanceof Error ? e.message : String(e));
      }
      if (generated.length >= max) break outer;
    }
  }

  writeFileSync(out, generated.join('\n') + '\n', 'utf8');
  console.log(`\nwrote ${generated.length} generated replies → ${out}`);
  console.log(`now run:  npm run eval:persona ${path} --author "${personaAuthor}" --generated ${out}`);
}

void main();
