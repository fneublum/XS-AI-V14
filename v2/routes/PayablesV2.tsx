// Phase 3B — v2 Payables.

import React, { useState } from 'react';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { usePayables, Payable } from '../queries/usePayables';
import { useToast } from '../primitives/Toast';

const fmtMoney = (n: number, currency: string) => {
  try {
    return n.toLocaleString('en-US', {
      style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0,
    });
  } catch { return `${currency} ${n.toLocaleString('en-US')}`; }
};

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: '2-digit' });
};

const columns: DataTableColumn<Payable>[] = [
  { id: 'inv',      header: 'Invoice #', mono: true, cell: r => r.invoiceNumber },
  { id: 'supplier', header: 'Supplier', cell: r => (
      <span className="text-slate-100">{r.supplier ?? '—'}</span>
    ) },
  { id: 'terms',    header: 'Terms', cell: r => (
      <span className="text-slate-400">{r.paymentTerms ?? '—'}</span>
    ) },
  { id: 'amount',   header: 'Amount', align: 'right', mono: true,
    cell: r => fmtMoney(r.totalAmount, r.currency) },
  { id: 'date',     header: 'Issued', align: 'right', cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.invoiceDate)}
      </span>
    ) },
];

const PayablesV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const toast = useToast();
  const pay = usePayables(search);
  const total = (pay.data ?? []).reduce((s, r) => s + r.totalAmount, 0);

  return (
    <ListPage<Payable>
      title="Payables"
      subtitle={
        pay.data
          ? `${pay.data.length} bills${total > 0 ? ` · $${Math.round(total).toLocaleString('en-US')}` : ''}${search ? ` · "${search}"` : ''}`
          : 'Loading…'
      }
      search={search}
      setSearch={setSearch}
      searchPlaceholder="Invoice # or supplier"
      cardTitle="Supplier invoices"
      columns={columns}
      getRowId={r => r.id}
      data={pay.data}
      isLoading={pay.isLoading}
      error={pay.error}
      onRetry={pay.refetch}
      onRowClick={r => toast.push({
        kind: 'info',
        title: r.invoiceNumber,
        description: `${r.supplier ?? '—'} · ${fmtMoney(r.totalAmount, r.currency)}`,
      })}
      skeletonCols={[100, 200, 100, 80, 60]}
    />
  );
};

export default PayablesV2;
