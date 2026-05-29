// Phase 3B — Purchase orders. Full v1 field parity.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';
import type { LineItem } from '../components/LineItemsEditor';

export interface PurchaseOrder {
  id: string;
  companyId: string | null;
  supplierId: string | null;
  supplierName: string;
  status: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
  paymentTerms: string | null;
  items: LineItem[];
  /** Local freight the buyer owes the supplier on top of the goods
   *  subtotal (e.g. inland freight to port). Stored separately from
   *  the line items so reports can tell freight apart from goods.
   *  Mirrors invoices_suppliers."freightAmount". */
  freightAmount: number;
  /** Always = subtotal(items) + freightAmount. Persisted on save so
   *  cash-flow / payables can read a single field. */
  totalAmount: number;
  currency: string;
  notes: string | null;
  /** Supplier-issued proforma invoice attached to the PO (data URL of
   *  the uploaded PDF/image). Null when nothing has been uploaded yet.
   *  Same storage convention as invoices."originalDocument" and
   *  expenses."paymentReceiptUrl". */
  proformaInvoiceUrl: string | null;
}

interface RawRow {
  id: string;
  companyId: string | null;
  supplierId: string | null;
  supplierName: string | null;
  status: string | null;
  orderDate: string | null;
  expectedDeliveryDate: string | null;
  paymentTerms: string | null;
  items: unknown;
  freightAmount: number | string | null;
  totalAmount: number | string | null;
  currency: string | null;
  notes: string | null;
  proformaInvoiceUrl: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

const parseItems = (raw: unknown): LineItem[] => {
  try {
    let arr: unknown = raw;
    if (typeof raw === 'string') arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((r: any) => ({
      productId: r?.productId ?? undefined,
      productName: r?.productName ?? r?.name ?? '',
      customerDescription: r?.customerDescription ?? r?.description ?? '',
      hsCode: r?.hsCode ?? '',
      grade: r?.grade ?? '',
      quantity: Number(r?.quantity) || 0,
      unitPrice: Number(r?.unitPrice ?? r?.price) || 0,
      total: Number(r?.total) || ((Number(r?.quantity) || 0) * (Number(r?.unitPrice ?? r?.price) || 0)),
    }));
  } catch { return []; }
};

export function usePurchaseOrders(search?: string) {
  const { currentCompanyId } = useCompany();
  const normalizedSearch = search?.trim() ?? '';

  return useSupabaseQuery<PurchaseOrder[]>(
    ['purchaseOrders', currentCompanyId, normalizedSearch],
    async () => {
      const supabase = getSupabaseClient();
      let q = scopeByCompany(
        supabase
          .from('purchase_orders')
          .select('*')
          .order('orderDate', { ascending: false, nullsFirst: false })
          .limit(200),
        currentCompanyId,
      );

      if (normalizedSearch) {
        q = q.or(
          `id.ilike.*${normalizedSearch}*,supplierName.ilike.*${normalizedSearch}*`,
        ) as typeof q;
      }

      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as RawRow[] | null) ?? []).map(r => ({
        id: r.id,
        companyId: r.companyId,
        supplierId: r.supplierId,
        supplierName: r.supplierName ?? '—',
        status: r.status ?? 'PENDING',
        orderDate: r.orderDate ?? '',
        expectedDeliveryDate: r.expectedDeliveryDate,
        paymentTerms: r.paymentTerms,
        items: parseItems(r.items),
        freightAmount: Number(r.freightAmount) || 0,
        totalAmount: Number(r.totalAmount) || 0,
        currency: r.currency ?? 'USD',
        notes: r.notes,
        proformaInvoiceUrl: r.proformaInvoiceUrl,
      }));
    },
  );
}
