// Phase 3B — Inventory query.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface InventoryItem {
  id: string;
  productName: string;
  grade: string | null;
  quantityLBS: number;
  warehouseLocation: string | null;
  lastUpdated: string | null;
  notes: string | null;
}

interface Raw {
  id: string;
  productName: string | null;
  grade: string | null;
  quantityLBS: number | string | null;
  warehouseLocation: string | null;
  lastUpdated: string | null;
  notes: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

export function useInventory(search?: string) {
  const { currentCompanyId } = useCompany();
  const needle = search?.trim() ?? '';

  return useSupabaseQuery<InventoryItem[]>(
    ['inventory', currentCompanyId, needle],
    async () => {
      const supabase = getSupabaseClient();
      let q = scopeByCompany(
        supabase.from('inventory')
          .select('id, productName, grade, quantityLBS, warehouseLocation, lastUpdated, notes')
          .order('productName', { ascending: true })
          .limit(200),
        currentCompanyId,
      );
      if (needle) {
        q = q.or(`productName.ilike.*${needle}*,warehouseLocation.ilike.*${needle}*,grade.ilike.*${needle}*`) as typeof q;
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        productName: r.productName ?? '—',
        grade: r.grade,
        quantityLBS: Number(r.quantityLBS) || 0,
        warehouseLocation: r.warehouseLocation,
        lastUpdated: r.lastUpdated,
        notes: r.notes,
      }));
    },
  );
}
