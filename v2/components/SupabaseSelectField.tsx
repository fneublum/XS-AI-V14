// Phase 3B — Supabase-backed select.
//
// Used by both QuickCreateDrawer and InspectDrawer whenever a FieldDef
// has `source: { table, valueColumn, ... }`. Fetches the reference
// list once (cached via react-query) and renders an Apple-style
// dropdown — input + list below that shows all filtered options,
// click to pick, closes on Escape / outside click.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useSupabaseQuery } from '../queries/useSupabaseQuery';
import { getSupabaseClient } from '../../services/supabase';
import { useCompany } from '../providers/CompanyProvider';
import { cn } from '../primitives/utils';

export interface FieldSource {
  /** Table name to pull options from. */
  table: string;
  /** Column whose value is written to the FieldDef key. */
  valueColumn: string;
  /** Column shown as the primary label. Defaults to `valueColumn`. */
  labelColumn?: string;
  /** Optional secondary label (e.g. country code beside port name). */
  secondaryColumn?: string;
  /** Column to order by. Defaults to `labelColumn || valueColumn`. */
  orderBy?: string;
  /** Max rows to fetch. Defaults to 500. */
  limit?: number;
  /** Scope by the current companyId + include ALL rows. */
  scopeByCompany?: boolean;
  /** Column to scope on when `scopeByCompany` is true. Defaults to
   *  `companyId`. Use `company_id` for snake_case tables. */
  companyIdColumn?: string;
  /** Optional array column that lists additional companies which can
   *  see this row (cross-company sharing). When set, the scope query
   *  also matches rows whose `sharedWithColumn` array contains the
   *  current companyId. Used for the `customers.sharedWith` pattern
   *  where a customer of company A can be made visible to company B. */
  sharedWithColumn?: string;
  /** When true, ALSO include rows tagged `companyId='ALL'` in the
   *  scoped query. Opt-in because the historical ALL fallback was
   *  leaking customers across companies (see commit 39e1bd6). For
   *  legitimately global lookups (payment_terms, ports, carriers,
   *  countries — libraries that are intentionally shared across
   *  tenants), set this true so they keep showing. */
  includeAllScope?: boolean;
  /**
   * After the user picks a row, write these additional source-row
   * columns into sibling FieldDef keys on the form. Lets a single
   * port pick populate both `origin_port_code` and `origin_port`.
   */
  writeAlso?: Array<{ sourceColumn: string; targetKey: string }>;
  /**
   * Optional column-equality filters applied to the supabase query.
   * Use cases: `{ isSystemProduct: true }` to hide auto-OCR products
   * from a curated dropdown; `{ status: 'ACTIVE' }` to limit to
   * active rows only. Multiple keys are AND'd.
   */
  equalsFilter?: Record<string, string | number | boolean>;
}

interface Props {
  source: FieldSource;
  value: string;
  onPick: (value: string, extra: Record<string, string>) => void;
  placeholder?: string;
  mono?: boolean;
  /**
   * When true, act as a combobox: the user can either pick a row or
   * type a free-form string (no matching row required). Used for
   * fields like `pickup_location` where addresses live outside any
   * canonical lookup table but a port list is still a useful shortcut.
   */
  allowFreeText?: boolean;
  /**
   * When true and `allowFreeText` is set, the closed input shows the
   * resolved label (`labelColumn`) instead of the raw stored code —
   * so a saved code like `TT50_50` displays as the human description
   * "50% Advance + 50% Cash Against Documents" once the user moves
   * focus away. Free-form values that don't match any row still
   * render as themselves.
   */
  showResolvedLabel?: boolean;
  /**
   * Fired after the user picks an existing row from the dropdown
   * (NOT on free-text Enter / blur). Receives the full source row so
   * callers can do follow-up writes — e.g. flipping a flag like
   * `isSystemProduct=true` to auto-promote a curated product on first
   * use.
   */
  onAfterPick?: (row: Record<string, unknown>) => void;
  /**
   * When the saved value doesn't match any row in the (filtered)
   * options — typically because an OCR-derived string isn't in the
   * curated catalog — render the closed input as empty rather than
   * showing the raw value. The underlying value is left untouched in
   * memory; the user must pick a real row to commit a new one.
   * Useful for "Pick system product…" where stale OCR text shouldn't
   * masquerade as a system match.
   */
  noMatchRendersEmpty?: boolean;
}

interface Row {
  [col: string]: unknown;
}

export const SupabaseSelectField: React.FC<Props> = ({
  source, value, onPick, placeholder, mono, allowFreeText = false, showResolvedLabel = false,
  onAfterPick, noMatchRendersEmpty = false,
}) => {
  const { currentCompanyId } = useCompany();
  const filterKey = source.equalsFilter
    ? Object.entries(source.equalsFilter).map(([k, v]) => `${k}=${String(v)}`).join('&')
    : '';
  const { data, isLoading, error } = useSupabaseQuery<Row[]>(
    ['ref', source.table, source.valueColumn, source.labelColumn ?? '', String(source.scopeByCompany ?? false), currentCompanyId, filterKey],
    async () => {
      const sb = getSupabaseClient();
      const cols = new Set<string>();
      cols.add(source.valueColumn);
      if (source.labelColumn)     cols.add(source.labelColumn);
      if (source.secondaryColumn) cols.add(source.secondaryColumn);
      if (source.writeAlso)       source.writeAlso.forEach(w => cols.add(w.sourceColumn));
      const selectClause = Array.from(cols).join(', ');

      const order = source.orderBy ?? source.labelColumn ?? source.valueColumn;
      let q = sb.from(source.table)
        .select(selectClause)
        .order(order, { ascending: true })
        .limit(source.limit ?? 500);
      if (source.scopeByCompany && currentCompanyId && currentCompanyId !== 'ALL') {
        const col = source.companyIdColumn ?? 'companyId';
        // Strict scoping by default: only rows tagged to this company
        // OR explicitly shared via the sharedWith array. The legacy
        // OR companyId.eq.ALL fallback used to widen the query to
        // surface untagged rows, but it leaked customers across every
        // company — see commits fb864d7 / 39e1bd6.
        //
        // To make a customer visible to multiple companies, use the
        // CustomerDrawer "Shared with" picker (writes to sharedWith).
        //
        // For tables that ARE intentionally global (payment_terms,
        // ports, carriers, countries — shared libraries that mean the
        // same thing to every tenant), the ALL widening is auto-applied
        // here so every existing call site gets the right behaviour
        // without per-call opt-in. Tables NOT in this allowlist stay
        // strict (customers, suppliers, products, etc).
        const GLOBAL_LIBRARY_TABLES = new Set([
          'payment_terms', 'ports', 'carriers', 'countries', 'banks',
        ]);
        const includeAll = source.includeAllScope || GLOBAL_LIBRARY_TABLES.has(source.table);
        const sharedCol = source.sharedWithColumn
          ?? (source.table === 'customers' ? 'sharedWith' : undefined);
        let orClause = `${col}.eq.${currentCompanyId}`;
        if (includeAll) {
          orClause += `,${col}.eq.ALL`;
        }
        if (sharedCol) {
          orClause += `,"${sharedCol}".cs.{${currentCompanyId}}`;
        }
        q = q.or(orClause) as typeof q;
      }
      if (source.equalsFilter) {
        for (const [col, val] of Object.entries(source.equalsFilter)) {
          q = q.eq(col, val) as typeof q;
        }
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data as unknown as Row[] | null) ?? [];
    },
  );

  const options = useMemo(() => {
    const rows = data ?? [];
    // Deduplicate by valueColumn + sort by label (trim-aware so stray
    // leading whitespace in the stored value doesn't throw off
    // ascending order).
    const seen = new Set<string>();
    const out: Row[] = [];
    for (const row of rows) {
      const v = String(row[source.valueColumn] ?? '').trim();
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(row);
    }
    const sortKey = source.orderBy ?? source.labelColumn ?? source.valueColumn;
    out.sort((a, b) => {
      const av = String(a[sortKey] ?? '').trim().toLowerCase();
      const bv = String(b[sortKey] ?? '').trim().toLowerCase();
      return av.localeCompare(bv);
    });
    return out;
  }, [data, source.valueColumn, source.orderBy, source.labelColumn]);

  const labelCol = source.labelColumn ?? source.valueColumn;

  // UI state — filter query + open/closed + keyboard nav index.
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return options;

    // Tokenize the query and the row text so OCR'd legal names like
    // "FIBERTEX, S.A. DE C.V." still match a stored row named just
    // "FIBERTEX" — strict substring matching would fail (the full
    // query doesn't fit inside the shorter stored value).
    //
    // Strategy, in order:
    //   1. Forward substring   — stored value contains the query.
    //   2. Reverse substring   — query contains the stored value.
    //   3. Token overlap       — any meaningful (≥3 char, non-stopword)
    //                            token from the query appears anywhere
    //                            in the row's searchable text.
    const STOP_TOKENS = new Set([
      'sa', 'cv', 'ltd', 'ltda', 'inc', 'llc', 'co', 'corp', 'company',
      'de', 'do', 'da', 'dos', 'das', 'los', 'las', 'el', 'la', 'le',
      'y', 'and', 'via', 'from', 'to', 'on', 'of', 'the', 'a', 'an',
      'sas', 'srl', 'gmbh', 'plc', 'pty', 'pte', 'spa', 'oy', 'ab',
      'comercio', 'industria', 'comércio', 'indústria',
    ]);
    const tokenize = (s: string): string[] =>
      s
        .toLowerCase()
        .split(/[\s.,;:()\[\]/\-+&]+/)
        .filter(t => t.length >= 3 && !STOP_TOKENS.has(t));

    const qTokens = tokenize(q);

    return options.filter(row => {
      const v = String(row[source.valueColumn] ?? '').toLowerCase();
      const l = String(row[labelCol] ?? '').toLowerCase();
      const s = source.secondaryColumn ? String(row[source.secondaryColumn] ?? '').toLowerCase() : '';
      const all = `${v} ${l} ${s}`;

      // 1 — forward substring on any of the searchable columns.
      if (v.includes(q) || l.includes(q) || s.includes(q)) return true;

      // 2 — reverse substring: when the user has typed (or pasted) the
      // long legal name and the stored value is the short trade name.
      // Require the stored value to be at least 3 chars so we don't
      // match every row when a 1-char column slips in.
      if (v.length >= 3 && q.includes(v)) return true;
      if (l.length >= 3 && q.includes(l)) return true;

      // 3 — token overlap. Match if at least one meaningful token from
      // the query lands inside the row's combined searchable text.
      if (qTokens.length > 0 && qTokens.some(t => all.includes(t))) return true;

      return false;
    });
  }, [options, filter, source.valueColumn, labelCol, source.secondaryColumn]);

  useEffect(() => { setCursor(0); }, [filter, open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (row: Row) => {
    const v = String(row[source.valueColumn] ?? '');
    const extras: Record<string, string> = {};
    if (source.writeAlso) {
      for (const w of source.writeAlso) {
        const ev = row[w.sourceColumn];
        if (ev !== null && ev !== undefined) extras[w.targetKey] = String(ev);
      }
    }
    onPick(v, extras);
    onAfterPick?.(row);
    setFilter('');
    setOpen(false);
  };

  const selectedLabel = useMemo(() => {
    if (!value) return '';
    const row = options.find(o => String(o[source.valueColumn]) === value);
    if (!row) return noMatchRendersEmpty ? '' : value;
    const l = String(row[labelCol] ?? value);
    const s = source.secondaryColumn ? String(row[source.secondaryColumn] ?? '') : '';
    return s ? `${l} · ${s}` : l;
  }, [value, options, source.valueColumn, labelCol, source.secondaryColumn, noMatchRendersEmpty]);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setCursor(c => Math.min(c + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(c => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      if (filtered[cursor]) {
        e.preventDefault();
        pick(filtered[cursor]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  // Scroll the active option into view.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  const hint =
    error ? `Load failed: ${error.message}` :
    isLoading ? `Loading ${source.table}…` :
    options.length === 0 ? (allowFreeText ? 'Type freely' : `No ${source.table} yet`) :
    allowFreeText
      ? `${filtered.length} of ${options.length} · Enter to pick · typing is allowed`
      : `${filtered.length} of ${options.length} · Enter to pick · Esc to close`;

  const inputBase =
    'h-8 w-full text-[12.5px] bg-[#111111] border border-[#1f1f1f] rounded-md pl-7 pr-7 ' +
    'text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 ' +
    (mono ? 'font-mono tabular-nums ' : '');

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
        <input
          type="text"
          // In free-text mode the input always shows the live value so
          // typing commits straight through. Strict mode keeps the
          // filter-vs-label split (label when closed, filter when open).
          value={allowFreeText
            ? (open
                ? filter
                : (noMatchRendersEmpty
                    ? selectedLabel  // already '' when no match
                    : ((showResolvedLabel ? selectedLabel : null) || value || '')))
            : (open ? filter : selectedLabel)}
          onFocus={() => {
            setOpen(true);
            if (allowFreeText) {
              // When `noMatchRendersEmpty` and the saved value isn't
              // in the (filtered) options, opening with the value as
              // the search filter would render "No match" — exactly
              // the case where we want the user to see the full list.
              // Detect that and seed an empty filter instead.
              const matched = !!options.find(o => String(o[source.valueColumn]) === value);
              setFilter(noMatchRendersEmpty && !matched ? '' : (value || ''));
            }
          }}
          onChange={e => {
            const next = e.target.value;
            setFilter(next);
            setOpen(true);
            // Commit every keystroke as the field value so the drawer
            // save picks up whatever the user typed even if they never
            // pick a row.
            if (allowFreeText) onPick(next, {});
          }}
          onKeyDown={onKey}
          placeholder={placeholder ?? (value ? '' : `Select ${source.table}…`)}
          className={inputBase}
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-label="Toggle options"
          className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-200"
        >
          <ChevronDown
            size={13}
            className={cn('transition-transform', open && 'rotate-180')}
          />
        </button>
      </div>

      <div className="text-[10.5px] text-slate-600 mt-1">{hint}</div>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          className={cn(
            // Float above the layout so narrow grid cells don't clip or
            // truncate the option text.
            'absolute left-0 top-full mt-1.5 z-30 min-w-full w-max max-w-[420px]',
            'rounded-md border border-[#1f1f1f] bg-[#0a0a0a]',
            'shadow-[0_8px_24px_rgba(0,0,0,0.5)] max-h-64 overflow-y-auto',
            'divide-y divide-[#141414]',
          )}
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-[11.5px] text-slate-500">
              {isLoading ? 'Loading…' : 'No match'}
            </div>
          ) : (
            filtered.map((row, i) => {
              const v = String(row[source.valueColumn] ?? '');
              const l = String(row[labelCol] ?? v);
              const s = source.secondaryColumn ? String(row[source.secondaryColumn] ?? '') : '';
              const isSelected = v === value;
              const isCursor = i === cursor;
              return (
                <button
                  key={v}
                  type="button"
                  data-idx={i}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => pick(row)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors',
                    isCursor
                      ? 'bg-indigo-500/15 text-slate-100'
                      : 'text-slate-300 hover:bg-[#141414]',
                  )}
                >
                  <span className={cn(
                    'inline-flex items-center justify-center w-3 h-3 shrink-0',
                    isSelected ? 'text-indigo-300' : 'text-transparent',
                  )}>
                    <Check size={11} />
                  </span>
                  <span className={cn(
                    'flex-1 min-w-0 truncate text-[12px]',
                    mono && l === v && 'font-mono',
                  )}>
                    {l}
                    {s && (
                      <span className="ml-1.5 text-[10.5px] text-slate-500">· {s}</span>
                    )}
                  </span>
                  {l !== v && (
                    <span className="text-[10.5px] font-mono text-slate-500 shrink-0">
                      {v}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
