// Phase 3B — Products catalog query. Full v1 parity.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export type StockStatus = 'Available' | 'Low Stock' | 'Backorder';
export type ProductType = 'resale' | 'commission';

export interface ProductSpecs {
  origin?: string | null;
  type?: string | null;
  color?: string | null;
  reinforced?: string | null;
  additives?: string | null;
  form?: string | null;
  rv?: string | null;
  process?: string | null;
  packages?: string | null;
  mfr?: string | null;
}

export interface Product {
  id: string;
  companyId: string | null;
  name: string;
  supplierProductName: string | null;
  description: string | null;
  sku: string | null;
  category: string | null;
  grade: string | null;
  hsCode: string | null;
  supplier: string | null;
  price: number | null;
  stockStatus: StockStatus | string | null;
  specs: ProductSpecs;
  tdsFile: string | null;
  tdsUrl: string | null;
  sharedWith: string[];
  imageIds: string[];
  productType: ProductType | string | null;
}

interface Raw {
  id: string;
  companyId: string | null;
  name: string | null;
  supplierProductName: string | null;
  sku: string | null;
  category: string | null;
  grade: string | null;
  hsCode: string | null;
  supplier: string | null;
  price: number | string | null;
  stockStatus: string | null;
  specs: unknown;
  tdsFile: string | null;
  tdsUrl: string | null;
  sharedWith: string[] | null;
  imageIds: string[] | null;
}

function scopeByCompany<Q extends { eq: Function; or: Function }>(q: Q, companyId: string): Q {
  if (companyId === 'ALL') return q;
  // v1 parity: a product is visible if companyId matches OR the current
  // company is in the `sharedWith` array.
  return q.or(`"companyId".eq.${companyId},"sharedWith".cs.{${companyId}}`) as Q;
}

const normalizeSpecs = (raw: unknown): ProductSpecs => {
  if (!raw || typeof raw !== 'object') return {};
  const s = raw as Record<string, unknown>;
  const pick = (k: string): string | null =>
    typeof s[k] === 'string' ? (s[k] as string) : null;
  return {
    origin: pick('origin'),
    type: pick('type'),
    color: pick('color'),
    reinforced: pick('reinforced'),
    additives: pick('additives'),
    form: pick('form'),
    rv: pick('rv'),
    process: pick('process'),
    packages: pick('packages'),
    mfr: pick('mfr'),
  };
};

export function useProducts(search?: string) {
  const { currentCompanyId } = useCompany();
  const needle = search?.trim() ?? '';

  return useSupabaseQuery<Product[]>(
    ['products', currentCompanyId, needle],
    async () => {
      const supabase = getSupabaseClient();
      // NOTE: the live `products` table is narrower than types.ts —
      // `description` and `productType` are only in the type but not
      // in the DB schema. Select what's actually there.
      let q = scopeByCompany(
        supabase.from('products')
          .select('id, companyId, name, supplierProductName, sku, category, grade, hsCode, supplier, price, stockStatus, specs, tdsFile, tdsUrl, sharedWith, imageIds')
          .order('name', { ascending: true })
          .limit(500),
        currentCompanyId,
      );
      if (needle) {
        q = q.or(`name.ilike.*${needle}*,sku.ilike.*${needle}*,category.ilike.*${needle}*,grade.ilike.*${needle}*`) as typeof q;
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        companyId: r.companyId,
        name: r.name ?? '—',
        supplierProductName: r.supplierProductName,
        description: null,
        sku: r.sku,
        category: r.category,
        grade: r.grade,
        hsCode: r.hsCode,
        supplier: r.supplier,
        price: r.price === null || r.price === undefined ? null : Number(r.price),
        stockStatus: r.stockStatus,
        specs: normalizeSpecs(r.specs),
        tdsFile: r.tdsFile,
        tdsUrl: r.tdsUrl,
        sharedWith: r.sharedWith ?? [],
        imageIds: r.imageIds ?? [],
        productType: null,
      }));
    },
  );
}
