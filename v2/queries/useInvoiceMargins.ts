// Per-invoice margin engine.
//
// For each sales invoice in scope, attributes supplier cost +
// freight cost + manually-entered "other" costs, then computes
// landed cost / margin $ / margin %.
//
// Cost attribution (auto):
//   • Supplier cost: prefer matching invoices_suppliers rows (by
//     customerPo == sales.soNumber), fall back to purchase_orders
//     when the supplier bill hasn't arrived yet. Per-user choice
//     in the design doc — "Both, prefer supplier invoice".
//   • Freight cost: NO auto-attribution in v1. The freight_quotes
//     table is snake_case end-to-end and carries no bookingNumber
//     column, so there's no reliable join key from a sales invoice
//     to its freight cost. Users enter freight via the override
//     drawer (freightCostOverride) until we wire a real bridge.
//   • Other (duty / brokerage / insurance / bank fees / misc):
//     entered manually in invoice_costings.
//
// Overrides: invoice_costings.{supplierCostOverride,
// freightCostOverride} replace the auto-computed value when set
// (non-null). The detail drawer also accepts explicit linkage
// (supplierInvoiceIds / purchaseOrderIds / freightQuoteIds) as a
// CSV — when present the auto-match is bypassed entirely.
//
// All math is client-side; the hook fans out four base queries
// (invoices, supplier-invoices, purchase-orders, freight-quotes,
// invoice-costings) and joins in JS. Light enough that we can
// re-compute on every render.

import { useMemo } from 'react';
import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface InvoiceCosting {
  invoiceId: string;
  companyId: string | null;
  supplierCostOverride: number | null;
  freightCostOverride: number | null;
  dutyUSD: number;
  brokerageUSD: number;
  insuranceUSD: number;
  bankFeesUSD: number;
  otherUSD: number;
  notes: string | null;
  supplierInvoiceIds: string | null;
  purchaseOrderIds: string | null;
  freightQuoteIds: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface InvoiceMarginRow {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  customerName: string | null;
  bookingNumber: string | null;
  soNumber: string | null;
  currency: string;

  revenue: number;

  supplierCost: number;
  supplierCostSource: 'supplier_invoice' | 'purchase_order' | 'override' | 'none';
  supplierCostLinkIds: string[];   // ids feeding supplierCost (for the drawer)

  freightCost: number;
  freightCostSource: 'freight_quote' | 'override' | 'none';
  freightCostLinkIds: string[];

  otherCost: number;               // sum of duty + brokerage + insurance + bankFees + other
  landedCost: number;              // supplier + freight + other
  marginUSD: number;               // revenue − landed
  marginPct: number;               // marginUSD / revenue (0 when revenue=0)

  /** When true, the row has a costing-override row in DB. */
  hasOverrides: boolean;
}

const normalize = (s: string | null | undefined): string =>
  (s || '').trim().toLowerCase();

const csvToIds = (raw: string | null): string[] =>
  (raw || '').split(',').map(s => s.trim()).filter(Boolean);

interface RawInvoice {
  id: string; companyId: string | null; invoiceNumber: string | null;
  invoiceDate: string | null; soldTo: string | null;
  bookingNumber: string | null; soNumber: string | null;
  totalAmount: string | number | null; currency: string | null;
}
interface RawSupplierInvoice {
  id: string; companyId: string | null;
  customerPo: string | null; transportRef: string | null;
  totalAmount: string | number | null; currency: string | null;
  invoiceNumber: string | null; shipperName: string | null;
}
interface RawPO {
  id: string; companyId: string | null;
  totalAmount: string | number | null; currency: string | null;
  items: unknown; supplierName: string | null;
}
interface RawFQ {
  id: string; companyId: string | null;
  rate: string | number | null;
  quote_number?: string | null;
  bookingNumber: string | null;
}
interface RawCosting {
  invoiceId: string; companyId: string | null;
  supplierCostOverride: string | number | null;
  freightCostOverride:  string | number | null;
  dutyUSD: string | number | null;
  brokerageUSD: string | number | null;
  insuranceUSD: string | number | null;
  bankFeesUSD: string | number | null;
  otherUSD: string | number | null;
  notes: string | null;
  supplierInvoiceIds: string | null;
  purchaseOrderIds: string | null;
  freightQuoteIds: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

const num = (v: string | number | null | undefined): number =>
  v == null ? 0 : Number(v) || 0;

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

export function useInvoiceMargins() {
  const { currentCompanyId } = useCompany();

  // ── Base queries (parallel via useSupabaseQuery's React Query) ──
  const invoicesQ = useSupabaseQuery<RawInvoice[]>(
    ['margins_invoices', currentCompanyId],
    async () => {
      const sb = getSupabaseClient();
      const { data, error } = await scopeByCompany(
        sb.from('invoices')
          .select('id, "companyId", "invoiceNumber", "invoiceDate", "soldTo", "bookingNumber", "soNumber", "totalAmount", currency')
          .order('"invoiceDate"', { ascending: false, nullsFirst: false })
          .limit(2000),
        currentCompanyId,
      );
      if (error) throw new Error(error.message);
      return (data as RawInvoice[] | null) ?? [];
    },
  );

  const supplierInvoicesQ = useSupabaseQuery<RawSupplierInvoice[]>(
    ['margins_supplier_invoices', currentCompanyId],
    async () => {
      const sb = getSupabaseClient();
      const { data, error } = await scopeByCompany(
        sb.from('invoices_suppliers')
          .select('id, "companyId", "customerPo", "transportRef", "totalAmount", currency, "invoiceNumber", "shipperName"')
          .limit(2000),
        currentCompanyId,
      );
      if (error) throw new Error(error.message);
      return (data as RawSupplierInvoice[] | null) ?? [];
    },
  );

  const posQ = useSupabaseQuery<RawPO[]>(
    ['margins_purchase_orders', currentCompanyId],
    async () => {
      const sb = getSupabaseClient();
      const { data, error } = await scopeByCompany(
        sb.from('purchase_orders')
          .select('id, "companyId", "totalAmount", currency, items, "supplierName"')
          .limit(2000),
        currentCompanyId,
      );
      if (error) throw new Error(error.message);
      return (data as RawPO[] | null) ?? [];
    },
  );

  // Freight-quotes auto-fetch removed: the live freight_quotes
  // table is snake_case and has no bookingNumber, so there's no
  // viable join key right now. Keep a stub query that always
  // resolves to [] so the rest of the engine doesn't have to
  // change shape; the override drawer is the only way to set
  // freight cost until we add a real link.
  const fqsQ = { data: [] as RawFQ[], isLoading: false, error: null as Error | null, refetch: () => {} };

  const costingsQ = useSupabaseQuery<RawCosting[]>(
    ['margins_costings', currentCompanyId],
    async () => {
      const sb = getSupabaseClient();
      const { data, error } = await scopeByCompany(
        sb.from('invoice_costings')
          .select('*')
          .limit(2000),
        currentCompanyId,
      );
      if (error) throw new Error(error.message);
      return (data as RawCosting[] | null) ?? [];
    },
  );

  // ── Index lookups so the join is O(N) instead of O(N²) ──
  const rows = useMemo<InvoiceMarginRow[] | undefined>(() => {
    if (!invoicesQ.data
      || !supplierInvoicesQ.data
      || !posQ.data
      || !fqsQ.data
      || !costingsQ.data) return undefined;

    // Index supplier invoices by normalised customerPo + transportRef
    const supplierByCustomerPo = new Map<string, RawSupplierInvoice[]>();
    const supplierByTransportRef = new Map<string, RawSupplierInvoice[]>();
    const supplierById = new Map<string, RawSupplierInvoice>();
    for (const si of supplierInvoicesQ.data) {
      supplierById.set(si.id, si);
      const cp = normalize(si.customerPo); if (cp) (supplierByCustomerPo.get(cp) ?? supplierByCustomerPo.set(cp, []).get(cp)!).push(si);
      const tr = normalize(si.transportRef); if (tr) (supplierByTransportRef.get(tr) ?? supplierByTransportRef.set(tr, []).get(tr)!).push(si);
    }

    // POs aren't booking-linked at the row level; we surface PO totals
    // only when the user has manually linked them via the override CSV.
    const poById = new Map<string, RawPO>();
    for (const po of posQ.data) poById.set(po.id, po);

    // Freight-quote map (id-only). Booking-keyed lookup dropped —
    // the live freight_quotes table doesn't carry bookingNumber.
    const fqById = new Map<string, RawFQ>();
    for (const fq of fqsQ.data) fqById.set(fq.id, fq);

    // Costings by invoiceId
    const costingByInvoice = new Map<string, RawCosting>();
    for (const c of costingsQ.data) costingByInvoice.set(c.invoiceId, c);

    return invoicesQ.data.map<InvoiceMarginRow>(inv => {
      const revenue  = num(inv.totalAmount);
      const currency = inv.currency || 'USD';
      const costing  = costingByInvoice.get(inv.id);

      // ── Supplier cost ──────────────────────────────────────────
      let supplierCost = 0;
      let supplierSource: InvoiceMarginRow['supplierCostSource'] = 'none';
      let supplierLinkIds: string[] = [];

      if (costing?.supplierCostOverride != null) {
        supplierCost = num(costing.supplierCostOverride);
        supplierSource = 'override';
      } else {
        // Manual link wins over auto-match.
        const explicitSI = csvToIds(costing?.supplierInvoiceIds ?? null);
        const explicitPO = csvToIds(costing?.purchaseOrderIds ?? null);
        if (explicitSI.length > 0) {
          for (const sid of explicitSI) {
            const si = supplierById.get(sid);
            if (si) { supplierCost += num(si.totalAmount); supplierLinkIds.push(sid); }
          }
          supplierSource = 'supplier_invoice';
        } else if (explicitPO.length > 0) {
          for (const pid of explicitPO) {
            const po = poById.get(pid);
            if (po) { supplierCost += num(po.totalAmount); supplierLinkIds.push(pid); }
          }
          supplierSource = 'purchase_order';
        } else {
          // Auto-match: prefer supplier invoice via customerPo ==
          // sales soNumber (or transportRef == bookingNumber as a
          // secondary hint).
          const soKey  = normalize(inv.soNumber);
          const bkKey  = normalize(inv.bookingNumber);
          const matches: RawSupplierInvoice[] = [];
          if (soKey) (supplierByCustomerPo.get(soKey) ?? []).forEach(m => matches.push(m));
          if (bkKey) (supplierByTransportRef.get(bkKey) ?? []).forEach(m => matches.push(m));
          // Dedupe by id
          const seen = new Set<string>();
          const unique = matches.filter(m => seen.has(m.id) ? false : (seen.add(m.id), true));
          if (unique.length > 0) {
            for (const m of unique) { supplierCost += num(m.totalAmount); supplierLinkIds.push(m.id); }
            supplierSource = 'supplier_invoice';
          }
        }
      }

      // ── Freight cost ───────────────────────────────────────────
      // No auto-attribution today (see fqsQ comment). Cost comes
      // from the override, or from explicit freight_quote ids
      // when the user has manually linked them via the drawer.
      let freightCost = 0;
      let freightSource: InvoiceMarginRow['freightCostSource'] = 'none';
      let freightLinkIds: string[] = [];

      if (costing?.freightCostOverride != null) {
        freightCost = num(costing.freightCostOverride);
        freightSource = 'override';
      } else {
        const explicitFQ = csvToIds(costing?.freightQuoteIds ?? null);
        if (explicitFQ.length > 0) {
          for (const fid of explicitFQ) {
            const fq = fqById.get(fid);
            if (fq) { freightCost += num(fq.rate); freightLinkIds.push(fid); }
          }
          if (freightLinkIds.length > 0) freightSource = 'freight_quote';
        }
      }

      // ── Other cost — straight from costings if present ─────────
      const otherCost = costing
        ? num(costing.dutyUSD)
          + num(costing.brokerageUSD)
          + num(costing.insuranceUSD)
          + num(costing.bankFeesUSD)
          + num(costing.otherUSD)
        : 0;

      const landedCost = supplierCost + freightCost + otherCost;
      const marginUSD  = revenue - landedCost;
      const marginPct  = revenue > 0 ? marginUSD / revenue : 0;

      return {
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber || inv.id,
        invoiceDate: inv.invoiceDate,
        customerName: inv.soldTo,
        bookingNumber: inv.bookingNumber,
        soNumber: inv.soNumber,
        currency,
        revenue,
        supplierCost,
        supplierCostSource: supplierSource,
        supplierCostLinkIds: supplierLinkIds,
        freightCost,
        freightCostSource: freightSource,
        freightCostLinkIds: freightLinkIds,
        otherCost,
        landedCost,
        marginUSD,
        marginPct,
        hasOverrides: !!costing,
      };
    });
  }, [invoicesQ.data, supplierInvoicesQ.data, posQ.data, fqsQ.data, costingsQ.data]);

  return {
    data: rows,
    isLoading: invoicesQ.isLoading
      || supplierInvoicesQ.isLoading
      || posQ.isLoading
      || fqsQ.isLoading
      || costingsQ.isLoading,
    error: invoicesQ.error
      ?? supplierInvoicesQ.error
      ?? posQ.error
      ?? fqsQ.error
      ?? costingsQ.error,
    refetch: () => {
      invoicesQ.refetch();
      supplierInvoicesQ.refetch();
      posQ.refetch();
      fqsQ.refetch();
      costingsQ.refetch();
    },
  };
}

/** Upsert an invoice_costings row. Pass the full shape; nulls clear
 *  fields. Used by the per-invoice cost-override drawer. */
export async function upsertInvoiceCosting(input: Partial<InvoiceCosting> & { invoiceId: string }): Promise<void> {
  const sb = getSupabaseClient();
  const row: Record<string, unknown> = {
    invoiceId: input.invoiceId,
    companyId: input.companyId ?? null,
    supplierCostOverride: input.supplierCostOverride ?? null,
    freightCostOverride:  input.freightCostOverride  ?? null,
    dutyUSD:       input.dutyUSD       ?? 0,
    brokerageUSD:  input.brokerageUSD  ?? 0,
    insuranceUSD:  input.insuranceUSD  ?? 0,
    bankFeesUSD:   input.bankFeesUSD   ?? 0,
    otherUSD:      input.otherUSD      ?? 0,
    notes:               input.notes               ?? null,
    supplierInvoiceIds:  input.supplierInvoiceIds  ?? null,
    purchaseOrderIds:    input.purchaseOrderIds    ?? null,
    freightQuoteIds:     input.freightQuoteIds     ?? null,
    updatedAt: new Date().toISOString(),
    updatedBy: input.updatedBy ?? null,
  };
  const { error } = await sb.from('invoice_costings').upsert(row, { onConflict: 'invoiceId' });
  if (error) throw new Error(error.message);
}
