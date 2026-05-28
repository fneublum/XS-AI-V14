// Cash Flow — 12-month forecast view.
//
// Pulls every cash-affecting record via useCashFlow, buckets by month
// (6 back + 6 forward by default), and lays it out as a wide table:
//
//                         May  Jun  Jul  Aug  Sep  Oct  Nov  Dec  …
//   ┌───────────────────────────────────────────────────────────────
//   │ Actual in           $X   $Y   $Z
//   │ Actual out         ($A) ($B) ($C)
//   │ Projected in                       $P   $Q   $R
//   │ Projected out                     ($D) ($E) ($F)
//   ├───────────────────────────────────────────────────────────────
//   │ Net                  …    …    …    …    …    …
//   │ Running balance      …    …    …    …    …    …
//   └───────────────────────────────────────────────────────────────
//
// Filters (multi-select):
//   - Supplier   — narrows OUTflows from AP + PO + expense sources
//   - Customer   — narrows INflows from AR + SO sources
//   - Category   — narrows OUTflows from expenses by category
//
// Opening balance + pipeline toggle persist in localStorage so the
// settings survive a refresh per browser session.
//
// Currency policy: v1 defaults to USD only. Rows in other currencies
// are silently excluded with a count surfaced in the subtitle.

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useCashFlow, CashFlowRow } from '../queries/useCashFlow';
import { Modal } from '../primitives';

// ─── persistence ─────────────────────────────────────────────────────
const OPENING_BAL_KEY = 'xs_cashflow_opening_balance';
const PIPELINE_KEY    = 'xs_cashflow_include_pipeline';

const fmtMoney = (n: number) =>
    new Intl.NumberFormat('en-US', {
        style: 'currency', currency: 'USD',
        minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(n);

// Accounting-style display: parentheses for negatives, em-dash for
// zero. Used by the Actual balance / Net / Running balance subtotal
// rows where the value can legitimately go below zero. The per-flow
// rows (Actual in / Out / Invoices etc.) don't use this — those
// values are always positive (direction is implied by the row label),
// so a minus sign would never appear there.
const fmtBalance = (n: number) => {
    if (n === 0) return '—';
    if (n < 0)   return `(${fmtMoney(Math.abs(n))})`;
    return fmtMoney(n);
};

// timeZone:'UTC' so the label matches the bucket key. Without this,
// running in a non-UTC timezone (e.g. Brazil UTC-3) renders the May-1
// 00:00 UTC anchor as "Apr 30" locally, so every column header reads
// one month earlier than the data inside it.
const fmtMonth = (d: Date) =>
    d.toLocaleString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });

// Build the 12-month axis: 6 months back (inclusive of current) + 6
// months forward. Each entry has the YYYY-MM key + a display label.
function buildMonthAxis(monthsBack = 6, monthsForward = 6) {
    const today = new Date();
    today.setUTCDate(1);
    today.setUTCHours(0, 0, 0, 0);
    const out: { key: string; label: string; ts: number }[] = [];
    for (let i = -monthsBack; i < monthsForward; i++) {
        const d = new Date(today);
        d.setUTCMonth(today.getUTCMonth() + i);
        out.push({
            key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
            label: fmtMonth(d),
            ts: d.getTime(),
        });
    }
    return out;
}

function monthKey(isoDate: string): string {
    return isoDate.slice(0, 7); // YYYY-MM
}

// Drill-down model — identifies which cell the user clicked so we can
// re-derive the underlying rows. Each per-flow row maps to one cell
// kind that filters CashFlowRow[] back to its contributing records.
// The subtotal rows (actualBalance, net, running) span multiple
// sources and get a slightly different treatment inside DrilldownModal.
type CellKind =
    | 'actualIn' | 'actualOut'
    | 'invoicesIn' | 'invoicesOut'
    | 'salesOrdersIn' | 'purchaseOrdersOut'
    | 'expensesOut' | 'futureExpensesOut'
    | 'actualBalance' | 'net' | 'running';

interface Drilldown {
    cellKind: CellKind;
    monthKey: string;
    monthLabel: string;
    rowLabel: string;   // "Actual in", "Net", etc — for the modal title
    total: number;      // signed total of the cell (positive for inflow,
                        // negative for outflow, can be either for net/balance/running)
}

// Predicate: does this CashFlowRow contribute to that (cellKind, monthKey)?
// For `running`, the row contributes if its month is <= the clicked
// month — that's the cumulative semantics. For everything else it's
// strict month match plus a source/direction filter.
function rowMatchesCell(r: CashFlowRow, cellKind: CellKind, mKey: string, todayKey: string): boolean {
    const rKey = monthKey(r.date);
    if (cellKind === 'running') {
        // Every row up to AND including the clicked month feeds the
        // cumulative running balance.
        return rKey <= mKey;
    }
    if (rKey !== mKey) return false;
    switch (cellKind) {
        case 'actualIn':           return r.source === 'TRANSACTION' && r.direction === 'IN';
        case 'actualOut':          return r.source === 'TRANSACTION' && r.direction === 'OUT';
        case 'invoicesIn':         return r.source === 'AR';
        case 'invoicesOut':        return r.source === 'AP';
        case 'salesOrdersIn':      return r.source === 'SO';
        case 'purchaseOrdersOut':  return r.source === 'PO';
        case 'expensesOut':        return r.source === 'EXPENSE' && mKey <= todayKey;
        case 'futureExpensesOut':  return r.source === 'EXPENSE' && mKey >  todayKey;
        // Actual balance = settled + open invoices + expenses (no SO/PO
        // pipeline). Matches the math in the subtotal row above.
        case 'actualBalance':
            return r.source === 'TRANSACTION' || r.source === 'AR' || r.source === 'AP' || r.source === 'EXPENSE';
        // Net = everything that contributes to that month's net
        // movement, including SO/PO pipeline.
        case 'net':                return true;
        default:                   return false;
    }
}

const CashFlowV2: React.FC = () => {
    // ── settings (persisted) ────────────────────────────────────────
    const [openingBalance, setOpeningBalance] = useState<number>(() => {
        try {
            const v = parseFloat(localStorage.getItem(OPENING_BAL_KEY) ?? '0');
            return Number.isFinite(v) ? v : 0;
        } catch { return 0; }
    });
    useEffect(() => {
        try { localStorage.setItem(OPENING_BAL_KEY, String(openingBalance)); } catch { /* noop */ }
    }, [openingBalance]);
    // PIPELINE_KEY is dead — Sales Orders + Purchase Orders are now
    // permanent cash-flow rows. Old localStorage entry is harmless;
    // gets garbage-collected the next time the user clears storage.

    // ── filters ──────────────────────────────────────────────────────
    // Single-select per dimension, empty string = "All". Earlier
    // version used Set-based multi-select pills; users preferred a
    // dropdown narrowed to one counterparty at a time.
    const [supplierFilter, setSupplierFilter] = useState<string>('');
    const [customerFilter, setCustomerFilter] = useState<string>('');
    const [categoryFilter, setCategoryFilter] = useState<string>('');

    // Drill-down — clicking any non-zero cell opens a modal listing the
    // contributing rows. Null when closed.
    const [drilldown, setDrilldown] = useState<Drilldown | null>(null);

    // ── data ─────────────────────────────────────────────────────────
    const cashflow = useCashFlow();
    const allRows = cashflow.data ?? [];

    // Currency-clip to USD for v1. Track the count we're hiding so
    // the user knows they're not seeing everything.
    const usdRows = useMemo(() => allRows.filter(r => (r.currency ?? 'USD') === 'USD'), [allRows]);
    const nonUsdCount = allRows.length - usdRows.length;

    // "Supplier rows" = anything that's outflow-shaped: AP bills, open
    // POs, unpaid expenses, and OUT-direction transactions (past
    // supplier payments). "Customer rows" = inflow-shaped: AR invoices,
    // open SOs, and IN-direction transactions (past customer
    // receipts). Without including TRANSACTION rows in these buckets,
    // the Actual in / Actual out lines were untouched by the filters —
    // which made the dropdowns feel inert, since actuals are usually
    // the biggest visible numbers.
    const isSupplierRow = (r: CashFlowRow) =>
        r.source === 'AP' || r.source === 'PO' || r.source === 'EXPENSE' ||
        (r.source === 'TRANSACTION' && r.direction === 'OUT');
    const isCustomerRow = (r: CashFlowRow) =>
        r.source === 'AR' || r.source === 'SO' ||
        (r.source === 'TRANSACTION' && r.direction === 'IN');

    // Distinct values for the filter dropdowns.
    const distinctSuppliers = useMemo(() => {
        const s = new Set<string>();
        for (const r of usdRows) {
            if (isSupplierRow(r) && r.counterparty) s.add(r.counterparty);
        }
        return Array.from(s).sort();
    }, [usdRows]);
    const distinctCustomers = useMemo(() => {
        const s = new Set<string>();
        for (const r of usdRows) {
            if (isCustomerRow(r) && r.counterparty) s.add(r.counterparty);
        }
        return Array.from(s).sort();
    }, [usdRows]);
    const distinctCategories = useMemo(() => {
        const s = new Set<string>();
        for (const r of usdRows) {
            if (r.source === 'EXPENSE' && r.category) s.add(r.category);
        }
        return Array.from(s).sort();
    }, [usdRows]);

    // Apply filters. Each filter only narrows the rows it applies to —
    // a supplier filter never excludes AR/SO/in-transactions, for
    // instance. Rows the filter doesn't apply to pass through
    // unchanged (so picking a supplier still shows your customer
    // inflows in the same months, useful for context).
    const filteredRows = useMemo(() => {
        return usdRows.filter(r => {
            if (supplierFilter && isSupplierRow(r)) {
                if (r.counterparty !== supplierFilter) return false;
            }
            if (customerFilter && isCustomerRow(r)) {
                if (r.counterparty !== customerFilter) return false;
            }
            if (categoryFilter && r.source === 'EXPENSE') {
                if (r.category !== categoryFilter) return false;
            }
            return true;
        });
    }, [usdRows, supplierFilter, customerFilter, categoryFilter]);

    // ── bucket by month ──────────────────────────────────────────────
    // 0 back, 12 forward — there are no transactions on the ERP prior
    // to May 2026, so back-columns would be empty and just push the
    // useful forecast off-screen. 12 forward gives a full year of
    // planning runway from the current month.
    const axis = useMemo(() => buildMonthAxis(0, 12), []);
    const today = new Date();
    today.setUTCDate(1);
    today.setUTCHours(0, 0, 0, 0);
    const todayKey = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`;

    // One bucket field per visible row so the table is self-documenting:
    //   actualIn / actualOut          — settled transactions
    //   invoicesIn / invoicesOut      — open AR / AP invoices
    //   salesOrdersIn / purchaseOrdersOut — approved-but-not-yet-invoiced
    //   expensesOut                   — unpaid expenses due this month
    //                                   (current month and earlier — what's
    //                                   currently on the hook)
    //   futureExpensesOut             — unpaid expenses projected in
    //                                   future months (Jun onwards from
    //                                   May reference). Lets the user
    //                                   distinguish "money I'm paying now"
    //                                   from "money I owe later" at a
    //                                   glance.
    const bucket = useMemo(() => {
        type Cell = {
            actualIn: number; actualOut: number;
            invoicesIn: number; invoicesOut: number;
            salesOrdersIn: number; purchaseOrdersOut: number;
            expensesOut: number; futureExpensesOut: number;
        };
        const map: Record<string, Cell> = {};
        for (const m of axis) map[m.key] = {
            actualIn: 0, actualOut: 0,
            invoicesIn: 0, invoicesOut: 0,
            salesOrdersIn: 0, purchaseOrdersOut: 0,
            expensesOut: 0, futureExpensesOut: 0,
        };
        for (const r of filteredRows) {
            const k = monthKey(r.date);
            const cell = map[k];
            if (!cell) continue;  // outside the 12-month window
            if (r.kind === 'ACTUAL') {
                if (r.direction === 'IN') cell.actualIn += r.amount;
                else                       cell.actualOut += r.amount;
            } else if (r.source === 'EXPENSE') {
                // Split expenses by whether the projected pay date falls
                // in the current month (or earlier) vs strictly in a
                // future month.
                if (k > todayKey) cell.futureExpensesOut += r.amount;
                else              cell.expensesOut += r.amount;
            } else if (r.source === 'SO') {
                cell.salesOrdersIn += r.amount;
            } else if (r.source === 'PO') {
                cell.purchaseOrdersOut += r.amount;
            } else {
                // AR or AP — actual invoice records.
                if (r.direction === 'IN') cell.invoicesIn += r.amount;
                else                       cell.invoicesOut += r.amount;
            }
        }
        return map;
    }, [axis, filteredRows, todayKey]);

    // Running balance = opening + cumulative net. Net sums every row
    // visible in the table — actuals, invoices, SO/PO pipeline, and
    // both expense rows (current + future) — so what the user sees is
    // what the math uses.
    const running = useMemo(() => {
        const r: Record<string, number> = {};
        let cum = openingBalance;
        for (const m of axis) {
            const c = bucket[m.key];
            const inflow = c.actualIn + c.invoicesIn + c.salesOrdersIn;
            const outflow = c.actualOut + c.invoicesOut + c.purchaseOrdersOut +
                            c.expensesOut + c.futureExpensesOut;
            cum += inflow - outflow;
            r[m.key] = cum;
        }
        return r;
    }, [axis, bucket, openingBalance]);

    // ── drill-down open helper ───────────────────────────────────────
    // Curried to keep the Row signature small — Row only knows its
    // own cellKind/label and forwards (monthKey, monthLabel, value)
    // back when a cell is clicked.
    const openCell = (cellKind: CellKind, rowLabel: string) =>
        (mKey: string, mLabel: string, total: number) =>
            setDrilldown({ cellKind, monthKey: mKey, monthLabel: mLabel, rowLabel, total });

    // ── render ───────────────────────────────────────────────────────
    // Shared <select> styling so the three filter dropdowns line up.
    const selectClass =
        'h-8 w-full bg-[#111111] border border-[#1f1f1f] rounded-md ' +
        'px-2 text-[12.5px] text-slate-200 appearance-none';

    const Section: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
        <div className={
            'rounded-md border p-3 ' + (className ?? '')
        } style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)' }}>
            {children}
        </div>
    );

    return (
        <div className="bento-scope h-full flex flex-col p-4 gap-4">
            {/* Page header */}
            <div className="flex items-end gap-4 flex-wrap shrink-0">
                <div className="flex items-center gap-3">
                    <span className="block w-1 h-9 rounded-full" style={{ background: 'var(--b-teal-2)' }} />
                    <div>
                        <h1 className="font-semibold leading-none" style={{
                            color: 'var(--b-text)', fontSize: '32px',
                            fontVariationSettings: "'opsz' 64, 'wght' 600", letterSpacing: '-0.02em',
                        }}>Cash Flow</h1>
                        <div className="text-[13px] mt-1.5" style={{ color: 'var(--b-text-mute)' }}>
                            {cashflow.isLoading
                                ? 'Loading…'
                                : `${filteredRows.length} cash events · ${axis[0].label} → ${axis[axis.length - 1].label}` +
                                  (nonUsdCount > 0 ? ` · ${nonUsdCount} non-USD rows hidden` : '')}
                        </div>
                    </div>
                </div>
                <div className="ml-auto flex items-end gap-3">
                    <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-slate-500 uppercase tracking-wider">Opening balance (USD)</span>
                        <OpeningBalanceInput
                            value={openingBalance}
                            onChange={setOpeningBalance}
                        />
                    </label>
                </div>
            </div>

            {/* Filter row — single-select dropdowns, "All" is the
                default. Each filter only narrows the rows it applies
                to (supplier → AP/PO/expenses; customer → AR/SO;
                category → expenses), so picking "All" on one is the
                same as not setting it. */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 shrink-0">
                <Section>
                    <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">
                        Supplier
                    </div>
                    <select
                        value={supplierFilter}
                        onChange={e => setSupplierFilter(e.target.value)}
                        className={selectClass}
                        disabled={distinctSuppliers.length === 0}
                    >
                        <option value="">All ({distinctSuppliers.length})</option>
                        {distinctSuppliers.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </Section>
                <Section>
                    <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">
                        Customer
                    </div>
                    <select
                        value={customerFilter}
                        onChange={e => setCustomerFilter(e.target.value)}
                        className={selectClass}
                        disabled={distinctCustomers.length === 0}
                    >
                        <option value="">All ({distinctCustomers.length})</option>
                        {distinctCustomers.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </Section>
                <Section>
                    <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">
                        Expense category
                    </div>
                    <select
                        value={categoryFilter}
                        onChange={e => setCategoryFilter(e.target.value)}
                        className={selectClass}
                        disabled={distinctCategories.length === 0}
                    >
                        <option value="">All ({distinctCategories.length})</option>
                        {distinctCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </Section>
            </div>

            {/* Main table */}
            <div
                className="flex-1 min-h-0 rounded-[18px] border overflow-auto"
                style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)' }}
            >
                <table className="w-full text-[12.5px] border-collapse">
                    <thead className="sticky top-0 z-10" style={{ background: 'var(--b-surface)' }}>
                        <tr className="text-[10.5px] uppercase tracking-wider text-slate-500">
                            <th className="text-left px-3 py-2 border-b" style={{ borderColor: 'var(--b-line-soft)' }}>Flow</th>
                            {axis.map(m => (
                                <th key={m.key}
                                    className={
                                        'text-right px-2 py-2 border-b font-medium ' +
                                        (m.key === todayKey ? 'text-indigo-300' : '')
                                    }
                                    style={{ borderColor: 'var(--b-line-soft)' }}
                                >{m.label}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        <Row
                            label="Actual in"
                            axis={axis} bucket={bucket} todayKey={todayKey}
                            value={c => c.actualIn} tone="positive"
                            cellKind="actualIn" onCellClick={openCell('actualIn', 'Actual in')}
                        />
                        <Row
                            label="Actual out"
                            axis={axis} bucket={bucket} todayKey={todayKey}
                            value={c => c.actualOut} tone="negative"
                            cellKind="actualOut" onCellClick={openCell('actualOut', 'Actual out')}
                        />
                        <Row
                            label="Invoices in"
                            axis={axis} bucket={bucket} todayKey={todayKey}
                            value={c => c.invoicesIn} tone="positive" muted
                            cellKind="invoicesIn" onCellClick={openCell('invoicesIn', 'Invoices in')}
                        />
                        <Row
                            label="Invoices out"
                            axis={axis} bucket={bucket} todayKey={todayKey}
                            value={c => c.invoicesOut} tone="negative" muted
                            cellKind="invoicesOut" onCellClick={openCell('invoicesOut', 'Invoices out')}
                        />
                        <Row
                            label="Expenses out"
                            axis={axis} bucket={bucket} todayKey={todayKey}
                            value={c => c.expensesOut} tone="negative" muted
                            cellKind="expensesOut" onCellClick={openCell('expensesOut', 'Expenses out')}
                        />
                        {/* Actual balance subtotal — per-month net of
                            everything we *know* about (settled
                            transactions + open invoices + expenses).
                            Excludes Sales/Purchase Orders since those
                            are still pipeline and may not materialise. */}
                        <tr className="border-t" style={{ borderColor: 'var(--b-line)' }}>
                            <td className="px-3 py-2 text-slate-200 font-semibold">Actual balance</td>
                            {axis.map(m => {
                                const c = bucket[m.key];
                                const sub = (c.actualIn + c.invoicesIn) - (c.actualOut + c.invoicesOut + c.expensesOut);
                                const cls = sub >= 0 ? 'text-emerald-300' : 'text-rose-300';
                                const clickable = sub !== 0;
                                return (
                                    <td key={m.key}
                                        className={
                                            `px-2 py-2 text-right font-mono tabular-nums font-semibold ${cls}` +
                                            (clickable ? ' cursor-pointer hover:bg-indigo-500/10 hover:text-indigo-200 transition-colors' : '')
                                        }
                                        onClick={clickable ? () => openCell('actualBalance', 'Actual balance')(m.key, m.label, sub) : undefined}
                                        title={clickable ? 'Click to see details' : undefined}
                                    >
                                        {fmtBalance(sub)}
                                    </td>
                                );
                            })}
                        </tr>
                        <Row
                            label="Sales orders in"
                            axis={axis} bucket={bucket} todayKey={todayKey}
                            value={c => c.salesOrdersIn} tone="positive" muted
                            cellKind="salesOrdersIn" onCellClick={openCell('salesOrdersIn', 'Sales orders in')}
                        />
                        <Row
                            label="Purchase orders out"
                            axis={axis} bucket={bucket} todayKey={todayKey}
                            value={c => c.purchaseOrdersOut} tone="negative" muted
                            cellKind="purchaseOrdersOut" onCellClick={openCell('purchaseOrdersOut', 'Purchase orders out')}
                        />
                        <Row
                            label="Future expenses"
                            axis={axis} bucket={bucket} todayKey={todayKey}
                            value={c => c.futureExpensesOut} tone="negative" muted
                            cellKind="futureExpensesOut" onCellClick={openCell('futureExpensesOut', 'Future expenses')}
                        />
                        <tr className="border-t-2" style={{ borderColor: 'var(--b-line)' }}>
                            <td className="px-3 py-2 text-slate-300 font-semibold">Net</td>
                            {axis.map(m => {
                                const c = bucket[m.key];
                                const inflow = c.actualIn + c.invoicesIn + c.salesOrdersIn;
                                const outflow = c.actualOut + c.invoicesOut + c.purchaseOrdersOut +
                                                c.expensesOut + c.futureExpensesOut;
                                const net = inflow - outflow;
                                const cls = net >= 0 ? 'text-emerald-300' : 'text-rose-300';
                                const clickable = net !== 0;
                                return (
                                    <td key={m.key}
                                        className={
                                            `px-2 py-2 text-right font-mono tabular-nums ${cls}` +
                                            (clickable ? ' cursor-pointer hover:bg-indigo-500/10 hover:text-indigo-200 transition-colors' : '')
                                        }
                                        onClick={clickable ? () => openCell('net', 'Net')(m.key, m.label, net) : undefined}
                                        title={clickable ? 'Click to see details' : undefined}
                                    >
                                        {fmtBalance(net)}
                                    </td>
                                );
                            })}
                        </tr>
                        <tr className="border-t" style={{ borderColor: 'var(--b-line-soft)' }}>
                            <td className="px-3 py-2 text-slate-200 font-semibold">Running balance</td>
                            {axis.map(m => {
                                const v = running[m.key];
                                const cls = v >= 0 ? 'text-slate-100' : 'text-rose-300';
                                // Running balance is always clickable (even at 0)
                                // because the opening balance + history may still
                                // be informative.
                                return (
                                    <td key={m.key}
                                        className={
                                            `px-2 py-2 text-right font-mono tabular-nums font-semibold ${cls}` +
                                            ' cursor-pointer hover:bg-indigo-500/10 hover:text-indigo-200 transition-colors'
                                        }
                                        onClick={() => openCell('running', 'Running balance')(m.key, m.label, v)}
                                        title="Click to see month-by-month breakdown"
                                    >
                                        {fmtBalance(v)}
                                    </td>
                                );
                            })}
                        </tr>
                    </tbody>
                </table>
            </div>

            {cashflow.error && (
                <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-[12.5px] text-rose-300">
                    {String(cashflow.error.message ?? cashflow.error)}
                </div>
            )}

            {/* Drill-down modal — open when a cell is clicked. Filters
                the same `filteredRows` the table aggregates from, so it
                always matches what's on screen (incl. supplier/customer
                /category filters). */}
            <DrilldownModal
                drilldown={drilldown}
                rows={filteredRows}
                openingBalance={openingBalance}
                axis={axis}
                bucket={bucket}
                todayKey={todayKey}
                onClose={() => setDrilldown(null)}
            />
        </div>
    );
};

// Reusable bucket row. `tone` swings the colour; `muted` half-fades to
// distinguish projected from actuals.
// Opening-balance input with "999,999.99" display formatting.
//
// type="number" forced a raw, unformatted display ("12345" — easy to
// misread). This component swaps to text + decimal-mode (keeps the
// mobile numeric keypad) and reformats on every keystroke with
// commas and two decimals. The cursor is restored after each
// re-format so typing stays smooth — without it, jumping the value
// from "1234" to "1,234" would yank the caret to the end.
const fmtNumber = (n: number): string =>
    n.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });

const parseNumber = (s: string): number => {
    // Strip everything that isn't a digit, dot, or minus.
    const cleaned = s.replace(/[^0-9.\-]/g, '');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
};

const OpeningBalanceInput: React.FC<{
    value: number;
    onChange: (n: number) => void;
}> = ({ value, onChange }) => {
    // Internal text state so the user can type freely (intermediate
    // values like "1234.5" before they finish typing the second
    // decimal). We sync the formatted display back on blur, and
    // re-sync when the external `value` prop diverges (e.g. external
    // reset, hot-reload).
    const [draft, setDraft] = useState<string>(() => fmtNumber(value));
    const externalRef = useRef(value);
    useEffect(() => {
        if (externalRef.current !== value) {
            externalRef.current = value;
            setDraft(fmtNumber(value));
        }
    }, [value]);

    return (
        <input
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={e => {
                const raw = e.target.value;
                setDraft(raw);
                // Commit the parsed value immediately so downstream
                // running-balance math reacts in real time. We keep
                // the unformatted draft visible until blur — typing
                // "12345" reads cleanly without commas appearing
                // mid-edit and shifting the caret.
                const n = parseNumber(raw);
                onChange(n);
                externalRef.current = n;
            }}
            onBlur={() => {
                // Reformat to the canonical "12,345.00" on blur.
                setDraft(fmtNumber(value));
            }}
            onFocus={e => {
                // Select on focus so the next keystroke replaces — the
                // most common edit is "wipe and retype" for this field.
                e.target.select();
            }}
            className="h-8 w-40 bg-[#111111] border border-[#1f1f1f] rounded-md px-2 text-[12.5px] text-slate-200 font-mono tabular-nums text-right"
        />
    );
};

function Row({
    label, axis, bucket, todayKey, value, tone, muted, cellKind, onCellClick,
}: {
    label: string;
    axis: { key: string; label: string }[];
    bucket: Record<string, {
        actualIn: number; actualOut: number;
        invoicesIn: number; invoicesOut: number;
        salesOrdersIn: number; purchaseOrdersOut: number;
        expensesOut: number; futureExpensesOut: number;
    }>;
    todayKey: string;
    value: (c: {
        actualIn: number; actualOut: number;
        invoicesIn: number; invoicesOut: number;
        salesOrdersIn: number; purchaseOrdersOut: number;
        expensesOut: number; futureExpensesOut: number;
    }) => number;
    tone: 'positive' | 'negative';
    muted?: boolean;
    /** Identifies which slice of rows this row aggregates — feeds the
     *  drill-down modal so a cell click can re-derive the underlying
     *  CashFlowRow[]. */
    cellKind: CellKind;
    /** Open the drill-down modal for (monthKey, cellKind, value). */
    onCellClick: (monthKey: string, monthLabel: string, value: number) => void;
}) {
    const colourClass =
        tone === 'positive'
            ? (muted ? 'text-emerald-300/60' : 'text-emerald-300')
            : (muted ? 'text-rose-300/60' : 'text-rose-300');
    return (
        <tr className="border-t" style={{ borderColor: 'var(--b-line-soft)' }}>
            <td className="px-3 py-1.5 text-slate-300">{label}</td>
            {axis.map(m => {
                const v = value(bucket[m.key]);
                const clickable = v !== 0;
                return (
                    <td key={m.key}
                        className={
                            'px-2 py-1.5 text-right font-mono tabular-nums ' +
                            (v === 0 ? 'text-slate-700' : colourClass) +
                            (m.key === todayKey ? ' bg-indigo-500/5' : '') +
                            (clickable ? ' cursor-pointer hover:bg-indigo-500/10 hover:text-indigo-200 transition-colors' : '')
                        }
                        onClick={clickable ? () => onCellClick(m.key, m.label, v) : undefined}
                        title={clickable ? 'Click to see details' : undefined}
                    >
                        {v === 0 ? '—' : (tone === 'negative' ? `(${fmtMoney(v)})` : fmtMoney(v))}
                    </td>
                );
            })}
        </tr>
    );
}

// ─── drill-down modal ────────────────────────────────────────────────
// Lists the underlying CashFlowRow records contributing to a clicked
// cell. Three rendering modes by cell kind:
//
//   • Single-source kinds (Actual in, Invoices out, etc.) — a flat
//     table sorted by date.
//   • Actual balance / Net — same flat table, but rows are visually
//     grouped by direction (Inflows above, Outflows below) with a
//     summary header.
//   • Running balance — a per-month cumulative breakdown table
//     starting from the opening balance. Per-row listing would be
//     enormous (every actual + invoice + order up to that month) and
//     not actionable; the month-by-month view shows where the balance
//     drifted.
const sourceLabel = (s: CashFlowRow['source']): string => {
    switch (s) {
        case 'TRANSACTION': return 'Transaction';
        case 'AR':          return 'AR invoice';
        case 'AP':          return 'AP bill';
        case 'SO':          return 'Sales order';
        case 'PO':          return 'Purchase order';
        case 'EXPENSE':     return 'Expense';
    }
};

const sourceBadge = (s: CashFlowRow['source']): string => {
    // Tailwind colour per source type — keeps the modal scannable.
    switch (s) {
        case 'TRANSACTION': return 'bg-slate-700/40 text-slate-200';
        case 'AR':          return 'bg-emerald-600/20 text-emerald-200';
        case 'AP':          return 'bg-rose-600/20 text-rose-200';
        case 'SO':          return 'bg-emerald-700/20 text-emerald-300';
        case 'PO':          return 'bg-rose-700/20 text-rose-300';
        case 'EXPENSE':     return 'bg-amber-600/20 text-amber-200';
    }
};

const fmtSigned = (n: number, direction: CashFlowRow['direction']): string => {
    // Always show the signed amount in the modal — the source list
    // can mix inflows and outflows so the bare value would be
    // ambiguous.
    if (direction === 'IN') return fmtMoney(n);
    return `(${fmtMoney(n)})`;
};

const DrilldownModal: React.FC<{
    drilldown: Drilldown | null;
    rows: CashFlowRow[];
    openingBalance: number;
    axis: { key: string; label: string }[];
    bucket: Record<string, {
        actualIn: number; actualOut: number;
        invoicesIn: number; invoicesOut: number;
        salesOrdersIn: number; purchaseOrdersOut: number;
        expensesOut: number; futureExpensesOut: number;
    }>;
    todayKey: string;
    onClose: () => void;
}> = ({ drilldown, rows, openingBalance, axis, bucket, todayKey, onClose }) => {
    if (!drilldown) {
        return <Modal open={false} onClose={onClose}>{null}</Modal>;
    }

    const matching = rows
        .filter(r => rowMatchesCell(r, drilldown.cellKind, drilldown.monthKey, todayKey))
        .sort((a, b) => a.date.localeCompare(b.date));

    const isAggregate = drilldown.cellKind === 'actualBalance' || drilldown.cellKind === 'net';
    const isRunning   = drilldown.cellKind === 'running';

    // Running balance — show monthly breakdown rather than a flat list.
    const monthlyBreakdown = useMemo(() => {
        if (!isRunning) return [];
        const upTo: { key: string; label: string }[] = [];
        for (const m of axis) {
            upTo.push(m);
            if (m.key === drilldown.monthKey) break;
        }
        let cum = openingBalance;
        return upTo.map(m => {
            const c = bucket[m.key];
            const inflow = c.actualIn + c.invoicesIn + c.salesOrdersIn;
            const outflow = c.actualOut + c.invoicesOut + c.purchaseOrdersOut +
                            c.expensesOut + c.futureExpensesOut;
            const net = inflow - outflow;
            cum += net;
            return { key: m.key, label: m.label, inflow, outflow, net, cumulative: cum };
        });
    }, [isRunning, axis, bucket, drilldown.monthKey, openingBalance]);

    const inflows  = matching.filter(r => r.direction === 'IN');
    const outflows = matching.filter(r => r.direction === 'OUT');
    const sumIn  = inflows.reduce((a, r) => a + r.amount, 0);
    const sumOut = outflows.reduce((a, r) => a + r.amount, 0);

    return (
        <Modal
            open
            onClose={onClose}
            className="bg-[#0a0a0a] text-slate-200 border border-[#1f1f1f] w-[min(96vw,920px)] p-0"
        >
            <div className="px-5 py-4 border-b border-[#1f1f1f] flex items-baseline justify-between gap-4">
                <div>
                    <div className="text-[11px] uppercase tracking-wider text-slate-500">
                        {drilldown.rowLabel} · {drilldown.monthLabel}
                    </div>
                    <div className="mt-0.5 text-lg font-semibold text-slate-100">
                        {fmtBalance(drilldown.total)}
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="text-slate-500 hover:text-slate-300 text-sm px-2 py-1 rounded hover:bg-slate-800"
                >
                    Close
                </button>
            </div>

            <div className="max-h-[70vh] overflow-auto px-5 py-4 text-[12.5px]">
                {isRunning && (
                    <table className="w-full border-collapse">
                        <thead>
                            <tr className="text-[10.5px] uppercase tracking-wider text-slate-500 border-b border-[#1f1f1f]">
                                <th className="text-left py-2 pr-3">Month</th>
                                <th className="text-right py-2 px-3">Inflow</th>
                                <th className="text-right py-2 px-3">Outflow</th>
                                <th className="text-right py-2 px-3">Net</th>
                                <th className="text-right py-2 pl-3">Running</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr className="border-b border-[#1f1f1f]/60 text-slate-400">
                                <td className="py-1.5 pr-3 italic">Opening balance</td>
                                <td colSpan={3} className="py-1.5"></td>
                                <td className="py-1.5 pl-3 text-right font-mono tabular-nums">{fmtBalance(openingBalance)}</td>
                            </tr>
                            {monthlyBreakdown.map(row => (
                                <tr key={row.key} className="border-b border-[#1f1f1f]/60">
                                    <td className="py-1.5 pr-3 text-slate-200">{row.label}</td>
                                    <td className="py-1.5 px-3 text-right font-mono tabular-nums text-emerald-300/70">
                                        {row.inflow === 0 ? '—' : fmtMoney(row.inflow)}
                                    </td>
                                    <td className="py-1.5 px-3 text-right font-mono tabular-nums text-rose-300/70">
                                        {row.outflow === 0 ? '—' : `(${fmtMoney(row.outflow)})`}
                                    </td>
                                    <td className={`py-1.5 px-3 text-right font-mono tabular-nums ${row.net >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                                        {fmtBalance(row.net)}
                                    </td>
                                    <td className={`py-1.5 pl-3 text-right font-mono tabular-nums font-semibold ${row.cumulative >= 0 ? 'text-slate-100' : 'text-rose-300'}`}>
                                        {fmtBalance(row.cumulative)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}

                {!isRunning && matching.length === 0 && (
                    <div className="text-slate-500 italic py-8 text-center">
                        No contributing rows. (Cell value may be from a filter that excluded the underlying records.)
                    </div>
                )}

                {!isRunning && matching.length > 0 && (
                    <>
                        {isAggregate && (
                            <div className="grid grid-cols-3 gap-3 mb-4 text-[12px]">
                                <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-2">
                                    <div className="text-[10.5px] uppercase tracking-wider text-emerald-400/70">Inflows</div>
                                    <div className="font-mono tabular-nums text-emerald-200">{fmtMoney(sumIn)}</div>
                                </div>
                                <div className="rounded border border-rose-500/20 bg-rose-500/5 p-2">
                                    <div className="text-[10.5px] uppercase tracking-wider text-rose-400/70">Outflows</div>
                                    <div className="font-mono tabular-nums text-rose-200">({fmtMoney(sumOut)})</div>
                                </div>
                                <div className="rounded border border-[#1f1f1f] bg-[#111111] p-2">
                                    <div className="text-[10.5px] uppercase tracking-wider text-slate-400">Net</div>
                                    <div className="font-mono tabular-nums text-slate-100 font-semibold">{fmtBalance(sumIn - sumOut)}</div>
                                </div>
                            </div>
                        )}
                        <table className="w-full border-collapse">
                            <thead>
                                <tr className="text-[10.5px] uppercase tracking-wider text-slate-500 border-b border-[#1f1f1f]">
                                    <th className="text-left py-2 pr-2 w-24">Date</th>
                                    <th className="text-left py-2 px-2 w-28">Source</th>
                                    <th className="text-left py-2 px-2">Counterparty</th>
                                    <th className="text-left py-2 px-2">Reference</th>
                                    <th className="text-right py-2 pl-2 w-28">Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                {matching.map(r => (
                                    <tr key={r.id} className="border-b border-[#1f1f1f]/50 hover:bg-[#111111]">
                                        <td className="py-1.5 pr-2 font-mono tabular-nums text-slate-400">
                                            {r.date}
                                            {r.kind === 'PROJECTED' && (
                                                <span className="ml-1 text-[10px] text-slate-600">proj.</span>
                                            )}
                                        </td>
                                        <td className="py-1.5 px-2">
                                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10.5px] uppercase tracking-wider ${sourceBadge(r.source)}`}>
                                                {sourceLabel(r.source)}
                                            </span>
                                        </td>
                                        <td className="py-1.5 px-2 text-slate-200 truncate max-w-[240px]" title={r.counterparty ?? ''}>
                                            {r.counterparty ?? '—'}
                                            {r.category && (
                                                <span className="ml-1 text-slate-500 text-[11px]">· {r.category}</span>
                                            )}
                                        </td>
                                        <td className="py-1.5 px-2 text-slate-500 text-[11.5px] truncate max-w-[200px]" title={r.label}>
                                            {r.label}
                                        </td>
                                        <td className={`py-1.5 pl-2 text-right font-mono tabular-nums ${r.direction === 'IN' ? 'text-emerald-300' : 'text-rose-300'}`}>
                                            {fmtSigned(r.amount, r.direction)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="border-t border-[#1f1f1f]">
                                    <td colSpan={4} className="py-2 pr-2 text-right text-slate-400 uppercase tracking-wider text-[10.5px]">
                                        Total · {matching.length} {matching.length === 1 ? 'row' : 'rows'}
                                    </td>
                                    <td className={`py-2 pl-2 text-right font-mono tabular-nums font-semibold ${(sumIn - sumOut) >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>
                                        {fmtBalance(sumIn - sumOut)}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </>
                )}
            </div>
        </Modal>
    );
};

export default CashFlowV2;
