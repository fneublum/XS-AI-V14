// Phase 3B — v2 Payables.

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Clock, Loader2, Send, Sparkles, Receipt } from 'lucide-react';
import { Button, Input, FormField, Label } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { AiUploadModal } from '../components/AiUploadModal';
import { SupabaseSelectField } from '../components/SupabaseSelectField';
import { useRowCrud } from '../components/useRowCrud';
import { useApSupplierBalances } from '../queries/useTransactions';
import { RecordPaymentDrawer, type PrefillSupplierInvoice } from '../components/RecordPaymentDrawer';
import { InvoiceStatementModal } from '../components/InvoiceStatementModal';
import { InvoiceTransactionsEditModal } from '../components/InvoiceTransactionsEditModal';
import { Wallet, CheckCircle as CheckCircleIcon, Eye } from 'lucide-react';
import { PdfViewerModal } from '../components/PdfViewerModal';
import { useEntityInsert } from '../queries/useEntityMutations';
import { useCompany } from '../providers/CompanyProvider';
import { useToast } from '../primitives/Toast';
import { usePayables, Payable } from '../queries/usePayables';
import ExpensesV2 from './ExpensesV2';
import { formatDate as fmtDate } from '../lib/formatDate';
import { shortName, tooltipName } from '../lib/formatName';
import { formatMoney as fmtMoney } from '../lib/formatMoney';
import { batchGetSyncStatuses, syncPayableBill } from '../../services/quickbooksService';
import { getSupabaseClient } from '../../services/supabase';
import type { QBSyncStatus, SupplierInvoice } from '../../types';

// Slim tab pill — local to PayablesV2 so the tab swap between Bills
// and Expenses stays self-contained. Styled to match the rest of v2
// (dark surface, indigo active state). The shared `BentoModePill` in
// DashboardV2 is too opinionated visually (icon-led, chip-shaped) for
// this top-of-page context.
const TabPill: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={
      'px-3 py-1 rounded-md text-[12px] font-medium border transition-colors ' +
      (active
        ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-200'
        : 'bg-transparent border-[#1f1f1f] text-slate-400 hover:text-slate-200 hover:bg-[#161616]')
    }
  >
    {children}
  </button>
);

// ─── Due-date / Status helpers (parity with v1 FinancePayables) ──
// Shared term parser lives in v2/lib/paymentTerms.ts so Receivables
// and Cash Flow apply the same rules — old in-line regex grabbed the
// first number, treating "30% Advance" as 30 days.
import { calcDueDate } from '../lib/paymentTerms';

// Status pill — derived in this order of precedence:
//   1. Balance hits 0 → PAID (always wins; the AP ledger is the source
//      of truth for what's settled). This fixes the long-standing
//      drift where the stored `status` column said 'OVERDUE' but
//      payments had since been applied.
//   2. Stored `status` value (admin-set via the drawer) if it's an
//      explicit UNPAID / PAID / OVERDUE.
//   3. Date-derived label from invoiceDate + paymentTerms otherwise.
type StatusLabel = 'UNPAID' | 'PAID' | 'OVERDUE' | 'Due Soon' | 'On Track' | 'No Date';

const statusPriority: Record<StatusLabel, number> = {
  'OVERDUE':  1,
  'UNPAID':   2,
  'Due Soon': 3,
  'No Date':  4,
  'On Track': 5,
  'PAID':     6,
};

const resolveStatus = (r: Payable, balance?: number): StatusLabel => {
  // Balance trumps stored status. If the AP ledger says nothing is
  // owed, the row is PAID regardless of what `status` was set to at
  // creation time. 0.001 epsilon to avoid float-rounding false-PARTIALs.
  const bal = balance ?? r.totalAmount;
  if (bal <= 0.001) return 'PAID';

  const stored = (r.status ?? '').trim().toUpperCase();
  if (stored === 'PAID')    return 'PAID';
  if (stored === 'OVERDUE') return 'OVERDUE';
  if (stored === 'UNPAID')  return 'UNPAID';
  // No stored status — derive from invoiceDate + paymentTerms.
  const due = calcDueDate(r.invoiceDate, r.paymentTerms);
  if (!due) return 'No Date';
  const diffDays = Math.ceil((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0)  return 'OVERDUE';
  if (diffDays <= 7) return 'Due Soon';
  return 'On Track';
};

const StatusPill: React.FC<{ label: StatusLabel }> = ({ label }) => {
  const map: Record<StatusLabel, { cls: string; icon: React.ReactNode }> = {
    'OVERDUE':  { cls: 'bg-rose-500/10 text-rose-300 border-rose-500/20',     icon: <AlertCircle size={10} /> },
    'UNPAID':   { cls: 'bg-amber-500/10 text-amber-300 border-amber-500/20',   icon: <Clock size={10} /> },
    'PAID':     { cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20', icon: <CheckCircle size={10} /> },
    'Due Soon': { cls: 'bg-amber-500/10 text-amber-300 border-amber-500/20',   icon: <Clock size={10} /> },
    'On Track': { cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20', icon: <CheckCircle size={10} /> },
    'No Date':  { cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20',   icon: null },
  };
  const { cls, icon } = map[label];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-semibold border ${cls}`}>
      {icon}{label}
    </span>
  );
};

interface PayableBalanceMap {
  [supplierInvoiceId: string]: { paid: number; balance: number };
}

const buildColumns = (
  qbStatuses: Record<string, QBSyncStatus>,
  qbSyncingId: string | null,
  onSendToQb: (row: Payable) => void,
  balances: PayableBalanceMap,
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
  { id: 'paid', header: 'Paid', align: 'right', mono: true, sortable: true,
    value: r => balances[r.id]?.paid ?? 0,
    cell: r => {
      const b = balances[r.id];
      if (!b || b.paid <= 0) return <span className="text-slate-700">—</span>;
      return <span className="text-emerald-300 tabular-nums">{fmtMoney(b.paid, r.currency)}</span>;
    } },
  { id: 'balance', header: 'Balance', align: 'right', mono: true, sortable: true,
    value: r => balances[r.id]?.balance ?? r.totalAmount,
    cell: r => {
      const b = balances[r.id];
      const bal = b ? b.balance : r.totalAmount;
      if (bal <= 0.001) {
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
            <CheckCircleIcon size={10} /> PAID
          </span>
        );
      }
      const cls = b && b.paid > 0 ? 'text-amber-300' : 'text-slate-200';
      return <span className={`tabular-nums ${cls}`}>{fmtMoney(bal, r.currency)}</span>;
    } },
  { id: 'date', header: 'Issued', align: 'right', sortable: true,
    value: r => r.invoiceDate ?? '',
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.invoiceDate)}
      </span>
    ) },
  { id: 'status', header: 'Status', sortable: true, filterable: true,
    value: r => resolveStatus(r, balances[r.id]?.balance),
    cell: r => <StatusPill label={resolveStatus(r, balances[r.id]?.balance)} /> },
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

// Full editable column set for the `invoices_suppliers` row. Mirrors
// the columns selected by usePayables — keep these in sync so the
// drawer can both read and write every meaningful field. `items`,
// `originalDocument`, `qb_status`, `createdAt`, `companyId` are managed
// elsewhere (AI Upload / QB Sync / system) and intentionally omitted.
const fields: FieldDef[] = [
  // ── Payment status — top of the drawer ───────────────────────
  // Rendered as a row of chip buttons (select type) at the top of the
  // form. Three canonical states: UNPAID (new bill, not yet settled),
  // PAID (settled), OVERDUE (admin-flagged past-due). Default for new
  // rows is UNPAID. The list Status column mirrors this value.
  { key: 'status', label: 'Payment status', type: 'select',
    fullWidth: true, defaultValue: 'UNPAID',
    options: [
      { value: 'UNPAID',  label: 'UNPAID'  },
      { value: 'PAID',    label: 'PAID'    },
      { value: 'OVERDUE', label: 'OVERDUE' },
    ] },
  // ── Header ────────────────────────────────────────────────────
  { key: 'invoiceNumber',  label: 'Invoice #', required: true, mono: true },
  { key: 'shipperName', label: 'Supplier', fullWidth: true,
    source: {
      table: 'suppliers', valueColumn: 'name', labelColumn: 'name',
      secondaryColumn: 'country', scopeByCompany: true,
    } },
  { key: 'shipperAddress', label: 'Supplier address', fullWidth: true },
  { key: 'invoiceDate',    label: 'Invoice date', type: 'date' },
  { key: 'dateOrder',      label: 'Order date',   type: 'date' },
  { key: 'paymentTerms',   label: 'Payment terms',
    source: {
      table: 'payment_terms', valueColumn: 'description', labelColumn: 'description',
      secondaryColumn: 'code', scopeByCompany: true,
    } },
  // ── Parties / Routing ────────────────────────────────────────
  { key: 'soldTo',         label: 'Sold to' },
  { key: 'shipTo',         label: 'Ship to' },
  { key: 'incoterms',      label: 'Incoterm', mono: true },
  { key: 'freightTerms',   label: 'Freight terms' },
  { key: 'carrier',        label: 'Carrier' },
  { key: 'transportRef',   label: 'Transport ref', mono: true },
  // Linked PO — when set, a DB trigger auto-flips the linked
  // purchase_orders.status to COMPLETED so the PO falls out of the
  // Cash Flow pipeline (we'd otherwise double-count once as
  // "Purchase orders out" and again as "Invoices out"). Dropdown is
  // backed by the purchase_orders table; allowFreeText keeps legacy
  // freeform references working.
  { key: 'customerPo', label: 'Linked PO (auto-completes the PO)', mono: true,
    source: {
      table: 'purchase_orders', valueColumn: 'id', labelColumn: 'id',
      secondaryColumn: 'supplierName', scopeByCompany: true,
    },
    allowFreeText: true,
  },
  // ── Quantities / Weights ─────────────────────────────────────
  { key: 'totalQuantity',  label: 'Total quantity', mono: true },
  { key: 'grossWeight',    label: 'Gross weight (kg)', mono: true },
  { key: 'netWeight',      label: 'Net weight (kg)',   mono: true },
  { key: 'tareWeight',     label: 'Tare weight (kg)',  mono: true },
  // ── Money ────────────────────────────────────────────────────
  { key: 'subtotal',       label: 'Subtotal',   type: 'number', mono: true, min: 0, step: 0.01 },
  { key: 'totalAmount',    label: 'Amount',     type: 'number', mono: true, min: 0, step: 0.01, required: true },
  { key: 'currency',       label: 'Currency',   mono: true, defaultValue: 'USD' },
  // ── Banking (Remit to) ───────────────────────────────────────
  { key: 'remitTo',        label: 'Remit to',        fullWidth: true },
  { key: 'bankName',       label: 'Bank name' },
  { key: 'swiftCode',      label: 'SWIFT',           mono: true },
  { key: 'routingNumber',  label: 'Routing #',       mono: true },
  { key: 'accountNumber',  label: 'Account #',       mono: true },
  // ── Notes ─────────────────────────────────────────────────────
  // Column added via 20260527190000 migration; surface here so edits
  // round-trip and the QuickCreate notes stay visible after save.
  { key: 'notes',          label: 'Notes', type: 'textarea', fullWidth: true },
];

// Per 2026-05-27 spec: supplier invoice OCR must capture the goods
// subtotal, freight charges, AND any payments already reported on
// the invoice itself (advance, partial). Each payment becomes an
// auto-created PAYMENT_OUT transaction allocated to the supplier
// invoice on save.
interface PaymentOnInvoice {
  date: string;       // YYYY-MM-DD
  amount: string;     // string while editing
  method: string;     // WIRE / ACH / CHECK / CARD / CASH / OTHER
  reference: string;  // bank ref / check #
  memo: string;
}

interface PayableDraft {
  invoiceNumber: string;
  shipperName: string;
  invoiceDate: string;
  paymentTerms: string;
  goodsAmount: string;     // subtotal (goods only)
  freightAmount: string;   // freight charges line, if present
  totalAmount: string;     // grand total of the bill
  currency: string;
  notes: string;
  paymentsOnInvoice: PaymentOnInvoice[];
  /** Data URL of the OCR-source PDF/image. Persisted to
   *  invoices_suppliers.originalDocument so the user can re-open
   *  the source document later from the Payables row. Carried
   *  through fromExtracted → save (AiUploadModal passes the URL
   *  as the 2nd arg to fromExtracted). */
  originalDocument: string | null;
}

const emptyPayableDraft = (): PayableDraft => ({
  invoiceNumber: '', shipperName: '', invoiceDate: '',
  paymentTerms: '', goodsAmount: '', freightAmount: '', totalAmount: '',
  currency: 'USD', notes: '', paymentsOnInvoice: [],
  originalDocument: null,
});

const PAYABLE_PROMPT = `You are extracting fields from a SUPPLIER INVOICE (an incoming bill
the buyer received and needs to pay). Return JSON with exactly these
keys; missing values must be null. Numbers must be plain decimals
(no currency symbol, no thousands separators).

{
  "invoiceNumber":  string | null,
  "shipperName":    string | null,   // supplier legal name that issued the invoice
  "invoiceDate":    string | null,   // YYYY-MM-DD
  "paymentTerms":   string | null,   // e.g. "Net 30 Days"
  "goodsAmount":    number | null,   // subtotal for goods/products only (no freight, no taxes)
  "freightAmount":  number | null,   // freight charges line on the invoice, if present (null when goods-only)
  "totalAmount":    number | null,   // grand total of the bill (goods + freight + any other charges)
  "currency":       string | null,   // ISO 4217
  "notes":          string | null,
  // Any payments already reported on the invoice itself — advance
  // payments, partial payments, deposits, prepayments. NOT future
  // payment terms. Each entry describes ONE prior payment receipt.
  // Empty array when the invoice is "amount due in full".
  "paymentsOnInvoice": [
    {
      "date":      string | null,   // YYYY-MM-DD when the payment occurred
      "amount":    number | null,   // positive, USD-equivalent in the invoice's currency
      "method":    string | null,   // WIRE | ACH | CHECK | CARD | CASH | OTHER
      "reference": string | null,   // wire ref / check # / contract # / etc.
      "memo":      string | null    // short description e.g. "30% advance per PO terms"
    }
  ]
}

Rules:
- Brazilian "1.399.775,00" → 1399775.00 (dot=thousands, comma=decimal).
- Dates "21/05/2026" → "2026-05-21" (DD/MM/YYYY assumed for non-US sources).
- method must be normalised to one of the six enum values; default OTHER
  when unclear.
- Only put REAL prior payments in paymentsOnInvoice. "Net 30" or
  payment-terms text belongs in paymentTerms, not paymentsOnInvoice.

Return ONLY valid JSON — no markdown fences, no commentary.`;

function normalizePayableJson(parsed: Record<string, unknown>): PayableDraft {
  const str = (k: string, src: Record<string, unknown> = parsed): string => {
    const v = src[k];
    return typeof v === 'string' ? v.trim() : '';
  };
  const num = (k: string, src: Record<string, unknown> = parsed): string => {
    const v = src[k];
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'string') {
      const n = Number(v.replace(/[^0-9.\-]/g, ''));
      return Number.isFinite(n) && v.trim() !== '' ? String(n) : '';
    }
    return '';
  };
  const allowedMethods = new Set(['WIRE', 'ACH', 'CHECK', 'CARD', 'CASH', 'OTHER']);
  const paymentsRaw = Array.isArray(parsed['paymentsOnInvoice']) ? parsed['paymentsOnInvoice'] as Record<string, unknown>[] : [];
  const paymentsOnInvoice: PaymentOnInvoice[] = paymentsRaw
    .map(p => {
      const m = (str('method', p) || '').toUpperCase();
      return {
        date: str('date', p),
        amount: num('amount', p),
        method: allowedMethods.has(m) ? m : 'OTHER',
        reference: str('reference', p),
        memo: str('memo', p),
      };
    })
    .filter(p => Number(p.amount) > 0);    // drop empty/zero rows

  return {
    invoiceNumber: str('invoiceNumber'),
    shipperName:   str('shipperName'),
    invoiceDate:   str('invoiceDate'),
    paymentTerms:  str('paymentTerms'),
    goodsAmount:   num('goodsAmount'),
    freightAmount: num('freightAmount'),
    totalAmount:   num('totalAmount'),
    currency:      str('currency').toUpperCase() || 'USD',
    notes:         str('notes'),
    paymentsOnInvoice,
  };
}

const PayablesV2: React.FC = () => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [aiUploadOpen, setAiUploadOpen] = useState(false);
  // 'bills' = the existing supplier-invoice list (invoices_suppliers).
  // 'expenses' = the new general-expenses surface (public.expenses).
  // Default to 'bills' so the long-standing view doesn't change for
  // returning users; the new tab is opt-in.
  const [tab, setTab] = useState<'bills' | 'expenses'>('bills');
  const pay = usePayables(search);
  // Headline total — computed below once balances are in scope.
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

  // AP balances: paid/outstanding per supplier invoice from the ledger.
  const ap = useApSupplierBalances();
  const balances = React.useMemo(() => {
    const m: Record<string, { paid: number; balance: number }> = {};
    for (const b of ap.data ?? []) m[b.supplierInvoiceId] = { paid: b.paid, balance: b.balance };
    return m;
  }, [ap.data]);
  // Balance-aware headline total. Falls back to gross totalAmount per row
  // until the ap_supplier_invoice_balances view returns.
  const total = React.useMemo(
    () => (pay.data ?? []).reduce((s, r) => s + (balances[r.id]?.balance ?? r.totalAmount), 0),
    [pay.data, balances],
  );

  const columns = React.useMemo(
    () => buildColumns(qbStatuses, qbSyncingId, handleSendToQb, balances),
    [qbStatuses, qbSyncingId, handleSendToQb, balances],
  );

  // Record-payment drawer state — opened from per-row "Pay" action.
  const [paySupplierInvoice, setPaySupplierInvoice] = useState<PrefillSupplierInvoice | null>(null);
  // Header-level "OCR Receipt" shortcut + the prefill it produced were
  // removed 2026-05-28. The per-row Pay button (setPaySupplierInvoice)
  // still opens RecordPaymentDrawer with full OCR-receipt support, so
  // no functionality is lost — just a redundant header entry point.

  // View action → statement modal (mirror Receivables — invoice
  // total · payments · balance in a T-account). Edit action → the
  // transactions editor for any AP payments allocated to this bill.
  // "Original" action → opens the OCR-source PDF/image in the
  // existing PdfViewerModal (when the bill was created via AI
  // Upload and originalDocument was persisted).
  const [statementRow, setStatementRow] = useState<Payable | null>(null);
  const [editTxnsRow,  setEditTxnsRow]  = useState<Payable | null>(null);
  const [viewOriginalRow, setViewOriginalRow] = useState<Payable | null>(null);

  const { rowActions: crudActions, drawers, openView } = useRowCrud<Payable>({
    table: 'invoices_suppliers',
    listQueryKeys: ['payables'],
    rowLabel: r => r.invoiceNumber,
    fields,
    // View on Payables opens InvoiceStatementModal as a read-only
    // T-account (total / paid / balance + payment history). No edit
    // affordances inside.
    onView: (row) => setStatementRow(row),
    // Edit on Payables uses the default InspectDrawer (full record
    // fields editor). The extraEditSection below adds an "Edit
    // payments" drill-in so a single Edit click covers BOTH the
    // record fields AND the payments allocated to the bill — one
    // icon for everything editable on this row.
    viewIcon: <Receipt size={14} />,
    viewTitleByRow: () => 'View statement',
    extraEditSection: (row) => (
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">
            Payments
          </div>
          <div className="text-[11.5px] text-slate-400 mt-0.5">
            Edit or delete individual payments allocated to this invoice.
          </div>
        </div>
        <Button
          size="sm" variant="secondary"
          onClick={() => setEditTxnsRow(row)}
          className="bg-transparent border border-[#1f1f1f] text-indigo-300 hover:bg-indigo-500/10 hover:text-indigo-200"
        >
          Edit payments →
        </Button>
      </div>
    ),
  });

  // Compose: prepend a Pay button on unpaid rows, then existing actions.
  const rowActions = React.useCallback((r: Payable) => {
    const b = balances[r.id];
    const bal = b ? b.balance : r.totalAmount;
    const paid = bal <= 0.001;
    return (
      <div className="flex items-center gap-1 justify-end">
        {/* Pay button — first in the row so it's the most prominent
            action. Always visible (incl. fully-paid rows) so the user
            can record corrections, overpayments, or replace a
            wrongly-allocated payment without having to back the
            invoice out of PAID status first. Muted styling when there's
            no outstanding balance so it doesn't compete with the green
            Pay-due chip on unpaid rows. */}
        <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPaySupplierInvoice({
                supplierInvoiceId: r.id,
                invoiceNumber: r.invoiceNumber,
                supplierName: r.supplier ?? null,
                outstanding: bal,
                // True totals so the drawer's Statement view doesn't
                // under-count when QB / legacy payments aren't in the
                // transactions table.
                totalAmount: r.totalAmount,
                paid: b ? b.paid : (r.totalAmount - bal),
                currency: r.currency,
              });
            }}
            title={paid ? 'Record an additional/correcting payment' : 'Record supplier payment'}
            className={
              'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-semibold border transition-colors ' +
              (paid
                ? 'bg-slate-500/5 text-slate-400 border-slate-500/20 hover:bg-slate-500/10 hover:text-slate-200'
                : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20 hover:bg-emerald-500/20')
            }
          >
            <Wallet size={10} /> Pay
          </button>
        {/* Document — sits right of Pay. When the bill has a stored
            OCR-source PDF/image (originalDocument set on AI Upload),
            the modal renders the PDF inline. When the bill was
            created manually (or pre-dates the column), the modal
            shows an empty state with a file picker so the user can
            attach the original document retroactively; the picked
            file's data URL is written back to the row. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setViewOriginalRow(r);
          }}
          title={r.originalDocument
            ? "Invoice file on record — click to view"
            : "No invoice file on record — click to attach one"}
          // Icon-only eye, tinted by document-presence: green when the
          // original invoice PDF is on record, red when missing so the
          // user can see at a glance which rows still need a source
          // document uploaded.
          className={
            'p-1 rounded-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed outline-none focus-visible:ring-1 ' +
            (r.originalDocument
              ? 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 focus-visible:ring-emerald-500'
              : 'text-red-400 hover:text-red-300 hover:bg-red-500/10 focus-visible:ring-red-500')
          }
        >
          <Eye size={14} />
        </button>
        {crudActions(r)}
      </div>
    );
  }, [balances, crudActions]);

  const openCreate = () => setCreateOpen(true);

  // Render-time short-circuit: when the user picks "Expenses", swap the
  // entire Payables surface for ExpensesV2. Keeping it as a separate
  // component (rather than an inline conditional block) means the
  // existing bills wiring — useRowCrud drawers, QB sync state, AP
  // balances, OCR modals — doesn't have to dodge undefined when on
  // the expenses tab. The two tabs share no state.
  // Tab pills — sit on the right side of the header *next to* the
  // action buttons (+ New bill, AI Upload, OCR Receipt) rather than in
  // `titleAdornment` next to the title. Earlier placement put them on a
  // separate visual row above the buttons on narrow widths; folding
  // them into the same `headerAction` flex container keeps everything
  // vertically aligned regardless of viewport width.
  const renderTabPills = (activeTab: 'bills' | 'expenses') => (
    <>
      <TabPill active={activeTab === 'bills'}    onClick={() => setTab('bills')}>Supplier Invoices</TabPill>
      <TabPill active={activeTab === 'expenses'} onClick={() => setTab('expenses')}>Expenses</TabPill>
    </>
  );

  if (tab === 'expenses') {
    return <ExpensesV2 tabPills={renderTabPills('expenses')} />;
  }

  return (
    <>
      <ListPage<Payable>
        title="Payables"
        subtitle={
          pay.data
            ? `${pay.data.length} invoices${total > 0 ? ` · ${fmtMoney(total)}` : ''}${search ? ` · "${search}"` : ''}`
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
            {/* Tab pills first so they sit immediately left of the action
                buttons, all on the same vertical baseline. */}
            {renderTabPills('bills')}
            <span className="w-px h-5 mx-1" style={{ background: 'var(--b-line)' }} />
            <Button size="sm" onClick={openCreate}
              className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
              + New invoice
            </Button>
            <Button size="sm" onClick={() => setAiUploadOpen(true)}
              className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/40 text-indigo-200 hover:from-indigo-500/30 hover:to-purple-500/30 h-7 px-2.5 text-[12px] font-medium rounded-md inline-flex items-center gap-1.5">
              <Sparkles size={12} />
              AI Upload Invoice
            </Button>
          </div>
        }
        emptyAction={search ? undefined : { label: '+ New invoice', onClick: openCreate }}
        skeletonCols={[100, 200, 100, 80, 60, 80, 80]}
      />
      <QuickCreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New supplier invoice"
        description="Log an incoming supplier invoice (payable)."
        table="invoices_suppliers"
        idPrefix="SINV"
        listQueryKeys={['payables']}
        scopeByCompany
        fields={fields}
      />
      {drawers}
      <RecordPaymentDrawer
        open={!!paySupplierInvoice}
        onOpenChange={(v) => { if (!v) setPaySupplierInvoice(null); }}
        mode="payment"
        supplierInvoice={paySupplierInvoice ?? undefined}
        onSuccess={() => { ap.refetch(); pay.refetch(); }}
      />
      {/* View modal — supplier-bill statement (T-account: invoice
          total · prior payments · balance). Reads the AP-view's
          authoritative totals so figures match the row in the list
          exactly. `onViewOriginal` opens the OCR-source PDF when
          the bill was created via AI Upload. */}
      {statementRow && (() => {
        const b = balances[statementRow.id];
        const paid = b ? b.paid : Math.max(0, statementRow.totalAmount - (b?.balance ?? statementRow.totalAmount));
        return (
          <InvoiceStatementModal
            open={true}
            onOpenChange={(v) => { if (!v) setStatementRow(null); }}
            supplierInvoiceId={statementRow.id}
            documentLabel={statementRow.invoiceNumber}
            counterpartyName={statementRow.supplier}
            invoiceTotal={statementRow.totalAmount}
            paid={paid}
            currency={statementRow.currency}
            onViewOriginal={statementRow.originalDocument
              ? () => setViewOriginalRow(statementRow)
              : undefined}
            // Statement is read-only — the pencil row action now opens
            // InvoiceTransactionsEditModal directly, so no need to
            // surface that path from inside the Statement header.
          />
        );
      })()}

      {/* Edit modal — AP payments allocated to this bill. */}
      {editTxnsRow && (
        <InvoiceTransactionsEditModal
          open={true}
          onOpenChange={(v) => { if (!v) setEditTxnsRow(null); }}
          supplierInvoiceId={editTxnsRow.id}
          documentLabel={editTxnsRow.invoiceNumber}
          counterpartyName={editTxnsRow.supplier}
          currency={editTxnsRow.currency}
        />
      )}

      {/* OCR-source PDF viewer — opens the original supplier
          invoice document the AI Upload captured. PdfViewerModal
          handles data-URL → Blob conversion + iframe rendering,
          plus a Download button. When the bill has no stored
          document yet, the modal's empty-state file picker fires
          onUpload — we persist the data URL back to the row so
          subsequent clicks show the file inline. */}
      <PdfViewerModal
        open={!!viewOriginalRow}
        onOpenChange={(v) => { if (!v) setViewOriginalRow(null); }}
        dataUrl={viewOriginalRow?.originalDocument ?? null}
        title={viewOriginalRow ? `Supplier invoice · ${viewOriginalRow.invoiceNumber}` : ''}
        onUpload={async (dataUrl) => {
          if (!viewOriginalRow) return;
          const sb = getSupabaseClient();
          const { error } = await sb
            .from('invoices_suppliers')
            .update({ originalDocument: dataUrl })
            .eq('id', viewOriginalRow.id);
          if (error) {
            toast.push({ kind: 'error', title: 'Upload failed', description: error.message });
            return;
          }
          toast.push({ kind: 'success', title: 'Document attached' });
          // Update the local copy so the same modal can render the
          // newly-uploaded file without reopening, and refetch the
          // list so the row's Document chip flips style.
          setViewOriginalRow({ ...viewOriginalRow, originalDocument: dataUrl });
          pay.refetch();
        }}
      />

      {aiUploadOpen && (
        <AiUploadModal<PayableDraft>
          open={aiUploadOpen}
          onOpenChange={setAiUploadOpen}
          config={{
            title: 'AI upload — supplier invoice',
            description: 'Drop a supplier invoice PDF, pick a file, or paste text or a screenshot.',
            emptyDraft: emptyPayableDraft,
            // Stash the OCR-source data URL on the draft so save()
            // can persist it. AiUploadModal passes it as the 2nd
            // arg whenever the extract was driven by a file (drag-
            // drop or picker); text-paste paths get null.
            fromExtracted: (d, originalDocument) => ({ ...d, originalDocument: originalDocument ?? d.originalDocument ?? null }),
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
                  <FieldLabel>Goods amount</FieldLabel>
                  <Input type="number" step="0.01" value={d.goodsAmount}
                    onChange={e => setD({ ...d, goodsAmount: e.target.value })}
                    placeholder="subtotal of products"
                    className={inputCls + ' font-mono tabular-nums'} />
                </FormField>
                <FormField>
                  <FieldLabel>Freight amount</FieldLabel>
                  <Input type="number" step="0.01" value={d.freightAmount}
                    onChange={e => setD({ ...d, freightAmount: e.target.value })}
                    placeholder="freight line, if present"
                    className={inputCls + ' font-mono tabular-nums'} />
                </FormField>
                <FormField>
                  <FieldLabel>Total amount</FieldLabel>
                  <Input type="number" step="0.01" value={d.totalAmount}
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

                {/* Payments-on-invoice editor — OCR-extracted prior
                    payments (advances, deposits) that this supplier
                    invoice reports. Each row becomes a PAYMENT_OUT
                    transaction (source=OCR) allocated to the bill
                    after save. User can add/remove/edit before
                    confirming the save. */}
                <FormField className="col-span-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <FieldLabel>Payments reported on invoice ({d.paymentsOnInvoice.length})</FieldLabel>
                    <button
                      type="button"
                      onClick={() => setD({ ...d, paymentsOnInvoice: [...d.paymentsOnInvoice, { date: '', amount: '', method: 'WIRE', reference: '', memo: '' }] })}
                      className="text-[11px] text-emerald-300 hover:text-emerald-200"
                    >
                      + Add payment row
                    </button>
                  </div>
                  {d.paymentsOnInvoice.length === 0 ? (
                    <div className="text-[11.5px] text-slate-500 italic px-2 py-2 rounded border border-dashed border-[#1f1f1f] bg-[#0a0a0a]">
                      No prior payments OCR'd on this invoice. Add one manually if needed; otherwise the bill saves with full balance due.
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {d.paymentsOnInvoice.map((p, i) => (
                        <div key={i} className="grid gap-1 items-center" style={{ gridTemplateColumns: '100px 100px 80px 1fr 28px' }}>
                          <Input type="date" value={p.date}
                            onChange={e => { const next = [...d.paymentsOnInvoice]; next[i] = { ...p, date: e.target.value }; setD({ ...d, paymentsOnInvoice: next }); }}
                            className={inputCls + ' text-[11.5px]'} />
                          <Input type="number" step="0.01" value={p.amount} placeholder="amount"
                            onChange={e => { const next = [...d.paymentsOnInvoice]; next[i] = { ...p, amount: e.target.value }; setD({ ...d, paymentsOnInvoice: next }); }}
                            className={inputCls + ' text-[11.5px] font-mono tabular-nums text-right'} />
                          <select value={p.method}
                            onChange={e => { const next = [...d.paymentsOnInvoice]; next[i] = { ...p, method: e.target.value }; setD({ ...d, paymentsOnInvoice: next }); }}
                            className="bg-[#111111] border border-[#1f1f1f] rounded text-[11.5px] text-slate-200 px-1.5 py-1.5">
                            {['WIRE','ACH','CHECK','CARD','CASH','OTHER'].map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                          <Input value={p.reference} placeholder="reference (wire/check #)"
                            onChange={e => { const next = [...d.paymentsOnInvoice]; next[i] = { ...p, reference: e.target.value }; setD({ ...d, paymentsOnInvoice: next }); }}
                            className={inputCls + ' text-[11.5px]'} />
                          <button type="button"
                            onClick={() => setD({ ...d, paymentsOnInvoice: d.paymentsOnInvoice.filter((_, idx) => idx !== i) })}
                            className="text-slate-500 hover:text-red-400 text-[14px] leading-none">×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </FormField>
              </div>
            ),
            save: async (d) => {
              const goods   = d.goodsAmount.trim()   === '' ? null : Number(d.goodsAmount);
              const freight = d.freightAmount.trim() === '' ? null : Number(d.freightAmount);
              const total   = d.totalAmount.trim()   === '' ? null : Number(d.totalAmount);
              const payload: Record<string, unknown> = {
                invoiceNumber: d.invoiceNumber.trim(),
                shipperName:   d.shipperName.trim(),
                invoiceDate:   d.invoiceDate || null,
                paymentTerms:  d.paymentTerms || null,
                subtotal:      goods,
                freightAmount: freight,
                totalAmount:   total,
                currency:      d.currency || 'USD',
                notes:         d.notes || null,
                // Persist the OCR'd source document so the user can
                // re-open the original PDF/image from the Payables
                // row action later.
                originalDocument: d.originalDocument || null,
              };
              if (currentCompanyId && currentCompanyId !== 'ALL') {
                payload.companyId = currentCompanyId;
              }
              // useEntityInsert returns the generated id string
              // directly (not a row object).
              const supplierInvoiceId = await insert.mutateAsync(payload);

              // Auto-create PAYMENT_OUT transactions for any payments
              // the OCR found (or the user added) on the bill itself.
              // Each links back via transaction_allocations.supplierInvoiceId
              // so the AP balance view + drawer Statement reflect them
              // immediately. Best-effort: a failure here doesn't roll
              // back the supplier-invoice save — surfaced as a warning
              // toast so the user can re-record manually.
              const validPayments = d.paymentsOnInvoice.filter(p => Number(p.amount) > 0);
              if (supplierInvoiceId && validPayments.length > 0 && currentCompanyId && currentCompanyId !== 'ALL') {
                try {
                  const { getSupabaseClient: getSb } = await import('../../services/supabase');
                  const sb = getSb();
                  const today = new Date().toISOString().slice(0, 10);
                  for (const p of validPayments) {
                    const txnId = `TXN-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
                    const { error: txnErr } = await sb.from('transactions').insert({
                      id: txnId,
                      companyId: currentCompanyId,
                      source: 'OCR',
                      kind: 'PAYMENT_OUT',
                      txnDate: p.date || today,
                      amount: Number(p.amount),
                      currency: d.currency || 'USD',
                      method: p.method || null,
                      counterpartyType: 'SUPPLIER',
                      counterpartyName: d.shipperName.trim(),
                      reference: p.reference || null,
                      memo: p.memo || 'Payment reported on supplier invoice',
                      status: 'MATCHED',
                    });
                    if (txnErr) throw new Error(txnErr.message);
                    const { error: allocErr } = await sb.from('transaction_allocations').insert({
                      id: `ALLOC-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
                      transactionId: txnId,
                      supplierInvoiceId,
                      amount: Number(p.amount),
                      memo: 'Auto-linked from supplier invoice OCR',
                    });
                    if (allocErr) throw new Error(allocErr.message);
                  }
                  toast.push({
                    kind: 'success',
                    title: `${validPayments.length} prior payment${validPayments.length === 1 ? '' : 's'} linked`,
                    description: 'OCR\'d payments allocated to the new bill.',
                  });
                  // Refresh both the bills list AND the AP balance
                  // view so the row's Paid / Balance columns AND the
                  // Statement modal reflect the auto-linked payments
                  // immediately (rather than waiting for the next
                  // background refetch).
                  ap.refetch();
                  pay.refetch();
                } catch (e: any) {
                  toast.push({ kind: 'warning', title: 'Payments not linked', description: e?.message ?? 'Bill saved, but the OCR\'d payments need to be re-recorded manually.' });
                }
              }

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
