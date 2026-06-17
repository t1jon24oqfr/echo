import { readFileSync } from 'node:fs';
import type { Msg } from '../types.js';

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

// Meta serializes UTF-8 bytes as latin-1 escapes; without this fix all Cyrillic is mojibake.
function fixMojibake(s: string): string {
  try {
    return Buffer.from(s, 'latin1').toString('utf8');
  } catch {
    return s;
  }
}

export function parseInstagram(path: string): Msg[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as IgThread;
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
