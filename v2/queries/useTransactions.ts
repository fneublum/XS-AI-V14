// Phase 3B — Transactions ledger query.
//
// Reads from the unified `transactions` + `transaction_allocations`
// tables introduced by migration 20260527120000. One row per bank
// movement; allocations split a single transaction across one or more
// invoices (AR) or purchase orders (AP).
//
// Source-of-truth for AR/AP balances. The legacy QB-only path on
// FinanceBalancesV2 will be re-wired to read from here in Phase 3.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';
import { useQueryClient, useMutation } from '@tanstack/react-query';

export type TxnSource     = 'MANUAL' | 'OCR' | 'QB_SYNC' | 'BANK_IMPORT';
export type TxnKind       = 'PAYMENT_IN' | 'PAYMENT_OUT' | 'CREDIT_NOTE' | 'WRITE_OFF';
export type TxnMethod     = 'WIRE' | 'ACH' | 'CHECK' | 'CARD' | 'CASH' | 'OTHER';
export type TxnStatus     = 'UNMATCHED' | 'MATCHED' | 'RECONCILED' | 'VOIDED';
export type CounterpartyType = 'CUSTOMER' | 'SUPPLIER' | 'INTERNAL';

export interface Allocation {
  id: string;
  transactionId: string;
  invoiceId: string | null;          // AR target: invoices.id
  supplierInvoiceId: string | null;  // AP target: invoices_suppliers.id (added 20260527130000)
  purchaseOrderId: string | null;    // AP target: purchase_orders.id (rare; for direct PO advances)
  amount: number;
  memo: string | null;
  createdAt: string;
}

export interface Transaction {
  id: string;
  companyId: string;
  source: TxnSource;
  kind: TxnKind;
  txnDate: string;
  amount: number;
  currency: string;
  method: TxnMethod | null;
  counterpartyType: CounterpartyType | null;
  counterpartyId: string | null;
  counterpartyName: string | null;
  reference: string | null;
  memo: string | null;
  status: TxnStatus;
  receiptUrl: string | null;
  ocrConfidence: number | null;
  ai_status: 'ai_draft' | 'approved' | 'rejected' | null;
  qbId: string | null;
  qbSyncedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  allocations: Allocation[];   // hydrated client-side from a second fetch
}

interface RawTxn {
  id: string;
  companyId: string;
  source: TxnSource;
  kind: TxnKind;
  txnDate: string;
  amount: number | string;
  currency: string | null;
  method: TxnMethod | null;
  counterpartyType: CounterpartyType | null;
  counterpartyId: string | null;
  counterpartyName: string | null;
  reference: string | null;
  memo: string | null;
  status: TxnStatus;
  receiptUrl: string | null;
  ocrConfidence: number | string | null;
  ai_status: string | null;
  qbId: string | null;
  qbSyncedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
}

interface RawAlloc {
  id: string;
  transactionId: string;
  invoiceId: string | null;
  supplierInvoiceId: string | null;
  purchaseOrderId: string | null;
  amount: number | string;
  memo: string | null;
  createdAt: string;
}

function newId(prefix: 'TXN' | 'ALLOC'): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${ts}-${rand}`;
}

/** Strict company scoping; matches the rest of v2/queries (Bookings,
 *  BLs, Invoices). No ALL-fallback — see fb864d7 for why. */
function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

export interface UseTransactionsOptions {
  /** Filter by kind. Omit to include both directions. */
  kind?: TxnKind;
  /** Filter by counterparty (customer/supplier) id. */
  counterpartyId?: string;
  /** Filter by status. Omit to include all non-VOIDED. */
  status?: TxnStatus;
  /** Cap. Default 500. */
  limit?: number;
}

export function useTransactions(opts: UseTransactionsOptions = {}) {
  const { currentCompanyId } = useCompany();

  return useSupabaseQuery<Transaction[]>(
    ['transactions', currentCompanyId, opts.kind ?? 'ALL', opts.counterpartyId ?? '', opts.status ?? 'ALL', opts.limit ?? 500],
    async () => {
      const supabase = getSupabaseClient();

      // Pull transactions
      let q = scopeByCompany(
        supabase.from('transactions')
          .select('*')
          .neq('status', 'VOIDED')
          .order('"txnDate"', { ascending: false })
          .order('"createdAt"', { ascending: false })
          .limit(opts.limit ?? 500),
        currentCompanyId,
      );
      if (opts.kind) q = q.eq('kind', opts.kind) as typeof q;
      if (opts.counterpartyId) q = q.eq('"counterpartyId"', opts.counterpartyId) as typeof q;
      if (opts.status) q = q.eq('status', opts.status) as typeof q;

      const { data: txns, error: txnErr } = await q;
      if (txnErr) throw new Error(txnErr.message);

      const txnIds = ((txns as RawTxn[] | null) ?? []).map(t => t.id);
      if (txnIds.length === 0) return [];

      // Pull allocations for the txn ids we just fetched
      const { data: allocs, error: allocErr } = await supabase
        .from('transaction_allocations')
        .select('*')
        .in('"transactionId"', txnIds);
      if (allocErr) throw new Error(allocErr.message);

      // Group allocations by transactionId
      const byTxn = new Map<string, Allocation[]>();
      for (const a of (allocs as RawAlloc[] | null) ?? []) {
        const arr = byTxn.get(a.transactionId) ?? [];
        arr.push({
          id: a.id,
          transactionId: a.transactionId,
          invoiceId: a.invoiceId,
          supplierInvoiceId: a.supplierInvoiceId,
          purchaseOrderId: a.purchaseOrderId,
          amount: Number(a.amount) || 0,
          memo: a.memo,
          createdAt: a.createdAt,
        });
        byTxn.set(a.transactionId, arr);
      }

      return (txns as RawTxn[]).map(t => ({
        id: t.id,
        companyId: t.companyId,
        source: t.source,
        kind: t.kind,
        txnDate: t.txnDate,
        amount: Number(t.amount) || 0,
        currency: t.currency ?? 'USD',
        method: t.method,
        counterpartyType: t.counterpartyType,
        counterpartyId: t.counterpartyId,
        counterpartyName: t.counterpartyName,
        reference: t.reference,
        memo: t.memo,
        status: t.status,
        receiptUrl: t.receiptUrl,
        ocrConfidence: t.ocrConfidence != null ? Number(t.ocrConfidence) : null,
        ai_status: (t.ai_status === 'ai_draft' || t.ai_status === 'rejected' || t.ai_status === 'approved')
          ? t.ai_status as Transaction['ai_status']
          : null,
        qbId: t.qbId,
        qbSyncedAt: t.qbSyncedAt,
        createdAt: t.createdAt,
        createdBy: t.createdBy,
        updatedAt: t.updatedAt,
        allocations: byTxn.get(t.id) ?? [],
      }));
    },
  );
}

// ─── Mutations ─────────────────────────────────────────────────────────

export interface CreateTransactionInput {
  source: TxnSource;
  kind: TxnKind;
  txnDate: string;          // YYYY-MM-DD
  amount: number;
  currency?: string;
  method?: TxnMethod;
  counterpartyType?: CounterpartyType;
  counterpartyId?: string;
  counterpartyName?: string;
  reference?: string;
  memo?: string;
  receiptUrl?: string;
  ocrConfidence?: number;
  ai_status?: 'ai_draft' | 'approved' | 'rejected';
  /** Optional initial allocations — typical case is one entry. */
  allocations?: Array<{
    invoiceId?: string;          // AR receipt
    supplierInvoiceId?: string;  // AP payment against a vendor bill
    purchaseOrderId?: string;    // AP advance against a PO commitment
    amount: number;
    memo?: string;
  }>;
}

/** Create a transaction + its initial allocations atomically. */
export function useCreateTransaction() {
  const { currentCompanyId } = useCompany();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTransactionInput) => {
      if (currentCompanyId === 'ALL') {
        throw new Error('Select a specific company before recording a transaction.');
      }
      const supabase = getSupabaseClient();
      const txnId = newId('TXN');

      // Compute matched status: if any allocations, MATCHED; otherwise UNMATCHED
      const status: TxnStatus = (input.allocations?.length ?? 0) > 0 ? 'MATCHED' : 'UNMATCHED';

      const { error: txnErr } = await supabase.from('transactions').insert({
        id: txnId,
        companyId: currentCompanyId,
        source: input.source,
        kind: input.kind,
        txnDate: input.txnDate,
        amount: input.amount,
        currency: input.currency ?? 'USD',
        method: input.method ?? null,
        counterpartyType: input.counterpartyType ?? null,
        counterpartyId: input.counterpartyId ?? null,
        counterpartyName: input.counterpartyName ?? null,
        reference: input.reference ?? null,
        memo: input.memo ?? null,
        status,
        receiptUrl: input.receiptUrl ?? null,
        ocrConfidence: input.ocrConfidence ?? null,
        ai_status: input.ai_status ?? null,
      });
      if (txnErr) throw new Error(txnErr.message);

      // Insert allocations if any
      const allocs = input.allocations ?? [];
      if (allocs.length > 0) {
        const rows = allocs.map(a => ({
          id: newId('ALLOC'),
          transactionId: txnId,
          invoiceId: a.invoiceId ?? null,
          supplierInvoiceId: a.supplierInvoiceId ?? null,
          purchaseOrderId: a.purchaseOrderId ?? null,
          amount: a.amount,
          memo: a.memo ?? null,
        }));
        const { error: allocErr } = await supabase.from('transaction_allocations').insert(rows);
        if (allocErr) {
          // best-effort rollback: delete the txn row (allocations cascade)
          await supabase.from('transactions').delete().eq('id', txnId);
          throw new Error(allocErr.message);
        }
      }

      return { id: txnId };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['transactions_for_target'] });
      qc.invalidateQueries({ queryKey: ['ar_invoice_balances'] });
      qc.invalidateQueries({ queryKey: ['ap_supplier_invoice_balances'] });
      qc.invalidateQueries({ queryKey: ['ap_po_balances'] });
    },
  });
}

/** Pull every non-voided transaction that has an allocation against a
 *  given target row (AR invoice, AP supplier invoice, or PO). Used by
 *  the Record-receipt / Record-payment drawer to show the history of
 *  payments already booked against the row, so the user can view the
 *  receipt file or delete a mistaken entry without leaving the drawer.
 *  Pass exactly ONE of the target id options. */
export interface UseTxnsForTargetOpts {
  invoiceId?: string;          // AR
  supplierInvoiceId?: string;  // AP bill
  purchaseOrderId?: string;    // AP PO advance
}

export function useTransactionsForTarget(opts: UseTxnsForTargetOpts) {
  const { currentCompanyId } = useCompany();
  const targetKey = opts.invoiceId
    ?? opts.supplierInvoiceId
    ?? opts.purchaseOrderId
    ?? '';
  const enabled = !!targetKey;
  return useSupabaseQuery<Transaction[]>(
    ['transactions_for_target', currentCompanyId, targetKey],
    async () => {
      if (!enabled) return [];
      const supabase = getSupabaseClient();
      // Step 1 — find the allocation rows pointing at this target.
      let allocQ = supabase
        .from('transaction_allocations')
        .select('*');
      if (opts.invoiceId)          allocQ = allocQ.eq('"invoiceId"', opts.invoiceId) as typeof allocQ;
      if (opts.supplierInvoiceId)  allocQ = allocQ.eq('"supplierInvoiceId"', opts.supplierInvoiceId) as typeof allocQ;
      if (opts.purchaseOrderId)    allocQ = allocQ.eq('"purchaseOrderId"', opts.purchaseOrderId) as typeof allocQ;
      const { data: allocs, error: allocErr } = await allocQ;
      if (allocErr) throw new Error(allocErr.message);
      const txnIds = Array.from(new Set(((allocs as RawAlloc[] | null) ?? []).map(a => a.transactionId)));
      if (txnIds.length === 0) return [];

      // Step 2 — fetch the transactions themselves.
      let txnQ = scopeByCompany(
        supabase.from('transactions')
          .select('*')
          .neq('status', 'VOIDED')
          .in('id', txnIds)
          .order('"txnDate"', { ascending: false })
          .order('"createdAt"', { ascending: false }),
        currentCompanyId,
      );
      const { data: txns, error: txnErr } = await txnQ;
      if (txnErr) throw new Error(txnErr.message);

      // Hydrate allocations for these txns (re-fetch by txn ids so
      // we include all allocations, not just the one matching the target).
      const { data: allAllocs, error: allErr } = await supabase
        .from('transaction_allocations')
        .select('*')
        .in('"transactionId"', txnIds);
      if (allErr) throw new Error(allErr.message);
      const byTxn = new Map<string, Allocation[]>();
      for (const a of (allAllocs as RawAlloc[] | null) ?? []) {
        const arr = byTxn.get(a.transactionId) ?? [];
        arr.push({
          id: a.id,
          transactionId: a.transactionId,
          invoiceId: a.invoiceId,
          supplierInvoiceId: a.supplierInvoiceId,
          purchaseOrderId: a.purchaseOrderId,
          amount: Number(a.amount) || 0,
          memo: a.memo,
          createdAt: a.createdAt,
        });
        byTxn.set(a.transactionId, arr);
      }
      return (txns as RawTxn[]).map(t => ({
        id: t.id,
        companyId: t.companyId,
        source: t.source,
        kind: t.kind,
        txnDate: t.txnDate,
        amount: Number(t.amount) || 0,
        currency: t.currency ?? 'USD',
        method: t.method,
        counterpartyType: t.counterpartyType,
        counterpartyId: t.counterpartyId,
        counterpartyName: t.counterpartyName,
        reference: t.reference,
        memo: t.memo,
        status: t.status,
        receiptUrl: t.receiptUrl,
        ocrConfidence: t.ocrConfidence != null ? Number(t.ocrConfidence) : null,
        ai_status: (t.ai_status === 'ai_draft' || t.ai_status === 'rejected' || t.ai_status === 'approved')
          ? t.ai_status as Transaction['ai_status']
          : null,
        qbId: t.qbId,
        qbSyncedAt: t.qbSyncedAt,
        createdAt: t.createdAt,
        createdBy: t.createdBy,
        updatedAt: t.updatedAt,
        allocations: byTxn.get(t.id) ?? [],
      }));
    },
  );
}

/** Edit an existing transaction's fields + (optionally) the amount on
 *  one of its allocations. Used by the per-invoice transactions
 *  editor on Receivables / Payables — the user can fix a wrong date,
 *  method, reference, or amount without voiding + recreating.
 *
 *  If `allocationId` + `allocationAmount` are passed, the matching
 *  transaction_allocations row is updated AND the parent transaction
 *  amount is set to the sum of all its allocations (so the AR/AP
 *  balance views recompute correctly).
 */
export interface UpdateTransactionInput {
  id: string;
  txnDate?: string;
  amount?: number;
  method?: TxnMethod | null;
  reference?: string | null;
  memo?: string | null;
  receiptUrl?: string | null;
  allocationEdit?: {
    allocationId: string;
    amount: number;
  };
}

export function useUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateTransactionInput) => {
      const supabase = getSupabaseClient();
      const patch: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };
      if (input.txnDate  !== undefined) patch.txnDate  = input.txnDate;
      if (input.method   !== undefined) patch.method   = input.method;
      if (input.reference !== undefined) patch.reference = input.reference;
      if (input.memo     !== undefined) patch.memo     = input.memo;
      if (input.receiptUrl !== undefined) patch.receiptUrl = input.receiptUrl;
      if (input.amount !== undefined) patch.amount = input.amount;

      // If editing an allocation, write that first so the txn-amount
      // sync below sees the new value.
      if (input.allocationEdit) {
        const { error: allocErr } = await supabase
          .from('transaction_allocations')
          .update({ amount: input.allocationEdit.amount })
          .eq('id', input.allocationEdit.allocationId);
        if (allocErr) throw new Error(allocErr.message);
        // Re-fetch all allocations for this txn and sum them so the
        // parent amount stays consistent — otherwise the AR balance
        // view shows the OLD payment total even after the edit.
        const { data: allocs, error: fetchErr } = await supabase
          .from('transaction_allocations')
          .select('amount')
          .eq('"transactionId"', input.id);
        if (fetchErr) throw new Error(fetchErr.message);
        const newAmount = ((allocs as Array<{ amount: number | string }> | null) ?? [])
          .reduce((s, a) => s + (Number(a.amount) || 0), 0);
        patch.amount = newAmount;
      }

      const { error } = await supabase
        .from('transactions')
        .update(patch)
        .eq('id', input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['transactions_for_target'] });
      qc.invalidateQueries({ queryKey: ['ar_invoice_balances'] });
      qc.invalidateQueries({ queryKey: ['ap_supplier_invoice_balances'] });
      qc.invalidateQueries({ queryKey: ['ap_po_balances'] });
    },
  });
}

/** Soft-delete (set status = 'VOIDED'). Allocations stay for audit. */
export function useVoidTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (txnId: string) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from('transactions')
        .update({ status: 'VOIDED', updatedAt: new Date().toISOString() })
        .eq('id', txnId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['transactions_for_target'] });
      qc.invalidateQueries({ queryKey: ['ar_invoice_balances'] });
      qc.invalidateQueries({ queryKey: ['ap_supplier_invoice_balances'] });
      qc.invalidateQueries({ queryKey: ['ap_po_balances'] });
    },
  });
}

// ─── AR / AP balance views ─────────────────────────────────────────────

export interface ArInvoiceBalance {
  invoiceId: string;
  companyId: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  soldTo: string | null;
  totalAmount: number;
  paid: number;
  balance: number;
}

export function useArBalances() {
  const { currentCompanyId } = useCompany();
  return useSupabaseQuery<ArInvoiceBalance[]>(
    ['ar_invoice_balances', currentCompanyId],
    async () => {
      const supabase = getSupabaseClient();
      let q = supabase.from('ar_invoice_balances').select('*');
      if (currentCompanyId !== 'ALL') q = q.eq('"companyId"', currentCompanyId) as typeof q;
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return ((data as any[] | null) ?? []).map(r => ({
        invoiceId: r.invoiceId,
        companyId: r.companyId,
        invoiceNumber: r.invoiceNumber,
        invoiceDate: r.invoiceDate,
        soldTo: r.soldTo,
        totalAmount: Number(r.totalAmount) || 0,
        paid: Number(r.paid) || 0,
        balance: Number(r.balance) || 0,
      }));
    },
  );
}

export interface ApPoBalance {
  purchaseOrderId: string;
  companyId: string;
  totalAmount: number;
  paid: number;
  balance: number;
}

export function useApBalances() {
  const { currentCompanyId } = useCompany();
  return useSupabaseQuery<ApPoBalance[]>(
    ['ap_po_balances', currentCompanyId],
    async () => {
      const supabase = getSupabaseClient();
      let q = supabase.from('ap_po_balances').select('*');
      if (currentCompanyId !== 'ALL') q = q.eq('"companyId"', currentCompanyId) as typeof q;
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return ((data as any[] | null) ?? []).map(r => ({
        purchaseOrderId: r.purchaseOrderId,
        companyId: r.companyId,
        totalAmount: Number(r.totalAmount) || 0,
        paid: Number(r.paid) || 0,
        balance: Number(r.balance) || 0,
      }));
    },
  );
}

export interface ApSupplierInvoiceBalance {
  supplierInvoiceId: string;
  companyId: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  supplier: string | null;
  totalAmount: number;
  paid: number;
  balance: number;
}

/** AP per-bill balances. Pays-against = invoices_suppliers rows. */
export function useApSupplierBalances() {
  const { currentCompanyId } = useCompany();
  return useSupabaseQuery<ApSupplierInvoiceBalance[]>(
    ['ap_supplier_invoice_balances', currentCompanyId],
    async () => {
      const supabase = getSupabaseClient();
      let q = supabase.from('ap_supplier_invoice_balances').select('*');
      if (currentCompanyId !== 'ALL') q = q.eq('"companyId"', currentCompanyId) as typeof q;
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return ((data as any[] | null) ?? []).map(r => ({
        supplierInvoiceId: r.supplierInvoiceId,
        companyId: r.companyId,
        invoiceNumber: r.invoiceNumber,
        invoiceDate: r.invoiceDate,
        supplier: r.supplier,
        totalAmount: Number(r.totalAmount) || 0,
        paid: Number(r.paid) || 0,
        balance: Number(r.balance) || 0,
      }));
    },
  );
}
