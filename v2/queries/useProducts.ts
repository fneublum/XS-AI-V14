// Phase 3B — Products catalog query.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface Product {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  grade: string | null;
  hsCode: string | null;
  supplier: string | null;
  price: number | null;
  stockStatus: string | null;
}

interface Raw {
  id: string;
  name: string | null;
  sku: string | null;
  category: string | null;
  grade: string | null;
  hsCode: string | null;
  supplier: string | null;
  price: number | string | null;
  stockStatus: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

export function useProducts(search?: string) {
  const { currentCompanyId } = useCompany();
  const needle = search?.trim() ?? '';

  return useSupabaseQuery<Product[]>(
    ['products', currentCompanyId, needle],
    async () => {
      const supabase = getSupabaseClient();
      let q = scopeByCompany(
        supabase.from('products')
          .select('id, name, sku, category, grade, hsCode, supplier, price, stockStatus')
          .order('name', { ascending: true })
          .limit(200),
        currentCompanyId,
      );
      if (needle) {
        q = q.or(`name.ilike.*${needle}*,sku.ilike.*${needle}*,category.ilike.*${needle}*`) as typeof q;
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        name: r.name ?? '—',
        sku: r.sku,
        category: r.category,
        grade: r.grade,
        hsCode: r.hsCode,
        supplier: r.supplier,
        price: r.price === null || r.price === undefined ? null : Number(r.price),
        stockStatus: r.stockStatus,
      }));
    },
  );
}
