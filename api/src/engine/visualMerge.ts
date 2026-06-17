// Merge per-frame extraction into one ordered message list + two derived authors.
//
// Frames are chronological (the user scrolls oldest→newest while recording), so
// we concatenate rows in frame order, drop system rows, keep date rows to anchor
// day windows, then collapse the overlap that scrolling produces (the same
// bubbles re-appear across consecutive frames) via a fuzzy side+text key.
// Timestamps are SYNTHETIC and approximate (this path is lossy): we anchor to any
// detected date separator / printed clock time and otherwise space messages
// sequentially, always strictly monotonic. The output is the SAME corpus shape
// the file parsers feed in: Msg[] = {author,text,ts,kind}.
import type { Msg } from './types';
import type { VisualRow } from './visualExtract';

export interface MergeResult {
  messages: Msg[];
  importAuthors: { name: string; count: number }[];
  /** Always true for this path — surfaced to the API so the UI can be honest. */
  approximate: true;
}

const RIGHT_LABEL = 'Right (you)';
const LEFT_LABEL = 'Left';

/** Fuzzy key for dedup: side + normalized text (trim, lowercase, strip trailing punct/space). */
function fuzzyKey(side: string, text: string): string {
  const norm = text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.,!?…)»"']+$/u, '');
  return `${side}|${norm}`;
}

/** "14:05" / "2:05 pm" / "9.07" → minutes since midnight, or null. */
function parseClock(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = time.match(/(\d{1,2})[:.](\d{2})\s*(am|pm|AM|PM)?/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Best-effort parse of a centered date row → epoch ms at local midnight, or null. */
function parseDate(text: string): number | null {
  const t = text.trim();
  const now = new Date();
  if (/^(today|сьогодні|сегодня)$/i.test(t)) return startOfDay(now.getTime());
  if (/^(yesterday|вчора|вчера)$/i.test(t)) return startOfDay(now.getTime() - 86400_000);
  const parsed = Date.parse(t);
  if (!Number.isNaN(parsed)) return startOfDay(parsed);
  // "12 June", "June 12", "12.06.2025", "06/12/2025"
  const dmy = t.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (dmy) {
    const [, a, b, y] = dmy;
    const yr = Number(y.length === 2 ? `20${y}` : y);
    const d = Number(a);
    const mo = Number(b);
    const ms = new Date(yr, Math.min(11, Math.max(0, mo - 1)), Math.min(31, Math.max(1, d))).getTime();
    if (!Number.isNaN(ms)) return startOfDay(ms);
  }
  return null;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function sideToKind(kind: VisualRow['kind']): Msg['kind'] {
  if (kind === 'media') return 'media';
  return 'text';
}

export function mergeVisual(perFrame: VisualRow[][]): MergeResult {
  // 1) Flatten in frame order, dropping system rows; keep date rows inline as anchors.
  const flat: VisualRow[] = [];
  for (const rows of perFrame) {
    for (const r of rows) {
      if (r.kind === 'system') continue;
      flat.push(r);
    }
  }

  // 2) Collapse scroll-overlap. Because the user scrolls in one direction, a
  // bubble only repeats within a short window; we keep insertion order and skip
  // any row whose fuzzy key matches one seen in the recent window.
  const WINDOW = 60;
  const recent: string[] = [];
  const recentSet = new Set<string>();
  const deduped: VisualRow[] = [];
  for (const r of flat) {
    if (r.kind === 'media') {
      deduped.push(r); // media has empty text; don't dedup by text
      continue;
    }
    const key = fuzzyKey(r.kind === 'date' ? 'date' : r.side, r.text);
    if (r.text.trim() && recentSet.has(key)) continue;
    deduped.push(r);
    recent.push(key);
    recentSet.add(key);
    if (recent.length > WINDOW) {
      const old = recent.shift()!;
      // only drop from the set if no other recent entry holds it
      if (!recent.includes(old)) recentSet.delete(old);
    }
  }

  // 3) Derive author labels. Prefer detected sender names; else side placeholders.
  //    right => "me"/you label, left => other. Names map per side (a chat is 1:1).
  const sideName: Record<'left' | 'right', string> = { left: LEFT_LABEL, right: RIGHT_LABEL };
  for (const r of deduped) {
    if (r.kind === 'message' || r.kind === 'media') {
      if (r.sender && (r.side === 'left' || r.side === 'right')) {
        // first non-empty sender for that side wins
        if (sideName[r.side] === (r.side === 'right' ? RIGHT_LABEL : LEFT_LABEL)) {
          sideName[r.side] = r.sender;
        }
      }
    }
  }

  // 4) Build Msg[] with synthetic monotonic timestamps.
  let dayAnchor = startOfDay(Date.now());
  let cursor = dayAnchor; // current epoch-ms write head
  const STEP = 45_000; // 45s between sequential messages within a day
  const messages: Msg[] = [];
  const counts = new Map<string, number>();

  for (const r of deduped) {
    if (r.kind === 'date') {
      const d = parseDate(r.text);
      if (d !== null) {
        dayAnchor = d;
        cursor = Math.max(cursor + STEP, d); // never go backwards
      }
      continue; // date rows anchor, they are not messages
    }
    if (r.side === 'center') continue; // centered non-date → ignore as noise

    const author = sideName[r.side as 'left' | 'right'];
    // anchor to printed clock time when present, else step forward
    let ts = cursor + STEP;
    const mins = parseClock(r.time);
    if (mins !== null) {
      const candidate = dayAnchor + mins * 60_000;
      ts = Math.max(cursor + 1000, candidate); // keep strictly monotonic
    }
    cursor = ts;
    messages.push({ author, text: r.text, ts, kind: sideToKind(r.kind) });
    counts.set(author, (counts.get(author) ?? 0) + 1);
  }

  const importAuthors = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  return { messages, importAuthors, approximate: true };
}
