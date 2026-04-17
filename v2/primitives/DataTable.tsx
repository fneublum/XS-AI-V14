// Phase 3A — DataTable primitive. Linear/Vercel vibe: hairline row dividers,
// hover shift on rows, mono for ID/number columns.
//
// Deliberately schema-free — the caller provides columns with custom render
// functions so date formatting, badge rendering, currency alignment etc.
// stay out of this file. Phase 3B will swap in TanStack Table for sort +
// column resize; this is the simpler stepping stone.

import React from 'react';
import { cn } from './utils';

export interface DataTableColumn<T> {
  id: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string;          // CSS width (e.g. "100px", "12ch")
  mono?: boolean;           // monospace the cell body
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
}

const alignClass: Record<NonNullable<DataTableColumn<unknown>['align']>, string> = {
  left:   'text-left',
  right:  'text-right',
  center: 'text-center',
};

export function DataTable<T>({
  columns, rows, getRowId, onRowClick, emptyMessage = 'No rows',
}: DataTableProps<T>) {
  // Density: tightened 2026-04-17 — tables are the main canvas across
  // every CRUD page, so fitting more rows without horizontal scroll is
  // a bigger win than extra whitespace. Leading is explicit so the cell
  // height is driven by the text (not Tailwind's default 1.5x line-box).
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-[11.5px] leading-[16px]">
        <thead>
          <tr className="border-b border-[#1f1f1f]">
            {columns.map(col => (
              <th
                key={col.id}
                className={cn(
                  'px-3 py-1 text-[10px] font-normal text-slate-500 uppercase tracking-wider',
                  alignClass[col.align ?? 'left'],
                )}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-3 py-6 text-center text-[12px] text-slate-500"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={getRowId(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'transition-colors',
                  i < rows.length - 1 && 'border-b border-[#1f1f1f]',
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
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
