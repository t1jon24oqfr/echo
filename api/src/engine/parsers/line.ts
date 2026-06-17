import { readFileSync } from 'node:fs';
import type { Msg } from '../types';

// LINE mobile "Export chat" produces a single UTF-8 .txt:
//   [LINE] Chat history with <Name>
//   Saved on: 2024.01.02 12:34
//
//   2017.09.03 Sunday
//   12:05\t<Name>\t<message text...>
//   1:07 PM\t<Name>\t<message>
// Date-section headers carry y/m/d; message lines are TAB-delimited
// (time, author, text); anything else is a continuation of the prior
// message. NO fixMojibake — the file is already clean UTF-8.

const DATE_HEADER = /^(\d{4})\.(\d{2})\.(\d{2})\s+\S+$/;
// Message line starts with a 24h or 12h time followed by a TAB.
const MSG_LINE = /^(\d{1,2}:\d{2})(\s?[AP]M)?\t/i;

// Bracketed placeholders LINE writes for non-text content → 'media'.
const MEDIA_PLACEHOLDERS = new Set(
  ['[photo]', '[sticker]', '[video]', '[file]', '[voice message]', '[contact]', '[album]', '[location]'].map((s) =>
    s.toLowerCase(),
  ),
);

// Call / unsent / membership lines → system (drop, do not emit).
const SYSTEM_RE =
  /^(☎|✆)|\bcall time\b|missed call|canceled call|cancelled call|no answer|unsent a message|unsent the message/i;

function parseTime(time: string, meridiem: string | undefined): { hh: number; mm: number } | null {
  const [hStr, mStr] = time.split(':');
  let hh = Number(hStr);
  const mm = Number(mStr);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  if (meridiem) {
    const ap = meridiem.trim().toUpperCase();
    if (ap === 'PM' && hh < 12) hh += 12;
    if (ap === 'AM' && hh === 12) hh = 0;
  }
  return { hh, mm };
}

function classify(author: string, text: string): Msg['kind'] | 'system' {
  const t = text.trim();
  // Call / unsent / membership lines are system. They may carry the marker in
  // the text OR (when there is no author column) in the author field itself.
  if (SYSTEM_RE.test(t) || SYSTEM_RE.test(author)) return 'system';
  const lower = t.toLowerCase();
  if (MEDIA_PLACEHOLDERS.has(lower)) return 'media';
  // Any unknown bracketed-only token defaults to media.
  if (/^\[[^\]]+\]$/.test(t)) return 'media';
  return 'text';
}

export function parseLineString(content: string): Msg[] {
  // Strip a leading BOM if present.
  const body = content.replace(/^﻿/, '');
  const lines = body.split(/\r?\n/);

  // Desktop "Save chat" export is SPACE-delimited, not TAB. If no line in
  // the whole file looks like a TAB-delimited message line, reject (so the
  // service surfaces the standard "could not read" error).
  if (!lines.some((l) => MSG_LINE.test(l))) {
    throw new Error('LINE export is not TAB-delimited (desktop/space export unsupported)');
  }

  const out: Msg[] = [];
  let y = 0;
  let m = 0;
  let d = 0;
  let cur: Msg | null = null;

  const flush = () => {
    if (!cur) return;
    if (cur.kind === 'text') {
      cur.text = cur.text.trim();
      if (cur.text) out.push(cur);
    } else {
      cur.text = '';
      out.push(cur);
    }
    cur = null;
  };

  for (const line of lines) {
    const dh = DATE_HEADER.exec(line);
    if (dh) {
      flush();
      y = Number(dh[1]);
      m = Number(dh[2]);
      d = Number(dh[3]);
      continue;
    }

    const mh = MSG_LINE.exec(line);
    if (mh && y) {
      flush();
      const parts = line.split('\t');
      const time = parts[0];
      const author = (parts[1] ?? '').trim();
      const text = parts.slice(2).join('\t');
      const tm = parseTime(mh[1], mh[2]);
      if (!tm) continue;
      const ts = new Date(y, m - 1, d, tm.hh, tm.mm).getTime();
      const kind = classify(author, text);
      if (kind === 'system') {
        cur = null; // swallow this and its continuations
        continue;
      }
      cur = { author, text, ts, kind };
      continue;
    }

    // Continuation line — append to the current message (preserve blanks).
    if (cur) {
      cur.text += '\n' + line;
    }
    // (lines before the first date header / before any message are preamble; ignored)
  }
  flush();
  return out;
}

export function parseLine(path: string): Msg[] {
  return parseLineString(readFileSync(path, 'utf8'));
}
