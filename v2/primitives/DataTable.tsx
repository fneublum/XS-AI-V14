// Phase 3B — DataTable primitive. Linear/Vercel vibe: hairline row
// dividers, hover-shift rows, mono for ID / number columns.
//
// Per-column sort + autofilters are built in. A column opts in by
// setting `sortable` / `filterable` on its definition and providing a
// `value` accessor that returns the underlying scalar the user is
// sorting / filtering on (the cell renderer can return any React
// node, but the filter menu needs a comparable primitive). Without
// opting-in, a column renders as before.

import React, { useMemo, useRef, useState, useEffect } from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown, Filter, Search, X, CheckCircle2 } from 'lucide-react';
import { cn } from './utils';

/** Footer aggregation. When a column opts in, DataTable renders a
 *  <tfoot> row with one summary cell per column. The sum is computed
 *  over `viewRows` (i.e. after sort/filter), so the totals respect
 *  any active column filters. Each column controls its own display
 *  via `formatAggregate` — default falls back to a locale-aware
 *  integer. Mirrors the manually-rendered tfoot rows in the v2 PDF
 *  generators / Trading Follow Up tables. */
export interface DataTableColumn<T> {
  id: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string;
  mono?: boolean;
  /** Enable the ↕ sort button in the header. */
  sortable?: boolean;
  /** Enable the funnel autofilter in the header. */
  filterable?: boolean;
  /** Scalar value used for sorting / filtering. Defaults to the cell
   *  renderer's output, coerced to string — set this explicitly for
   *  typed columns (numbers, dates) to get a correct sort. */
  value?: (row: T) => string | number | null | undefined;
  /** Custom comparator. Overrides the default string/number compare. */
  compare?: (a: T, b: T) => number;
  /** When set, contributes to the footer totals row. Currently only
   *  'sum' is supported. Pair with `formatAggregate` for non-integer
   *  display (money, weight, etc). */
  aggregate?: 'sum';
  /** Custom renderer for the aggregated value. Default formats the
   *  number with `toLocaleString()`. */
  formatAggregate?: (value: number, rows: T[]) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  /** Renders a right-aligned action column per row. */
  rowActions?: (row: T) => React.ReactNode;
  /** Initial sort. Leave off to render in the order `rows` is in. */
  defaultSort?: { columnId: string; direction: 'asc' | 'desc' };
  /** Alternate row background for readability on dense tables. */
  zebra?: boolean;
  /** Row density — "compact" halves vertical padding and drops the font
   *  a hair so more rows fit above the fold. Default keeps the standard
   *  padding other routes expect. */
  density?: 'default' | 'compact';
}

const alignClass: Record<NonNullable<DataTableColumn<unknown>['align']>, string> = {
  left:   'text-left',
  right:  'text-right',
  center: 'text-center',
};

type SortState = { columnId: string; direction: 'asc' | 'desc' } | null;

const coerce = (v: unknown): string | number => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'string') return v;
  return String(v);
};

const defaultCompare = <T,>(col: DataTableColumn<T>, a: T, b: T): number => {
  const va = col.value ? col.value(a) : null;
  const vb = col.value ? col.value(b) : null;
  if (va === null || va === undefined) return vb === null || vb === undefined ? 0 : 1;
  if (vb === null || vb === undefined) return -1;
  if (typeof va === 'number' && typeof vb === 'number') return va - vb;
  return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
};

interface HeaderMenuProps<T> {
  col: DataTableColumn<T>;
  values: Array<string | number>;
  activeSet: Set<string>;
  onToggle: (v: string) => void;
  onClear: () => void;
  onClose: () => void;
}

// Normalize the column value into a comparison key so case + stray
// punctuation + accents collapse to a single entry in the dropdown
// AND match the same set of rows when picked. Handles:
//   • "RSM Company" vs "RSM COMPANY"        — case
//   • "FIBERTEX HONDURAS, S.A. DE C.V."
//     vs "FIBERTEX HONDURAS S.A. DE C.V."   — punctuation
//   • "FIAÇÃO PATAMUTE LTDA"
//     vs "FIACAO PATAMUTE LTDA"             — diacritics
//   • "PATEX - PATAMUTÉ TÊXTIL LTDA"
//     vs "PATEX PATAMUTE TEXTIL LTDA"       — combined
export const normalizeFilterKey = (s: string): string =>
  s
    .toLowerCase()
    // Strip diacritics: Unicode NFD splits "ç" into "c" + combining
    // cedilla, then we drop every U+0300–U+036F combining mark.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,;:'"!?()\[\]/\\&|+-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function HeaderFilterMenu<T>({ col, values, activeSet, onToggle, onClear, onClose }: HeaderMenuProps<T>) {
  const [needle, setNeedle] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  // Group raw values by their normalized key. Pick the first
  // occurrence as the display label so the dropdown still shows
  // human-readable text; `key` is what the active filter set stores
  // (also what we'll match rows against in viewRows).
  const groups = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of values) {
      const raw = String(v ?? '').trim();
      if (!raw) continue;
      const key = normalizeFilterKey(raw);
      if (!key || map.has(key)) continue;
      map.set(key, raw);
    }
    return Array.from(map.entries()).sort((a, b) =>
      a[1].localeCompare(b[1], undefined, { numeric: true, sensitivity: 'base' }),
    );
  }, [values]);

  const filtered = needle
    ? groups.filter(([, display]) => display.toLowerCase().includes(needle.toLowerCase()))
    : groups;

  return (
    <div
      ref={menuRef}
      className="absolute top-full left-0 mt-1 w-60 z-50 rounded-md border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden"
      onClick={e => e.stopPropagation()}
    >
      <div className="p-2 border-b border-[#1f1f1f]">
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            autoFocus
            value={needle}
            onChange={e => setNeedle(e.target.value)}
            placeholder="Search values"
            className="w-full pl-7 pr-2 py-1 text-[11.5px] bg-[#111111] border border-[#1f1f1f] rounded-sm text-slate-200 placeholder:text-slate-600 outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>
      <div className="max-h-56 overflow-y-auto p-1">
        {activeSet.size > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="w-full text-left px-2 py-1 text-[11.5px] text-indigo-300 hover:bg-[#161616] rounded-sm flex items-center gap-2"
          >
            <X size={10} /> Clear filter
          </button>
        )}
        {filtered.length === 0 ? (
          <div className="px-2 py-2 text-[11.5px] text-slate-600">No values</div>
        ) : filtered.map(([key, display]) => {
          const on = activeSet.has(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onToggle(key)}
              className="w-full text-left px-2 py-1 text-[11.5px] text-slate-200 hover:bg-[#161616] rounded-sm flex items-center gap-2"
            >
              <span className={
                'w-3 h-3 rounded-sm border flex items-center justify-center ' +
                (on ? 'bg-indigo-600 border-indigo-600' : 'border-[#2a2a2a] bg-[#0a0a0a]')
              }>
                {on && <CheckCircle2 size={9} className="text-white" />}
              </span>
              <span className="truncate" title={display}>{display}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DataTable<T>({
  columns, rows, getRowId, onRowClick, emptyMessage = 'No rows', rowActions, defaultSort, zebra = true,
  density = 'default',
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState>(defaultSort ?? null);
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);

  const toggleSort = (columnId: string) => {
    setSort(prev => {
      if (!prev || prev.columnId !== columnId) return { columnId, direction: 'asc' };
      if (prev.direction === 'asc') return { columnId, direction: 'desc' };
      return null;
    });
  };

  const toggleFilter = (columnId: string, v: string) => {
    setFilters(prev => {
      const next = new Set(prev[columnId] ?? []);
      if (next.has(v)) next.delete(v); else next.add(v);
      return { ...prev, [columnId]: next };
    });
  };

  const clearFilter = (columnId: string) => {
    setFilters(prev => {
      const next = { ...prev };
      delete next[columnId];
      return next;
    });
  };

  const activeFilters = Object.entries(filters).filter(([_, s]) => s.size > 0);

  const viewRows = useMemo(() => {
    let out = rows;
    if (activeFilters.length > 0) {
      out = out.filter(r => {
        for (const [columnId, selected] of activeFilters) {
          const col = columns.find(c => c.id === columnId);
          if (!col) continue;
          const raw = col.value ? col.value(r) : null;
          // Match against the normalized key — the active set stores
          // keys (lowercase, punctuation-collapsed), so "RSM Company"
          // and "RSM COMPANY" filter the same set of rows.
          const key = normalizeFilterKey(String(raw ?? '').trim());
          if (!selected.has(key)) return false;
        }
        return true;
      });
    }
    if (sort) {
      const col = columns.find(c => c.id === sort.columnId);
      if (col) {
        const cmp = col.compare ?? ((a: T, b: T) => defaultCompare(col, a, b));
        out = [...out].sort((a, b) => {
          const diff = cmp(a, b);
          return sort.direction === 'asc' ? diff : -diff;
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns, sort, filters]);

  const isCompact = density === 'compact';
  const cellPadClass = isCompact ? 'px-2 py-0.5' : 'px-3 py-1.5';
  const tableFontClass = isCompact ? 'text-[11px] leading-[14px]' : 'text-[11.5px] leading-[16px]';
  // Compact mode collapses to one row per record. Without nowrap, long
  // values like "USHOU - Houston, Texas, United States → BRMAO - …" or
  // multi-word customer names wrap inside the cell and break the row
  // height back to the verbose layout the dense view was meant to fix.
  const cellWrapClass = isCompact ? 'whitespace-nowrap' : '';

  return (
    // No overflow-x-auto here — it breaks the sticky-thead chain.
    // Horizontal scrolling is delegated to ListPage's scroll container.
    <div className="w-full">
      <table className={cn('w-full', tableFontClass)}>
        {/* Sticky header stays visible while the table body scrolls inside
         *  its ListPage container. Opaque bg-[#0a0a0a] (flipped to white
         *  via globals.css in light mode) so scrolled rows don't show
         *  through. */}
        <thead className="sticky top-0 z-10 bg-[#0a0a0a]">
          <tr className="border-b border-[#1f1f1f]">
            {columns.map(col => {
              const sortActive = sort?.columnId === col.id;
              const sortDir = sortActive ? sort.direction : null;
              const fActive = (filters[col.id]?.size ?? 0) > 0;
              const allValues: Array<string | number> =
                col.filterable && col.value
                  ? rows.map(r => coerce(col.value!(r))).filter(v => v !== '')
                  : [];

              return (
                <th
                  key={col.id}
                  className={cn(
                    'relative px-3 py-1 text-[10px] font-normal text-slate-500 uppercase tracking-wider select-none',
                    alignClass[col.align ?? 'left'],
                  )}
                  style={col.width ? { width: col.width } : undefined}
                >
                  <div className={cn(
                    'flex items-center gap-1',
                    col.align === 'right' ? 'justify-end' : 'justify-between',
                  )}>
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.id)}
                        className={cn(
                          'inline-flex items-center gap-1 hover:text-slate-200 transition-colors',
                          sortActive && 'text-slate-200',
                        )}
                      >
                        <span>{col.header}</span>
                        {sortDir === 'asc' ? <ArrowUp size={10} />
                          : sortDir === 'desc' ? <ArrowDown size={10} />
                          : <ArrowUpDown size={10} className="opacity-40" />}
                      </button>
                    ) : (
                      <span>{col.header}</span>
                    )}
                    {col.filterable && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenFilter(openFilter === col.id ? null : col.id);
                        }}
                        className={cn(
                          'p-0.5 rounded-sm transition-colors',
                          fActive ? 'text-indigo-300 bg-indigo-500/10' : 'text-slate-600 hover:text-slate-300',
                        )}
                        aria-label="Filter column"
                      >
                        <Filter size={11} fill={fActive ? 'currentColor' : 'none'} />
                      </button>
                    )}
                  </div>
                  {openFilter === col.id && col.filterable && (
                    <HeaderFilterMenu
                      col={col}
                      values={allValues}
                      activeSet={filters[col.id] ?? new Set()}
                      onToggle={(v) => toggleFilter(col.id, v)}
                      onClear={() => clearFilter(col.id)}
                      onClose={() => setOpenFilter(null)}
                    />
                  )}
                </th>
              );
            })}
            {rowActions && (
              <th
                className="px-3 py-1 text-[10px] font-normal text-slate-500 uppercase tracking-wider text-right"
                style={{ width: '120px' }}
              >
                Actions
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {viewRows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + (rowActions ? 1 : 0)}
                className="px-3 py-6 text-center text-[12px] text-slate-500"
              >
                {activeFilters.length > 0
                  ? 'No rows match the active filters.'
                  : emptyMessage}
              </td>
            </tr>
          ) : (
            viewRows.map((row, i) => (
              <tr
                key={getRowId(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'transition-colors group',
                  i < viewRows.length - 1 && 'border-b border-[#1f1f1f]',
                  onRowClick && 'cursor-pointer',
                  zebra && i % 2 === 1 && 'bg-sky-400/10',
                  'hover:bg-[#111111]',
                )}
              >
                {columns.map(col => (
                  <td
                    key={col.id}
                    className={cn(
                      cellPadClass,
                      cellWrapClass,
                      'text-slate-200 align-middle',
                      alignClass[col.align ?? 'left'],
                      col.mono && 'font-mono tabular-nums',
                    )}
                  >
                    {col.cell(row)}
                  </td>
                ))}
                {rowActions && (
                  <td className={cn(cellPadClass, cellWrapClass, 'text-right align-middle')}>
                    {rowActions(row)}
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
        {(() => {
          // Footer totals row — rendered only when at least one column
          // opts in via `aggregate`. Sum operates over the
          // already-filtered/sorted `viewRows` so the values match what
          // the user is looking at, not the raw row set.
          const aggCols = columns.filter(c => c.aggregate === 'sum');
          if (aggCols.length === 0 || viewRows.length === 0) return null;
          // Memo would be nicer, but the column shape changes when
          // stages flip — straight iteration keeps things simple.
          const sums = new Map<string, number>();
          for (const c of aggCols) {
            let s = 0;
            for (const r of viewRows) {
              const v = c.value ? c.value(r) : null;
              const n = typeof v === 'number' ? v : Number(v);
              if (Number.isFinite(n)) s += n;
            }
            sums.set(c.id, s);
          }
          const aggIds = new Set(aggCols.map(c => c.id));
          // Pick the first non-aggregate column to host the "Total"
          // label so the footer reads naturally left-to-right.
          const labelCol = columns.find(c => !aggIds.has(c.id))?.id ?? null;
          return (
            <tfoot className="bg-[#0f0f0f] border-t border-[#1f1f1f]">
              <tr className="text-[11px] uppercase tracking-wider text-slate-400">
                {columns.map(col => {
                  if (col.aggregate === 'sum') {
                    const sum = sums.get(col.id) ?? 0;
                    const formatted = col.formatAggregate
                      ? col.formatAggregate(sum, viewRows)
                      : sum.toLocaleString();
                    return (
                      <td
                        key={col.id}
                        className={cn(
                          cellPadClass,
                          'font-semibold text-slate-100 align-middle',
                          alignClass[col.align ?? 'left'],
                          col.mono && 'font-mono tabular-nums',
                        )}
                      >
                        {formatted}
                      </td>
                    );
                  }
                  return (
                    <td
                      key={col.id}
                      className={cn(
                        cellPadClass,
                        'font-medium text-slate-400 align-middle',
                        alignClass[col.align ?? 'left'],
                      )}
                    >
                      {col.id === labelCol
                        ? `Total · ${viewRows.length} row${viewRows.length === 1 ? '' : 's'}`
                        : ''}
                    </td>
                  );
                })}
                {rowActions && <td className={cn(cellPadClass)} />}
              </tr>
            </tfoot>
          );
        })()}
      </table>
    </div>
  );
}
