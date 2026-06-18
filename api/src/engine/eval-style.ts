import type { Msg } from './types';
import { computeStats } from './stats';

/**
 * Layer-1 evaluation: a stylometric fingerprint of a set of messages + a
 * self-consistency band. The whole point is to turn "does it sound like them?"
 * into a regression NUMBER: build the persona on the early part of a real chat,
 * generate replies to held-out incoming messages, and check that the generated
 * style lands INSIDE the real person's own window-to-window variance — not that
 * it matches some absolute target (there is no "correct" value, only the band).
 *
 * Pure + deterministic (no LLM, no DB) so it runs in CI on every prompt/model/
 * passport change. The generation step lives in the CLI; this module only scores.
 */

export interface StyleVector {
  /** typical message length, words (median). */
  medianWords: number;
  /** emoji per message. */
  emojiPerMessage: number;
  /** share of messages ending with no final punctuation (0..1). */
  noTrailingPeriod: number;
  /** share of messages with a ")" bracket-smile (0..1). */
  bracketSmiles: number;
  /** language-mix shares (0..1). */
  langUk: number;
  langRu: number;
  langEn: number;
  /** type-token ratio — lexical diversity. LLMs write "too richly"; real chat repeats. */
  ttr: number;
  /** burstiness of message length = stdev/mean of words-per-message. Real chat is bursty. */
  burstiness: number;
  /** share of all tokens covered by the 5 most frequent words — repetitiveness. */
  top5coverage: number;
}

export type StyleFeature = keyof StyleVector;

export const STYLE_FEATURES: StyleFeature[] = [
  'medianWords',
  'emojiPerMessage',
  'noTrailingPeriod',
  'bracketSmiles',
  'langUk',
  'langRu',
  'langEn',
  'ttr',
  'burstiness',
  'top5coverage',
];

function wordsOf(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

/** The 3 over-fluency metrics not in CorpusStats (the #1 LLM tell). */
export function extraMetrics(texts: string[]): {
  ttr: number;
  burstiness: number;
  top5coverage: number;
} {
  const perMsgLen: number[] = [];
  const freq = new Map<string, number>();
  let total = 0;
  let uniqueSet = new Set<string>();
  for (const t of texts) {
    const w = wordsOf(t);
    perMsgLen.push(w.length);
    for (const tok of w) {
      total++;
      freq.set(tok, (freq.get(tok) ?? 0) + 1);
      uniqueSet.add(tok);
    }
  }
  const ttr = total ? uniqueSet.size / total : 0;
  const mean = perMsgLen.length ? perMsgLen.reduce((a, b) => a + b, 0) / perMsgLen.length : 0;
  const variance = perMsgLen.length
    ? perMsgLen.reduce((a, b) => a + (b - mean) ** 2, 0) / perMsgLen.length
    : 0;
  const burstiness = mean > 1e-9 ? Math.sqrt(variance) / mean : 0;
  const top5 = [...freq.values()].sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0);
  const top5coverage = total ? top5 / total : 0;
  return {
    ttr: +ttr.toFixed(4),
    burstiness: +burstiness.toFixed(4),
    top5coverage: +top5coverage.toFixed(4),
  };
}

/** Build a StyleVector from a flat list of message texts (one author). */
export function styleVector(texts: string[]): StyleVector {
  const msgs: Msg[] = texts.map((text, i) => ({ author: 'p', text, ts: i, kind: 'text' as const }));
  const a = computeStats(msgs).byAuthor['p'];
  const mix = a?.langMix ?? {};
  const ex = extraMetrics(texts);
  return {
    medianWords: a?.medianWords ?? 0,
    emojiPerMessage: a?.emojiPerMessage ?? 0,
    noTrailingPeriod: +(a?.noTrailingPeriod ?? 0).toFixed(4),
    bracketSmiles: +(a?.bracketSmiles ?? 0).toFixed(4),
    langUk: +(mix['uk'] ?? 0).toFixed(4),
    langRu: +(mix['ru'] ?? 0).toFixed(4),
    langEn: +(mix['en'] ?? 0).toFixed(4),
    ...ex,
  };
}

export interface FeatureBand {
  lo: number;
  hi: number;
}
export type StyleBand = Record<StyleFeature, FeatureBand>;

/**
 * The PASS window per feature: the span between two real held-out windows,
 * widened by a relative margin (+ an absolute floor so near-zero shares aren't
 * impossibly tight). A generated value inside the band is "indistinguishable
 * from the person's own variation" on that feature.
 */
export function styleBand(realA: StyleVector, realB: StyleVector, margin = 0.2): StyleBand {
  const band = {} as StyleBand;
  for (const f of STYLE_FEATURES) {
    const a = realA[f];
    const b = realB[f];
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const span = hi - lo;
    const pad = Math.max(span * margin, Math.abs((a + b) / 2) * margin, 0.02);
    band[f] = { lo: +(lo - pad).toFixed(4), hi: +(hi + pad).toFixed(4) };
  }
  return band;
}

export interface FeatureResult {
  feature: StyleFeature;
  value: number;
  band: FeatureBand;
  pass: boolean;
}
export interface BandComparison {
  results: FeatureResult[];
  passed: number;
  total: number;
  passRate: number;
}

/** Score a generated style vector against the real self-consistency band. */
export function compareToBand(gen: StyleVector, band: StyleBand): BandComparison {
  const results: FeatureResult[] = STYLE_FEATURES.map((feature) => {
    const value = gen[feature];
    const b = band[feature];
    return { feature, value, band: b, pass: value >= b.lo && value <= b.hi };
  });
  const passed = results.filter((r) => r.pass).length;
  return { results, passed, total: results.length, passRate: +(passed / results.length).toFixed(3) };
}
