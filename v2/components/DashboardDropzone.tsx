// Phase 3B — Document drop zone for the v2 Dashboard right column.
//
// Sits above the WhatsApp widget at ~20% of the column height, so it
// needs to fill its parent vertically. Uses the same
// `useGeminiExtract` mutation the dedicated AI Upload page uses.

import React, { useRef, useState } from 'react';
import { UploadCloud, Loader2, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { useGeminiExtract, ExtractedDocument } from '../queries/useGeminiExtract';
import { useToast } from '../primitives/Toast';
import { cn } from '../primitives/utils';

export const DashboardDropzone: React.FC = () => {
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractedDocument | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const extract = useGeminiExtract();

  const run = (f: File) => {
    setFileName(f.name);
    setResult(null);
    extract.mutate(f, {
      onSuccess: (doc) => {
        setResult(doc);
        toast.push({
          kind: 'success',
          title: `${doc.kind} extracted`,
          description: doc.number ?? doc.counterparty ?? f.name,
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

  const reset = () => {
    setFileName(null);
    setResult(null);
    extract.reset();
  };

  // Color state: idle = indigo/purple gradient, drag = brighter,
  // success = emerald, error = red.
  const tone =
    dragOver
      ? 'border-indigo-400 bg-gradient-to-br from-indigo-500/30 to-purple-500/25 shadow-[inset_0_0_0_1px_rgba(129,140,248,0.35)]'
      : extract.error
        ? 'border-red-500/50 bg-red-500/10'
        : result
          ? 'border-emerald-500/50 bg-emerald-500/10'
          : 'border-indigo-500/40 bg-gradient-to-br from-indigo-500/15 via-indigo-500/10 to-purple-500/10 hover:border-indigo-400/70 hover:from-indigo-500/20 hover:to-purple-500/15';

  return (
    <div
      onDragEnter={e => { e.preventDefault(); setDragOver(true); }}
      onDragOver={e => e.preventDefault()}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragOver(false);
      }}
      onDrop={e => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files[0];
        if (f) run(f);
      }}
      onClick={() => {
        if (!extract.isPending && !result && !extract.error) inputRef.current?.click();
      }}
      className={cn(
        'h-full w-full rounded-md border-2 border-dashed transition-all cursor-pointer',
        'flex flex-col items-center justify-center gap-1.5 px-3 py-2 text-center relative',
        tone,
      )}
    >
      {(result || extract.error) && !extract.isPending && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); reset(); }}
          aria-label="Clear"
          className="absolute top-1 right-1 p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-black/30"
        >
          <X size={12} />
        </button>
      )}

      {extract.isPending ? (
        <>
          <Loader2 size={20} className="text-indigo-300 animate-spin" />
          <div className="text-[11.5px] text-indigo-100">
            Extracting <span className="font-mono text-indigo-200">{fileName}</span>…
          </div>
        </>
      ) : extract.error ? (
        <>
          <AlertCircle size={20} className="text-red-300" />
          <div className="text-[11.5px] font-medium text-red-200">Couldn't extract</div>
          <div className="text-[10.5px] text-red-200/80 line-clamp-2 px-2">{extract.error.message}</div>
        </>
      ) : result ? (
        <>
          <CheckCircle2 size={20} className="text-emerald-300" />
          <div className="text-[11.5px] font-medium text-emerald-200">{result.kind}</div>
          <div className="text-[10.5px] text-emerald-200/80 truncate w-full">
            {result.number ?? result.counterparty ?? fileName}
          </div>
        </>
      ) : (
        <>
          <UploadCloud size={20} className="text-indigo-300" />
          <div className="text-[12px] font-medium text-indigo-100">
            Drop a document
          </div>
          <div className="text-[10.5px] text-indigo-200/70">
            PDF · PNG · JPG — or click to pick
          </div>
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) run(f);
          e.target.value = '';
        }}
      />
    </div>
  );
};
