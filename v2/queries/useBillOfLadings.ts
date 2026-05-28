// Phase 3B — Bill of Ladings query (table name: bill_landings, sic).

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface BillOfLading {
  id: string;
  blNumber: string;
  shipper: string | null;
  consignee: string | null;
  vesselVoyage: string | null;
  portLoading: string | null;
  portDischarge: string | null;
  shippedDate: string | null;
  container: string | null;
  status: string;
  /** Data URL of the original B/L PDF/image, populated by the AI Upload
   *  flow (stored inline on bill_landings.originalDocument). Powers the
   *  "View" action in the list — see BillOfLadingsV2. */
  originalDocument: string | null;
  createdAt: string;
}

interface Raw {
  id: string;
  blNumber: string | null;
  shipper: string | null;
  consignee: string | null;
  vesselVoyage: string | null;
  portLoading: string | null;
  portDischarge: string | null;
  shippedDate: string | null;
  container: string | null;
  status: string | null;
  originalDocument: string | null;
  createdAt: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

export function useBillOfLadings(search?: string) {
  const { currentCompanyId } = useCompany();
  const needle = search?.trim() ?? '';

  return useSupabaseQuery<BillOfLading[]>(
    ['billOfLadings', currentCompanyId, needle],
    async () => {
      const supabase = getSupabaseClient();
      let q = scopeByCompany(
        supabase.from('bill_landings')
          .select('id, blNumber, shipper, consignee, vesselVoyage, portLoading, portDischarge, shippedDate, container, status, "originalDocument", createdAt')
          .order('shippedDate', { ascending: false, nullsFirst: false })
          .limit(200),
        currentCompanyId,
      );
      if (needle) {
        q = q.or(`blNumber.ilike.*${needle}*,shipper.ilike.*${needle}*,consignee.ilike.*${needle}*`) as typeof q;
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as unknown as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        blNumber: r.blNumber ?? r.id,
        shipper: r.shipper,
        consignee: r.consignee,
        vesselVoyage: r.vesselVoyage,
        portLoading: r.portLoading,
        portDischarge: r.portDischarge,
        shippedDate: r.shippedDate,
        container: r.container,
        status: r.status ?? 'ISSUED',
        originalDocument: r.originalDocument,
        createdAt: r.createdAt ?? '',
      }));
    },
  );
}
