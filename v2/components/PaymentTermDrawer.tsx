// Payment Term editor drawer — full-fidelity port of v1
// pages/PaymentTerms.tsx. Handles every column on the
// `payment_terms` table, including the installments schedule and the
// active flag that the generic InspectDrawer can't render.

import React, { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  Drawer, Input, FormField, Label, Button, Badge, ConfirmDialog,
} from '../primitives';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import {
  useEntityUpdate, useEntityInsert, useEntityDelete,
} from '../queries/useEntityMutations';
import type { EditorMode } from '../providers/EditorProvider';
import type { PaymentTerm, PaymentInstallment, PaymentEvent } from '../queries/usePaymentTerms';

interface Props {
  term: PaymentTerm | null;
  mode: EditorMode;
  onOpenChange: (open: boolean) => void;
}

const TYPE_OPTIONS   = ['ALL', 'DOMESTIC', 'IMPORT', 'EXPORT'] as const;
const METHOD_OPTIONS = ['TT', 'LC', 'CAD', 'DA', 'DP', 'ADVANCE', 'NET', 'COD', 'OTHER'] as const;
const EVENT_OPTIONS: PaymentEvent[] = ['ORDER', 'INVOICE', 'BL', 'DELIVERY', 'SIGHT'];

const inputClass =
  'h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 rounded-md px-2 ' +
  'placeholder:text-slate-600 focus:ring-1 focus:ring-indigo-500 outline-none';
const labelClass = 'text-[11px] text-slate-500 uppercase tracking-wider font-medium';
const sectionClass = 'p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f] space-y-3';

const emptyInstallment = (n: number): PaymentInstallment => ({
  payment_number: n,
  pct: 0,
  days: 0,
  event: 'INVOICE',
  description: '',
});

const Pill: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({
  active, onClick, children,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={
      active
        ? 'px-2.5 py-1 rounded-md text-[11px] font-medium bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
        : 'px-2.5 py-1 rounded-md text-[11px] text-slate-400 border border-[#1f1f1f] hover:text-slate-200 hover:border-[#2a2a2a]'
    }
  >
    {children}
  </button>
);

export const PaymentTermDrawer: React.FC<Props> = ({ term, mode, onOpenChange }) => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();

  const [code, setCode]                 = useState('');
  const [description, setDescription]   = useState('');
  const [type, setType]                 = useState<string>('ALL');
  const [method, setMethod]             = useState<string>('TT');
  const [notes, setNotes]               = useState('');
  const [active, setActive]             = useState(true);
  const [installments, setInstallments] = useState<PaymentInstallment[]>([emptyInstallment(1)]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const update = useEntityUpdate<{ id: string } & Record<string, unknown>>({
    table: 'payment_terms', listQueryKeys: ['paymentTerms'],
  });
  const insert = useEntityInsert<Record<string, unknown>>({
    table: 'payment_terms', listQueryKeys: ['paymentTerms'], idPrefix: 'PT',
  });
  const del = useEntityDelete({ table: 'payment_terms', listQueryKeys: ['paymentTerms'] });

  useEffect(() => {
    if (!term) return;
    setCode(term.code ?? '');
    setDescription(term.description ?? '');
    setType((term.type ?? 'ALL').toUpperCase());
    setMethod((term.method ?? 'TT').toUpperCase());
    setNotes(term.notes ?? '');
    setActive(term.active ?? true);
    setInstallments(
      term.installments && term.installments.length > 0
        ? term.installments.map((it, i) => ({ ...it, payment_number: i + 1 }))
        : [emptyInstallment(1)],
    );
  }, [term?.id, mode]);

  const totalPct = useMemo(
    () => installments.reduce((s, i) => s + (Number(i.pct) || 0), 0),
    [installments],
  );
  const pctValid = Math.abs(totalPct - 100) < 0.1;

  const canSave = code.trim() !== '' && description.trim() !== '' && pctValid;
  const pending = update.isPending || insert.isPending || del.isPending;

  const addInstallment = () => {
    setInstallments(prev => [...prev, emptyInstallment(prev.length + 1)]);
  };
  const removeInstallment = (idx: number) => {
    setInstallments(prev =>
      prev.filter((_, i) => i !== idx).map((it, i) => ({ ...it, payment_number: i + 1 })),
    );
  };
  const updateInstallment = <K extends keyof PaymentInstallment>(
    idx: number, key: K, value: PaymentInstallment[K],
  ) => {
    setInstallments(prev => prev.map((it, i) => i === idx ? { ...it, [key]: value } : it));
  };

  const buildPayload = () => ({
    companyId: term?.companyId ?? (currentCompanyId !== 'ALL' ? currentCompanyId : 'ALL'),
    code: code.trim().toUpperCase(),
    description: description.trim(),
    type,
    method,
    num_payments: installments.length,
    installments,
    notes: notes.trim() || null,
    active,
  });

  const save = () => {
    if (!canSave) {
      toast.push({ kind: 'warning', title: 'Missing required fields', description: 'Code, description, and installments summing to 100% are required.' });
      return;
    }
    const payload = buildPayload();
    if (mode === 'create') {
      insert.mutate(payload, {
        onSuccess: () => {
          toast.push({ kind: 'success', title: 'Payment term created', description: payload.code });
          onOpenChange(false);
        },
        onError: (err) => toast.push({ kind: 'error', title: 'Create failed', description: err.message }),
      });
    } else if (term) {
      update.mutate({ id: term.id, ...payload }, {
        onSuccess: () => {
          toast.push({ kind: 'success', title: 'Saved', description: payload.code });
          onOpenChange(false);
        },
        onError: (err) => toast.push({ kind: 'error', title: 'Save failed', description: err.message }),
      });
    }
  };

  const deleteTerm = () => {
    if (!term) return;
    del.mutate(term.id, {
      onSuccess: () => {
        toast.push({ kind: 'success', title: 'Deleted', description: term.code });
        setConfirmDelete(false);
        onOpenChange(false);
      },
      onError: (err) => {
        toast.push({ kind: 'error', title: 'Delete failed', description: err.message });
        setConfirmDelete(false);
      },
    });
  };

  if (!term) return null;

  return (
    <>
      <Drawer
        open={!!term}
        onOpenChange={onOpenChange}
        title={mode === 'create' ? 'New payment term' : (term.code || 'Payment term')}
        description={mode === 'edit' ? (term.description ?? undefined) : 'Define a reusable payment schedule.'}
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
              {pending ? 'Saving…' : mode === 'create' ? 'Create term' : 'Save changes'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Identification */}
          <div className={sectionClass}>
            <Label className={labelClass}>Identification</Label>
            <div className="grid grid-cols-[1fr_2fr] gap-2">
              <FormField>
                <Label className={labelClass}>Code <span className="text-red-400 ml-1">*</span></Label>
                <Input
                  value={code}
                  onChange={e => setCode(e.target.value.toUpperCase())}
                  placeholder="TT30BL"
                  className={inputClass + ' font-mono tabular-nums'}
                />
              </FormField>
              <FormField>
                <Label className={labelClass}>Description <span className="text-red-400 ml-1">*</span></Label>
                <Input
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="T/T 30 days after B/L"
                  className={inputClass}
                />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <FormField>
                <Label className={labelClass}>Type</Label>
                <div className="flex flex-wrap gap-1.5">
                  {TYPE_OPTIONS.map(t => (
                    <Pill key={t} active={type === t} onClick={() => setType(t)}>{t}</Pill>
                  ))}
                </div>
              </FormField>
              <FormField>
                <Label className={labelClass}>Method</Label>
                <div className="flex flex-wrap gap-1.5">
                  {METHOD_OPTIONS.map(m => (
                    <Pill key={m} active={method === m} onClick={() => setMethod(m)}>{m}</Pill>
                  ))}
                </div>
              </FormField>
            </div>
          </div>

          {/* Installments */}
          <div className={sectionClass}>
            <div className="flex items-center justify-between">
              <Label className={labelClass}>Installments</Label>
              <div className="flex items-center gap-2">
                <span className={
                  'text-[10px] font-mono tabular-nums px-2 py-0.5 rounded ' +
                  (pctValid
                    ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                    : 'bg-red-500/10 text-red-300 border border-red-500/30')
                }>
                  {totalPct.toFixed(1)}% {pctValid ? '✓' : '≠ 100%'}
                </span>
                <button
                  type="button"
                  onClick={addInstallment}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
                >
                  <Plus size={12} /> Add
                </button>
              </div>
            </div>
            <div className="grid grid-cols-[24px_70px_60px_90px_1fr_24px] gap-1.5 text-[10px] font-medium text-slate-500 uppercase tracking-wider px-1">
              <span>#</span>
              <span className="text-right">%</span>
              <span className="text-right">Days</span>
              <span>Trigger</span>
              <span>Description</span>
              <span />
            </div>
            <div className="space-y-1">
              {installments.map((inst, idx) => (
                <div key={idx} className="grid grid-cols-[24px_70px_60px_90px_1fr_24px] gap-1.5 items-center">
                  <span className="text-center text-[11px] text-slate-400 font-mono">{inst.payment_number}</span>
                  <Input
                    type="number" min={0} max={100} step={0.1}
                    value={String(inst.pct ?? 0)}
                    onChange={e => updateInstallment(idx, 'pct', Number(e.target.value) || 0)}
                    className={inputClass + ' font-mono tabular-nums text-right'}
                  />
                  <Input
                    type="number" min={0} step={1}
                    value={String(inst.days ?? 0)}
                    onChange={e => updateInstallment(idx, 'days', Number(e.target.value) || 0)}
                    className={inputClass + ' font-mono tabular-nums text-right'}
                  />
                  <select
                    value={inst.event}
                    onChange={e => updateInstallment(idx, 'event', e.target.value as PaymentEvent)}
                    className={inputClass + ' w-full appearance-none'}
                  >
                    {EVENT_OPTIONS.map(ev => <option key={ev} value={ev}>{ev}</option>)}
                  </select>
                  <Input
                    value={inst.description ?? ''}
                    onChange={e => updateInstallment(idx, 'description', e.target.value)}
                    placeholder="Description"
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => removeInstallment(idx)}
                    disabled={installments.length <= 1}
                    className="text-slate-500 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
                    aria-label="Remove installment"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Notes + status */}
          <div className={sectionClass}>
            <FormField>
              <Label className={labelClass}>Notes</Label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                className="w-full bg-[#111111] border border-[#1f1f1f] rounded-md px-2 py-1.5 text-[12.5px] text-slate-200 resize-y"
              />
            </FormField>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={active}
                onChange={e => setActive(e.target.checked)}
                className="w-4 h-4 rounded accent-indigo-500"
              />
              <span className="text-[12.5px] text-slate-300">Active (shown in dropdowns)</span>
            </label>
          </div>

          <div className="pt-2 border-t border-[#1f1f1f] text-[11px] text-slate-500 flex items-center gap-2">
            <Badge variant="neutral">payment_terms</Badge>
            <span className="ml-auto font-mono tabular-nums text-slate-600">
              {mode === 'create' ? 'new' : `#${term.id.slice(0, 8)}`}
            </span>
          </div>
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${term?.code ?? ''}?`}
        description="Invoices and orders referencing this term keep the text value but lose the live link."
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={deleteTerm}
      />
    </>
  );
};
