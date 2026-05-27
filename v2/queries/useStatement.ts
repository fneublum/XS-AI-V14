// Statement query — Phase 3.
//
// Pulls a per-customer (AR) or per-supplier (AP) ledger by stitching
// invoices + transaction_allocations + transactions. Produces a date-
// ordered list of line items (invoices = debits, payments = credits)
// with a running balance, plus aging buckets at the report date.
//
// Reads, not writes. Pure derived state for the Statements view.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export type StatementKind = 'AR' | 'AP';

export interface StatementLine {
  kind: 'INVOICE' | 'PAYMENT';
  date: string;                  // YYYY-MM-DD
  ref: string;                   // invoice # or transaction reference
  description: string;
  debit: number;                 // invoice amount (AR) or bill amount (AP)
  credit: number;                // payment received (AR) or paid (AP)
  /** Allocation amount for payment lines — how much of the txn was
   *  applied to a specific invoice. For unallocated parts of a payment,
   *  description shows "(advance)". */
  allocationAmount?: number;
  /** Stable identifier for diffing. */
  id: string;
}

export interface StatementAging {
  bucket_0_30: number;
  bucket_31_60: number;
  bucket_61_90: number;
  bucket_90_plus: number;
  total: number;
}

export interface Statement {
  kind: StatementKind;
  counterpartyName: string;
  companyId: string;
  asOf: string;                  // YYYY-MM-DD report date
  lines: StatementLine[];
  openingBalance: number;        // balance BEFORE the first line shown (0 if from inception)
  closingBalance: number;
  aging: StatementAging;
}

interface UseStatementOptions {
  kind: StatementKind;
  /** AR: customer name (matches invoices.soldTo). AP: supplier name (matches invoices_suppliers.shipperName ?? soldTo). */
  counterpartyName: string;
  /** Optional cut-off; defaults to today. Future dates ignored. */
  asOf?: string;
}

function bucketAge(daysOld: number, balance: number): keyof StatementAging {
  if (daysOld <= 30) return 'bucket_0_30';
  if (daysOld <= 60) return 'bucket_31_60';
  if (daysOld <= 90) return 'bucket_61_90';
  return 'bucket_90_plus';
}

export function useStatement(opts: UseStatementOptions) {
  const { currentCompanyId } = useCompany();
  const asOf = opts.asOf ?? new Date().toISOString().slice(0, 10);

  return useSupabaseQuery<Statement>(
    ['statement', currentCompanyId, opts.kind, opts.counterpartyName, asOf],
    async () => {
      const sb = getSupabaseClient();

      // 1. Fetch invoices for this counterparty in current company.
      const invTable = opts.kind === 'AR' ? 'invoices' : 'invoices_suppliers';
      // AR matches `soldTo`. AP matches shipperName OR soldTo.
      let invQ = sb.from(invTable).select('*');
      if (currentCompanyId !== 'ALL') invQ = invQ.eq('"companyId"', currentCompanyId) as typeof invQ;
      if (opts.kind === 'AR') {
        invQ = invQ.eq('"soldTo"', opts.counterpartyName) as typeof invQ;
      } else {
        // either shipperName or soldTo matches
        invQ = invQ.or(`"shipperName".eq.${opts.counterpartyName},"soldTo".eq.${opts.counterpartyName}`) as typeof invQ;
      }
      const { data: invoices, error: invErr } = await invQ;
      if (invErr) throw new Error(invErr.message);

      const invoiceIds: string[] = (invoices ?? []).map((r: any) => r.id);

      // 2. Fetch all allocations against these invoice ids, with their
      //    parent transaction details. Two-step: pull allocations, then
      //    pull their transactions.
      const targetCol = opts.kind === 'AR' ? '"invoiceId"' : '"supplierInvoiceId"';
      let allocs: any[] = [];
      let txnsById: Map<string, any> = new Map();
      if (invoiceIds.length > 0) {
        const { data: a, error: aErr } = await sb
          .from('transaction_allocations')
          .select('*')
          .in(targetCol.replace(/"/g, ''), invoiceIds);
        if (aErr) throw new Error(aErr.message);
        allocs = a ?? [];
        const txnIds = [...new Set(allocs.map((x: any) => x.transactionId))];
        if (txnIds.length > 0) {
          const { data: t, error: tErr } = await sb
            .from('transactions')
            .select('*')
            .in('id', txnIds)
            .neq('status', 'VOIDED');
          if (tErr) throw new Error(tErr.message);
          for (const tx of (t ?? [])) txnsById.set(tx.id, tx);
          // Filter allocs to only those whose parent txn survived the VOIDED filter
          allocs = allocs.filter((a: any) => txnsById.has(a.transactionId));
        }
      }

      // 3. Build line items: invoice debits + payment credits.
      const lines: StatementLine[] = [];
      for (const inv of (invoices ?? []) as any[]) {
        const amount = Number(inv.totalAmount) || 0;
        if (amount <= 0) continue;  // skip zero-amount placeholder rows
        lines.push({
          id: `inv-${inv.id}`,
          kind: 'INVOICE',
          date: inv.invoiceDate ?? inv.createdAt?.slice(0, 10) ?? asOf,
          ref: inv.invoiceNumber ?? inv.id,
          description: `Invoice ${inv.invoiceNumber ?? inv.id}`,
          debit: amount,
          credit: 0,
        });
      }
      for (const a of allocs) {
        const tx = txnsById.get(a.transactionId);
        if (!tx) continue;
        lines.push({
          id: `pmt-${a.id}`,
          kind: 'PAYMENT',
          date: tx.txnDate ?? asOf,
          ref: tx.reference ?? tx.id,
          description: `Payment · ${tx.method ?? 'manual'}${tx.reference ? ` · ref ${tx.reference}` : ''}`,
          debit: 0,
          credit: Number(a.amount) || 0,
          allocationAmount: Number(a.amount) || 0,
        });
      }

      // 4. Sort by date (then INVOICE before PAYMENT on same date).
      lines.sort((x, y) => {
        if (x.date !== y.date) return x.date.localeCompare(y.date);
        return x.kind === 'INVOICE' ? -1 : 1;
      });

      // 5. Drop lines after asOf.
      const visibleLines = lines.filter(l => l.date <= asOf);

      // 6. Compute running balance + closing.
      let running = 0;
      for (const l of visibleLines) running += l.debit - l.credit;
      const closingBalance = running;

      // 7. Aging at asOf — only invoice debits that still have balance.
      // Compute per-invoice paid total, take the unpaid portion, bucket
      // by (asOf - invoiceDate).
      const paidByInvoice = new Map<string, number>();
      for (const a of allocs) {
        const targetId = opts.kind === 'AR' ? a.invoiceId : a.supplierInvoiceId;
        if (!targetId) continue;
        paidByInvoice.set(targetId, (paidByInvoice.get(targetId) ?? 0) + (Number(a.amount) || 0));
      }
      const aging: StatementAging = {
        bucket_0_30: 0, bucket_31_60: 0, bucket_61_90: 0, bucket_90_plus: 0, total: 0,
      };
      const asOfMs = new Date(asOf).getTime();
      for (const inv of (invoices ?? []) as any[]) {
        const amount = Number(inv.totalAmount) || 0;
        if (amount <= 0) continue;
        const paid = paidByInvoice.get(inv.id) ?? 0;
        const balance = amount - paid;
        if (balance <= 0.001) continue;
        const d = inv.invoiceDate ?? inv.createdAt?.slice(0, 10) ?? asOf;
        const days = Math.max(0, Math.floor((asOfMs - new Date(d).getTime()) / 86400000));
        const b = bucketAge(days, balance);
        aging[b] = (aging[b] as number) + balance;
        aging.total += balance;
      }

      return {
        kind: opts.kind,
        counterpartyName: opts.counterpartyName,
        companyId: currentCompanyId,
        asOf,
        lines: visibleLines,
        openingBalance: 0,
        closingBalance,
        aging,
      };
    },
  );
}

// ─── Aggregate AR/AP balances by counterparty (for the picker) ────────

export interface CounterpartyBalance {
  name: string;
  invoices: number;        // count
  outstanding: number;
}

/** List every customer (AR) or supplier (AP) that has at least one
 *  invoice in the current company, with their total outstanding. Used
 *  by the StatementsV2 picker dropdown. */
export function useCounterpartyBalances(kind: StatementKind) {
  const { currentCompanyId } = useCompany();
  return useSupabaseQuery<CounterpartyBalance[]>(
    ['counterparty_balances', currentCompanyId, kind],
    async () => {
      const sb = getSupabaseClient();
      const viewName = kind === 'AR' ? 'ar_invoice_balances' : 'ap_supplier_invoice_balances';
      let q = sb.from(viewName).select('*');
      if (currentCompanyId !== 'ALL') q = q.eq('"companyId"', currentCompanyId) as typeof q;
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const nameCol = kind === 'AR' ? 'soldTo' : 'supplier';
      const byName = new Map<string, CounterpartyBalance>();
      for (const r of ((data as any[] | null) ?? [])) {
        const name = (r[nameCol] ?? '').trim();
        if (!name) continue;
        const balance = Number(r.balance) || 0;
        const existing = byName.get(name);
        if (existing) {
          existing.invoices += 1;
          existing.outstanding += balance;
        } else {
          byName.set(name, { name, invoices: 1, outstanding: balance });
        }
      }
      return [...byName.values()].sort((a, b) => b.outstanding - a.outstanding);
    },
  );
}
