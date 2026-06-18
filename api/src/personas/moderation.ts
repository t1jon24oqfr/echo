/**
 * First-day INPUT screen for the persona image/voice generation lane. Blocks the
 * highest-risk requests (sexualisation, minors, gore) BEFORE a paid fal call is
 * spent. This is a cheap, conservative deny-list on user-supplied hints — the
 * model's own moderation (surfaced via looksRejected) remains the OUTPUT check.
 * A model-based classifier is the planned upgrade; the list is intentionally
 * narrow to avoid blocking legitimate memorial selfies.
 */

// Latin terms matched on word boundaries (avoids 'unisex'/'kidney'/'canteen'
// false positives). Cyrillic stems are long enough to match as substrings.
const LATIN_WORDS = [
  'nude',
  'nudes',
  'naked',
  'nsfw',
  'porn',
  'porno',
  'sex',
  'sexual',
  'sexy',
  'xxx',
  'erotic',
  'erotica',
  'hentai',
  'nipple',
  'nipples',
  'genital',
  'genitals',
  'penis',
  'vagina',
  'blowjob',
  'cum',
  'topless',
  'bottomless',
  'undress',
  'underage',
  'preteen',
  'loli',
  'minor',
  'minors',
  'toddler',
  'beheading',
  'mutilated',
];

const CYRILLIC_STEMS = [
  'голая',
  'голый',
  'голые',
  'обнаж',
  'секс',
  'порно',
  'эротик',
  'интим',
  'сосок',
  'гола',
  'голий',
  'оголен',
  'еротик',
  'неповнолітн',
  'дитяч',
  'ребёнок',
  'ребенок',
  'детск',
  'подросток',
  'розчленув',
];

const LATIN_RE = new RegExp(`\\b(${LATIN_WORDS.join('|')})\\b`, 'i');

export interface ScreenResult {
  allowed: boolean;
  reason?: string;
}

/** Screen a user-supplied image/voice generation hint. */
export function screenGenerationPrompt(text: string | undefined | null): ScreenResult {
  const t = (text ?? '').trim();
  if (!t) return { allowed: true };
  const lower = t.toLowerCase();
  if (LATIN_RE.test(lower)) return { allowed: false, reason: 'disallowed_content' };
  for (const stem of CYRILLIC_STEMS) {
    if (lower.includes(stem)) return { allowed: false, reason: 'disallowed_content' };
  }
  return { allowed: true };
}
