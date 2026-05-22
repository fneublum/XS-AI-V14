// Phase 3B — Supplier editor drawer. Full v1 parity.

import React, { useEffect, useState } from 'react';
import { X as XIcon, Plus, Share2 } from 'lucide-react';
import {
  Drawer, Input, FormField, Label, Button, Badge, ConfirmDialog,
} from '../primitives';
import { Supplier } from '../queries/useSuppliers';
import { useCompanies } from '../queries/useCompanies';
import { useEntityUpdate, useEntityInsert, useEntityDelete } from '../queries/useEntityMutations';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import { SupabaseSelectField } from './SupabaseSelectField';
import type { EditorMode } from '../providers/EditorProvider';

const PAYMENT_TERMS = [
  'Net 30 Days', 'Net 60 Days', 'Prepaid', 'L/C at Sight', 'L/C 60 Days',
  'Cash Against Documents', 'Cash on Delivery',
  'T/T 30 Days After B/L', '100% T/T in Advance',
  '40% Advance + 60% Cash Against Documents', '50% Advance + 50% on Cash Against Documents',
  '30% Advance + 70% on Cash Against Documents',
  'Advance + Cash Against Documents',
];

const CATEGORY_SUGGESTIONS = [
  'Resin', 'Fiber Textile', 'Cotton Waste', 'Plastic Scrap',
  'PA6', 'PA66', 'PET', 'PBT', 'PP', 'PE', 'PC', 'ABS',
];

const inputClass =
  'h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 rounded-md px-2 ' +
  'placeholder:text-slate-600 focus:ring-1 focus:ring-indigo-500 outline-none';

const labelClass = 'text-[11px] text-slate-500 uppercase tracking-wider font-medium';
const sectionClass = 'p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f] space-y-3';

interface Props {
  supplier: Supplier | null;
  mode: EditorMode;
  onOpenChange: (open: boolean) => void;
}

export const SupplierDrawer: React.FC<Props> = ({ supplier, mode, onOpenChange }) => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const companies = useCompanies();

  const [companyId, setCompanyId]         = useState<string>(currentCompanyId !== 'ALL' ? currentCompanyId : '');
  const [name, setName]                   = useState('');
  const [taxId, setTaxId]                 = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [email, setEmail]                 = useState('');
  const [phone, setPhone]                 = useState('');
  const [location, setLocation]           = useState('');
  const [city, setCity]                   = useState('');
  const [stateVal, setStateVal]           = useState('');
  const [zip, setZip]                     = useState('');
  const [country, setCountry]             = useState('');
  const [categories, setCategories]       = useState<string[]>([]);
  const [newCategory, setNewCategory]     = useState('');
  const [rating, setRating]               = useState('3');
  const [paymentTerms, setPaymentTerms]   = useState('Net 30 Days');
  const [sharedWith, setSharedWith]       = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const del = useEntityDelete({ table: 'suppliers', listQueryKeys: ['suppliers'] });
  const update = useEntityUpdate<{ id: string } & Record<string, unknown>>({
    table: 'suppliers', listQueryKeys: ['suppliers'],
  });
  const insert = useEntityInsert<Record<string, unknown>>({
    table: 'suppliers', listQueryKeys: ['suppliers'], idPrefix: 'SUP',
    withCreatedAt: false,
  });

  useEffect(() => {
    if (!supplier) return;
    setCompanyId(supplier.companyId ?? (currentCompanyId !== 'ALL' ? currentCompanyId : ''));
    setName(supplier.name ?? '');
    setTaxId(supplier.taxId ?? '');
    setContactPerson(supplier.contactPerson ?? '');
    setEmail(supplier.email ?? '');
    setPhone(supplier.phone ?? '');
    setLocation(supplier.location ?? '');
    setCity(supplier.city ?? '');
    setStateVal(supplier.state ?? '');
    setZip(supplier.zip ?? '');
    setCountry(supplier.country ?? '');
    setCategories(supplier.categories ?? []);
    setRating(supplier.rating === null || supplier.rating === undefined ? '3' : String(supplier.rating));
    setPaymentTerms(supplier.paymentTerms ?? 'Net 30 Days');
    setSharedWith(supplier.sharedWith ?? []);
  }, [supplier?.id, mode]);

  const toggleShare = (id: string) =>
    setSharedWith(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const ratingNum = Number(rating);
  const ratingValid = Number.isFinite(ratingNum) && ratingNum >= 0 && ratingNum <= 5;
  const canSave = name.trim() !== '' && ratingValid;
  const pending = update.isPending || insert.isPending || del.isPending;

  const addCategory = (c: string) => {
    const trimmed = c.trim();
    if (!trimmed) return;
    if (categories.includes(trimmed)) return;
    setCategories(prev => [...prev, trimmed]);
    setNewCategory('');
  };
  const removeCategory = (c: string) =>
    setCategories(prev => prev.filter(x => x !== c));

  const buildPayload = () => ({
    companyId: companyId || currentCompanyId,
    name: name.trim(),
    taxId: taxId || null,
    contactPerson: contactPerson || null,
    email: email || null,
    phone: phone || null,
    location: location || null,
    city: city || null,
    state: stateVal || null,
    zip: zip || null,
    country: country || null,
    categories,
    rating: Number.isFinite(ratingNum) ? ratingNum : null,
    paymentTerms: paymentTerms || null,
    sharedWith,
  });

  const save = () => {
    if (!canSave) {
      toast.push({ kind: 'warning', title: 'Name required + rating 0–5' });
      return;
    }
    const payload = buildPayload();
    if (mode === 'create') {
      insert.mutate(payload, {
        onSuccess: () => {
          toast.push({ kind: 'success', title: 'Supplier created', description: payload.name });
          onOpenChange(false);
        },
        onError: (err) => toast.push({
          kind: 'error', title: 'Create failed', description: err.message,
        }),
      });
    } else if (supplier) {
      update.mutate({ id: supplier.id, ...payload }, {
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

  const deleteSupplier = () => {
    if (!supplier) return;
    del.mutate(supplier.id, {
      onSuccess: () => {
        toast.push({ kind: 'success', title: 'Deleted', description: supplier.name });
        setConfirmDelete(false);
        onOpenChange(false);
      },
      onError: (err) => {
        toast.push({ kind: 'error', title: 'Delete failed', description: err.message });
        setConfirmDelete(false);
      },
    });
  };

  if (!supplier) return null;

  const availableCompanies = companies.data ?? [];
  const isSystem = currentCompanyId === 'ALL';

  return (
    <>
      <Drawer
        open={!!supplier}
        onOpenChange={onOpenChange}
        title={mode === 'create' ? 'New supplier' : (supplier.name || 'Supplier')}
        description={mode === 'edit' ? (supplier.email ?? supplier.country ?? undefined) : 'Catalog a new supplier.'}
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
              {pending ? 'Saving…' : mode === 'create' ? 'Create supplier' : 'Save changes'}
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

          <div className={sectionClass}>
            <Label className={labelClass}>Identification</Label>
            <div className="grid grid-cols-2 gap-2">
              <FormField>
                <Label className={labelClass}>Legal name <span className="text-red-400 ml-1">*</span></Label>
                <Input value={name} onChange={e => setName(e.target.value)} className={inputClass} autoFocus={mode === 'create'} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Tax ID / EIN</Label>
                <Input value={taxId} onChange={e => setTaxId(e.target.value)} className={inputClass + ' font-mono tabular-nums'} />
              </FormField>
            </div>
          </div>

          <div className={sectionClass}>
            <Label className={labelClass}>Contact</Label>
            <FormField>
              <Label className={labelClass}>Contact person</Label>
              <Input value={contactPerson} onChange={e => setContactPerson(e.target.value)} className={inputClass} placeholder="Full name" />
            </FormField>
            <div className="grid grid-cols-2 gap-2">
              <FormField>
                <Label className={labelClass}>Email</Label>
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputClass} placeholder="name@supplier.com" />
              </FormField>
              <FormField>
                <Label className={labelClass}>Phone</Label>
                <Input value={phone} onChange={e => setPhone(e.target.value)} className={inputClass + ' font-mono tabular-nums'} />
              </FormField>
            </div>
          </div>

          <div className={sectionClass}>
            <Label className={labelClass}>Address</Label>
            <FormField>
              <Label className={labelClass}>Street / location</Label>
              <Input value={location} onChange={e => setLocation(e.target.value)} className={inputClass} />
            </FormField>
            <div className="grid grid-cols-3 gap-2">
              <FormField>
                <Label className={labelClass}>City</Label>
                <Input value={city} onChange={e => setCity(e.target.value)} className={inputClass} />
              </FormField>
              <FormField>
                <Label className={labelClass}>State</Label>
                <Input value={stateVal} onChange={e => setStateVal(e.target.value)} className={inputClass} />
              </FormField>
              <FormField>
                <Label className={labelClass}>ZIP</Label>
                <Input value={zip} onChange={e => setZip(e.target.value)} className={inputClass + ' font-mono tabular-nums'} />
              </FormField>
            </div>
            <FormField>
              <Label className={labelClass}>Country</Label>
              <Input value={country} onChange={e => setCountry(e.target.value)} className={inputClass} />
            </FormField>
          </div>

          {/* Categories */}
          <div className={sectionClass}>
            <Label className={labelClass}>Product categories</Label>
            <div className="flex flex-wrap gap-1.5">
              {categories.map(c => (
                <span key={c} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-600/10 border border-indigo-500/30 text-indigo-300 text-[11px]">
                  {c}
                  <button
                    type="button"
                    onClick={() => removeCategory(c)}
                    className="text-indigo-300 hover:text-red-400"
                  >
                    <XIcon size={10} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={newCategory}
                onChange={e => setNewCategory(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCategory(newCategory); } }}
                placeholder="Add category"
                className={inputClass + ' flex-1'}
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => addCategory(newCategory)}
                disabled={!newCategory.trim()}
                className="bg-[#161616] border border-[#1f1f1f] text-slate-200 hover:bg-[#1a1a1a] h-8 px-2.5 text-[12px]"
              >
                <Plus size={12} />
                Add
              </Button>
            </div>
            <div className="flex flex-wrap gap-1">
              <span className="text-[10px] text-slate-600 mr-1 self-center">Quick add:</span>
              {CATEGORY_SUGGESTIONS.filter(s => !categories.includes(s)).slice(0, 8).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => addCategory(s)}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-[#1f1f1f] text-slate-500 hover:text-slate-200 hover:border-[#2a2a2a]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Commercial */}
          <div className={sectionClass}>
            <Label className={labelClass}>Commercial</Label>
            <div className="grid grid-cols-2 gap-2">
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
              <FormField>
                <Label className={labelClass}>Rating (0–5)</Label>
                <Input
                  type="number" min={0} max={5} step={0.1}
                  value={rating}
                  onChange={e => setRating(e.target.value)}
                  invalid={!ratingValid}
                  className={inputClass + ' font-mono tabular-nums'}
                />
              </FormField>
            </div>
          </div>

          <div className="pt-2 border-t border-[#1f1f1f] text-[11px] text-slate-500 flex items-center gap-2">
            <Badge variant="neutral">suppliers</Badge>
            <span className="ml-auto font-mono tabular-nums text-slate-600">
              {mode === 'create' ? 'new' : `#${supplier.id.slice(0, 8)}`}
            </span>
          </div>
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${supplier?.name ?? 'supplier'}?`}
        description="Removes the supplier record. Purchase orders and supplier invoices referencing it keep the name but lose the live link."
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={deleteSupplier}
      />
    </>
  );
};
