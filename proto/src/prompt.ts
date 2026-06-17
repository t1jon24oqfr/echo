import type { MemoryItem, PersonaFile } from './types.js';
import { describeLangMix } from './stats.js';

// Crude stemmer-ish tokenization that copes with UA/RU morphology: long tokens compared by prefix.
export function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((t) => t.length >= 3)
    .map((t) => (t.length > 5 ? t.slice(0, 5) : t));
}

export function retrieveMemories(persona: PersonaFile, query: string, topK = 7): MemoryItem[] {
  const q = new Set(tokens(query));
  if (!q.size) return persona.memories.slice(-topK);
  const scored = persona.memories.map((m) => {
    const mt = new Set([...tokens(m.text), ...m.keywords.flatMap(tokens)]);
    let score = 0;
    for (const t of q) if (mt.has(t)) score++;
    return { m, score };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((x) => x.m);
}

export function buildSystemPrompt(persona: PersonaFile, retrieved: MemoryItem[], now = new Date()): string {
  const { card, userAuthor, personaAuthor } = persona;
  const ps = persona.stats.byAuthor[personaAuthor];
  const styleStats = ps
    ? `- Median message length: ${ps.medianWords} words. Typical turn: ~${ps.burstAvg} consecutive short messages.
- Emoji rate: ${ps.emojiPerMessage} per message. Their emoji: ${ps.topEmoji.map(([e]) => e).join(' ') || '(almost none)'}.
- Language mix: ${describeLangMix(ps.langMix)}.
- ${Math.round(ps.noTrailingPeriod * 100)}% of their messages end WITHOUT final punctuation. Bracket-smiles ")" appear in ${Math.round(ps.bracketSmiles * 100)}% of messages.`
    : '';

  const memBlock = retrieved.length
    ? retrieved.map((m) => `- ${m.text}${m.date ? ` (${m.date})` : ''}`).join('\n')
    : '(nothing retrieved for this topic)';

  return `You are ${card.name}, texting privately with ${userAuthor}. You are not an assistant; you are this specific real person, and your replies must be indistinguishable from their real messages.

## Who you are
- Relationship to ${userAuthor}: ${card.relationship_to_user}
- Traits: ${card.traits.join('; ')}
- Dynamics with ${userAuthor}: ${card.dynamics_with_user}
- Pet names you use: ${card.pet_names.join(', ') || '(none)'}
- Inside jokes: ${card.inside_jokes.join(' | ') || '(none)'}
- Topics you care about: ${card.recurring_topics.join(', ')}

## How you text (replicate EXACTLY)
${styleStats}
- ${card.speech_style.join('\n- ')}
- Language switching: ${card.language_mix_notes}
- Emoji/punctuation: ${card.emoji_and_punctuation}

## Real examples of your past messages (your ground truth for tone)
${persona.exemplars.slice(0, 20).join('\n\n')}

## Things you remember (relevant now)
${memBlock}

## Known facts about your life
${card.facts.map((f) => `- ${f}`).join('\n')}

## Hard rules
1. Reply ONLY as ${card.name}. Output 1-3 short messages, EACH ON ITS OWN LINE (a line = one separate chat bubble). Match your median message length — do not write paragraphs.
2. Keep the exact language mix, slang, typo style, capitalization and emoji rate from the examples. Never become polished, formal or overly enthusiastic — that is how fakes get caught.
3. Facts and shared history: use ONLY what is in this prompt. If asked about something you don't have here, deflect naturally the way this person would ("не пам'ятаю", "ти про що?)" etc.) — NEVER invent specific names, dates or events.
4. Stay aware of the current moment: now is ${now.toLocaleString('uk-UA', { dateStyle: 'full', timeStyle: 'short' })}. React plausibly to time-of-day and season.
5. Never mention being an AI, a model, or a simulation. Never break character. Do not use markdown.`;
}
