// Phase 3A — Auth provider shell.
// Thin wrapper that exposes the current user via context. Wires to
// `services/supabase` but does NOT invoke any auth logic — Login in v2
// is a Phase 3B concern. For now this just mirrors whatever v1 already
// set in sessionStorage so the v2 shell can render something if the
// user is already logged in via v1.

import React, { createContext, useContext, useEffect, useState } from 'react';
import { getSupabaseClient } from '../../services/supabase';

interface AuthUser {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  allowedCompanies?: string[];
  /**
   * First linked cargo agent id. Kept as a scalar for back-compat with
   * older callers; new consumers should prefer `linkedEntityIds`.
   */
  linkedEntityId?: string;
  /**
   * All linked cargo agent ids. The DB column is a single text field
   * (`users.linked_entity_id`) storing a comma-separated list to keep
   * back-compat with the original scalar schema; AuthProvider splits
   * it on load so consumers get a proper array.
   */
  linkedEntityIds?: string[];
}

const splitLinkedIds = (raw: unknown): string[] => {
  if (Array.isArray(raw)) {
    return raw.map(v => String(v ?? '').trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
};

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
    let cancelled = false;
    (async () => {
      try {
        const raw = sessionStorage.getItem('xs_current_user');
        if (!raw) { setLoading(false); return; }
        const v1User = JSON.parse(raw);
        const storedLinked = v1User.linked_entity_id ?? v1User.linkedEntityId;
        const linkedIds = splitLinkedIds(storedLinked);
        const initial: AuthUser = {
          id: v1User.id,
          name: v1User.name,
          email: v1User.email,
          role: v1User.role,
          allowedCompanies: v1User.allowed_company_ids ?? v1User.allowedCompanyIds,
          linkedEntityId: linkedIds[0],
          linkedEntityIds: linkedIds,
        };
        if (!cancelled) setUser(initial);

        // `linked_entity_id` isn't in the `auth-issue` response, so a
        // freshly-logged-in Cargo Agent lands here with it missing.
        // Hydrate it from the `users` row so the Agent Portal gate
        // passes without forcing another sign-out/sign-in cycle.
        if (linkedIds.length === 0 && initial.id) {
          try {
            const supabase = getSupabaseClient();
            const { data } = await supabase
              .from('users')
              .select('linked_entity_id')
              .eq('id', initial.id)
              .maybeSingle();
            const linked = (data as { linked_entity_id?: string | null } | null)?.linked_entity_id;
            const hydratedIds = splitLinkedIds(linked);
            if (hydratedIds.length > 0 && !cancelled) {
              setUser(prev => prev ? {
                ...prev,
                linkedEntityId: hydratedIds[0],
                linkedEntityIds: hydratedIds,
              } : prev);
              // Also update sessionStorage so the next reload skips the
              // fetch + the user object shows linked on other consumers.
              try {
                const merged = { ...v1User, linked_entity_id: linked };
                sessionStorage.setItem('xs_current_user', JSON.stringify(merged));
              } catch { /* noop */ }
            }
          } catch { /* ignore — user still usable for everything else */ }
        }
      } catch { /* noop */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
