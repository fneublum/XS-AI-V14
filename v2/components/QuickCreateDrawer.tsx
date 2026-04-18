// Phase 3B — Reusable quick-create drawer.
//
// Every list page wires one of these for its `+ New X` action. Pass a
// schema of fields and the drawer renders a tight Linear-style form
// bound to `useEntityInsert`. For company-scoped tables, pass
// `scopeByCompany: true` and the current companyId is merged into the
// insert payload automatically.

import React, { useEffect, useMemo, useState } from 'react';
import {
  Drawer, Input, FormField, Label, Button, Badge,
} from '../primitives';
import { useToast } from '../primitives/Toast';
import { useEntityInsert } from '../queries/useEntityMutations';
import { useCompany } from '../providers/CompanyProvider';

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'textarea';

export interface FieldDef {
  key: string;
  label: string;
  type?: FieldType;              // default: text
  required?: boolean;
  options?: string[];            // for type=select
  placeholder?: string;
  mono?: boolean;                // font-mono + tabular-nums
  defaultValue?: string;
  fullWidth?: boolean;           // span both columns
  min?: number;
  max?: number;
  step?: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  table: string;
  idPrefix: string;
  listQueryKeys: string[];
  fields: FieldDef[];
  scopeByCompany?: boolean;
  /** Extra fields merged into the insert payload (e.g. hardcoded status). */
  extras?: Record<string, unknown>;
  /** Success message override. Default: "Created". */
  successMessage?: string;
}

const inputClass = 'h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200';
const inputMono  = 'font-mono tabular-nums';

export const QuickCreateDrawer: React.FC<Props> = ({
  open, onOpenChange, title, description, table, idPrefix, listQueryKeys,
  fields, scopeByCompany = false, extras, successMessage,
}) => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const insert = useEntityInsert({ table, listQueryKeys, idPrefix });

  const initial = useMemo(() => {
    const seed: Record<string, string> = {};
    for (const f of fields) seed[f.key] = f.defaultValue ?? '';
    return seed;
  }, [fields]);

  const [values, setValues] = useState<Record<string, string>>(initial);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) {
      setValues(initial);
      setSubmitted(false);
    }
  }, [open, initial]);

  const set = (k: string, v: string) => setValues(prev => ({ ...prev, [k]: v }));

  const missingRequired = fields
    .filter(f => f.required && !values[f.key]?.trim())
    .map(f => f.label);

  const valid = missingRequired.length === 0;

  const save = () => {
    setSubmitted(true);
    if (!valid) return;

    const payload: Record<string, unknown> = { ...extras };
    for (const f of fields) {
      const raw = values[f.key]?.trim() ?? '';
      if (raw === '') {
        payload[f.key] = null;
      } else if (f.type === 'number') {
        const n = Number(raw);
        payload[f.key] = Number.isFinite(n) ? n : null;
      } else {
        payload[f.key] = raw;
      }
    }
    if (scopeByCompany && currentCompanyId !== 'ALL') {
      payload.companyId = currentCompanyId;
    }

    insert.mutate(payload as never, {
      onSuccess: () => {
        toast.push({
          kind: 'success',
          title: successMessage ?? 'Created',
          description: title,
        });
        onOpenChange(false);
      },
      onError: (err) => toast.push({
        kind: 'error',
        title: 'Create failed',
        description: err.message,
      }),
    });
  };

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button
            variant="secondary" size="sm"
            onClick={() => onOpenChange(false)}
            disabled={insert.isPending}
            className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={insert.isPending}
            loading={insert.isPending}
            className="ml-auto bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
          >
            {insert.isPending ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {submitted && !valid && (
          <div className="px-3 py-2 rounded-md border border-red-500/30 bg-red-500/5 text-[12px] text-red-300">
            Missing required: {missingRequired.join(', ')}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {fields.map(f => {
            const className = [inputClass, f.mono ? inputMono : ''].filter(Boolean).join(' ');
            const colSpan = f.fullWidth || f.type === 'textarea' ? 'col-span-2' : '';

            return (
              <FormField key={f.key} className={colSpan}>
                <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
                  {f.label}
                  {f.required && <span className="text-red-400 ml-1">*</span>}
                </Label>

                {f.type === 'select' ? (
                  <div className="flex flex-wrap gap-1.5">
                    {(f.options ?? []).map(opt => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => set(f.key, opt)}
                        className={
                          values[f.key] === opt
                            ? 'px-2.5 py-1 rounded-md text-[11px] font-medium bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                            : 'px-2.5 py-1 rounded-md text-[11px] text-slate-400 border border-[#1f1f1f] hover:text-slate-200 hover:border-[#2a2a2a]'
                        }
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                ) : f.type === 'textarea' ? (
                  <textarea
                    value={values[f.key] ?? ''}
                    onChange={e => set(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    rows={3}
                    className="bg-[#111111] border border-[#1f1f1f] rounded-md px-2 py-1.5 text-[12.5px] text-slate-200 placeholder:text-slate-600 resize-y"
                  />
                ) : (
                  <Input
                    type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'}
                    value={values[f.key] ?? ''}
                    onChange={e => set(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    className={className}
                  />
                )}
              </FormField>
            );
          })}
        </div>

        <div className="pt-2 border-t border-[#1f1f1f] text-[11px] text-slate-500 flex items-center gap-2">
          <Badge variant="neutral">{table}</Badge>
          {scopeByCompany && currentCompanyId !== 'ALL' && (
            <span className="text-slate-600">company <span className="font-mono">{currentCompanyId}</span></span>
          )}
        </div>
      </div>
    </Drawer>
  );
};
