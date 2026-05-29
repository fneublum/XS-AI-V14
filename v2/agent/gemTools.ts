// Tool definitions for GEM — the in-browser GENRYO chat assistant.
//
// Background:
//   Before this module, Gem only had its system prompt — so questions
//   like "list all sales invoices" got navigation hints ("go to
//   Accounts Receivable → Invoices") rather than actual data. Gemini's
//   function-calling lets Gem reach into Supabase via the user's
//   already-authenticated client and answer with real numbers.
//
// Architecture:
//   - GEM_TOOLS: FunctionDeclaration[] passed in the Gemini request
//     config.tools. Gemini sees the names + parameter schemas and picks
//     which to call.
//   - executeTool(name, args, companyId): bridges a single tool call to
//     a Supabase query, returning a JSON-serialisable object Gemini
//     can fold into its final answer.
//   - Each executor:
//       1. Scopes the query to the calling company (GENRYO) when the
//          companyId is real (not 'ALL') — same convention as the
//          query hooks.
//       2. Sorts by date desc, caps to a sensible limit (200 max).
//       3. Returns a compact shape — only the fields a person would
//          want in a chat reply, not the full row.
//   - The caller (DashboardV2) runs a tool-loop: while Gemini returns
//     functionCalls, execute them, feed the responses back, recall.
//     Two rounds is usually plenty — the model decides on its own when
//     it has enough info to answer.
//
// Naming convention:
//   - query_* tools return rows
//   - sum_*   tools return aggregates
//   The split helps Gemini pick the right shape ("show me X" vs
//   "how much X"); a single mega-tool returning both would confuse the
//   model and bloat its response with unused fields.

import { getSupabaseClient } from '../../services/supabase';
import { Type, type FunctionDeclaration } from '../../services/geminiClient';

// ─── tool schemas ────────────────────────────────────────────────────

const dateFilterProps = {
    dateFrom: { type: Type.STRING, description: 'ISO date YYYY-MM-DD lower bound (inclusive). Optional.' },
    dateTo:   { type: Type.STRING, description: 'ISO date YYYY-MM-DD upper bound (inclusive). Optional.' },
} as const;

export const GEM_TOOLS: FunctionDeclaration[] = [
    {
        name: 'query_invoices',
        description:
            'List sales (AR) or supplier (AP) invoices for the current company. Use when the user asks ' +
            'to "list", "show", or "find" invoices, bills, payables, or receivables.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                kind: {
                    type: Type.STRING,
                    description:
                        'AR = sales invoices you billed to customers. ' +
                        'AP = supplier invoices billed to you.',
                    enum: ['AR', 'AP'],
                },
                openOnly: {
                    type: Type.BOOLEAN,
                    description: 'When true, only return invoices with an outstanding balance > 0.',
                },
                counterparty: {
                    type: Type.STRING,
                    description: 'Partial customer/supplier name match (case-insensitive). Optional.',
                },
                ...dateFilterProps,
                limit: {
                    type: Type.INTEGER,
                    description: 'Max rows to return. Defaults to 50, hard max 200.',
                },
            },
            required: ['kind'],
        },
    },
    {
        name: 'sum_invoices',
        description:
            'Return the total balance or total amount for AR or AP invoices matching the filters. ' +
            'Use when the user asks "how much", "total", "sum", or "outstanding".',
        parameters: {
            type: Type.OBJECT,
            properties: {
                kind: { type: Type.STRING, enum: ['AR', 'AP'] },
                openOnly: { type: Type.BOOLEAN, description: 'Default true — sum unpaid balances.' },
                counterparty: { type: Type.STRING },
                ...dateFilterProps,
            },
            required: ['kind'],
        },
    },
    {
        name: 'query_purchase_orders',
        description:
            'List purchase orders for the current company. Use for "list POs", "purchase orders", ' +
            '"orders to suppliers".',
        parameters: {
            type: Type.OBJECT,
            properties: {
                status: {
                    type: Type.STRING,
                    description: 'Exact status to filter by (PENDING, APPROVED, OPEN, RECEIVED, COMPLETED, CANCELLED).',
                },
                supplier: { type: Type.STRING, description: 'Partial supplier name match.' },
                ...dateFilterProps,
                limit: { type: Type.INTEGER },
            },
        },
    },
    {
        name: 'query_sales_orders',
        description:
            'List sales orders for the current company. Use for "list SOs", "sales orders", ' +
            '"orders from customers".',
        parameters: {
            type: Type.OBJECT,
            properties: {
                status: {
                    type: Type.STRING,
                    description: 'Exact status to filter by (PENDING, APPROVED, FULFILLED, CANCELLED).',
                },
                customer: { type: Type.STRING, description: 'Partial customer name match.' },
                ...dateFilterProps,
                limit: { type: Type.INTEGER },
            },
        },
    },
    {
        name: 'query_expenses',
        description:
            'List expenses for the current company. Use for "list expenses", "show OpEx", ' +
            '"unpaid bills".',
        parameters: {
            type: Type.OBJECT,
            properties: {
                category: { type: Type.STRING, description: 'Exact category filter (FREIGHT, COMMISSIONS, ...).' },
                paymentStatus: {
                    type: Type.STRING,
                    description: 'UNPAID / PARTIAL / PAID. Omit to include all.',
                    enum: ['UNPAID', 'PARTIAL', 'PAID'],
                },
                vendor: { type: Type.STRING, description: 'Partial vendor name match.' },
                ...dateFilterProps,
                limit: { type: Type.INTEGER },
            },
        },
    },
    {
        name: 'sum_expenses',
        description:
            'Sum expenses matching filters. Use for "how much did we spend on X", "total expenses".',
        parameters: {
            type: Type.OBJECT,
            properties: {
                category: { type: Type.STRING },
                paymentStatus: { type: Type.STRING, enum: ['UNPAID', 'PARTIAL', 'PAID'] },
                vendor: { type: Type.STRING },
                ...dateFilterProps,
            },
        },
    },
    {
        name: 'get_cash_position',
        description:
            'Snapshot of the current cash position: open AR (to receive), open AP (to pay), ' +
            'unpaid expenses, and net (AR − AP − unpaid expenses). Use for "cash flow", ' +
            '"how much cash do we have", "are we positive".',
        parameters: { type: Type.OBJECT, properties: {} },
    },
];

// ─── executors ───────────────────────────────────────────────────────

type Args = Record<string, unknown>;

const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined;
const bool = (v: unknown): boolean | undefined =>
    typeof v === 'boolean' ? v : undefined;
const int = (v: unknown, fallback: number, max: number): number => {
    const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(n, max);
};

// Scope helper — same convention as the query hooks. 'ALL' = system
// view, no companyId filter applied.
function scope<Q extends { eq: Function }>(q: Q, companyId: string): Q {
    return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

// Mild plain-language sorter so the JSON Gem sees stays compact.
const fmtMoney = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

async function queryInvoices(args: Args, companyId: string) {
    const sb = getSupabaseClient();
    const kind = str(args.kind) === 'AP' ? 'AP' : 'AR';
    const openOnly = bool(args.openOnly) ?? false;
    const counterparty = str(args.counterparty);
    const dateFrom = str(args.dateFrom);
    const dateTo   = str(args.dateTo);
    const limit    = int(args.limit, 50, 200);

    if (kind === 'AR') {
        // AR uses the ar_invoice_balances view (balance is the
        // canonical "still owed" number) joined to invoices for the
        // human-friendly fields.
        let q = scope(
            sb.from('ar_invoice_balances')
              .select('invoiceId, invoiceDate, soldTo, balance, totalAmount')
              .order('invoiceDate', { ascending: false, nullsFirst: false })
              .limit(limit),
            companyId,
        );
        if (openOnly) q = q.gt('balance', 0) as typeof q;
        if (counterparty) q = q.ilike('soldTo', `%${counterparty}%`) as typeof q;
        if (dateFrom) q = q.gte('invoiceDate', dateFrom) as typeof q;
        if (dateTo)   q = q.lte('invoiceDate', dateTo)   as typeof q;
        const { data, error } = await q;
        if (error) return { error: error.message };
        return {
            kind: 'AR',
            count: (data ?? []).length,
            rows: (data ?? []).map((r: any) => ({
                id: r.invoiceId,
                date: r.invoiceDate,
                customer: r.soldTo,
                total: fmtMoney(r.totalAmount),
                balance: fmtMoney(r.balance),
            })),
        };
    }

    // AP — supplier invoices.
    let q = scope(
        sb.from('ap_supplier_invoice_balances')
          .select('supplierInvoiceId, invoiceDate, supplier, balance, totalAmount')
          .order('invoiceDate', { ascending: false, nullsFirst: false })
          .limit(limit),
        companyId,
    );
    if (openOnly) q = q.gt('balance', 0) as typeof q;
    if (counterparty) q = q.ilike('supplier', `%${counterparty}%`) as typeof q;
    if (dateFrom) q = q.gte('invoiceDate', dateFrom) as typeof q;
    if (dateTo)   q = q.lte('invoiceDate', dateTo)   as typeof q;
    const { data, error } = await q;
    if (error) return { error: error.message };
    return {
        kind: 'AP',
        count: (data ?? []).length,
        rows: (data ?? []).map((r: any) => ({
            id: r.supplierInvoiceId,
            date: r.invoiceDate,
            supplier: r.supplier,
            total: fmtMoney(r.totalAmount),
            balance: fmtMoney(r.balance),
        })),
    };
}

async function sumInvoices(args: Args, companyId: string) {
    // Default openOnly=true — when somebody asks "how much do we
    // owe / are owed", they almost always mean outstanding balances.
    const result = await queryInvoices(
        { ...args, openOnly: args.openOnly ?? true, limit: 200 },
        companyId,
    );
    if ('error' in result) return result;
    const sum = result.rows.reduce((acc, r) => acc + r.balance, 0);
    const total = result.rows.reduce((acc, r) => acc + r.total, 0);
    return {
        kind: result.kind,
        count: result.count,
        sumBalance: fmtMoney(sum),
        sumTotal:   fmtMoney(total),
        sampledRows: result.rows.slice(0, 5),  // breadcrumbs for the model
    };
}

async function queryPurchaseOrders(args: Args, companyId: string) {
    const sb = getSupabaseClient();
    const status = str(args.status);
    const supplier = str(args.supplier);
    const dateFrom = str(args.dateFrom);
    const dateTo   = str(args.dateTo);
    const limit    = int(args.limit, 50, 200);

    let q = scope(
        sb.from('purchase_orders')
          .select('id, orderDate, supplierName, status, totalAmount, currency, paymentTerms')
          .order('orderDate', { ascending: false, nullsFirst: false })
          .limit(limit),
        companyId,
    );
    if (status)   q = q.eq('status', status) as typeof q;
    if (supplier) q = q.ilike('supplierName', `%${supplier}%`) as typeof q;
    if (dateFrom) q = q.gte('orderDate', dateFrom) as typeof q;
    if (dateTo)   q = q.lte('orderDate', dateTo)   as typeof q;
    const { data, error } = await q;
    if (error) return { error: error.message };
    return {
        count: (data ?? []).length,
        rows: (data ?? []).map((r: any) => ({
            id: r.id,
            date: r.orderDate,
            supplier: r.supplierName,
            status: r.status,
            total: fmtMoney(r.totalAmount),
            currency: r.currency,
            terms: r.paymentTerms,
        })),
    };
}

async function querySalesOrders(args: Args, companyId: string) {
    const sb = getSupabaseClient();
    const status = str(args.status);
    const customer = str(args.customer);
    const dateFrom = str(args.dateFrom);
    const dateTo   = str(args.dateTo);
    const limit    = int(args.limit, 50, 200);

    let q = scope(
        sb.from('sales_orders')
          .select('id, orderNumber, orderDate, customerName, status, totalAmount, currency, paymentTerms')
          .order('orderDate', { ascending: false, nullsFirst: false })
          .limit(limit),
        companyId,
    );
    if (status)   q = q.eq('status', status) as typeof q;
    if (customer) q = q.ilike('customerName', `%${customer}%`) as typeof q;
    if (dateFrom) q = q.gte('orderDate', dateFrom) as typeof q;
    if (dateTo)   q = q.lte('orderDate', dateTo)   as typeof q;
    const { data, error } = await q;
    if (error) return { error: error.message };
    return {
        count: (data ?? []).length,
        rows: (data ?? []).map((r: any) => ({
            id: r.orderNumber ?? r.id,
            date: r.orderDate,
            customer: r.customerName,
            status: r.status,
            total: fmtMoney(r.totalAmount),
            currency: r.currency,
            terms: r.paymentTerms,
        })),
    };
}

async function queryExpenses(args: Args, companyId: string) {
    const sb = getSupabaseClient();
    const category = str(args.category);
    const status = str(args.paymentStatus);
    const vendor = str(args.vendor);
    const dateFrom = str(args.dateFrom);
    const dateTo   = str(args.dateTo);
    const limit    = int(args.limit, 50, 200);

    let q = scope(
        sb.from('expenses')
          .select('id, date, vendor, category, amount, currency, paymentStatus, notes')
          .order('date', { ascending: false, nullsFirst: false })
          .limit(limit),
        companyId,
    );
    if (category) q = q.eq('category', category) as typeof q;
    if (status)   q = q.eq('paymentStatus', status) as typeof q;
    if (vendor)   q = q.ilike('vendor', `%${vendor}%`) as typeof q;
    if (dateFrom) q = q.gte('date', dateFrom) as typeof q;
    if (dateTo)   q = q.lte('date', dateTo)   as typeof q;
    const { data, error } = await q;
    if (error) return { error: error.message };
    return {
        count: (data ?? []).length,
        rows: (data ?? []).map((r: any) => ({
            id: r.id,
            date: r.date,
            vendor: r.vendor,
            category: r.category,
            amount: fmtMoney(r.amount),
            currency: r.currency,
            status: r.paymentStatus,
        })),
    };
}

async function sumExpenses(args: Args, companyId: string) {
    const result = await queryExpenses({ ...args, limit: 200 }, companyId);
    if ('error' in result) return result;
    const sum = result.rows.reduce((acc, r) => acc + r.amount, 0);
    return {
        count: result.count,
        sumAmount: fmtMoney(sum),
        sampledRows: result.rows.slice(0, 5),
    };
}

async function getCashPosition(_args: Args, companyId: string) {
    // Run all three sums in parallel — they're independent queries.
    const [ar, ap, ex] = await Promise.all([
        sumInvoices({ kind: 'AR', openOnly: true }, companyId),
        sumInvoices({ kind: 'AP', openOnly: true }, companyId),
        sumExpenses({ paymentStatus: 'UNPAID' }, companyId),
    ]);
    // TS's 'in' narrowing doesn't bite here because the success types
    // don't include an explicit error?: never. Read the fields via
    // bracket access with fallback to keep the inference simple.
    if ('error' in ar) return { error: `AR: ${ar.error}` };
    if ('error' in ap) return { error: `AP: ${ap.error}` };
    if ('error' in ex) return { error: `Expenses: ${ex.error}` };
    const arBal = (ar as { sumBalance: number }).sumBalance;
    const apBal = (ap as { sumBalance: number }).sumBalance;
    const exAmt = (ex as { sumAmount: number }).sumAmount;
    return {
        openReceivables: arBal,
        openPayables:    apBal,
        unpaidExpenses:  exAmt,
        net: fmtMoney(arBal - apBal - exAmt),
        note:
            'Snapshot uses balances from ar_invoice_balances + ' +
            'ap_supplier_invoice_balances views, plus unpaid expense rows. ' +
            'Does NOT include SO/PO pipeline.',
    };
}

// ─── dispatcher ──────────────────────────────────────────────────────

export async function executeGemTool(
    name: string,
    args: unknown,
    companyId: string,
): Promise<Record<string, unknown>> {
    const a = (args && typeof args === 'object' ? args : {}) as Args;
    try {
        switch (name) {
            case 'query_invoices':         return await queryInvoices(a, companyId);
            case 'sum_invoices':           return await sumInvoices(a, companyId);
            case 'query_purchase_orders':  return await queryPurchaseOrders(a, companyId);
            case 'query_sales_orders':     return await querySalesOrders(a, companyId);
            case 'query_expenses':         return await queryExpenses(a, companyId);
            case 'sum_expenses':           return await sumExpenses(a, companyId);
            case 'get_cash_position':      return await getCashPosition(a, companyId);
            default:
                return { error: `Unknown tool: ${name}` };
        }
    } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
}
