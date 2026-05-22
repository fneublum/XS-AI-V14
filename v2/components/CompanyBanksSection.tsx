// Banks subsection rendered inside CompanyEditDrawer. Lets the admin
// list, add, edit, and delete banks for a specific company without
// leaving the company editor.

import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X as XIcon, Loader2 } from 'lucide-react';
import { Button, Input, FormField, Label, ConfirmDialog } from '../primitives';
import { useToast } from '../primitives/Toast';
import {
  Bank, useCompanyBanks, useInsertBank, useUpdateBank, useDeleteBank,
} from '../queries/useCompanyBanks';

interface Props {
  companyId: string;
}

interface DraftBank {
  id?: string;
  code: string;
  name: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
  swift_code: string;
  wire: string;
  routing: string;
  account_number: string;
}

const EMPTY: DraftBank = {
  code: '', name: '', address_line1: '', address_line2: '',
  city: '', state: '', zip_code: '', country: '',
  swift_code: '', wire: '', routing: '', account_number: '',
};

const inputClass = 'h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200';
const labelClass = 'text-[11px] text-slate-500 uppercase tracking-wider font-medium';

const toDraft = (b: Bank): DraftBank => ({
  id: b.id,
  code: b.code ?? '',
  name: b.name ?? '',
  address_line1: b.address_line1 ?? '',
  address_line2: b.address_line2 ?? '',
  city: b.city ?? '',
  state: b.state ?? '',
  zip_code: b.zip_code ?? '',
  country: b.country ?? '',
  swift_code: b.swift_code ?? '',
  wire: b.wire ?? '',
  routing: b.routing ?? '',
  account_number: b.account_number ?? '',
});

const draftToPatch = (d: DraftBank, companyId: string) => ({
  company_id: companyId,
  code:           d.code.trim()           || null,
  name:           d.name.trim()           || null,
  address_line1:  d.address_line1.trim()  || null,
  address_line2:  d.address_line2.trim()  || null,
  city:           d.city.trim()           || null,
  state:          d.state.trim()          || null,
  zip_code:       d.zip_code.trim()       || null,
  country:        d.country.trim()        || null,
  swift_code:     d.swift_code.trim()     || null,
  wire:           d.wire.trim()           || null,
  routing:        d.routing.trim()        || null,
  account_number: d.account_number.trim() || null,
});

export const CompanyBanksSection: React.FC<Props> = ({ companyId }) => {
  const toast = useToast();
  const banks = useCompanyBanks(companyId);
  const insert = useInsertBank();
  const update = useUpdateBank();
  const del    = useDeleteBank();

  const [editing, setEditing] = useState<DraftBank | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Bank | null>(null);

  // Close editor if the row it was bound to disappeared (e.g. saved elsewhere).
  useEffect(() => {
    if (editing?.id && banks.data && !banks.data.find(b => b.id === editing.id)) {
      setEditing(null);
    }
  }, [banks.data, editing?.id]);

  const startCreate = () => setEditing({ ...EMPTY });
  const startEdit = (b: Bank) => setEditing(toDraft(b));
  const cancel = () => setEditing(null);

  const set = (k: keyof DraftBank, v: string) =>
    setEditing(prev => prev ? { ...prev, [k]: v } : prev);

  const save = () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      toast.push({ kind: 'error', title: 'Bank name required' });
      return;
    }
    const patch = draftToPatch(editing, companyId);
    if (editing.id) {
      update.mutate({ id: editing.id, ...patch }, {
        onSuccess: () => {
          toast.push({ kind: 'success', title: 'Bank updated', description: editing.name });
          setEditing(null);
        },
        onError: (err) => toast.push({
          kind: 'error', title: 'Update failed', description: err.message,
        }),
      });
    } else {
      insert.mutate(patch, {
        onSuccess: () => {
          toast.push({ kind: 'success', title: 'Bank added', description: editing.name });
          setEditing(null);
        },
        onError: (err) => toast.push({
          kind: 'error', title: 'Add failed', description: err.message,
        }),
      });
    }
  };

  const busy = insert.isPending || update.isPending;

  return (
    <div className="p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f] space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className={labelClass}>Banks</div>
          <p className="text-[11px] text-slate-500">
            Wire instructions printed on this company's proformas & invoices.
          </p>
        </div>
        {!editing && (
          <Button
            size="sm"
            variant="secondary"
            onClick={startCreate}
            className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
          >
            <Plus size={13} className="mr-1.5" />
            Add bank
          </Button>
        )}
      </div>

      {/* Bank list */}
      {!editing && (
        <div className="space-y-1.5">
          {banks.isLoading && (
            <div className="text-[11px] text-slate-600 italic flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" /> Loading…
            </div>
          )}
          {banks.data && banks.data.length === 0 && !banks.isLoading && (
            <div className="text-[11px] text-slate-600 italic">
              No banks for this company yet.
            </div>
          )}
          {banks.data?.map(b => (
            <div
              key={b.id}
              className="flex items-center gap-2 py-1.5 px-2 rounded-sm hover:bg-[#161616] group"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] text-slate-200 font-medium truncate">
                  {b.name ?? '—'}
                </div>
                <div className="text-[11px] text-slate-500 font-mono tabular-nums truncate">
                  {[b.code, b.swift_code, b.account_number].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => startEdit(b)}
                className="p-1.5 rounded-sm text-slate-500 hover:text-slate-100 hover:bg-[#1f1f1f] opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Edit bank"
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(b)}
                className="p-1.5 rounded-sm text-rose-500/70 hover:text-rose-300 hover:bg-[#1f1f1f] opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Delete bank"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Inline editor */}
      {editing && (
        <div className="border-t border-[#1f1f1f] pt-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] text-slate-400 uppercase tracking-wider font-medium">
              {editing.id ? 'Edit bank' : 'Add bank'}
            </div>
            <button
              type="button"
              onClick={cancel}
              className="p-1 rounded-sm text-slate-500 hover:text-slate-200"
              aria-label="Close editor"
            >
              <XIcon size={13} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FormField className="col-span-2">
              <Label className={labelClass}>Bank name *</Label>
              <Input className={inputClass} value={editing.name} onChange={e => set('name', e.target.value)} />
            </FormField>
            <FormField>
              <Label className={labelClass}>Short code</Label>
              <Input className={inputClass + ' font-mono tabular-nums'} value={editing.code} onChange={e => set('code', e.target.value)} placeholder="e.g. WELLS" />
            </FormField>
            <FormField>
              <Label className={labelClass}>SWIFT</Label>
              <Input className={inputClass + ' font-mono tabular-nums'} value={editing.swift_code} onChange={e => set('swift_code', e.target.value)} />
            </FormField>
            <FormField>
              <Label className={labelClass}>Account #</Label>
              <Input className={inputClass + ' font-mono tabular-nums'} value={editing.account_number} onChange={e => set('account_number', e.target.value)} />
            </FormField>
            <FormField>
              <Label className={labelClass}>Routing</Label>
              <Input className={inputClass + ' font-mono tabular-nums'} value={editing.routing} onChange={e => set('routing', e.target.value)} />
            </FormField>
            <FormField className="col-span-2">
              <Label className={labelClass}>Wire / ABA</Label>
              <Input className={inputClass + ' font-mono tabular-nums'} value={editing.wire} onChange={e => set('wire', e.target.value)} />
            </FormField>
            <FormField className="col-span-2">
              <Label className={labelClass}>Address line 1</Label>
              <Input className={inputClass} value={editing.address_line1} onChange={e => set('address_line1', e.target.value)} />
            </FormField>
            <FormField className="col-span-2">
              <Label className={labelClass}>Address line 2</Label>
              <Input className={inputClass} value={editing.address_line2} onChange={e => set('address_line2', e.target.value)} />
            </FormField>
            <FormField>
              <Label className={labelClass}>City</Label>
              <Input className={inputClass} value={editing.city} onChange={e => set('city', e.target.value)} />
            </FormField>
            <FormField>
              <Label className={labelClass}>State</Label>
              <Input className={inputClass} value={editing.state} onChange={e => set('state', e.target.value)} />
            </FormField>
            <FormField>
              <Label className={labelClass}>ZIP</Label>
              <Input className={inputClass + ' font-mono tabular-nums'} value={editing.zip_code} onChange={e => set('zip_code', e.target.value)} />
            </FormField>
            <FormField>
              <Label className={labelClass}>Country</Label>
              <Input className={inputClass} value={editing.country} onChange={e => set('country', e.target.value)} />
            </FormField>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              variant="secondary"
              onClick={cancel}
              disabled={busy}
              className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={save}
              disabled={busy || !editing.name.trim()}
              loading={busy}
              className="ml-auto bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
            >
              {busy ? 'Saving…' : (editing.id ? 'Save changes' : 'Add bank')}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={`Delete ${confirmDelete?.name ?? 'this bank'}?`}
        description="This removes the bank record permanently. Documents that reference it may stop showing wire instructions until reassigned."
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={() => {
          if (!confirmDelete) return;
          const label = confirmDelete.name ?? 'Bank';
          del.mutate(confirmDelete.id, {
            onSuccess: () => {
              toast.push({ kind: 'success', title: 'Deleted', description: label });
              setConfirmDelete(null);
            },
            onError: (err) => {
              toast.push({ kind: 'error', title: 'Delete failed', description: err.message });
              setConfirmDelete(null);
            },
          });
        }}
      />
    </div>
  );
};
