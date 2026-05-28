// Phase 3B — Payables query (supplier invoices we owe).
//
// Supplier name is carried in `shipperName` on invoices_suppliers —
// `supplier` appears in services/schema.ts but the live column doesn't
// exist. Prefer shipperName with a soldTo fallback.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface Payable {
  id: string;
  invoiceNumber: string;
  /** Display alias — `shipperName` falls back to `soldTo` for legacy
   *  rows where the supplier name was stored in the wrong column. */
  supplier: string | null;
  /** Raw `shipperName` column, used by the edit drawer so changes
   *  round-trip back to the right field. */
  shipperName: string | null;
  shipperAddress: string | null;
  soldTo: string | null;
  shipTo: string | null;
  invoiceDate: string | null;
  paymentTerms: string | null;
  incoterms: string | null;
  dateOrder: string | null;
  customerPo: string | null;
  carrier: string | null;
  transportRef: string | null;
  freightTerms: string | null;
  grossWeight: string | null;
  netWeight: string | null;
  tareWeight: string | null;
  totalQuantity: string | null;
  subtotal: number;
  totalAmount: number;
  currency: string;
  remitTo: string | null;
  bankName: string | null;
  swiftCode: string | null;
  routingNumber: string | null;
  accountNumber: string | null;
  /** Payment lifecycle status. Free-text column on the DB but the v1
   *  flow constrains it to Pending / Approved / Paid / Cancelled. */
  status: string | null;
  qbStatus: string | null;
  notes: string | null;
  /** Data URL of the OCR-source PDF / image (when the bill was
   *  created via AI Upload). Powers the "View original" action. */
  originalDocument: string | null;
  createdAt: string;
}

interface Raw {
  id: string;
  invoiceNumber: string | null;
  shipperName: string | null;
  shipperAddress: string | null;
  soldTo: string | null;
  shipTo: string | null;
  invoiceDate: string | null;
  paymentTerms: string | null;
  incoterms: string | null;
  dateOrder: string | null;
  customerPo: string | null;
  carrier: string | null;
  transportRef: string | null;
  freightTerms: string | null;
  grossWeight: string | null;
  netWeight: string | null;
  tareWeight: string | null;
  totalQuantity: string | null;
  subtotal: number | string | null;
  totalAmount: number | string | null;
  currency: string | null;
  remitTo: string | null;
  bankName: string | null;
  swiftCode: string | null;
  routingNumber: string | null;
  accountNumber: string | null;
  status: string | null;
  qb_status: string | null;
  notes: string | null;
  originalDocument: string | null;
  createdAt: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

export function usePayables(search?: string) {
  const { currentCompanyId } = useCompany();
  const needle = search?.trim() ?? '';

  return useSupabaseQuery<Payable[]>(
    ['payables', currentCompanyId, needle],
    async () => {
      const supabase = getSupabaseClient();
      // Wide select so the edit drawer has every editable column —
      // PostgREST returns nulls for absent columns so this stays safe
      // even on environments where the supplier table is shorter.
      let q = scopeByCompany(
        supabase.from('invoices_suppliers')
          .select(
            // NOTE: `supplier` and `date` live in services/schema.ts as
            // free-text columns but are NOT present on the deployed
            // `invoices_suppliers` table — PostgREST returns
            // `column invoices_suppliers.<col> does not exist` if either
            // is included. Use `shipperName` and `invoiceDate` instead.
            'id, invoiceNumber, shipperName, shipperAddress, soldTo, shipTo, ' +
            'invoiceDate, paymentTerms, incoterms, dateOrder, customerPo, ' +
            'carrier, transportRef, freightTerms, ' +
            'grossWeight, netWeight, tareWeight, totalQuantity, ' +
            'subtotal, totalAmount, currency, ' +
            'remitTo, bankName, swiftCode, routingNumber, accountNumber, ' +
            'status, qb_status, createdAt, notes, "originalDocument"',
          )
          .order('invoiceDate', { ascending: false, nullsFirst: false })
          .limit(200),
        currentCompanyId,
      );
      if (needle) {
        q = q.or(`invoiceNumber.ilike.*${needle}*,shipperName.ilike.*${needle}*`) as typeof q;
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        invoiceNumber: r.invoiceNumber ?? r.id,
        supplier: r.shipperName ?? r.soldTo,
        shipperName: r.shipperName,
        shipperAddress: r.shipperAddress,
        soldTo: r.soldTo,
        shipTo: r.shipTo,
        invoiceDate: r.invoiceDate,
        paymentTerms: r.paymentTerms,
        incoterms: r.incoterms,
        dateOrder: r.dateOrder,
        customerPo: r.customerPo,
        carrier: r.carrier,
        transportRef: r.transportRef,
        freightTerms: r.freightTerms,
        grossWeight: r.grossWeight,
        netWeight: r.netWeight,
        tareWeight: r.tareWeight,
        totalQuantity: r.totalQuantity,
        subtotal: Number(r.subtotal) || 0,
        totalAmount: Number(r.totalAmount) || 0,
        currency: r.currency ?? 'USD',
        remitTo: r.remitTo,
        bankName: r.bankName,
        swiftCode: r.swiftCode,
        routingNumber: r.routingNumber,
        accountNumber: r.accountNumber,
        status: r.status,
        qbStatus: r.qb_status ?? null,
        notes: r.notes,
        originalDocument: r.originalDocument,
        createdAt: r.createdAt ?? '',
      }));
    },
  );
}
