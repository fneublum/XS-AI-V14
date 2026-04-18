// Phase 3B — Shared entity-name formatter.
//
// Display convention across v2 tables: Customer, Supplier, Consignee,
// Notify and similar "company-name" columns show the first two words
// of the stored name. Full name is kept as a title-attribute tooltip
// via `tooltipName` below.
//
// Examples:
//   "ACME INDUSTRIES S.A. DE C.V."  → "ACME INDUSTRIES"
//   "Trans Global Logistics"        → "Trans Global"
//   "BRX"                           → "BRX"
//   null                            → "—"

export const shortName = (s: string | null | undefined): string => {
  if (s === null || s === undefined) return '—';
  const trimmed = String(s).trim();
  if (!trimmed) return '—';
  const parts = trimmed.split(/\s+/);
  return parts.slice(0, 2).join(' ');
};

/** Full name for `title` tooltips; falls back to em-dash. */
export const tooltipName = (s: string | null | undefined): string | undefined => {
  const v = s == null ? '' : String(s).trim();
  return v || undefined;
};
