// Phase 3B — v2 Purchase Orders list.

import React, { useState } from 'react';
import {
  Card, CardHeader, CardTitle, Input, Skeleton, EmptyState, Badge, Button,
} from '../primitives';
import { DataTable, DataTableColumn } from '../primitives/DataTable';
import { RowActions } from '../components/RowActions';
import { useRowDelete } from '../components/useRowDelete';
import { EmailComposeDrawer, EmailDraft } from '../components/EmailComposeDrawer';
import { usePurchaseOrders, PurchaseOrder } from '../queries/usePurchaseOrders';
import { useEditor } from '../providers/EditorProvider';
import { formatDate as fmtDate } from '../lib/formatDate';

const fmtCurrency = (n: number, currency: string) => {
  try {
    return n.toLocaleString('en-US', {
      style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0,
    });
  } catch {
    return `${currency} ${n.toLocaleString('en-US')}`;
  }
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
  { id: 'id', header: 'PO #', mono: true, sortable: true, filterable: true,
    value: r => r.id, cell: r => r.id.slice(0, 12) },
  { id: 'supplier', header: 'Supplier', sortable: true, filterable: true,
    value: r => r.supplierName,
    cell: r => <span className="text-slate-100">{r.supplierName}</span> },
  { id: 'status', header: 'Status', sortable: true, filterable: true,
    value: r => r.status,
    cell: r => <Badge variant={statusTone(r.status)} dot>{r.status}</Badge> },
  { id: 'terms', header: 'Terms', sortable: true, filterable: true,
    value: r => r.paymentTerms ?? '',
    cell: r => <span className="text-slate-400">{r.paymentTerms ?? '—'}</span> },
  { id: 'amount', header: 'Amount', align: 'right', mono: true, sortable: true,
    value: r => r.totalAmount,
    cell: r => fmtCurrency(r.totalAmount, r.currency) },
  { id: 'date', header: 'Ordered', align: 'right', sortable: true,
    value: r => r.orderDate,
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.orderDate)}
      </span>
    ) },
  { id: 'eta', header: 'Expected', align: 'right', sortable: true,
    value: r => r.expectedDeliveryDate ?? '',
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.expectedDeliveryDate ?? '')}
      </span>
    ) },
];

const buildEmailDraft = (r: PurchaseOrder): EmailDraft => ({
  to: '',
  subject: `Purchase Order ${r.id.slice(0, 12)} — ${r.supplierName}`,
  body: [
    `Hello ${r.supplierName},`,
    '',
    `Please confirm receipt of Purchase Order ${r.id.slice(0, 12)}:`,
    r.status ? `Status: ${r.status}` : '',
    r.paymentTerms ? `Payment terms: ${r.paymentTerms}` : '',
    r.totalAmount ? `Total: ${fmtCurrency(r.totalAmount, r.currency)}` : '',
    r.expectedDeliveryDate ? `Expected delivery: ${r.expectedDeliveryDate.slice(0, 10)}` : '',
    '',
    'Best regards',
  ].filter(Boolean).join('\n'),
  contextLabel: `PO ${r.id.slice(0, 12)}`,
});

const PurchaseOrdersV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const { openPurchaseOrder, openPurchaseOrderCreate } = useEditor();
  const pos = usePurchaseOrders(search);
  const total = (pos.data ?? []).reduce((s, r) => s + r.totalAmount, 0);

  const { confirmDelete, deleteDialog } = useRowDelete<PurchaseOrder>({
    table: 'purchase_orders',
    listQueryKeys: ['purchaseOrders'],
    rowLabel: r => r.id.slice(0, 12),
  });

  const rowActions = (row: PurchaseOrder) => (
    <RowActions
      onView={() => openPurchaseOrder(row)}
      onEdit={() => openPurchaseOrder(row)}
      onEmail={() => setEmailDraft(buildEmailDraft(row))}
      onDelete={() => confirmDelete(row)}
    />
  );

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
        <Button size="sm" onClick={openPurchaseOrderCreate}
          className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
          + New PO
        </Button>
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
            action={
              search
                ? { label: 'Clear search', onClick: () => setSearch('') }
                : { label: '+ New PO', onClick: openPurchaseOrderCreate }
            }
          />
        ) : (
          <DataTable
            columns={columns}
            rows={pos.data}
            getRowId={r => r.id}
            onRowClick={r => openPurchaseOrder(r)}
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

export default PurchaseOrdersV2;
