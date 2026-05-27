// Record-payment drawer — manual entry of an AR receipt (PAYMENT_IN)
// or AP payment (PAYMENT_OUT).
//
// Two flows:
//   1. "Single-invoice" — opened from a row's "Receipt" / "Pay" button.
//      The invoiceId / purchaseOrderId is pre-filled and the user just
//      confirms amount + date + method.
//   2. "Free-form" — opened from a top-level "Record payment" button.
//      The user enters everything; allocations can split across N
//      invoices/POs or be left empty (advance / credit on account).
//
// Writes go through useCreateTransaction (which inserts the txn row
// + child allocation rows atomically).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Trash2, ChevronDown, ChevronUp,
  UploadCloud, Sparkles, Loader2, AlertCircle, ExternalLink, FileText,
} from 'lucide-react';
import { Drawer, Input, Label, Button } from '../primitives';
import { useToast } from '../primitives/Toast';
import {
  useCreateTransaction, useVoidTransaction, useTransactionsForTarget,
  type TxnKind, type TxnMethod, type CounterpartyType, type Transaction,
} from '../queries/useTransactions';
import { useGeminiExtractTyped, type ExtractSpec } from '../queries/useGeminiExtractTyped';

export interface PrefillInvoice {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string | null;
  customerId: string | null;
  outstanding: number;     // current balance owed
  currency: string;
}

export interface PrefillSupplierInvoice {
  supplierInvoiceId: string;
  invoiceNumber: string;
  supplierName: string | null;
  outstanding: number;
  currency: string;
}

export interface PrefillPo {
  purchaseOrderId: string;
  poNumber: string;
  supplierName: string | null;
  supplierId: string | null;
  outstanding: number;
  currency: string;
}

interface AllocationRow {
  id: string;                   // local row id, not DB
  invoiceId?: string;
  supplierInvoiceId?: string;
  purchaseOrderId?: string;
  label: string;                // human-readable for display
  amount: string;               // string while editing
}

/** Initial values from OCR extraction. Pre-fills the form so the user
 *  just reviews + confirms. All fields optional — the user can edit. */
export interface OcrPrefill {
  counterpartyName?: string;
  txnDate?: string;
  amount?: number;
  currency?: string;
  method?: TxnMethod;
  reference?: string;
  memo?: string;
  receiptDataUrl?: string;
  /** Hint for matching to an open invoice. Currently informational
   *  — Phase 2 doesn't auto-link; user picks allocation manually. */
  invoiceNumberHint?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** AR receipt or AP payment. Drives terminology + which prefill to expect. */
  mode: 'receipt' | 'payment';
  /** Single-invoice flow: pre-filled invoice (AR). */
  invoice?: PrefillInvoice;
  /** Single-supplier-invoice flow (AP). The typical AP entry point — paying a vendor bill. */
  supplierInvoice?: PrefillSupplierInvoice;
  /** Single-PO flow (AP, rarer — direct PO advance). */
  po?: PrefillPo;
  /** OCR-extracted values from a receipt PDF. Mutually exclusive with
   *  invoice/supplierInvoice/po — those are row-context flows; this is
   *  the upload flow. */
  ocrPrefill?: OcrPrefill;
  onSuccess?: () => void;
}

const METHODS: { value: TxnMethod; label: string }[] = [
  { value: 'WIRE',   label: 'Wire'   },
  { value: 'ACH',    label: 'ACH'    },
  { value: 'CHECK',  label: 'Check'  },
  { value: 'CARD',   label: 'Card'   },
  { value: 'CASH',   label: 'Cash'   },
  { value: 'OTHER',  label: 'Other'  },
];

function fmtMoney(n: number, c: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(n);
}

function newAllocId(): string {
  return 'tmp-' + Math.random().toString(36).slice(2, 9);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });
}

// Open a stored receipt — handles both data URLs (small files inlined
// into the txn row) and regular URLs (eventually Supabase storage).
// Data URLs are opened via a Blob so Safari/Chrome treat them as
// downloadable PDFs rather than navigation noise.
function openReceiptInNewTab(receiptUrl: string): void {
  if (!receiptUrl) return;
  if (!receiptUrl.startsWith('data:')) {
    window.open(receiptUrl, '_blank', 'noopener');
    return;
  }
  try {
    const [meta, b64] = receiptUrl.split(',');
    const mime = meta.match(/data:([^;]+)/)?.[1] ?? 'application/octet-stream';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: mime });
    const objectUrl = URL.createObjectURL(blob);
    window.open(objectUrl, '_blank', 'noopener');
    // Revoke after a few minutes so we don't leak; the tab will have
    // already cached the file by then.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5 * 60_000);
  } catch {
    // Fallback: try a direct open even if the decoding failed.
    window.open(receiptUrl, '_blank', 'noopener');
  }
}

/** Embedded OCR spec — same schema as ReceiptUploadModal so the user
 *  can OCR a receipt directly from inside the drawer without a second
 *  modal hop. Keeping the spec inline avoids a circular dep with
 *  ReceiptUploadModal (which also imports from here in the future). */
interface ReceiptOcrFields {
  counterpartyName: string;
  txnDate: string;
  amount: number;
  currency: string;
  method: TxnMethod | null;
  reference: string | null;
  invoiceNumberHint: string | null;
  memo: string | null;
}

const buildReceiptOcrSpec = (mode: 'receipt' | 'payment'): ExtractSpec<ReceiptOcrFields> => ({
  prompt: [
    `You are an accounts-${mode === 'receipt' ? 'receivable' : 'payable'} OCR assistant.`,
    `Given a payment confirmation document (bank wire confirmation, ACH receipt,`,
    `vendor invoice receipt, deposit slip, or similar), extract the following`,
    `fields into a single JSON object. Return ONLY the JSON, no other text.`,
    ``,
    `Schema:`,
    `{`,
    `  "counterpartyName": string,`,
    `  "txnDate": string,             // ISO 8601 YYYY-MM-DD`,
    `  "amount": number,              // positive decimal, no currency symbol`,
    `  "currency": string,            // ISO 4217`,
    `  "method": string,              // WIRE | ACH | CHECK | CARD | CASH | OTHER`,
    `  "reference": string|null,`,
    `  "invoiceNumberHint": string|null,`,
    `  "memo": string|null`,
    `}`,
    ``,
    `Rules:`,
    `- Missing fields → null (amount is required).`,
    `- "Bank transfer" → WIRE; "Direct deposit" → ACH; card → CARD.`,
    `- Strip currency symbols and thousand separators from amount.`,
    `- Prefer ISO dates ("Jan 15, 2026" → "2026-01-15").`,
  ].join('\n'),
  normalize: (parsed) => {
    const allowed: TxnMethod[] = ['WIRE','ACH','CHECK','CARD','CASH','OTHER'];
    const rawMethod = String(parsed['method'] ?? '').toUpperCase();
    return {
      counterpartyName: String(parsed['counterpartyName'] ?? '').trim(),
      txnDate: String(parsed['txnDate'] ?? new Date().toISOString().slice(0, 10)),
      amount: Number(parsed['amount']) || 0,
      currency: String(parsed['currency'] ?? 'USD').toUpperCase(),
      method: allowed.includes(rawMethod as TxnMethod) ? (rawMethod as TxnMethod) : null,
      reference: (parsed['reference'] as string | null) ?? null,
      invoiceNumberHint: (parsed['invoiceNumberHint'] as string | null) ?? null,
      memo: (parsed['memo'] as string | null) ?? null,
    };
  },
});

export const RecordPaymentDrawer: React.FC<Props> = ({
  open, onOpenChange, mode, invoice, supplierInvoice, po, ocrPrefill, onSuccess,
}) => {
  const toast = useToast();
  const create = useCreateTransaction();
  const voidTxn = useVoidTransaction();

  // ── Receipt attachment ───────────────────────────────────────────
  // The OCR upload zone (below) drops a data URL here; it persists to
  // transactions.receiptUrl on save. If the user records the payment
  // without OCR they can still attach a file via the "Attach receipt"
  // input — the file is read locally and stored inline (no separate
  // upload endpoint yet; Phase 2 keeps receipt storage simple).
  const [receiptDataUrl, setReceiptDataUrl] = useState<string | null>(null);
  const [receiptFileName, setReceiptFileName] = useState<string | null>(null);

  // ── OCR upload (embedded — no separate modal) ────────────────────
  const ocrSpec = useMemo(() => buildReceiptOcrSpec(mode), [mode]);
  const ocr = useGeminiExtractTyped<ReceiptOcrFields>(ocrSpec);
  const [dragOver, setDragOver] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Existing receipts/payments for this target ───────────────────
  // Shows the history of payments already booked against this row so
  // the user sees what's been paid before adding another, and can
  // void mistaken entries from the same drawer.
  const history = useTransactionsForTarget({
    invoiceId: invoice?.invoiceId,
    supplierInvoiceId: supplierInvoice?.supplierInvoiceId,
    purchaseOrderId: po?.purchaseOrderId,
  });
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // ── Form state ──────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const [txnDate, setTxnDate]    = useState(today);
  const [amount, setAmount]      = useState('');
  const [method, setMethod]      = useState<TxnMethod>('WIRE');
  const [reference, setReference] = useState('');
  const [memo, setMemo]          = useState('');
  const [counterpartyName, setCounterpartyName] = useState('');
  const [counterpartyId, setCounterpartyId]     = useState<string | undefined>(undefined);
  const [advanced, setAdvanced]  = useState(false);
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);

  // Original outstanding on the row-locked invoice/bill/PO, captured
  // when the drawer opens. Used as the upper bound when we auto-sync
  // the locked allocation to the payment amount — typing $50,000 into
  // Amount shouldn't allocate $50K to a $22K invoice.
  const originalOutstanding = invoice?.outstanding
    ?? supplierInvoice?.outstanding
    ?? po?.outstanding
    ?? 0;

  /** Update the payment amount AND keep the row-locked allocation in
   *  sync — most receipts are partial payments, and the user had to
   *  manually shrink both the Amount and the Allocation before, which
   *  produced confusing "Over-allocated" warnings (see screenshot
   *  flagged 2026-05-27). The auto-sync only runs while there's a
   *  single row-locked allocation that hasn't been split or manually
   *  edited — once the user adds a second allocation or removes the
   *  locked one, the manual editor is in charge. */
  function setAmountAndSyncLocked(next: string): void {
    setAmount(next);
    const nextNum = Number(next) || 0;
    setAllocations(prev => {
      if (prev.length !== 1) return prev;
      const sole = prev[0];
      const isRowLocked = !!(sole.invoiceId || sole.supplierInvoiceId || sole.purchaseOrderId);
      if (!isRowLocked) return prev;
      // Cap at the original outstanding so we never allocate more
      // than the invoice actually owes; the surplus becomes a
      // "Credit on account" indicator in the summary.
      const capped = originalOutstanding > 0
        ? Math.min(nextNum, originalOutstanding)
        : nextNum;
      return [{ ...sole, amount: capped.toFixed(2) }];
    });
  }

  // ── Seed form from props when the drawer opens ──────────────────
  useEffect(() => {
    if (!open) return;
    if (invoice) {
      setAmount(invoice.outstanding.toFixed(2));
      setCounterpartyName(invoice.customerName ?? '');
      setCounterpartyId(invoice.customerId ?? undefined);
      setAllocations([{
        id: newAllocId(),
        invoiceId: invoice.invoiceId,
        label: `${invoice.invoiceNumber}${invoice.customerName ? ` · ${invoice.customerName}` : ''}`,
        amount: invoice.outstanding.toFixed(2),
      }]);
    } else if (supplierInvoice) {
      setAmount(supplierInvoice.outstanding.toFixed(2));
      setCounterpartyName(supplierInvoice.supplierName ?? '');
      setCounterpartyId(undefined);
      setAllocations([{
        id: newAllocId(),
        supplierInvoiceId: supplierInvoice.supplierInvoiceId,
        label: `${supplierInvoice.invoiceNumber}${supplierInvoice.supplierName ? ` · ${supplierInvoice.supplierName}` : ''}`,
        amount: supplierInvoice.outstanding.toFixed(2),
      }]);
    } else if (po) {
      setAmount(po.outstanding.toFixed(2));
      setCounterpartyName(po.supplierName ?? '');
      setCounterpartyId(po.supplierId ?? undefined);
      setAllocations([{
        id: newAllocId(),
        purchaseOrderId: po.purchaseOrderId,
        label: `${po.poNumber}${po.supplierName ? ` · ${po.supplierName}` : ''}`,
        amount: po.outstanding.toFixed(2),
      }]);
    } else if (ocrPrefill) {
      // OCR-extracted values — seed the form, leave allocations empty so
      // the user can pick which invoice / bill this payment settles.
      setAmount(ocrPrefill.amount != null ? ocrPrefill.amount.toFixed(2) : '');
      setCounterpartyName(ocrPrefill.counterpartyName ?? '');
      setCounterpartyId(undefined);
      setAllocations([]);
    } else {
      setAmount('');
      setCounterpartyName('');
      setCounterpartyId(undefined);
      setAllocations([]);
    }
    setTxnDate(ocrPrefill?.txnDate ?? today);
    setMethod(ocrPrefill?.method ?? 'WIRE');
    setReference(ocrPrefill?.reference ?? '');
    setMemo(ocrPrefill?.memo ?? '');
    setAdvanced(false);
    // Reset embedded-OCR state so reopening on a different row doesn't
    // surface stale extraction errors.
    setReceiptDataUrl(ocrPrefill?.receiptDataUrl ?? null);
    setReceiptFileName(null);
    setOcrError(null);
  }, [open, invoice, supplierInvoice, po, ocrPrefill]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle a file dropped/picked into the embedded OCR zone — runs
  // Gemini, fills the form, and attaches the data URL so it persists
  // as receiptUrl on save.
  //
  // The user explicitly uploaded a receipt to OCR, so the extracted
  // values WIN over the drawer's defaults (which are placeholders
  // like today's date / the invoice's outstanding balance / "Wire").
  // The only field we won't overwrite is a row-locked counterparty —
  // when opened from an invoice/PO row, the customer/supplier is
  // structurally fixed and Gemini's guess (often the bank name) must
  // not replace it.
  async function runOcrOnFile(file: File): Promise<void> {
    setOcrError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      setReceiptDataUrl(dataUrl);
      setReceiptFileName(file.name);
      const result = await ocr.mutateAsync({ kind: 'file', file });

      // Track which fields actually changed so the success toast tells
      // the user exactly what got filled — and the empty case is
      // surfaced as a warning instead of a silent success.
      const filled: string[] = [];
      const isRowLocked = !!(invoice || po);
      if (!isRowLocked && result.counterpartyName) {
        setCounterpartyName(result.counterpartyName);
        filled.push('customer');
      }
      if (result.txnDate)  { setTxnDate(result.txnDate);  filled.push('date'); }
      if (result.amount > 0) {
        // Auto-sync the row-locked allocation so partial-payment
        // receipts don't trip an Over-allocated warning.
        setAmountAndSyncLocked(result.amount.toFixed(2));
        filled.push('amount');
      }
      if (result.method)   { setMethod(result.method);    filled.push('method'); }
      if (result.reference){ setReference(result.reference); filled.push('reference'); }
      if (result.memo)     { setMemo(result.memo);        filled.push('memo'); }

      // Mirror to the console so the user can inspect exactly what
      // Gemini saw vs. what made it onto the form — invaluable when a
      // receipt is half-extracted ("amount missing but ref ok" etc).
      // eslint-disable-next-line no-console
      console.log('[RecordPaymentDrawer] OCR result:', result, 'filled:', filled);

      if (filled.length === 0) {
        setOcrError(
          'Gemini returned an empty extraction — the file may be a low-quality scan, '
          + 'a non-receipt document, or in a format Gemini couldn\'t parse. The file '
          + 'is still attached; fill the fields manually.',
        );
        toast.push({
          kind: 'error',
          title: 'No fields extracted',
          description: 'Receipt attached, but Gemini couldn\'t read any fields. Enter values manually.',
        });
      } else {
        toast.push({
          kind: 'success',
          title: 'Receipt parsed',
          description: `Filled ${filled.join(' · ')}`,
        });
      }
    } catch (e: any) {
      const msg = e?.message ?? 'extraction failed';
      setOcrError(msg);
      // eslint-disable-next-line no-console
      console.error('[RecordPaymentDrawer] OCR failed:', e);
      toast.push({ kind: 'error', title: 'OCR failed', description: msg.slice(0, 200) });
    }
  }

  function onDropFile(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) runOcrOnFile(f);
  }

  async function attachOnly(file: File): Promise<void> {
    // Skip OCR — just persist the file as the receipt attachment.
    setReceiptDataUrl(await fileToDataUrl(file));
    setReceiptFileName(file.name);
    setOcrError(null);
  }

  async function deleteHistoryEntry(txnId: string): Promise<void> {
    setPendingDeleteId(txnId);
    try {
      await voidTxn.mutateAsync(txnId);
      toast.push({ kind: 'success', title: 'Receipt removed' });
      history.refetch();
      onSuccess?.();
    } catch (e: any) {
      toast.push({ kind: 'error', title: 'Delete failed', description: e?.message });
    } finally {
      setPendingDeleteId(null);
    }
  }

  // ── Derived ─────────────────────────────────────────────────────
  const amountNum = Number(amount) || 0;
  const allocatedSum = useMemo(
    () => allocations.reduce((s, a) => s + (Number(a.amount) || 0), 0),
    [allocations],
  );
  const unallocated = amountNum - allocatedSum;
  const allocationsValid = allocations.every(a => (Number(a.amount) || 0) > 0);
  const canSubmit =
    amountNum > 0 &&
    !!txnDate &&
    !!counterpartyName.trim() &&
    allocationsValid &&
    allocatedSum <= amountNum + 0.001 &&
    !create.isPending;

  // ── Allocations editor ──────────────────────────────────────────
  function updateAlloc(id: string, patch: Partial<AllocationRow>) {
    setAllocations(a => a.map(x => x.id === id ? { ...x, ...patch } : x));
  }
  function addAlloc() {
    setAllocations(a => [...a, { id: newAllocId(), label: '', amount: '' }]);
  }
  function removeAlloc(id: string) {
    setAllocations(a => a.filter(x => x.id !== id));
  }

  // ── Submit ─────────────────────────────────────────────────────
  async function submit() {
    if (!canSubmit) return;
    const kind: TxnKind = mode === 'receipt' ? 'PAYMENT_IN' : 'PAYMENT_OUT';
    const counterpartyType: CounterpartyType = mode === 'receipt' ? 'CUSTOMER' : 'SUPPLIER';
    try {
      await create.mutateAsync({
        // Mark source=OCR when either the parent passed an ocrPrefill
        // or the user ran the embedded OCR upload (which sets the
        // dataUrl AND fills fields). Otherwise it's a manual entry.
        source: (ocrPrefill || (receiptDataUrl && !!ocr.data)) ? 'OCR' : 'MANUAL',
        kind,
        txnDate,
        amount: amountNum,
        currency: invoice?.currency ?? supplierInvoice?.currency ?? po?.currency ?? ocrPrefill?.currency ?? 'USD',
        method,
        counterpartyType,
        counterpartyId,
        counterpartyName: counterpartyName.trim(),
        reference: reference.trim() || undefined,
        memo: memo.trim() || undefined,
        // Prefer the embedded attachment over the prop-passed one so
        // a user who replaces the receipt mid-flow gets their newer
        // file persisted.
        receiptUrl: receiptDataUrl ?? ocrPrefill?.receiptDataUrl,
        allocations: allocations
          .filter(a => (Number(a.amount) || 0) > 0)
          .map(a => ({
            invoiceId: a.invoiceId,
            supplierInvoiceId: a.supplierInvoiceId,
            purchaseOrderId: a.purchaseOrderId,
            amount: Number(a.amount) || 0,
          })),
      });
      toast.push({ kind: 'success', title: mode === 'receipt' ? 'Receipt recorded' : 'Payment recorded' });
      onOpenChange(false);
      onSuccess?.();
    } catch (e: any) {
      toast.push({ kind: 'error', title: e?.message ?? 'Save failed' });
    }
  }

  const title = mode === 'receipt' ? 'Record receipt' : 'Record payment';
  const description = mode === 'receipt'
    ? 'Incoming payment from a customer. Logs an AR receipt and allocates to one or more invoices.'
    : 'Outgoing payment to a supplier. Logs an AP payment and allocates to one or more purchase orders.';

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <div className="flex items-center gap-2 justify-end">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={!canSubmit}
            className="bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {create.isPending ? 'Saving…' : (mode === 'receipt' ? 'Record receipt' : 'Record payment')}
          </Button>
        </div>
      }
    >
      <div className="p-5 space-y-4">
        {/* Counterparty */}
        <div>
          <Label htmlFor="cp">{mode === 'receipt' ? 'Customer' : 'Supplier'}</Label>
          <Input
            id="cp"
            value={counterpartyName}
            onChange={e => setCounterpartyName(e.target.value)}
            placeholder={mode === 'receipt' ? 'Customer name' : 'Supplier name'}
            disabled={!!(invoice || po)}
          />
          {(invoice || po) && (
            <div className="text-[11px] text-slate-500 mt-1">
              Locked — opened from a specific {mode === 'receipt' ? 'invoice' : 'purchase order'}.
            </div>
          )}
        </div>

        {/* ── History of receipts/payments already booked against this
            target row. Empty list when the row is fresh; collapses
            cleanly when opened in free-form mode (no target id).    */}
        {(invoice || supplierInvoice || po) && (
          <HistoryList
            mode={mode}
            rows={history.data ?? []}
            isLoading={history.isLoading}
            error={history.error}
            pendingDeleteId={pendingDeleteId}
            onView={openReceiptInNewTab}
            onDelete={deleteHistoryEntry}
          />
        )}

        {/* ── Embedded OCR upload zone ──────────────────────────────
            Drop a receipt → Gemini fills the fields below + attaches
            the file to be persisted as transactions.receiptUrl. The
            zone collapses to a small "Attached" chip once a receipt
            is on the draft so the form doesn't dominate the layout. */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <Label className="mb-0">Receipt</Label>
            {receiptDataUrl && (
              <button
                type="button"
                onClick={() => { setReceiptDataUrl(null); setReceiptFileName(null); }}
                className="text-[11px] text-slate-500 hover:text-red-400 inline-flex items-center gap-1"
                title="Detach receipt"
              >
                <Trash2 size={11} /> Remove
              </button>
            )}
          </div>
          {receiptDataUrl ? (
            <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-3 flex items-center justify-between text-[12.5px]">
              <div className="flex items-center gap-2 text-slate-200 truncate">
                <FileText size={14} className="text-emerald-400 shrink-0" />
                <span className="truncate">{receiptFileName ?? 'Receipt attached'}</span>
              </div>
              <button
                type="button"
                onClick={() => openReceiptInNewTab(receiptDataUrl)}
                className="text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1 text-[11.5px] shrink-0 ml-2"
              >
                <ExternalLink size={11} /> View
              </button>
            </div>
          ) : (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDropFile}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              className={
                'rounded border-2 border-dashed p-4 text-center cursor-pointer transition-colors ' +
                (dragOver
                  ? 'border-emerald-500 bg-emerald-500/5'
                  : 'border-[#1f1f1f] bg-[#0f0f0f] hover:border-emerald-500/40')
              }
            >
              {ocr.isPending ? (
                <>
                  <Loader2 size={20} className="mx-auto text-emerald-400 animate-spin" />
                  <div className="text-[12.5px] text-slate-200 mt-2">Extracting fields with Gemini…</div>
                  <div className="text-[10.5px] text-slate-500 mt-0.5">Usually 3–8 seconds for a PDF.</div>
                </>
              ) : (
                <>
                  <UploadCloud size={20} className="mx-auto text-slate-400" />
                  <div className="text-[12.5px] text-slate-200 mt-2 font-medium">Drop receipt to OCR + attach</div>
                  <div className="text-[10.5px] text-slate-500 mt-0.5">
                    or click to pick a PDF / image · fields below auto-fill
                  </div>
                  <div className="inline-flex items-center gap-1 mt-2 text-[10.5px] text-emerald-400">
                    <Sparkles size={10} /> Powered by Gemini
                  </div>
                </>
              )}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/*"
            hidden
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) runOcrOnFile(f);
              if (fileInputRef.current) fileInputRef.current.value = '';
            }}
          />
          {ocrError && (
            <div className="mt-2 rounded border border-red-500/40 bg-red-500/5 p-2 text-[11.5px] text-red-300 flex items-start gap-2">
              <AlertCircle size={12} className="shrink-0 mt-0.5" />
              <div className="flex-1">
                {ocrError}
                {/* Let the user still attach the file even when OCR
                    failed — manual entry then becomes the path. */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="ml-2 underline text-red-200 hover:text-white"
                >
                  Attach anyway
                </button>
              </div>
            </div>
          )}
          {/* Hidden helper so attachOnly is reachable from the
              "Attach anyway" flow if a parent wanted to wire it.
              Currently the inline button re-opens the file picker
              and re-runs OCR; attachOnly is kept for future use. */}
          {false && <button onClick={() => attachOnly(new File([], ''))} />}
        </div>

        {/* Date + amount + method */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="date">Date</Label>
            <Input id="date" type="date" value={txnDate} onChange={e => setTxnDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="amt">Amount</Label>
            <Input
              id="amt"
              type="number"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={e => setAmountAndSyncLocked(e.target.value)}
              placeholder="0.00"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="method">Method</Label>
            <select
              id="method"
              value={method}
              onChange={e => setMethod(e.target.value as TxnMethod)}
              className="block w-full rounded border border-[#1f1f1f] bg-[#0f0f0f] px-2 py-1.5 text-[12.5px] text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="ref">Reference</Label>
            <Input id="ref" value={reference} onChange={e => setReference(e.target.value)} placeholder="Wire ID / check #" />
          </div>
        </div>

        {/* Allocations */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <Label className="mb-0">Allocations</Label>
            <button
              onClick={() => setAdvanced(a => !a)}
              className="text-[11px] text-slate-500 hover:text-slate-300 inline-flex items-center gap-1"
            >
              {advanced ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              {advanced ? 'simple' : 'split across multiple'}
            </button>
          </div>

          {allocations.length === 0 && (
            <div className="text-[12px] text-slate-500 rounded border border-dashed border-[#1f1f1f] p-3">
              No allocations — this payment will sit as a credit on the {mode === 'receipt' ? 'customer' : 'supplier'} account.
            </div>
          )}

          {allocations.map((a, i) => (
            <div key={a.id} className="grid grid-cols-[1fr_120px_28px] gap-2 mb-2 items-center">
              <Input
                value={a.label}
                onChange={e => updateAlloc(a.id, { label: e.target.value })}
                placeholder={mode === 'receipt' ? 'Invoice #' : 'PO #'}
                disabled={!!(a.invoiceId || a.supplierInvoiceId || a.purchaseOrderId)}
                className="text-[12.5px]"
              />
              <Input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={a.amount}
                onChange={e => updateAlloc(a.id, { amount: e.target.value })}
                placeholder="0.00"
                className="text-[12.5px] text-right"
              />
              <button
                onClick={() => removeAlloc(a.id)}
                // The locked allocation row was previously
                // un-deletable when it was the only one, which forced
                // the user into Over-allocated limbo if the receipt
                // didn't apply to this invoice. Allow removal — the
                // payment then sits as a credit on account (already a
                // supported state in the summary below).
                title="Remove allocation"
                className="text-slate-500 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
              >
                <Trash2 size={13} />
              </button>
              {i === 0 && (a.invoiceId || a.supplierInvoiceId || a.purchaseOrderId) && (
                <div className="col-span-3 text-[10.5px] text-slate-500 -mt-1 pl-1">
                  Locked — pre-filled from row. Add more lines below to split across additional {mode === 'receipt' ? 'invoices' : 'POs'}.
                </div>
              )}
            </div>
          ))}

          {advanced && (
            <button
              onClick={addAlloc}
              className="text-[12px] text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 mt-1"
            >
              <Plus size={12} /> Add allocation line
            </button>
          )}

          {/* Allocation summary */}
          {allocations.length > 0 && (
            <div className="mt-3 rounded border border-[#1f1f1f] bg-[#0f0f0f] p-2.5 text-[11.5px]">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Total payment</span>
                <span className="text-slate-200 font-mono tabular-nums">{fmtMoney(amountNum)}</span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-slate-500">Allocated</span>
                <span className="text-slate-200 font-mono tabular-nums">{fmtMoney(allocatedSum)}</span>
              </div>
              <div className="flex items-center justify-between mt-1 pt-1 border-t border-[#1f1f1f]">
                <span className="text-slate-400 font-medium">
                  {unallocated > 0.001
                    ? `Credit on account`
                    : unallocated < -0.001
                      ? `Over-allocated · ${fmtMoney(Math.abs(unallocated))}`
                      : 'Fully allocated'}
                </span>
                <span
                  className={`font-mono tabular-nums font-medium ${
                    Math.abs(unallocated) < 0.001 ? 'text-emerald-400'
                      : unallocated < 0 ? 'text-red-400'
                      : 'text-amber-400'
                  }`}
                >
                  {fmtMoney(unallocated)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Memo */}
        <div>
          <Label htmlFor="memo">Memo</Label>
          <textarea
            id="memo"
            value={memo}
            onChange={e => setMemo(e.target.value)}
            rows={2}
            placeholder="Optional note"
            className="w-full rounded border border-[#1f1f1f] bg-[#0f0f0f] px-2 py-1.5 text-[12.5px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>
    </Drawer>
  );
};

// ── HistoryList — receipts/payments already booked against the row ─
//
// Renders one compact row per existing transaction with date, amount,
// method, reference, an optional [View] for the receipt file, and a
// [Delete] (which voids the transaction). The list collapses to a
// "No payments yet" hint when empty so the drawer stays tidy on first
// use. Hidden entirely when no target row is in scope (free-form OCR
// flow opens the drawer without an invoice/PO id).

interface HistoryListProps {
  mode: 'receipt' | 'payment';
  rows: Transaction[];
  isLoading: boolean;
  error: unknown;
  pendingDeleteId: string | null;
  onView: (url: string) => void;
  onDelete: (txnId: string) => void;
}

const HistoryList: React.FC<HistoryListProps> = ({
  mode, rows, isLoading, error, pendingDeleteId, onView, onDelete,
}) => {
  const label = mode === 'receipt' ? 'receipts' : 'payments';
  if (isLoading) {
    return (
      <div className="rounded border border-[#1f1f1f] bg-[#0f0f0f] p-3 text-[11.5px] text-slate-500">
        Loading prior {label}…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded border border-red-500/30 bg-red-500/5 p-3 text-[11.5px] text-red-300 flex items-start gap-2">
        <AlertCircle size={12} className="shrink-0 mt-0.5" />
        Couldn't load prior {label}.
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded border border-dashed border-[#1f1f1f] bg-[#0a0a0a] p-2.5 text-[11.5px] text-slate-500">
        No prior {label} on this {mode === 'receipt' ? 'invoice' : 'bill'} yet.
      </div>
    );
  }
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <Label className="mb-0">
          Prior {label} ({rows.length})
        </Label>
        <span className="text-[11px] text-slate-500 font-mono tabular-nums">
          {fmtMoney(total, rows[0]?.currency ?? 'USD')} received
        </span>
      </div>
      <div className="rounded border border-[#1f1f1f] bg-[#0a0a0a] divide-y divide-[#161616]">
        {rows.map(r => {
          // Show only the slice of the row that hit THIS target — when
          // the txn was split, the row's total amount is larger than
          // the slice we care about here. Sum the matching allocations.
          // (The hook already filtered allocations include all of them.)
          const isDeleting = pendingDeleteId === r.id;
          return (
            <div
              key={r.id}
              className="grid grid-cols-[80px_1fr_70px_90px_60px] gap-2 items-center px-2 py-1.5 text-[12px]"
            >
              <span className="text-slate-400 font-mono tabular-nums">
                {r.txnDate?.slice(0, 10) ?? '—'}
              </span>
              <span className="text-slate-200 font-mono tabular-nums">
                {fmtMoney(r.amount, r.currency)}
              </span>
              <span className="text-slate-400 uppercase tracking-wide text-[10.5px]">
                {r.method ?? '—'}
              </span>
              <span className="text-slate-500 truncate text-[11px]" title={r.reference ?? ''}>
                {r.reference ?? <span className="text-slate-600">no ref</span>}
              </span>
              <div className="flex items-center justify-end gap-1.5">
                {r.receiptUrl ? (
                  <button
                    type="button"
                    onClick={() => onView(r.receiptUrl!)}
                    title="View receipt file"
                    className="text-slate-400 hover:text-emerald-300"
                  >
                    <ExternalLink size={12} />
                  </button>
                ) : (
                  <span title="No receipt file attached" className="text-slate-700">
                    <FileText size={12} />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (isDeleting) return;
                    if (typeof window !== 'undefined'
                        && !window.confirm(`Remove this ${mode === 'receipt' ? 'receipt' : 'payment'} of ${fmtMoney(r.amount, r.currency)}? The entry will be voided (kept for audit).`)) {
                      return;
                    }
                    onDelete(r.id);
                  }}
                  disabled={isDeleting}
                  title={`Void this ${mode === 'receipt' ? 'receipt' : 'payment'}`}
                  className="text-slate-500 hover:text-red-400 disabled:opacity-30"
                >
                  {isDeleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
