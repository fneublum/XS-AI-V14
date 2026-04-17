// Phase 3B — thin wrapper around TanStack Query's useQuery.
//
// Keeps the QueryState shape the v2 routes expect so they don't have
// to change when the underlying engine swaps in. `refetch` returns
// void to match the pre-TanStack signature.

import { useQuery } from '@tanstack/react-query';

export interface QueryState<T> {
  data: T | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useSupabaseQuery<T>(
  key: readonly unknown[],
  fetcher: (signal: AbortSignal) => Promise<T>,
): QueryState<T> {
  const q = useQuery<T, Error>({
    queryKey: key,
    queryFn: ({ signal }) => fetcher(signal),
  });
  return {
    data: q.data,
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    error: (q.error as Error | null) ?? null,
    refetch: () => { void q.refetch(); },
  };
}
