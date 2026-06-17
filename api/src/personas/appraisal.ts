// Echo — Phase 2 chat-turn appraisal (design spec §5). PURE, no LLM.
//
// Classifies one user turn into (depth, reciprocity, modality) for the closeness
// gain + an active-emotion impulse, using a tiny UA/RU/EN lexicon and the
// existing tokens() prefix-matcher. CRITICAL: weight emotional DEPTH/disclosure,
// NOT sentiment valence — a sad heartfelt message INCREASES closeness.

import { tokens } from '../engine/prompt';
import type { AppraisalEvent } from '../engine/state';
import type { ExchangeFeatures } from '../engine/state';

// Feeling-word lexicon (UA/RU/EN, prefix-matched). Mirrors memory.service.
const FEELING_PREFIXES = [
  'love', 'miss', 'happy', 'sad', 'afraid', 'fear', 'angry', 'cry', 'hurt', 'proud', 'sorry',
  'hope', 'worri', 'lonel', 'grief', 'joy', 'hate', 'dream', 'promis', 'thank',
  'любл', 'кохаю', 'скуч', 'сумую', 'щаслив', 'сумн', 'боюс', 'страх', 'злюс', 'плак', 'болит',
  'болить', 'горд', 'вибач', 'прост', 'надія', 'хвилю', 'самотн', 'мрі', 'мечт', 'обіця', 'обеща',
  'люблю', 'счаст', 'груст', 'жаль', 'дяку', 'спасиб',
];

// Negative-affect feeling words -> bias the emotion impulse toward sadness, not joy.
const NEG_FEELINGS = [
  'sad', 'afraid', 'fear', 'angry', 'cry', 'hurt', 'sorry', 'worri', 'lonel', 'grief', 'hate',
  'сумн', 'боюс', 'страх', 'злюс', 'плак', 'болит', 'болить', 'самотн', 'груст', 'жаль', 'скуч', 'сумую',
];

const FIRST_PERSON: RegExp[] = [
  /\bi\b/i, /\bi'?m\b/i, /\bmy\b/i, /\bme\b/i,
  /(^|[^\p{L}])я([^\p{L}]|$)/iu,
  /(^|[^\p{L}])мен/iu,
  /(^|[^\p{L}])мі[йя]/iu,
  /(^|[^\p{L}])мо[яеёюї]/iu,
];

export interface ExchangeContext {
  medianWords: number; // the user's typical message length
  repliedToNudge: boolean; // reciprocity 1.5
  gapDays: number; // re-engagement bonus
  modality: 'text' | 'voice' | 'photo';
}

export interface ClassifiedExchange {
  exchange: ExchangeFeatures;
  emotion?: AppraisalEvent;
  importance: number; // 1..10
}

/**
 * depth = clamp(0.3 + 0.25·hasFeelingWord + 0.25·hasFirstPersonDisclosure
 *               + 0.2·(len > 1.5·medianWords), 0.3, 1.0)
 * reciprocity ∈ {0.7 one-word/low-effort, 1.0 normal, 1.5 replied-to-nudge}
 * modality depth multiplier: voice ×1.3, photo ×1.4, long heartfelt ×1.2.
 */
export function classifyExchange(text: string, ctx: ExchangeContext): ClassifiedExchange {
  const t = (text ?? '').trim();
  const lower = t.toLowerCase();
  const words = t ? t.split(/\s+/).length : 0;
  const median = ctx.medianWords > 0 ? ctx.medianWords : 6;

  const hasFeeling = FEELING_PREFIXES.some((p) => lower.includes(p));
  const hasFirstPerson = FIRST_PERSON.some((re) => re.test(t));
  const longMsg = words > 1.5 * median;
  const heartfelt = hasFeeling && hasFirstPerson && longMsg;

  let depth = 0.3 + 0.25 * (hasFeeling ? 1 : 0) + 0.25 * (hasFirstPerson ? 1 : 0) + 0.2 * (longMsg ? 1 : 0);
  depth = clamp(depth, 0.3, 1.0);

  // reciprocity
  let reciprocity = 1.0;
  if (ctx.repliedToNudge) reciprocity = 1.5;
  else if (words <= 2) reciprocity = 0.7;

  // modality multiplier on depth (capped at 1.0 in closenessGain via clamp)
  let modalityMult = 1.0;
  if (ctx.modality === 'voice') modalityMult = 1.3;
  else if (ctx.modality === 'photo') modalityMult = 1.4;
  if (heartfelt) modalityMult = Math.max(modalityMult, 1.2);

  const exchange: ExchangeFeatures = {
    depth,
    reciprocity,
    gapDays: ctx.gapDays,
    modalityMult,
  };

  // Emotion impulse: a feeling-laden turn warms her. NEG feeling -> a gentle
  // empathic sadness/concern; otherwise joy/gratitude. Intensity scales with depth.
  let emotion: AppraisalEvent | undefined;
  if (hasFeeling) {
    const isNeg = NEG_FEELINGS.some((p) => lower.includes(p));
    emotion = { type: isNeg ? 'sadness' : 'joy', base: clamp(0.25 + 0.35 * depth, 0.2, 0.6) };
  } else if (ctx.repliedToNudge) {
    emotion = { type: 'joy', base: 0.25 }; // pleased they reached back
  }

  // Importance for the reflection accumulator: deeper turns matter more.
  const importance = clampInt(Math.round(2 + 6 * depth + (heartfelt ? 1 : 0)), 1, 10);

  return { exchange, ...(emotion ? { emotion } : {}), importance };
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
function clampInt(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(x)));
}

void tokens;
