// Phase 3B — Company images (logos + product photos).
// v1 stores them in the `imagens` table with a `type` discriminator.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient } from '../../services/supabase';
import { useCompany } from '../providers/CompanyProvider';

export type ImageKind = 'LOGO' | 'PRODUCT' | 'OTHER' | 'LOGIN_BG';

export interface CompanyImage {
  id: string;
  companyId: string;
  url: string;
  name: string;
  createdAt: string;
  type: ImageKind;
}

interface Raw {
  id: string;
  companyId: string | null;
  url: string | null;
  name: string | null;
  createdAt: string | null;
  type: string | null;
}

export function useCompanyImages(kind?: ImageKind) {
  const { currentCompanyId } = useCompany();
  return useQuery<CompanyImage[]>({
    queryKey: ['imagens', currentCompanyId, kind ?? 'ALL'],
    queryFn: async () => {
      const supabase = getSupabaseClient();
      let q = supabase.from('imagens').select('id, companyId, url, name, createdAt, type').limit(2000);
      if (kind) q = q.eq('type', kind);
      // v1 shows images for the current company; 'ALL' means system.
      if (currentCompanyId !== 'ALL') {
        q = q.or(`"companyId".eq.${currentCompanyId},"companyId".eq.ALL`);
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return ((data as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        companyId: r.companyId ?? 'ALL',
        url: r.url ?? '',
        name: r.name ?? '',
        createdAt: r.createdAt ?? '',
        type: (r.type as ImageKind) ?? 'OTHER',
      }));
    },
  });
}

export function useAddCompanyImage() {
  const qc = useQueryClient();
  return useMutation<CompanyImage, Error, Omit<CompanyImage, 'id' | 'createdAt'> & Partial<Pick<CompanyImage, 'id'>>>({
    mutationFn: async (img) => {
      const supabase = getSupabaseClient();
      const id = img.id ?? `IMG${Date.now()}`;
      const row: CompanyImage = {
        id,
        companyId: img.companyId,
        url: img.url,
        name: img.name,
        createdAt: new Date().toISOString(),
        type: img.type,
      };
      const { error } = await supabase.from('imagens').insert(row);
      if (error) throw new Error(error.message);
      return row;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['imagens'] }); },
  });
}

export function useDeleteCompanyImage() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from('imagens').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['imagens'] }); },
  });
}
