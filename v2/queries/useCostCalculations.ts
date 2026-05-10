// v1 `cost_calculations` — landed-cost rollups with recommendedSalesPrice.
// Feeds the Price list step (step 4) of the Purchase & cost wizard.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface CostCalculation {
  id: string;
  companyId: string | null;
  calculationNumber: string | null;
  date: string | null;
  productName: string;
  hsCode: string | null;
  origin: string | null;
  destination: string | null;
  pickupLocation: string | null;
  fobPrice: number;
  quantity: number;
  unitLandedCost: number;
  recommendedSalesPrice: number;
  marginPercent: number;
  supplierName: string | null;
  customerName: string | null;
  poa: string | null;
  pod: string | null;
  deliveryMethod: string | null;
  quoteNumber: string | null;
}

interface Raw {
  [k: string]: unknown;
  id: string;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

const asNum = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const asStr = (v: unknown): string | null => typeof v === 'string' ? v : null;

export function useCostCalculations() {
  const { currentCompanyId } = useCompany();
  return useSupabaseQuery<CostCalculation[]>(
    ['costCalculations', currentCompanyId],
    async () => {
      const sb = getSupabaseClient();
      const q = scopeByCompany(
        sb.from('cost_calculations').select('*')
          .order('date', { ascending: false, nullsFirst: false })
          .limit(500),
        currentCompanyId,
      );
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return ((data as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        companyId: asStr(r.companyId),
        calculationNumber: asStr(r.calculationNumber),
        date: asStr(r.date),
        productName: (asStr(r.productName) ?? '—'),
        hsCode: asStr(r.hsCode),
        origin: asStr(r.origin),
        destination: asStr(r.destination),
        pickupLocation: asStr(r.pickupLocation),
        fobPrice:             asNum(r.fobPrice),
        quantity:             asNum(r.quantity),
        unitLandedCost:       asNum(r.unitLandedCost),
        recommendedSalesPrice: asNum(r.recommendedSalesPrice),
        marginPercent:        asNum(r.marginPercent),
        supplierName: asStr(r.supplierName),
        customerName: asStr(r.customerName),
        poa: asStr(r.poa),
        pod: asStr(r.pod),
        deliveryMethod: asStr(r.deliveryMethod),
        quoteNumber: asStr(r.quoteNumber),
      }));
    },
  );
}
