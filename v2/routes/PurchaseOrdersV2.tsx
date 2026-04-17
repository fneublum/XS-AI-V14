// Phase 3B — v2 Purchase Orders list.

import React, { useState } from 'react';
import {
  Card, CardHeader, CardTitle, Input, Skeleton, EmptyState, Badge,
} from '../primitives';
import { DataTable, DataTableColumn } from '../primitives/DataTable';
import { usePurchaseOrders, PurchaseOrder } from '../queries/usePurchaseOrders';
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
  if (s.includes('RECEIV') || s.includes('COMPLETE') || s.includes('FULFIL')) return 'success';
  if (s.includes('APPROV') || s.includes('OPEN'))                              return 'info';
  if (s.includes('PEND') || s.includes('HOLD'))                                return 'warning';
  if (s.includes('CANCEL') || s.includes('REJECT'))                            return 'danger';
  return 'neutral';
};

const columns: DataTableColumn<PurchaseOrder>[] = [
  { id: 'id',       header: 'PO #', mono: true, cell: r => r.id.slice(0, 12) },
  { id: 'supplier', header: 'Supplier', cell: r => (
      <span className="text-slate-100">{r.supplierName}</span>
    ) },
  { id: 'status',   header: 'Status', cell: r => (
      <Badge variant={statusTone(r.status)} dot>{r.status}</Badge>
    ) },
  { id: 'terms',    header: 'Terms', cell: r => (
      <span className="text-slate-400">{r.paymentTerms ?? '—'}</span>
    ) },
  { id: 'amount',   header: 'Amount', align: 'right', mono: true,
    cell: r => fmtCurrency(r.totalAmount, r.currency) },
  { id: 'date',     header: 'Ordered', align: 'right', cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.orderDate)}
      </span>
    ) },
  { id: 'eta',      header: 'Expected', align: 'right', cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.expectedDeliveryDate ?? '')}
      </span>
    ) },
];

const PurchaseOrdersV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const { openPurchaseOrder } = useEditor();
  const pos = usePurchaseOrders(search);
  const total = (pos.data ?? []).reduce((s, r) => s + r.totalAmount, 0);

  return (
    <div className="max-w-6xl">
      <div className="flex items-baseline justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">
            Purchase Orders
          </h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            {pos.data
              ? `${pos.data.length} shown${search ? ` · "${search}"` : ''}${
                  total > 0 ? ` · $${Math.round(total).toLocaleString('en-US')}` : ''
                }`
              : 'Loading…'}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All purchase orders</CardTitle>
          <div className="flex-1 max-w-xs">
            <Input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="PO id or supplier"
              className="h-7 text-[12px] bg-[#111111] border-[#1f1f1f] text-slate-200 placeholder:text-slate-500"
            />
          </div>
        </CardHeader>

        {pos.isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton width={100} height={14} />
                <Skeleton width={220} height={14} />
                <Skeleton width={80} height={14} className="ml-auto" />
              </div>
            ))}
          </div>
        ) : pos.error ? (
          <EmptyState
            tone="danger"
            title="Couldn't load purchase orders"
            description={pos.error.message}
            action={{ label: 'Retry', onClick: pos.refetch }}
          />
        ) : !pos.data || pos.data.length === 0 ? (
          <EmptyState
            title={search ? 'No matches' : 'No purchase orders yet'}
            description={
              search
                ? `Nothing matched "${search}".`
                : 'Once POs are created they show up here.'
            }
            action={search ? { label: 'Clear search', onClick: () => setSearch('') } : undefined}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={pos.data}
            getRowId={r => r.id}
            onRowClick={r => openPurchaseOrder(r)}
          />
        )}
      </Card>
    </div>
  );
};

export default PurchaseOrdersV2;
