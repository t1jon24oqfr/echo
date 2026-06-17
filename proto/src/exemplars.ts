import type { Conversation } from './types.js';
import { renderConv } from './segment.js';

// Pick 15-30 representative snippets where the persona actually talks,
// spread across the whole time range (IMPersona used 15-38-message curated snippets).
export function pickExemplars(convs: Conversation[], personaAuthor: string, target = 24): string[] {
  const candidates = convs.filter((c) => {
    const personaMsgs = c.messages.filter((m) => m.author === personaAuthor && m.kind === 'text');
    return personaMsgs.length >= 3 && c.messages.length >= 5;
  });
  if (!candidates.length) return [];

  // Spread evenly over time, slightly biased to recent: take from all, then add extra recent ones.
  const picked: Conversation[] = [];
  const step = Math.max(1, Math.floor(candidates.length / Math.max(1, target - 6)));
  for (let i = 0; i < candidates.length && picked.length < target - 6; i += step) picked.push(candidates[i]);
  for (const c of candidates.slice(-6)) if (!picked.includes(c) && picked.length < target) picked.push(c);

  return picked.map((c) => windowAroundPersona(c, personaAuthor));
}

function windowAroundPersona(conv: Conversation, personaAuthor: string): string {
  // Take a 6-12 message window that contains the densest persona activity.
  const msgs = conv.messages.filter((m) => m.kind === 'text');
  const W = Math.min(12, msgs.length);
  let bestStart = 0;
  let bestScore = -1;
  for (let i = 0; i + W <= msgs.length; i++) {
    const score = msgs.slice(i, i + W).filter((m) => m.author === personaAuthor).length;
    if (score > bestScore) {
      bestScore = score;
      bestStart = i;
    }
  }
  const win = msgs.slice(bestStart, bestStart + W);
  return renderConv({ start: conv.start, end: conv.end, messages: win }, W);
}
