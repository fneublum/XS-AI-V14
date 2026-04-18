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
  originPortCode: string | null;
  destinationPortCode: string | null;
  rate: number | null;
  currency: string;
  validUntil: string | null;
  freeTime: number | null;
  transitTime: number | null;
  status: string;
}

// The `freight_quotes` table is snake_case end-to-end (company_id,
// valid_until, agent_name, freight_type, transit_time, destination_port).
// That's why both filter and select use snake_case column names here,
// unlike the rest of the v2 queries that hit camelCase tables.
interface Raw {
  id: string;
  agent_name: string | null;
  carrier: string | null;
  freight_type: string | null;
  origin_port: string | null;
  destination_port: string | null;
  origin_port_code: string | null;
  destination_port_code: string | null;
  rate: number | string | null;
  currency: string | null;
  valid_until: string | null;
  free_time: number | string | null;
  transit_time: number | string | null;
  status: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('company_id', companyId) as Q);
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
          .select('*')
          .order('valid_until', { ascending: false, nullsFirst: false })
          .limit(200),
        currentCompanyId,
      );
      if (needle) {
        q = q.or(
          `agent_name.ilike.*${needle}*,carrier.ilike.*${needle}*,` +
          `origin_port.ilike.*${needle}*,destination_port.ilike.*${needle}*,` +
          `origin_port_code.ilike.*${needle}*,destination_port_code.ilike.*${needle}*`,
        ) as typeof q;
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        agentName: r.agent_name,
        carrier: r.carrier,
        freightType: r.freight_type,
        originPort: r.origin_port,
        destinationPort: r.destination_port,
        originPortCode: r.origin_port_code,
        destinationPortCode: r.destination_port_code,
        rate: r.rate === null || r.rate === undefined ? null : Number(r.rate),
        currency: r.currency ?? 'USD',
        validUntil: r.valid_until,
        freeTime: r.free_time === null || r.free_time === undefined ? null : Number(r.free_time),
        transitTime: r.transit_time === null || r.transit_time === undefined ? null : Number(r.transit_time),
        status: r.status ?? 'ACTIVE',
      }));
    },
  );
}
