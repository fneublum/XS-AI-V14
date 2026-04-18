// Phase 3B — Shared date formatter.
//
// The v2 convention is DDMMMYY with no separators (e.g. "19Apr26").
// Use `formatDate` for table cells and any display where a tight
// fixed-width date is preferable to a sentence like "Apr 19, 2026".
// Use `formatDateTime` when a timestamp is needed; it appends
// " HH:mm" 24h.

export const formatDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  const dd  = String(d.getDate()).padStart(2, '0');
  const mmm = d.toLocaleDateString('en-US', { month: 'short' });
  const yy  = String(d.getFullYear()).slice(-2);
  return `${dd}${mmm}${yy}`;
};

export const formatDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16);
  const base = formatDate(d.toISOString());
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${base} ${hh}:${mi}`;
};
