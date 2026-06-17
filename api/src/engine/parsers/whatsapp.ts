import { readFileSync } from 'node:fs';
import { parseString } from 'whatsapp-chat-parser';
import type { Msg } from '../types';

const MEDIA_MARKERS = [
  'image omitted', 'video omitted', 'sticker omitted', 'GIF omitted', 'document omitted',
  '<Media omitted>', '‎image', '‎video', '‎sticker',
];
const VOICE_MARKERS = ['audio omitted', '.opus', 'PTT-', '‎audio'];

export function parseWhatsAppString(content: string): Msg[] {
  const parsed = parseString(content, { parseAttachments: true });
  const out: Msg[] = [];
  for (const m of parsed) {
    if (!m.author) continue; // system messages
    const text = (m.message ?? '').trim();
    const attachment = (m as { attachment?: { fileName: string } }).attachment;
    let kind: Msg['kind'] = 'text';
    if (attachment) {
      kind = /\.(opus|m4a|ogg)$/i.test(attachment.fileName) ? 'voice' : 'media';
    } else if (VOICE_MARKERS.some((s) => text.includes(s))) {
      kind = 'voice';
    } else if (MEDIA_MARKERS.some((s) => text.includes(s))) {
      kind = 'media';
    }
    if (kind === 'text' && !text) continue;
    out.push({ author: m.author, text: kind === 'text' ? text : '', ts: m.date.getTime(), kind });
  }
  return out;
}

export function parseWhatsApp(path: string): Msg[] {
  return parseWhatsAppString(readFileSync(path, 'utf8'));
}
