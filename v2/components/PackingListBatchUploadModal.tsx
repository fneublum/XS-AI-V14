// Batch AI upload for packing lists — V1-style "one PL, many files".
//
// V1's PL Engine accumulates containers from multiple uploaded files
// into a single packing list (one header, merged container list).
// This modal mirrors that: parallel extraction (concurrency=3) across
// every dropped file, a single shared header edited at the top, and
// all files' containers flattened into one merged sheet. Save writes
// ONE row to `packing_lists`.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  X as XIcon, Sparkles, Upload, Loader2, CheckCircle2, AlertCircle, Trash2, FileText,
} from 'lucide-react';
import { Button } from '../primitives/Button';
import { useToast } from '../primitives/Toast';
import { useGeminiExtractTyped } from '../queries/useGeminiExtractTyped';
import { useProducts } from '../queries/useProducts';
import {
  PLDraft, PLContainer, PL_PROMPT, normalizePLJson, packingListPayload,
  savePackingListPayload, emptyPLDraft,
} from '../routes/packingListShared';

const CONCURRENCY = 3;
const LB_TO_KG = 0.453592;

type FileStatus = 'queued' | 'extracting' | 'review' | 'failed';

interface FileRow {
  id: string;
  file: File;
  status: FileStatus;
  /** Per-file extracted draft — carries the containers this file
   *  contributed. Header fields from the first completed file seed
   *  the shared header below; later files only fill blanks. */
  draft: PLDraft | null;
  error: string | null;
}

type HeaderFields = Omit<PLDraft, 'containers'>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  insert: { mutateAsync: (p: Record<string, unknown>) => Promise<unknown> };
  currentCompanyId: string | null;
}

const newId = (): string => `pl-batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });

const StatusBadge: React.FC<{ status: FileStatus }> = ({ status }) => {
  const map: Record<FileStatus, { label: string; cls: string; icon?: React.ReactNode }> = {
    queued:     { label: 'Queued',     cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
    extracting: { label: 'Extracting', cls: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30', icon: <Loader2 size={10} className="animate-spin" /> },
    review:     { label: 'Ready',      cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30', icon: <CheckCircle2 size={10} /> },
    failed:     { label: 'Failed',     cls: 'bg-red-500/10 text-red-300 border-red-500/30', icon: <AlertCircle size={10} /> },
  };
  const entry = map[status];
  return (
    <span className={
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border text-[10px] font-medium shrink-0 ' + entry.cls
    }>
      {entry.icon}{entry.label}
    </span>
  );
};

const sheetInputCls =
  'w-full h-6 px-1.5 text-[11px] bg-transparent border border-transparent ' +
  'rounded-sm text-slate-200 ' +
  'hover:border-[#1f1f1f] focus:bg-[#111111] focus:border-indigo-500/40 focus:outline-none';
const sheetNumCls = sheetInputCls + ' font-mono tabular-nums text-right';
const sheetMonoCls = sheetInputCls + ' font-mono tabular-nums';

const headerInputCls =
  'w-full h-7 px-2 text-[12px] bg-[#111111] border border-[#1f1f1f] rounded-sm text-slate-200 ' +
  'hover:border-[#2a2a2a] focus:border-indigo-500/50 focus:outline-none';
const headerMonoCls = headerInputCls + ' font-mono';

const parseNumOrNull = (v: string): number | null => {
  const trimmed = v.replace(/,/g, '').trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
};
const numStr = (n: number | null | undefined): string => n == null ? '' : String(n);

const fmtWeight = (n: number | null): string =>
  n == null ? '' : Math.round(n).toLocaleString('en-US');
const fmtAmount = (n: number | null): string =>
  n == null ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Sheet cell for a number: shows comma-formatted value when blurred,
 *  raw digits when focused. Accepts an optional `kind` ("weight" = no
 *  decimals, "amount" = 2 decimals). */
const NumCell: React.FC<{
  value: number | null;
  onChange: (v: number | null) => void;
  kind?: 'weight' | 'amount' | 'count';
  className?: string;
  step?: number;
}> = ({ value, onChange, kind = 'amount', className = '', step }) => {
  const [focused, setFocused] = React.useState(false);
  const fmt = kind === 'amount' ? fmtAmount : fmtWeight;
  const display = focused ? numStr(value) : fmt(value);
  return (
    <input
      type={focused ? 'number' : 'text'}
      inputMode="decimal"
      step={step ?? (kind === 'amount' ? 0.01 : 1)}
      value={display}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={e => onChange(parseNumOrNull(e.target.value))}
      className={className}
    />
  );
};

/** Pull the shared header fields out of a PLDraft for seeding. */
const draftHeader = (d: PLDraft): HeaderFields => {
  const { containers: _ignored, ...rest } = d;
  return rest;
};

/** Merge an extracted file's header into the current shared header —
 *  fill only fields the user hasn't set yet. Never overwrite user
 *  edits. Returns the next header (referentially new if anything
 *  changed). */
const mergeHeader = (current: HeaderFields, incoming: HeaderFields): HeaderFields => {
  const next: HeaderFields = { ...current };
  let changed = false;
  (Object.keys(incoming) as Array<keyof HeaderFields>).forEach(k => {
    const cur = current[k];
    const inc = incoming[k];
    const isEmpty = cur == null || (typeof cur === 'string' && cur.trim() === '');
    const incHasValue = inc != null && (typeof inc !== 'string' || inc.trim() !== '');
    if (isEmpty && incHasValue) {
      (next as Record<string, unknown>)[k as string] = inc;
      changed = true;
    }
  });
  return changed ? next : current;
};

export const PackingListBatchUploadModal: React.FC<Props> = ({
  open, onOpenChange, insert, currentCompanyId,
}) => {
  const toast = useToast();
  const extract = useGeminiExtractTyped<PLDraft>({ prompt: PL_PROMPT, normalize: normalizePLJson });
  const products = useProducts();
  const productNames = (products.data ?? []).map(p => p.name).filter(Boolean);
  const [rows, setRows] = useState<FileRow[]>([]);
  const [header, setHeader] = useState<HeaderFields>(() => draftHeader(emptyPLDraft()));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setRows([]);
      setHeader(draftHeader(emptyPLDraft()));
      setSaving(false);
      setSaveError(null);
      setDragOver(false);
    }
  }, [open]);

  const patchRow = useCallback((id: string, patch: Partial<FileRow>) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }, []);

  const patchHeader = useCallback(<K extends keyof HeaderFields>(k: K, v: HeaderFields[K]) => {
    setHeader(prev => ({ ...prev, [k]: v }));
  }, []);

  const patchContainer = useCallback((rowId: string, cIdx: number, patch: Partial<PLContainer>) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId || !r.draft) return r;
      const next = r.draft.containers.map((c, i) => i === cIdx ? { ...c, ...patch } : c);
      return { ...r, draft: { ...r.draft, containers: next } };
    }));
  }, []);

  const runExtraction = useCallback(async (row: FileRow) => {
    patchRow(row.id, { status: 'extracting', error: null });
    try {
      const [draft, originalDocument] = await Promise.all([
        extract.mutateAsync({ kind: 'file', file: row.file }),
        readFileAsDataUrl(row.file),
      ]);
      const draftWithDoc: PLDraft = { ...draft, originalDocument };
      patchRow(row.id, { status: 'review', draft: draftWithDoc, error: null });
      // Seed / fill any empty header fields from this file. Never
      // overwrite fields the user already touched.
      setHeader(prev => mergeHeader(prev, draftHeader(draftWithDoc)));
    } catch (err) {
      patchRow(row.id, {
        status: 'failed',
        error: err instanceof Error ? err.message : 'Extraction failed',
      });
    }
  }, [extract, patchRow]);

  const processingRef = useRef(false);
  useEffect(() => {
    if (processingRef.current) return;
    const queued = rows.filter(r => r.status === 'queued');
    if (queued.length === 0) return;
    const extractingCount = rows.filter(r => r.status === 'extracting').length;
    const slots = CONCURRENCY - extractingCount;
    if (slots <= 0) return;
    processingRef.current = true;
    const toStart = queued.slice(0, slots);
    Promise.all(toStart.map(r => runExtraction(r))).finally(() => {
      processingRef.current = false;
    });
  }, [rows, runExtraction]);

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const next: FileRow[] = Array.from(list).map(file => ({
      id: newId(),
      file,
      status: 'queued',
      draft: null,
      error: null,
    }));
    setRows(prev => [...prev, ...next]);
  };

  const removeRow = (id: string) => setRows(prev => prev.filter(r => r.id !== id));

  // Flatten containers across all files into one merged sheet. Each
  // entry tracks `rowId` + `cIdx` so edits + deletions route back to
  // the source file's draft.
  type SheetEntry = {
    rowId: string;
    fileName: string;
    cIdx: number;
    container: PLContainer;
  };
  const sheet: SheetEntry[] = useMemo(() => {
    const out: SheetEntry[] = [];
    rows.forEach(r => {
      if (!r.draft) return;
      r.draft.containers.forEach((c, ci) => {
        out.push({ rowId: r.id, fileName: r.file.name, cIdx: ci, container: c });
      });
    });
    return out;
  }, [rows]);

  const totals = useMemo(() => sheet.reduce((acc, e) => ({
    grossLbs: acc.grossLbs + (e.container.grossLbs ?? 0),
    netLbs:   acc.netLbs   + (e.container.netLbs   ?? 0),
    grossKg:  acc.grossKg  + (e.container.grossKg  ?? 0),
    netKg:    acc.netKg    + (e.container.netKg    ?? 0),
    volumes:  acc.volumes  + (e.container.volumes  ?? 0),
  }), { grossLbs: 0, netLbs: 0, grossKg: 0, netKg: 0, volumes: 0 }), [sheet]);

  const save = async () => {
    if (!header.plNumber.trim()) {
      setSaveError('PL # is required');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      // Build the merged draft: shared header + every container from
      // every file, in the order the files were dropped. Attach the
      // first file's source PDF so the saved row has a viewable
      // original document (mirrors V1's primaryDoc behavior).
      const firstDoc = rows.find(r => r.draft?.originalDocument)?.draft?.originalDocument ?? '';
      const merged: PLDraft = {
        ...header,
        originalDocument: header.originalDocument || firstDoc,
        containers: rows.flatMap(r => r.draft?.containers ?? []),
      };
      await savePackingListPayload(insert, packingListPayload(merged, currentCompanyId));
      toast.push({
        kind: 'success',
        title: `Saved packing list with ${merged.containers.length} container${merged.containers.length === 1 ? '' : 's'}`,
      });
      onOpenChange(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const counts = useMemo(() => rows.reduce(
    (acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; },
    {} as Record<FileStatus, number>,
  ), [rows]);

  const busy = !!counts.extracting || saving;
  const canSave = !busy
    && header.plNumber.trim() !== ''
    && sheet.length > 0
    && (counts.review ?? 0) > 0;

  const onDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const reviewRows = rows.filter(r => r.status !== 'queued' || true);
  const showSheet = sheet.length > 0;
  const showHeader = rows.some(r => r.status === 'review' || r.status === 'extracting' || r.status === 'failed');

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !busy && onOpenChange(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-[3%] -translate-x-1/2 z-50 w-[min(98vw,1400px)] rounded-md border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_16px_48px_rgba(0,0,0,0.6)] flex flex-col max-h-[94vh]">
          <div className="px-5 py-4 border-b border-[#1f1f1f] flex items-start gap-3">
            <div className="p-1.5 rounded-md bg-indigo-600/10 text-indigo-300 shrink-0">
              <Sparkles size={14} />
            </div>
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-[14px] font-semibold text-slate-100">
                AI upload — packing list (batch)
              </Dialog.Title>
              <Dialog.Description className="text-[12px] text-slate-500 mt-0.5">
                Drop multiple PL files — containers from every file are merged into ONE packing list. Extraction runs up to {CONCURRENCY} at a time.
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="text-slate-500 hover:text-slate-100 transition-colors p-1 -m-1 disabled:opacity-40"
              disabled={busy}
            >
              <XIcon size={14} />
            </Dialog.Close>
          </div>

          <div className="px-5 py-4 overflow-y-auto space-y-4">
            <datalist id="pl-batch-product-names">
              {productNames.map(n => <option key={n} value={n} />)}
            </datalist>
            {/* Dropzone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={
                'rounded-md border-2 border-dashed transition-colors px-4 py-5 text-center cursor-pointer ' +
                (dragOver ? 'border-indigo-500/60 bg-indigo-500/5'
                          : 'border-[#1f1f1f] bg-[#0f0f0f] hover:border-[#2a2a2a]')
              }
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={18} className="mx-auto text-slate-500" />
              <div className="text-[12.5px] text-slate-300 mt-2">
                Drop PL files here, or <span className="text-indigo-300 underline">click to pick</span>
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">PDF, JPG, PNG · multiple files OK</div>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                multiple
                className="hidden"
                onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
              />
            </div>

            {/* Files list */}
            {reviewRows.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1.5">
                  Files ({reviewRows.length})
                </div>
                <div className="rounded-md border border-[#1f1f1f] overflow-hidden">
                  <table className="w-full text-[11.5px]">
                    <thead className="bg-[#0e0e0e] text-slate-500">
                      <tr>
                        <th className="text-left font-medium px-2 py-1.5 w-[110px]">Status</th>
                        <th className="text-left font-medium px-2 py-1.5">File</th>
                        <th className="text-right font-medium px-2 py-1.5 w-[120px]">Containers</th>
                        <th className="text-right font-medium px-2 py-1.5 w-[60px]">Remove</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1f1f1f]">
                      {reviewRows.map(r => (
                        <tr key={r.id} className="text-slate-300">
                          <td className="px-2 py-1.5">
                            <StatusBadge status={r.status} />
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <FileText size={11} className="text-indigo-300 shrink-0" />
                              <span className="font-mono text-slate-300 truncate" title={r.file.name}>
                                {r.file.name}
                              </span>
                              <span className="text-slate-600 text-[10px] shrink-0">
                                {Math.round(r.file.size / 1024)} KB
                              </span>
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-400">
                            {r.draft ? r.draft.containers.length : '—'}
                          </td>
                          <td className="px-1 py-1 text-right">
                            {r.status !== 'extracting' && (
                              <button
                                type="button"
                                onClick={() => removeRow(r.id)}
                                title="Remove file"
                                className="p-1 rounded-sm text-slate-500 hover:text-red-400 hover:bg-red-500/10"
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {reviewRows.some(r => r.status === 'failed' && r.error) && (
                  <div className="mt-1.5 space-y-0.5">
                    {reviewRows.filter(r => r.status === 'failed' && r.error).map(r => (
                      <div key={r.id} className="text-[11px] text-red-300/90">
                        <span className="font-mono">{r.file.name}</span>: {r.error}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Shared header — edited once, applies to the single saved PL */}
            {showHeader && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1.5">
                  Packing list header
                </div>
                <div className="rounded-md border border-[#1f1f1f] bg-[#0b0b0b] p-3 grid grid-cols-4 gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">PL # *</div>
                    <input value={header.plNumber}
                      onChange={e => patchHeader('plNumber', e.target.value)}
                      className={headerMonoCls} />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">SO #</div>
                    <input value={header.soNumber}
                      onChange={e => patchHeader('soNumber', e.target.value)}
                      className={headerMonoCls} />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Booking #</div>
                    <input value={header.bookingNumber}
                      onChange={e => patchHeader('bookingNumber', e.target.value)}
                      className={headerMonoCls} />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">B/L #</div>
                    <input value={header.blNumber}
                      onChange={e => patchHeader('blNumber', e.target.value)}
                      className={headerMonoCls} />
                  </div>
                  <div className="col-span-2">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Consignee</div>
                    <input value={header.consignee}
                      onChange={e => patchHeader('consignee', e.target.value)}
                      className={headerInputCls} />
                  </div>
                  <div className="col-span-2">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Shipper</div>
                    <input value={header.shipper}
                      onChange={e => patchHeader('shipper', e.target.value)}
                      className={headerInputCls} />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">PO #</div>
                    <input value={header.poNumber}
                      onChange={e => patchHeader('poNumber', e.target.value)}
                      className={headerMonoCls} />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Invoice #</div>
                    <input value={header.invoiceNumber}
                      onChange={e => patchHeader('invoiceNumber', e.target.value)}
                      className={headerMonoCls} />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Carrier</div>
                    <input value={header.carrier}
                      onChange={e => patchHeader('carrier', e.target.value)}
                      className={headerInputCls} />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Vessel / voyage</div>
                    <input value={header.vesselVoyage}
                      onChange={e => patchHeader('vesselVoyage', e.target.value)}
                      className={headerInputCls} />
                  </div>
                </div>
              </div>
            )}

            {/* Merged container sheet — every file's containers in one list */}
            {showSheet && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1.5">
                  Merged containers ({sheet.length})
                </div>
                <div className="rounded-md border border-[#1f1f1f] overflow-x-auto">
                  <table className="w-full text-[11px]" style={{ minWidth: 1280 }}>
                    <thead className="bg-[#0e0e0e] text-slate-500">
                      <tr>
                        <th className="text-left font-medium px-2 py-1.5 w-[120px]">Source file</th>
                        <th className="text-left font-medium px-2 py-1.5">Description</th>
                        <th className="text-left font-medium px-2 py-1.5 w-[140px]">Supplier</th>
                        <th className="text-right font-medium px-2 py-1.5 w-[90px]">Gross lbs</th>
                        <th className="text-right font-medium px-2 py-1.5 w-[90px]">Net lbs</th>
                        <th className="text-right font-medium px-2 py-1.5 w-[90px]">Gross kg</th>
                        <th className="text-right font-medium px-2 py-1.5 w-[90px]">Net kg</th>
                        <th className="text-left font-medium px-2 py-1.5 w-[130px]">Container #</th>
                        <th className="text-left font-medium px-2 py-1.5 w-[110px]">Seal #</th>
                        <th className="text-right font-medium px-2 py-1.5 w-[70px]">Volumes</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1f1f1f]">
                      {sheet.map(e => {
                        const c = e.container;
                        const set = (patch: Partial<PLContainer>) => patchContainer(e.rowId, e.cIdx, patch);
                        return (
                          <tr key={`${e.rowId}-${e.cIdx}`} className="text-slate-300 hover:bg-[#0f0f0f]">
                            <td className="px-2 py-1 text-slate-500 text-[10.5px] truncate max-w-[120px]" title={e.fileName}>
                              {e.fileName}
                            </td>
                            <td className="px-1 py-1">
                              <input value={c.description}
                                onChange={ev => set({ description: ev.target.value })}
                                list="pl-batch-product-names"
                                placeholder="Catalog or free text…"
                                className={sheetInputCls} />
                            </td>
                            <td className="px-1 py-1">
                              <input value={c.supplier}
                                onChange={ev => set({ supplier: ev.target.value })}
                                className={sheetInputCls} />
                            </td>
                            <td className="px-1 py-1">
                              <NumCell
                                value={c.grossLbs}
                                onChange={lbs => set({ grossLbs: lbs == null ? null : Math.round(lbs), grossKg: lbs == null ? null : Math.round(lbs * LB_TO_KG) })}
                                kind="weight"
                                className={sheetNumCls} />
                            </td>
                            <td className="px-1 py-1">
                              <NumCell
                                value={c.netLbs}
                                onChange={lbs => set({ netLbs: lbs == null ? null : Math.round(lbs), netKg: lbs == null ? null : Math.round(lbs * LB_TO_KG) })}
                                kind="weight"
                                className={sheetNumCls} />
                            </td>
                            <td className="px-1 py-1">
                              <NumCell
                                value={c.grossKg}
                                onChange={kg => set({ grossKg: kg == null ? null : Math.round(kg), grossLbs: kg == null ? null : Math.round(kg / LB_TO_KG) })}
                                kind="weight"
                                className={sheetNumCls} />
                            </td>
                            <td className="px-1 py-1">
                              <NumCell
                                value={c.netKg}
                                onChange={kg => set({ netKg: kg == null ? null : Math.round(kg), netLbs: kg == null ? null : Math.round(kg / LB_TO_KG) })}
                                kind="weight"
                                className={sheetNumCls} />
                            </td>
                            <td className="px-1 py-1">
                              <input value={c.containerNo}
                                onChange={ev => set({ containerNo: ev.target.value })}
                                className={sheetMonoCls} />
                            </td>
                            <td className="px-1 py-1">
                              <input value={c.sealNo}
                                onChange={ev => set({ sealNo: ev.target.value })}
                                className={sheetMonoCls} />
                            </td>
                            <td className="px-1 py-1">
                              <NumCell
                                value={c.volumes}
                                onChange={v => set({ volumes: v == null ? null : Math.round(v) })}
                                kind="count"
                                className={sheetNumCls} />
                            </td>
                            <td className="px-1 py-1 text-right">
                              <button
                                type="button"
                                onClick={() => setRows(prev => prev.map(r => {
                                  if (r.id !== e.rowId || !r.draft) return r;
                                  return {
                                    ...r,
                                    draft: {
                                      ...r.draft,
                                      containers: r.draft.containers.filter((_, i) => i !== e.cIdx),
                                    },
                                  };
                                }))}
                                title="Remove container"
                                className="p-1 rounded-sm text-slate-500 hover:text-red-400 hover:bg-red-500/10"
                              >
                                <Trash2 size={11} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-[#0e0e0e] text-slate-400 font-semibold">
                      <tr>
                        <td className="px-2 py-1.5" colSpan={3}>Totals</td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                          {fmtWeight(totals.grossLbs)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                          {fmtWeight(totals.netLbs)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                          {fmtWeight(totals.grossKg)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                          {fmtWeight(totals.netKg)}
                        </td>
                        <td className="px-2 py-1.5" colSpan={2} />
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                          {fmtWeight(totals.volumes)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {saveError && (
              <div className="text-[12px] text-red-300 bg-red-500/5 border border-red-500/20 rounded-md px-3 py-2">
                {saveError}
              </div>
            )}
          </div>

          <div className="border-t border-[#1f1f1f] px-5 py-3 flex items-center gap-3 bg-[#0a0a0a]">
            <div className="text-[11px] text-slate-500">
              {rows.length > 0 ? (
                <>
                  {rows.length} file{rows.length === 1 ? '' : 's'}
                  {counts.extracting ? ` · ${counts.extracting} extracting` : ''}
                  {counts.review ? ` · ${counts.review} ready` : ''}
                  {counts.failed ? ` · ${counts.failed} failed` : ''}
                  {sheet.length > 0 ? ` · ${sheet.length} container${sheet.length === 1 ? '' : 's'} merged` : ''}
                </>
              ) : 'No files yet'}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm" variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={busy}
                className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={save}
                disabled={!canSave}
                className="bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
              >
                {saving ? (
                  <span className="inline-flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Saving…</span>
                ) : sheet.length > 0
                  ? `Save packing list (${sheet.length})`
                  : 'Save packing list'}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
