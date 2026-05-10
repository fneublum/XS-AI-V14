// System-wide branded assets (logo + login background).
//
// v1 stores them in the `imagens` table with `companyId = 'SYSTEM'`
// and a `type` discriminator. Mirrors the fetch in pages/Login.tsx so
// v2 renders the same XSOLUTION branding.

import { useQuery } from '@tanstack/react-query';
import { getSupabaseClient } from '../../services/supabase';

export const DEFAULT_LOGO =
  'https://placehold.co/240x80/ffffff/0284c7?text=XSOLUTION&font=montserrat';

async function fetchImagen(type: 'LOGO' | 'LOGIN_BG'): Promise<string | null> {
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('imagens')
      .select('url')
      .eq('companyId', 'SYSTEM')
      .eq('type', type)
      .single();
    const url = (data as { url?: string | null } | null)?.url;
    return url ?? null;
  } catch {
    return null;
  }
}

export function useSystemLogo() {
  return useQuery<string>({
    queryKey: ['system-logo'],
    queryFn: async () => (await fetchImagen('LOGO')) ?? DEFAULT_LOGO,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLoginBackground() {
  return useQuery<string>({
    queryKey: ['login-bg'],
    queryFn: async () => (await fetchImagen('LOGIN_BG')) ?? '',
    staleTime: 5 * 60 * 1000,
  });
}
