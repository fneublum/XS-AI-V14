// v2 Dashboard — document drop zone above the Messages widget.
//
// Hands the file off to the XS Agent chat (AiDashboard) via a window
// custom event so the extract runs inside the agent's pipeline —
// identification → extraction → confirmation — and every step renders
// as chat messages. Keeps the dropzone stateless beyond "a file is
// being handed off" so we don't duplicate OCR work here.

import React, { useRef, useState } from 'react';
import { UploadCloud, CheckCircle2 } from 'lucide-react';
import { cn } from '../primitives/utils';

export const DASHBOARD_OCR_EVENT = 'xs-ocr-file';

export const DashboardDropzone: React.FC = () => {
  const [dragOver, setDragOver] = useState(false);
  const [handedOff, setHandedOff] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const dispatch = (file: File) => {
    window.dispatchEvent(new CustomEvent(DASHBOARD_OCR_EVENT, { detail: { file } }));
    setHandedOff(file.name);
    // Clear the transient badge after a short window so the zone
    // returns to its idle CTA state.
    window.setTimeout(() => setHandedOff(null), 2500);
  };

  const tone =
    dragOver
      ? 'border-indigo-400 bg-gradient-to-br from-indigo-500/30 to-purple-500/25 shadow-[inset_0_0_0_1px_rgba(129,140,248,0.35)]'
      : handedOff
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
        if (f) dispatch(f);
      }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        'h-full w-full rounded-md border-2 border-dashed transition-all cursor-pointer',
        'flex flex-col items-center justify-center gap-1.5 px-3 py-2 text-center',
        tone,
      )}
    >
      {handedOff ? (
        <>
          <CheckCircle2 size={20} className="text-emerald-300" />
          <div className="text-[11.5px] font-medium text-emerald-200">Sent to XS Agent</div>
          <div className="text-[10.5px] text-emerald-200/80 truncate w-full">{handedOff}</div>
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
          if (f) dispatch(f);
          e.target.value = '';
        }}
      />
    </div>
  );
};
