// Batch AI upload for commission customer invoices on Agent Sales
// Orders. Supports three flows the user described:
//   1. Single invoice in one PDF — drop one file, get one row to review.
//   2. Multiple invoices in one PDF — drop one file, Gemini emits an
//      array, all extracted invoices land in the review queue.
//   3. Multiple PDFs (each with one invoice) — drop several files at
//      once, each is extracted in parallel, all results flatten into
//      one queue.
//
// One queue, one Save-All. Each invoice writes its own pair of rows:
//   commission_sales_orders + commission_customer_invoices.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  X as XIcon, Sparkles, Upload, Loader2, CheckCircle2, AlertCircle,
  Trash2, FileText, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { Button } from '../primitives/Button';
import { Input } from '../primitives/Input';
import { useToast } from '../primitives/Toast';
import { useQueryClient } from '@tanstack/react-query';
import { getSupabaseClient } from '../../services/supabase';
import { useCompany } from '../providers/CompanyProvider';
import { SupabaseSelectField } from './SupabaseSelectField';
import {
  CUSTOMER_INV_MULTI_PROMPT,
  normalizeMultipleInvoices,
  type CustomerInvoiceDraft,
} from '../lib/agentInvoiceSpec';
import { GoogleGenAI } from '../../services/geminiClient';

// Reusing the same picker pattern from NewProposalButton in
// AgentSalesOrdersV2: a tiny <select> for the closed Incoterm list.
const INCOTERMS = ['EXW','FCA','FAS','FOB','CFR','CIF','CPT','CIP','DAP','DPU','DDP'] as const;
const StaticSelect: React.FC<{
  value: string; options: readonly string[]; onChange: (v: string) => void;
  placeholder?: string; mono?: boolean;
}> = ({ value, options, onChange, placeholder, mono }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)}
    className={
      'w-full h-7 text-[12px] bg-[#0f0f0f] border border-[#1f1f1f] text-slate-200 rounded px-2 outline-none focus-visible:border-indigo-500 ' +
      (mono ? 'font-mono' : '')
    }>
    <option value="">{placeholder ?? '—'}</option>
    {options.map(o => <option key={o} value={o}>{o}</option>)}
  </select>
);

const CONCURRENCY = 3;
const GEMINI_MODEL = 'gemini-2.5-flash';

type FileStatus = 'queued' | 'extracting' | 'extracted' | 'failed';

interface FileRow {
  id: string;
  file: File;
  status: FileStatus;
  error: string | null;
  invoiceCount: number;
}

interface QueueEntry {
  id: string;
  fileId: string;
  fileName: string;
  draft: CustomerInvoiceDraft;
  saved: boolean;
  saveError: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const newId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });

const fileToInlinePart = async (file: File): Promise<Record<string, unknown>> => {
  const dataUrl = await readFileAsDataUrl(file);
  const base64 = dataUrl.split(',')[1] ?? '';
  return {
    inlineData: {
      mimeType: file.type || 'application/pdf',
      data: base64,
    },
  };
};

async function extractInvoicesFromFile(file: File): Promise<CustomerInvoiceDraft[]> {
  const ai = new GoogleGenAI({ apiKey: 'proxy' });
  const parts: Array<Record<string, unknown>> = [
    { text: CUSTOMER_INV_MULTI_PROMPT },
    await fileToInlinePart(file),
  ];
  const result = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: 'user', parts }],
    config: { responseMimeType: 'application/json', temperature: 0 },
  });
  const text = (result as { text?: string }).text ?? '';
  if (!text) throw new Error('Empty response from Gemini.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const stripped = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '');
    parsed = JSON.parse(stripped);
  }
  const drafts = normalizeMultipleInvoices(parsed);
  // Stash the data URL on each draft so the saved row keeps the source.
  const dataUrl = await readFileAsDataUrl(file);
  return drafts.map(d => ({ ...d, originalDocument: dataUrl }));
}

const StatusBadge: React.FC<{ status: FileStatus }> = ({ status }) => {
  const map: Record<FileStatus, { label: string; cls: string; icon?: React.ReactNode }> = {
    queued:     { label: 'Queued',     cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
    extracting: { label: 'Extracting', cls: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30', icon: <Loader2 size={10} className="animate-spin" /> },
    extracted:  { label: 'Extracted',  cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30', icon: <CheckCircle2 size={10} /> },
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

const inputCls = 'h-7 text-[12px] bg-[#0f0f0f] border-[#1f1f1f] text-slate-200';

export const InvoiceBatchUploadModal: React.FC<Props> = ({ open, onOpenChange }) => {
  const toast = useToast();
  const qc = useQueryClient();
  const { currentCompanyId } = useCompany();
  const companyId = currentCompanyId === 'ALL' ? null : currentCompanyId;

  const [files, setFiles] = useState<FileRow[]>([]);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset all state when the modal closes — keep the dropzone fresh.
  useEffect(() => {
    if (!open) {
      setFiles([]);
      setQueue([]);
      setActiveIdx(0);
      setSaving(false);
    }
  }, [open]);

  const addFiles = useCallback((picked: File[]) => {
    if (picked.length === 0) return;
    const rows: FileRow[] = picked.map(file => ({
      id: newId('inv-file'),
      file,
      status: 'queued',
      error: null,
      invoiceCount: 0,
    }));
    setFiles(prev => [...prev, ...rows]);

    // Run extractions with a small concurrency limit.
    void (async () => {
      const queueIn: FileRow[] = [...rows];
      const workers: Promise<void>[] = [];
      for (let w = 0; w < CONCURRENCY; w++) {
        workers.push((async () => {
          while (queueIn.length > 0) {
            const row = queueIn.shift();
            if (!row) break;
            setFiles(prev => prev.map(r => r.id === row.id ? { ...r, status: 'extracting' } : r));
            try {
              const drafts = await extractInvoicesFromFile(row.file);
              const entries: QueueEntry[] = drafts.map(draft => ({
                id: newId('inv-entry'),
                fileId: row.id,
                fileName: row.file.name,
                draft,
                saved: false,
                saveError: null,
              }));
              setFiles(prev => prev.map(r => r.id === row.id ? { ...r, status: 'extracted', invoiceCount: entries.length } : r));
              setQueue(prev => [...prev, ...entries]);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              setFiles(prev => prev.map(r => r.id === row.id ? { ...r, status: 'failed', error: msg } : r));
            }
          }
        })());
      }
      await Promise.all(workers);
    })();
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles(prev => prev.filter(r => r.id !== id));
    setQueue(prev => prev.filter(q => q.fileId !== id));
    setActiveIdx(0);
  }, []);

  const removeQueueEntry = useCallback((entryId: string) => {
    setQueue(prev => prev.filter(q => q.id !== entryId));
    setActiveIdx(i => Math.max(0, i - 1));
  }, []);

  const updateDraft = useCallback((entryId: string, patch: Partial<CustomerInvoiceDraft>) => {
    setQueue(prev => prev.map(q => q.id === entryId ? { ...q, draft: { ...q.draft, ...patch } } : q));
  }, []);

  // ─── Save all extracted invoices to Supabase ──────────────────
  const saveAll = useCallback(async () => {
    if (queue.length === 0) return;
    setSaving(true);
    const supabase = getSupabaseClient();
    let okCount = 0;
    const updatedQueue: QueueEntry[] = [];
    for (const entry of queue) {
      if (entry.saved) { updatedQueue.push(entry); continue; }
      const d = entry.draft;
      // Light client-side validation; the UI also surfaces this so the
      // user can fix and retry without losing other entries.
      if (!d.invoiceNumber.trim() || !d.sellerName.trim() || !d.customerName.trim()) {
        updatedQueue.push({
          ...entry,
          saveError: 'invoiceNumber / sellerName / customerName are required.',
        });
        continue;
      }
      const totalQuantity = d.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
      const orderTotal    = d.items.reduce((s, it) => s + (Number(it.total) || 0), 0);
      const orderId   = newId('CSO');
      const invoiceId = newId('CCI');
      const now = new Date().toISOString();

      try {
        const { error: soErr } = await supabase.from('commission_sales_orders').insert({
          id: orderId,
          companyId,
          createdAt:   now,
          orderNumber: d.invoiceNumber,
          sellerName:  d.sellerName,
          customerName: d.customerName,
          incoterm:    d.incoterm || null,
          paymentTerms: d.paymentTerms || null,
          pol:         d.pol || null,
          pod:         d.pod || null,
          bookingNumber: d.bookingNumber || null,
          items:       d.items,
          totalQuantity,
          orderTotal,
          commissionRate:   0,
          commissionType:   'PERCENT',
          commissionAmount: 0,
          invoiceNumber: d.invoiceNumber,
          invoiceStatus: 'INVOICED',
          status: 'INVOICED',
        });
        if (soErr) throw new Error(soErr.message);
        const { error: invErr } = await supabase.from('commission_customer_invoices').insert({
          id: invoiceId,
          companyId,
          createdAt: now,
          invoiceNumber: d.invoiceNumber,
          invoiceDate:   d.invoiceDate || now.slice(0, 10),
          sellerName:    d.sellerName,
          customerName:  d.customerName,
          incoterm:      d.incoterm || null,
          paymentTerms:  d.paymentTerms || null,
          pol:           d.pol || null,
          pod:           d.pod || null,
          bookingNumber: d.bookingNumber || null,
          soNumber:      d.invoiceNumber,
          items:         d.items,
          totalAmount:   orderTotal,
          status:        'ISSUED',
        });
        if (invErr) throw new Error(invErr.message);
        okCount++;
        updatedQueue.push({ ...entry, saved: true, saveError: null });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        updatedQueue.push({ ...entry, saveError: msg });
      }
    }
    setQueue(updatedQueue);
    setSaving(false);
    void qc.invalidateQueries({ queryKey: ['agentSalesOrders'] });
    toast.push({
      kind: okCount === queue.length ? 'success' : 'warning',
      title: `Saved ${okCount}/${queue.length} invoices`,
      description: okCount === queue.length
        ? 'All extracted invoices created.'
        : 'Some entries failed — check the queue.',
    });
    if (okCount === queue.length) {
      onOpenChange(false);
    }
  }, [queue, companyId, qc, toast, onOpenChange]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files);
    addFiles(dropped);
  };

  const activeEntry: QueueEntry | undefined = queue[activeIdx];
  const totalExtracted = queue.length;
  const hasFailedFiles = files.some(r => r.status === 'failed');
  const allReady = totalExtracted > 0 && files.every(r => r.status === 'extracted' || r.status === 'failed');

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-[3%] -translate-x-1/2 z-[60] w-[min(96vw,1180px)] h-[92vh] rounded-md border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_16px_48px_rgba(0,0,0,0.6)] flex flex-col">
          {/* Header */}
          <div className="px-5 py-3 border-b border-[#1f1f1f] flex items-center gap-2">
            <Sparkles size={14} className="text-indigo-300 shrink-0" />
            <Dialog.Title className="text-[14px] font-semibold text-slate-100">
              OCR new invoice — batch
            </Dialog.Title>
            <span className="text-[11.5px] text-slate-500">
              · 1 PDF / 1 invoice · 1 PDF / N invoices · N PDFs together — all supported
            </span>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-[11px] text-slate-500">
                {files.length} files · {totalExtracted} invoices extracted
              </span>
              <Dialog.Close
                aria-label="Close"
                className="p-1 rounded-sm text-slate-500 hover:text-slate-100 hover:bg-[#161616]"
              >
                <XIcon size={14} />
              </Dialog.Close>
            </div>
          </div>

          <div className="flex-1 grid grid-cols-[320px_1fr] min-h-0">
            {/* Left pane: file list + dropzone */}
            <div className="border-r border-[#1f1f1f] flex flex-col min-h-0">
              <div
                onDragOver={e => e.preventDefault()}
                onDrop={onDrop}
                className="m-3 rounded-md border border-dashed border-[#1f1f1f] bg-[#0f0f0f] p-4 text-center"
              >
                <Upload size={16} className="mx-auto text-slate-500" />
                <p className="text-[12px] text-slate-300 mt-2">Drop PDFs here</p>
                <p className="text-[10.5px] text-slate-500 mt-0.5">One or many — each may contain one or more invoices.</p>
                <Button size="sm" className="mt-2 h-7 text-[11.5px]"
                  onClick={() => fileInputRef.current?.click()}>
                  Pick files
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  multiple
                  className="hidden"
                  onChange={e => {
                    const list = Array.from(e.target.files ?? []);
                    addFiles(list);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                />
              </div>

              <div className="px-3 pb-3 overflow-y-auto flex-1 space-y-1">
                {files.length === 0 && (
                  <p className="text-[11px] text-slate-600 italic px-1">No files yet.</p>
                )}
                {files.map(row => (
                  <div key={row.id} className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] p-2 text-[11.5px]">
                    <div className="flex items-center gap-1.5">
                      <FileText size={11} className="text-slate-400 shrink-0" />
                      <span className="truncate text-slate-200" title={row.file.name}>{row.file.name}</span>
                      <button
                        type="button"
                        onClick={() => removeFile(row.id)}
                        className="ml-auto p-0.5 text-slate-500 hover:text-red-400"
                        title="Remove file"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <StatusBadge status={row.status} />
                      {row.status === 'extracted' && (
                        <span className="text-[10px] text-slate-400">
                          {row.invoiceCount} invoice{row.invoiceCount === 1 ? '' : 's'}
                        </span>
                      )}
                      {row.status === 'failed' && row.error && (
                        <span className="text-[10px] text-red-400 truncate" title={row.error}>
                          {row.error}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right pane: review */}
            <div className="flex flex-col min-h-0">
              {totalExtracted === 0 ? (
                <div className="flex-1 flex items-center justify-center text-[12.5px] text-slate-500">
                  Drop one or more PDFs on the left. Extracted invoices show up here.
                </div>
              ) : !activeEntry ? null : (
                <>
                  {/* Queue navigation */}
                  <div className="px-5 py-2 border-b border-[#1f1f1f] flex items-center gap-2">
                    <Button size="sm" variant="secondary"
                      onClick={() => setActiveIdx(i => Math.max(0, i - 1))}
                      disabled={activeIdx === 0}
                      className="h-7 px-2 text-[11.5px] bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]">
                      <ChevronLeft size={12} />
                    </Button>
                    <span className="text-[12px] text-slate-300">
                      Invoice <span className="font-semibold">{activeIdx + 1}</span> of {totalExtracted}
                    </span>
                    <Button size="sm" variant="secondary"
                      onClick={() => setActiveIdx(i => Math.min(totalExtracted - 1, i + 1))}
                      disabled={activeIdx === totalExtracted - 1}
                      className="h-7 px-2 text-[11.5px] bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]">
                      <ChevronRight size={12} />
                    </Button>
                    <span className="text-[11px] text-slate-500 truncate" title={activeEntry.fileName}>
                      from {activeEntry.fileName}
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      {activeEntry.saved && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300">
                          <CheckCircle2 size={10} /> Saved
                        </span>
                      )}
                      {activeEntry.saveError && (
                        <span className="text-[10px] text-red-400 truncate max-w-[260px]"
                          title={activeEntry.saveError}>{activeEntry.saveError}</span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeQueueEntry(activeEntry.id)}
                        className="p-1 rounded-sm text-slate-500 hover:text-red-400 hover:bg-red-500/10"
                        title="Discard this invoice"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Review form */}
                  <div className="flex-1 overflow-y-auto px-5 py-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10.5px] text-slate-500 uppercase tracking-wider font-medium">Invoice #</label>
                        <Input value={activeEntry.draft.invoiceNumber}
                          onChange={e => updateDraft(activeEntry.id, { invoiceNumber: e.target.value })}
                          className={inputCls + ' font-mono'} />
                      </div>
                      <div>
                        <label className="text-[10.5px] text-slate-500 uppercase tracking-wider font-medium">Invoice date</label>
                        <Input type="date" value={activeEntry.draft.invoiceDate.slice(0, 10)}
                          onChange={e => updateDraft(activeEntry.id, { invoiceDate: e.target.value })}
                          className={inputCls} />
                      </div>
                      <div>
                        <label className="text-[10.5px] text-slate-500 uppercase tracking-wider font-medium">Seller</label>
                        <SupabaseSelectField
                          value={activeEntry.draft.sellerName}
                          onPick={v => updateDraft(activeEntry.id, { sellerName: v })}
                          placeholder="Pick supplier…"
                          allowFreeText showResolvedLabel
                          source={{
                            table: 'suppliers',
                            valueColumn: 'name',
                            labelColumn: 'name',
                            secondaryColumn: 'country',
                            scopeByCompany: true,
                          }}
                        />
                      </div>
                      <div>
                        <label className="text-[10.5px] text-slate-500 uppercase tracking-wider font-medium">Customer</label>
                        <SupabaseSelectField
                          value={activeEntry.draft.customerName}
                          onPick={v => updateDraft(activeEntry.id, { customerName: v })}
                          placeholder="Pick customer…"
                          allowFreeText showResolvedLabel
                          source={{
                            table: 'customers',
                            valueColumn: 'name',
                            labelColumn: 'name',
                            secondaryColumn: 'nickname',
                            scopeByCompany: true,
                          }}
                        />
                      </div>
                      <div>
                        <label className="text-[10.5px] text-slate-500 uppercase tracking-wider font-medium">Incoterm</label>
                        <StaticSelect
                          value={activeEntry.draft.incoterm}
                          options={INCOTERMS}
                          onChange={v => updateDraft(activeEntry.id, { incoterm: v })}
                          placeholder="Incoterm…"
                          mono
                        />
                      </div>
                      <div>
                        <label className="text-[10.5px] text-slate-500 uppercase tracking-wider font-medium">Payment terms</label>
                        <SupabaseSelectField
                          value={activeEntry.draft.paymentTerms}
                          onPick={v => updateDraft(activeEntry.id, { paymentTerms: v })}
                          placeholder="Pick terms…"
                          allowFreeText
                          source={{
                            table: 'payment_terms',
                            valueColumn: 'code',
                            labelColumn: 'description',
                            secondaryColumn: 'code',
                            scopeByCompany: true,
                          }}
                        />
                      </div>
                      <div>
                        <label className="text-[10.5px] text-slate-500 uppercase tracking-wider font-medium">POL</label>
                        <SupabaseSelectField
                          value={activeEntry.draft.pol}
                          onPick={v => updateDraft(activeEntry.id, { pol: v })}
                          placeholder="Pick port…"
                          allowFreeText mono
                          source={{
                            table: 'ports',
                            valueColumn: 'code',
                            labelColumn: 'name',
                            secondaryColumn: 'country',
                          }}
                        />
                      </div>
                      <div>
                        <label className="text-[10.5px] text-slate-500 uppercase tracking-wider font-medium">POD</label>
                        <SupabaseSelectField
                          value={activeEntry.draft.pod}
                          onPick={v => updateDraft(activeEntry.id, { pod: v })}
                          placeholder="Pick port…"
                          allowFreeText mono
                          source={{
                            table: 'ports',
                            valueColumn: 'code',
                            labelColumn: 'name',
                            secondaryColumn: 'country',
                          }}
                        />
                      </div>
                      <div>
                        <label className="text-[10.5px] text-slate-500 uppercase tracking-wider font-medium">Booking #</label>
                        <Input value={activeEntry.draft.bookingNumber}
                          onChange={e => updateDraft(activeEntry.id, { bookingNumber: e.target.value })}
                          className={inputCls + ' font-mono'} />
                      </div>
                      <div className="col-span-2 mt-1">
                        <label className="text-[10.5px] text-slate-500 uppercase tracking-wider font-medium">
                          Line items ({activeEntry.draft.items.length})
                        </label>
                        <div className="mt-1 rounded-md border border-[#1f1f1f] bg-[#0f0f0f] divide-y divide-[#1f1f1f] text-[11.5px]">
                          <div className="grid grid-cols-[1fr_90px_60px_90px_100px] gap-2 px-2 py-1 text-[10px] uppercase tracking-wider text-slate-500 font-medium">
                            <div>Description</div>
                            <div className="text-right">Qty</div>
                            <div className="text-right">Unit</div>
                            <div className="text-right">Unit price</div>
                            <div className="text-right">Total</div>
                          </div>
                          {activeEntry.draft.items.length === 0 && (
                            <div className="px-2 py-2 text-[11px] text-slate-500 italic">No line items extracted.</div>
                          )}
                          {activeEntry.draft.items.map((it, i) => (
                            <div key={i} className="grid grid-cols-[1fr_90px_60px_90px_100px] gap-2 px-2 py-1.5 items-center">
                              <span className="text-slate-200 truncate" title={it.description}>{it.description}</span>
                              <span className="text-right font-mono tabular-nums text-slate-300">{(it.quantity || 0).toLocaleString()}</span>
                              <span className="text-right text-slate-400 font-mono">{it.unit}</span>
                              <span className="text-right font-mono tabular-nums text-slate-300">${(it.unitPrice || 0).toFixed(2)}</span>
                              <span className="text-right font-mono tabular-nums text-emerald-300">${(it.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-[#1f1f1f] px-5 py-3 flex items-center gap-3 bg-[#0a0a0a]">
            <span className="text-[11.5px] text-slate-500">
              {totalExtracted > 0 && `${queue.filter(q => q.saved).length}/${totalExtracted} saved`}
              {hasFailedFiles && ' · some files failed to extract'}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={saving}
                className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]">
                Cancel
              </Button>
              <Button size="sm"
                onClick={saveAll}
                disabled={saving || !allReady || totalExtracted === 0 || queue.every(q => q.saved)}
                loading={saving}
                className="bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40">
                {saving ? 'Saving…' : `Save all (${queue.filter(q => !q.saved).length})`}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
