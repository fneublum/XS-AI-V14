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
  skeletonRows?: number;
  skeletonCols?: number[];
}

export function ListPage<T>({
  title, subtitle, search, setSearch, searchPlaceholder = 'Search',
  cardTitle, cardAction, headerAction, columns, getRowId, data, isLoading, error, onRetry,
  onRowClick, emptyTitle, emptyDescription,
  skeletonRows = 6, skeletonCols = [160, 220, 100, 60],
}: ListPageProps<T>) {
  return (
    <div className="max-w-6xl">
      <div className="flex items-baseline justify-between mb-8">
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

      <Card>
        <CardHeader>
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
            action={search ? { label: 'Clear search', onClick: () => setSearch('') } : undefined}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={data}
            getRowId={getRowId}
            onRowClick={onRowClick}
          />
        )}
      </Card>
    </div>
  );
}
