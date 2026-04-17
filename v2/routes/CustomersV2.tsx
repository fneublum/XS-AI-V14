// Phase 3B — v2 Customers page. Classic table + search.

import React, { useState } from 'react';
import {
  Card, CardHeader, CardTitle, Input, Skeleton, EmptyState,
} from '../primitives';
import { DataTable, DataTableColumn } from '../primitives/DataTable';
import { useCustomers, Customer } from '../queries/useCustomers';
import { useEditor } from '../providers/EditorProvider';

const columns: DataTableColumn<Customer>[] = [
  { id: 'name',     header: 'Name',                cell: r => (
      <span className="text-slate-100 font-medium">{r.name}</span>
    ) },
  { id: 'email',    header: 'Email',               cell: r => r.email ?? '—' },
  { id: 'country',  header: 'Country',             cell: r => r.country ?? '—' },
  { id: 'pod',      header: 'POD',                 cell: r => (
      <span className="font-mono tabular-nums text-[11.5px]">{r.pod ?? '—'}</span>
    ) },
  { id: 'terms',    header: 'Terms',               cell: r => (
      <span className="text-slate-400">{r.paymentTerms ?? '—'}</span>
    ) },
  { id: 'lastOrd',  header: 'Last order', align: 'right', cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {r.lastOrderDate ? new Date(r.lastOrderDate).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) : '—'}
      </span>
    ) },
];

const CustomersV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const { openCustomer } = useEditor();
  const customers = useCustomers(search);

  return (
    <div className="max-w-6xl">
      <div className="flex items-baseline justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">Customers</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            {customers.data
              ? `${customers.data.length} shown${search ? ` · filtered by "${search}"` : ''}`
              : 'Loading…'}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All customers</CardTitle>
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

        {customers.isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton width={180} height={14} />
                <Skeleton width={220} height={14} />
                <Skeleton width={100} height={14} />
                <Skeleton width={60} height={14} className="ml-auto" />
              </div>
            ))}
          </div>
        ) : customers.error ? (
          <EmptyState
            tone="danger"
            title="Couldn't load customers"
            description={customers.error.message}
            action={{ label: 'Retry', onClick: customers.refetch }}
          />
        ) : !customers.data || customers.data.length === 0 ? (
          <EmptyState
            title={search ? 'No matches' : 'No customers yet'}
            description={
              search
                ? `Nothing matched "${search}".`
                : 'Once customers exist in this company they show up here.'
            }
            action={search ? { label: 'Clear search', onClick: () => setSearch('') } : undefined}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={customers.data}
            getRowId={r => r.id}
            onRowClick={r => openCustomer(r)}
          />
        )}
      </Card>
    </div>
  );
};

export default CustomersV2;
