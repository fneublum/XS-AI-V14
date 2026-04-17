// Phase 3A — TanStack Query provider shell.
//
// TanStack Query isn't in package.json yet — this file contains the
// intended shape. When `@tanstack/react-query` is installed, swap the
// stub for the real provider. Until then, the provider is an identity
// wrapper so consumer code (`v2/queries/*`) typechecks without error.

import React, { createContext, useContext, useMemo } from 'react';

interface QueryContextValue {
  enabled: boolean;
}

const QueryContext = createContext<QueryContextValue>({ enabled: false });

export const useQueryClient = (): QueryContextValue => useContext(QueryContext);

export const QueryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const value = useMemo(() => ({ enabled: false }), []);
  return <QueryContext.Provider value={value}>{children}</QueryContext.Provider>;
};
