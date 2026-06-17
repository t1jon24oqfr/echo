import type { Conversation, CorpusStats, MemoryItem, PersonaCard } from './types.js';
import { renderConv } from './segment.js';
import { describeLangMix } from './stats.js';
import { completeJson, EXTRACT_MODEL } from './llm.js';

export async function buildPersonaCard(
  convs: Conversation[],
  personaAuthor: string,
  userAuthor: string,
  stats: CorpusStats,
): Promise<PersonaCard> {
  const sample = sampleForCard(convs);
  const ps = stats.byAuthor[personaAuthor];
  const statLine = ps
    ? `Computed stats for ${personaAuthor}: median ${ps.medianWords} words/message, ${ps.emojiPerMessage} emoji/message (top: ${ps.topEmoji.map(([e]) => e).join(' ')}), language mix: ${describeLangMix(ps.langMix)}, ${Math.round(ps.noTrailingPeriod * 100)}% of messages end without punctuation, bracket-smiles ")" in ${Math.round(ps.bracketSmiles * 100)}% of messages, ~${ps.burstAvg} consecutive messages per turn.`
    : '';

  return completeJson<PersonaCard>({
    model: EXTRACT_MODEL,
    maxTokens: 3000,
    messages: [
      {
        role: 'system',
        content:
          'You analyze real chat history to build a precise persona profile of ONE participant. Be concrete and evidence-based: quote their actual phrases, nicknames, jokes. Write field values in the same language(s) the person uses. Return ONLY valid JSON, no markdown.',
      },
      {
        role: 'user',
        content: `Build a persona profile of "${personaAuthor}" (their chat partner is "${userAuthor}").
${statLine}

Return JSON with exactly these keys:
{
  "name": string,
  "relationship_to_user": string,            // who they are to ${userAuthor}, inferred from the chat
  "traits": string[],                        // 5-10 personality traits with evidence
  "speech_style": string[],                  // 5-12 concrete texting habits (length, slang, typos, capitalization, how they greet, how they laugh)
  "language_mix_notes": string,              // how/when they switch languages, transliteration habits, surzhyk
  "emoji_and_punctuation": string,           // exact emoji they use and when; punctuation quirks
  "pet_names": string[],                     // what they call ${userAuthor} and others
  "inside_jokes": string[],                  // recurring jokes/references with brief context
  "recurring_topics": string[],
  "dynamics_with_user": string,              // tone of the relationship: who initiates, teasing, conflicts, affection
  "facts": string[]                          // 10-25 concrete biographical facts (work, family, places, dates) ONLY if stated in the chat
}

CHAT EXCERPTS:
${sample}`,
      },
    ],
  });
}

function sampleForCard(convs: Conversation[]): string {
  // ~150 recent messages + ~100 spread across earlier history, capped to ~24k chars.
  const parts: string[] = [];
  const recent = convs.slice(-8);
  const earlier = convs.slice(0, -8);
  const step = Math.max(1, Math.floor(earlier.length / 8));
  const sampled = earlier.filter((_, i) => i % step === 0).slice(0, 8);
  for (const c of [...sampled, ...recent]) parts.push(renderConv(c, 25));
  let out = parts.join('\n\n');
  if (out.length > 24000) out = out.slice(out.length - 24000);
  return out;
}

export async function extractMemories(convs: Conversation[], personaAuthor: string, userAuthor: string): Promise<MemoryItem[]> {
  const maxCalls = Number(process.env.MAX_MEMORY_CALLS ?? 30);
  const batches = batchConversations(convs, 6000, maxCalls);
  const all: MemoryItem[] = [];
  let i = 0;
  for (const batch of batches) {
    i++;
    process.stdout.write(`\r  memory extraction: batch ${i}/${batches.length}   `);
    try {
      const items = await completeJson<MemoryItem[]>({
        model: EXTRACT_MODEL,
        maxTokens: 2500,
        messages: [
          {
            role: 'system',
            content:
              'You extract durable memories/facts from chat excerpts for a memory system. Only include things worth remembering long-term: events, plans, people, places, feelings, conflicts, promises, inside jokes. Skip small talk. Write each memory in the dominant language of the excerpt. Return ONLY a valid JSON array.',
          },
          {
            role: 'user',
            content: `Chat between "${personaAuthor}" and "${userAuthor}". Extract 0-12 memories as JSON:
[{"text": "one self-contained sentence, from ${personaAuthor}'s point of view", "keywords": ["3-6 lowercase keywords"], "date": "YYYY-MM"}]

EXCERPTS:
${batch}`,
          },
        ],
      });
      if (Array.isArray(items)) all.push(...items.filter((m) => m && typeof m.text === 'string'));
    } catch (e) {
      console.warn(`\n  batch ${i} failed, skipping: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  process.stdout.write('\n');
  return dedupeMemories(all);
}

function batchConversations(convs: Conversation[], maxChars: number, maxBatches: number): string[] {
  // Sample conversations evenly across time so memories cover the whole relationship.
  const meaningful = convs.filter((c) => c.messages.filter((m) => m.kind === 'text').length >= 4);
  const batches: string[] = [];
  let cur = '';
  for (const c of meaningful) {
    const r = renderConv(c, 40);
    if (cur && cur.length + r.length > maxChars) {
      batches.push(cur);
      cur = '';
    }
    cur += (cur ? '\n\n' : '') + r;
  }
  if (cur) batches.push(cur);
  if (batches.length <= maxBatches) return batches;
  const step = batches.length / maxBatches;
  return Array.from({ length: maxBatches }, (_, i) => batches[Math.floor(i * step)]);
}

function dedupeMemories(items: MemoryItem[]): MemoryItem[] {
  const seen = new Set<string>();
  const out: MemoryItem[] = [];
  for (const m of items) {
    const key = m.text.toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: m.text, keywords: m.keywords ?? [], date: m.date ?? '' });
  }
  return out;
}
