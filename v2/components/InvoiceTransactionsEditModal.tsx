// Invoice Transactions Editor — opened from the Receivables /
// Payables row pencil-icon (edit action). Lists every transaction
// allocated to the invoice/bill/PO and lets the user edit any
// field (date, amount, method, reference) or void the row.
//
// Each row is editable inline; Save fires a useUpdateTransaction
// mutation that writes both the parent transaction patch AND, when
// the amount changes, syncs the underlying allocation row so the
// AR/AP balance views recompute on the next query refresh.

import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Loader2, Save, Trash2, AlertCircle } from 'lucide-react';
import {
  useTransactionsForTarget, useUpdateTransaction, useVoidTransaction,
  type TxnMethod,
} from '../queries/useTransactions';
import { useToast } from '../primitives/Toast';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoiceId?: string;
  supplierInvoiceId?: string;
  purchaseOrderId?: string;
  documentLabel: string;
  counterpartyName?: string | null;
  currency: string;
}

const METHODS: TxnMethod[] = ['WIRE', 'ACH', 'CHECK', 'CARD', 'CASH', 'OTHER'];

interface EditableRow {
  txnId: string;
  allocationId: string;
  date: string;
  amount: string;        // string for input control
  method: TxnMethod | null;
  reference: string;
  memo: string;
  receiptUrl: string | null;
  // Marker to know what changed when saving.
  originalAmount: number;
}

export const InvoiceTransactionsEditModal: React.FC<Props> = ({
  open, onOpenChange,
  invoiceId, supplierInvoiceId, purchaseOrderId,
  documentLabel, counterpartyName, currency,
}) => {
  const toast = useToast();
  const history = useTransactionsForTarget({ invoiceId, supplierInvoiceId, purchaseOrderId });
  const update = useUpdateTransaction();
  const voidTxn = useVoidTransaction();

  const targetId = invoiceId ?? supplierInvoiceId ?? purchaseOrderId;
  const [drafts, setDrafts] = useState<EditableRow[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Hydrate drafts from the loaded history. Re-runs when the user
  // saves/voids one (history re-fetches via invalidation).
  useEffect(() => {
    const rows: EditableRow[] = [];
    for (const t of (history.data ?? [])) {
      for (const a of t.allocations) {
        const hits =
          (!!invoiceId         && a.invoiceId === targetId) ||
          (!!supplierInvoiceId && a.supplierInvoiceId === targetId) ||
          (!!purchaseOrderId   && a.purchaseOrderId === targetId);
        if (!hits) continue;
        rows.push({
          txnId: t.id,
          allocationId: a.id,
          date: (t.txnDate ?? '').slice(0, 10),
          amount: a.amount.toFixed(2),
          method: t.method,
          reference: t.reference ?? '',
          memo: t.memo ?? '',
          receiptUrl: t.receiptUrl,
          originalAmount: a.amount,
        });
      }
    }
    setDrafts(rows);
  }, [history.data, invoiceId, supplierInvoiceId, purchaseOrderId, targetId]);

  function patchDraft(allocationId: string, patch: Partial<EditableRow>) {
    setDrafts(prev => prev.map(d => d.allocationId === allocationId ? { ...d, ...patch } : d));
  }

  async function saveRow(d: EditableRow): Promise<void> {
    setPendingId(d.allocationId);
    try {
      const amountNum = Number(d.amount) || 0;
      const amountChanged = Math.abs(amountNum - d.originalAmount) > 0.005;
      await update.mutateAsync({
        id: d.txnId,
        txnDate: d.date,
        method: d.method,
        reference: d.reference.trim() || null,
        memo: d.memo.trim() || null,
        ...(amountChanged
          ? { allocationEdit: { allocationId: d.allocationId, amount: amountNum } }
          : {}),
      });
      toast.push({ kind: 'success', title: 'Receipt updated' });
      history.refetch();
    } catch (e: any) {
      toast.push({ kind: 'error', title: 'Update failed', description: e?.message });
    } finally {
      setPendingId(null);
    }
  }

  async function voidRow(d: EditableRow): Promise<void> {
    if (typeof window !== 'undefined'
        && !window.confirm(`Void this receipt of ${Number(d.amount).toLocaleString('en-US', { style: 'currency', currency })}? Kept for audit; the AR balance will recover.`)) {
      return;
    }
    setPendingId(d.allocationId);
    try {
      await voidTxn.mutateAsync(d.txnId);
      toast.push({ kind: 'success', title: 'Receipt voided' });
      history.refetch();
    } catch (e: any) {
      toast.push({ kind: 'error', title: 'Void failed', description: e?.message });
    } finally {
      setPendingId(null);
    }
  }

  const totalAllocated = useMemo(
    () => drafts.reduce((s, d) => s + (Number(d.amount) || 0), 0),
    [drafts],
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onOpenChange(false); }}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div
        className="bg-[#0a0a0a] border border-[#1f1f1f] rounded-lg shadow-2xl flex flex-col w-full"
        style={{ maxWidth: '920px', maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#1f1f1f] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={14} className="text-indigo-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-slate-100 truncate">
                Edit receipts · {documentLabel}
              </div>
              {counterpartyName && (
                <div className="text-[11.5px] text-slate-500 truncate">{counterpartyName}</div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-slate-500 font-mono tabular-nums">
              {drafts.length} receipt{drafts.length === 1 ? '' : 's'} · {totalAllocated.toLocaleString('en-US', { style: 'currency', currency })}
            </span>
            <button
              onClick={() => onOpenChange(false)}
              title="Close (Esc)"
              aria-label="Close"
              className="text-slate-400 hover:text-slate-100 text-xl leading-none w-7 h-7 inline-flex items-center justify-center rounded hover:bg-slate-700/40"
            >
              ×
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto">
          {history.isLoading ? (
            <div className="flex items-center gap-2 text-slate-500 py-6 justify-center text-[12px]">
              <Loader2 size={14} className="animate-spin" /> Loading receipts…
            </div>
          ) : history.error ? (
            <div className="rounded border border-red-500/30 bg-red-500/5 p-3 text-red-300 flex items-start gap-2 text-[12px]">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              Couldn't load receipts.
            </div>
          ) : drafts.length === 0 ? (
            <div className="text-[12px] text-slate-600 italic text-center py-8">
              No receipts have been recorded against this document yet.
            </div>
          ) : (
            <div className="space-y-2">
              {drafts.map((d) => {
                const isPending = pendingId === d.allocationId;
                return (
                  <div
                    key={d.allocationId}
                    className="rounded border border-[#1f1f1f] bg-[#0f0f0f] p-3 grid gap-2"
                    style={{ gridTemplateColumns: '110px 130px 90px 1fr 80px' }}
                  >
                    {/* Date */}
                    <input
                      type="date"
                      value={d.date}
                      onChange={(e) => patchDraft(d.allocationId, { date: e.target.value })}
                      className="px-2 py-1.5 text-[11.5px] bg-[#0a0a0a] border border-[#1f1f1f] rounded text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                    {/* Amount */}
                    <input
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      value={d.amount}
                      onChange={(e) => patchDraft(d.allocationId, { amount: e.target.value })}
                      className="px-2 py-1.5 text-[11.5px] bg-[#0a0a0a] border border-[#1f1f1f] rounded text-slate-200 text-right font-mono tabular-nums focus:outline-none focus:border-indigo-500"
                    />
                    {/* Method */}
                    <select
                      value={d.method ?? ''}
                      onChange={(e) => patchDraft(d.allocationId, { method: (e.target.value || null) as TxnMethod | null })}
                      className="px-2 py-1.5 text-[11.5px] bg-[#0a0a0a] border border-[#1f1f1f] rounded text-slate-200 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="">—</option>
                      {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    {/* Reference */}
                    <input
                      type="text"
                      value={d.reference}
                      onChange={(e) => patchDraft(d.allocationId, { reference: e.target.value })}
                      placeholder="Wire ID / check #"
                      className="px-2 py-1.5 text-[11.5px] bg-[#0a0a0a] border border-[#1f1f1f] rounded text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                    {/* Actions */}
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => saveRow(d)}
                        disabled={isPending}
                        title="Save changes"
                        className="text-indigo-300 hover:text-indigo-200 disabled:opacity-40 p-1"
                      >
                        {isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => voidRow(d)}
                        disabled={isPending}
                        title="Void receipt"
                        className="text-slate-500 hover:text-red-400 disabled:opacity-40 p-1"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#1f1f1f] flex items-center justify-between text-[11px] text-slate-500">
          <span>Click Save (💾) per row to commit. Void (🗑) keeps the row for audit.</span>
          <button
            onClick={() => onOpenChange(false)}
            className="px-3 py-1.5 text-[12px] text-slate-300 hover:text-slate-100 rounded hover:bg-[#141414]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
