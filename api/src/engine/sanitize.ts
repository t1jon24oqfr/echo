/**
 * Clean recurring LLM tics out of a persona reply before it is persisted,
 * displayed or spoken. Shared by the chat turn path and the proactive
 * ("she texts first") path so both stay free of:
 *  - bare "або"/"or"/"чи" divider lines between alternative phrasings;
 *  - whole-line stage directions in *asterisks* or (parentheses);
 *  - inline multi-word *stage directions* (removed) vs single-word *emphasis* (kept).
 */
export function cleanReply(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*(або|чи|or)\s*$/i.test(line))
    // Whole-line stage direction: *...* or (...) on its own line → drop it.
    .filter((line) => !/^\s*\*[^*]+\*\s*$/.test(line))
    .filter((line) => !/^\s*\([^)]+\)\s*$/.test(line))
    .map((line) =>
      line
        // Multi-word *...* is an action → remove span; single word → keep, drop asterisks.
        .replace(/\*([^*]+)\*/g, (_m, inner: string) => (inner.trim().includes(' ') ? '' : inner))
        .replace(/\*/g, '')
        .replace(/[ \t]{2,}/g, ' ')
        .trim(),
    )
    .filter((line) => line.length > 0)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
