import { readFileSync } from 'node:fs';
import { parse, HTMLElement, Node, NodeType, TextNode } from 'node-html-parser';
import type { Msg } from '../types';

// VK archive: messages/<peerId>/messages*.html. The frontend decodes each
// page file from CP1251 -> UTF-8 and concatenates one dialog's pages in
// ascending numeric order, sending the already-decoded UTF-8 HTML here.
// DO NOT use fixMojibake — the input is clean UTF-8.

// VK uses GENITIVE month names; note 'мая' (not 'май').
const MONTHS: Record<string, number> = {
  янв: 1, фев: 2, мар: 3, апр: 4, мая: 5, июн: 6,
  июл: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12,
};

const DATE_RE = /^(\d{1,2})\s+([а-я]{3})\s+(\d{4})\s+в\s+(\d{1,2}):(\d{2}):(\d{2})$/i;

// VK voice-note marker; other localized attachment type labels → 'media'.
const VOICE_LABEL = 'Голосовое сообщение';
const MEDIA_LABELS = new Set([
  'Фотография', 'Видеозапись', 'Аудиозапись', 'Документ', 'Стикер', 'Запись со стены', 'Ссылка',
]);

function decodeMentions(s: string): string {
  // [id123|Имя] or [club5|Группа] → keep the display text (group 2).
  return s.replace(/\[([^|\]]+)\|([^\]]+)\]/g, (_m, _id, name) => name);
}

/** Collect visible body text from the message, skipping header/kludges/attachment,
 *  turning <br> into '\n'. */
function extractBody(message: HTMLElement): string {
  let out = '';
  const walk = (node: Node) => {
    if (node.nodeType === NodeType.TEXT_NODE) {
      out += (node as TextNode).text;
      return;
    }
    if (node.nodeType !== NodeType.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = (el.rawTagName || '').toLowerCase();
    if (tag === 'br') {
      out += '\n';
      return;
    }
    const cls = el.classList;
    // Skip the header line and the kludges/attachment blocks entirely.
    if (cls.contains('message__header') || cls.contains('kludges') || cls.contains('attachment')) return;
    for (const child of el.childNodes) walk(child);
  };
  for (const child of message.childNodes) walk(child);
  return out;
}

function classifyAttachment(message: HTMLElement): Msg['kind'] | null {
  const att = message.querySelector('div.attachment');
  if (!att) return null;
  if (att.querySelector("a.attachment__link[href*='audiomsg']")) {
    const link = att.querySelector("a.attachment__link[href*='audiomsg']");
    if (link && /audiomsg\/.+\.ogg/i.test(link.getAttribute('href') ?? '')) return 'voice';
  }
  const desc = att.querySelector('.attachment__description')?.textContent.trim() ?? '';
  if (desc === VOICE_LABEL) return 'voice';
  if (MEDIA_LABELS.has(desc)) return 'media';
  // Unknown attachment → media.
  return 'media';
}

/** Parse ONE dialog's already-decoded, concatenated UTF-8 HTML.
 *  `ownerName` (optional) is the stable display name used for the archive
 *  owner's 'Вы' messages; defaults to the literal 'Вы' so a value is always
 *  consistent across pages. */
export function parseVkString(content: string, ownerName = 'Вы'): Msg[] {
  const root = parse(content);
  const out: Msg[] = [];

  for (const message of root.querySelectorAll('div.message')) {
    // System messages (created/renamed chat, pinned, joined/left, calls…).
    if (message.querySelector('div.kludges a.im_srv_lnk, div.kludges b.im_srv_lnk')) continue;

    const header = message.querySelector('div.message__header');
    if (!header) continue;

    // Strip an "(ред.)" edited badge before reading the date.
    let headerText = header.textContent;
    headerText = headerText.replace(/\(ред\.\)/g, '').replace(/\s+/g, ' ').trim();

    const comma = headerText.lastIndexOf(',');
    if (comma < 0) continue;
    let author = headerText.slice(0, comma).trim();
    const dateStr = headerText.slice(comma + 1).trim();

    const dm = DATE_RE.exec(dateStr);
    if (!dm) continue;
    const day = Number(dm[1]);
    const mon = MONTHS[dm[2].toLowerCase()];
    const year = Number(dm[3]);
    const hh = Number(dm[4]);
    const mm = Number(dm[5]);
    const ss = Number(dm[6]);
    if (!mon) continue;
    // VK times are Moscow (UTC+3), no offset in the file → build as UTC then -3h.
    const ts = Date.UTC(year, mon - 1, day, hh - 3, mm, ss);

    // Normalize the owner 'Вы' to a stable display name BEFORE counting.
    if (author === 'Вы') author = ownerName;
    if (!author) continue;

    const attKind = classifyAttachment(message);
    let kind: Msg['kind'] = attKind ?? 'text';
    let text = '';
    if (kind === 'text') {
      text = decodeMentions(extractBody(message)).trim();
      if (!text) continue;
    }

    out.push({ author, text, ts, kind });
  }

  return out;
}

export function parseVk(path: string, ownerName = 'Вы'): Msg[] {
  return parseVkString(readFileSync(path, 'utf8'), ownerName);
}
