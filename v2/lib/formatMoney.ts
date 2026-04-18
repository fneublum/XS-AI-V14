// Phase 3B — Shared money formatter.
//
// v2 convention: always 2 decimal places, Intl currency formatting when
// a currency code is available, USD prefix fallback otherwise.
//
// Examples:
//   formatMoney(1234)            → "$1,234.00"
//   formatMoney(1234.5)          → "$1,234.50"
//   formatMoney(1234, 'EUR')     → "€1,234.00"
//   formatMoney(null)            → "—"
//   formatMoney(undefined, 'BR') → "—"  (invalid currency ignored)

export const formatMoney = (
  value: number | string | null | undefined,
  currency: string | null | undefined = 'USD',
): string => {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  const cur = (currency ?? 'USD').toString().toUpperCase();
  try {
    return n.toLocaleString('en-US', {
      style: 'currency', currency: cur,
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  } catch {
    return `${cur} ${n.toLocaleString('en-US', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    })}`;
  }
};
