// Phase 3B — Customer editor drawer. Full v1 parity.

import React, { useEffect, useState } from 'react';
import { Share2 } from 'lucide-react';
import {
  Drawer, Input, FormField, Label, Button, Badge, ConfirmDialog,
} from '../primitives';
import { Customer } from '../queries/useCustomers';
import { useCompanies } from '../queries/useCompanies';
import { useEntityUpdate, useEntityInsert, useEntityDelete } from '../queries/useEntityMutations';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import { SupabaseSelectField } from './SupabaseSelectField';
import type { EditorMode } from '../providers/EditorProvider';

interface Props {
  customer: Customer | null;
  mode: EditorMode;
  onOpenChange: (open: boolean) => void;
}

const PAYMENT_TERMS = [
  'Net 30 Days', 'Net 60 Days', 'Prepaid', 'L/C at Sight', 'L/C 60 Days',
  'Cash Against Documents', 'Cash on Delivery', 'D/P - Documents Against Payment',
  'D/A 60 Days', 'T/T 30 Days After B/L', '100% T/T in Advance',
  '40% Advance + 60% Cash Against Documents', '50% Advance + 50% on Cash Against Documents',
  '30% Advance + 70% on Cash Against Documents', '20% Advance + 80% Cash Against Documents',
  'Advance + Cash Against Documents',
];

const STATUS_OPTIONS = ['Active', 'Inactive', 'At Risk'];

const inputClass =
  'h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 rounded-md px-2 ' +
  'placeholder:text-slate-600 focus:ring-1 focus:ring-indigo-500 outline-none';

const labelClass = 'text-[11px] text-slate-500 uppercase tracking-wider font-medium';

const sectionClass = 'p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f] space-y-3';

export const CustomerDrawer: React.FC<Props> = ({ customer, mode, onOpenChange }) => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const companies = useCompanies();

  const [companyId, setCompanyId]           = useState<string>(currentCompanyId !== 'ALL' ? currentCompanyId : '');
  const [name, setName]                     = useState('');
  const [nickname, setNickname]             = useState('');
  const [taxId, setTaxId]                   = useState('');
  const [contactPerson, setContactPerson]   = useState('');
  const [email, setEmail]                   = useState('');
  const [phone, setPhone]                   = useState('');
  const [location, setLocation]             = useState('');
  const [city, setCity]                     = useState('');
  const [stateVal, setStateVal]             = useState('');
  const [zip, setZip]                       = useState('');
  const [country, setCountry]               = useState('');
  const [pod, setPod]                       = useState('');
  const [creditLimit, setCreditLimit]       = useState('0');
  const [paymentTerms, setPaymentTerms]     = useState('Net 30 Days');
  const [status, setStatus]                 = useState('Active');
  const [totalVolumeLBS, setTotalVolumeLBS] = useState('0');
  const [lastOrderDate, setLastOrderDate]   = useState('');
  const [sharedWith, setSharedWith]         = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete]   = useState(false);

  const del = useEntityDelete({ table: 'customers', listQueryKeys: ['customers'] });
  const update = useEntityUpdate<{ id: string } & Record<string, unknown>>({
    table: 'customers', listQueryKeys: ['customers'],
  });
  const insert = useEntityInsert<Record<string, unknown>>({
    table: 'customers', listQueryKeys: ['customers'], idPrefix: 'CUST',
    withCreatedAt: false,
  });

  useEffect(() => {
    if (!customer) return;
    setCompanyId(customer.companyId ?? (currentCompanyId !== 'ALL' ? currentCompanyId : ''));
    setName(customer.name ?? '');
    setNickname(customer.nickname ?? '');
    setTaxId(customer.taxId ?? '');
    setContactPerson(customer.contactPerson ?? '');
    setEmail(customer.email ?? '');
    setPhone(customer.phone ?? '');
    setLocation(customer.location ?? '');
    setCity(customer.city ?? '');
    setStateVal(customer.state ?? '');
    setZip(customer.zip ?? '');
    setCountry(customer.country ?? '');
    setPod(customer.pod ?? '');
    setCreditLimit(customer.creditLimit === null || customer.creditLimit === undefined
      ? '0' : String(customer.creditLimit));
    setPaymentTerms(customer.paymentTerms ?? 'Net 30 Days');
    setStatus(customer.status ?? 'Active');
    setTotalVolumeLBS(customer.totalVolumeLBS === null || customer.totalVolumeLBS === undefined
      ? '0' : String(customer.totalVolumeLBS));
    setLastOrderDate(customer.lastOrderDate ?? '');
    setSharedWith(customer.sharedWith ?? []);
  }, [customer?.id, mode]);

  const availableCompanies = companies.data ?? [];
  const isSystem = currentCompanyId === 'ALL';

  const canSave = name.trim() !== '';
  const pending = update.isPending || insert.isPending || del.isPending;

  const toggleShare = (id: string) =>
    setSharedWith(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const buildPayload = () => ({
    companyId: companyId || currentCompanyId,
    name: name.trim(),
    nickname: nickname || null,
    taxId: taxId || null,
    contactPerson: contactPerson || null,
    email: email || null,
    phone: phone || null,
    location: location || null,
    city: city || null,
    state: stateVal || null,
    zip: zip || null,
    country: country || null,
    pod: pod || null,
    creditLimit: Number(creditLimit) || 0,
    paymentTerms: paymentTerms || null,
    status: status || null,
    totalVolumeLBS: Number(totalVolumeLBS) || 0,
    lastOrderDate: lastOrderDate || null,
    sharedWith,
  });

  const save = () => {
    if (!canSave) {
      toast.push({ kind: 'warning', title: 'Name is required' });
      return;
    }
    const payload = buildPayload();
    if (mode === 'create') {
      insert.mutate(payload, {
        onSuccess: () => {
          toast.push({ kind: 'success', title: 'Customer created', description: payload.name });
          onOpenChange(false);
        },
        onError: (err) => toast.push({
          kind: 'error', title: 'Create failed', description: err.message,
        }),
      });
    } else if (customer) {
      update.mutate({ id: customer.id, ...payload }, {
        onSuccess: () => {
          toast.push({ kind: 'success', title: 'Saved', description: payload.name });
          onOpenChange(false);
        },
        onError: (err) => toast.push({
          kind: 'error', title: 'Save failed', description: err.message,
        }),
      });
    }
  };

  const deleteCustomer = () => {
    if (!customer) return;
    del.mutate(customer.id, {
      onSuccess: () => {
        toast.push({ kind: 'success', title: 'Deleted', description: customer.name });
        setConfirmDelete(false);
        onOpenChange(false);
      },
      onError: (err) => {
        toast.push({ kind: 'error', title: 'Delete failed', description: err.message });
        setConfirmDelete(false);
      },
    });
  };

  if (!customer) return null;

  return (
    <>
      <Drawer
        open={!!customer}
        onOpenChange={onOpenChange}
        title={mode === 'create' ? 'New customer' : (customer.name || 'Customer')}
        description={mode === 'edit' ? (customer.nickname ?? customer.country ?? undefined) : 'Create a customer record.'}
        widthClass="w-[min(96vw,720px)]"
        footer={
          <>
            {mode === 'edit' && (
              <Button
                variant="secondary" size="sm"
                onClick={() => setConfirmDelete(true)}
                disabled={pending}
                className="bg-transparent border border-red-500/30 text-red-400 hover:bg-red-500/10"
              >
                Delete
              </Button>
            )}
            <Button
              variant="secondary" size="sm"
              onClick={() => onOpenChange(false)}
              disabled={pending}
              className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={save}
              disabled={!canSave || pending}
              loading={pending}
              className="ml-auto bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
            >
              {pending ? 'Saving…' : mode === 'create' ? 'Create customer' : 'Save changes'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {isSystem && availableCompanies.length > 0 && (
            <div className={sectionClass}>
              <Label className={labelClass}>Assign to company</Label>
              <select
                value={companyId}
                onChange={e => setCompanyId(e.target.value)}
                className={inputClass + ' w-full appearance-none'}
              >
                <option value="">Select…</option>
                {[...availableCompanies].sort((a, b) => a.name.localeCompare(b.name)).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {availableCompanies.length > 1 && (
            <div className={sectionClass}>
              <div className="flex items-center gap-2">
                <Share2 size={12} className="text-indigo-400" />
                <Label className={labelClass}>Cross-company visibility</Label>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {availableCompanies
                  .filter(c => c.id !== companyId)
                  .map(c => {
                    const on = sharedWith.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggleShare(c.id)}
                        className={
                          on
                            ? 'px-2.5 py-1 rounded-md text-[11px] font-medium bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                            : 'px-2.5 py-1 rounded-md text-[11px] text-slate-400 border border-[#1f1f1f] hover:text-slate-200 hover:border-[#2a2a2a]'
                        }
                      >
                        {c.name}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Identification */}
          <div className={sectionClass}>
            <Label className={labelClass}>Identification</Label>
            <div className="grid grid-cols-2 gap-2">
              <FormField>
                <Label className={labelClass}>Legal name <span className="text-red-400 ml-1">*</span></Label>
                <Input value={name} onChange={e => setName(e.target.value)} className={inputClass} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Nickname</Label>
                <Input value={nickname} onChange={e => setNickname(e.target.value)} className={inputClass} />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <FormField>
                <Label className={labelClass}>Tax ID / EIN</Label>
                <Input value={taxId} onChange={e => setTaxId(e.target.value)} className={inputClass + ' font-mono tabular-nums'} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Status</Label>
                <select value={status} onChange={e => setStatus(e.target.value)} className={inputClass + ' w-full appearance-none'}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </FormField>
            </div>
          </div>

          {/* Contact */}
          <div className={sectionClass}>
            <Label className={labelClass}>Contact</Label>
            <FormField>
              <Label className={labelClass}>Contact person</Label>
              <Input value={contactPerson} onChange={e => setContactPerson(e.target.value)} className={inputClass} placeholder="Full name" />
            </FormField>
            <div className="grid grid-cols-2 gap-2">
              <FormField>
                <Label className={labelClass}>Email</Label>
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputClass} placeholder="name@company.com" />
              </FormField>
              <FormField>
                <Label className={labelClass}>Phone</Label>
                <Input value={phone} onChange={e => setPhone(e.target.value)} className={inputClass + ' font-mono tabular-nums'} placeholder="+1 555…" />
              </FormField>
            </div>
          </div>

          {/* Address */}
          <div className={sectionClass}>
            <Label className={labelClass}>Address</Label>
            <FormField>
              <Label className={labelClass}>Street / location</Label>
              <Input value={location} onChange={e => setLocation(e.target.value)} className={inputClass} placeholder="Street address" />
            </FormField>
            <div className="grid grid-cols-3 gap-2">
              <FormField>
                <Label className={labelClass}>City</Label>
                <Input value={city} onChange={e => setCity(e.target.value)} className={inputClass} />
              </FormField>
              <FormField>
                <Label className={labelClass}>State / Region</Label>
                <Input value={stateVal} onChange={e => setStateVal(e.target.value)} className={inputClass} />
              </FormField>
              <FormField>
                <Label className={labelClass}>ZIP / Postal</Label>
                <Input value={zip} onChange={e => setZip(e.target.value)} className={inputClass + ' font-mono tabular-nums'} />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <FormField>
                <Label className={labelClass}>Country</Label>
                <Input value={country} onChange={e => setCountry(e.target.value)} className={inputClass} />
              </FormField>
              <FormField>
                <Label className={labelClass}>POD (Port of Destination)</Label>
                <SupabaseSelectField
                  source={{
                    table: 'ports', valueColumn: 'name', labelColumn: 'name',
                    secondaryColumn: 'code',
                  }}
                  value={pod}
                  onPick={v => setPod(v)}
                />
              </FormField>
            </div>
          </div>

          {/* Commercial */}
          <div className={sectionClass}>
            <Label className={labelClass}>Commercial</Label>
            <div className="grid grid-cols-2 gap-2">
              <FormField>
                <Label className={labelClass}>Credit limit ($)</Label>
                <Input type="number" min={0} step={100} value={creditLimit} onChange={e => setCreditLimit(e.target.value)} className={inputClass + ' font-mono tabular-nums'} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Payment terms</Label>
                <SupabaseSelectField
                  source={{
                    table: 'payment_terms',
                    valueColumn: 'description',
                    labelColumn: 'description',
                    secondaryColumn: 'code',
                    scopeByCompany: true,
                  }}
                  value={paymentTerms}
                  onPick={v => setPaymentTerms(v)}
                />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <FormField>
                <Label className={labelClass}>Total volume (lbs)</Label>
                <Input type="number" min={0} step={1} value={totalVolumeLBS} onChange={e => setTotalVolumeLBS(e.target.value)} className={inputClass + ' font-mono tabular-nums'} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Last order date</Label>
                <Input type="date" value={lastOrderDate ? lastOrderDate.slice(0, 10) : ''} onChange={e => setLastOrderDate(e.target.value)} className={inputClass} />
              </FormField>
            </div>
          </div>

          <div className="pt-2 border-t border-[#1f1f1f] text-[11px] text-slate-500 flex items-center gap-2">
            <Badge variant="neutral">customers</Badge>
            <span className="ml-auto font-mono tabular-nums text-slate-600">
              {mode === 'create' ? 'new' : `#${customer.id.slice(0, 8)}`}
            </span>
          </div>
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${customer?.name ?? ''}?`}
        description="Removes the customer record. Sales orders, invoices and commissions referencing it keep the name but lose the live link."
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={deleteCustomer}
      />
    </>
  );
};
