// Phase 3B — Minimal Supabase query hook.
//
// Stands in for TanStack Query until we install the real dep. Handles:
//   - in-flight cancellation when the key changes
//   - loading / error / data states
//   - one-line retry via refetch
//
// API deliberately matches TanStack Query's `useQuery` shape so the
// swap-over in a later commit is a narrow find-and-replace.

import { useCallback, useEffect, useRef, useState } from 'react';

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
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<Error | null>(null);
  const [isFetching, setIsFetching] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const [attempt, setAttempt] = useState(0);

  const refetch = useCallback(() => setAttempt(n => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setIsFetching(true);
    setError(null);
    fetcherRef.current(controller.signal)
      .then(result => {
        if (cancelled) return;
        setData(result);
      })
      .catch(err => {
        if (cancelled || controller.signal.aborted) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (cancelled) return;
        setIsFetching(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...key, attempt]);

  return {
    data,
    isLoading: data === undefined && isFetching,
    isFetching,
    error,
    refetch,
  };
}
