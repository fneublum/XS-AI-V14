// Phase 3B — v2 Suppliers page. Full v1 parity + sort/filter columns.

import React, { useMemo, useState } from 'react';
import {
  Card, CardHeader, CardTitle, Input, Skeleton, EmptyState, Badge, Button,
} from '../primitives';
import { DataTable, DataTableColumn } from '../primitives/DataTable';
import { RowActions } from '../components/RowActions';
import { useRowDelete } from '../components/useRowDelete';
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

const SuppliersV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const { openSupplier, openSupplierCreate } = useEditor();
  const suppliers = useSuppliers(search);

  const { confirmDelete, deleteDialog } = useRowDelete<Supplier>({
    table: 'suppliers',
    listQueryKeys: ['suppliers'],
    rowLabel: r => r.name,
  });

  const columns: DataTableColumn<Supplier>[] = useMemo(() => [
    {
      id: 'name', header: 'Name', sortable: true, filterable: true,
      value: r => r.name,
      cell: r => <span className="text-slate-100 font-medium">{r.name}</span>,
    },
    {
      id: 'contact', header: 'Contact', sortable: true, filterable: true,
      value: r => r.contactPerson ?? '',
      cell: r => r.contactPerson ?? <span className="text-slate-600">—</span>,
    },
    {
      id: 'email', header: 'Email', sortable: true, filterable: true,
      value: r => r.email ?? '',
      cell: r => r.email ?? <span className="text-slate-600">—</span>,
    },
    {
      id: 'phone', header: 'Phone', mono: true, sortable: true,
      value: r => r.phone ?? '',
      cell: r => r.phone ?? <span className="text-slate-600">—</span>,
    },
    {
      id: 'country', header: 'Country', sortable: true, filterable: true,
      value: r => r.country ?? '',
      cell: r => r.country ?? <span className="text-slate-600">—</span>,
    },
    {
      id: 'categories', header: 'Categories', filterable: false,
      cell: r => (
        r.categories.length > 0
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
      ),
    },
    {
      id: 'terms', header: 'Terms', sortable: true, filterable: true,
      value: r => r.paymentTerms ?? '',
      cell: r => <span className="text-slate-400">{r.paymentTerms ?? '—'}</span>,
    },
    {
      id: 'rating', header: 'Rating', align: 'right', sortable: true,
      value: r => r.rating ?? 0,
      cell: r => fmtRating(r.rating),
    },
  ], []);

  const rowActions = (row: Supplier) => (
    <RowActions
      onView={() => openSupplier(row)}
      onEdit={() => openSupplier(row)}
      onDelete={() => confirmDelete(row)}
    />
  );

  const data = suppliers.data ?? [];

  return (
    <div className="max-w-6xl">
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">Suppliers</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            {suppliers.data
              ? `${data.length} shown${search ? ` · "${search}"` : ''}`
              : 'Loading…'}
          </p>
        </div>
        <Button
          size="sm"
          onClick={openSupplierCreate}
          className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md"
        >
          + New supplier
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All suppliers</CardTitle>
          <div className="flex items-center gap-2 ml-auto">
            <Input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Name, email, tax ID, contact"
              className="h-7 w-72 text-[12px] bg-[#111111] border-[#1f1f1f] text-slate-200 placeholder:text-slate-500"
            />
          </div>
        </CardHeader>

        {suppliers.isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton width={200} height={14} />
                <Skeleton width={160} height={14} />
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
        ) : data.length === 0 ? (
          <EmptyState
            title={search ? 'No matches' : 'No suppliers yet'}
            description={search ? `Nothing matched "${search}".` : 'Add your first supplier to get started.'}
            action={search
              ? { label: 'Clear search', onClick: () => setSearch('') }
              : { label: '+ New supplier', onClick: openSupplierCreate }}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={data}
            getRowId={r => r.id}
            onRowClick={r => openSupplier(r)}
            rowActions={rowActions}
            defaultSort={{ columnId: 'name', direction: 'asc' }}
          />
        )}
      </Card>
      {deleteDialog}
    </div>
  );
};

export default SuppliersV2;
