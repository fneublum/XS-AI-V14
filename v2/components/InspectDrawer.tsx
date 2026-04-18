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
    const seed: Record<string, string> = {};
    if (!row) return seed;
    for (const f of fields) {
      const v = row[f.key];
      seed[f.key] = v === null || v === undefined ? '' : String(v);
    }
    return seed;
  }, [row, fields]);

  const [values, setValues] = useState<Record<string, string>>(initial);
  useEffect(() => { setValues(initial); }, [initial]);

  const set = (k: string, v: string) => setValues(prev => ({ ...prev, [k]: v }));

  const dirty = Object.keys(values).some(k => values[k] !== (initial[k] ?? ''));

  const save = () => {
    if (!rowId) return;
    const patch: Record<string, unknown> = { id: rowId };
    for (const f of fields) {
      const raw = values[f.key]?.trim() ?? '';
      if (raw === '') {
        patch[f.key] = null;
      } else if (f.type === 'number') {
        const n = Number(raw);
        patch[f.key] = Number.isFinite(n) ? n : null;
      } else {
        patch[f.key] = raw;
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
              {fields.map(f => {
                const colSpan = f.fullWidth || f.type === 'textarea' ? 'col-span-2' : '';
                return (
                  <FormField key={f.key} className={colSpan}>
                    <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
                      {f.label}
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
                        rows={3}
                        className="bg-[#111111] border border-[#1f1f1f] rounded-md px-2 py-1.5 text-[12.5px] text-slate-200 resize-y"
                      />
                    ) : (
                      <Input
                        type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'}
                        value={values[f.key] ?? ''}
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
              {fields.map(f => (
                <React.Fragment key={f.key}>
                  <dt className="text-[11px] text-slate-500 uppercase tracking-wider py-1.5">
                    {f.label}
                  </dt>
                  <dd className={
                    (f.mono ? 'font-mono tabular-nums ' : '') +
                    'py-1.5 text-slate-200 break-words'
                  }>
                    {fmtValue(row[f.key])}
                  </dd>
                </React.Fragment>
              ))}
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
