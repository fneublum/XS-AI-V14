// Phase 3B — v2 Payment Terms.
//
// Port of pages/PaymentTerms.tsx into the v2 shell. Installments are
// stored as a JSONB array and shown as a compact summary in the list.
// The AI Upload modal mirrors Freight Quotes: users can paste a
// payment-terms clause from a contract or upload a PDF and Gemini
// returns a structured draft ready to review + save.

import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Badge, Button } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { useRowCrud } from '../components/useRowCrud';
import {
  usePaymentTerms, PaymentTerm, PaymentInstallment,
} from '../queries/usePaymentTerms';

type BadgeTone = 'success' | 'info' | 'warning' | 'neutral' | 'danger';
const methodTone = (method: string): BadgeTone => {
  const m = method.toUpperCase();
  if (m === 'ADVANCE' || m === 'TT')     return 'success';
  if (m === 'LC' || m === 'CAD')         return 'info';
  if (m === 'DA' || m === 'DP')          return 'warning';
  if (m === 'COD')                       return 'danger';
  return 'neutral';
};

const typeTone = (type: string): BadgeTone => {
  const t = type.toUpperCase();
  if (t === 'ALL')      return 'info';
  if (t === 'DOMESTIC') return 'success';
  if (t === 'IMPORT')   return 'warning';
  if (t === 'EXPORT')   return 'neutral';
  return 'neutral';
};

const summarizeInstallments = (inst: PaymentInstallment[]): string => {
  if (!inst || inst.length === 0) return '—';
  return inst
    .map(i => `${i.pct}% @ ${i.event}${i.days ? `+${i.days}d` : ''}`)
    .join(' · ');
};

const columns: DataTableColumn<PaymentTerm>[] = [
  { id: 'code', header: 'Code', mono: true, sortable: true, filterable: true,
    value: r => r.code,
    cell: r => <span className="font-mono text-slate-100 font-medium">{r.code}</span> },
  { id: 'description', header: 'Description', sortable: true, filterable: true,
    value: r => r.description, cell: r => r.description },
  { id: 'type', header: 'Type', sortable: true, filterable: true,
    value: r => r.type,
    cell: r => <Badge variant={typeTone(r.type)} dot>{r.type}</Badge> },
  { id: 'method', header: 'Method', sortable: true, filterable: true,
    value: r => r.method,
    cell: r => <Badge variant={methodTone(r.method)}>{r.method}</Badge> },
  { id: 'num', header: '# pmt', align: 'right', mono: true, sortable: true,
    value: r => r.numPayments,
    cell: r => r.numPayments || (r.installments?.length ?? 0) },
  { id: 'schedule', header: 'Schedule', sortable: false, filterable: true,
    value: r => summarizeInstallments(r.installments),
    cell: r => (
      <span className="text-[11px] text-slate-400 font-mono truncate max-w-[280px] block">
        {summarizeInstallments(r.installments)}
      </span>
    ) },
  { id: 'active', header: 'Active', sortable: true,
    value: r => r.active ? 1 : 0,
    cell: r => r.active
      ? <Badge variant="success" dot>Active</Badge>
      : <Badge variant="neutral">Inactive</Badge> },
];

const fields: FieldDef[] = [
  { key: 'code',        label: 'Code', required: true, mono: true },
  { key: 'description', label: 'Description', required: true, fullWidth: true },
  { key: 'type',        label: 'Type', type: 'select',
    options: ['ALL', 'DOMESTIC', 'IMPORT', 'EXPORT'], defaultValue: 'ALL' },
  { key: 'method',      label: 'Method', type: 'select',
    options: ['TT', 'LC', 'CAD', 'DA', 'DP', 'ADVANCE', 'NET', 'COD', 'OTHER'],
    defaultValue: 'NET' },
  { key: 'numPayments', dbKey: 'num_payments', label: '# payments',
    type: 'number', mono: true, min: 1, step: 1, defaultValue: '1' },
  { key: 'notes', label: 'Notes', type: 'textarea', fullWidth: true },
];

const PaymentTermsV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const terms = usePaymentTerms(search);

  const { rowActions, drawers, openView } = useRowCrud<PaymentTerm>({
    table: 'payment_terms',
    listQueryKeys: ['paymentTerms'],
    rowLabel: r => r.code,
    fields,
  });

  const openCreate = () => setCreateOpen(true);

  return (
    <>
      <ListPage<PaymentTerm>
        title="Payment Terms"
        subtitle={
          terms.data
            ? `${terms.data.length} shown${search ? ` · "${search}"` : ''}`
            : 'Loading…'
        }
        search={search}
        setSearch={setSearch}
        searchPlaceholder="Code, description, method"
        cardTitle="All payment terms"
        columns={columns}
        getRowId={r => r.id}
        data={terms.data}
        isLoading={terms.isLoading}
        error={terms.error}
        onRetry={terms.refetch}
        onRowClick={openView}
        rowActions={rowActions}
        headerAction={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={openCreate}
              className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
              + New term
            </Button>
            <Button size="sm" disabled
              title="Coming next — same AI Upload pattern as Freight Quotes"
              className="bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 text-indigo-300/60 h-7 px-2.5 text-[12px] font-medium rounded-md inline-flex items-center gap-1.5 cursor-not-allowed">
              <Sparkles size={12} />
              AI Upload
            </Button>
          </div>
        }
        emptyAction={search ? undefined : { label: '+ New term', onClick: openCreate }}
        skeletonCols={[80, 200, 80, 80, 40, 240]}
      />
      <QuickCreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New payment term"
        description="Define a reusable payment schedule."
        table="payment_terms"
        idPrefix="PT"
        listQueryKeys={['paymentTerms']}
        scopeByCompany
        fields={fields}
        extras={{ active: true, installments: [] }}
      />
      {drawers}
    </>
  );
};

export default PaymentTermsV2;
