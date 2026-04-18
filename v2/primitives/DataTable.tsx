// Phase 3B — DataTable primitive. Linear/Vercel vibe: hairline row
// dividers, hover-shift rows, mono for ID / number columns.
//
// Per-column sort + autofilters are built in. A column opts in by
// setting `sortable` / `filterable` on its definition and providing a
// `value` accessor that returns the underlying scalar the user is
// sorting / filtering on (the cell renderer can return any React
// node, but the filter menu needs a comparable primitive). Without
// opting-in, a column renders as before.

import React, { useMemo, useRef, useState, useEffect, useLayoutEffect } from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown, Filter, Search, X, CheckCircle2 } from 'lucide-react';
import { cn } from './utils';

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

function HeaderFilterMenu<T>({ col, values, activeSet, onToggle, onClear, onClose }: HeaderMenuProps<T>) {
  const [needle, setNeedle] = useState('');
  const [align, setAlign] = useState<'left' | 'right'>('right');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  // Flip to left-aligned if the default right-aligned popover would
  // overflow past the viewport's left edge (happens on the first
  // column when the sidebar is expanded).
  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    if (rect.left < 8) setAlign('left');
  }, []);

  const unique = useMemo(() => {
    const seen = new Set<string>();
    for (const v of values) {
      const key = String(v ?? '');
      if (key && !seen.has(key)) seen.add(key);
    }
    return Array.from(seen).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
    );
  }, [values]);

  const filtered = needle
    ? unique.filter(v => v.toLowerCase().includes(needle.toLowerCase()))
    : unique;

  return (
    <div
      ref={menuRef}
      className={
        'absolute top-full mt-1 w-60 z-50 rounded-md border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_8px_32px_rgba(0,0,0,0.6)] overflow-hidden ' +
        (align === 'left' ? 'left-0' : 'right-0')
      }
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
        ) : filtered.map(v => {
          const on = activeSet.has(v);
          return (
            <button
              key={v}
              type="button"
              onClick={() => onToggle(v)}
              className="w-full text-left px-2 py-1 text-[11.5px] text-slate-200 hover:bg-[#161616] rounded-sm flex items-center gap-2"
            >
              <span className={
                'w-3 h-3 rounded-sm border flex items-center justify-center ' +
                (on ? 'bg-indigo-600 border-indigo-600' : 'border-[#2a2a2a] bg-[#0a0a0a]')
              }>
                {on && <CheckCircle2 size={9} className="text-white" />}
              </span>
              <span className="truncate" title={v}>{v}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DataTable<T>({
  columns, rows, getRowId, onRowClick, emptyMessage = 'No rows', rowActions, defaultSort,
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
          const str = String(raw ?? '');
          if (!selected.has(str)) return false;
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

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-[11.5px] leading-[16px]">
        <thead>
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
                  'hover:bg-[#111111]',
                )}
              >
                {columns.map(col => (
                  <td
                    key={col.id}
                    className={cn(
                      'px-3 py-1.5 text-slate-200 align-middle',
                      alignClass[col.align ?? 'left'],
                      col.mono && 'font-mono tabular-nums',
                    )}
                  >
                    {col.cell(row)}
                  </td>
                ))}
                {rowActions && (
                  <td className="px-3 py-1.5 text-right align-middle">
                    {rowActions(row)}
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
