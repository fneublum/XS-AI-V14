// Phase 3B — v2 Payment Terms.
//
// Port of pages/PaymentTerms.tsx into the v2 shell. Full-fidelity
// edit via PaymentTermDrawer: installments editor, active flag, and
// every column on the `payment_terms` table.

import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Badge, Button, ConfirmDialog } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { RowActions } from '../components/RowActions';
import { PaymentTermDrawer } from '../components/PaymentTermDrawer';
import { useEntityDelete } from '../queries/useEntityMutations';
import { useToast } from '../primitives/Toast';
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

const EMPTY_TERM: PaymentTerm = {
  id: '',
  companyId: null,
  code: '',
  description: '',
  type: 'ALL',
  method: 'TT',
  numPayments: 1,
  installments: [],
  notes: null,
  active: true,
  createdAt: null,
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

const PaymentTermsV2: React.FC = () => {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ term: PaymentTerm; mode: 'edit' | 'create' } | null>(null);
  const [confirmDeleteRow, setConfirmDeleteRow] = useState<PaymentTerm | null>(null);
  const terms = usePaymentTerms(search);
  const del = useEntityDelete({ table: 'payment_terms', listQueryKeys: ['paymentTerms'] });

  const openEdit = (row: PaymentTerm) => setEditing({ term: row, mode: 'edit' });
  const openCreate = () => setEditing({ term: EMPTY_TERM, mode: 'create' });

  const rowActions = (row: PaymentTerm) => (
    <RowActions
      onView={() => openEdit(row)}
      onEdit={() => openEdit(row)}
      onDelete={() => setConfirmDeleteRow(row)}
    />
  );

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
        onRowClick={openEdit}
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
      <PaymentTermDrawer
        term={editing?.term ?? null}
        mode={editing?.mode ?? 'edit'}
        onOpenChange={(o) => !o && setEditing(null)}
      />
      <ConfirmDialog
        open={!!confirmDeleteRow}
        onOpenChange={(o) => !o && setConfirmDeleteRow(null)}
        title={`Delete ${confirmDeleteRow?.code ?? ''}?`}
        description="Invoices and orders referencing this term keep the text value but lose the live link."
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={() => {
          if (!confirmDeleteRow) return;
          const label = confirmDeleteRow.code;
          del.mutate(confirmDeleteRow.id, {
            onSuccess: () => {
              toast.push({ kind: 'success', title: 'Deleted', description: label });
              setConfirmDeleteRow(null);
            },
            onError: (err) => {
              toast.push({ kind: 'error', title: 'Delete failed', description: err.message });
              setConfirmDeleteRow(null);
            },
          });
        }}
      />
    </>
  );
};

export default PaymentTermsV2;
