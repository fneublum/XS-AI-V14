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
  /**
   * After the user picks a row, write these additional source-row
   * columns into sibling FieldDef keys on the form. Lets a single
   * port pick populate both `origin_port_code` and `origin_port`.
   */
  writeAlso?: Array<{ sourceColumn: string; targetKey: string }>;
}

interface Props {
  source: FieldSource;
  value: string;
  onPick: (value: string, extra: Record<string, string>) => void;
  placeholder?: string;
  mono?: boolean;
}

interface Row {
  [col: string]: unknown;
}

export const SupabaseSelectField: React.FC<Props> = ({
  source, value, onPick, placeholder, mono,
}) => {
  const { currentCompanyId } = useCompany();
  const { data, isLoading, error } = useSupabaseQuery<Row[]>(
    ['ref', source.table, source.valueColumn, source.labelColumn ?? '', String(source.scopeByCompany ?? false), currentCompanyId],
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
        q = q.or(`companyId.eq.${currentCompanyId},companyId.eq.ALL`) as typeof q;
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data as unknown as Row[] | null) ?? [];
    },
  );

  const options = useMemo(() => {
    const rows = data ?? [];
    // Deduplicate by valueColumn.
    const seen = new Set<string>();
    const out: Row[] = [];
    for (const row of rows) {
      const v = String(row[source.valueColumn] ?? '').trim();
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(row);
    }
    return out;
  }, [data, source.valueColumn]);

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
    return options.filter(row => {
      const v = String(row[source.valueColumn] ?? '').toLowerCase();
      const l = String(row[labelCol] ?? '').toLowerCase();
      const s = source.secondaryColumn ? String(row[source.secondaryColumn] ?? '').toLowerCase() : '';
      return v.includes(q) || l.includes(q) || s.includes(q);
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
    setFilter('');
    setOpen(false);
  };

  const selectedLabel = useMemo(() => {
    if (!value) return '';
    const row = options.find(o => String(o[source.valueColumn]) === value);
    if (!row) return value;
    const l = String(row[labelCol] ?? value);
    const s = source.secondaryColumn ? String(row[source.secondaryColumn] ?? '') : '';
    return s ? `${l} · ${s}` : l;
  }, [value, options, source.valueColumn, labelCol, source.secondaryColumn]);

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
    options.length === 0 ? `No ${source.table} yet` :
    `${filtered.length} of ${options.length} · Enter to pick · Esc to close`;

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
          value={open ? filter : selectedLabel}
          onFocus={() => setOpen(true)}
          onChange={e => { setFilter(e.target.value); setOpen(true); }}
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
            'mt-1.5 rounded-md border border-[#1f1f1f] bg-[#0a0a0a]',
            'shadow-[0_8px_24px_rgba(0,0,0,0.5)] max-h-56 overflow-y-auto',
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
