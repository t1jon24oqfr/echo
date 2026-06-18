/**
 * Per-character LoRA data-prep (N9 / rank 13) — the "Deep Persona" paid tier.
 *
 *   npm run lora:dataprep <corpus.json> [--out train.jsonl] [--author "Name"] [--min 500]
 *
 * Turns a chat corpus into a chat-format JSONL of (context → real persona reply)
 * training pairs for QLoRA (see scripts/lora/train_lora.py). The system prompt is
 * intentionally MINIMAL: the LoRA learns STYLE only — biographical facts stay on
 * the inference-time fact-sheet + grounding guard, because a higher-fidelity voice
 * that confabulates is worse for a grieving user. GATED: below ~500-1000 real
 * messages a LoRA only matches prompting, so this warns and is meant to be gated
 * off in product for thin corpora.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Conversation, Msg } from '../engine/types.js';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface CorpusFile {
  personaAuthor?: string;
  userAuthor?: string;
  conversations?: Conversation[];
}

interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const MAX_CONTEXT = 8; // preceding turns of context per example
const MIN_REPLY_CHARS = 2;
const MAX_REPLY_WORDS = 80; // drop over-long monologues (style training wants chat-sized)

function main(): void {
  const path = process.argv[2];
  if (!path || path.startsWith('--')) {
    console.error('usage: npm run lora:dataprep <corpus.json> [--out train.jsonl] [--author "Name"] [--min 500]');
    process.exit(2);
  }
  const corpus = JSON.parse(readFileSync(path, 'utf8')) as CorpusFile;
  const convs = corpus.conversations ?? [];
  const personaAuthor = arg('--author') ?? corpus.personaAuthor ?? '';
  const userAuthor = corpus.userAuthor ?? 'them';
  const minMsgs = Number(arg('--min') ?? '500');
  const out = arg('--out') ?? `${path.replace(/\.json$/, '')}.lora.jsonl`;
  if (!personaAuthor || !convs.length) {
    console.error('Need conversations + a persona author (pass --author).');
    process.exit(2);
  }

  const personaMsgCount = convs
    .flatMap((c) => c.messages)
    .filter((m) => m.author === personaAuthor && m.kind === 'text').length;
  if (personaMsgCount < minMsgs) {
    console.warn(
      `⚠  Only ${personaMsgCount} persona messages (< ${minMsgs}). Below the LoRA floor a ` +
        `per-character adapter only matches prompting — gate this tier OFF for this persona ` +
        `and stay on the Phase-0 prompt+retrieval spine. Writing the dataset anyway for inspection.`,
    );
  }

  const sys = `You are ${personaAuthor}, texting privately with ${userAuthor}. Reply ONLY as ${personaAuthor}, in their exact real texting style — same length, slang, emoji, punctuation and language mix. Never sound like an assistant.`;

  const examples: { messages: ChatTurn[] }[] = [];
  for (const c of convs) {
    const msgs: Msg[] = c.messages.filter((m) => m.kind === 'text' && m.text.trim());
    for (let i = 1; i < msgs.length; i++) {
      if (msgs[i].author !== personaAuthor) continue;
      if (msgs[i - 1].author === personaAuthor) continue; // want a user turn to answer
      const reply = msgs[i].text.trim();
      if (reply.length < MIN_REPLY_CHARS) continue;
      if (reply.split(/\s+/).length > MAX_REPLY_WORDS) continue; // over-long → skip (quality filter)
      // Collapse a same-author burst that follows into one target reply.
      let j = i;
      const burst: string[] = [reply];
      while (j + 1 < msgs.length && msgs[j + 1].author === personaAuthor && burst.length < 3) {
        burst.push(msgs[j + 1].text.trim());
        j++;
      }
      const context: ChatTurn[] = msgs.slice(Math.max(0, i - MAX_CONTEXT), i).map((m) => ({
        role: m.author === personaAuthor ? ('assistant' as const) : ('user' as const),
        content: m.text.trim(),
      }));
      if (!context.length) continue;
      examples.push({
        messages: [{ role: 'system', content: sys }, ...context, { role: 'assistant', content: burst.join('\n') }],
      });
      i = j;
    }
  }

  // Down-sample near-duplicate targets so a few repeated "ок"/"ага" don't dominate
  // (keep every 7th repeat — deterministic, preserves some natural frequency).
  const repeatCount = new Map<string, number>();
  const deduped = examples.filter((e) => {
    const last = e.messages[e.messages.length - 1].content.toLowerCase().slice(0, 40);
    const n = (repeatCount.get(last) ?? 0) + 1;
    repeatCount.set(last, n);
    return n === 1 || n % 7 === 0;
  });

  writeFileSync(out, deduped.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  console.log(`wrote ${deduped.length} training pairs (${personaMsgCount} persona msgs) → ${out}`);
  console.log('train with: python scripts/lora/train_lora.py --data ' + out + ' --persona <id>');
}

main();
