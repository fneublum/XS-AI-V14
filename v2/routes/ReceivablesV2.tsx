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
import { useArBalances } from '../queries/useTransactions';
import { RecordPaymentDrawer, type PrefillInvoice, type OcrPrefill } from '../components/RecordPaymentDrawer';
import { ReceiptUploadModal, type ReceiptExtracted } from '../components/ReceiptUploadModal';
import { Wallet, Sparkles } from 'lucide-react';
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

interface BalanceMap {
  [invoiceId: string]: { paid: number; balance: number };
}

const buildColumns = (
  qbStatuses: Record<string, QBSyncStatus>,
  qbSyncingId: string | null,
  onSendToQb: (row: Receivable) => void,
  balances: BalanceMap,
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
  { id: 'paid', header: 'Paid', align: 'right', mono: true, sortable: true,
    value: r => balances[r.id]?.paid ?? 0,
    cell: r => {
      const b = balances[r.id];
      if (!b || b.paid <= 0) return <span className="text-slate-700">—</span>;
      return <span className="text-emerald-300 tabular-nums">{formatMoney(b.paid, r.currency)}</span>;
    } },
  { id: 'balance', header: 'Balance', align: 'right', mono: true, sortable: true,
    value: r => balances[r.id]?.balance ?? r.totalAmount,
    cell: r => {
      const b = balances[r.id];
      const bal = b ? b.balance : r.totalAmount;
      if (bal <= 0.001) {
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
            <CheckCircle size={10} /> PAID
          </span>
        );
      }
      const cls = b && b.paid > 0 ? 'text-amber-300' : 'text-slate-200';
      return <span className={`tabular-nums ${cls}`}>{formatMoney(bal, r.currency)}</span>;
    } },
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

  // AR balances: paid/outstanding per invoice from the transactions ledger.
  const ar = useArBalances();
  const balances = useMemo(() => {
    const m: Record<string, { paid: number; balance: number }> = {};
    for (const b of ar.data ?? []) m[b.invoiceId] = { paid: b.paid, balance: b.balance };
    return m;
  }, [ar.data]);
  // Headline total — outstanding balance across all visible invoices
  // (gross totalAmount minus any payments allocated). Until the
  // balances view has loaded, fall back to gross so the subtitle
  // doesn't render zero on first paint.
  const outstanding = useMemo(
    () => (rec.data ?? []).reduce((s, r) => s + (balances[r.id]?.balance ?? r.totalAmount), 0),
    [rec.data, balances],
  );

  const columns = useMemo(
    () => buildColumns(qbStatuses, qbSyncingId, handleSendToQb, balances),
    [qbStatuses, qbSyncingId, handleSendToQb, balances],
  );

  // Record-receipt drawer state — opened from the per-row "Receipt" action.
  const [receiptInvoice, setReceiptInvoice] = useState<PrefillInvoice | null>(null);
  // OCR upload modal + the prefill it produces.
  const [ocrOpen, setOcrOpen] = useState(false);
  const [ocrPrefill, setOcrPrefill] = useState<OcrPrefill | null>(null);
  const handleOcrExtracted = useCallback((e: ReceiptExtracted) => {
    setOcrPrefill({
      counterpartyName: e.counterpartyName,
      txnDate: e.txnDate,
      amount: e.amount,
      currency: e.currency,
      method: e.method ?? undefined,
      reference: e.reference ?? undefined,
      memo: e.memo ?? undefined,
      receiptDataUrl: e.receiptDataUrl ?? undefined,
      invoiceNumberHint: e.invoiceNumberHint ?? undefined,
    });
  }, []);

  const { rowActions: crudActions, drawers, openView } = useRowCrud<Receivable>({
    table: 'invoices',
    listQueryKeys: ['receivables', 'invoices'],
    rowLabel: r => `${r.invoiceNumber} → ${r.customerName}`,
    fields,
  });

  // Compose: prepend a Receipt button, then the existing View/Edit/Delete.
  const rowActions = useCallback((r: Receivable) => {
    const b = balances[r.id];
    const bal = b ? b.balance : r.totalAmount;
    const paid = bal <= 0.001;
    return (
      <div className="flex items-center gap-1 justify-end">
        {!paid && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setReceiptInvoice({
                invoiceId: r.id,
                invoiceNumber: r.invoiceNumber,
                customerName: r.customerName ?? null,
                customerId: null,
                outstanding: bal,
                // Pass the AR view's authoritative totals so the
                // drawer's Statement shows the true invoiced amount
                // and prior-paid figure, instead of reconstructing
                // them from the transactions table alone.
                totalAmount: r.totalAmount,
                paid: b ? b.paid : (r.totalAmount - bal),
                currency: r.currency,
              });
            }}
            title="Record customer receipt"
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
          >
            <Wallet size={10} /> Receipt
          </button>
        )}
        {crudActions(r)}
      </div>
    );
  }, [balances, crudActions]);

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
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => openInvoiceCreate()}
              className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
              + New invoice
            </Button>
            <Button size="sm" onClick={() => setOcrOpen(true)}
              className="bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border border-emerald-500/40 text-emerald-200 hover:from-emerald-500/30 hover:to-teal-500/30 h-7 px-2.5 text-[12px] font-medium rounded-md inline-flex items-center gap-1.5">
              <Sparkles size={12} />
              OCR Receipt
            </Button>
          </div>
        }
        emptyTitle="No invoices"
        emptyDescription="No customer invoices in the current scope."
        emptyAction={search ? undefined : { label: '+ New invoice', onClick: openInvoiceCreate }}
        skeletonCols={[100, 200, 80, 100, 80, 80, 80, 80]}
      />
      {drawers}
      <RecordPaymentDrawer
        open={!!receiptInvoice}
        onOpenChange={(v) => { if (!v) setReceiptInvoice(null); }}
        mode="receipt"
        invoice={receiptInvoice ?? undefined}
        onSuccess={() => { ar.refetch(); rec.refetch(); }}
      />
      <ReceiptUploadModal
        open={ocrOpen}
        onOpenChange={setOcrOpen}
        mode="receipt"
        onExtracted={handleOcrExtracted}
      />
      {/* OCR-driven instance — opens after extraction with the parsed
        * values pre-filled. Separate from the per-row receipt drawer
        * so the two flows don't share state. */}
      <RecordPaymentDrawer
        open={!!ocrPrefill}
        onOpenChange={(v) => { if (!v) setOcrPrefill(null); }}
        mode="receipt"
        ocrPrefill={ocrPrefill ?? undefined}
        onSuccess={() => { ar.refetch(); rec.refetch(); }}
      />
    </>
  );
};

export default ReceivablesV2;
