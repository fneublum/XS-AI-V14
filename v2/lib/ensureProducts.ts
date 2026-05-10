// Phase 3C — Line-item → products catalog sync.
//
// When a line item has a productName but no productId, we create a row
// in the `products` table on save so every product seen on an offer /
// PO / SO ends up in the catalog and future offers can match it.
//
// Returns a copy of the items array with productId filled in where we
// just created a row.

import { getSupabaseClient } from '../../services/supabase';

export interface EnsurableItem {
  productId?: string;
  productName: string;
  hsCode?: string;
  grade?: string;
  unitPrice?: number;
}

interface EnsureOpts {
  companyId: string | null;
  /** Stored on the new products row so we can trace where it came from. */
  supplierName?: string;
  /** Category assigned to auto-created rows. */
  category?: string;
}

const newProductId = (): string =>
  `P-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

const normalize = (s: string): string => s.trim().toLowerCase();

export async function ensureProducts<T extends EnsurableItem>(
  items: T[],
  opts: EnsureOpts,
): Promise<T[]> {
  const missing = items.filter(it => !it.productId && (it.productName ?? '').trim() !== '');
  if (missing.length === 0) return items;

  const supabase = getSupabaseClient();
  const uniqueNames = Array.from(new Set(missing.map(it => it.productName.trim())));

  // First, see if any of these names already exist in the catalog for
  // this company so we don't duplicate.
  const { data: existing, error: findError } = await supabase
    .from('products')
    .select('id, name, companyId')
    .in('name', uniqueNames);
  if (findError) throw new Error(`Lookup products failed: ${findError.message}`);

  const existingMatch = new Map<string, string>();
  for (const row of (existing as Array<{ id: string; name: string; companyId: string | null }> | null) ?? []) {
    if (opts.companyId && row.companyId && row.companyId !== opts.companyId) continue;
    existingMatch.set(normalize(row.name), row.id);
  }

  const toInsert: Array<{
    id: string; name: string; companyId: string | null;
    supplier: string | null; category: string;
    hsCode: string | null; grade: string | null; price: number;
    // Auto-discovered from OCR/line items — kept out of curated
    // dropdowns until a human flags or first-picks it.
    isSystemProduct: boolean;
  }> = [];
  const assignments = new Map<string, string>(); // normalized name → productId

  for (const name of uniqueNames) {
    const key = normalize(name);
    const already = existingMatch.get(key);
    if (already) {
      assignments.set(key, already);
      continue;
    }
    const seed = missing.find(m => normalize(m.productName) === key);
    const id = newProductId();
    toInsert.push({
      id,
      name,
      companyId: opts.companyId,
      supplier: opts.supplierName ?? null,
      category: opts.category ?? 'Resin',
      hsCode: seed?.hsCode || null,
      grade:  seed?.grade  || null,
      price:  Number(seed?.unitPrice) || 0,
      isSystemProduct: false,
    });
    assignments.set(key, id);
  }

  if (toInsert.length > 0) {
    const { error: insertError } = await supabase
      .from('products')
      .insert(toInsert);
    if (insertError) throw new Error(`Create products failed: ${insertError.message}`);
  }

  return items.map(it => {
    if (it.productId) return it;
    const key = normalize(it.productName ?? '');
    const id = assignments.get(key);
    return id ? { ...it, productId: id } : it;
  });
}
