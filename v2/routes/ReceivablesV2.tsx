// Phase 3B — v2 Receivables.

import React, { useState } from 'react';
import { Badge } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { useReceivables, Receivable } from '../queries/useReceivables';
import { useToast } from '../primitives/Toast';

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: '2-digit' });
};

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
  { id: 'order',    header: 'Order', mono: true, cell: r => r.orderNumber },
  { id: 'invoice',  header: 'Invoice', mono: true, cell: r => (
      <span className="text-slate-500">{r.invoiceNumber ?? '—'}</span>
    ) },
  { id: 'customer', header: 'Customer', cell: r => (
      <span className="text-slate-100">{r.customerName}</span>
    ) },
  { id: 'payment',  header: 'Payment', cell: r => (
      <Badge variant={paymentTone(r.paymentStatus)} dot>{r.paymentStatus}</Badge>
    ) },
  { id: 'invoiceSt',header: 'Invoice st.', cell: r => (
      r.invoiceStatus
        ? <span className="text-slate-400 text-[11.5px]">{r.invoiceStatus}</span>
        : <span className="text-slate-600">—</span>
    ) },
  { id: 'total',    header: 'Amount', align: 'right', mono: true,
    cell: r => `$${Math.round(r.orderTotal).toLocaleString('en-US')}` },
  { id: 'delivery', header: 'Delivery', align: 'right', cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.deliveryDate)}
      </span>
    ) },
];

const ReceivablesV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const toast = useToast();
  const rec = useReceivables(search);
  const outstanding = (rec.data ?? []).reduce((s, r) => s + r.orderTotal, 0);

  return (
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
      onRowClick={r => toast.push({
        kind: 'info',
        title: `${r.orderNumber} → ${r.customerName}`,
        description: `${r.paymentStatus} · $${Math.round(r.orderTotal).toLocaleString('en-US')}`,
      })}
      emptyTitle="Nothing to collect"
      emptyDescription="Every order in this scope is marked PAID."
      skeletonCols={[100, 100, 200, 80, 80, 60]}
    />
  );
};

export default ReceivablesV2;
