// Phase 3B — v2 Payables.

import React, { useState } from 'react';
import { Button } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { useRowCrud } from '../components/useRowCrud';
import { usePayables, Payable } from '../queries/usePayables';

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
  { id: 'inv', header: 'Invoice #', mono: true, sortable: true, filterable: true,
    value: r => r.invoiceNumber, cell: r => r.invoiceNumber },
  { id: 'supplier', header: 'Supplier', sortable: true, filterable: true,
    value: r => r.supplier ?? '',
    cell: r => <span className="text-slate-100">{r.supplier ?? '—'}</span> },
  { id: 'terms', header: 'Terms', sortable: true, filterable: true,
    value: r => r.paymentTerms ?? '',
    cell: r => <span className="text-slate-400">{r.paymentTerms ?? '—'}</span> },
  { id: 'amount', header: 'Amount', align: 'right', mono: true, sortable: true,
    value: r => r.totalAmount,
    cell: r => fmtMoney(r.totalAmount, r.currency) },
  { id: 'date', header: 'Issued', align: 'right', sortable: true,
    value: r => r.invoiceDate ?? '',
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.invoiceDate)}
      </span>
    ) },
];

const fields: FieldDef[] = [
  { key: 'invoiceNumber', label: 'Invoice #', required: true, mono: true },
  { key: 'shipperName',   label: 'Supplier', fullWidth: true },
  { key: 'invoiceDate',   label: 'Invoice date', type: 'date' },
  { key: 'paymentTerms',  label: 'Payment terms', placeholder: 'e.g. Net 30' },
  { key: 'totalAmount',   label: 'Amount', type: 'number', mono: true, min: 0, step: 0.01 },
  { key: 'currency',      label: 'Currency', mono: true, defaultValue: 'USD' },
];

const PayablesV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const pay = usePayables(search);
  const total = (pay.data ?? []).reduce((s, r) => s + r.totalAmount, 0);

  const { rowActions, drawers, openView } = useRowCrud<Payable>({
    table: 'invoices_suppliers',
    listQueryKeys: ['payables'],
    rowLabel: r => r.invoiceNumber,
    fields,
  });

  const openCreate = () => setCreateOpen(true);

  return (
    <>
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
        onRowClick={openView}
        rowActions={rowActions}
        headerAction={
          <Button size="sm" onClick={openCreate}
            className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
            + New bill
          </Button>
        }
        emptyAction={search ? undefined : { label: '+ New bill', onClick: openCreate }}
        skeletonCols={[100, 200, 100, 80, 60]}
      />
      <QuickCreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New supplier bill"
        description="Log an incoming supplier invoice (payable)."
        table="invoices_suppliers"
        idPrefix="SINV"
        listQueryKeys={['payables']}
        scopeByCompany
        fields={fields}
      />
      {drawers}
    </>
  );
};

export default PayablesV2;
