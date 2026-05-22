// Phase 3B — Shared date formatter.
//
// The v2 convention is DDMMMYY with no separators (e.g. "19Apr26").
// Use `formatDate` for table cells and any display where a tight
// fixed-width date is preferable to a sentence like "Apr 19, 2026".
// Use `formatDateTime` when a timestamp is needed; it appends
// " HH:mm" 24h.

export const formatDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  // Bare `YYYY-MM-DD` strings (the shape Postgres `date` columns return
  // and what every <input type="date"> emits) must be treated as a
  // wall-clock date, not a UTC instant. `new Date('2026-06-04')` is
  // parsed as 2026-06-04T00:00:00Z, then `.getDate()` returns the
  // previous day in any timezone west of UTC — causing the "off-by-one"
  // we saw on the bookings table (drawer showed 06/04 but list showed
  // 03Jun). Parse it as a local Date to keep the day stable.
  if (typeof iso === 'string') {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]) - 1;
      const da = Number(m[3]);
      const local = new Date(y, mo, da);
      const dd  = String(local.getDate()).padStart(2, '0');
      const mmm = local.toLocaleDateString('en-US', { month: 'short' });
      const yy  = String(local.getFullYear()).slice(-2);
      return `${dd}${mmm}${yy}`;
    }
  }
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
