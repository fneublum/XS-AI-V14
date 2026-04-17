// Phase 3B — Packing Lists query.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface PackingList {
  id: string;
  plNumber: string;
  blNumber: string | null;
  soNumber: string | null;
  shipper: string | null;
  consignee: string | null;
  carrier: string | null;
  containerNumber: string | null;
  scheduledShipDate: string | null;
  date: string | null;
  status: string;
  createdAt: string;
}

interface Raw {
  id: string;
  plNumber: string | null;
  blNumber: string | null;
  soNumber: string | null;
  shipper: string | null;
  consignee: string | null;
  carrier: string | null;
  containerNumber: string | null;
  scheduledShipDate: string | null;
  date: string | null;
  status: string | null;
  createdAt: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

export function usePackingLists(search?: string) {
  const { currentCompanyId } = useCompany();
  const needle = search?.trim() ?? '';

  return useSupabaseQuery<PackingList[]>(
    ['packingLists', currentCompanyId, needle],
    async () => {
      const supabase = getSupabaseClient();
      let q = scopeByCompany(
        supabase.from('packing_lists')
          .select('id, plNumber, blNumber, soNumber, shipper, consignee, carrier, containerNumber, scheduledShipDate, date, status, createdAt')
          .order('createdAt', { ascending: false, nullsFirst: false })
          .limit(200),
        currentCompanyId,
      );
      if (needle) {
        q = q.or(`plNumber.ilike.*${needle}*,blNumber.ilike.*${needle}*,consignee.ilike.*${needle}*`) as typeof q;
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        plNumber: r.plNumber ?? r.id,
        blNumber: r.blNumber,
        soNumber: r.soNumber,
        shipper: r.shipper,
        consignee: r.consignee,
        carrier: r.carrier,
        containerNumber: r.containerNumber,
        scheduledShipDate: r.scheduledShipDate,
        date: r.date,
        status: r.status ?? 'DRAFT',
        createdAt: r.createdAt ?? '',
      }));
    },
  );
}
