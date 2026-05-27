// Receipt upload — Phase 2 OCR.
//
// User drops a payment-confirmation PDF (bank wire confirmation,
// vendor receipt, deposit slip). Gemini extracts the structured
// fields. The modal then calls onExtracted with a partial draft so
// the caller can pre-fill the existing RecordPaymentDrawer.
//
// Mode mirrors RecordPaymentDrawer: 'receipt' for AR receipts
// (customer paid us), 'payment' for AP payments (we paid a supplier).

import React, { useRef, useState } from 'react';
import { UploadCloud, Sparkles, Loader2, FileText, AlertCircle } from 'lucide-react';
import { Drawer, Button } from '../primitives';
import { useGeminiExtractTyped, type ExtractSpec } from '../queries/useGeminiExtractTyped';
import { useToast } from '../primitives/Toast';
import type { TxnMethod } from '../queries/useTransactions';

export interface ReceiptExtracted {
  /** Counterparty name (customer for AR, supplier for AP). */
  counterpartyName: string;
  /** ISO date (YYYY-MM-DD). */
  txnDate: string;
  amount: number;
  currency: string;
  method: TxnMethod | null;
  /** Bank reference / wire id / check #. */
  reference: string | null;
  /** Any invoice/bill number Gemini saw on the receipt; the caller
   *  uses this hint to try matching against an open invoice. */
  invoiceNumberHint: string | null;
  /** Free-form note Gemini extracted. */
  memo: string | null;
  /** Data URL of the source PDF/image, persisted as receiptUrl on the
   *  transaction so the original document stays linked. Null when the
   *  input was pasted text. */
  receiptDataUrl: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: 'receipt' | 'payment';
  onExtracted: (e: ReceiptExtracted) => void;
}

const buildSpec = (mode: 'receipt' | 'payment'): ExtractSpec<ReceiptExtracted> => ({
  prompt: [
    `You are an accounts-${mode === 'receipt' ? 'receivable' : 'payable'} OCR assistant.`,
    `Given a payment confirmation document (bank wire confirmation, ACH receipt,`,
    `vendor invoice receipt, deposit slip, or similar), extract the following`,
    `fields into a single JSON object. Return ONLY the JSON, no other text.`,
    ``,
    `Schema:`,
    `{`,
    `  "counterpartyName": string,    // ${mode === 'receipt' ? 'who paid us (customer / payer)' : 'who we paid (supplier / payee)'}`,
    `  "txnDate": string,             // ISO 8601 date YYYY-MM-DD`,
    `  "amount": number,              // positive decimal, no currency symbol`,
    `  "currency": string,            // ISO 4217 (USD, BRL, EUR, etc.)`,
    `  "method": string,              // one of: WIRE | ACH | CHECK | CARD | CASH | OTHER`,
    `  "reference": string|null,      // bank reference / wire ID / check number / confirmation id`,
    `  "invoiceNumberHint": string|null, // any invoice/bill number visible on the receipt`,
    `  "memo": string|null            // short human description (≤ 80 chars)`,
    `}`,
    ``,
    `Rules:`,
    `- If a field is missing or unreadable, return null (except amount: required).`,
    `- Normalise the method to one of the six enum values. "Bank transfer" => WIRE.`,
    `  "Direct deposit" => ACH. Card / Credit Card / Debit => CARD.`,
    `- Strip any currency symbols / thousands separators from amount.`,
    `- Prefer a real ISO date over locale strings ("Jan 15, 2026" => "2026-01-15").`,
  ].join('\n'),
  normalize: (parsed) => {
    const get = (k: string): unknown => parsed[k];
    const amount = Number(get('amount')) || 0;
    const allowedMethods: TxnMethod[] = ['WIRE', 'ACH', 'CHECK', 'CARD', 'CASH', 'OTHER'];
    const rawMethod = String(get('method') ?? '').toUpperCase();
    const method: TxnMethod | null = allowedMethods.includes(rawMethod as TxnMethod) ? (rawMethod as TxnMethod) : null;
    return {
      counterpartyName: String(get('counterpartyName') ?? '').trim(),
      txnDate: String(get('txnDate') ?? new Date().toISOString().slice(0, 10)),
      amount,
      currency: String(get('currency') ?? 'USD').toUpperCase(),
      method,
      reference: (get('reference') as string | null) ?? null,
      invoiceNumberHint: (get('invoiceNumberHint') as string | null) ?? null,
      memo: (get('memo') as string | null) ?? null,
      receiptDataUrl: null,
    };
  },
});

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });
}

export const ReceiptUploadModal: React.FC<Props> = ({ open, onOpenChange, mode, onExtracted }) => {
  const toast = useToast();
  const spec = React.useMemo(() => buildSpec(mode), [mode]);
  const extract = useGeminiExtractTyped<ReceiptExtracted>(spec);

  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      const result = await extract.mutateAsync({ kind: 'file', file });
      // Attach the source document URL so it's persisted on the txn
      result.receiptDataUrl = dataUrl;
      onExtracted(result);
      onOpenChange(false);
    } catch (e: any) {
      const msg = e?.message ?? 'extraction failed';
      setError(msg);
      toast.push({ kind: 'error', title: 'OCR failed', description: msg.slice(0, 200) });
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  }

  function onPasteFile(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData?.items ?? []).find(i => i.kind === 'file');
    const f = item?.getAsFile();
    if (f) { e.preventDefault(); handleFile(f); }
  }

  const title = mode === 'receipt' ? 'OCR receipt — AR' : 'OCR receipt — AP';
  const description = mode === 'receipt'
    ? 'Drop a bank wire confirmation, ACH receipt, or deposit slip to extract the payment automatically.'
    : 'Drop a vendor receipt, bank confirmation, or paid-bill PDF to extract the payment automatically.';

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <div className="flex items-center justify-end">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={extract.isPending}>
            Cancel
          </Button>
        </div>
      }
    >
      <div className="p-5 space-y-4" onPaste={onPasteFile}>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          className={
            'rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors ' +
            (dragOver
              ? 'border-emerald-500 bg-emerald-500/5'
              : 'border-[#1f1f1f] bg-[#0f0f0f] hover:border-emerald-500/40')
          }
        >
          {extract.isPending ? (
            <>
              <Loader2 size={28} className="mx-auto text-emerald-400 animate-spin" />
              <div className="text-[13px] text-slate-200 mt-3">Extracting fields with Gemini…</div>
              <div className="text-[11px] text-slate-500 mt-1">This usually takes 3-8 seconds for a PDF.</div>
            </>
          ) : (
            <>
              <UploadCloud size={28} className="mx-auto text-slate-400" />
              <div className="text-[13px] text-slate-200 mt-3 font-medium">Drop a PDF or image here</div>
              <div className="text-[11px] text-slate-500 mt-1">
                or click to pick a file · or paste an image from the clipboard
              </div>
              <div className="inline-flex items-center gap-1.5 mt-4 text-[11px] text-emerald-400">
                <Sparkles size={11} /> Powered by Gemini
              </div>
            </>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/*"
          hidden
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />

        {error && (
          <div className="rounded border border-red-500/40 bg-red-500/5 p-3 text-[12.5px] text-red-300 flex items-start gap-2">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <div>{error}</div>
          </div>
        )}

        <div className="rounded border border-[#1f1f1f] bg-[#0f0f0f] p-3 text-[11.5px] text-slate-400 flex items-start gap-2">
          <FileText size={14} className="shrink-0 text-slate-500 mt-0.5" />
          <div>
            After extraction you'll review the fields in the next step and pick which
            invoice (if any) this payment settles. Nothing is saved until you confirm.
          </div>
        </div>
      </div>
    </Drawer>
  );
};
