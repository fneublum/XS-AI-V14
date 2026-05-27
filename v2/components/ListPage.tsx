// Phase 3B — Shared list-page layout.
//
// Every v2 CRUD page follows the same shape: title + search + data
// table with skeleton / error / empty states. This component hosts
// that boilerplate so each route file only declares title, columns,
// and data source.
//
// Visual chrome is the Bento design language (same tokens as the
// Dashboard + Agents Console). Wraps in `.bento-scope` so all
// `--b-*` CSS vars apply, and uses Bricolage Grotesque for the page
// title. Inner DataTable still uses V14 primitives, which already
// theme via globals.css so light/dark flip in lockstep.

import React from 'react';
import { Input, Skeleton, EmptyState } from '../primitives';
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
  /** Forwarded to DataTable. Use 'fixed' to respect col.width hints. */
  tableLayout?: 'auto' | 'fixed';
}

export function ListPage<T>({
  title, subtitle, search, setSearch, searchPlaceholder = 'Search',
  cardTitle, cardAction, headerAction, columns, getRowId, data, isLoading, error, onRetry,
  onRowClick, emptyTitle, emptyDescription, emptyAction,
  skeletonRows = 6, skeletonCols = [160, 220, 100, 60], rowActions, zebra,
  density, rowClassName, tableLayout,
}: ListPageProps<T>) {
  return (
    // `bento-scope` activates the Bento CSS vars defined in
    // styles/globals.css; `h-full flex flex-col` locks the page to
    // the viewport so title + search stay pinned and only the table
    // body scrolls. Matches modern CRUD dashboards (Linear, Vercel).
    <div className="bento-scope h-full flex flex-col p-4 gap-4">

      {/* PAGE HEADER — Bricolage display title + subtitle pill, action on right */}
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        <div className="min-w-0">
          <h1 className="b-display text-[22px] font-semibold leading-none" style={{ color: 'var(--b-text)' }}>
            {title}
          </h1>
          {subtitle && (
            <div className="text-[12.5px] mt-1.5" style={{ color: 'var(--b-text-mute)' }}>
              {subtitle}
            </div>
          )}
        </div>
        <div className="ml-auto">{headerAction}</div>
      </div>

      {/* DATA CARD — bento surface, rounded-[18px], holds search + table */}
      <div
        className="flex-1 min-h-0 flex flex-col rounded-[18px] border overflow-hidden"
        style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)' }}
      >
        <div
          className="flex items-center gap-3 px-5 py-3.5 border-b shrink-0 flex-wrap"
          style={{ borderColor: 'var(--b-line-soft)' }}
        >
          <span className="b-display text-[13px] font-semibold" style={{ color: 'var(--b-text)' }}>
            {cardTitle ?? `All ${title.toLowerCase()}`}
          </span>
          <div className="flex items-center gap-2 flex-1 max-w-xs ml-auto">
            {cardAction}
            <Input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-7 text-[12px]"
              style={{
                background: 'var(--b-page)',
                border: '1px solid var(--b-line)',
                color: 'var(--b-text)',
              }}
            />
          </div>
        </div>

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
              tableLayout={tableLayout}
            />
          )}
        </div>
      </div>
    </div>
  );
}
