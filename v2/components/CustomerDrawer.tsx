// Phase 3B — Customer editor drawer.

import React, { useEffect, useState } from 'react';
import { Drawer, Input, FormField, Label, Button } from '../primitives';
import { Customer } from '../queries/useCustomers';
import { useEntityMutation } from '../queries/useEntityMutations';
import { useToast } from '../primitives/Toast';

interface CustomerPatch {
  id: string;
  name?: string;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  city?: string | null;
  pod?: string | null;
  paymentTerms?: string | null;
}

interface Props {
  customer: Customer | null;
  onOpenChange: (open: boolean) => void;
}

export const CustomerDrawer: React.FC<Props> = ({ customer, onOpenChange }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [pod, setPod] = useState('');
  const [terms, setTerms] = useState('');
  const toast = useToast();
  const mut = useEntityMutation<CustomerPatch>({
    table: 'customers',
    listQueryKeys: ['customers'],
  });

  useEffect(() => {
    if (!customer) return;
    setName(customer.name ?? '');
    setEmail(customer.email ?? '');
    setPhone(customer.phone ?? '');
    setCountry(customer.country ?? '');
    setCity(customer.city ?? '');
    setPod(customer.pod ?? '');
    setTerms(customer.paymentTerms ?? '');
  }, [customer?.id]);

  const dirty = customer && (
    (customer.name ?? '') !== name ||
    (customer.email ?? '') !== email ||
    (customer.phone ?? '') !== phone ||
    (customer.country ?? '') !== country ||
    (customer.city ?? '') !== city ||
    (customer.pod ?? '') !== pod ||
    (customer.paymentTerms ?? '') !== terms
  );

  const save = () => {
    if (!customer) return;
    mut.mutate(
      {
        id: customer.id,
        name,
        email: email || null,
        phone: phone || null,
        country: country || null,
        city: city || null,
        pod: pod || null,
        paymentTerms: terms || null,
      },
      {
        onSuccess: () => {
          toast.push({ kind: 'success', title: 'Saved', description: `${name} updated.` });
          onOpenChange(false);
        },
        onError: (err) => {
          toast.push({ kind: 'error', title: 'Update failed', description: err.message });
        },
      },
    );
  };

  return (
    <Drawer
      open={!!customer}
      onOpenChange={onOpenChange}
      title={customer?.name ?? 'Customer'}
      description={customer?.email ?? customer?.country ?? undefined}
      footer={
        <>
          <Button
            variant="secondary" size="sm"
            onClick={() => onOpenChange(false)}
            className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={!dirty || mut.isPending}
            loading={mut.isPending}
            className="ml-auto bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
          >
            {mut.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      {customer && (
        <div className="space-y-4">
          <FormField>
            <Label>Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField>
              <Label>Email</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
            </FormField>
            <FormField>
              <Label>Phone</Label>
              <Input value={phone} onChange={e => setPhone(e.target.value)} className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono tabular-nums" />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField>
              <Label>Country</Label>
              <Input value={country} onChange={e => setCountry(e.target.value)} className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
            </FormField>
            <FormField>
              <Label>City</Label>
              <Input value={city} onChange={e => setCity(e.target.value)} className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
            </FormField>
          </div>
          <FormField>
            <Label>Port of Destination (POD)</Label>
            <Input value={pod} onChange={e => setPod(e.target.value)} className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono tabular-nums" />
          </FormField>
          <FormField>
            <Label>Payment terms</Label>
            <Input value={terms} onChange={e => setTerms(e.target.value)} className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
          </FormField>
        </div>
      )}
    </Drawer>
  );
};
