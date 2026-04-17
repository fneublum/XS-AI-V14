// Phase 3A — Company switcher context.
// Mirrors the `currentCompanyId` state from v1's App.tsx:290ish. Once
// Phase 1d RLS lands, this will seed `app_metadata.current_company_id`
// so RLS policies can narrow reads further.

import React, { createContext, useContext, useMemo, useState } from 'react';

interface CompanyContextValue {
  currentCompanyId: string;
  setCurrentCompanyId: (id: string) => void;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

export const useCompany = () => {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error('useCompany must be used within <CompanyProvider />');
  return ctx;
};

export const CompanyProvider: React.FC<{ initialId?: string; children: React.ReactNode }> = ({
  initialId = 'DEFAULT',
  children,
}) => {
  const [currentCompanyId, setCurrentCompanyId] = useState(initialId);
  const value = useMemo(
    () => ({ currentCompanyId, setCurrentCompanyId }),
    [currentCompanyId],
  );
  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
};
