// Phase 3B — Shipments query.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface Shipment {
  id: string;
  containerNumber: string | null;
  blNumber: string | null;
  origin: string | null;
  destination: string | null;
  status: string;
  etd: string | null;
  eta: string | null;
  carrier: string | null;
}

interface Raw {
  id: string;
  containerNumber: string | null;
  blNumber: string | null;
  origin: string | null;
  destination: string | null;
  status: string | null;
  etd: string | null;
  eta: string | null;
  carrier: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

export function useShipments(search?: string) {
  const { currentCompanyId } = useCompany();
  const needle = search?.trim() ?? '';

  return useSupabaseQuery<Shipment[]>(
    ['shipments', currentCompanyId, needle],
    async () => {
      const supabase = getSupabaseClient();
      let q = scopeByCompany(
        supabase.from('shipments')
          .select('id, containerNumber, blNumber, origin, destination, status, etd, eta, carrier')
          .order('etd', { ascending: false, nullsFirst: false })
          .limit(200),
        currentCompanyId,
      );
      if (needle) {
        q = q.or(`containerNumber.ilike.*${needle}*,blNumber.ilike.*${needle}*,carrier.ilike.*${needle}*`) as typeof q;
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        containerNumber: r.containerNumber,
        blNumber: r.blNumber,
        origin: r.origin,
        destination: r.destination,
        status: r.status ?? 'BOOKED',
        etd: r.etd,
        eta: r.eta,
        carrier: r.carrier,
      }));
    },
  );
}
