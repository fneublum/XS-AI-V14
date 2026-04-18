// Phase 3B — Reusable AI Upload modal.
//
// Drop-in replacement for the Freight-Quote-specific version. Any list
// page can wire an AI Upload button by passing:
//   • extractSpec   — Gemini prompt + normalizer (what to extract)
//   • emptyDraft    — blank draft shape
//   • renderReview  — review/edit UI bound to the draft
//   • save          — turn the draft into an insert
// The drop/paste/text mechanics are the same across all pages.

import React, { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Sparkles, Upload, Clipboard, FileText, Loader2, AlertCircle,
  X as XIcon, Check, RotateCcw, Send,
} from 'lucide-react';
import { Button, Badge } from '../primitives';
import { useToast } from '../primitives/Toast';
import {
  useGeminiExtractTyped, ExtractSpec, ExtractInput,
} from '../queries/useGeminiExtractTyped';
import { cn } from '../primitives/utils';

export interface AiUploadModalConfig<T> {
  /** Modal title shown in the header. */
  title: string;
  /** Secondary line beneath the title. */
  description: string;
  /** Blank draft factory. Called on open and on Clear. */
  emptyDraft: () => T;
  /** Converts the Gemini result into a draft. */
  fromExtracted: (parsed: T) => T;
  /** The extraction spec — prompt + normalizer. Passed to Gemini. */
  extractSpec: ExtractSpec<T>;
  /** Renders the review form. Returns the edited draft. */
  renderReview: (draft: T, setDraft: React.Dispatch<React.SetStateAction<T>>) => React.ReactNode;
  /**
   * Called when the user hits Save. Should insert the row and resolve
   * on success. Reject to show a toast.
   */
  save: (draft: T) => Promise<void>;
  /** Optional validation gate — return null if ok, a message if blocked. */
  validate?: (draft: T) => string | null;
  /** Shown below the extraction summary so the user knows what was pulled. */
  extractSummary?: (draft: T) => string | null;
}

interface Props<T> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: AiUploadModalConfig<T>;
}

export function AiUploadModal<T>({ open, onOpenChange, config }: Props<T>) {
  const toast = useToast();
  const extract = useGeminiExtractTyped<T>(config.extractSpec);

  const [draft, setDraft] = useState<T>(config.emptyDraft);
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pastePadRef  = useRef<HTMLTextAreaElement>(null);

  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    setDraft(config.emptyDraft());
    setSourceLabel(null);
    extract.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const run = (input: ExtractInput, label: string) => {
    setSourceLabel(label);
    setDraft(config.emptyDraft());
    extract.mutate(input, {
      onSuccess: (parsed) => {
        const next = config.fromExtracted(parsed);
        setDraft(next);
        toast.push({
          kind: 'success',
          title: `Extracted`,
          description: config.extractSummary?.(next) ?? 'Review the fields and Save.',
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

  const onPaste: React.ClipboardEventHandler<HTMLDivElement> = (e) => {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find(i => i.type.startsWith('image/'));
    if (imageItem) {
      const f = imageItem.getAsFile();
      if (f) {
        e.preventDefault();
        onFilePicked(f);
      }
    }
  };

  const runPastedText = () => {
    const text = pastePadRef.current?.value.trim() ?? '';
    if (!text) {
      toast.push({ kind: 'warning', title: 'Nothing to analyze', description: 'Paste a document first.' });
      return;
    }
    run({ kind: 'text', text }, `Pasted text · ${text.length} chars`);
  };

  const onSave = async () => {
    const err = config.validate?.(draft);
    if (err) {
      toast.push({ kind: 'error', title: 'Check the form', description: err });
      return;
    }
    setSaving(true);
    try {
      await config.save(draft);
      onOpenChange(false);
    } catch (e) {
      toast.push({
        kind: 'error',
        title: 'Save failed',
        description: e instanceof Error ? e.message : 'Unknown error',
      });
    } finally {
      setSaving(false);
    }
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
                {config.title}
              </Dialog.Title>
              <Dialog.Description className="text-[12px] text-slate-500 mt-0.5">
                {config.description}
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

            <details className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] px-3 py-2">
              <summary className="text-[12px] text-slate-400 cursor-pointer list-none flex items-center gap-2">
                <Clipboard size={12} /> Or paste the document as text
              </summary>
              <div className="mt-2 space-y-2">
                <textarea
                  ref={pastePadRef}
                  rows={4}
                  placeholder="Paste an email body, confirmation, or any text…"
                  className="w-full bg-[#111111] border border-[#1f1f1f] rounded-md px-2 py-1.5 text-[12.5px] text-slate-200 resize-y"
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={runPastedText}
                    disabled={extract.isPending}
                    className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md"
                  >
                    <Send size={11} className="mr-1" /> Analyze text
                  </Button>
                  <span className="text-[11px] text-slate-500">
                    Uses the same Gemini extraction as the drop zone.
                  </span>
                </div>
              </div>
            </details>

            <div className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium flex items-center gap-2">
                  <FileText size={12} /> Review &amp; edit
                  {stage === 'ready' && <Badge variant="info">AI draft</Badge>}
                </div>
                {stage === 'ready' && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(config.emptyDraft());
                      extract.reset();
                      setSourceLabel(null);
                    }}
                    className="text-[11px] text-slate-500 hover:text-slate-200 flex items-center gap-1"
                  >
                    <RotateCcw size={11} /> Clear
                  </button>
                )}
              </div>
              {config.renderReview(draft, setDraft)}
            </div>
          </div>

          <div className="px-5 py-3 border-t border-[#1f1f1f] flex items-center gap-2 justify-end">
            <Dialog.Close className="px-3 py-1.5 text-[12px] text-slate-400 hover:text-slate-100 rounded-md hover:bg-[#141414] transition-colors">
              Cancel
            </Dialog.Close>
            <Button
              size="sm"
              onClick={onSave}
              disabled={saving || extract.isPending}
              loading={saving}
              className={cn(
                'bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40',
                'h-7 px-3 text-[12px] font-medium rounded-md',
              )}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
