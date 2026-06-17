// Meta (Facebook/Instagram) serializes UTF-8 bytes as latin-1 escapes;
// without this fix all Cyrillic (and other non-ASCII) is mojibake.
// Used by the Instagram and Facebook parsers ONLY — LINE/VK feed clean
// UTF-8 already and MUST NOT call this (it would corrupt them).
export function fixMojibake(s: string): string {
  try {
    return Buffer.from(s, 'latin1').toString('utf8');
  } catch {
    return s;
  }
}
