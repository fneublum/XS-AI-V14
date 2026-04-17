// Phase 3B — v2 Suppliers list.

import React, { useState } from 'react';
import {
  Card, CardHeader, CardTitle, Input, Skeleton, EmptyState, Badge,
} from '../primitives';
import { DataTable, DataTableColumn } from '../primitives/DataTable';
import { useSuppliers, Supplier } from '../queries/useSuppliers';
import { useEditor } from '../providers/EditorProvider';

const fmtRating = (n: number | null): React.ReactNode => {
  if (n === null) return <span className="text-slate-600">—</span>;
  const rounded = Math.round(n * 10) / 10;
  return (
    <span className="font-mono tabular-nums text-slate-300">
      {rounded.toFixed(1)}
      <span className="text-slate-600 ml-1">/5</span>
    </span>
  );
};

const columns: DataTableColumn<Supplier>[] = [
  { id: 'name',       header: 'Name',       cell: r => (
      <span className="text-slate-100 font-medium">{r.name}</span>
    ) },
  { id: 'email',      header: 'Email',      cell: r => r.email ?? '—' },
  { id: 'country',    header: 'Country',    cell: r => r.country ?? '—' },
  { id: 'categories', header: 'Categories', cell: r => (
      r.categories && r.categories.length > 0
        ? <div className="flex flex-wrap gap-1">
            {r.categories.slice(0, 3).map(c => (
              <Badge key={c} variant="neutral">{c}</Badge>
            ))}
            {r.categories.length > 3 && (
              <span className="text-[10px] text-slate-500 font-mono tabular-nums">
                +{r.categories.length - 3}
              </span>
            )}
          </div>
        : <span className="text-slate-600">—</span>
    ) },
  { id: 'terms',      header: 'Terms', cell: r => (
      <span className="text-slate-400">{r.paymentTerms ?? '—'}</span>
    ) },
  { id: 'rating',     header: 'Rating', align: 'right', cell: r => fmtRating(r.rating) },
];

const SuppliersV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const { openSupplier } = useEditor();
  const suppliers = useSuppliers(search);

  return (
    <div className="max-w-6xl">
      <div className="flex items-baseline justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">Suppliers</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            {suppliers.data
              ? `${suppliers.data.length} shown${search ? ` · "${search}"` : ''}`
              : 'Loading…'}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All suppliers</CardTitle>
          <div className="flex-1 max-w-xs">
            <Input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name or email"
              className="h-7 text-[12px] bg-[#111111] border-[#1f1f1f] text-slate-200 placeholder:text-slate-500"
            />
          </div>
        </CardHeader>

        {suppliers.isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton width={160} height={14} />
                <Skeleton width={220} height={14} />
                <Skeleton width={100} height={14} />
                <Skeleton width={60} height={14} className="ml-auto" />
              </div>
            ))}
          </div>
        ) : suppliers.error ? (
          <EmptyState
            tone="danger"
            title="Couldn't load suppliers"
            description={suppliers.error.message}
            action={{ label: 'Retry', onClick: suppliers.refetch }}
          />
        ) : !suppliers.data || suppliers.data.length === 0 ? (
          <EmptyState
            title={search ? 'No matches' : 'No suppliers yet'}
            description={
              search
                ? `Nothing matched "${search}".`
                : 'Suppliers show up here once they exist in this company.'
            }
            action={search ? { label: 'Clear search', onClick: () => setSearch('') } : undefined}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={suppliers.data}
            getRowId={r => r.id}
            onRowClick={r => openSupplier(r)}
          />
        )}
      </Card>
    </div>
  );
};

export default SuppliersV2;
