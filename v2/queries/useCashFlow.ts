// Cash Flow source-of-truth hook.
//
// Aggregates every cash-affecting record into a flat CashFlowRow array
// so the UI just has to bucket by month and filter — no source-specific
// branching in the view layer. Combines:
//
//   1. ACTUALS — public.transactions rows whose txnDate has already
//      passed (or is today). Each row is one realised cash event.
//   2. PROJECTED AR — open ar_invoice_balances rows (balance > 0).
//      Projected payment date = invoiceDate + paymentTerms days from
//      the corresponding `invoices` row. Defaults to 30 days when the
//      terms field is unparseable.
//   3. PROJECTED AP — open ap_supplier_invoice_balances rows. Same
//      projection but from `invoices_suppliers.paymentTerms`.
//   4. PROJECTED EXPENSES — public.expenses where paymentStatus is
//      NOT PAID. Projected at expenseDate + 30 days (no per-row terms
//      column — most expenses are short-cycle).
//   5. PIPELINE (toggle) — approved sales_orders + approved
//      purchase_orders that haven't been invoiced yet. Projected at
//      orderDate + 60 days as a rough "expected to settle" anchor.
//      Off by default; the UI flips it on via `includePipeline`.
//
// Currency policy (v1): we default to USD-only — non-USD rows are
// passed through with their original currency value so a future
// multi-currency tab can filter on it, but the UI's running balance
// math should pick a single currency. Mixing currencies in one
// total would be wrong.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';
import { parseTermsDays as sharedParseTermsDays } from '../lib/paymentTerms';

export type CashFlowKind = 'ACTUAL' | 'PROJECTED';
export type CashFlowDirection = 'IN' | 'OUT';
export type CashFlowSource = 'TRANSACTION' | 'AR' | 'AP' | 'EXPENSE' | 'SO' | 'PO';

export interface CashFlowRow {
    id: string;          // unique per source; "<source>:<sourceId>"
    sourceId: string;    // the underlying record's id
    date: string;        // ISO YYYY-MM-DD — txnDate (actuals) or projected
    kind: CashFlowKind;
    direction: CashFlowDirection;
    source: CashFlowSource;
    amount: number;      // always positive; direction tells you the sign
    currency: string;
    /** Customer (AR/SO) or supplier (AP/PO) or vendor (expense). */
    counterparty: string | null;
    /** Only set for expenses. Lets the UI filter by category cleanly. */
    category: string | null;
    /** Short label for tooltips — invoice #, expense vendor + date, etc. */
    label: string;
}

interface Options {
    /** Kept for backwards compatibility — Sales Orders + Purchase
     *  Orders are now ALWAYS included as their own dedicated cash-flow
     *  rows. The toggle is a no-op as of 2026-05-28. */
    includePipeline?: boolean;
}

// Re-export of the shared parser so the inline call sites below read
// cleanly. The shared module strips percentage tokens and recognises
// immediate-pay keywords — see v2/lib/paymentTerms.ts.
const parseTermsDays = (terms: string | null | undefined): number => sharedParseTermsDays(terms);

function addDays(iso: string, days: number): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
    return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

export function useCashFlow(_opts: Options = {}) {
    const { currentCompanyId } = useCompany();

    return useSupabaseQuery<CashFlowRow[]>(
        ['cashflow', currentCompanyId],
        async () => {
            const supabase = getSupabaseClient();
            const rows: CashFlowRow[] = [];

            // ── 1. ACTUALS from transactions ─────────────────────────
            // We want every realised event in the visible window. The
            // table's `kind` field is the source-of-truth for direction
            // (PAYMENT_IN/PAYMENT_OUT/RECEIPT/DEPOSIT/CREDIT). The
            // `status` field marks whether a row counts at all —
            // VOIDED rows represent reversed payments and MUST be
            // excluded, otherwise the cash-flow totals double-count
            // (the original payment + its later void both stay in
            // the table). We filter at the query level so the over-
            // counted rows never even reach the client.
            {
                let q = scopeByCompany(
                    supabase.from('transactions')
                        .select('id, txnDate, amount, kind, counterpartyName, currency, status')
                        .neq('status', 'VOIDED')
                        .order('txnDate', { ascending: false, nullsFirst: false })
                        .limit(2000),
                    currentCompanyId,
                );
                const { data, error } = await q;
                if (error) throw new Error(`transactions: ${error.message}`);
                for (const r of (data as Array<{
                    id: string; txnDate: string | null; amount: number | string | null;
                    kind: string | null; counterpartyName: string | null; currency: string | null;
                    status: string | null;
                }> ?? [])) {
                    if (!r.txnDate) continue;
                    const amt = Math.abs(Number(r.amount) || 0);
                    if (amt === 0) continue;
                    const k = String(r.kind ?? '').toUpperCase();
                    // The transactions.kind values in this schema are
                    // PAYMENT_IN / PAYMENT_OUT (verified 2026-05-28).
                    // Earlier hook assumed PAYMENT/RECEIPT — that
                    // categorised every customer payment as OUT.
                    const direction: CashFlowDirection =
                        k === 'PAYMENT_IN' || k === 'RECEIPT' || k === 'DEPOSIT' || k === 'CREDIT'
                            ? 'IN'
                            : 'OUT';
                    rows.push({
                        id: `TX:${r.id}`,
                        sourceId: r.id,
                        date: r.txnDate.slice(0, 10),
                        kind: 'ACTUAL',
                        direction,
                        source: 'TRANSACTION',
                        amount: amt,
                        currency: r.currency ?? 'USD',
                        counterparty: r.counterpartyName,
                        category: null,
                        label: `${k.toLowerCase()} ${r.counterpartyName ?? ''}`.trim(),
                    });
                }
            }

            // ── 2. PROJECTED AR ─────────────────────────────────────
            // Fetch open AR balances + the matching invoice's
            // paymentTerms so we can project the expected receipt
            // date. We over-fetch the join by querying invoices
            // separately and joining client-side — there's no FK
            // exposed via PostgREST between the view and the table.
            {
                let arQ = scopeByCompany(
                    supabase.from('ar_invoice_balances')
                        .select('invoiceId, invoiceDate, soldTo, balance, totalAmount')
                        .gt('balance', 0)
                        .limit(2000),
                    currentCompanyId,
                );
                const ar = await arQ;
                if (ar.error) throw new Error(`ar_invoice_balances: ${ar.error.message}`);
                const arBalances = (ar.data as Array<{
                    invoiceId: string; invoiceDate: string | null;
                    soldTo: string | null; balance: number | string | null;
                    totalAmount: number | string | null;
                }> ?? []);

                if (arBalances.length > 0) {
                    let invQ = scopeByCompany(
                        supabase.from('invoices')
                            .select('id, paymentTerms, currency')
                            .in('id', arBalances.map(r => r.invoiceId)),
                        currentCompanyId,
                    );
                    const inv = await invQ;
                    if (inv.error) throw new Error(`invoices: ${inv.error.message}`);
                    const termsById = new Map<string, { paymentTerms: string | null; currency: string | null }>();
                    for (const r of (inv.data as Array<{ id: string; paymentTerms: string | null; currency: string | null }> ?? [])) {
                        termsById.set(r.id, r);
                    }

                    for (const r of arBalances) {
                        const bal = Number(r.balance) || 0;
                        if (bal <= 0 || !r.invoiceDate) continue;
                        const meta = termsById.get(r.invoiceId);
                        const days = parseTermsDays(meta?.paymentTerms);
                        const projected = addDays(r.invoiceDate.slice(0, 10), days);
                        rows.push({
                            id: `AR:${r.invoiceId}`,
                            sourceId: r.invoiceId,
                            date: projected,
                            kind: 'PROJECTED',
                            direction: 'IN',
                            source: 'AR',
                            amount: bal,
                            currency: meta?.currency ?? 'USD',
                            counterparty: r.soldTo,
                            category: null,
                            label: `AR invoice ${r.invoiceId.slice(0, 12)}`,
                        });
                    }
                }
            }

            // ── 3. PROJECTED AP ─────────────────────────────────────
            // Same shape as AR but from ap_supplier_invoice_balances +
            // invoices_suppliers.paymentTerms.
            {
                let apQ = scopeByCompany(
                    supabase.from('ap_supplier_invoice_balances')
                        .select('supplierInvoiceId, invoiceDate, supplier, balance, totalAmount')
                        .gt('balance', 0)
                        .limit(2000),
                    currentCompanyId,
                );
                const ap = await apQ;
                if (ap.error) throw new Error(`ap_supplier_invoice_balances: ${ap.error.message}`);
                const apBalances = (ap.data as Array<{
                    supplierInvoiceId: string; invoiceDate: string | null;
                    supplier: string | null; balance: number | string | null;
                }> ?? []);

                if (apBalances.length > 0) {
                    let invQ = scopeByCompany(
                        supabase.from('invoices_suppliers')
                            .select('id, paymentTerms, currency')
                            .in('id', apBalances.map(r => r.supplierInvoiceId)),
                        currentCompanyId,
                    );
                    const inv = await invQ;
                    if (inv.error) throw new Error(`invoices_suppliers: ${inv.error.message}`);
                    const termsById = new Map<string, { paymentTerms: string | null; currency: string | null }>();
                    for (const r of (inv.data as Array<{ id: string; paymentTerms: string | null; currency: string | null }> ?? [])) {
                        termsById.set(r.id, r);
                    }

                    for (const r of apBalances) {
                        const bal = Number(r.balance) || 0;
                        if (bal <= 0 || !r.invoiceDate) continue;
                        const meta = termsById.get(r.supplierInvoiceId);
                        const days = parseTermsDays(meta?.paymentTerms);
                        const projected = addDays(r.invoiceDate.slice(0, 10), days);
                        rows.push({
                            id: `AP:${r.supplierInvoiceId}`,
                            sourceId: r.supplierInvoiceId,
                            date: projected,
                            kind: 'PROJECTED',
                            direction: 'OUT',
                            source: 'AP',
                            amount: bal,
                            currency: meta?.currency ?? 'USD',
                            counterparty: r.supplier,
                            category: null,
                            label: `AP bill ${r.supplierInvoiceId.slice(0, 12)}`,
                        });
                    }
                }
            }

            // ── 4. PROJECTED EXPENSES ───────────────────────────────
            // Unpaid expenses contribute one OUT row each, projected at
            // expenseDate + 30 days. PARTIAL counts the remaining
            // balance only — assuming the user records the partial via
            // ExpensePaymentDrawer which flips status to PARTIAL and
            // leaves the full `amount` field intact.
            {
                let q = scopeByCompany(
                    supabase.from('expenses')
                        .select('id, date, vendor, amount, currency, category, paymentStatus')
                        .neq('paymentStatus', 'PAID')
                        .limit(2000),
                    currentCompanyId,
                );
                const { data, error } = await q;
                if (error) throw new Error(`expenses: ${error.message}`);
                for (const r of (data as Array<{
                    id: string; date: string | null; vendor: string | null;
                    amount: number | string | null; currency: string | null;
                    category: string | null; paymentStatus: string | null;
                }> ?? [])) {
                    if (!r.date) continue;
                    const amt = Number(r.amount) || 0;
                    if (amt <= 0) continue;
                    rows.push({
                        id: `EX:${r.id}`,
                        sourceId: r.id,
                        date: addDays(r.date, 30),
                        kind: 'PROJECTED',
                        direction: 'OUT',
                        source: 'EXPENSE',
                        amount: amt,
                        currency: r.currency ?? 'USD',
                        counterparty: r.vendor,
                        category: r.category,
                        label: `Expense · ${r.vendor ?? r.id.slice(0, 8)}`,
                    });
                }
            }

            // ── 5. PIPELINE — sales orders + purchase orders ─────────
            // Goal: only count orders that haven't crossed into the
            // invoiced/shipped layer yet. Once an SO has an invoice
            // against it, the invoice itself (AR row above) already
            // accounts for that cash; counting the SO again would
            // double-book. Same logic for POs once goods are received.
            //
            // SO: exclude FULFILLED (invoiced), CANCELLED, REJECTED;
            //     additionally cross-check against invoices.soNumber so
            //     status drift doesn't double-count.
            // PO: exclude COMPLETED (received), CANCELLED, CLOSED.
            {
                // Active sales orders by status. Pull paymentTerms so
                // we can project the expected receipt date per-row
                // (was hardcoded at orderDate + 60 days — far too
                // pessimistic for short-cycle terms like CAD which
                // typically settle in ~30 days).
                let soQ = scopeByCompany(
                    supabase.from('sales_orders')
                        .select('id, orderNumber, orderDate, customerName, totalAmount, currency, status, paymentTerms')
                        .not('status', 'in', '("FULFILLED","CANCELLED","REJECTED","CLOSED")')
                        .limit(500),
                    currentCompanyId,
                );
                const so = await soQ;

                // Cross-check: find every SO that already has an
                // invoice. Belt-and-suspenders for status drift —
                // status can lag the actual invoicing event.
                let invoicedSet = new Set<string>();
                {
                    const invQ = supabase.from('invoices')
                        .select('soNumber')
                        .not('soNumber', 'is', null);
                    const inv = await invQ;
                    if (!inv.error) {
                        for (const r of (inv.data as Array<{ soNumber: string | null }> ?? [])) {
                            const sn = (r.soNumber ?? '').trim().toUpperCase();
                            if (sn) invoicedSet.add(sn);
                        }
                    }
                }

                if (!so.error) {
                    for (const r of (so.data as Array<{
                        id: string; orderNumber: string | null; orderDate: string | null;
                        customerName: string | null; totalAmount: number | string | null;
                        currency: string | null; status: string | null;
                        paymentTerms: string | null;
                    }> ?? [])) {
                        const amt = Number(r.totalAmount) || 0;
                        if (amt <= 0 || !r.orderDate) continue;
                        // Skip when this SO is already represented by an
                        // invoice — the invoice's AR balance is the
                        // canonical projected receipt.
                        const on = (r.orderNumber ?? '').trim().toUpperCase();
                        if (on && invoicedSet.has(on)) continue;
                        const days = parseTermsDays(r.paymentTerms);
                        rows.push({
                            id: `SO:${r.id}`,
                            sourceId: r.id,
                            date: addDays(r.orderDate.slice(0, 10), days),
                            kind: 'PROJECTED',
                            direction: 'IN',
                            source: 'SO',
                            amount: amt,
                            currency: r.currency ?? 'USD',
                            counterparty: r.customerName,
                            category: null,
                            label: `SO ${r.orderNumber ?? r.id.slice(0, 8)}`,
                        });
                    }
                }

                // Active purchase orders by status. Same per-row
                // payment-terms projection as SOs above.
                let poQ = scopeByCompany(
                    supabase.from('purchase_orders')
                        .select('id, orderDate, supplierName, totalAmount, currency, status, paymentTerms')
                        .not('status', 'in', '("COMPLETED","CANCELLED","CLOSED","RECEIVED")')
                        .limit(500),
                    currentCompanyId,
                );
                const po = await poQ;
                if (!po.error) {
                    for (const r of (po.data as Array<{
                        id: string; orderDate: string | null; supplierName: string | null;
                        totalAmount: number | string | null; currency: string | null;
                        status: string | null; paymentTerms: string | null;
                    }> ?? [])) {
                        const amt = Number(r.totalAmount) || 0;
                        if (amt <= 0 || !r.orderDate) continue;
                        const days = parseTermsDays(r.paymentTerms);
                        rows.push({
                            id: `PO:${r.id}`,
                            sourceId: r.id,
                            date: addDays(r.orderDate.slice(0, 10), days),
                            kind: 'PROJECTED',
                            direction: 'OUT',
                            source: 'PO',
                            amount: amt,
                            currency: r.currency ?? 'USD',
                            counterparty: r.supplierName,
                            category: null,
                            label: `PO ${r.id.slice(0, 12)}`,
                        });
                    }
                }
            }

            return rows;
        },
    );
}
