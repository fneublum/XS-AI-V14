// Phase 3B — v2 Sales Orders list.

import React, { useMemo, useState } from 'react';
import {
  Card, CardHeader, CardTitle, Input, Badge, Skeleton, EmptyState, Button,
} from '../primitives';
import { DataTable, DataTableColumn } from '../primitives/DataTable';
import { RowActions } from '../components/RowActions';
import { useRowDelete } from '../components/useRowDelete';
import { EmailComposeDrawer, EmailDraft } from '../components/EmailComposeDrawer';
import { useSalesOrders, SalesOrder } from '../queries/useSalesOrders';
import { cn } from '../primitives/utils';
import { useEditor } from '../providers/EditorProvider';

const fmtCurrency = (n: number, currency: string) => {
  try {
    return n.toLocaleString('en-US', {
      style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0,
    });
  } catch {
    return `${currency} ${n.toLocaleString('en-US')}`;
  }
};

const fmtDate = (iso: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: '2-digit' });
};

type BadgeTone = 'success' | 'info' | 'warning' | 'neutral' | 'danger';
const statusTone = (status: string): BadgeTone => {
  const s = status.toUpperCase();
  if (s.includes('FULFIL') || s.includes('SHIP') || s.includes('COMPLETE')) return 'success';
  if (s.includes('APPROV'))                                                  return 'info';
  if (s.includes('PEND') || s.includes('HOLD'))                              return 'warning';
  if (s.includes('CANCEL') || s.includes('REJECT'))                          return 'danger';
  return 'neutral';
};

const columns: DataTableColumn<SalesOrder>[] = [
  { id: 'orderNumber', header: 'Order', mono: true, sortable: true, filterable: true,
    value: r => r.orderNumber, cell: r => r.orderNumber },
  { id: 'customer', header: 'Customer', sortable: true, filterable: true,
    value: r => r.customerName, cell: r => r.customerName },
  { id: 'status', header: 'Status', sortable: true, filterable: true,
    value: r => r.status,
    cell: r => <Badge variant={statusTone(r.status)} dot>{r.status}</Badge> },
  { id: 'incoterm', header: 'Incoterm', sortable: true, filterable: true,
    value: r => r.incoterm ?? '',
    cell: r => <span className="text-slate-400 font-mono text-[11.5px]">{r.incoterm ?? '—'}</span> },
  { id: 'terms', header: 'Terms', sortable: true, filterable: true,
    value: r => r.paymentTerms ?? '',
    cell: r => <span className="text-slate-400">{r.paymentTerms ?? '—'}</span> },
  { id: 'amount', header: 'Amount', align: 'right', mono: true, sortable: true,
    value: r => r.totalAmount,
    cell: r => fmtCurrency(r.totalAmount, r.currency) },
  { id: 'date', header: 'Ordered', align: 'right', sortable: true,
    value: r => r.orderDate || r.createdAt,
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.orderDate || r.createdAt)}
      </span>
    ) },
];

const FilterPill: React.FC<{
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}> = ({ active, onClick, children, count }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={cn(
      'px-2 py-1 rounded text-[12px] flex items-center gap-1.5 transition-colors',
      active
        ? 'bg-[#161616] text-slate-100'
        : 'border border-[#1f1f1f] text-slate-500 hover:text-slate-200',
    )}
  >
    {children}
    {count !== undefined && (
      <span className={cn(
        'font-mono tabular-nums text-[10px]',
        active ? 'text-slate-500' : 'text-slate-600',
      )}>{count}</span>
    )}
  </button>
);

const buildEmailDraft = (r: SalesOrder): EmailDraft => ({
  to: '',
  subject: `Sales Order ${r.orderNumber} — ${r.customerName}`,
  body: [
    `Hello ${r.customerName},`,
    '',
    `Please find the details of Sales Order ${r.orderNumber}:`,
    r.status ? `Status: ${r.status}` : '',
    r.incoterm ? `Incoterm: ${r.incoterm}` : '',
    r.paymentTerms ? `Payment terms: ${r.paymentTerms}` : '',
    r.totalAmount ? `Total: ${fmtCurrency(r.totalAmount, r.currency)}` : '',
    r.deliveryDate ? `Delivery: ${r.deliveryDate.slice(0, 10)}` : '',
    '',
    'Best regards',
  ].filter(Boolean).join('\n'),
  contextLabel: `SO ${r.orderNumber}`,
});

const SalesOrdersV2: React.FC = () => {
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const { openSalesOrder, openSalesOrderCreate } = useEditor();

  const all = useSalesOrders({ search });
  const rows = useMemo(() => {
    if (!all.data) return [];
    if (statusFilter === 'ALL') return all.data;
    return all.data.filter(r => r.status === statusFilter);
  }, [all.data, statusFilter]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of all.data ?? []) {
      map.set(r.status, (map.get(r.status) ?? 0) + 1);
    }
    return map;
  }, [all.data]);

  const statuses = useMemo(
    () => Array.from(counts.keys()).sort(),
    [counts],
  );

  const totalAmount = rows.reduce((s, r) => s + r.totalAmount, 0);

  const { confirmDelete, deleteDialog } = useRowDelete<SalesOrder>({
    table: 'sales_orders',
    listQueryKeys: ['salesOrders', 'recentSalesOrders'],
    rowLabel: r => r.orderNumber,
  });

  const rowActions = (row: SalesOrder) => (
    <RowActions
      onView={() => openSalesOrder(row)}
      onEdit={() => openSalesOrder(row)}
      onEmail={() => setEmailDraft(buildEmailDraft(row))}
      onDelete={() => confirmDelete(row)}
    />
  );

  return (
    <div className="max-w-6xl">
      <div className="flex items-baseline justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">
            Sales Orders
          </h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            {all.data
              ? `${rows.length} shown${statusFilter !== 'ALL' ? ` · ${statusFilter}` : ''}${search ? ` · "${search}"` : ''}`
              : 'Loading…'}
            {all.data && rows.length > 0 && (
              <> · <span className="font-mono tabular-nums">${Math.round(totalAmount).toLocaleString('en-US')}</span></>
            )}
          </p>
        </div>
        <Button
          size="sm"
          onClick={openSalesOrderCreate}
          className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md"
        >
          + New order
        </Button>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <FilterPill
          active={statusFilter === 'ALL'}
          onClick={() => setStatusFilter('ALL')}
          count={all.data?.length}
        >
          All
        </FilterPill>
        {statuses.map(status => (
          <FilterPill
            key={status}
            active={statusFilter === status}
            onClick={() => setStatusFilter(status)}
            count={counts.get(status)}
          >
            {status}
          </FilterPill>
        ))}

        <div className="ml-auto w-64">
          <Input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Order # or customer"
            className="h-7 text-[12px] bg-[#111111] border-[#1f1f1f] text-slate-200 placeholder:text-slate-500"
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {statusFilter === 'ALL' ? 'All sales orders' : statusFilter}
          </CardTitle>
        </CardHeader>

        {all.isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton width={90} height={14} />
                <Skeleton width={220} height={14} />
                <Skeleton width={80} height={14} />
                <Skeleton width={80} height={14} className="ml-auto" />
              </div>
            ))}
          </div>
        ) : all.error ? (
          <EmptyState
            tone="danger"
            title="Couldn't load sales orders"
            description={all.error.message}
            action={{ label: 'Retry', onClick: all.refetch }}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={
              search
                ? 'No matches'
                : statusFilter === 'ALL'
                  ? 'No sales orders yet'
                  : `No ${statusFilter.toLowerCase()} orders`
            }
            description={
              search
                ? `Nothing matched "${search}".`
                : statusFilter !== 'ALL'
                  ? 'Try clearing the status filter.'
                  : 'New orders show up here as they are created.'
            }
            action={
              search
                ? { label: 'Clear search', onClick: () => setSearch('') }
                : statusFilter !== 'ALL'
                  ? { label: 'Show all', onClick: () => setStatusFilter('ALL') }
                  : { label: '+ New order', onClick: openSalesOrderCreate }
            }
          />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            getRowId={r => r.id}
            onRowClick={r => openSalesOrder(r)}
            rowActions={rowActions}
          />
        )}
      </Card>

      {deleteDialog}
      <EmailComposeDrawer
        open={!!emailDraft}
        onOpenChange={(o) => !o && setEmailDraft(null)}
        draft={emailDraft}
      />
    </div>
  );
};

export default SalesOrdersV2;
