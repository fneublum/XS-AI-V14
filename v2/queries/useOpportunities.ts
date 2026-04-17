// Phase 3B — Opportunities (sales pipeline) query.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface Opportunity {
  id: string;
  customerName: string;
  productName: string | null;
  volumeLBS: number | null;
  value: number | null;
  stage: string;
  probability: number | null;
  expectedCloseDate: string | null;
  assignedTo: string | null;
}

interface Raw {
  id: string;
  customerName: string | null;
  productName: string | null;
  volumeLBS: number | string | null;
  value: number | string | null;
  stage: string | null;
  probability: number | string | null;
  expectedCloseDate: string | null;
  assignedTo: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

export function useOpportunities(search?: string) {
  const { currentCompanyId } = useCompany();
  const needle = search?.trim() ?? '';

  return useSupabaseQuery<Opportunity[]>(
    ['opportunities', currentCompanyId, needle],
    async () => {
      const supabase = getSupabaseClient();
      let q = scopeByCompany(
        supabase.from('opportunities')
          .select('id, customerName, productName, volumeLBS, value, stage, probability, expectedCloseDate, assignedTo')
          .order('value', { ascending: false, nullsFirst: false })
          .limit(200),
        currentCompanyId,
      );
      if (needle) {
        q = q.or(`customerName.ilike.*${needle}*,productName.ilike.*${needle}*,stage.ilike.*${needle}*`) as typeof q;
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        customerName: r.customerName ?? '—',
        productName: r.productName,
        volumeLBS: r.volumeLBS === null || r.volumeLBS === undefined ? null : Number(r.volumeLBS),
        value: r.value === null || r.value === undefined ? null : Number(r.value),
        stage: r.stage ?? 'LEAD',
        probability: r.probability === null || r.probability === undefined ? null : Number(r.probability),
        expectedCloseDate: r.expectedCloseDate,
        assignedTo: r.assignedTo,
      }));
    },
  );
}
