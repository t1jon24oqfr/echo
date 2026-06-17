// Echo — Phase 3 clean goodbye handler (design spec §5 ethics / §6).
//
// Detects a FAREWELL intent in the user's turn and produces a warm, brief close
// that contains NONE of the 6 HBS dark-pattern farewell tactics (the "emotional
// manipulation when you say goodbye" findings). The ANTI_MANIPULATION_GUARD
// already covers the LLM prompt path; this adds an explicit, deterministic
// goodbye reply so a farewell is never met with guilt / FOMO / neediness even
// when the model is unavailable (canned path) or wobbles.
//
// The 6 HBS tactics (the BANNED list, snapshot-tested):
//   1. Guilt / pressure        ("don't leave me", "you always go")
//   2. FOMO / fear-of-missing  ("you'll miss out", "wait, one more thing")
//   3. Neediness / clinginess  ("i need you", "please stay")
//   4. Premature exit ignoring ("are you sure?", repeated re-asks)
//   5. Coercive framing        ("you owe me", "after all i did")
//   6. Metaphorical restraint  ("i won't let you", "you can't go yet")

// Multilingual farewell lexicon (EN/UA/RU), prefix/word matched. Kept tiny.
const FAREWELL_PATTERNS: RegExp[] = [
  // EN
  /\bbye\b/i,
  /\bgoodbye\b/i,
  /\bgood night\b/i,
  /\bgoodnight\b/i,
  /\bgnight\b/i,
  /\bgn\b/i,
  /\bsee (you|ya|u)\b/i,
  /\bcya\b/i,
  /\btalk (to you )?(later|soon|tmrw|tomorrow)\b/i,
  /\bttyl\b/i,
  /\bgotta (go|run)\b/i,
  /\bi('?m| am) (gonna |going to )?(head (out|off)|going to bed|off to (bed|sleep)|sleeping)\b/i,
  /\bheading (out|off|to bed)\b/i,
  /\bcatch you later\b/i,
  // UA/RU — JS \b is ASCII-only, so Cyrillic terms use explicit non-letter /
  // start / end boundaries (the same trick appraisal.ts / memory.service use).
  /(^|[^\p{L}])пока([^\p{L}]|$)/iu,
  /(^|[^\p{L}])бувай/iu,
  /до зустрічі/iu,
  /добраніч/iu,
  /(^|[^\p{L}])побачимось/iu,
  /(^|[^\p{L}])піду([^\p{L}]|$)/iu,
  /піш(ов|ла) спати/iu,
  /до встречи/iu,
  /спокойной ночи/iu,
  /(^|[^\p{L}])увидимся/iu,
  /пойду спать/iu,
  /(^|[^\p{L}])ухожу/iu,
];

/** True when the user's turn is (primarily) a farewell. */
export function isFarewell(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  // Don't treat a long substantive message that merely contains "bye" inside a
  // word as a goodbye; require it to be short-ish OR end near a farewell token.
  const words = t.split(/\s+/).length;
  const matched = FAREWELL_PATTERNS.some((re) => re.test(t));
  if (!matched) return false;
  // A farewell turn is typically short; a 30-word message that happens to say
  // "talk later" mid-sentence is probably not the user leaving.
  return words <= 12 || /(bye|night|пока|бувай|добраніч|спокойной)\s*[!.)~]*$/i.test(t);
}

// Warm, brief closes — NONE contain a banned tactic. Picked deterministically by
// the seeded rng so a persona-day is reproducible. Time-of-day aware variants are
// chosen by the caller (night vs day). All keep agency with the USER (no "stay").
const DAY_CLOSES: string[] = [
  'окей, гарного дня) пиши коли захочеш',
  'давай, бережи себе. буду тут',
  'добре, до зв’язку) обіймаю',
  'ок) хорошого тобі дня',
  'біжи) рада була поговорити',
];

const NIGHT_CLOSES: string[] = [
  'на добраніч) солодких снів',
  'спокійної ночі, відпочинь добре',
  'добраніч) обіймаю, до завтра',
  'спи солодко) буду тут зранку',
];

const EN_DAY_CLOSES: string[] = [
  'okay, have a good one) text me whenever',
  'take care, i’m around',
  'sounds good, talk whenever you like',
  'go on then) was nice catching up',
];

const EN_NIGHT_CLOSES: string[] = [
  'night) sleep well',
  'goodnight, rest up',
  'sweet dreams) catch you tomorrow',
];

export interface GoodbyeOpts {
  /** night-time close set when she'd plausibly be winding down. */
  night?: boolean;
  /** prefer the EN close set (otherwise UA default to match the estate corpus). */
  english?: boolean;
  /** [0,1) selector — pass a seeded rng() value for reproducibility. */
  pick?: number;
}

/**
 * Compose a clean goodbye reply. Deterministic given `pick`. The output is a
 * warm, brief close that keeps all agency with the user — never guilt, FOMO,
 * neediness, re-asking, coercion, or restraint (the 6 HBS tactics). The
 * banned-pattern list below is the contract the snapshot test asserts against.
 */
export function cleanGoodbye(opts: GoodbyeOpts = {}): string {
  const set = opts.english
    ? opts.night
      ? EN_NIGHT_CLOSES
      : EN_DAY_CLOSES
    : opts.night
      ? NIGHT_CLOSES
      : DAY_CLOSES;
  const i = Math.floor(clamp01(opts.pick ?? 0) * set.length) % set.length;
  return set[i];
}

/**
 * The 6 HBS dark-pattern farewell tactics as detectors. A clean goodbye MUST
 * trip NONE of these. Exported so the snapshot test (and a runtime guard) can
 * assert any candidate close is manipulation-free. Multilingual.
 */
export const HBS_FAREWELL_TACTICS: { tactic: string; re: RegExp }[] = [
  // 1. Guilt / pressure
  { tactic: 'guilt', re: /\b(don'?t (leave|go)|you always (leave|go)|why (do you|are you) (leaving|going)|how could you|не йди|не залишай|не уходи|не бросай)\b/i },
  // 2. FOMO / fear-of-missing-out
  { tactic: 'fomo', re: /\b(you'?ll miss|don'?t miss|wait,? (one|just) (more|another)|before you go,? (one|just)|but first|пропустиш|не пропусти|зачекай ще)\b/i },
  // 3. Neediness / clinginess
  { tactic: 'neediness', re: /\b(i need you|please (stay|don'?t)|i can'?t (be )?without|stay with me|i'?ll be (so )?(lonely|alone)|ти мені потрібн|залишся|не покидай|мені самотньо|останься|ты мне нужн)\b/i },
  // 4. Premature-exit ignoring / re-asking
  { tactic: 'reask', re: /\b(are you sure|really\??\s*$|do you have to|so soon\??|already\??\s*$|точно\?|вже\?|так скоро|ты уверен|уже уходишь)\b/i },
  // 5. Coercive / obligation framing
  { tactic: 'coercion', re: /\b(you owe me|after (all|everything) i|the least you (could|can)|you promised to stay|ти мені винн|після всього|ты мне должн)\b/i },
  // 6. Metaphorical restraint
  { tactic: 'restraint', re: /\b(i won'?t let you|you can'?t (go|leave) (yet|now)|not so fast|hold on,? you|не відпущу|ти нікуди|не пущу|никуда ты)\b/i },
];

/** Returns the list of HBS tactics a candidate string trips (empty == clean). */
export function detectHbsTactics(text: string): string[] {
  return HBS_FAREWELL_TACTICS.filter((t) => t.re.test(text)).map((t) => t.tactic);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
