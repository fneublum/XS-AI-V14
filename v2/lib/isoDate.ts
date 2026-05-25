/**
 * Coerce a free-text date value into a bare `YYYY-MM-DD` string for
 * storage in our text-typed date columns (booking cut-offs, ETD/ETA,
 * BL dates, etc.). Centralizing this avoids the mess where some rows
 * had `2026-05-22T16:00:00` and others had `2026-05-22` purely based on
 * what Gemini returned for that particular PDF.
 *
 * Handles:
 *   "2026-06-04"                  → "2026-06-04"   (already ISO)
 *   "2026-06-04T16:00:00"         → "2026-06-04"   (trims time)
 *   "2026-06-04T16:00:00.000Z"    → "2026-06-04"
 *   "06/04/2026"     (US M/D/Y)   → "2026-06-04"
 *   "06/04/2026 16:00:00"         → "2026-06-04"
 *   "04-Jun-2026" / "04-JUN-2026" → "2026-06-04"
 *   "Jun 04, 2026"                → "2026-06-04"
 *   "" / null / undefined / junk  → null
 *
 * Returns null on anything unparseable rather than guessing — the
 * caller is expected to handle null gracefully (skip the column).
 */
export function toIsoDateString(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // Fast path: already starts with YYYY-MM-DD, just slice off any time component.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // Otherwise fall through to Date parsing. V8 / Node both treat
  // "M/D/YYYY" as US-format and "DD-MMM-YYYY" as parseable. Pull the
  // UTC date so timezone wobble doesn't kick us into the wrong day.
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
