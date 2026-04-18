// Phase 3B — v2 Customers page. Full v1 parity + per-column sort/filter.

import React, { useMemo, useState } from 'react';
import {
  Card, CardHeader, CardTitle, Input, Skeleton, EmptyState, Button, Badge,
} from '../primitives';
import { DataTable, DataTableColumn } from '../primitives/DataTable';
import { RowActions } from '../components/RowActions';
import { useRowDelete } from '../components/useRowDelete';
import { useCustomers, Customer } from '../queries/useCustomers';
import { useEditor } from '../providers/EditorProvider';

type BadgeTone = 'success' | 'info' | 'warning' | 'neutral' | 'danger';
const statusTone = (s: string | null): BadgeTone => {
  if (!s) return 'neutral';
  const u = s.toUpperCase();
  if (u === 'ACTIVE') return 'success';
  if (u.includes('RISK')) return 'warning';
  if (u === 'INACTIVE') return 'neutral';
  return 'info';
};

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: '2-digit' });
};

const CustomersV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const { openCustomer, openCustomerCreate } = useEditor();
  const customers = useCustomers(search);

  const { confirmDelete, deleteDialog } = useRowDelete<Customer>({
    table: 'customers',
    listQueryKeys: ['customers'],
    rowLabel: r => r.name,
  });

  const columns: DataTableColumn<Customer>[] = useMemo(() => [
    {
      id: 'name', header: 'Name', sortable: true, filterable: true,
      value: r => r.name,
      cell: r => (
        <div>
          <div className="text-slate-100 font-medium">{r.name}</div>
          {r.nickname && <div className="text-[11px] text-slate-500">{r.nickname}</div>}
        </div>
      ),
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
      id: 'pod', header: 'POD', mono: true, sortable: true, filterable: true,
      value: r => r.pod ?? '',
      cell: r => r.pod ?? <span className="text-slate-600">—</span>,
    },
    {
      id: 'terms', header: 'Terms', sortable: true, filterable: true,
      value: r => r.paymentTerms ?? '',
      cell: r => <span className="text-slate-400">{r.paymentTerms ?? '—'}</span>,
    },
    {
      id: 'status', header: 'Status', sortable: true, filterable: true,
      value: r => r.status ?? '',
      cell: r => r.status
        ? <Badge variant={statusTone(r.status)} dot>{r.status}</Badge>
        : <span className="text-slate-600">—</span>,
    },
    {
      id: 'last', header: 'Last order', align: 'right', sortable: true,
      value: r => r.lastOrderDate ?? '',
      cell: r => (
        <span className="text-slate-500 font-mono tabular-nums text-[11px]">
          {fmtDate(r.lastOrderDate)}
        </span>
      ),
    },
  ], []);

  const rowActions = (row: Customer) => (
    <RowActions
      onView={() => openCustomer(row)}
      onEdit={() => openCustomer(row)}
      onDelete={() => confirmDelete(row)}
    />
  );

  const data = customers.data ?? [];

  return (
    <div className="max-w-6xl">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">Customers</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            {customers.data
              ? `${data.length} shown${search ? ` · "${search}"` : ''}`
              : 'Loading…'}
          </p>
        </div>
        <Button
          size="sm"
          onClick={openCustomerCreate}
          className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md"
        >
          + New customer
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All customers</CardTitle>
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

        {customers.isLoading ? (
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
        ) : customers.error ? (
          <EmptyState
            tone="danger"
            title="Couldn't load customers"
            description={customers.error.message}
            action={{ label: 'Retry', onClick: customers.refetch }}
          />
        ) : data.length === 0 ? (
          <EmptyState
            title={search ? 'No matches' : 'No customers yet'}
            description={search ? `Nothing matched "${search}".` : 'Add your first customer to get started.'}
            action={search
              ? { label: 'Clear search', onClick: () => setSearch('') }
              : { label: '+ New customer', onClick: openCustomerCreate }}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={data}
            getRowId={r => r.id}
            onRowClick={r => openCustomer(r)}
            rowActions={rowActions}
            defaultSort={{ columnId: 'name', direction: 'asc' }}
          />
        )}
      </Card>
      {deleteDialog}
    </div>
  );
};

export default CustomersV2;
