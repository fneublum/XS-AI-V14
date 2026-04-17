// Phase 3B — Users admin list.
//
// No company scoping — `users` is a global table (users can belong to
// multiple companies via allowed_company_ids).

import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';

export interface UserRow {
  id: string;
  name: string;
  username: string;
  email: string | null;
  role: string;
  phone: string | null;
  allowedCompanies: string[];
  allowedModules: string[];
}

interface Raw {
  id: string;
  name: string | null;
  username: string | null;
  email: string | null;
  role: string | null;
  phone: string | null;
  allowed_company_ids: string[] | null;
  allowed_modules: string[] | null;
}

export function useUsers(search?: string) {
  const needle = search?.trim() ?? '';

  return useSupabaseQuery<UserRow[]>(
    ['users', needle],
    async () => {
      const supabase = getSupabaseClient();
      let q = supabase.from('users')
        .select('id, name, username, email, role, phone, allowed_company_ids, allowed_modules')
        .order('name', { ascending: true })
        .limit(200);

      if (needle) {
        q = q.or(`name.ilike.*${needle}*,username.ilike.*${needle}*,email.ilike.*${needle}*`);
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        name: r.name ?? '—',
        username: r.username ?? '',
        email: r.email,
        role: r.role ?? 'USER',
        phone: r.phone,
        allowedCompanies: r.allowed_company_ids ?? [],
        allowedModules: r.allowed_modules ?? [],
      }));
    },
  );
}
