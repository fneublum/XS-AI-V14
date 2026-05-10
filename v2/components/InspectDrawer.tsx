// Phase 3B — Generic read-only & editable field-dump drawer.
//
// Used by the row-level View icon on list pages that don't have a
// bespoke editor drawer. Renders an entity's fields as a definition
// list; in edit mode the same fields become inputs bound to
// `useEntityUpdate`.

import React, { useEffect, useMemo, useState } from 'react';
import {
  Drawer, Input, FormField, Label, Button, Badge,
} from '../primitives';
import { useToast } from '../primitives/Toast';
import { useEntityUpdate } from '../queries/useEntityMutations';
import { FieldDef } from './QuickCreateDrawer';
import { SupabaseSelectField } from './SupabaseSelectField';

export type InspectMode = 'view' | 'edit';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: InspectMode;
  onModeChange?: (m: InspectMode) => void;
  title: string;
  description?: string;
  table: string;
  listQueryKeys: string[];
  /** The row being inspected. Keys must match field definitions. */
  row: Record<string, unknown> | null;
  fields: FieldDef[];
}

const fmtValue = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return v.toLocaleString('en-US');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.length === 0 ? '—' : v.join(', ');
  return String(v);
};

const inputClass = 'h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200';

export const InspectDrawer: React.FC<Props> = ({
  open, onOpenChange, mode, onModeChange, title, description,
  table, listQueryKeys, row, fields,
}) => {
  const toast = useToast();
  const update = useEntityUpdate<{ id: string } & Record<string, unknown>>({
    table, listQueryKeys,
  });

  const rowId = (row && typeof row.id === 'string') ? row.id : null;

  const initial = useMemo(() => {
    const seed: Record<string, unknown> = {};
    if (!row) return seed;
    for (const f of fields) {
      const v = row[f.key];
      if (f.type === 'multiselect') {
        if (Array.isArray(v)) {
          seed[f.key] = v;
        } else if (f.serialize === 'csv' && typeof v === 'string' && v.length > 0) {
          // CSV-encoded scalar column (e.g. users.linked_entity_id storing
          // multiple cargo_agents.id). Split and trim; drop empty chunks.
          seed[f.key] = v.split(',').map(s => s.trim()).filter(Boolean);
        } else {
          seed[f.key] = [];
        }
      } else {
        seed[f.key] = v === null || v === undefined ? '' : String(v);
      }
    }
    return seed;
  }, [row, fields]);

  const [values, setValues] = useState<Record<string, unknown>>(initial);
  useEffect(() => { setValues(initial); }, [initial]);

  const set = (k: string, v: unknown) => setValues(prev => ({ ...prev, [k]: v }));

  // Deep-ish compare — arrays stringified, primitives compared directly.
  const sameVal = (a: unknown, b: unknown): boolean => {
    if (Array.isArray(a) || Array.isArray(b)) {
      return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
    }
    return a === b;
  };
  const dirty = Object.keys(values).some(k => !sameVal(values[k], initial[k]));

  const save = () => {
    if (!rowId) return;
    const patch: Record<string, unknown> = { id: rowId };
    for (const f of fields) {
      const col = f.dbKey ?? f.key;
      const raw = values[f.key];
      if (f.type === 'multiselect') {
        const arr = Array.isArray(raw) ? raw : [];
        if (f.serialize === 'csv') {
          patch[col] = arr.length === 0 ? null : arr.join(',');
        } else {
          patch[col] = arr;
        }
        continue;
      }
      const s = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
      if (s === '') {
        patch[col] = null;
      } else if (f.type === 'number') {
        const n = Number(s);
        patch[col] = Number.isFinite(n) ? n : null;
      } else {
        patch[col] = s;
      }
    }
    update.mutate(patch as never, {
      onSuccess: () => {
        toast.push({ kind: 'success', title: 'Saved', description: title });
        onOpenChange(false);
      },
      onError: (err) => toast.push({
        kind: 'error', title: 'Update failed', description: err.message,
      }),
    });
  };

  const isEdit = mode === 'edit';

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          {!isEdit && onModeChange ? (
            <Button
              size="sm" variant="secondary"
              onClick={() => onModeChange('edit')}
              className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
            >
              Edit
            </Button>
          ) : null}
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
        <div className="space-y-4">
          {isEdit ? (
            <div className="grid grid-cols-2 gap-3">
              {fields.filter(f => !f.hidden).map(f => {
                const colSpan = f.fullWidth || f.type === 'textarea' ? 'col-span-2' : '';
                return (
                  <FormField key={f.key} className={colSpan}>
                    <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
                      {f.label}
                    </Label>
                    {f.source ? (
                      <SupabaseSelectField
                        source={f.source}
                        value={(values[f.key] as string | undefined) ?? ''}
                        mono={f.mono}
                        placeholder={f.placeholder}
                        allowFreeText={f.allowFreeText}
                        onPick={(v, extras) => {
                          setValues(prev => ({ ...prev, [f.key]: v, ...extras }));
                        }}
                      />
                    ) : f.type === 'select' ? (
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
                                values[f.key] === value
                                  ? 'px-2.5 py-1 rounded-md text-[11px] font-medium bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                                  : 'px-2.5 py-1 rounded-md text-[11px] text-slate-400 border border-[#1f1f1f] hover:text-slate-200 hover:border-[#2a2a2a]'
                              }
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    ) : f.type === 'multiselect' ? (
                      <div className="flex flex-wrap gap-1.5">
                        {(f.options ?? []).map(opt => {
                          const value = typeof opt === 'string' ? opt : opt.value;
                          const label = typeof opt === 'string' ? opt : opt.label;
                          const current = Array.isArray(values[f.key]) ? values[f.key] as string[] : [];
                          const checked = current.includes(value);
                          return (
                            <button
                              key={value}
                              type="button"
                              onClick={() => {
                                const next = checked ? current.filter(v => v !== value) : [...current, value];
                                set(f.key, next as any);
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
                    ) : f.type === 'textarea' ? (
                      <textarea
                        value={(values[f.key] as string | undefined) ?? ''}
                        onChange={e => set(f.key, e.target.value)}
                        rows={3}
                        className="bg-[#111111] border border-[#1f1f1f] rounded-md px-2 py-1.5 text-[12.5px] text-slate-200 resize-y"
                      />
                    ) : (
                      <Input
                        type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'}
                        value={(values[f.key] as string | undefined) ?? ''}
                        onChange={e => set(f.key, e.target.value)}
                        min={f.min} max={f.max} step={f.step}
                        className={inputClass + (f.mono ? ' font-mono tabular-nums' : '')}
                      />
                    )}
                  </FormField>
                );
              })}
            </div>
          ) : (
            <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-[12.5px]">
              {fields.filter(f => !f.hidden).map(f => {
                // CSV-encoded multiselect: split before formatting so the
                // view renders "AGT1, AGT2" instead of the raw joined blob.
                let displayVal: unknown = row[f.key];
                if (f.type === 'multiselect' && f.serialize === 'csv' && typeof displayVal === 'string') {
                  displayVal = displayVal.length === 0
                    ? []
                    : displayVal.split(',').map(s => s.trim()).filter(Boolean);
                }
                return (
                  <React.Fragment key={f.key}>
                    <dt className="text-[11px] text-slate-500 uppercase tracking-wider py-1.5">
                      {f.label}
                    </dt>
                    <dd className={
                      (f.mono ? 'font-mono tabular-nums ' : '') +
                      'py-1.5 text-slate-200 break-words'
                    }>
                      {fmtValue(displayVal)}
                    </dd>
                  </React.Fragment>
                );
              })}
            </dl>
          )}

          <div className="pt-2 border-t border-[#1f1f1f] text-[11px] text-slate-500 flex items-center gap-2">
            <Badge variant="neutral">{table}</Badge>
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
