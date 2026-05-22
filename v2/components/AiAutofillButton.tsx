// Drawer-slot AI autofill button.
//
// Lightweight wrapper around useGeminiExtractTyped for drawers that
// want a "✨ Autofill" action. Renders a small popover (plain div,
// no radix Popover dep) with file picker + paste-pad; on success,
// calls the drawer's `onExtracted(data)` handler so the drawer
// merges the returned fields into its own form state.
//
// This is different from AiUploadModal (which owns the whole
// create-flow end-to-end and saves directly). The button assumes
// the drawer is already open and the user is editing — it just
// fills in fields.

import React, { useEffect, useRef, useState } from 'react';
import {
  Sparkles, Upload, Loader2, AlertCircle, Send, X as XIcon,
} from 'lucide-react';
import { Button } from '../primitives';
import { useToast } from '../primitives/Toast';
import {
  useGeminiExtractTyped, ExtractSpec, ExtractInput,
} from '../queries/useGeminiExtractTyped';
import { cn } from '../primitives/utils';

interface Props<T> {
  /** Extraction spec — prompt + normalizer. Same shape AiUploadModal uses. */
  extractSpec: ExtractSpec<T>;
  /** Called with the normalized draft when extraction succeeds. */
  onExtracted: (draft: T) => void;
  /** Button label. Default: "AI Autofill". */
  label?: string;
  /** Disables the button. */
  disabled?: boolean;
  /** Extra class on the trigger button. */
  className?: string;
}

export function AiAutofillButton<T>({
  extractSpec, onExtracted, label = 'AI Autofill', disabled, className,
}: Props<T>) {
  const toast = useToast();
  const extract = useGeminiExtractTyped<T>(extractSpec);

  const [open, setOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pastePadRef  = useRef<HTMLTextAreaElement>(null);
  const popoverRef   = useRef<HTMLDivElement>(null);
  const triggerRef   = useRef<HTMLButtonElement>(null);

  // Close on outside click / escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = (input: ExtractInput, ctxLabel: string) => {
    extract.mutate(input, {
      onSuccess: (parsed) => {
        onExtracted(parsed);
        toast.push({
          kind: 'success',
          title: 'Autofilled',
          description: ctxLabel,
        });
        setOpen(false);
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
    const img = items.find(i => i.type.startsWith('image/'));
    if (img) {
      const f = img.getAsFile();
      if (f) { e.preventDefault(); onFilePicked(f); }
    }
  };

  const runPastedText = () => {
    const text = pastePadRef.current?.value.trim() ?? '';
    if (!text) {
      toast.push({ kind: 'warning', title: 'Nothing to analyze' });
      return;
    }
    run({ kind: 'text', text }, `Pasted text · ${text.length} chars`);
  };

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || extract.isPending}
        onClick={() => setOpen(o => !o)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md ' +
          'bg-gradient-to-r from-indigo-600 to-purple-600 text-white ' +
          'hover:from-indigo-500 hover:to-purple-500 ' +
          'h-7 px-2.5 text-[12px] font-medium ' +
          'disabled:opacity-60 disabled:cursor-not-allowed',
          className,
        )}
        title="Extract fields from a file or pasted text"
      >
        {extract.isPending ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
        {label}
      </button>

      {open && (
        <div
          ref={popoverRef}
          onPaste={onPaste}
          className="absolute right-0 top-full mt-1.5 z-50 w-[360px] rounded-md border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_10px_30px_rgba(0,0,0,0.5)] p-3 space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium flex items-center gap-1.5">
              <Sparkles size={11} className="text-indigo-300" /> Autofill from document
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="text-slate-500 hover:text-slate-200"
            >
              <XIcon size={12} />
            </button>
          </div>

          <div
            onDragEnter={e => { e.preventDefault(); setDragOver(true); }}
            onDragOver={e => e.preventDefault()}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'rounded-md border border-dashed text-center py-4 px-3 transition-colors cursor-pointer text-[11.5px]',
              dragOver
                ? 'border-indigo-400 bg-indigo-500/10 text-indigo-200'
                : extract.isPending
                  ? 'border-indigo-500/40 bg-indigo-500/5 text-indigo-200'
                  : extract.error
                    ? 'border-red-500/40 bg-red-500/5 text-red-200'
                    : 'border-indigo-500/30 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 text-slate-300 hover:border-indigo-400/60',
            )}
          >
            {extract.isPending ? (
              <div className="flex items-center justify-center gap-2">
                <Loader2 size={12} className="animate-spin" /> Extracting…
              </div>
            ) : extract.error ? (
              <div className="flex items-center justify-center gap-2">
                <AlertCircle size={12} /> {extract.error.message}
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2">
                <Upload size={12} className="text-indigo-300" />
                Drop file, click, or ⌘V screenshot
              </div>
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

          <div>
            <textarea
              ref={pastePadRef}
              rows={3}
              placeholder="…or paste text (email body, PO, confirmation)"
              className="w-full bg-[#111111] border border-[#1f1f1f] rounded-md px-2 py-1.5 text-[12px] text-slate-200 resize-y placeholder:text-slate-600"
            />
            <div className="mt-1.5 flex items-center justify-end gap-2">
              <Button
                size="sm"
                onClick={runPastedText}
                disabled={extract.isPending}
                className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md inline-flex items-center gap-1.5"
              >
                <Send size={11} /> Analyze
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
