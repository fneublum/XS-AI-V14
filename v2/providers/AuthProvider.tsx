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
    // Phase 1e — Supabase Auth as the source of truth.
    //
    // Boot path:
    //   1. supabase.auth.getSession() — if a session exists, look up
    //      the application users row by users.auth_id and populate
    //      the AuthUser context. Supabase persists the session to
    //      localStorage and auto-refreshes the token, so a hard page
    //      reload (or a chunk-retry reload from lazyWithRetry) lands
    //      back in the app without forcing the user to sign in again.
    //   2. onAuthStateChange — SIGNED_OUT clears the context so a
    //      sign-out in any tab propagates here too.
    //
    // No legacy fallback: the v1 sessionStorage hand-off was removed
    // post-backfill (2026-05-28). A stale `xs_current_user` blob from
    // an old tab would otherwise be treated as a valid session here,
    // which is exactly the "logout doesn't stick" bug that v14.96 fixes.
    // sessionStorage stays in sync via applyAuthUser, but it's a mirror,
    // not an auth source.
    let cancelled = false;
    const supabase = getSupabaseClient();

    const applyAuthUser = (row: Record<string, any> | null) => {
      if (!row) return;
      const linkedIds = splitLinkedIds(row.linked_entity_id ?? row.linkedEntityId);
      const next: AuthUser = {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        allowedCompanies: row.allowed_company_ids ?? row.allowedCompanyIds,
        linkedEntityId: linkedIds[0],
        linkedEntityIds: linkedIds,
      };
      if (!cancelled) setUser(next);
      // Mirror to sessionStorage for back-compat with any v2 code still
      // reading xs_current_user (inboxProcessor, SessionExpiredBanner,
      // CompanySwitcher, etc.). Cleaned up once those callers migrate
      // to useAuth().
      try {
        sessionStorage.setItem('xs_current_user', JSON.stringify(row));
      } catch { /* noop */ }
    };

    const resolveSessionUser = async (authUserId: string) => {
      const { data, error } = await supabase
        .from('users')
        .select('id, name, email, role, allowed_company_ids, linked_entity_id, auth_id')
        .eq('auth_id', authUserId)
        .maybeSingle();
      if (error || !data) return null;
      return data as Record<string, any>;
    };

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data.session;
        if (session) {
          const row = await resolveSessionUser(session.user.id);
          if (row) {
            applyAuthUser(row);
          } else if (!cancelled) {
            // Orphan auth session — no matching users row. Sign out so
            // the user lands on Login fresh instead of in a half-authed
            // state.
            await supabase.auth.signOut().catch(() => { /* best effort */ });
          }
          if (!cancelled) setLoading(false);
          return;
        }

        // No Supabase session → genuinely logged out. Belt-and-suspenders:
        // wipe any leftover legacy sessionStorage so downstream readers
        // (inboxProcessor, etc.) don't see stale identity data.
        try {
          sessionStorage.removeItem('xs_current_user');
          sessionStorage.removeItem('xs_edge_auth_token');
          sessionStorage.removeItem('xs_edge_auth_exp');
        } catch { /* noop */ }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    // React to sign-out from other tabs / token refresh failures / etc.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === 'SIGNED_OUT') {
        setUser(null);
        try { sessionStorage.removeItem('xs_current_user'); } catch { /* noop */ }
      }
      // SIGNED_IN / TOKEN_REFRESHED are handled by the LoginV2 flow,
      // which sets the user explicitly after resolving the users row.
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
