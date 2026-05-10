// Phase 3B — v2 Receivables.
//
// Reads from the `invoices` table (parity with v1 FinanceReceivables).
// Columns: Invoice #, Customer, Invoice Date, Payment Terms, Amount,
// Due Date, Status (Overdue / Due Soon / On Track), QB (Sent / Send).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, Clock, Loader2, Send } from 'lucide-react';
import { Button } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { useRowCrud } from '../components/useRowCrud';
import { FieldDef } from '../components/QuickCreateDrawer';
import { useReceivables, Receivable } from '../queries/useReceivables';
import { useEditor } from '../providers/EditorProvider';
import { useCompany } from '../providers/CompanyProvider';
import { useToast } from '../primitives/Toast';
import { formatDate as fmtDate } from '../lib/formatDate';
import { shortName, tooltipName } from '../lib/formatName';
import { formatMoney } from '../lib/formatMoney';
import { batchGetSyncStatuses, syncReceivableInvoice } from '../../services/quickbooksService';
import { getSupabaseClient } from '../../services/supabase';
import type { Invoice, QBSyncStatus } from '../../types';

// ─── Due-status helpers (parity with v1 FinanceReceivables) ──
const calcDueDate = (baseDate: string | null, paymentTerms: string | null): Date | null => {
  if (!baseDate) return null;
  const base = new Date(baseDate);
  if (isNaN(base.getTime())) return null;
  const days = paymentTerms ? parseInt((paymentTerms.match(/\d+/) || ['0'])[0], 10) : 0;
  if (days > 0) base.setDate(base.getDate() + days);
  return base;
};

type DueLabel = 'Overdue' | 'Due Soon' | 'On Track' | 'No Date';
const getDueStatus = (r: Receivable): { label: DueLabel; dueDate: Date | null } => {
  const due = calcDueDate(r.invoiceDate, r.paymentTerms);
  if (!due) return { label: 'No Date', dueDate: null };
  const diffDays = Math.ceil((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0)  return { label: 'Overdue',  dueDate: due };
  if (diffDays <= 7) return { label: 'Due Soon', dueDate: due };
  return { label: 'On Track', dueDate: due };
};

const StatusPill: React.FC<{ label: DueLabel }> = ({ label }) => {
  const map: Record<DueLabel, { cls: string; icon: React.ReactNode }> = {
    'Overdue':  { cls: 'bg-rose-500/10 text-rose-300 border-rose-500/20', icon: <AlertCircle size={10} /> },
    'Due Soon': { cls: 'bg-amber-500/10 text-amber-300 border-amber-500/20', icon: <Clock size={10} /> },
    'On Track': { cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20', icon: <CheckCircle size={10} /> },
    'No Date':  { cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20', icon: null },
  };
  const { cls, icon } = map[label];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-semibold border ${cls}`}>
      {icon}{label}
    </span>
  );
};

const buildColumns = (
  qbStatuses: Record<string, QBSyncStatus>,
  qbSyncingId: string | null,
  onSendToQb: (row: Receivable) => void,
): DataTableColumn<Receivable>[] => [
  { id: 'invoice', header: 'Invoice #', mono: true, sortable: true, filterable: true,
    value: r => r.invoiceNumber,
    cell: r => r.invoiceNumber },
  { id: 'customer', header: 'Customer', sortable: true, filterable: true,
    value: r => r.customerName,
    cell: r => <span className="text-slate-100" title={tooltipName(r.customerName)}>{shortName(r.customerName)}</span> },
  { id: 'date', header: 'Issued', align: 'right', sortable: true,
    value: r => r.invoiceDate ?? '',
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.invoiceDate)}
      </span>
    ) },
  { id: 'terms', header: 'Terms', sortable: true, filterable: true,
    value: r => r.paymentTerms ?? '',
    cell: r => <span className="text-slate-400">{r.paymentTerms ?? '—'}</span> },
  { id: 'amount', header: 'Amount', align: 'right', mono: true, sortable: true,
    value: r => r.totalAmount,
    cell: r => formatMoney(r.totalAmount, r.currency) },
  { id: 'due', header: 'Due', align: 'right', sortable: true,
    value: r => {
      const d = getDueStatus(r).dueDate;
      return d ? d.toISOString() : '';
    },
    cell: r => {
      const d = getDueStatus(r).dueDate;
      return (
        <span className="text-slate-500 font-mono tabular-nums text-[11px]">
          {d ? fmtDate(d.toISOString()) : '—'}
        </span>
      );
    } },
  { id: 'status', header: 'Status', sortable: true, filterable: true,
    value: r => getDueStatus(r).label,
    cell: r => <StatusPill label={getDueStatus(r).label} /> },
  { id: 'qb', header: 'QB', sortable: true, filterable: true,
    value: r => (r.qbStatus === 'Sent' || qbStatuses[r.id]?.synced) ? 'Sent' : '—',
    cell: r => {
      const sent = r.qbStatus === 'Sent' || qbStatuses[r.id]?.synced;
      if (sent) {
        return (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
            title={qbStatuses[r.id]?.qbEntityId ? `Invoice #${qbStatuses[r.id].qbEntityId}` : 'Synced to QuickBooks'}
          >
            <CheckCircle size={10} /> Sent
          </span>
        );
      }
      const syncing = qbSyncingId === r.id;
      return (
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onSendToQb(r); }}
          disabled={syncing}
          title={qbStatuses[r.id]?.error ? `Retry — last error: ${qbStatuses[r.id].error}` : 'Send to QuickBooks'}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-semibold border transition-colors ${
            syncing
              ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20 cursor-wait'
              : 'bg-[#141414] text-slate-300 border-[#1f1f1f] hover:text-indigo-300 hover:border-indigo-500/40'
          }`}
        >
          {syncing ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />}
          {syncing ? 'Sending…' : 'Send to QB'}
        </button>
      );
    } },
];

const fields: FieldDef[] = [
  { key: 'invoiceNumber', label: 'Invoice #', required: true, mono: true },
  { key: 'soldTo', label: 'Customer', fullWidth: true,
    source: {
      table: 'customers', valueColumn: 'name', labelColumn: 'name',
      secondaryColumn: 'country', scopeByCompany: true,
    } },
  { key: 'invoiceDate',  label: 'Invoice date', type: 'date' },
  { key: 'paymentTerms', label: 'Payment terms',
    source: {
      table: 'payment_terms', valueColumn: 'description', labelColumn: 'description',
      secondaryColumn: 'code', scopeByCompany: true,
    } },
  { key: 'totalAmount',  label: 'Amount', type: 'number', mono: true, min: 0, step: 0.01 },
  { key: 'currency',     label: 'Currency', mono: true, defaultValue: 'USD' },
];

const ReceivablesV2: React.FC = () => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const [search, setSearch] = useState('');
  const rec = useReceivables(search);
  const { openInvoiceCreate } = useEditor();
  const outstanding = (rec.data ?? []).reduce((s, r) => s + r.totalAmount, 0);

  // ─── QuickBooks sync state ────────────────────────────────────
  const [qbStatuses, setQbStatuses] = useState<Record<string, QBSyncStatus>>({});
  const [qbSyncingId, setQbSyncingId] = useState<string | null>(null);

  // Batch-load QB sync statuses once the list arrives — mirrors
  // v1's qb_sync_log hydration.
  useEffect(() => {
    const ids = (rec.data ?? []).map(r => r.id);
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const map = await batchGetSyncStatuses(ids, 'invoices');
        if (!cancelled) setQbStatuses(prev => ({ ...prev, ...map }));
      } catch (e) {
        console.warn('QB sync status fetch failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [rec.data]);

  const handleSendToQb = useCallback(async (row: Receivable) => {
    if (qbSyncingId) return;
    setQbSyncingId(row.id);
    try {
      const payload = {
        id: row.id,
        invoiceNumber: row.invoiceNumber,
        soldTo: row.customerName,
        billToName: row.customerName,
        invoiceDate: row.invoiceDate ?? '',
        paymentTerms: row.paymentTerms ?? '',
        totalAmount: row.totalAmount,
        currency: row.currency,
      } as unknown as Invoice;
      const result = await syncReceivableInvoice(currentCompanyId || 'ALL', payload);
      setQbStatuses(prev => ({ ...prev, [row.id]: result }));
      try {
        const supabase = getSupabaseClient();
        await supabase.from('invoices').update({ qb_status: 'Sent' }).eq('id', row.id);
      } catch (dbErr) {
        console.warn('qb_status update failed:', dbErr);
      }
      toast.push({
        kind: 'success',
        title: 'Sent to QuickBooks',
        description: result.qbEntityId ? `Invoice #${result.qbEntityId}` : row.invoiceNumber,
      });
    } catch (err) {
      const msg = (err as Error).message;
      setQbStatuses(prev => ({ ...prev, [row.id]: { synced: false, error: msg } }));
      toast.push({ kind: 'error', title: 'QuickBooks sync failed', description: msg });
    } finally {
      setQbSyncingId(null);
    }
  }, [currentCompanyId, qbSyncingId, toast]);

  const columns = useMemo(
    () => buildColumns(qbStatuses, qbSyncingId, handleSendToQb),
    [qbStatuses, qbSyncingId, handleSendToQb],
  );

  const { rowActions, drawers, openView } = useRowCrud<Receivable>({
    table: 'invoices',
    listQueryKeys: ['receivables', 'invoices'],
    rowLabel: r => `${r.invoiceNumber} → ${r.customerName}`,
    fields,
  });

  return (
    <>
      <ListPage<Receivable>
        title="Receivables"
        subtitle={
          rec.data
            ? `${rec.data.length} invoices${outstanding > 0 ? ` · ${formatMoney(outstanding)}` : ''}${search ? ` · "${search}"` : ''}`
            : 'Loading…'
        }
        search={search}
        setSearch={setSearch}
        searchPlaceholder="Invoice # or customer"
        cardTitle="Customer invoices"
        columns={columns}
        getRowId={r => r.id}
        data={rec.data}
        isLoading={rec.isLoading}
        error={rec.error}
        onRetry={rec.refetch}
        onRowClick={openView}
        rowActions={rowActions}
        headerAction={
          <Button size="sm" onClick={() => openInvoiceCreate()}
            className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
            + New invoice
          </Button>
        }
        emptyTitle="No invoices"
        emptyDescription="No customer invoices in the current scope."
        emptyAction={search ? undefined : { label: '+ New invoice', onClick: openInvoiceCreate }}
        skeletonCols={[100, 200, 80, 100, 80, 80, 80, 80]}
      />
      {drawers}
    </>
  );
};

export default ReceivablesV2;
