// Robust word-wrapper that doesn't rely on jsPDF's pixel-width
// measurement. jsPDF's default Helvetica only ships Latin-1 (WinAnsi)
// glyphs; for chars above U+00FF (Turkish İ/Ş/Ğ, Polish Ł, etc.) it
// silently switches to UTF-16, which the standard font can't map — the
// glyphs get rendered with NUL bytes between each char, producing the
// "E V L E R 0" effect on otherwise valid addresses. We pre-transliterate
// non-Latin-1 chars to their closest Latin-1 base before passing to
// doc.text, and we wrap by character count (predictable, no width-measure
// glitches). Single tokens longer than the limit are hard-broken.

// Best-effort transliteration for non-Latin-1 characters that jsPDF's
// default Helvetica can't render. Pre-mapped entries cover the common
// cases that don't NFD-decompose to a Latin-1 base.
const SPECIAL_MAP: Record<string, string> = {
  'İ': 'I', 'ı': 'i',
  'Ł': 'L', 'ł': 'l',
  'Đ': 'D', 'đ': 'd',
  'Ŧ': 'T', 'ŧ': 't',
  'Œ': 'OE', 'œ': 'oe',
  'Æ': 'AE', 'æ': 'ae',
  'ß': 'ss',
  '–': '-', '—': '-', '−': '-',
  '“': '"', '”': '"', '„': '"',
  '‘': "'", '’': "'",
  '…': '...',
  ' ': ' ',
};

export function latin1Safe(text: string | null | undefined): string {
  if (!text) return '';
  let out = '';
  for (const ch of String(text)) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0xFF) { out += ch; continue; }
    if (ch in SPECIAL_MAP) { out += SPECIAL_MAP[ch]; continue; }
    // Try NFD-decompose and keep only the Latin-1 codepoints (drops the
    // combining marks above U+00FF; keeps the base letter).
    const decomposed = ch.normalize('NFD');
    let kept = '';
    for (const part of decomposed) {
      if ((part.codePointAt(0) ?? 0) <= 0xFF) kept += part;
    }
    out += kept || '?';
  }
  return out;
}

export function wrapByChars(text: string | null | undefined, maxChars = 30): string[] {
  if (!text) return [];
  const safe = latin1Safe(text).trim();
  if (!safe) return [];
  const words = safe.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (w.length > maxChars) {
      if (cur) { lines.push(cur); cur = ''; }
      for (let i = 0; i < w.length; i += maxChars) {
        lines.push(w.slice(i, i + maxChars));
      }
      continue;
    }
    const test = cur ? `${cur} ${w}` : w;
    if (test.length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
