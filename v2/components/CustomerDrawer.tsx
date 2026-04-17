// Phase 3B — Customer editor drawer (create + edit).

import React, { useEffect, useState } from 'react';
import { Drawer, Input, FormField, Label, Button } from '../primitives';
import { Customer } from '../queries/useCustomers';
import { useEntityUpdate, useEntityInsert } from '../queries/useEntityMutations';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import type { EditorMode } from '../providers/EditorProvider';

interface Props {
  customer: Customer | null;
  mode: EditorMode;
  onOpenChange: (open: boolean) => void;
}

export const CustomerDrawer: React.FC<Props> = ({ customer, mode, onOpenChange }) => {
  const [name, setName]       = useState('');
  const [email, setEmail]     = useState('');
  const [phone, setPhone]     = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity]       = useState('');
  const [pod, setPod]         = useState('');
  const [terms, setTerms]     = useState('');
  const toast = useToast();
  const { currentCompanyId } = useCompany();

  const update = useEntityUpdate<{
    id: string;
    name?: string; email?: string | null; phone?: string | null;
    country?: string | null; city?: string | null; pod?: string | null;
    paymentTerms?: string | null;
  }>({ table: 'customers', listQueryKeys: ['customers'] });

  const insert = useEntityInsert<{
    companyId: string;
    name: string; email: string | null; phone: string | null;
    country: string | null; city: string | null; pod: string | null;
    paymentTerms: string | null; lastOrderDate: string | null;
  }>({ table: 'customers', listQueryKeys: ['customers'], idPrefix: 'CUST' });

  useEffect(() => {
    if (!customer) return;
    setName(customer.name ?? '');
    setEmail(customer.email ?? '');
    setPhone(customer.phone ?? '');
    setCountry(customer.country ?? '');
    setCity(customer.city ?? '');
    setPod(customer.pod ?? '');
    setTerms(customer.paymentTerms ?? '');
  }, [customer?.id, mode]);

  const dirty = mode === 'create'
    ? name.trim().length > 0
    : customer && (
        (customer.name ?? '') !== name ||
        (customer.email ?? '') !== email ||
        (customer.phone ?? '') !== phone ||
        (customer.country ?? '') !== country ||
        (customer.city ?? '') !== city ||
        (customer.pod ?? '') !== pod ||
        (customer.paymentTerms ?? '') !== terms
      );

  const pending = update.isPending || insert.isPending;

  const save = () => {
    if (!customer) return;
    const payload = {
      name,
      email: email || null,
      phone: phone || null,
      country: country || null,
      city: city || null,
      pod: pod || null,
      paymentTerms: terms || null,
    };

    if (mode === 'create') {
      const companyId = currentCompanyId === 'ALL' ? 'DEFAULT' : currentCompanyId;
      insert.mutate(
        { ...payload, companyId, lastOrderDate: null },
        {
          onSuccess: () => {
            toast.push({ kind: 'success', title: 'Customer created', description: name });
            onOpenChange(false);
          },
          onError: (err) => toast.push({ kind: 'error', title: 'Create failed', description: err.message }),
        },
      );
    } else {
      update.mutate(
        { id: customer.id, ...payload },
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

  const title = mode === 'create' ? 'New customer' : (customer?.name ?? 'Customer');
  const description = mode === 'create'
    ? 'Create a customer in the current workspace.'
    : (customer?.email ?? customer?.country ?? undefined);

  return (
    <Drawer
      open={!!customer}
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
            disabled={!dirty || pending}
            loading={pending}
            className="ml-auto bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
          >
            {pending ? 'Saving…' : mode === 'create' ? 'Create' : 'Save changes'}
          </Button>
        </>
      }
    >
      {customer && (
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
            <Label>Port of Destination (POD)</Label>
            <Input value={pod} onChange={e => setPod(e.target.value)}
              className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono tabular-nums" />
          </FormField>
          <FormField>
            <Label>Payment terms</Label>
            <Input value={terms} onChange={e => setTerms(e.target.value)}
              className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
          </FormField>
        </div>
      )}
    </Drawer>
  );
};
