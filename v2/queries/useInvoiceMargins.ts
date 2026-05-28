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
//   • Freight cost: auto-attributed via the new freight_quotes.
//     booking_number column (added 20260527210000). Split into
//     local freight (pickup + delivery costs) and ocean freight
//     (ocean cost). When the per-leg breakdown is missing on a
//     quote, the gross `rate` falls into ocean freight as a
//     conservative default (the bulk of EC4/GENRYO freight is
//     ocean).
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
  /** Human-readable reason when supplierCost = 0 — surfaced as the
   *  "—" cell tooltip so the user understands WHY no match landed
   *  ("invoice has no SO#", "no supplier bill carries this SO#",
   *  "override set to 0", etc.). Empty string when cost > 0. */
  supplierCostReason: string;

  /** Total freight = local + ocean (or override). The drawer's
   *  freightCostOverride still drives this single combined figure. */
  freightCost: number;
  freightCostSource: 'freight_quote' | 'override' | 'none';
  freightCostLinkIds: string[];
  freightCostReason: string;
  /** Split of freightCost into the two legs. When the freight quote
   *  doesn't itemise (only `rate` filled), the whole amount goes
   *  into oceanFreightCost. Zero when freightCostSource = 'none'. */
  localFreightCost: number;        // pickup + delivery
  oceanFreightCost: number;        // ocean leg (or unitemised `rate`)

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
  id: string;
  rate: string | number | null;
  pickup_cost: string | number | null;
  ocean_cost: string | number | null;
  delivery_cost: string | number | null;
  booking_number: string | null;
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

  // Freight quotes — snake_case table; joins to sales invoices via
  // freight_quotes.booking_number == invoices.bookingNumber
  // (migration 20260527210000 added the column). No company scope on
  // the SELECT because freight_quotes doesn't have a companyId
  // column — booking_number is uniquish enough to keep results
  // tight for our scale.
  const fqsQ = useSupabaseQuery<RawFQ[]>(
    ['margins_freight_quotes', currentCompanyId],
    async () => {
      const sb = getSupabaseClient();
      const { data, error } = await sb
        .from('freight_quotes')
        .select('id, rate, pickup_cost, ocean_cost, delivery_cost, booking_number')
        .limit(2000);
      if (error) throw new Error(error.message);
      return (data as RawFQ[] | null) ?? [];
    },
  );

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

    // Freight-quote indexes: by id (for explicit-link path) and by
    // booking_number (for the auto-link path).
    const fqById = new Map<string, RawFQ>();
    const fqByBooking = new Map<string, RawFQ[]>();
    for (const fq of fqsQ.data) {
      fqById.set(fq.id, fq);
      const b = normalize(fq.booking_number);
      if (b) (fqByBooking.get(b) ?? fqByBooking.set(b, []).get(b)!).push(fq);
    }
    // Pulls the local + ocean breakdown out of one freight quote.
    // When the per-leg fields are all zero/null but the quote has a
    // rate, attribute the whole thing to ocean (the bulk of EC4 /
    // GENRYO freight is ocean — conservative default that surfaces
    // SOMETHING rather than zero).
    const fqLegs = (fq: RawFQ): { local: number; ocean: number } => {
      const pickup   = num(fq.pickup_cost);
      const delivery = num(fq.delivery_cost);
      const ocean    = num(fq.ocean_cost);
      const local    = pickup + delivery;
      if (local === 0 && ocean === 0) {
        return { local: 0, ocean: num(fq.rate) };
      }
      return { local, ocean };
    };

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
      let supplierReason = '';

      if (costing?.supplierCostOverride != null) {
        supplierCost = num(costing.supplierCostOverride);
        supplierSource = 'override';
        if (supplierCost === 0) supplierReason = 'Override set to $0.';
      } else {
        // Manual link wins over auto-match.
        const explicitSI = csvToIds(costing?.supplierInvoiceIds ?? null);
        const explicitPO = csvToIds(costing?.purchaseOrderIds ?? null);
        if (explicitSI.length > 0) {
          const unresolved: string[] = [];
          for (const sid of explicitSI) {
            const si = supplierById.get(sid);
            if (si) { supplierCost += num(si.totalAmount); supplierLinkIds.push(sid); }
            else unresolved.push(sid);
          }
          supplierSource = 'supplier_invoice';
          if (unresolved.length > 0 && supplierCost === 0) {
            // Linked id exists in the costing row but the bill
            // isn't in our supplier_invoices fetch — usually a
            // stale-cache case after a fresh save. The MarginEditModal
            // now invalidates these queries on save, but log a
            // breadcrumb here so any future regression is visible.
            // eslint-disable-next-line no-console
            console.warn('[useInvoiceMargins] linked supplier-invoice ids not in scope:', unresolved, 'for invoice', inv.id);
            supplierReason = `Linked supplier bill ${unresolved.join(', ')} not in current scope. Reload the page or pick another bill.`;
          }
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
          } else {
            // Diagnose: tell the user WHY no auto-match landed so
            // the "—" cell tooltip is actionable instead of mysterious.
            if (!soKey && !bkKey) {
              supplierReason = 'Invoice has no SO# or Booking# — auto-match needs at least one. Override manually via the row drawer.';
            } else if (!soKey) {
              supplierReason = `No supplier bill carries this booking ref (${inv.bookingNumber}) and the invoice has no SO# to match either.`;
            } else if (!bkKey) {
              supplierReason = `No supplier bill carries this SO# (${inv.soNumber}) in its Customer PO field. Update the bill's Customer PO to "${inv.soNumber}" or override manually.`;
            } else {
              supplierReason = `No supplier bill carries this SO# (${inv.soNumber}) in customerPo or this Booking# (${inv.bookingNumber}) in transportRef.`;
            }
          }
        }
      }

      // ── Freight cost ───────────────────────────────────────────
      // Priority: override > explicit CSV link > auto-match by
      // booking_number. The override is a single combined figure
      // (legs unknown), so when an override is in play we credit
      // the whole amount to ocean by convention. Otherwise both
      // local and ocean are itemised from the matching freight
      // quote(s).
      let freightCost = 0;
      let localFreightCost = 0;
      let oceanFreightCost = 0;
      let freightSource: InvoiceMarginRow['freightCostSource'] = 'none';
      let freightLinkIds: string[] = [];
      let freightReason = '';

      if (costing?.freightCostOverride != null) {
        freightCost = num(costing.freightCostOverride);
        oceanFreightCost = freightCost;  // legs unknown — bucket to ocean
        freightSource = 'override';
        if (freightCost === 0) freightReason = 'Override set to $0.';
      } else {
        const explicitFQ = csvToIds(costing?.freightQuoteIds ?? null);
        const matches: RawFQ[] = [];
        const unresolvedFQ: string[] = [];
        if (explicitFQ.length > 0) {
          for (const fid of explicitFQ) {
            const fq = fqById.get(fid);
            if (fq) matches.push(fq);
            else unresolvedFQ.push(fid);
          }
        } else {
          const bkKey = normalize(inv.bookingNumber);
          if (bkKey) (fqByBooking.get(bkKey) ?? []).forEach(m => matches.push(m));
        }
        if (matches.length > 0) {
          for (const fq of matches) {
            const legs = fqLegs(fq);
            localFreightCost += legs.local;
            oceanFreightCost += legs.ocean;
            freightLinkIds.push(fq.id);
          }
          freightCost = localFreightCost + oceanFreightCost;
          freightSource = 'freight_quote';
        } else if (unresolvedFQ.length > 0) {
          // eslint-disable-next-line no-console
          console.warn('[useInvoiceMargins] linked freight-quote ids not in scope:', unresolvedFQ, 'for invoice', inv.id);
          freightReason = `Linked freight quote ${unresolvedFQ.join(', ')} not in current scope. Reload the page or pick another quote.`;
        } else {
          if (!inv.bookingNumber) {
            freightReason = 'Invoice has no Booking# — auto-match needs it. Override manually via the row drawer.';
          } else {
            freightReason = `No freight quote has booking_number="${inv.bookingNumber}". Backfill the quote's Booking# (snake_case column in freight_quotes) or override manually.`;
          }
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
        supplierCostReason: supplierReason,
        freightCost,
        freightCostSource: freightSource,
        freightCostLinkIds: freightLinkIds,
        freightCostReason: freightReason,
        localFreightCost,
        oceanFreightCost,
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
