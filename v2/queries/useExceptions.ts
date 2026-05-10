// Aggregates orders + customer invoices and runs the exception
// detectors. The AI Dashboard's Exceptions panel reads this hook.
//
// Reuses useAgentSalesOrders for the order side (so detectors share
// the same derived `stage`, parsed items, computed commission, etc.)
// and adds a thin company-scoped query for commission_customer_invoices
// so duplicate-detection has the raw row set.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';
import { useAgentSalesOrders } from './useAgentSalesOrders';
import {
  runDetectors, type Exception, type RawCustomerInvoice,
} from '../lib/exceptions';

function useCustomerInvoiceRefs() {
  const { currentCompanyId } = useCompany();
  return useSupabaseQuery<RawCustomerInvoice[]>(
    ['commission_customer_invoices_refs', currentCompanyId],
    async () => {
      const supabase = getSupabaseClient();
      let q = supabase
        .from('commission_customer_invoices')
        .select('id, invoiceNumber, soNumber');
      if (currentCompanyId !== 'ALL') q = q.eq('"companyId"', currentCompanyId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data as RawCustomerInvoice[] | null) ?? [];
    },
  );
}

export interface UseExceptionsResult {
  data: Exception[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useExceptions(): UseExceptionsResult {
  const orders = useAgentSalesOrders('');
  const invoices = useCustomerInvoiceRefs();

  const data: Exception[] = orders.data && invoices.data
    ? runDetectors({ orders: orders.data, invoices: invoices.data })
    : [];

  return {
    data,
    isLoading: orders.isLoading || invoices.isLoading,
    error: (orders.error as Error | null) ?? (invoices.error as Error | null) ?? null,
    refetch: () => {
      void orders.refetch();
      void invoices.refetch();
    },
  };
}
