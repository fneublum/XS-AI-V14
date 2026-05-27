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

import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { Drawer, Input, Label, Button } from '../primitives';
import { useToast } from '../primitives/Toast';
import {
  useCreateTransaction,
  type TxnKind, type TxnMethod, type CounterpartyType,
} from '../queries/useTransactions';

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

export const RecordPaymentDrawer: React.FC<Props> = ({
  open, onOpenChange, mode, invoice, supplierInvoice, po, ocrPrefill, onSuccess,
}) => {
  const toast = useToast();
  const create = useCreateTransaction();

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
  }, [open, invoice, supplierInvoice, po, ocrPrefill]); // eslint-disable-line react-hooks/exhaustive-deps

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
        source: ocrPrefill ? 'OCR' : 'MANUAL',
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
        receiptUrl: ocrPrefill?.receiptDataUrl,
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
              onChange={e => setAmount(e.target.value)}
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
                disabled={!!(a.invoiceId || a.supplierInvoiceId || a.purchaseOrderId) && allocations.length === 1}
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
