// Record a payment against an Expense row.
//
// Two paths into the same outcome:
//   1. Manual entry — user types paid date, amount, method, reference.
//   2. OCR receipt — user drops a payment confirmation PDF/image
//      directly onto the drop-zone inside this drawer; Gemini extracts
//      the amount + date + reference and pre-fills the form. The file's
//      data URL is saved to expenses.paymentReceiptUrl so the proof is
//      attached to the row for audit.
//
// On save:
//   - paymentStatus → 'PAID' when amount paid ≥ expense.amount, else
//     'PARTIAL'. UNPAID is impossible from this drawer.
//   - paidDate → user-entered date.
//   - paymentReceiptUrl → data URL of the uploaded receipt (if any).
//   - notes → existing notes + a single appended line summarising the
//     payment ("Paid 2026-05-28 · WIRE · ref 12345 — $200.00").
//
// The drawer is intentionally narrow in scope: ONE payment per
// invocation. Multi-payment / payment ledger flows belong in the
// supplier-invoice RecordPaymentDrawer; expenses are simpler (one
// charge, one payment, done).

import React, { useEffect, useRef, useState } from 'react';
import { Drawer, Input, FormField, Label, Button } from '../primitives';
import { useToast } from '../primitives/Toast';
import { useEntityUpdate } from '../queries/useEntityMutations';
import { useGeminiExtractTyped } from '../queries/useGeminiExtractTyped';
import { Loader2, Sparkles, Upload } from 'lucide-react';
import type { Expense, ExpensePaymentStatus } from '../../types';

const METHODS = ['CASH', 'CHECK', 'WIRE', 'CARD', 'ACH', 'OTHER'] as const;
type Method = typeof METHODS[number];

const fmtMoney = (n: number, ccy: string) => {
    try {
        return n.toLocaleString('en-US', {
            style: 'currency', currency: ccy,
            minimumFractionDigits: 2, maximumFractionDigits: 2,
        });
    } catch { return `${ccy} ${n.toFixed(2)}`; }
};

interface Props {
    expense: Expense | null;
    onOpenChange: (open: boolean) => void;
}

interface OcrDraft {
    amount: number;
    date: string;
    reference: string;
}

// The Gemini prompt + JSON normaliser used by the inline drop-zone.
// Kept at module scope so the extraction hook's React-Query key stays
// stable across renders (otherwise every keystroke in the form would
// create a fresh mutation).
const RECEIPT_PROMPT = [
    'Extract the following fields from this PAYMENT RECEIPT (a confirmation of a',
    'payment already made — bank receipt, wire confirmation, check stub, card slip).',
    'Return ONLY a JSON object with these keys (no markdown, no commentary):',
    '  amount     — total paid as a number (no currency symbol).',
    '  date       — ISO YYYY-MM-DD of the payment date.',
    '  reference  — check number, wire/ACH transaction id, or auth code.',
    'Missing fields: amount=0, date=today, reference="".',
].join('\n');

const normaliseReceipt = (raw: Record<string, unknown>): OcrDraft => {
    const num = (k: string) => {
        const v = raw[k];
        if (typeof v === 'number' && Number.isFinite(v)) return v;
        const n = parseFloat(String(v ?? ''));
        return Number.isFinite(n) ? n : 0;
    };
    const str = (k: string) => typeof raw[k] === 'string' ? (raw[k] as string) : '';
    return {
        amount: num('amount'),
        date: str('date') || new Date().toISOString().slice(0, 10),
        reference: str('reference'),
    };
};

const readAsDataUrl = (f: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error('read failed'));
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.readAsDataURL(f);
    });

export const ExpensePaymentDrawer: React.FC<Props> = ({ expense, onOpenChange }) => {
    const toast = useToast();
    const open = !!expense;

    const [paidDate, setPaidDate] = useState<string>(new Date().toISOString().slice(0, 10));
    const [paidAmount, setPaidAmount] = useState<number>(0);
    const [method, setMethod] = useState<Method>('CHECK');
    const [reference, setReference] = useState<string>('');
    const [receiptDataUrl, setReceiptDataUrl] = useState<string | null>(null);
    const [receiptLabel, setReceiptLabel] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Reset form whenever the drawer opens with a (possibly different)
    // expense. Default the paid amount to the full expense — partial
    // payments are the exception, not the rule.
    useEffect(() => {
        if (!expense) return;
        setPaidDate(new Date().toISOString().slice(0, 10));
        setPaidAmount(expense.amount);
        setMethod('CHECK');
        setReference('');
        setReceiptDataUrl(null);
        setReceiptLabel(null);
        extract.reset();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [expense?.id]);

    // Gemini extraction — bound once at module scope (prompt + normalize
    // are stable). Triggered by the drop-zone or the click-to-pick
    // input. On success we pre-fill the form fields below.
    const extract = useGeminiExtractTyped<OcrDraft>({
        prompt: RECEIPT_PROMPT,
        normalize: normaliseReceipt,
    });

    const runOcr = async (file: File) => {
        try {
            // Read the file into a data URL first so we have the receipt
            // attached even if the extraction itself fails — the user
            // can still record the payment manually with the file kept
            // as proof.
            const dataUrl = await readAsDataUrl(file);
            setReceiptDataUrl(dataUrl);
            setReceiptLabel(`${file.name} · ${Math.round(file.size / 1024)} KB`);
            const parsed = await extract.mutateAsync({ kind: 'file', file });
            if (parsed.amount > 0) setPaidAmount(parsed.amount);
            if (parsed.date)       setPaidDate(parsed.date);
            if (parsed.reference)  setReference(parsed.reference);
            toast.push({
                kind: 'success',
                title: 'Receipt extracted',
                description: parsed.amount > 0
                    ? `${fmtMoney(parsed.amount, expense?.currency ?? 'USD')} on ${parsed.date}`
                    : 'Review the form fields and confirm.',
            });
        } catch (err) {
            toast.push({
                kind: 'warning',
                title: 'OCR failed — receipt still attached',
                description: err instanceof Error ? err.message : String(err),
            });
        }
    };

    const onFilePick = (files: FileList | null) => {
        const f = files?.[0];
        if (!f) return;
        void runOcr(f);
    };

    const update = useEntityUpdate<{ id: string } & Record<string, unknown>>({
        table: 'expenses',
        listQueryKeys: ['expenses'],
    });

    const canSave = !!expense && paidAmount > 0 && !!paidDate && !update.isPending;

    const save = async () => {
        if (!expense) return;
        // Derive status from the entered amount. Within 1¢ of the
        // expense total counts as fully paid (avoid float-rounding
        // false-PARTIALs).
        const fullyPaid = paidAmount + 0.001 >= expense.amount;
        const nextStatus: ExpensePaymentStatus = fullyPaid ? 'PAID' : 'PARTIAL';

        // Append a single audit line to existing notes rather than
        // replacing — preserves the original AI-extraction commentary.
        const summary =
            `Paid ${paidDate} · ${method}` +
            (reference.trim() ? ` · ref ${reference.trim()}` : '') +
            ` — ${fmtMoney(paidAmount, expense.currency)}`;
        const nextNotes = expense.notes && expense.notes.trim()
            ? `${expense.notes.trim()}\n${summary}`
            : summary;

        update.mutate({
            id: expense.id,
            paymentStatus: nextStatus,
            paidDate,
            paymentReceiptUrl: receiptDataUrl ?? expense.paymentReceiptUrl ?? null,
            notes: nextNotes,
        }, {
            onSuccess: () => {
                toast.push({
                    kind: 'success',
                    title: fullyPaid ? 'Payment recorded' : 'Partial payment recorded',
                    description: `${expense.vendor} · ${fmtMoney(paidAmount, expense.currency)}`,
                });
                onOpenChange(false);
            },
            onError: (err: Error) => {
                toast.push({
                    kind: 'error',
                    title: 'Payment failed',
                    description: err.message,
                });
            },
        });
    };

    return (
        <>
            <Drawer
                open={open}
                onOpenChange={onOpenChange}
                title={expense ? `Pay · ${expense.vendor}` : 'Record payment'}
                description={expense
                    ? `${fmtMoney(expense.amount, expense.currency)} expense · status ${expense.paymentStatus}`
                    : ''}
                widthClass="w-[min(96vw,720px)]"
                footer={
                    <>
                        <Button
                            variant="secondary" size="sm"
                            onClick={() => onOpenChange(false)}
                            disabled={update.isPending}
                            className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
                        >Cancel</Button>
                        <Button
                            size="sm"
                            onClick={save}
                            disabled={!canSave}
                            loading={update.isPending}
                            className="ml-auto bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
                        >
                            {update.isPending ? 'Saving…' : 'Record payment'}
                        </Button>
                    </>
                }
            >
                {expense && (
                    <div className="space-y-4">
                        {/* Summary card — vendor + amount due + currency */}
                        <div
                            className="rounded-md border p-3 text-[12.5px]"
                            style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)' }}
                        >
                            <div className="flex items-center justify-between">
                                <span className="text-slate-400">Vendor</span>
                                <span className="text-slate-100 font-medium">{expense.vendor}</span>
                            </div>
                            <div className="flex items-center justify-between mt-1">
                                <span className="text-slate-400">Amount due</span>
                                <span className="text-slate-100 font-mono tabular-nums">
                                    {fmtMoney(expense.amount, expense.currency)}
                                </span>
                            </div>
                            <div className="flex items-center justify-between mt-1">
                                <span className="text-slate-400">Date</span>
                                <span className="text-slate-100 font-mono tabular-nums">{expense.date}</span>
                            </div>
                        </div>

                        {/* Inline drop-zone — user drops a PDF/image here
                            (or clicks to pick); Gemini extracts amount +
                            date + reference and pre-fills the fields
                            below. The file's data URL is captured even
                            if extraction fails, so the user can still
                            record the payment with the proof attached. */}
                        <div
                            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={e => {
                                e.preventDefault();
                                setDragOver(false);
                                onFilePick(e.dataTransfer.files);
                            }}
                            onClick={() => fileInputRef.current?.click()}
                            className={
                                'rounded-md border-2 border-dashed p-4 text-center cursor-pointer transition-colors ' +
                                (dragOver
                                    ? 'border-indigo-400/70 bg-indigo-500/10'
                                    : 'border-indigo-500/30 bg-indigo-500/5 hover:bg-indigo-500/10')
                            }
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="application/pdf,image/*"
                                className="hidden"
                                onChange={e => onFilePick(e.target.files)}
                            />
                            {extract.isPending ? (
                                <div className="flex items-center justify-center gap-2 text-[12.5px] text-indigo-200">
                                    <Loader2 size={14} className="animate-spin" />
                                    Extracting receipt fields…
                                </div>
                            ) : receiptDataUrl ? (
                                <div className="flex items-center justify-center gap-2 text-[12.5px] text-emerald-300">
                                    <Sparkles size={12} />
                                    {receiptLabel ?? 'Receipt attached'} · drop a different file to replace
                                </div>
                            ) : (
                                <div className="flex flex-col items-center gap-1 text-[12.5px] text-indigo-200">
                                    <div className="flex items-center gap-1.5">
                                        <Upload size={13} />
                                        <span className="font-medium">Drop a payment receipt here</span>
                                    </div>
                                    <span className="text-[11px] text-slate-500">
                                        PDF or image — Gemini extracts amount, date, reference
                                    </span>
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <FormField>
                                <Label className="text-[11px] text-slate-500 uppercase tracking-wider">Paid date</Label>
                                <Input
                                    type="date" value={paidDate}
                                    onChange={e => setPaidDate(e.target.value)}
                                    className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200"
                                />
                            </FormField>
                            <FormField>
                                <Label className="text-[11px] text-slate-500 uppercase tracking-wider">
                                    Amount paid ({expense.currency})
                                </Label>
                                <Input
                                    type="number" min={0} step={0.01} value={paidAmount}
                                    onChange={e => setPaidAmount(parseFloat(e.target.value) || 0)}
                                    className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono tabular-nums"
                                />
                            </FormField>
                            <FormField>
                                <Label className="text-[11px] text-slate-500 uppercase tracking-wider">Method</Label>
                                <select
                                    value={method}
                                    onChange={e => setMethod(e.target.value as Method)}
                                    className="h-8 text-[12.5px] bg-[#111111] border border-[#1f1f1f] text-slate-200 rounded-md px-2 w-full appearance-none"
                                >
                                    {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                                </select>
                            </FormField>
                            <FormField>
                                <Label className="text-[11px] text-slate-500 uppercase tracking-wider">Reference</Label>
                                <Input
                                    type="text" value={reference}
                                    onChange={e => setReference(e.target.value)}
                                    placeholder="Check #, wire ID, txn hash…"
                                    className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono"
                                />
                            </FormField>
                        </div>

                        {/* Receipt-attached state is shown inline inside
                            the drop-zone itself, so no separate badge
                            here. The Remove affordance is implicit:
                            drop a different file to replace, or clear
                            it via the Cancel button. */}

                        {paidAmount > 0 && paidAmount < expense.amount && (
                            <div
                                className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11.5px] text-amber-300"
                            >
                                Recording <span className="font-mono tabular-nums">{fmtMoney(paidAmount, expense.currency)}</span> of {fmtMoney(expense.amount, expense.currency)} — expense will be marked PARTIAL.
                            </div>
                        )}
                    </div>
                )}
            </Drawer>
        </>
    );
};
