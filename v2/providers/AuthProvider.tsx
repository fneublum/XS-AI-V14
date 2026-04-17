// Phase 3A — Auth provider shell.
// Thin wrapper that exposes the current user via context. Wires to
// `services/supabase` but does NOT invoke any auth logic — Login in v2
// is a Phase 3B concern. For now this just mirrors whatever v1 already
// set in sessionStorage so the v2 shell can render something if the
// user is already logged in via v1.

import React, { createContext, useContext, useEffect, useState } from 'react';

interface AuthUser {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  allowedCompanies?: string[];
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({ user: null, loading: true });

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Best-effort read of the v1 session (key: xs_current_user, see
    // App.tsx:247). Replaced in Phase 3B with supabase.auth.getSession()
    // once Phase 1e auth migration lands.
    try {
      const raw = sessionStorage.getItem('xs_current_user');
      if (raw) {
        const v1User = JSON.parse(raw);
        setUser({
          id: v1User.id,
          name: v1User.name,
          email: v1User.email,
          role: v1User.role,
          allowedCompanies: v1User.allowed_company_ids ?? v1User.allowedCompanyIds,
        });
      }
    } catch { /* noop */ }
    setLoading(false);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
