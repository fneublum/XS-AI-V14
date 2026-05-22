// Loads sales-order history scoped to the current company, then runs
// it through `buildSalesSuggestions` to produce ranked reorder hints.

import { getSupabaseClient } from '../../services/supabase';
import { useCompany } from '../providers/CompanyProvider';
import { useSupabaseQuery } from './useSupabaseQuery';
import {
  buildSalesSuggestions,
  type RawOrder,
  type SalesSuggestion,
} from '../services/salesSuggestions';

export function useSalesSuggestions() {
  const { currentCompanyId } = useCompany();
  return useSupabaseQuery<SalesSuggestion[]>(
    ['salesSuggestions', currentCompanyId],
    async () => {
      const sb = getSupabaseClient();
      // Strict per-company scoping. Unlike the SO list (which surfaces
      // legacy companyId='ALL' rows so they're not invisible), the sales
      // agent's suggestions need to be unambiguously about THIS company's
      // customers — otherwise a GENRYO user sees suggestions for EC4
      // customers tagged as 'ALL'.
      let q = sb.from('sales_orders')
        .select('id, orderDate, customerId, customerName, totalAmount, items, status')
        .order('orderDate', { ascending: true })
        .limit(5000);
      if (currentCompanyId && currentCompanyId !== 'ALL') {
        q = q.eq('"companyId"', currentCompanyId);
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return buildSalesSuggestions((data as RawOrder[] | null) ?? []);
    },
  );
}
