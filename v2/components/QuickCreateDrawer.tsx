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
import { SupabaseSelectField, FieldSource } from './SupabaseSelectField';

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'textarea';

/** Select options support both plain strings (value === label) and
 *  `{ value, label }` pairs so a field can display an uppercase chip
 *  while still writing the canonical value that downstream code
 *  expects (e.g. role gates matching `'Cargo Agent'`). */
export type SelectOption = string | { value: string; label: string };

export interface FieldDef {
  key: string;
  label: string;
  type?: FieldType;              // default: text
  required?: boolean;
  options?: SelectOption[];      // for type=select
  placeholder?: string;
  mono?: boolean;                // font-mono + tabular-nums
  defaultValue?: string;
  fullWidth?: boolean;           // span both columns
  min?: number;
  max?: number;
  step?: number;
  /**
   * DB column name if it differs from `key`. Reading still uses `key`
   * (because row objects are camelCase-mapped) but writing to the DB
   * uses `dbKey`. Needed for tables that are snake_case end-to-end,
   * like `freight_quotes`.
   */
  dbKey?: string;
  /**
   * When present, this field becomes a Supabase-backed searchable
   * dropdown sourced from the given table. See SupabaseSelectField.
   */
  source?: FieldSource;
  /**
   * Pair with `source` to render a combobox (dropdown suggestions +
   * free-form typing). Used for fields like pickup/delivery location
   * where a canonical table is a useful shortcut but the stored value
   * is free-form (street addresses).
   */
  allowFreeText?: boolean;
  /**
   * Only meaningful for `type: 'multiselect'`. When set to `'csv'` the
   * drawer persists the selected values as a single comma-separated
   * string in a plain text column instead of a native text[] column.
   * Used for back-compat with columns like `users.linked_entity_id`
   * that started life as scalars but now need to hold multiple IDs
   * without a schema migration.
   */
  serialize?: 'csv';
  /**
   * Coerce the saved value to a non-string type before insert. Needed
   * for `select` fields whose options write `'true'/'false'/'1'/'0'`
   * but the underlying column is `bigint` / `boolean`. Empty string
   * always becomes `null` regardless.
   *   - 'number'  → Number(s); non-finite becomes null
   *   - 'boolean' → 'true'/'1' → true, 'false'/'0' → false, else null
   */
  castType?: 'number' | 'boolean';
  /**
   * Skip rendering this field in the drawer UI but keep it in the
   * save loop. Used for "shadow" columns whose value is populated by
   * another field's `writeAlso` (e.g. POA code resolves the port
   * name into `originPort`) — the resolved value still needs to
   * persist on save.
   */
  hidden?: boolean;
}

export type { FieldSource };

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
  /**
   * DB column to write the current companyId to when scopeByCompany
   * is true. Defaults to `companyId`. Set to `company_id` for
   * snake_case tables.
   */
  companyIdColumn?: string;
  /** Extra fields merged into the insert payload (e.g. hardcoded status). */
  extras?: Record<string, unknown>;
  /** Async id generator. When provided, the drawer awaits this before
   *  inserting and writes the result as the row's `id` (overriding
   *  the random idPrefix-based id). Used for formatted ids like
   *  `FQ-0042` / `PO-00792KL`. Failures fall through to the default. */
  idGenerator?: () => Promise<string>;
  /** Success message override. Default: "Created". */
  successMessage?: string;
  /**
   * Seed values keyed by field `key`. Overrides `defaultValue` and
   * re-applies on open — used by Duplicate-row flows to pre-fill the
   * drawer from an existing row without overwriting the user's edits
   * once they've started typing.
   */
  seed?: Record<string, string | string[] | null | undefined>;
}

const inputClass = 'h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200';
const inputMono  = 'font-mono tabular-nums';

export const QuickCreateDrawer: React.FC<Props> = ({
  open, onOpenChange, title, description, table, idPrefix, listQueryKeys,
  fields, scopeByCompany = false, companyIdColumn = 'companyId',
  extras, successMessage, seed, idGenerator,
}) => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const insert = useEntityInsert({ table, listQueryKeys, idPrefix });

  const initial = useMemo(() => {
    const out: Record<string, string | string[]> = {};
    for (const f of fields) {
      const fromSeed = seed?.[f.key];
      if (f.type === 'multiselect') {
        out[f.key] = Array.isArray(fromSeed) ? fromSeed : [];
      } else if (fromSeed != null && fromSeed !== '' && !Array.isArray(fromSeed)) {
        out[f.key] = String(fromSeed);
      } else {
        out[f.key] = f.defaultValue ?? '';
      }
    }
    return out;
  }, [fields, seed]);

  const [values, setValues] = useState<Record<string, string | string[]>>(initial);
  const [submitted, setSubmitted] = useState(false);

  // Re-seed whenever the drawer is (re-)opened or the seed changes.
  useEffect(() => {
    if (open) {
      setValues(initial);
      setSubmitted(false);
    } else {
      setValues(initial);
      setSubmitted(false);
    }
  }, [open, initial]);

  const set = (k: string, v: string | string[]) => setValues(prev => ({ ...prev, [k]: v }));

  const isEmpty = (v: unknown): boolean => {
    if (Array.isArray(v)) return v.length === 0;
    return !(typeof v === 'string' ? v.trim() : String(v ?? '').trim());
  };

  const missingRequired = fields
    .filter(f => f.required && isEmpty(values[f.key]))
    .map(f => f.label);

  const valid = missingRequired.length === 0;

  const save = async () => {
    setSubmitted(true);
    if (!valid) return;

    const payload: Record<string, unknown> = { ...extras };
    if (idGenerator) {
      try {
        const formatted = await idGenerator();
        if (formatted && formatted.trim()) payload.id = formatted.trim();
      } catch { /* fall through to idPrefix-based default in useEntityInsert */ }
    }
    for (const f of fields) {
      const col = f.dbKey ?? f.key;
      const raw = values[f.key];

      if (f.type === 'multiselect') {
        const arr = Array.isArray(raw) ? raw : [];
        if (f.serialize === 'csv') {
          // Back-compat: store as a single text column using CSV.
          payload[col] = arr.length === 0 ? null : arr.join(',');
        } else {
          payload[col] = arr;
        }
        continue;
      }

      const s = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
      if (s === '') {
        payload[col] = null;
      } else if (f.type === 'number' || f.castType === 'number') {
        const n = Number(s);
        payload[col] = Number.isFinite(n) ? n : null;
      } else if (f.castType === 'boolean') {
        const v = s.toLowerCase();
        payload[col] = (v === 'true' || v === '1' || v === 'yes')
          ? true
          : (v === 'false' || v === '0' || v === 'no') ? false : null;
      } else {
        payload[col] = s;
      }
    }
    if (scopeByCompany && currentCompanyId !== 'ALL') {
      payload[companyIdColumn] = currentCompanyId;
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
          {fields.filter(f => !f.hidden).map(f => {
            const className = [inputClass, f.mono ? inputMono : ''].filter(Boolean).join(' ');
            const colSpan = f.fullWidth || f.type === 'textarea' ? 'col-span-2' : '';

            return (
              <FormField key={f.key} className={colSpan}>
                <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
                  {f.label}
                  {f.required && <span className="text-red-400 ml-1">*</span>}
                </Label>

                {(() => {
                  const strValue = typeof values[f.key] === 'string' ? values[f.key] as string : '';
                  const arrValue = Array.isArray(values[f.key]) ? values[f.key] as string[] : [];
                  if (f.source) {
                    return (
                      <SupabaseSelectField
                        source={f.source}
                        value={strValue}
                        mono={f.mono}
                        placeholder={f.placeholder}
                        allowFreeText={f.allowFreeText}
                        onPick={(v, extras) => {
                          setValues(prev => ({ ...prev, [f.key]: v, ...extras }));
                        }}
                      />
                    );
                  }
                  if (f.type === 'select') {
                    return (
                      <div className="flex flex-wrap gap-1.5">
                        {(f.options ?? []).map(opt => {
                          const value = typeof opt === 'string' ? opt : opt.value;
                          const label = typeof opt === 'string' ? opt : opt.label;
                          return (
                            <button
                              key={value}
                              type="button"
                              onClick={() => set(f.key, value)}
                              className={
                                strValue === value
                                  ? 'px-2.5 py-1 rounded-md text-[11px] font-medium bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                                  : 'px-2.5 py-1 rounded-md text-[11px] text-slate-400 border border-[#1f1f1f] hover:text-slate-200 hover:border-[#2a2a2a]'
                              }
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    );
                  }
                  if (f.type === 'multiselect') {
                    return (
                      <div className="flex flex-wrap gap-1.5">
                        {(f.options ?? []).map(opt => {
                          const value = typeof opt === 'string' ? opt : opt.value;
                          const label = typeof opt === 'string' ? opt : opt.label;
                          const checked = arrValue.includes(value);
                          return (
                            <button
                              key={value}
                              type="button"
                              onClick={() => {
                                const next = checked ? arrValue.filter(v => v !== value) : [...arrValue, value];
                                set(f.key, next);
                              }}
                              className={
                                checked
                                  ? 'px-2.5 py-1 rounded-md text-[11px] font-medium bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                                  : 'px-2.5 py-1 rounded-md text-[11px] text-slate-400 border border-[#1f1f1f] hover:text-slate-200 hover:border-[#2a2a2a]'
                              }
                            >
                              {label}
                            </button>
                          );
                        })}
                        {(f.options ?? []).length === 0 && (
                          <span className="text-[11px] text-slate-600 italic">No options available.</span>
                        )}
                      </div>
                    );
                  }
                  if (f.type === 'textarea') {
                    return (
                      <textarea
                        value={strValue}
                        onChange={e => set(f.key, e.target.value)}
                        placeholder={f.placeholder}
                        rows={3}
                        className="bg-[#111111] border border-[#1f1f1f] rounded-md px-2 py-1.5 text-[12.5px] text-slate-200 placeholder:text-slate-600 resize-y"
                      />
                    );
                  }
                  return (
                    <Input
                      type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'}
                      value={strValue}
                      onChange={e => set(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      min={f.min}
                      max={f.max}
                      step={f.step}
                      className={className}
                    />
                  );
                })()}
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
