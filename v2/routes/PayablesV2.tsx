// Phase 3B — v2 Payables.

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Clock, Loader2, Send, Sparkles } from 'lucide-react';
import { Button, Input, FormField, Label } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { AiUploadModal } from '../components/AiUploadModal';
import { SupabaseSelectField } from '../components/SupabaseSelectField';
import { useRowCrud } from '../components/useRowCrud';
import { useEntityInsert } from '../queries/useEntityMutations';
import { useCompany } from '../providers/CompanyProvider';
import { useToast } from '../primitives/Toast';
import { usePayables, Payable } from '../queries/usePayables';
import { formatDate as fmtDate } from '../lib/formatDate';
import { shortName, tooltipName } from '../lib/formatName';
import { formatMoney as fmtMoney } from '../lib/formatMoney';
import { batchGetSyncStatuses, syncPayableBill } from '../../services/quickbooksService';
import { getSupabaseClient } from '../../services/supabase';
import type { QBSyncStatus, SupplierInvoice } from '../../types';

// ─── Due-date / Status helpers (parity with v1 FinancePayables) ──
const calcDueDate = (invoiceDate: string | null, paymentTerms: string | null): Date | null => {
  if (!invoiceDate) return null;
  const base = new Date(invoiceDate);
  if (isNaN(base.getTime())) return null;
  const days = paymentTerms ? parseInt((paymentTerms.match(/\d+/) || ['0'])[0], 10) : 0;
  if (days > 0) base.setDate(base.getDate() + days);
  return base;
};

type DueLabel = 'Overdue' | 'Due Soon' | 'On Track' | 'No Date';
const getDueStatus = (r: Payable): { label: DueLabel; priority: number } => {
  const due = calcDueDate(r.invoiceDate, r.paymentTerms);
  if (!due) return { label: 'No Date', priority: 3 };
  const diffDays = Math.ceil((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0)  return { label: 'Overdue',  priority: 1 };
  if (diffDays <= 7) return { label: 'Due Soon', priority: 2 };
  return { label: 'On Track', priority: 4 };
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
  onSendToQb: (row: Payable) => void,
): DataTableColumn<Payable>[] => [
  { id: 'inv', header: 'Invoice #', mono: true, sortable: true, filterable: true,
    value: r => r.invoiceNumber, cell: r => r.invoiceNumber },
  { id: 'supplier', header: 'Supplier', sortable: true, filterable: true,
    value: r => r.supplier ?? '',
    cell: r => <span className="text-slate-100" title={tooltipName(r.supplier)}>{shortName(r.supplier)}</span> },
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
            title={qbStatuses[r.id]?.qbEntityId ? `Bill #${qbStatuses[r.id].qbEntityId}` : 'Synced to QuickBooks'}
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
  { key: 'shipperName', label: 'Supplier', fullWidth: true,
    source: {
      table: 'suppliers', valueColumn: 'name', labelColumn: 'name',
      secondaryColumn: 'country', scopeByCompany: true,
    } },
  { key: 'invoiceDate',   label: 'Invoice date', type: 'date' },
  { key: 'paymentTerms', label: 'Payment terms',
    source: {
      table: 'payment_terms', valueColumn: 'description', labelColumn: 'description',
      secondaryColumn: 'code', scopeByCompany: true,
    } },
  { key: 'totalAmount',   label: 'Amount', type: 'number', mono: true, min: 0, step: 0.01 },
  { key: 'currency',      label: 'Currency', mono: true, defaultValue: 'USD' },
];

interface PayableDraft {
  invoiceNumber: string;
  shipperName: string;
  invoiceDate: string;
  paymentTerms: string;
  totalAmount: string;
  currency: string;
  notes: string;
}

const emptyPayableDraft = (): PayableDraft => ({
  invoiceNumber: '', shipperName: '', invoiceDate: '',
  paymentTerms: '', totalAmount: '', currency: 'USD', notes: '',
});

const PAYABLE_PROMPT = `You are extracting fields from a SUPPLIER INVOICE (an incoming bill
the buyer received and needs to pay). Return JSON with exactly these
keys; missing values must be null.

{
  "invoiceNumber":  string | null,
  "shipperName":    string | null,   // supplier legal name that issued the invoice
  "invoiceDate":    string | null,   // YYYY-MM-DD
  "paymentTerms":   string | null,   // e.g. "Net 30 Days"
  "totalAmount":    number | null,   // numeric, no currency symbol
  "currency":       string | null,   // ISO 4217
  "notes":          string | null
}

Return ONLY valid JSON — no markdown fences, no commentary.`;

function normalizePayableJson(parsed: Record<string, unknown>): PayableDraft {
  const str = (k: string): string => {
    const v = parsed[k];
    return typeof v === 'string' ? v.trim() : '';
  };
  const num = (k: string): string => {
    const v = parsed[k];
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'string') {
      const n = Number(v.replace(/[^0-9.\-]/g, ''));
      return Number.isFinite(n) && v.trim() !== '' ? String(n) : '';
    }
    return '';
  };
  return {
    invoiceNumber: str('invoiceNumber'),
    shipperName:   str('shipperName'),
    invoiceDate:   str('invoiceDate'),
    paymentTerms:  str('paymentTerms'),
    totalAmount:   num('totalAmount'),
    currency:      str('currency').toUpperCase() || 'USD',
    notes:         str('notes'),
  };
}

const PayablesV2: React.FC = () => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [aiUploadOpen, setAiUploadOpen] = useState(false);
  const pay = usePayables(search);
  const total = (pay.data ?? []).reduce((s, r) => s + r.totalAmount, 0);
  const insert = useEntityInsert<Record<string, unknown>>({
    table: 'invoices_suppliers',
    listQueryKeys: ['payables'],
    idPrefix: 'SINV',
  });

  // ─── QuickBooks sync state ────────────────────────────────────
  const [qbStatuses, setQbStatuses] = useState<Record<string, QBSyncStatus>>({});
  const [qbSyncingId, setQbSyncingId] = useState<string | null>(null);

  // Batch-load QB sync statuses once the list arrives. Mirrors
  // v1's qb_sync_log hydration — unsent rows show the Send button,
  // synced rows show the "Sent" pill on refresh.
  useEffect(() => {
    const ids = (pay.data ?? []).map(r => r.id);
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const map = await batchGetSyncStatuses(ids, 'invoices_suppliers');
        if (!cancelled) setQbStatuses(prev => ({ ...prev, ...map }));
      } catch (e) {
        console.warn('QB sync status fetch failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [pay.data]);

  const handleSendToQb = useCallback(async (row: Payable) => {
    if (qbSyncingId) return;
    setQbSyncingId(row.id);
    try {
      // syncPayableBill expects the fuller SupplierInvoice shape; our
      // Payable row carries the core fields and the edge function reads
      // what it needs. Cast is safe for the bill-sync path.
      const payload = {
        id: row.id,
        invoiceNumber: row.invoiceNumber,
        shipperName: row.supplier ?? '',
        invoiceDate: row.invoiceDate ?? '',
        paymentTerms: row.paymentTerms ?? '',
        totalAmount: row.totalAmount,
        currency: row.currency,
      } as unknown as SupplierInvoice;
      const result = await syncPayableBill(currentCompanyId || 'ALL', payload);
      setQbStatuses(prev => ({ ...prev, [row.id]: result }));
      try {
        const supabase = getSupabaseClient();
        await supabase.from('invoices_suppliers').update({ qb_status: 'Sent' }).eq('id', row.id);
      } catch (dbErr) {
        console.warn('qb_status update failed:', dbErr);
      }
      toast.push({
        kind: 'success',
        title: 'Sent to QuickBooks',
        description: result.qbEntityId ? `Bill #${result.qbEntityId}` : row.invoiceNumber,
      });
    } catch (err) {
      const msg = (err as Error).message;
      setQbStatuses(prev => ({ ...prev, [row.id]: { synced: false, error: msg } }));
      toast.push({ kind: 'error', title: 'QuickBooks sync failed', description: msg });
    } finally {
      setQbSyncingId(null);
    }
  }, [currentCompanyId, qbSyncingId, toast]);

  const columns = React.useMemo(
    () => buildColumns(qbStatuses, qbSyncingId, handleSendToQb),
    [qbStatuses, qbSyncingId, handleSendToQb],
  );

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
            ? `${pay.data.length} bills${total > 0 ? ` · ${fmtMoney(total)}` : ''}${search ? ` · "${search}"` : ''}`
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
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={openCreate}
              className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
              + New bill
            </Button>
            <Button size="sm" onClick={() => setAiUploadOpen(true)}
              className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/40 text-indigo-200 hover:from-indigo-500/30 hover:to-purple-500/30 h-7 px-2.5 text-[12px] font-medium rounded-md inline-flex items-center gap-1.5">
              <Sparkles size={12} />
              AI Upload
            </Button>
          </div>
        }
        emptyAction={search ? undefined : { label: '+ New bill', onClick: openCreate }}
        skeletonCols={[100, 200, 100, 80, 60, 80, 80]}
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
      {aiUploadOpen && (
        <AiUploadModal<PayableDraft>
          open={aiUploadOpen}
          onOpenChange={setAiUploadOpen}
          config={{
            title: 'AI upload — supplier bill',
            description: 'Drop a supplier invoice PDF, pick a file, or paste text or a screenshot.',
            emptyDraft: emptyPayableDraft,
            fromExtracted: (d) => d,
            extractSpec: { prompt: PAYABLE_PROMPT, normalize: normalizePayableJson },
            extractSummary: (d) =>
              [d.invoiceNumber, d.shipperName].filter(Boolean).join(' · '),
            validate: (d) => {
              if (!d.invoiceNumber.trim()) return 'Invoice # is required.';
              if (!d.shipperName.trim()) return 'Supplier is required.';
              return null;
            },
            renderReview: (d, setD) => (
              <div className="grid grid-cols-2 gap-3">
                <FormField>
                  <FieldLabel>Invoice # *</FieldLabel>
                  <Input value={d.invoiceNumber}
                    onChange={e => setD({ ...d, invoiceNumber: e.target.value })}
                    className={inputCls + ' font-mono'} />
                </FormField>
                <FormField>
                  <FieldLabel>Invoice date</FieldLabel>
                  <Input type="date" value={d.invoiceDate?.slice(0, 10) ?? ''}
                    onChange={e => setD({ ...d, invoiceDate: e.target.value })}
                    className={inputCls} />
                </FormField>
                <FormField className="col-span-2">
                  <FieldLabel>Supplier *</FieldLabel>
                  <SupabaseSelectField
                    source={{
                      table: 'suppliers', valueColumn: 'name', labelColumn: 'name',
                      secondaryColumn: 'country', scopeByCompany: true,
                    }}
                    value={d.shipperName}
                    onPick={v => setD({ ...d, shipperName: v })} />
                </FormField>
                <FormField>
                  <FieldLabel>Amount</FieldLabel>
                  <Input type="number" value={d.totalAmount}
                    onChange={e => setD({ ...d, totalAmount: e.target.value })}
                    className={inputCls + ' font-mono tabular-nums'} />
                </FormField>
                <FormField>
                  <FieldLabel>Currency</FieldLabel>
                  <Input value={d.currency}
                    onChange={e => setD({ ...d, currency: e.target.value.toUpperCase() })}
                    className={inputCls + ' font-mono'} />
                </FormField>
                <FormField className="col-span-2">
                  <FieldLabel>Payment terms</FieldLabel>
                  <SupabaseSelectField
                    source={{
                      table: 'payment_terms', valueColumn: 'description', labelColumn: 'description',
                      secondaryColumn: 'code', scopeByCompany: true,
                    }}
                    value={d.paymentTerms}
                    onPick={v => setD({ ...d, paymentTerms: v })} />
                </FormField>
                <FormField className="col-span-2">
                  <FieldLabel>Notes</FieldLabel>
                  <textarea value={d.notes}
                    onChange={e => setD({ ...d, notes: e.target.value })}
                    rows={2}
                    className="w-full bg-[#111111] border border-[#1f1f1f] rounded-md px-2 py-1.5 text-[12.5px] text-slate-200 resize-y" />
                </FormField>
              </div>
            ),
            save: async (d) => {
              const payload: Record<string, unknown> = {
                invoiceNumber: d.invoiceNumber.trim(),
                shipperName:   d.shipperName.trim(),
                invoiceDate:   d.invoiceDate || null,
                paymentTerms:  d.paymentTerms || null,
                totalAmount:   d.totalAmount.trim() === '' ? null : Number(d.totalAmount),
                currency:      d.currency || 'USD',
                notes:         d.notes || null,
              };
              if (currentCompanyId && currentCompanyId !== 'ALL') {
                payload.companyId = currentCompanyId;
              }
              await insert.mutateAsync(payload);
              toast.push({
                kind: 'success',
                title: 'Supplier bill saved',
                description: `${d.invoiceNumber} · ${d.shipperName}`,
              });
            },
          }}
        />
      )}
    </>
  );
};

const inputCls = 'h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200';

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
    {children}
  </Label>
);

export default PayablesV2;
