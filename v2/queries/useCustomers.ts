// Phase 3A — Example TanStack Query hook (stubbed).
//
// Once `@tanstack/react-query` is installed and QueryProvider is wired
// for real, replace the stub with:
//
//   export const useCustomers = () =>
//     useQuery({ queryKey: ['customers', companyId], queryFn: fetchCustomers });
//
// For now this returns a dormant {data,loading,error} shape so consumer
// code compiles and the migration is a local change inside this file.

import { useEffect, useState } from 'react';
import { useCompany } from '../providers/CompanyProvider';

export interface Customer {
  id: string;
  name: string;
  email?: string;
  country?: string;
}

interface QueryResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

export function useCustomers(): QueryResult<Customer[]> {
  const { currentCompanyId } = useCompany();
  const [data, setData] = useState<Customer[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    import('../../services/supabase')
      .then(({ supabase }) =>
        supabase
          .from('customers')
          .select('id, name, email, country')
          .eq('"companyId"', currentCompanyId),
      )
      .then(({ data: rows, error: err }) => {
        if (cancelled) return;
        if (err) setError(new Error(err.message));
        else setData((rows ?? []) as Customer[]);
      })
      .catch(err => { if (!cancelled) setError(err as Error); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentCompanyId]);

  return { data, loading, error };
}
