// Phase 3B — v2 Invoices (AR).
//
// Row actions: View / Edit (drawer) · Email (mailto compose) ·
// Delivery Documents · Delete. The "Delivery Documents" icon hands off
// to v1 PLInvoiceEngine by writing the invoice id to sessionStorage
// and switching to v1; v1 picks the key up and auto-opens the existing
// Documents Modal (preview / download / email Invoice, PL, SLI, BOL).

import React, { useState } from 'react';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { RowActions } from '../components/RowActions';
import { useRowDelete } from '../components/useRowDelete';
import { EmailComposeDrawer, EmailDraft } from '../components/EmailComposeDrawer';
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
  { id: 'inv', header: 'Invoice', mono: true, sortable: true, filterable: true,
    value: r => r.invoiceNumber, cell: r => r.invoiceNumber },
  { id: 'sold', header: 'Sold to', sortable: true, filterable: true,
    value: r => r.soldTo ?? r.billToName ?? '',
    cell: r => <span className="text-slate-100">{r.soldTo ?? r.billToName ?? '—'}</span> },
  { id: 'so', header: 'SO', mono: true, sortable: true, filterable: true,
    value: r => r.soNumber ?? '',
    cell: r => <span className="text-slate-500">{r.soNumber ?? '—'}</span> },
  { id: 'incoterm', header: 'Incoterm', sortable: true, filterable: true,
    value: r => r.incoterm ?? '',
    cell: r => <span className="font-mono text-[11.5px] text-slate-400">{r.incoterm ?? '—'}</span> },
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

const buildEmailDraft = (r: Invoice): EmailDraft => ({
  to: '',
  subject: `Invoice ${r.invoiceNumber} — ${r.soldTo ?? r.billToName ?? ''}`.trim(),
  body: [
    `Hello${r.billToName ? ' ' + r.billToName : ''},`,
    '',
    `Please find the details of Invoice ${r.invoiceNumber}:`,
    r.soNumber ? `Sales order: ${r.soNumber}` : '',
    r.incoterm ? `Incoterm: ${r.incoterm}` : '',
    r.paymentTerms ? `Payment terms: ${r.paymentTerms}` : '',
    r.totalAmount ? `Total: ${fmtMoney(r.totalAmount, r.currency)}` : '',
    r.invoiceDate ? `Issued: ${r.invoiceDate.slice(0, 10)}` : '',
    '',
    'Best regards',
  ].filter(Boolean).join('\n'),
  contextLabel: `Invoice ${r.invoiceNumber}`,
});

const openDeliveryDocsInV1 = (inv: Invoice) => {
  // Hands off to v1 PLInvoiceEngine — see its useEffect that reads
  // `xs_pending_delivery_docs` and auto-opens the Documents Modal.
  try { sessionStorage.setItem('xs_pending_delivery_docs', inv.id); }
  catch { /* noop */ }
  window.location.href = '/?v2=0';
};

const InvoicesV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const { openInvoice, openInvoiceCreate } = useEditor();
  const invoices = useInvoices(search);
  const total = (invoices.data ?? []).reduce((s, r) => s + r.totalAmount, 0);

  const { confirmDelete, deleteDialog } = useRowDelete<Invoice>({
    table: 'invoices',
    listQueryKeys: ['invoices'],
    rowLabel: r => r.invoiceNumber,
  });

  const rowActions = (row: Invoice) => (
    <RowActions
      onView={() => openInvoice(row)}
      onEdit={() => openInvoice(row)}
      onEmail={() => setEmailDraft(buildEmailDraft(row))}
      onDeliveryDocs={() => openDeliveryDocsInV1(row)}
      onDelete={() => confirmDelete(row)}
    />
  );

  return (
    <>
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
        rowActions={rowActions}
        emptyAction={{ label: '+ New invoice', onClick: openInvoiceCreate }}
        skeletonCols={[100, 200, 80, 80, 80, 60]}
      />
      {deleteDialog}
      <EmailComposeDrawer
        open={!!emailDraft}
        onOpenChange={(o) => !o && setEmailDraft(null)}
        draft={emailDraft}
      />
    </>
  );
};

export default InvoicesV2;
