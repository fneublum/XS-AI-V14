// Phase 3B — v2 Invoices (AR).

import React, { useState } from 'react';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { useInvoices, Invoice } from '../queries/useInvoices';
import { useEditor } from '../providers/EditorProvider';
import { Button } from '../primitives';

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

const columns: DataTableColumn<Invoice>[] = [
  { id: 'inv',      header: 'Invoice', mono: true, cell: r => r.invoiceNumber },
  { id: 'sold',     header: 'Sold to', cell: r => (
      <span className="text-slate-100">{r.soldTo ?? r.billToName ?? '—'}</span>
    ) },
  { id: 'so',       header: 'SO', mono: true, cell: r => (
      <span className="text-slate-500">{r.soNumber ?? '—'}</span>
    ) },
  { id: 'incoterm', header: 'Incoterm', cell: r => (
      <span className="font-mono text-[11.5px] text-slate-400">{r.incoterm ?? '—'}</span>
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

const InvoicesV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const { openInvoice, openInvoiceCreate } = useEditor();
  const invoices = useInvoices(search);
  const total = (invoices.data ?? []).reduce((s, r) => s + r.totalAmount, 0);

  return (
    <ListPage<Invoice>
      title="Invoices"
      subtitle={
        invoices.data
          ? `${invoices.data.length} shown${total > 0 ? ` · $${Math.round(total).toLocaleString('en-US')}` : ''}${search ? ` · "${search}"` : ''}`
          : 'Loading…'
      }
      headerAction={
        <Button size="sm" onClick={openInvoiceCreate}
          className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
          + New invoice
        </Button>
      }
      search={search}
      setSearch={setSearch}
      searchPlaceholder="Invoice # or customer"
      columns={columns}
      getRowId={r => r.id}
      data={invoices.data}
      isLoading={invoices.isLoading}
      error={invoices.error}
      onRetry={invoices.refetch}
      onRowClick={r => openInvoice(r)}
      skeletonCols={[100, 200, 80, 80, 80, 60]}
    />
  );
};

export default InvoicesV2;
