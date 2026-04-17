// Phase 3B — Supplier editor drawer (create + edit).

import React, { useEffect, useState } from 'react';
import { Drawer, Input, FormField, Label, Button } from '../primitives';
import { Supplier } from '../queries/useSuppliers';
import { useEntityUpdate, useEntityInsert } from '../queries/useEntityMutations';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import type { EditorMode } from '../providers/EditorProvider';

interface Props {
  supplier: Supplier | null;
  mode: EditorMode;
  onOpenChange: (open: boolean) => void;
}

export const SupplierDrawer: React.FC<Props> = ({ supplier, mode, onOpenChange }) => {
  const [name, setName]       = useState('');
  const [email, setEmail]     = useState('');
  const [phone, setPhone]     = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity]       = useState('');
  const [terms, setTerms]     = useState('');
  const [rating, setRating]   = useState('');
  const toast = useToast();
  const { currentCompanyId } = useCompany();

  const update = useEntityUpdate<{
    id: string; name?: string; email?: string | null; phone?: string | null;
    country?: string | null; city?: string | null; paymentTerms?: string | null;
    rating?: number | null;
  }>({ table: 'suppliers', listQueryKeys: ['suppliers'] });

  const insert = useEntityInsert<{
    companyId: string; name: string; email: string | null; phone: string | null;
    country: string | null; city: string | null; paymentTerms: string | null;
    rating: number | null;
  }>({ table: 'suppliers', listQueryKeys: ['suppliers'], idPrefix: 'SUP' });

  useEffect(() => {
    if (!supplier) return;
    setName(supplier.name ?? '');
    setEmail(supplier.email ?? '');
    setPhone(supplier.phone ?? '');
    setCountry(supplier.country ?? '');
    setCity(supplier.city ?? '');
    setTerms(supplier.paymentTerms ?? '');
    setRating(supplier.rating === null || supplier.rating === undefined ? '' : String(supplier.rating));
  }, [supplier?.id, mode]);

  const ratingNum = rating.trim() === '' ? null : Number(rating);
  const ratingValid = ratingNum === null || (Number.isFinite(ratingNum) && ratingNum >= 0 && ratingNum <= 5);

  const dirty = mode === 'create'
    ? name.trim().length > 0
    : supplier && (
        (supplier.name ?? '') !== name ||
        (supplier.email ?? '') !== email ||
        (supplier.phone ?? '') !== phone ||
        (supplier.country ?? '') !== country ||
        (supplier.city ?? '') !== city ||
        (supplier.paymentTerms ?? '') !== terms ||
        (supplier.rating ?? null) !== ratingNum
      );

  const pending = update.isPending || insert.isPending;

  const save = () => {
    if (!supplier || !ratingValid) return;
    const payload = {
      name,
      email: email || null,
      phone: phone || null,
      country: country || null,
      city: city || null,
      paymentTerms: terms || null,
      rating: ratingNum,
    };

    if (mode === 'create') {
      const companyId = currentCompanyId === 'ALL' ? 'DEFAULT' : currentCompanyId;
      insert.mutate(
        { ...payload, companyId },
        {
          onSuccess: () => {
            toast.push({ kind: 'success', title: 'Supplier created', description: name });
            onOpenChange(false);
          },
          onError: (err) => toast.push({ kind: 'error', title: 'Create failed', description: err.message }),
        },
      );
    } else {
      update.mutate(
        { id: supplier.id, ...payload },
        {
          onSuccess: () => {
            toast.push({ kind: 'success', title: 'Saved', description: `${name} updated.` });
            onOpenChange(false);
          },
          onError: (err) => toast.push({ kind: 'error', title: 'Update failed', description: err.message }),
        },
      );
    }
  };

  const title = mode === 'create' ? 'New supplier' : (supplier?.name ?? 'Supplier');
  const description = mode === 'create'
    ? 'Create a supplier in the current workspace.'
    : (supplier?.email ?? supplier?.country ?? undefined);

  return (
    <Drawer
      open={!!supplier}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}
            className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]">
            Cancel
          </Button>
          <Button
            size="sm" onClick={save}
            disabled={!dirty || !ratingValid || pending}
            loading={pending}
            className="ml-auto bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
          >
            {pending ? 'Saving…' : mode === 'create' ? 'Create' : 'Save changes'}
          </Button>
        </>
      }
    >
      {supplier && (
        <div className="space-y-4">
          <FormField>
            <Label required>Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)}
              autoFocus={mode === 'create'}
              className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField>
              <Label>Email</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)}
                className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
            </FormField>
            <FormField>
              <Label>Phone</Label>
              <Input value={phone} onChange={e => setPhone(e.target.value)}
                className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono tabular-nums" />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField>
              <Label>Country</Label>
              <Input value={country} onChange={e => setCountry(e.target.value)}
                className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
            </FormField>
            <FormField>
              <Label>City</Label>
              <Input value={city} onChange={e => setCity(e.target.value)}
                className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
            </FormField>
          </div>
          <FormField>
            <Label>Payment terms</Label>
            <Input value={terms} onChange={e => setTerms(e.target.value)}
              className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
          </FormField>
          <FormField>
            <Label>Rating (0–5)</Label>
            <Input type="number" min={0} max={5} step={0.1}
              value={rating} onChange={e => setRating(e.target.value)}
              invalid={!ratingValid}
              className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono tabular-nums" />
          </FormField>
        </div>
      )}
    </Drawer>
  );
};
