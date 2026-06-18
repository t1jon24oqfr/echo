/**
 * Layer-2 persona-fidelity judge (N11) — a CI GATE, never the verdict.
 *
 *   npm run eval:judge <corpus.json> --generated replies.txt [--author "Name"] [--max 20]
 *
 * A NON-Qwen judge (default a Llama model via OpenRouter, override with JUDGE_MODEL)
 * scores each generated reply 1-5 on three axes, anchored with real reference
 * messages to cut variance:
 *   - linguistic : matches the person's texting habits (length, slang, emoji, code-switch)
 *   - consistency: in character / plausible for this person
 *   - grounded   : does NOT assert a specific biographical fact absent from the reference
 *                  (5 = no invented facts, 1 = confident fabrication)
 * Using a different model family than the generator avoids self-preference bias.
 * PersonaEval caveat: even the best LLM judges ~69% vs humans 90.8% — this gates
 * regressions, the Layer-3 human blind test owns the verdict.
 */
import { readFileSync } from 'node:fs';
import { completeJson, hasApiKey } from '../engine/llm.js';

interface Corpus {
  personaAuthor?: string;
  conversations?: { messages: { author: string; text: string; ts: number; kind: string }[] }[];
}
interface Score {
  linguistic: number;
  consistency: number;
  grounded: number;
  note?: string;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const clamp5 = (n: unknown): number => Math.max(1, Math.min(5, typeof n === 'number' ? n : 3));

async function main(): Promise<void> {
  const path = process.argv[2];
  const genPath = arg('--generated');
  if (!path || !genPath) {
    console.error('usage: npm run eval:judge <corpus.json> --generated replies.txt [--author "Name"] [--max 20]');
    process.exit(2);
  }
  if (!hasApiKey()) {
    console.error('OPENROUTER_API_KEY is required for the judge.');
    process.exit(2);
  }
  const judge = process.env.JUDGE_MODEL || 'meta-llama/llama-3.3-70b-instruct';
  const corpus = JSON.parse(readFileSync(path, 'utf8')) as Corpus;
  const personaAuthor = arg('--author') ?? corpus.personaAuthor ?? '';
  const max = Number(arg('--max') ?? '20');

  const personaMsgs = (corpus.conversations ?? [])
    .flatMap((c) => c.messages)
    .filter((m) => m.author === personaAuthor && m.kind === 'text' && m.text.trim())
    .sort((a, b) => a.ts - b.ts)
    .map((m) => m.text);
  // Anchor with a spread of real reference messages (NOT the held-out tail used to
  // generate, to keep the judge honest): take a sample from the first 70%.
  const ref = personaMsgs.slice(0, Math.floor(personaMsgs.length * 0.7));
  const anchors = ref.filter((_, i) => i % Math.max(1, Math.floor(ref.length / 15)) === 0).slice(0, 15);
  if (anchors.length < 5) {
    console.error('Not enough reference messages to anchor the judge.');
    process.exit(2);
  }

  const generated = readFileSync(genPath, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, max);
  console.log(`judge=${judge}  anchors=${anchors.length}  scoring ${generated.length} replies…\n`);

  const sys =
    'You judge whether a generated chat reply matches a SPECIFIC real person, given reference messages they actually wrote. Score 1-5 (integers) on: "linguistic" (matches their texting habits — length, slang, emoji, punctuation, code-switching), "consistency" (in character / plausible for them), "grounded" (5 = invents no specific biographical fact absent from the reference; 1 = confidently fabricates one). Return ONLY JSON {"linguistic":n,"consistency":n,"grounded":n,"note":"<=10 words"}.';

  const scores: Score[] = [];
  for (const reply of generated) {
    try {
      const s = await completeJson<Score>({
        model: judge,
        temperature: 0,
        maxTokens: 120,
        messages: [
          { role: 'system', content: sys },
          {
            role: 'user',
            content: `Reference messages by "${personaAuthor}":\n${anchors.map((a) => `- ${a}`).join('\n')}\n\nGenerated reply to score:\n"${reply}"\n\nReturn the JSON.`,
          },
        ],
      });
      scores.push({
        linguistic: clamp5(s.linguistic),
        consistency: clamp5(s.consistency),
        grounded: clamp5(s.grounded),
        note: typeof s.note === 'string' ? s.note : '',
      });
    } catch (e) {
      console.error('  judge error:', e instanceof Error ? e.message : String(e));
    }
  }
  if (!scores.length) {
    console.error('No replies scored.');
    process.exit(1);
  }

  const mean = (k: keyof Score): number =>
    +(scores.reduce((a, s) => a + (s[k] as number), 0) / scores.length).toFixed(2);
  const ling = mean('linguistic');
  const cons = mean('consistency');
  const grnd = mean('grounded');
  const overall = +(((ling + cons + grnd) / 3)).toFixed(2);
  const lowGrounded = scores.filter((s) => s.grounded <= 2).length;

  console.log(`linguistic   ${ling}/5`);
  console.log(`consistency  ${cons}/5`);
  console.log(`grounded     ${grnd}/5   (${lowGrounded} replies flagged for possible fabricated facts)`);
  console.log(`\noverall      ${overall}/5  over ${scores.length} replies`);
  console.log('Gate, not truth — pair with the Layer-1 style band and a human blind test.');
  // A confident false memory is a safety incident: fail if any reply is badly ungrounded.
  process.exit(lowGrounded > 0 || overall < 3.2 ? 1 : 0);
}

void main();
