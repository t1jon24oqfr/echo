import { readFileSync } from 'node:fs';
import type { Msg } from '../types';

interface TgTextEntity { type: string; text: string }
interface TgMessage {
  id: number;
  type: string; // 'message' | 'service'
  date: string; // '2021-02-14T23:47:12'
  from?: string;
  text: string | (string | TgTextEntity)[];
  media_type?: string;
  photo?: string;
  file?: string;
}
interface TgExport { name?: string; messages: TgMessage[] }

function flattenText(t: TgMessage['text']): string {
  if (typeof t === 'string') return t;
  return t.map((p) => (typeof p === 'string' ? p : p.text)).join('');
}

export function parseTelegramString(content: string): Msg[] {
  const raw = JSON.parse(content) as TgExport;
  const out: Msg[] = [];
  for (const m of raw.messages ?? []) {
    if (m.type !== 'message' || !m.from) continue;
    const text = flattenText(m.text).trim();
    let kind: Msg['kind'] = 'text';
    if (m.media_type === 'voice_message') kind = 'voice';
    else if (m.media_type || m.photo || m.file) kind = 'media';
    if (kind === 'text' && !text) continue;
    out.push({ author: m.from, text, ts: new Date(m.date).getTime(), kind });
  }
  return out;
}

export function parseTelegram(path: string): Msg[] {
  return parseTelegramString(readFileSync(path, 'utf8'));
}
