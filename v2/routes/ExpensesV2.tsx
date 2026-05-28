// Phase — v2 Expenses (general operational expenses, distinct from
// supplier-invoice "bills"). Backed by public.expenses.
//
// Rendered as a tab inside PayablesV2. Self-contained: own list, own
// create/edit drawers via QuickCreateDrawer + useRowCrud (same pattern
// as InventoryV2), and an AI Upload button that hands off to
// AiUploadModal with an expense-extraction schema.
//
// Architectural note: this file deliberately doesn't try to share UI
// code with PayablesV2's supplier-invoice surface — the two entities
// have different field schemas, different column sets, different
// downstream flows (QB bills vs. plain expenses), and the v2 routes
// directory's convention is one entity per file.

import React, { useState } from 'react';
import { Sparkles, Wallet } from 'lucide-react';
import { Button, Badge } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { useRowCrud } from '../components/useRowCrud';
import { AiUploadModal } from '../components/AiUploadModal';
import { useEntityInsert } from '../queries/useEntityMutations';
import { useExpenses } from '../queries/useExpenses';
import { useCompany } from '../providers/CompanyProvider';
import { PdfViewerModal } from '../components/PdfViewerModal';
import { ExpensePaymentDrawer } from '../components/ExpensePaymentDrawer';
import { getSupabaseClient } from '../../services/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '../primitives/Toast';
import { formatDate as fmtDate } from '../lib/formatDate';
import type { Expense, ExpenseCategory, ExpensePaymentStatus } from '../../types';

// Currency formatter. Falls back to a plain "<code> 12.34" string when
// the browser can't resolve the currency (e.g., obscure code in test
// data) so the row never renders as "NaN" or throws.
const fmtMoney = (n: number, ccy: string) => {
    try {
        return n.toLocaleString('en-US', {
            style: 'currency', currency: ccy,
            minimumFractionDigits: 2, maximumFractionDigits: 2,
        });
    } catch { return `${ccy} ${n.toFixed(2)}`; }
};

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
    UTILITIES:   'Utilities',
    OFFICE:      'Office',
    FREIGHT:     'Freight',
    TRAVEL:      'Travel',
    FUEL:        'Fuel',
    COMMISSIONS: 'Commissions',
    OTHER:       'Other',
};

// Badge variants are constrained to the primitives' palette
// (neutral / success / info / warning / danger). UNPAID + PARTIAL map
// to warning (amber-ish), PAID to success (green).
const STATUS_TONE: Record<ExpensePaymentStatus, 'neutral' | 'warning' | 'success'> = {
    UNPAID:  'warning',
    PARTIAL: 'warning',
    PAID:    'success',
};

const columns: DataTableColumn<Expense>[] = [
    { id: 'date', header: 'Date', sortable: true,
      value: r => r.date,
      cell: r => <span className="font-mono tabular-nums text-[11px] text-slate-400">{fmtDate(r.date)}</span> },
    { id: 'vendor', header: 'Vendor', sortable: true, filterable: true,
      value: r => r.vendor,
      cell: r => <span className="text-slate-100 font-medium">{r.vendor || '—'}</span> },
    { id: 'category', header: 'Category', sortable: true, filterable: true,
      value: r => CATEGORY_LABELS[r.category] ?? r.category,
      cell: r => <span className="text-slate-400">{CATEGORY_LABELS[r.category] ?? r.category}</span> },
    { id: 'amount', header: 'Amount', align: 'right', mono: true, sortable: true,
      value: r => r.amount,
      cell: r => <span className="text-slate-100">{fmtMoney(r.amount, r.currency)}</span> },
    { id: 'status', header: 'Status', sortable: true, filterable: true,
      value: r => r.paymentStatus,
      cell: r => (
          <Badge variant={STATUS_TONE[r.paymentStatus] ?? 'neutral'}>
              {r.paymentStatus}
          </Badge>
      ) },
    { id: 'notes', header: 'Notes', sortable: false, filterable: true,
      value: r => r.notes ?? '',
      cell: r => <span className="text-slate-500 truncate max-w-[260px] inline-block align-middle">{r.notes ?? ''}</span> },
];

// Shared field schema for both create and edit (useRowCrud reuses this
// for its built-in edit drawer). Keep this in sync with the SQL columns
// in scripts/migration-add-expenses-table.sql.
const fields: FieldDef[] = [
    { key: 'paymentStatus', label: 'Payment status', type: 'select',
      fullWidth: true, defaultValue: 'UNPAID',
      options: [
          { value: 'UNPAID',  label: 'UNPAID'  },
          { value: 'PARTIAL', label: 'PARTIAL' },
          { value: 'PAID',    label: 'PAID'    },
      ] },
    { key: 'date',    label: 'Date',   type: 'date', required: true,
      defaultValue: new Date().toISOString().slice(0, 10) },
    { key: 'vendor',  label: 'Vendor', required: true, fullWidth: true,
      placeholder: 'Who was paid (free text)' },
    { key: 'amount',  label: 'Amount', type: 'number', mono: true,
      min: 0, step: 0.01, required: true },
    { key: 'currency', label: 'Currency', mono: true, defaultValue: 'USD' },
    { key: 'category', label: 'Category', type: 'select', required: true,
      defaultValue: 'OTHER',
      options: Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label })) },
    { key: 'paidDate', label: 'Paid date', type: 'date',
      placeholder: 'Only when status = PAID' },
    { key: 'notes',    label: 'Notes', type: 'textarea', fullWidth: true,
      placeholder: 'Internal notes — invoice ref, approver, reason…' },
    // attachmentUrl is set by the AI Upload flow (data URL of the OCR
    // source) and rendered as a "View receipt" link in a follow-up.
    // Hidden from the manual form to keep it simple.
];

// AI-upload extraction schema. The Gemini prompt asks for a tight JSON
// shape so the normalizer below can map straight into the Expense
// table without further coaxing. Category is the trickiest field —
// receipts rarely state it explicitly, so we let the model best-guess
// and the user corrects on the review screen.
interface ExpenseDraft {
    date: string;
    vendor: string;
    amount: number;
    currency: string;
    category: ExpenseCategory;
    notes: string;
    paymentStatus: ExpensePaymentStatus;
    attachmentUrl: string | null;
}

const emptyExpenseDraft = (): ExpenseDraft => ({
    date: new Date().toISOString().slice(0, 10),
    vendor: '',
    amount: 0,
    currency: 'USD',
    category: 'OTHER',
    notes: '',
    paymentStatus: 'UNPAID',
    attachmentUrl: null,
});

interface ExpensesV2Props {
    /** Tab pills (Supplier Bills / Expenses) owned by PayablesV2. When
     *  present, rendered at the start of the header action row so they
     *  sit vertically aligned with the + New / AI Upload buttons. */
    tabPills?: React.ReactNode;
}

const ExpensesV2: React.FC<ExpensesV2Props> = ({ tabPills }) => {
    const { currentCompanyId } = useCompany();
    const toast = useToast();
    const qc = useQueryClient();
    const [search, setSearch] = useState('');
    const [createOpen, setCreateOpen] = useState(false);
    const [aiUploadOpen, setAiUploadOpen] = useState(false);
    // Row whose stored receipt PDF is open in the viewer. Wired through
    // useRowCrud's onView so the eye icon opens the PDF (or the
    // inspect drawer as a fallback when the row has no attachment).
    const [viewOriginalRow, setViewOriginalRow] = useState<Expense | null>(null);
    // Row whose Pay drawer is open. The drawer reads the row's
    // amount/currency/notes and lets the user record a payment.
    const [payRow, setPayRow] = useState<Expense | null>(null);
    const exp = useExpenses(search);

    const total = (exp.data ?? []).reduce((s, r) => s + r.amount, 0);

    const insert = useEntityInsert<Record<string, unknown>>({
        table: 'expenses',
        listQueryKeys: ['expenses'],
        idPrefix: 'EXP',
    });

    // Tailwind class for the green eye icon when a row has an
    // OCR-source PDF stored. Mirrors the standard `iconBtn` shape used
    // by RowActions but swaps the neutral grey for emerald so the
    // attached-receipt state is glanceable.
    const EYE_GREEN_CLASS =
        'p-1 rounded-sm text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 ' +
        'transition-colors disabled:opacity-40 disabled:cursor-not-allowed outline-none ' +
        'focus-visible:ring-1 focus-visible:ring-emerald-500';

    const { rowActions: crudActions, drawers } = useRowCrud<Expense>({
        table: 'expenses',
        listQueryKeys: ['expenses'],
        rowLabel: r => `${r.vendor} · ${fmtDate(r.date)}`,
        fields,
        // When the row has a stored receipt, View opens the PDF.
        // Otherwise it falls back to the default inspect drawer so
        // the user can still see the row's fields.
        onView: (row, openDrawer) => {
            if (row.attachmentUrl) setViewOriginalRow(row);
            else openDrawer();
        },
        viewToneByRow: r => r.attachmentUrl ? EYE_GREEN_CLASS : undefined,
        viewTitleByRow: r => r.attachmentUrl ? 'View receipt PDF' : 'View',
    });

    // Compose: prepend a Pay button on unpaid/partial rows, then the
    // standard View/Edit/Delete cluster. Mirrors PayablesV2's Pay
    // placement so the action lives in a consistent spot across both
    // tabs.
    const rowActions = React.useCallback((r: Expense) => {
        const showPay = r.paymentStatus !== 'PAID';
        return (
            <div className="flex items-center gap-1 justify-end">
                {showPay && (
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setPayRow(r); }}
                        title="Record payment"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                    >
                        <Wallet size={10} /> Pay
                    </button>
                )}
                {crudActions(r)}
            </div>
        );
    }, [crudActions]);

    const openCreate = () => setCreateOpen(true);

    return (
        <>
            <ListPage<Expense>
                title="Expenses"
                subtitle={
                    exp.data
                        ? `${exp.data.length} expense${exp.data.length === 1 ? '' : 's'}` +
                          (total > 0 ? ` · ${fmtMoney(total, 'USD')}` : '') +
                          (search ? ` · "${search}"` : '')
                        : 'Loading…'
                }
                search={search}
                setSearch={setSearch}
                searchPlaceholder="Vendor or notes"
                cardTitle="Operational expenses"
                columns={columns}
                getRowId={r => r.id}
                data={exp.data}
                isLoading={exp.isLoading}
                error={exp.error}
                onRetry={exp.refetch}
                onRowClick={(row) => {
                    // Same gating as the eye icon: row-click opens the
                    // PDF when present, otherwise the inspect drawer.
                    if (row.attachmentUrl) setViewOriginalRow(row);
                    // No drawer-only branch needed — clicking outside
                    // the actions column is non-fatal when nothing
                    // happens, and useRowCrud doesn't expose its
                    // openView helper without the eye-icon path.
                }}
                rowActions={rowActions}
                headerAction={
                    <div className="flex items-center gap-2">
                        {tabPills && (
                            <>
                                {tabPills}
                                <span className="w-px h-5 mx-1" style={{ background: 'var(--b-line)' }} />
                            </>
                        )}
                        <Button size="sm" onClick={openCreate}
                            className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
                            + New expense
                        </Button>
                        <Button size="sm" onClick={() => setAiUploadOpen(true)}
                            className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/40 text-indigo-200 hover:from-indigo-500/30 hover:to-purple-500/30 h-7 px-2.5 text-[12px] font-medium rounded-md inline-flex items-center gap-1.5">
                            <Sparkles size={12} />
                            AI Upload Expense
                        </Button>
                    </div>
                }
                emptyAction={search ? undefined : { label: '+ New expense', onClick: openCreate }}
                skeletonCols={[100, 200, 100, 100, 80, 220]}
            />

            <QuickCreateDrawer
                open={createOpen}
                onOpenChange={setCreateOpen}
                title="New expense"
                description="Log an operational expense — utility bill, fuel, broker fee, etc."
                table="expenses"
                idPrefix="EXP"
                listQueryKeys={['expenses']}
                scopeByCompany
                fields={fields}
            />

            {drawers}

            {/* Pay drawer — record a payment manually or via OCR.
                Updates the row's paymentStatus, paidDate, optional
                paymentReceiptUrl, and appends a one-line summary to
                notes. Single payment per invocation; multi-payment
                ledgering lives in the supplier-invoice flow. */}
            <ExpensePaymentDrawer
                expense={payRow}
                onOpenChange={(v) => { if (!v) setPayRow(null); }}
            />

            {/* Receipt PDF viewer — opens the OCR-source document
                attached to the row. PdfViewerModal handles the
                empty-state file picker for legacy rows without an
                attachment; the picked file's data URL is written back
                to expenses.attachmentUrl so the eye icon will glow
                green next time. */}
            <PdfViewerModal
                open={!!viewOriginalRow}
                onOpenChange={(v) => { if (!v) setViewOriginalRow(null); }}
                dataUrl={viewOriginalRow?.attachmentUrl ?? null}
                title={viewOriginalRow ? `Expense receipt · ${viewOriginalRow.vendor}` : ''}
                onUpload={async (dataUrl) => {
                    if (!viewOriginalRow) return;
                    try {
                        const supabase = getSupabaseClient();
                        const { error } = await supabase
                            .from('expenses')
                            .update({ attachmentUrl: dataUrl })
                            .eq('id', viewOriginalRow.id);
                        if (error) throw new Error(error.message);
                        // Optimistic local update so the modal can
                        // render the file immediately without waiting
                        // for the list to refetch.
                        setViewOriginalRow({ ...viewOriginalRow, attachmentUrl: dataUrl });
                        void qc.invalidateQueries({ queryKey: ['expenses'] });
                        toast.push({
                            kind: 'success',
                            title: 'Receipt attached',
                            description: viewOriginalRow.vendor,
                        });
                    } catch (err) {
                        toast.push({
                            kind: 'error',
                            title: 'Upload failed',
                            description: err instanceof Error ? err.message : String(err),
                        });
                    }
                }}
            />

            {aiUploadOpen && (
                <AiUploadModal<ExpenseDraft>
                    open={aiUploadOpen}
                    onOpenChange={setAiUploadOpen}
                    config={{
                        title: 'AI Upload Expense',
                        description: 'Upload a receipt or invoice — Gemini extracts the fields.',
                        emptyDraft: emptyExpenseDraft,
                        fromExtracted: (parsed, originalDocument) => ({
                            ...emptyExpenseDraft(),
                            ...parsed,
                            // Persist the original receipt so the row can show
                            // "View receipt". null when input was pasted text.
                            attachmentUrl: originalDocument ?? null,
                        }),
                        extractSpec: {
                            // Tight JSON contract — keep fields minimal so the
                            // model doesn't hallucinate. Category is best-guess
                            // and the user corrects on review.
                            prompt: [
                                'Extract the following fields from this receipt or invoice.',
                                'Return ONLY a JSON object with these keys (no markdown, no commentary):',
                                '  date          — ISO YYYY-MM-DD of the receipt date.',
                                '  vendor        — the merchant/supplier name.',
                                '  amount        — total amount as a number (no currency symbol).',
                                '  currency      — 3-letter ISO code (USD, EUR, BRL, ...). Default USD if unclear.',
                                '  category      — one of: UTILITIES, OFFICE, FREIGHT, TRAVEL, FUEL, COMMISSIONS, OTHER.',
                                '                  Best-guess based on the vendor and line items.',
                                '  notes         — short summary of what was purchased; empty string if none.',
                                'If a field is missing or unreadable, return sensible defaults: amount=0,',
                                'date=today, currency=USD, category=OTHER, vendor and notes as empty strings.',
                            ].join('\n'),
                            normalize: (raw: unknown) => {
                                const r = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
                                const str = (k: string) => typeof r[k] === 'string' ? (r[k] as string) : '';
                                const num = (k: string) => {
                                    const v = r[k];
                                    if (typeof v === 'number' && Number.isFinite(v)) return v;
                                    const n = parseFloat(String(v ?? ''));
                                    return Number.isFinite(n) ? n : 0;
                                };
                                const rawCat = String(r.category ?? '').trim().toUpperCase();
                                const cat: ExpenseCategory = (['UTILITIES','OFFICE','FREIGHT','TRAVEL','FUEL','COMMISSIONS','OTHER'] as const)
                                    .includes(rawCat as ExpenseCategory)
                                    ? rawCat as ExpenseCategory
                                    : 'OTHER';
                                return {
                                    date: str('date') || new Date().toISOString().slice(0, 10),
                                    vendor: str('vendor'),
                                    amount: num('amount'),
                                    currency: (str('currency') || 'USD').toUpperCase(),
                                    category: cat,
                                    notes: str('notes'),
                                    paymentStatus: 'UNPAID' as ExpensePaymentStatus,
                                    attachmentUrl: null,
                                };
                            },
                        },
                        validate: (d) => {
                            if (!d.vendor.trim()) return 'Vendor is required.';
                            if (!d.date)         return 'Date is required.';
                            if (!(d.amount > 0)) return 'Amount must be greater than zero.';
                            return null;
                        },
                        extractSummary: (d) =>
                            d.vendor && d.amount
                                ? `${d.vendor} · ${fmtMoney(d.amount, d.currency)} · ${CATEGORY_LABELS[d.category]}`
                                : null,
                        renderReview: (d, setDraft) => (
                            <div className="grid grid-cols-2 gap-3">
                                <label className="flex flex-col gap-1">
                                    <span className="text-[11px] text-slate-500 uppercase">Date</span>
                                    <input type="date" value={d.date}
                                        onChange={e => setDraft(s => ({ ...s, date: e.target.value }))}
                                        className="h-8 bg-[#111111] border border-[#1f1f1f] rounded-md px-2 text-[12.5px] text-slate-200" />
                                </label>
                                <label className="flex flex-col gap-1">
                                    <span className="text-[11px] text-slate-500 uppercase">Category</span>
                                    <select value={d.category}
                                        onChange={e => setDraft(s => ({ ...s, category: e.target.value as ExpenseCategory }))}
                                        className="h-8 bg-[#111111] border border-[#1f1f1f] rounded-md px-2 text-[12.5px] text-slate-200">
                                        {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
                                            <option key={v} value={v}>{l}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="flex flex-col gap-1 col-span-2">
                                    <span className="text-[11px] text-slate-500 uppercase">Vendor</span>
                                    <input type="text" value={d.vendor}
                                        onChange={e => setDraft(s => ({ ...s, vendor: e.target.value }))}
                                        className="h-8 bg-[#111111] border border-[#1f1f1f] rounded-md px-2 text-[12.5px] text-slate-200" />
                                </label>
                                <label className="flex flex-col gap-1">
                                    <span className="text-[11px] text-slate-500 uppercase">Amount</span>
                                    <input type="number" min={0} step={0.01} value={d.amount}
                                        onChange={e => setDraft(s => ({ ...s, amount: parseFloat(e.target.value) || 0 }))}
                                        className="h-8 bg-[#111111] border border-[#1f1f1f] rounded-md px-2 text-[12.5px] text-slate-200 font-mono tabular-nums" />
                                </label>
                                <label className="flex flex-col gap-1">
                                    <span className="text-[11px] text-slate-500 uppercase">Currency</span>
                                    <input type="text" value={d.currency} maxLength={3}
                                        onChange={e => setDraft(s => ({ ...s, currency: e.target.value.toUpperCase() }))}
                                        className="h-8 bg-[#111111] border border-[#1f1f1f] rounded-md px-2 text-[12.5px] text-slate-200 font-mono uppercase" />
                                </label>
                                <label className="flex flex-col gap-1 col-span-2">
                                    <span className="text-[11px] text-slate-500 uppercase">Notes</span>
                                    <textarea rows={2} value={d.notes}
                                        onChange={e => setDraft(s => ({ ...s, notes: e.target.value }))}
                                        className="bg-[#111111] border border-[#1f1f1f] rounded-md px-2 py-1.5 text-[12.5px] text-slate-200 resize-y" />
                                </label>
                            </div>
                        ),
                        save: async (d) => {
                            // Hand off to useEntityInsert. companyId scoping
                            // and ID generation happen inside the mutation.
                            await new Promise<void>((resolve, reject) => {
                                insert.mutate({
                                    companyId: currentCompanyId === 'ALL' ? null : currentCompanyId,
                                    date: d.date,
                                    vendor: d.vendor.trim(),
                                    amount: d.amount,
                                    currency: d.currency,
                                    category: d.category,
                                    notes: d.notes.trim() || null,
                                    paymentStatus: d.paymentStatus,
                                    attachmentUrl: d.attachmentUrl,
                                } as Record<string, unknown>, {
                                    onSuccess: () => resolve(),
                                    onError: (err: Error) => reject(err),
                                });
                            });
                        },
                    }}
                />
            )}
        </>
    );
};

export default ExpensesV2;
