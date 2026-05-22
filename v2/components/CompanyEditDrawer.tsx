// v2 — Companies view/edit drawer with full data fields + logo upload.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2, Upload, Loader2 } from 'lucide-react';
import {
  Drawer, Input, FormField, Label, Button, Badge,
} from '../primitives';
import { useToast } from '../primitives/Toast';
import { useEntityUpdate } from '../queries/useEntityMutations';
import { getSupabaseClient } from '../../services/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CompanyAdminRow } from '../queries/useAdminCompanies';
import { CompanyBanksSection } from './CompanyBanksSection';

export type CompanyDrawerMode = 'view' | 'edit';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: CompanyDrawerMode;
  onModeChange: (m: CompanyDrawerMode) => void;
  row: CompanyAdminRow | null;
}

interface LogoRow {
  id: string;
  url: string;
  name: string;
}

const inputClass =
  'h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200';

const labelClass =
  'text-[11px] text-slate-500 uppercase tracking-wider font-medium';

const FIELDS: ReadonlyArray<{
  key: keyof CompanyAdminRow;
  label: string;
  mono?: boolean;
  fullWidth?: boolean;
  required?: boolean;
}> = [
  { key: 'name',     label: 'Legal name', required: true, fullWidth: true },
  { key: 'nickname', label: 'Nickname' },
  { key: 'ein',      label: 'EIN / Tax ID', mono: true },
  { key: 'address',  label: 'Address', fullWidth: true },
  { key: 'city',     label: 'City' },
  { key: 'state',    label: 'State / Region' },
  { key: 'zip',      label: 'ZIP / Postal code', mono: true },
  { key: 'country',  label: 'Country' },
  { key: 'phone',    label: 'Phone', mono: true },
  { key: 'email',    label: 'Email', fullWidth: true },
];

const compressImage = (file: File, maxWidth = 400, quality = 0.7): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new globalThis.Image();
      img.src = e.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', quality));
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });

const fmtValue = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
};

export const CompanyEditDrawer: React.FC<Props> = ({
  open, onOpenChange, mode, onModeChange, row,
}) => {
  const toast = useToast();
  const qc = useQueryClient();
  const update = useEntityUpdate<{ id: string } & Record<string, unknown>>({
    table: 'companies',
    listQueryKeys: ['adminCompanies', 'companies'],
  });

  const rowId = row?.id ?? null;
  const isEdit = mode === 'edit';

  const initial = useMemo<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    if (!row) return seed;
    for (const f of FIELDS) {
      const v = row[f.key];
      seed[f.key as string] = v === null || v === undefined ? '' : String(v);
    }
    return seed;
  }, [row]);

  const [values, setValues] = useState<Record<string, string>>(initial);
  useEffect(() => { setValues(initial); }, [initial]);

  const set = (k: string, v: string) => setValues(prev => ({ ...prev, [k]: v }));
  const dirty = Object.keys(values).some(k => values[k] !== initial[k]);

  // -- Logo state --
  const logoQuery = useQuery<LogoRow | null>({
    enabled: !!rowId,
    queryKey: ['imagens', 'companyLogo', rowId],
    queryFn: async () => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('imagens')
        .select('id, url, name')
        .eq('companyId', rowId!)
        .eq('type', 'LOGO')
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return { id: String(data.id), url: data.url ?? '', name: data.name ?? '' };
    },
  });

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);

  const invalidateLogo = () => {
    void qc.invalidateQueries({ queryKey: ['imagens'] });
  };

  const onLogoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !rowId) return;
    setLogoBusy(true);
    try {
      const base64 = await compressImage(file, 400, 0.7);
      const supabase = getSupabaseClient();
      const existing = logoQuery.data;
      if (existing) {
        const { error } = await supabase.from('imagens').delete().eq('id', existing.id);
        if (error) throw new Error(error.message);
      }
      const id = `IMG${Date.now()}`;
      const { error: insErr } = await supabase.from('imagens').insert({
        id,
        companyId: rowId,
        url: base64,
        name: file.name,
        createdAt: new Date().toISOString(),
        type: 'LOGO',
      });
      if (insErr) throw new Error(insErr.message);
      toast.push({ kind: 'success', title: 'Logo updated', description: row?.name ?? '' });
      invalidateLogo();
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Logo upload failed',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLogoBusy(false);
    }
  };

  const onLogoRemove = async () => {
    const existing = logoQuery.data;
    if (!existing) return;
    setLogoBusy(true);
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from('imagens').delete().eq('id', existing.id);
      if (error) throw new Error(error.message);
      toast.push({ kind: 'success', title: 'Logo removed' });
      invalidateLogo();
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Logo removal failed',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLogoBusy(false);
    }
  };

  const save = () => {
    if (!rowId) return;
    const patch: Record<string, unknown> = { id: rowId };
    for (const f of FIELDS) {
      const k = f.key as string;
      const s = (values[k] ?? '').trim();
      patch[k] = s === '' ? null : s;
    }
    update.mutate(patch as never, {
      onSuccess: () => {
        toast.push({ kind: 'success', title: 'Saved', description: row?.name ?? '' });
        onOpenChange(false);
      },
      onError: (err) => toast.push({
        kind: 'error', title: 'Update failed', description: err.message,
      }),
    });
  };

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={row?.name ?? 'Company'}
      footer={
        <>
          {!isEdit && (
            <Button
              size="sm" variant="secondary"
              onClick={() => onModeChange('edit')}
              className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
            >
              Edit
            </Button>
          )}
          <Button
            size="sm" variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={update.isPending}
            className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
          >
            Close
          </Button>
          {isEdit && (
            <Button
              size="sm"
              onClick={save}
              disabled={!dirty || update.isPending || !rowId}
              loading={update.isPending}
              className="ml-auto bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
            >
              {update.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          )}
        </>
      }
    >
      {row && (
        <div className="space-y-5">
          {/* Logo section */}
          <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
            <div className="flex items-start gap-4">
              <div className="w-24 h-24 rounded-md border border-[#1f1f1f] bg-[#0a0a0a] flex items-center justify-center overflow-hidden">
                {logoQuery.isLoading ? (
                  <Loader2 size={18} className="text-slate-600 animate-spin" />
                ) : logoQuery.data?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoQuery.data.url}
                    alt="Company logo"
                    className="max-w-full max-h-full object-contain"
                  />
                ) : (
                  <span className="text-[10px] text-slate-600 uppercase tracking-wider">
                    No logo
                  </span>
                )}
              </div>
              <div className="flex-1 space-y-2">
                <div className={labelClass}>Company logo</div>
                <p className="text-[11px] text-slate-500">
                  PNG / JPEG. Auto-compressed to 400px wide.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={onLogoFile}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => fileRef.current?.click()}
                    disabled={logoBusy || !rowId}
                    className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
                  >
                    {logoBusy ? (
                      <Loader2 size={13} className="animate-spin mr-1.5" />
                    ) : (
                      <Upload size={13} className="mr-1.5" />
                    )}
                    {logoQuery.data?.url ? 'Replace' : 'Upload'}
                  </Button>
                  {logoQuery.data?.url && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={onLogoRemove}
                      disabled={logoBusy}
                      className="bg-transparent border border-[#1f1f1f] text-rose-400 hover:bg-[#161616]"
                    >
                      <Trash2 size={13} className="mr-1.5" />
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Fields */}
          {isEdit ? (
            <div className="grid grid-cols-2 gap-3">
              {FIELDS.map(f => {
                const colSpan = f.fullWidth ? 'col-span-2' : '';
                return (
                  <FormField key={f.key as string} className={colSpan}>
                    <Label className={labelClass}>{f.label}</Label>
                    <Input
                      type="text"
                      value={values[f.key as string] ?? ''}
                      onChange={e => set(f.key as string, e.target.value)}
                      className={inputClass + (f.mono ? ' font-mono tabular-nums' : '')}
                    />
                  </FormField>
                );
              })}
            </div>
          ) : (
            <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-[12.5px]">
              {FIELDS.map(f => (
                <React.Fragment key={f.key as string}>
                  <dt className="text-[11px] text-slate-500 uppercase tracking-wider py-1.5">
                    {f.label}
                  </dt>
                  <dd className={
                    (f.mono ? 'font-mono tabular-nums ' : '') +
                    'py-1.5 text-slate-200 break-words'
                  }>
                    {fmtValue(row[f.key])}
                  </dd>
                </React.Fragment>
              ))}
            </dl>
          )}

          {/* Banks section — always shown so users can manage wire
              instructions per company without entering edit mode. */}
          {rowId && <CompanyBanksSection companyId={rowId} />}

          <div className="pt-2 border-t border-[#1f1f1f] text-[11px] text-slate-500 flex items-center gap-2">
            <Badge variant="neutral">companies</Badge>
            {rowId && (
              <span className="ml-auto font-mono tabular-nums text-slate-600">
                #{rowId.slice(0, 8)}
              </span>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
};
