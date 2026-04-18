// Phase 3B — AI upload modal for Freight Quotes.
//
// Flow:
//   1. User drops / picks / pastes a PDF, image, or raw text.
//   2. Gemini (via gemini-proxy) extracts freight-quote fields.
//   3. User reviews/edits the fields.
//   4. Save → INSERT into freight_quotes (snake_case columns).
//
// Paste is the trick: we attach a `paste` listener to the modal content
// so a screenshot from the clipboard OR a block of pasted text both
// land in the same pipeline as a dropped file.

import React, { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Sparkles, Upload, Clipboard, FileText, Loader2, AlertCircle,
  X as XIcon, Check, RotateCcw,
} from 'lucide-react';
import { Input, FormField, Label, Button, Badge } from '../primitives';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import { useEntityInsert } from '../queries/useEntityMutations';
import {
  useGeminiExtractFreightQuote,
  ExtractedFreightQuote,
  FreightQuoteInput,
} from '../queries/useGeminiExtractFreightQuote';
import { SupabaseSelectField } from './SupabaseSelectField';
import { cn } from '../primitives/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Draft = {
  agentName: string;
  carrier: string;
  freightType: string;
  originPort: string;
  originPortCode: string;
  destinationPort: string;
  destinationPortCode: string;
  rate: string;
  currency: string;
  freeTime: string;
  transitTime: string;
  validUntil: string;
  status: string;
  notes: string;
};

const emptyDraft = (): Draft => ({
  agentName: '', carrier: '', freightType: '',
  originPort: '', originPortCode: '',
  destinationPort: '', destinationPortCode: '',
  rate: '', currency: 'USD', freeTime: '', transitTime: '',
  validUntil: '', status: 'ACTIVE', notes: '',
});

const fromExtracted = (e: ExtractedFreightQuote): Draft => ({
  agentName:           e.agentName           ?? '',
  carrier:             e.carrier             ?? '',
  freightType:         e.freightType         ?? '',
  originPort:          e.originPort          ?? '',
  originPortCode:      e.originPortCode      ?? '',
  destinationPort:     e.destinationPort     ?? '',
  destinationPortCode: e.destinationPortCode ?? '',
  rate:                e.rate != null ? String(e.rate) : '',
  currency:            e.currency            ?? 'USD',
  freeTime:            e.freeTime    != null ? String(e.freeTime)    : '',
  transitTime:         e.transitTime != null ? String(e.transitTime) : '',
  validUntil:          e.validUntil          ?? '',
  status:              e.status              ?? 'ACTIVE',
  notes:               e.notes               ?? '',
});

export const FreightQuoteAiUploadModal: React.FC<Props> = ({ open, onOpenChange }) => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const extract = useGeminiExtractFreightQuote();
  const insert = useEntityInsert<Record<string, unknown>>({
    table: 'freight_quotes',
    listQueryKeys: ['freightQuotes', 'logisticsDocs'],
    idPrefix: 'FQ',
    withCreatedAt: false, // freight_quotes uses `date_added`, not `createdAt`
  });

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pastePadRef  = useRef<HTMLTextAreaElement>(null);

  // Reset on close. Guard with a ref so mount-time (open=false) is a
  // no-op and we only reset on the actual true→false transition.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    setDraft(emptyDraft());
    setSourceLabel(null);
    extract.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const run = (input: FreightQuoteInput, label: string) => {
    setSourceLabel(label);
    setDraft(emptyDraft());
    extract.mutate(input, {
      onSuccess: (doc) => {
        setDraft(fromExtracted(doc));
        toast.push({
          kind: 'success',
          title: 'Freight quote extracted',
          description: [doc.agentName, doc.originPortCode, doc.destinationPortCode]
            .filter(Boolean)
            .join(' · ') || 'Review the fields and Save.',
        });
      },
      onError: (err) => {
        toast.push({
          kind: 'error',
          title: 'Extraction failed',
          description: err.message,
        });
      },
    });
  };

  const onFilePicked = (f: File) => {
    run({ kind: 'file', file: f }, `${f.name} · ${(f.size / 1024).toFixed(0)} KB`);
  };

  const onDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) onFilePicked(f);
  };

  // Paste handler: catches screenshots (image/* on clipboard) or
  // raw text pastes when the user drops text into the textarea.
  const onPaste: React.ClipboardEventHandler<HTMLDivElement> = (e) => {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find(i => i.type.startsWith('image/'));
    if (imageItem) {
      const f = imageItem.getAsFile();
      if (f) {
        e.preventDefault();
        onFilePicked(f);
        return;
      }
    }
    // No image — if the user pasted into the textarea we let the
    // default behavior populate it and run extract on "Analyze text".
  };

  const runPastedText = () => {
    const text = pastePadRef.current?.value.trim() ?? '';
    if (!text) {
      toast.push({ kind: 'warning', title: 'Nothing to analyze', description: 'Paste a quote first.' });
      return;
    }
    run({ kind: 'text', text }, `Pasted text · ${text.length} chars`);
  };

  const setField = <K extends keyof Draft>(k: K, v: string) =>
    setDraft(prev => ({ ...prev, [k]: v }));

  const save = () => {
    if (!draft.agentName.trim()) {
      toast.push({ kind: 'error', title: 'Agent required', description: 'Pick an agent before saving.' });
      return;
    }
    const payload: Record<string, unknown> = {
      agent_name:            draft.agentName.trim() || null,
      carrier:               draft.carrier.trim() || null,
      freight_type:          draft.freightType.trim() || null,
      origin_port:           draft.originPort.trim() || null,
      origin_port_code:      draft.originPortCode.trim().toUpperCase() || null,
      destination_port:      draft.destinationPort.trim() || null,
      destination_port_code: draft.destinationPortCode.trim().toUpperCase() || null,
      rate:                  draft.rate.trim() === '' ? null : Number(draft.rate),
      currency:              draft.currency.trim().toUpperCase() || 'USD',
      free_time:             draft.freeTime.trim()    === '' ? null : Number(draft.freeTime),
      transit_time:          draft.transitTime.trim() === '' ? null : Number(draft.transitTime),
      valid_until:           draft.validUntil.trim() || null,
      status:                draft.status.trim().toUpperCase() || 'ACTIVE',
      observation:           draft.notes.trim() || null,
      date_added:            new Date().toISOString().slice(0, 10),
    };
    if (currentCompanyId && currentCompanyId !== 'ALL') {
      payload.company_id = currentCompanyId;
    }

    insert.mutate(payload, {
      onSuccess: () => {
        toast.push({
          kind: 'success',
          title: 'Freight quote saved',
          description: `${draft.agentName} · ${draft.originPortCode || draft.originPort} → ${draft.destinationPortCode || draft.destinationPort}`,
        });
        onOpenChange(false);
      },
      onError: (err) => toast.push({
        kind: 'error',
        title: 'Save failed',
        description: err.message,
      }),
    });
  };

  const stage: 'empty' | 'working' | 'ready' | 'error' =
    extract.isPending ? 'working' :
    extract.error ? 'error' :
    extract.isSuccess ? 'ready' : 'empty';

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content
          onPaste={onPaste}
          className="fixed left-1/2 top-[5%] -translate-x-1/2 z-50 w-[min(96vw,860px)] rounded-md border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_16px_48px_rgba(0,0,0,0.6)] flex flex-col max-h-[90vh]"
        >
          <div className="px-5 py-4 border-b border-[#1f1f1f] flex items-start gap-3">
            <div className="p-1.5 rounded-md bg-indigo-600/10 text-indigo-300">
              <Sparkles size={14} />
            </div>
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-[14px] font-semibold text-slate-100">
                AI upload — freight quote
              </Dialog.Title>
              <Dialog.Description className="text-[12px] text-slate-500 mt-0.5">
                Drop a PDF/image, pick a file, or paste a screenshot / text.
                Gemini extracts fields; you review &amp; save.
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="text-slate-500 hover:text-slate-100 transition-colors p-1 -m-1"
            >
              <XIcon size={14} />
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Drop zone */}
            <div
              onDragEnter={e => { e.preventDefault(); setDragOver(true); }}
              onDragOver={e => e.preventDefault()}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={cn(
                'rounded-md border-2 border-dashed text-center py-6 px-5 transition-colors cursor-pointer',
                dragOver
                  ? 'border-indigo-400 bg-gradient-to-br from-indigo-500/20 to-purple-500/15'
                  : stage === 'ready'
                    ? 'border-emerald-500/40 bg-emerald-500/5'
                    : stage === 'error'
                      ? 'border-red-500/40 bg-red-500/5'
                      : 'border-indigo-500/40 bg-gradient-to-br from-indigo-500/10 to-purple-500/5 hover:border-indigo-400/70',
              )}
              onClick={() => fileInputRef.current?.click()}
            >
              {stage === 'working' ? (
                <div className="flex items-center justify-center gap-2 text-[12.5px] text-indigo-200">
                  <Loader2 size={14} className="animate-spin" />
                  Extracting {sourceLabel ?? '…'}
                </div>
              ) : stage === 'error' ? (
                <div className="space-y-1">
                  <div className="text-[13px] font-medium text-red-200 flex items-center justify-center gap-2">
                    <AlertCircle size={13} /> Extraction failed
                  </div>
                  <div className="text-[11.5px] text-red-200/80">
                    {extract.error?.message}
                  </div>
                </div>
              ) : stage === 'ready' ? (
                <div className="space-y-1">
                  <div className="text-[13px] font-medium text-emerald-200 flex items-center justify-center gap-2">
                    <Check size={13} /> Extracted — review below
                  </div>
                  <div className="text-[11.5px] text-emerald-200/80">
                    {sourceLabel}
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-center gap-2 text-[13.5px] font-medium text-slate-100 mb-1">
                    <Upload size={14} className="text-indigo-300" />
                    Drop file, click to browse, or paste screenshot
                  </div>
                  <div className="text-[11.5px] text-slate-500">
                    PDF · PNG · JPG — or just ⌘V a screenshot from your clipboard
                  </div>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) onFilePicked(f);
                  e.target.value = '';
                }}
              />
            </div>

            {/* Paste text fallback — small accordion */}
            <details className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] px-3 py-2">
              <summary className="text-[12px] text-slate-400 cursor-pointer list-none flex items-center gap-2">
                <Clipboard size={12} /> Or paste the quote as text
              </summary>
              <div className="mt-2 space-y-2">
                <textarea
                  ref={pastePadRef}
                  rows={4}
                  placeholder="Paste an email body or the text of a quote…"
                  className="w-full bg-[#111111] border border-[#1f1f1f] rounded-md px-2 py-1.5 text-[12.5px] text-slate-200 resize-y"
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={runPastedText}
                    disabled={extract.isPending}
                    className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md"
                  >
                    Analyze text
                  </Button>
                  <span className="text-[11px] text-slate-500">
                    Uses the same Gemini extraction as the drop zone.
                  </span>
                </div>
              </div>
            </details>

            {/* Review form — shown once we have something */}
            {(stage === 'ready' || stage === 'empty') && (
              <div className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium flex items-center gap-2">
                    <FileText size={12} /> Review &amp; edit
                    {stage === 'ready' && <Badge variant="info">AI draft</Badge>}
                  </div>
                  {stage === 'ready' && (
                    <button
                      type="button"
                      onClick={() => { setDraft(emptyDraft()); extract.reset(); setSourceLabel(null); }}
                      className="text-[11px] text-slate-500 hover:text-slate-200 flex items-center gap-1"
                    >
                      <RotateCcw size={11} /> Clear
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <FormField className="col-span-2">
                    <FieldLabel>Agent *</FieldLabel>
                    <SupabaseSelectField
                      source={{
                        table: 'cargo_agents',
                        valueColumn: 'name',
                        labelColumn: 'name',
                        secondaryColumn: 'country',
                        scopeByCompany: true,
                      }}
                      value={draft.agentName}
                      onPick={(v) => setField('agentName', v)}
                    />
                  </FormField>

                  <FormField>
                    <FieldLabel>Carrier</FieldLabel>
                    <SupabaseSelectField
                      source={{
                        table: 'carriers',
                        valueColumn: 'name',
                        labelColumn: 'name',
                        secondaryColumn: 'scac',
                        scopeByCompany: true,
                      }}
                      value={draft.carrier}
                      onPick={(v) => setField('carrier', v)}
                    />
                  </FormField>

                  <FormField>
                    <FieldLabel>Type</FieldLabel>
                    <div className="flex flex-wrap gap-1.5">
                      {(['OCEAN', 'AIR', 'TRUCK', 'RAIL'] as const).map(opt => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setField('freightType', opt)}
                          className={
                            draft.freightType === opt
                              ? 'px-2.5 py-1 rounded-md text-[11px] font-medium bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                              : 'px-2.5 py-1 rounded-md text-[11px] text-slate-400 border border-[#1f1f1f] hover:text-slate-200 hover:border-[#2a2a2a]'
                          }
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </FormField>

                  <FormField>
                    <FieldLabel>POA (origin port)</FieldLabel>
                    <SupabaseSelectField
                      source={{
                        table: 'ports',
                        valueColumn: 'code',
                        labelColumn: 'name',
                        secondaryColumn: 'country',
                        writeAlso: [{ sourceColumn: 'name', targetKey: 'originPort' }],
                      }}
                      value={draft.originPortCode}
                      mono
                      onPick={(v, extras) => {
                        setDraft(prev => ({
                          ...prev,
                          originPortCode: v,
                          originPort: extras.originPort ?? prev.originPort,
                        }));
                      }}
                    />
                  </FormField>

                  <FormField>
                    <FieldLabel>POD (destination port)</FieldLabel>
                    <SupabaseSelectField
                      source={{
                        table: 'ports',
                        valueColumn: 'code',
                        labelColumn: 'name',
                        secondaryColumn: 'country',
                        writeAlso: [{ sourceColumn: 'name', targetKey: 'destinationPort' }],
                      }}
                      value={draft.destinationPortCode}
                      mono
                      onPick={(v, extras) => {
                        setDraft(prev => ({
                          ...prev,
                          destinationPortCode: v,
                          destinationPort: extras.destinationPort ?? prev.destinationPort,
                        }));
                      }}
                    />
                  </FormField>

                  <FormField>
                    <FieldLabel>Origin port (name)</FieldLabel>
                    <Input
                      value={draft.originPort}
                      onChange={e => setField('originPort', e.target.value)}
                      className={inputClass}
                    />
                  </FormField>

                  <FormField>
                    <FieldLabel>Destination port (name)</FieldLabel>
                    <Input
                      value={draft.destinationPort}
                      onChange={e => setField('destinationPort', e.target.value)}
                      className={inputClass}
                    />
                  </FormField>

                  <FormField>
                    <FieldLabel>Rate</FieldLabel>
                    <Input
                      type="number"
                      value={draft.rate}
                      onChange={e => setField('rate', e.target.value)}
                      className={inputClass + ' font-mono tabular-nums'}
                    />
                  </FormField>

                  <FormField>
                    <FieldLabel>Currency</FieldLabel>
                    <Input
                      value={draft.currency}
                      onChange={e => setField('currency', e.target.value.toUpperCase())}
                      className={inputClass + ' font-mono'}
                    />
                  </FormField>

                  <FormField>
                    <FieldLabel>Free time (days)</FieldLabel>
                    <Input
                      type="number"
                      value={draft.freeTime}
                      onChange={e => setField('freeTime', e.target.value)}
                      className={inputClass + ' font-mono tabular-nums'}
                    />
                  </FormField>

                  <FormField>
                    <FieldLabel>Transit (days)</FieldLabel>
                    <Input
                      type="number"
                      value={draft.transitTime}
                      onChange={e => setField('transitTime', e.target.value)}
                      className={inputClass + ' font-mono tabular-nums'}
                    />
                  </FormField>

                  <FormField>
                    <FieldLabel>Valid until</FieldLabel>
                    <Input
                      type="date"
                      value={draft.validUntil}
                      onChange={e => setField('validUntil', e.target.value)}
                      className={inputClass}
                    />
                  </FormField>

                  <FormField>
                    <FieldLabel>Status</FieldLabel>
                    <div className="flex flex-wrap gap-1.5">
                      {(['ACTIVE', 'PENDING', 'ACCEPTED', 'EXPIRED', 'REJECTED'] as const).map(opt => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setField('status', opt)}
                          className={
                            draft.status === opt
                              ? 'px-2.5 py-1 rounded-md text-[11px] font-medium bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                              : 'px-2.5 py-1 rounded-md text-[11px] text-slate-400 border border-[#1f1f1f] hover:text-slate-200 hover:border-[#2a2a2a]'
                          }
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </FormField>

                  <FormField className="col-span-2">
                    <FieldLabel>Notes</FieldLabel>
                    <textarea
                      value={draft.notes}
                      onChange={e => setField('notes', e.target.value)}
                      rows={2}
                      className="w-full bg-[#111111] border border-[#1f1f1f] rounded-md px-2 py-1.5 text-[12.5px] text-slate-200 resize-y"
                    />
                  </FormField>
                </div>
              </div>
            )}
          </div>

          <div className="px-5 py-3 border-t border-[#1f1f1f] flex items-center gap-2 justify-end">
            <Dialog.Close className="px-3 py-1.5 text-[12px] text-slate-400 hover:text-slate-100 rounded-md hover:bg-[#141414] transition-colors">
              Cancel
            </Dialog.Close>
            <Button
              size="sm"
              onClick={save}
              disabled={insert.isPending || (stage !== 'ready' && !draft.agentName)}
              loading={insert.isPending}
              className={cn(
                'bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40',
                'h-7 px-3 text-[12px] font-medium rounded-md',
              )}
            >
              {insert.isPending ? 'Saving…' : 'Save freight quote'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

const inputClass =
  'h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200';

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
    {children}
  </Label>
);
