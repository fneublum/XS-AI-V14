// Phase 3B — Shared date preset helpers.
//
// Ported verbatim from `pages/FinanceBalances.tsx` (which has the full
// QuickBooks-flavored preset catalog). A smaller pre-baked list is
// exposed as BASIC_PRESETS for pages like Trading Follow Up that want
// a shorter dropdown. Fiscal periods mirror calendar periods — plug in
// a configurable fiscal-year-start here if the company ever adopts one.

export type PresetId =
  | 'custom'
  | 'this_week' | 'this_week_to_date' | 'this_fiscal_week'
  | 'this_month' | 'this_month_to_date'
  | 'this_quarter' | 'this_quarter_to_date' | 'this_fiscal_quarter' | 'this_fiscal_quarter_to_date'
  | 'this_year' | 'this_year_to_date' | 'this_year_to_last_month'
  | 'this_fiscal_year' | 'this_fiscal_year_to_date' | 'this_fiscal_year_to_last_month'
  | 'last_6_months'
  | 'yesterday' | 'recent'
  | 'last_week' | 'last_week_to_date' | 'last_week_to_today'
  | 'last_month' | 'last_month_to_date' | 'last_month_to_today'
  | 'last_quarter' | 'last_quarter_to_date' | 'last_quarter_to_today'
  | 'last_fiscal_quarter' | 'last_fiscal_quarter_to_date'
  | 'last_year' | 'last_year_to_date' | 'last_year_to_today'
  | 'last_fiscal_year' | 'last_fiscal_year_to_date'
  | 'last_7_days' | 'last_30_days' | 'last_90_days' | 'last_12_months'
  | 'since_30_days_ago' | 'since_60_days_ago' | 'since_90_days_ago' | 'since_365_days_ago'
  | 'next_week' | 'next_4_weeks' | 'next_month' | 'next_quarter'
  | 'next_fiscal_quarter' | 'next_year' | 'next_fiscal_year';

export interface Preset {
  id: PresetId;
  label: string;
  /** Optional section label for <optgroup> rendering. */
  group?: string;
}

// ── Primitive date arithmetic ─────────────────────────────────────

export const iso = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

export const addDays = (d: Date, n: number): Date => {
  const x = new Date(d);
  x.setDate(d.getDate() + n);
  return x;
};

export const addMonths = (d: Date, n: number): Date => {
  const x = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(d.getDate(), lastDay));
  return x;
};

export const addYears = (d: Date, n: number): Date => addMonths(d, n * 12);

export const startOfWeek    = (d: Date): Date => { const x = new Date(d); x.setDate(d.getDate() - d.getDay()); return x; };
export const endOfWeek      = (d: Date): Date => addDays(startOfWeek(d), 6);
export const startOfMonth   = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), 1);
export const endOfMonth     = (d: Date): Date => new Date(d.getFullYear(), d.getMonth() + 1, 0);
export const startOfQuarter = (d: Date): Date => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
export const endOfQuarter   = (d: Date): Date => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + 3, 0);
export const startOfYear    = (d: Date): Date => new Date(d.getFullYear(), 0, 1);
export const endOfYear      = (d: Date): Date => new Date(d.getFullYear(), 11, 31);

// ── Preset catalogs ───────────────────────────────────────────────

/** Full 55-preset catalog (QuickBooks-flavored). Used by Finance pages. */
export const PRESETS: Preset[] = [
  { id: 'custom', label: 'Custom' },
  { id: 'this_week', label: 'This week', group: 'This' },
  { id: 'this_week_to_date', label: 'This week to date' },
  { id: 'this_fiscal_week', label: 'This fiscal week' },
  { id: 'this_month', label: 'This month' },
  { id: 'this_month_to_date', label: 'This month to date' },
  { id: 'this_quarter', label: 'This quarter' },
  { id: 'this_quarter_to_date', label: 'This quarter to date' },
  { id: 'this_fiscal_quarter', label: 'This fiscal quarter' },
  { id: 'this_fiscal_quarter_to_date', label: 'This fiscal quarter to date' },
  { id: 'this_year', label: 'This year' },
  { id: 'this_year_to_date', label: 'This year to date' },
  { id: 'this_year_to_last_month', label: 'This year to last month' },
  { id: 'this_fiscal_year', label: 'This fiscal year' },
  { id: 'this_fiscal_year_to_date', label: 'This fiscal year to date' },
  { id: 'this_fiscal_year_to_last_month', label: 'This fiscal year to last month' },
  { id: 'last_6_months', label: 'Last 6 months', group: 'Rolling' },
  { id: 'yesterday', label: 'Yesterday', group: 'Past' },
  { id: 'recent', label: 'Recent' },
  { id: 'last_week', label: 'Last week' },
  { id: 'last_week_to_date', label: 'Last week to date' },
  { id: 'last_week_to_today', label: 'Last week to today' },
  { id: 'last_month', label: 'Last month' },
  { id: 'last_month_to_date', label: 'Last month to date' },
  { id: 'last_month_to_today', label: 'Last month to today' },
  { id: 'last_quarter', label: 'Last quarter' },
  { id: 'last_quarter_to_date', label: 'Last quarter to date' },
  { id: 'last_quarter_to_today', label: 'Last quarter to today' },
  { id: 'last_fiscal_quarter', label: 'Last fiscal quarter' },
  { id: 'last_fiscal_quarter_to_date', label: 'Last fiscal quarter to date' },
  { id: 'last_year', label: 'Last year' },
  { id: 'last_year_to_date', label: 'Last year to date' },
  { id: 'last_year_to_today', label: 'Last year to today' },
  { id: 'last_fiscal_year', label: 'Last fiscal year' },
  { id: 'last_fiscal_year_to_date', label: 'Last fiscal year to date' },
  { id: 'last_7_days', label: 'Last 7 days' },
  { id: 'last_30_days', label: 'Last 30 days' },
  { id: 'last_90_days', label: 'Last 90 days' },
  { id: 'last_12_months', label: 'Last 12 months' },
  { id: 'since_30_days_ago', label: 'Since 30 days ago' },
  { id: 'since_60_days_ago', label: 'Since 60 days ago' },
  { id: 'since_90_days_ago', label: 'Since 90 days ago' },
  { id: 'since_365_days_ago', label: 'Since 365 days ago' },
  { id: 'next_week', label: 'Next week', group: 'Future' },
  { id: 'next_4_weeks', label: 'Next 4 weeks' },
  { id: 'next_month', label: 'Next month' },
  { id: 'next_quarter', label: 'Next quarter' },
  { id: 'next_fiscal_quarter', label: 'Next fiscal quarter' },
  { id: 'next_year', label: 'Next year' },
  { id: 'next_fiscal_year', label: 'Next fiscal year' },
];

/** Shorter catalog for pages that don't need the full QB list. */
export const BASIC_PRESETS: Preset[] = [
  { id: 'custom',            label: 'Custom' },
  { id: 'this_week',         label: 'This week' },
  { id: 'this_month',        label: 'This month' },
  { id: 'this_quarter',      label: 'This quarter' },
  { id: 'this_year',         label: 'This year' },
  { id: 'this_year_to_date', label: 'This year to date' },
  { id: 'last_week',         label: 'Last week' },
  { id: 'last_month',        label: 'Last month' },
  { id: 'last_quarter',      label: 'Last quarter' },
  { id: 'last_year',         label: 'Last year' },
  { id: 'last_7_days',       label: 'Last 7 days' },
  { id: 'last_30_days',      label: 'Last 30 days' },
  { id: 'last_90_days',      label: 'Last 90 days' },
  { id: 'last_6_months',     label: 'Last 6 months' },
  { id: 'last_12_months',    label: 'Last 12 months' },
];

export interface DateRange {
  startDate: string;
  endDate: string;
}

/**
 * Compute an ISO date range for the given preset.
 * Returns null for 'custom' (caller should keep whatever start/end
 * the user typed in).
 */
export function computeRange(id: PresetId, today: Date = new Date()): DateRange | null {
  const T = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  switch (id) {
    case 'custom': return null;

    case 'this_week':
    case 'this_fiscal_week':
      return { startDate: iso(startOfWeek(T)), endDate: iso(endOfWeek(T)) };
    case 'this_week_to_date':
      return { startDate: iso(startOfWeek(T)), endDate: iso(T) };

    case 'this_month':
      return { startDate: iso(startOfMonth(T)), endDate: iso(endOfMonth(T)) };
    case 'this_month_to_date':
      return { startDate: iso(startOfMonth(T)), endDate: iso(T) };

    case 'this_quarter':
    case 'this_fiscal_quarter':
      return { startDate: iso(startOfQuarter(T)), endDate: iso(endOfQuarter(T)) };
    case 'this_quarter_to_date':
    case 'this_fiscal_quarter_to_date':
      return { startDate: iso(startOfQuarter(T)), endDate: iso(T) };

    case 'this_year':
    case 'this_fiscal_year':
      return { startDate: iso(startOfYear(T)), endDate: iso(endOfYear(T)) };
    case 'this_year_to_date':
    case 'this_fiscal_year_to_date':
      return { startDate: iso(startOfYear(T)), endDate: iso(T) };
    case 'this_year_to_last_month':
    case 'this_fiscal_year_to_last_month':
      return { startDate: iso(startOfYear(T)), endDate: iso(endOfMonth(addMonths(T, -1))) };

    case 'last_6_months':
      return { startDate: iso(addMonths(T, -6)), endDate: iso(T) };

    case 'yesterday': {
      const y = addDays(T, -1);
      return { startDate: iso(y), endDate: iso(y) };
    }
    case 'recent':
      return { startDate: iso(addDays(T, -30)), endDate: iso(T) };

    case 'last_week':
      return { startDate: iso(addDays(startOfWeek(T), -7)), endDate: iso(addDays(endOfWeek(T), -7)) };
    case 'last_week_to_date':
      return { startDate: iso(addDays(startOfWeek(T), -7)), endDate: iso(addDays(T, -7)) };
    case 'last_week_to_today':
      return { startDate: iso(addDays(startOfWeek(T), -7)), endDate: iso(T) };

    case 'last_month':
      return { startDate: iso(startOfMonth(addMonths(T, -1))), endDate: iso(endOfMonth(addMonths(T, -1))) };
    case 'last_month_to_date':
      return { startDate: iso(startOfMonth(addMonths(T, -1))), endDate: iso(addMonths(T, -1)) };
    case 'last_month_to_today':
      return { startDate: iso(startOfMonth(addMonths(T, -1))), endDate: iso(T) };

    case 'last_quarter':
    case 'last_fiscal_quarter':
      return { startDate: iso(startOfQuarter(addMonths(T, -3))), endDate: iso(endOfQuarter(addMonths(T, -3))) };
    case 'last_quarter_to_date':
    case 'last_fiscal_quarter_to_date':
      return { startDate: iso(startOfQuarter(addMonths(T, -3))), endDate: iso(addMonths(T, -3)) };
    case 'last_quarter_to_today':
      return { startDate: iso(startOfQuarter(addMonths(T, -3))), endDate: iso(T) };

    case 'last_year':
    case 'last_fiscal_year':
      return { startDate: iso(startOfYear(addYears(T, -1))), endDate: iso(endOfYear(addYears(T, -1))) };
    case 'last_year_to_date':
    case 'last_fiscal_year_to_date':
      return { startDate: iso(startOfYear(addYears(T, -1))), endDate: iso(addYears(T, -1)) };
    case 'last_year_to_today':
      return { startDate: iso(startOfYear(addYears(T, -1))), endDate: iso(T) };

    case 'last_7_days':
      return { startDate: iso(addDays(T, -7)), endDate: iso(T) };
    case 'last_30_days':
      return { startDate: iso(addDays(T, -30)), endDate: iso(T) };
    case 'last_90_days':
      return { startDate: iso(addDays(T, -90)), endDate: iso(T) };
    case 'last_12_months':
      return { startDate: iso(addYears(T, -1)), endDate: iso(T) };

    case 'since_30_days_ago':
      return { startDate: iso(addDays(T, -30)), endDate: iso(T) };
    case 'since_60_days_ago':
      return { startDate: iso(addDays(T, -60)), endDate: iso(T) };
    case 'since_90_days_ago':
      return { startDate: iso(addDays(T, -90)), endDate: iso(T) };
    case 'since_365_days_ago':
      return { startDate: iso(addDays(T, -365)), endDate: iso(T) };

    case 'next_week':
      return { startDate: iso(addDays(startOfWeek(T), 7)), endDate: iso(addDays(endOfWeek(T), 7)) };
    case 'next_4_weeks':
      return { startDate: iso(T), endDate: iso(addDays(T, 28)) };
    case 'next_month':
      return { startDate: iso(startOfMonth(addMonths(T, 1))), endDate: iso(endOfMonth(addMonths(T, 1))) };
    case 'next_quarter':
    case 'next_fiscal_quarter':
      return { startDate: iso(startOfQuarter(addMonths(T, 3))), endDate: iso(endOfQuarter(addMonths(T, 3))) };
    case 'next_year':
    case 'next_fiscal_year':
      return { startDate: iso(startOfYear(addYears(T, 1))), endDate: iso(endOfYear(addYears(T, 1))) };
  }
}
