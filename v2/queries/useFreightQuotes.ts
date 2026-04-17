// Phase 3B — Freight quotes query.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface FreightQuote {
  id: string;
  agentName: string | null;
  carrier: string | null;
  freightType: string | null;
  originPort: string | null;
  destinationPort: string | null;
  rate: number | null;
  currency: string;
  validUntil: string | null;
  transitTime: number | null;
  status: string;
}

interface Raw {
  id: string;
  agentName: string | null;
  carrier: string | null;
  freightType: string | null;
  originPort: string | null;
  destinationPort: string | null;
  rate: number | string | null;
  currency: string | null;
  validUntil: string | null;
  transitTime: number | string | null;
  status: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

export function useFreightQuotes(search?: string) {
  const { currentCompanyId } = useCompany();
  const needle = search?.trim() ?? '';

  return useSupabaseQuery<FreightQuote[]>(
    ['freightQuotes', currentCompanyId, needle],
    async () => {
      const supabase = getSupabaseClient();
      let q = scopeByCompany(
        supabase.from('freight_quotes')
          .select('id, agentName, carrier, freightType, originPort, destinationPort, rate, currency, validUntil, transitTime, status')
          .order('validUntil', { ascending: false, nullsFirst: false })
          .limit(200),
        currentCompanyId,
      );
      if (needle) {
        q = q.or(`agentName.ilike.*${needle}*,carrier.ilike.*${needle}*,originPort.ilike.*${needle}*,destinationPort.ilike.*${needle}*`) as typeof q;
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        agentName: r.agentName,
        carrier: r.carrier,
        freightType: r.freightType,
        originPort: r.originPort,
        destinationPort: r.destinationPort,
        rate: r.rate === null || r.rate === undefined ? null : Number(r.rate),
        currency: r.currency ?? 'USD',
        validUntil: r.validUntil,
        transitTime: r.transitTime === null || r.transitTime === undefined ? null : Number(r.transitTime),
        status: r.status ?? 'ACTIVE',
      }));
    },
  );
}
