/**
 * Signature-phrase mining (rank 8): the persona's high-frequency DISTINCTIVE
 * n-grams — greetings, sign-offs, fillers, laugh tokens, pet phrases — that the
 * other author does NOT use. Free-form LLM extraction misses these everyday
 * idiolect markers, yet they're exactly what a knower recognizes instantly.
 *
 * Deterministic + cheap (no LLM). Distinctiveness = smoothed log-odds of the
 * n-gram under the persona vs under the other author (the background), weighted
 * by sqrt(frequency) so a phrase must be BOTH frequent and characteristic.
 */

function normTokens(text: string): string[] {
  // word tokens + bracket-smiles ("))"/")))") which are signature in UA/RU chat.
  return text.toLowerCase().match(/[\p{L}\p{N}']+|\){2,}/gu) ?? [];
}

function ngrams(tokens: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) out.push(tokens.slice(i, i + n).join(' '));
  return out;
}

function countNgrams(texts: string[]): { c: Map<string, number>; total: number } {
  const c = new Map<string, number>();
  let total = 0;
  for (const t of texts) {
    const toks = normTokens(t);
    for (let n = 1; n <= 3; n++) {
      for (const g of ngrams(toks, n)) {
        c.set(g, (c.get(g) ?? 0) + 1);
        total++;
      }
    }
  }
  return { c, total };
}

export function mineSignaturePhrases(
  personaTexts: string[],
  otherTexts: string[],
  topN = 8,
): string[] {
  if (personaTexts.length < 10) return [];
  const P = countNgrams(personaTexts);
  const O = countNgrams(otherTexts);
  const V = new Set([...P.c.keys(), ...O.c.keys()]).size || 1;
  // Frequency floor scales with corpus size (≥3, ~1% of messages) so we surface
  // habits, not one-offs.
  const minFreq = Math.max(3, Math.round(personaTexts.length * 0.01));

  const scored: { g: string; score: number }[] = [];
  for (const [g, cp] of P.c) {
    if (cp < minFreq || g.length < 2) continue;
    const co = O.c.get(g) ?? 0;
    const pp = (cp + 1) / (P.total + V);
    const po = (co + 1) / (O.total + V);
    const distinct = Math.log(pp / po); // >0 ⇒ more characteristic of the persona
    if (distinct <= 0) continue;
    // Length weight so a distinctive multi-word phrase ("ну шо там") outranks its
    // own constituent unigrams; bare distinctive tokens ("блін", ")))") still pass.
    const lenWeight = 1 + 0.6 * (g.split(' ').length - 1);
    scored.push({ g, score: distinct * Math.sqrt(cp) * lenWeight });
  }
  scored.sort((a, b) => b.score - a.score);

  // Drop phrases subsumed by an already-chosen higher-ranked one (keep the more
  // informative form, avoid "ну"/"ну шо"/"ну шо там" all appearing).
  const chosen: string[] = [];
  for (const s of scored) {
    if (chosen.some((c) => c === s.g || c.includes(s.g) || s.g.includes(c))) continue;
    chosen.push(s.g);
    if (chosen.length >= topN) break;
  }
  return chosen;
}
