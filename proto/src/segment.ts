import type { Conversation, Msg } from './types.js';

const GAP_MS = 6 * 60 * 60 * 1000; // IMPersona recipe: new conversation after >6h silence

export function segment(messages: Msg[], sinceMonths?: number): Conversation[] {
  let msgs = [...messages].sort((a, b) => a.ts - b.ts);
  if (sinceMonths && msgs.length) {
    const cutoff = msgs[msgs.length - 1].ts - sinceMonths * 30.44 * 24 * 3600 * 1000;
    msgs = msgs.filter((m) => m.ts >= cutoff);
  }
  const convs: Conversation[] = [];
  let cur: Msg[] = [];
  for (const m of msgs) {
    if (cur.length && m.ts - cur[cur.length - 1].ts > GAP_MS) {
      convs.push({ start: cur[0].ts, end: cur[cur.length - 1].ts, messages: cur });
      cur = [];
    }
    cur.push(m);
  }
  if (cur.length) convs.push({ start: cur[0].ts, end: cur[cur.length - 1].ts, messages: cur });
  return convs;
}

export function renderConv(conv: Conversation, maxMessages = 60): string {
  const date = new Date(conv.start).toISOString().slice(0, 10);
  const msgs = conv.messages.slice(0, maxMessages);
  const lines = msgs.map((m) => {
    const body = m.kind === 'text' ? m.text : `[${m.kind}]`;
    return `${m.author}: ${body}`;
  });
  return `--- ${date} ---\n${lines.join('\n')}`;
}
