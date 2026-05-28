// Invoice Statement modal — opened from the Receivables / Payables
// row eye-icon (view action). Displays the same T-account statement
// that lives in the bottom of RecordPaymentDrawer, but standalone
// so the user can review a fully-paid (no Receipt button) row's
// payment history without entering a new transaction.
//
// Reads through useTransactionsForTarget so void/edit done elsewhere
// reflects live without a refresh.

import React from 'react';
import { X as XIcon, FileText, Eye, AlertCircle, Loader2, FileSearch } from 'lucide-react';
import { useTransactionsForTarget } from '../queries/useTransactions';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** AR target. */
  invoiceId?: string;
  /** AP supplier-invoice target. */
  supplierInvoiceId?: string;
  /** AP PO target. */
  purchaseOrderId?: string;
  /** Display values. */
  documentLabel: string;       // e.g. INV-0001
  counterpartyName?: string | null;
  invoiceTotal: number;        // authoritative total from the AR/AP view
  paid: number;                // authoritative paid total from the view
  currency: string;
  /** Optional — viewer for receipt files. When omitted, the View
   *  button on each row is hidden (caller mounts no PDF viewer). */
  onViewReceipt?: (url: string) => void;
  /** Optional — when supplied, renders a "View original" link in
   *  the header that opens the OCR-source PDF / image for the
   *  invoice/bill. Wired from PayablesV2 / ReceivablesV2 once the
   *  row carries an originalDocument data URL. */
  onViewOriginal?: () => void;
}

function fmtMoney(n: number, c: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(n);
}

export const InvoiceStatementModal: React.FC<Props> = ({
  open, onOpenChange,
  invoiceId, supplierInvoiceId, purchaseOrderId,
  documentLabel, counterpartyName, invoiceTotal, paid, currency,
  onViewReceipt, onViewOriginal,
}) => {
  const history = useTransactionsForTarget({ invoiceId, supplierInvoiceId, purchaseOrderId });
  const targetId = invoiceId ?? supplierInvoiceId ?? purchaseOrderId;

  if (!open) return null;

  // Filter allocations down to this target so split payments only
  // contribute their relevant slice.
  const rows = (history.data ?? []).flatMap(t =>
    t.allocations
      .filter(a =>
        (!!invoiceId         && a.invoiceId === targetId) ||
        (!!supplierInvoiceId && a.supplierInvoiceId === targetId) ||
        (!!purchaseOrderId   && a.purchaseOrderId === targetId)
      )
      .map(a => ({ txn: t, alloc: a }))
  );
  // `paid` is the AR/AP balance view's authoritative figure passed
  // in by the caller. The live ledger sum (`fromLedger`) reads from
  // transactions+allocations directly — when it's larger than the
  // prop, the view is just stale (typical right after a save: new
  // allocations exist but the view query hasn't refetched). Trust
  // the larger of the two so TOTAL PAID and Balance match the
  // receipts list the user is staring at.
  const fromLedger = rows.reduce((s, x) => s + x.alloc.amount, 0);
  const effectivePaid = Math.max(paid, fromLedger);
  const unaccounted = Math.max(0, effectivePaid - fromLedger);
  const balance = Math.max(0, invoiceTotal - effectivePaid);
  const fullySettled = balance < 0.005;

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
        style={{ maxWidth: '720px', maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#1f1f1f] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={14} className="text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-slate-100 truncate">
                Statement · {documentLabel}
              </div>
              {counterpartyName && (
                <div className="text-[11.5px] text-slate-500 truncate">{counterpartyName}</div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {onViewOriginal && (
              <button
                type="button"
                onClick={onViewOriginal}
                title="View OCR source document"
                className="text-[11px] text-slate-400 hover:text-emerald-300 inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-700/40"
              >
                <FileSearch size={11} /> Original
              </button>
            )}
            <span className={
              'text-[10px] uppercase tracking-wider font-semibold ' +
              (fullySettled ? 'text-emerald-400' : 'text-amber-400')
            }>
              {fullySettled ? 'Paid in full' : 'Open'}
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
        <div className="px-5 py-4 overflow-y-auto text-[12.5px]">
          {history.isLoading ? (
            <div className="flex items-center gap-2 text-slate-500 py-6 justify-center">
              <Loader2 size={14} className="animate-spin" /> Loading statement…
            </div>
          ) : history.error ? (
            <div className="rounded border border-red-500/30 bg-red-500/5 p-3 text-red-300 flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              Couldn't load transactions for this document.
            </div>
          ) : (
            <>
              {/* Invoice total */}
              <div className="flex items-center justify-between py-1.5">
                <span className="text-slate-300">Invoice total</span>
                <span className="text-slate-100 font-mono tabular-nums font-semibold">
                  {fmtMoney(invoiceTotal, currency)}
                </span>
              </div>

              {/* Prior receipts list */}
              {(rows.length > 0 || unaccounted > 0.005) ? (
                <>
                  <div className="mt-2 pt-2 border-t border-[#1f1f1f] text-[10.5px] text-slate-500 uppercase tracking-wider mb-1">
                    Receipts · {rows.length + (unaccounted > 0.005 ? 1 : 0)}
                  </div>
                  {rows.map(({ txn, alloc }) => (
                    <div key={alloc.id} className="flex items-center justify-between py-1 text-[11.5px]">
                      <span className="text-slate-400 font-mono tabular-nums">
                        {(txn.txnDate ?? '').slice(0, 10)}
                        <span className="text-slate-600 mx-1.5">·</span>
                        <span className="uppercase">{txn.method ?? '—'}</span>
                        {txn.reference && (
                          <>
                            <span className="text-slate-600 mx-1.5">·</span>
                            <span className="text-slate-500">{txn.reference}</span>
                          </>
                        )}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-slate-300 font-mono tabular-nums">
                          −{fmtMoney(alloc.amount, txn.currency)}
                        </span>
                        {txn.receiptUrl && onViewReceipt && (
                          <button
                            type="button"
                            onClick={() => onViewReceipt(txn.receiptUrl!)}
                            title="View receipt"
                            className="text-slate-500 hover:text-emerald-300"
                          >
                            <Eye size={12} />
                          </button>
                        )}
                      </span>
                    </div>
                  ))}
                  {unaccounted > 0.005 && (
                    <div
                      className="flex items-center justify-between py-1 text-[11.5px]"
                      title="Payments captured in the AR view but not in the unified transactions ledger — typically QuickBooks-pulled or legacy entries."
                    >
                      <span className="text-slate-500 italic">
                        Legacy / QB-imported payments (no receipt file)
                      </span>
                      <span className="text-slate-400 font-mono tabular-nums">
                        −{fmtMoney(unaccounted, currency)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between py-1 mt-1 border-t border-dashed border-[#1a1a1a] text-slate-400">
                    <span className="text-[10.5px] uppercase tracking-wider">Total paid</span>
                    <span className="font-mono tabular-nums">−{fmtMoney(effectivePaid, currency)}</span>
                  </div>
                </>
              ) : (
                <div className="mt-2 py-2 text-[11.5px] text-slate-600 italic">
                  No receipts recorded on this document yet.
                </div>
              )}

              {/* Balance */}
              <div className={
                'flex items-center justify-between py-2 mt-2 border-t-2 ' +
                (fullySettled
                  ? 'border-emerald-500/40 text-emerald-300 font-semibold'
                  : 'border-[#1f1f1f] text-amber-300 font-semibold')
              }>
                <span>Balance</span>
                <span className="font-mono tabular-nums">{fmtMoney(balance, currency)}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
