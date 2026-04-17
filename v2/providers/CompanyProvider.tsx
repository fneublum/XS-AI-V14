// Phase 3A — Company switcher context.
//
// Mirrors v1's `currentCompanyId` state (App.tsx:147). 'ALL' means "no
// filter — show data from every company the user has access to" and is
// the same default v1 uses. Once Phase 1d RLS lands, this seeds
// `app_metadata.current_company_id` so policies can narrow reads
// further.

import React, { createContext, useContext, useMemo, useState, useEffect } from 'react';

interface CompanyContextValue {
  currentCompanyId: string;
  setCurrentCompanyId: (id: string) => void;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);
const STORAGE_KEY = 'xs_v2_current_company';

export const useCompany = () => {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error('useCompany must be used within <CompanyProvider />');
  return ctx;
};

export const CompanyProvider: React.FC<{ initialId?: string; children: React.ReactNode }> = ({
  initialId,
  children,
}) => {
  const [currentCompanyId, setCurrentCompanyIdState] = useState<string>(() => {
    if (typeof window === 'undefined') return initialId ?? 'ALL';
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) return stored;
    } catch { /* noop */ }
    return initialId ?? 'ALL';
  });

  const setCurrentCompanyId = (id: string) => {
    setCurrentCompanyIdState(id);
    try { sessionStorage.setItem(STORAGE_KEY, id); } catch { /* noop */ }
  };

  const value = useMemo(
    () => ({ currentCompanyId, setCurrentCompanyId }),
    [currentCompanyId],
  );

  useEffect(() => {
    // Keep Supabase edge-auth helper aware of the chosen company so future
    // JWT mints can carry `current_company_id`. No-op today — Phase 1e.
  }, [currentCompanyId]);

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
};
