import { readFileSync } from 'node:fs';
import type { Msg } from '../types';
import { fixMojibake } from './_encoding';

interface IgMessage {
  sender_name: string;
  timestamp_ms: number;
  content?: string;
  photos?: unknown[];
  videos?: unknown[];
  audio_files?: unknown[];
  share?: unknown;
}
interface IgThread { participants: { name: string }[]; messages: IgMessage[] }

export function parseInstagramString(content: string): Msg[] {
  const raw = JSON.parse(content) as IgThread;
  const out: Msg[] = [];
  for (const m of raw.messages ?? []) {
    const author = fixMojibake(m.sender_name);
    const text = m.content ? fixMojibake(m.content).trim() : '';
    let kind: Msg['kind'] = 'text';
    if (m.audio_files?.length) kind = 'voice';
    else if (m.photos?.length || m.videos?.length || m.share) kind = 'media';
    if (kind === 'text' && !text) continue;
    // Skip Instagram system-ish strings
    if (/Reacted .* to your message|liked a message/i.test(text)) continue;
    out.push({ author, text, ts: m.timestamp_ms, kind });
  }
  // Instagram exports are newest-first
  return out.reverse();
}

export function parseInstagram(path: string): Msg[] {
  return parseInstagramString(readFileSync(path, 'utf8'));
}
