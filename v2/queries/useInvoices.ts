// Phase 3B — Invoices (AR). Full v1 field parity.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';
import type { LineItem } from '../components/LineItemsEditor';

export interface Invoice {
  id: string;
  companyId: string | null;
  invoiceNumber: string;
  invoiceDate: string | null;
  dateOrder: string | null;
  shipperName: string | null;
  shipperAddress: string | null;
  soldTo: string | null;
  shipTo: string | null;
  consignee: string | null;
  billToName: string | null;
  paymentTerms: string | null;
  incoterm: string | null;
  incoterms: string | null;
  customerPo: string | null;
  carrier: string | null;
  transportRef: string | null;
  freightTerms: string | null;
  items: LineItem[];
  grossWeight: string | null;
  netWeight: string | null;
  tareWeight: string | null;
  totalQuantity: string | null;
  subtotal: number;
  totalAmount: number;
  currency: string;
  remitTo: string | null;
  bankName: string | null;
  bankAddress: string | null;
  swiftCode: string | null;
  routingNumber: string | null;
  accountNumber: string | null;
  originalDocument: string | null;
  supplier: string | null;
  shipper: string | null;
  date: string | null;
  bookingNumber: string | null;
  pod: string | null;
  poa: string | null;
  plNumber: string | null;
  soNumber: string | null;
  memo: string | null;
  containers: string | null;
  createdAt: string;
}

interface Raw {
  id: string;
  companyId: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dateOrder: string | null;
  shipperName: string | null;
  shipperAddress: string | null;
  soldTo: string | null;
  shipTo: string | null;
  consignee: string | null;
  billToName: string | null;
  paymentTerms: string | null;
  incoterm: string | null;
  incoterms: string | null;
  customerPo: string | null;
  carrier: string | null;
  transportRef: string | null;
  freightTerms: string | null;
  items: unknown;
  grossWeight: string | null;
  netWeight: string | null;
  tareWeight: string | null;
  totalQuantity: string | null;
  subtotal: number | string | null;
  totalAmount: number | string | null;
  currency: string | null;
  remitTo: string | null;
  bankName: string | null;
  bankAddress: string | null;
  swiftCode: string | null;
  routingNumber: string | null;
  accountNumber: string | null;
  originalDocument: string | null;
  supplier: string | null;
  shipper: string | null;
  date: string | null;
  bookingNumber: string | null;
  pod: string | null;
  poa: string | null;
  plNumber: string | null;
  soNumber: string | null;
  memo: string | null;
  containers: string | null;
  createdAt: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

const parseItems = (raw: unknown): LineItem[] => {
  try {
    let arr: unknown = raw;
    if (typeof raw === 'string') arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((r: any) => {
      // Legacy invoice rows store product label as `productDescription`
      // or `description` (not `productName`). Mirror v1 SalesFollowUp's
      // fallback chain so older invoices still render a product label.
      const productName = String(
        r?.productName ?? r?.name ?? r?.productDescription ?? r?.description ?? r?.product ?? '',
      ).trim();
      // Quantity can be stored as `quantity`, `qty`, `qtyLbs`,
      // `quantityLbs`, or `grossLbs` depending on the source form.
      const quantity = Number(r?.quantity ?? r?.qty ?? r?.qtyLbs ?? r?.quantityLbs ?? r?.grossLbs) || 0;
      const unitPrice = Number(r?.unitPrice ?? r?.price ?? r?.unitPriceLbs) || 0;
      const total = Number(r?.total ?? r?.amount) || quantity * unitPrice;
      return {
        productId: r?.productId ?? undefined,
        productName,
        customerDescription: r?.customerDescription ?? r?.description ?? '',
        hsCode: r?.hsCode ?? '',
        grade: r?.grade ?? '',
        quantity,
        unitPrice,
        total,
      };
    });
  } catch { return []; }
};

export function useInvoices(search?: string) {
  const { currentCompanyId } = useCompany();
  const needle = search?.trim() ?? '';

  return useSupabaseQuery<Invoice[]>(
    ['invoices', currentCompanyId, needle],
    async () => {
      const supabase = getSupabaseClient();
      // incoterms (plural) is legacy — some rows still use it, the
      // newer rows use `incoterm`. We select both and coalesce in the
      // drawer. `items` on `invoices` is a text column, parsed below.
      let q = scopeByCompany(
        supabase.from('invoices')
          .select('*')
          .order('invoiceDate', { ascending: false, nullsFirst: false })
          .limit(200),
        currentCompanyId,
      );
      if (needle) {
        q = q.or(`invoiceNumber.ilike.*${needle}*,soldTo.ilike.*${needle}*,billToName.ilike.*${needle}*`) as typeof q;
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        companyId: r.companyId,
        invoiceNumber: r.invoiceNumber ?? r.id,
        invoiceDate: r.invoiceDate,
        dateOrder: r.dateOrder,
        shipperName: r.shipperName,
        shipperAddress: r.shipperAddress,
        soldTo: r.soldTo,
        shipTo: r.shipTo,
        consignee: r.consignee,
        billToName: r.billToName,
        paymentTerms: r.paymentTerms,
        incoterm: r.incoterm ?? r.incoterms,
        incoterms: r.incoterms,
        customerPo: r.customerPo,
        carrier: r.carrier,
        transportRef: r.transportRef,
        freightTerms: r.freightTerms,
        items: parseItems(r.items),
        grossWeight: r.grossWeight,
        netWeight: r.netWeight,
        tareWeight: r.tareWeight,
        totalQuantity: r.totalQuantity,
        subtotal: Number(r.subtotal) || 0,
        totalAmount: Number(r.totalAmount) || 0,
        currency: r.currency ?? 'USD',
        remitTo: r.remitTo,
        bankName: r.bankName,
        bankAddress: r.bankAddress,
        swiftCode: r.swiftCode,
        routingNumber: r.routingNumber,
        accountNumber: r.accountNumber,
        originalDocument: r.originalDocument,
        supplier: r.supplier,
        shipper: r.shipper,
        date: r.date,
        bookingNumber: r.bookingNumber,
        pod: r.pod,
        poa: r.poa,
        plNumber: r.plNumber,
        soNumber: r.soNumber,
        memo: r.memo,
        containers: r.containers,
        createdAt: r.createdAt ?? '',
      }));
    },
  );
}
