// Phase 3B — TanStack Query provider.
//
// Hosts a single QueryClient for every v2 route. Configured for our
// typical Supabase workload: fresh for 30s, retry on network errors
// but not on 401/403 (user scope issues shouldn't hammer the DB), and
// keep hydrated data through tab blurs.

import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const shouldRetry = (failureCount: number, error: unknown): boolean => {
  if (failureCount >= 3) return false;
  const status = (error as { status?: number })?.status;
  if (status === 401 || status === 403 || status === 404) return false;
  return true;
};

export const QueryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: shouldRetry,
      },
      mutations: {
        retry: false,
      },
    },
  }));

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

export { useQueryClient } from '@tanstack/react-query';
