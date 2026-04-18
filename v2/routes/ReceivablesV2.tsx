// Phase 3B — v2 Receivables.

import React, { useState } from 'react';
import { Badge, Button } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { useRowCrud } from '../components/useRowCrud';
import { FieldDef } from '../components/QuickCreateDrawer';
import { useReceivables, Receivable } from '../queries/useReceivables';
import { useEditor } from '../providers/EditorProvider';
import { formatDate as fmtDate } from '../lib/formatDate';

type BadgeTone = 'success' | 'info' | 'warning' | 'neutral' | 'danger';
const paymentTone = (status: string): BadgeTone => {
  const s = status.toUpperCase();
  if (s.includes('PAID'))                           return 'success';
  if (s.includes('PARTIAL'))                        return 'info';
  if (s.includes('OVERDUE') || s.includes('LATE'))  return 'danger';
  if (s.includes('PEND'))                           return 'warning';
  return 'neutral';
};

const columns: DataTableColumn<Receivable>[] = [
  { id: 'order', header: 'Order', mono: true, sortable: true, filterable: true,
    value: r => r.orderNumber, cell: r => r.orderNumber },
  { id: 'invoice', header: 'Invoice', mono: true, sortable: true, filterable: true,
    value: r => r.invoiceNumber ?? '',
    cell: r => <span className="text-slate-500">{r.invoiceNumber ?? '—'}</span> },
  { id: 'customer', header: 'Customer', sortable: true, filterable: true,
    value: r => r.customerName,
    cell: r => <span className="text-slate-100">{r.customerName}</span> },
  { id: 'payment', header: 'Payment', sortable: true, filterable: true,
    value: r => r.paymentStatus,
    cell: r => <Badge variant={paymentTone(r.paymentStatus)} dot>{r.paymentStatus}</Badge> },
  { id: 'invoiceSt', header: 'Invoice st.', sortable: true, filterable: true,
    value: r => r.invoiceStatus ?? '',
    cell: r => (
      r.invoiceStatus
        ? <span className="text-slate-400 text-[11.5px]">{r.invoiceStatus}</span>
        : <span className="text-slate-600">—</span>
    ) },
  { id: 'total', header: 'Amount', align: 'right', mono: true, sortable: true,
    value: r => r.orderTotal,
    cell: r => `$${Math.round(r.orderTotal).toLocaleString('en-US')}` },
  { id: 'delivery', header: 'Delivery', align: 'right', sortable: true,
    value: r => r.deliveryDate ?? '',
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.deliveryDate)}
      </span>
    ) },
];

// Receivables read the commission_sales_orders table but only expose
// the subset a finance user cares about editing.
const fields: FieldDef[] = [
  { key: 'orderNumber',    label: 'Order #', mono: true },
  { key: 'invoiceNumber',  label: 'Invoice #', mono: true },
  { key: 'customerName',   label: 'Customer', fullWidth: true },
  { key: 'paymentStatus',  label: 'Payment status', type: 'select',
    options: ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED'] },
  { key: 'invoiceStatus',  label: 'Invoice status', type: 'select',
    options: ['UNINVOICED', 'INVOICED', 'SENT', 'VOID'] },
  { key: 'orderTotal',     label: 'Amount', type: 'number', mono: true, min: 0, step: 0.01 },
  { key: 'deliveryDate',   label: 'Delivery', type: 'date' },
];

const ReceivablesV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const rec = useReceivables(search);
  const { openInvoiceCreate } = useEditor();
  const outstanding = (rec.data ?? []).reduce((s, r) => s + r.orderTotal, 0);

  const { rowActions, drawers, openView } = useRowCrud<Receivable>({
    table: 'commission_sales_orders',
    listQueryKeys: ['receivables', 'commissions'],
    rowLabel: r => `${r.orderNumber} → ${r.customerName}`,
    fields,
  });

  return (
    <>
      <ListPage<Receivable>
        title="Receivables"
        subtitle={
          rec.data
            ? `${rec.data.length} open${outstanding > 0 ? ` · $${Math.round(outstanding).toLocaleString('en-US')} outstanding` : ''}${search ? ` · "${search}"` : ''}`
            : 'Loading…'
        }
        search={search}
        setSearch={setSearch}
        searchPlaceholder="Order, invoice, customer"
        cardTitle="Open receivables"
        columns={columns}
        getRowId={r => r.id}
        data={rec.data}
        isLoading={rec.isLoading}
        error={rec.error}
        onRetry={rec.refetch}
        onRowClick={openView}
        rowActions={rowActions}
        headerAction={
          <Button size="sm" onClick={openInvoiceCreate}
            className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
            + New invoice
          </Button>
        }
        emptyTitle="Nothing to collect"
        emptyDescription="Every order in this scope is marked PAID."
        emptyAction={search ? undefined : { label: '+ New invoice', onClick: openInvoiceCreate }}
        skeletonCols={[100, 100, 200, 80, 80, 60]}
      />
      {drawers}
    </>
  );
};

export default ReceivablesV2;
