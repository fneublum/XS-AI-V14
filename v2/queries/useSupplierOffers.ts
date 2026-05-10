// Supplier offers (source step of the Purchase & cost wizard).

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface SupplierOfferItem {
  productName: string;
  quantity: number;
  unitPrice: number;
  total?: number;
  /** Preserved from the offer drawer so Landed cost + cost_calculations
   *  can carry HS/grade/product-id through the wizard. */
  productId?: string | null;
  hsCode?: string | null;
  grade?: string | null;
}

export interface SupplierOffer {
  id: string;
  offerNumber: string;
  companyId: string | null;
  supplierId: string | null;
  supplierName: string;
  items: SupplierOfferItem[];
  totalAmount: number;
  currency: string;
  incoterm: string | null;
  freightType: string | null;
  loadingLocation: string | null;
  originPort: string | null;
  destinationPort: string | null;
  validUntil: string | null;
  paymentTerms: string | null;
  status: string;
  notes: string | null;
  quoteNumber: string | null;
}

interface Raw {
  id: string;
  offerNumber: string | null;
  companyId: string | null;
  supplierId: string | null;
  supplierName: string | null;
  items: unknown;
  totalAmount: number | string | null;
  currency: string | null;
  incoterm: string | null;
  freightType: string | null;
  loadingLocation: string | null;
  originPort: string | null;
  destinationPort: string | null;
  validUntil: string | null;
  paymentTerms: string | null;
  status: string | null;
  notes: string | null;
  quoteNumber: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

const parseItems = (raw: unknown): SupplierOfferItem[] => {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return [];
    return arr.map((r: any) => ({
      productName: String(r?.productName ?? r?.name ?? '').trim(),
      quantity:    Number(r?.quantity)  || 0,
      unitPrice:   Number(r?.unitPrice) || 0,
      total:       Number(r?.total) || undefined,
      productId:   r?.productId ?? null,
      hsCode:      r?.hsCode ?? null,
      grade:       r?.grade ?? null,
    }));
  } catch { return []; }
};

export function useSupplierOffers(search?: string) {
  const { currentCompanyId } = useCompany();
  const needle = search?.trim() ?? '';
  return useSupabaseQuery<SupplierOffer[]>(
    ['supplierOffers', currentCompanyId, needle],
    async () => {
      const sb = getSupabaseClient();
      let q = scopeByCompany(
        sb.from('supplier_offers').select('*')
          .order('validUntil', { ascending: false, nullsFirst: false })
          .limit(300),
        currentCompanyId,
      );
      if (needle) {
        q = q.or(
          `offerNumber.ilike.*${needle}*,supplierName.ilike.*${needle}*,originPort.ilike.*${needle}*,destinationPort.ilike.*${needle}*`,
        ) as typeof q;
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return ((data as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        offerNumber: r.offerNumber ?? r.id,
        companyId: r.companyId,
        supplierId: r.supplierId,
        supplierName: r.supplierName ?? '—',
        items: parseItems(r.items),
        totalAmount: Number(r.totalAmount) || 0,
        currency: r.currency ?? 'USD',
        incoterm: r.incoterm,
        freightType: r.freightType,
        loadingLocation: r.loadingLocation,
        originPort: r.originPort,
        destinationPort: r.destinationPort,
        validUntil: r.validUntil,
        paymentTerms: r.paymentTerms,
        status: r.status ?? 'Received',
        notes: r.notes,
        quoteNumber: r.quoteNumber,
      }));
    },
  );
}
