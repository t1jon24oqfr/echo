import type { AuthorStats, CorpusStats, Msg } from './types.js';

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

export function detectLang(s: string): string {
  const ua = (s.match(/[іїєґІЇЄҐ]/g) ?? []).length;
  const ru = (s.match(/[ыэъёЫЭЪЁ]/g) ?? []).length;
  const cyr = (s.match(/[Ѐ-ӿ]/g) ?? []).length;
  const lat = (s.match(/[a-zA-Z]/g) ?? []).length;
  if (cyr === 0 && lat === 0) return 'other';
  if (cyr >= lat) {
    if (ua > ru) return 'uk';
    if (ru > ua) return 'ru';
    return 'cyr';
  }
  return 'en';
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function computeStats(messages: Msg[]): CorpusStats {
  const byAuthor: Record<string, AuthorStats> = {};
  const grouped = new Map<string, Msg[]>();
  for (const m of messages) {
    if (!grouped.has(m.author)) grouped.set(m.author, []);
    grouped.get(m.author)!.push(m);
  }

  for (const [author, msgs] of grouped) {
    const texts = msgs.filter((m) => m.kind === 'text' && m.text);
    const words = texts.map((m) => m.text.split(/\s+/).filter(Boolean).length);
    const emojiCounts = new Map<string, number>();
    let emojiTotal = 0;
    let noPeriod = 0;
    let brackets = 0;
    for (const m of texts) {
      for (const e of m.text.match(EMOJI_RE) ?? []) {
        emojiTotal++;
        emojiCounts.set(e, (emojiCounts.get(e) ?? 0) + 1);
      }
      if (!/[.!?…]$/.test(m.text)) noPeriod++;
      if (/\){1,}/.test(m.text)) brackets++;
    }
    // burst = consecutive messages by same author in the global stream
    const sorted = [...messages].sort((a, b) => a.ts - b.ts);
    let bursts = 0;
    let inBurst = false;
    for (const m of sorted) {
      if (m.author === author) {
        if (!inBurst) {
          bursts++;
          inBurst = true;
        }
      } else inBurst = false;
    }
    byAuthor[author] = {
      messages: msgs.length,
      avgWords: words.length ? +(words.reduce((a, b) => a + b, 0) / words.length).toFixed(1) : 0,
      medianWords: median(words),
      emojiPerMessage: texts.length ? +(emojiTotal / texts.length).toFixed(2) : 0,
      topEmoji: [...emojiCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      langMix: langMix(texts.map((m) => m.text)),
      noTrailingPeriod: texts.length ? +(noPeriod / texts.length).toFixed(2) : 0,
      bracketSmiles: texts.length ? +(brackets / texts.length).toFixed(2) : 0,
      burstAvg: bursts ? +(msgs.length / bursts).toFixed(1) : 0,
    };
  }

  const ts = messages.map((m) => m.ts);
  return {
    totalMessages: messages.length,
    voiceNotes: messages.filter((m) => m.kind === 'voice').length,
    media: messages.filter((m) => m.kind === 'media').length,
    from: new Date(Math.min(...ts)).toISOString().slice(0, 10),
    to: new Date(Math.max(...ts)).toISOString().slice(0, 10),
    byAuthor,
  };
}

function langMix(texts: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of texts) {
    const l = detectLang(t);
    counts[l] = (counts[l] ?? 0) + 1;
  }
  const total = texts.length || 1;
  const mix: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) mix[k] = +(v / total).toFixed(2);
  return mix;
}

export function describeLangMix(mix: Record<string, number>): string {
  const names: Record<string, string> = { uk: 'Ukrainian', ru: 'Russian', en: 'English/Latin', cyr: 'Cyrillic (mixed)', other: 'other/emoji-only' };
  return Object.entries(mix)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${names[k] ?? k} ${(v * 100).toFixed(0)}%`)
    .join(', ');
}
