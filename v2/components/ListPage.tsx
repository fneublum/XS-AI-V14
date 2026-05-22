// Phase 3B — Shared list-page layout.
//
// Every v2 CRUD page follows the same shape: title + search + data
// table with skeleton / error / empty states. This component hosts
// that boilerplate so each route file only declares title, columns,
// and data source.

import React from 'react';
import {
  Card, CardHeader, CardTitle, Input, Skeleton, EmptyState,
} from '../primitives';
import { DataTable, DataTableColumn } from '../primitives/DataTable';

interface ListPageProps<T> {
  title: string;
  subtitle?: React.ReactNode;
  search: string;
  setSearch: (v: string) => void;
  searchPlaceholder?: string;
  cardTitle?: string;
  cardAction?: React.ReactNode;
  /** Rendered next to the page title — typically a "+ New X" button. */
  headerAction?: React.ReactNode;
  columns: DataTableColumn<T>[];
  getRowId: (row: T) => string;
  data: T[] | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Action surfaced on an empty (non-search) list — typically "+ New X". */
  emptyAction?: { label: string; onClick: () => void };
  skeletonRows?: number;
  skeletonCols?: number[];
  /** Renders a right-aligned action column per row (View/Edit/Delete). */
  rowActions?: (row: T) => React.ReactNode;
  /** Alternate row background for readability on dense tables. */
  zebra?: boolean;
  /** Row density passed through to DataTable. */
  density?: 'default' | 'compact';
  /** Optional per-row className passthrough — e.g. for AI-draft yellow ring. */
  rowClassName?: (row: T) => string;
}

export function ListPage<T>({
  title, subtitle, search, setSearch, searchPlaceholder = 'Search',
  cardTitle, cardAction, headerAction, columns, getRowId, data, isLoading, error, onRetry,
  onRowClick, emptyTitle, emptyDescription, emptyAction,
  skeletonRows = 6, skeletonCols = [160, 220, 100, 60], rowActions, zebra,
  density, rowClassName,
}: ListPageProps<T>) {
  return (
    // `h-full flex flex-col` — lock the list view to the main content
    // viewport so the title + search stay pinned and only the table
    // body scrolls. Matches modern CRUD dashboards (Linear, Vercel).
    <div className="h-full flex flex-col max-w-6xl">
      <div className="flex items-baseline justify-between mb-6 shrink-0">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">
            {title}
          </h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            {subtitle}
          </p>
        </div>
        {headerAction}
      </div>

      <Card className="flex-1 min-h-0 flex flex-col">
        <CardHeader className="shrink-0">
          <CardTitle>{cardTitle ?? `All ${title.toLowerCase()}`}</CardTitle>
          <div className="flex items-center gap-2 flex-1 max-w-xs ml-auto">
            {cardAction}
            <Input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-7 text-[12px] bg-[#111111] border-[#1f1f1f] text-slate-200 placeholder:text-slate-500"
            />
          </div>
        </CardHeader>

        <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: skeletonRows }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  {skeletonCols.map((w, j) => (
                    <Skeleton
                      key={j}
                      width={w}
                      height={14}
                      className={j === skeletonCols.length - 1 ? 'ml-auto' : ''}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : error ? (
            <EmptyState
              tone="danger"
              title={`Couldn't load ${title.toLowerCase()}`}
              description={error.message}
              action={{ label: 'Retry', onClick: onRetry }}
            />
          ) : !data || data.length === 0 ? (
            <EmptyState
              title={emptyTitle ?? (search ? 'No matches' : `No ${title.toLowerCase()} yet`)}
              description={
                emptyDescription ??
                (search
                  ? `Nothing matched "${search}".`
                  : 'Rows will appear here as they are created.')
              }
              action={
                search
                  ? { label: 'Clear search', onClick: () => setSearch('') }
                  : emptyAction
              }
            />
          ) : (
            <DataTable
              columns={columns}
              rows={data}
              getRowId={getRowId}
              onRowClick={onRowClick}
              rowActions={rowActions}
              zebra={zebra}
              density={density}
              rowClassName={rowClassName}
            />
          )}
        </div>
      </Card>
    </div>
  );
}
