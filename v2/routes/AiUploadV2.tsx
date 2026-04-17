// Phase 3B — v2 AI Upload. Real Gemini extraction flow.

import React, { useRef, useState } from 'react';
import {
  Card, CardHeader, CardTitle, CardBody, Badge, EmptyState, Skeleton,
} from '../primitives';
import { useGeminiExtract, ExtractedDocument } from '../queries/useGeminiExtract';
import { useToast } from '../primitives/Toast';
import { useAuth } from '../providers/AuthProvider';
import { cn } from '../primitives/utils';

const fmtMoney = (n: number | null, c: string | null): string => {
  if (n === null) return '—';
  if (!c) return n.toLocaleString('en-US');
  try {
    return n.toLocaleString('en-US', { style: 'currency', currency: c });
  } catch {
    return `${c} ${n.toLocaleString('en-US')}`;
  }
};

const AiUploadV2: React.FC = () => {
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ExtractedDocument | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const extract = useGeminiExtract();

  const run = (f: File) => {
    setFile(f);
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

  const signedIn = Boolean(user);

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <div className="flex items-center gap-2">
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">AI Upload</h1>
          <Badge variant="info">Live</Badge>
        </div>
        <p className="text-[13px] text-slate-500 mt-1 max-w-2xl">
          Drop a PDF, PNG, or JPG — Gemini reads it and returns structured
          fields. The file never leaves your browser except through the
          Phase 1c gemini-proxy (no API key in the bundle).
        </p>
      </div>

      {!signedIn && (
        <Card className="mb-6 border-amber-500/30 bg-amber-500/5">
          <CardBody>
            <div className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-400 flex items-center justify-center text-[11px] shrink-0 mt-0.5">!</div>
              <div>
                <div className="text-[13px] font-medium text-amber-200">Sign in required</div>
                <div className="text-[12px] text-amber-200/80 mt-0.5">
                  gemini-proxy requires a user JWT. Log into v1 first, then reload this page — your session carries over.
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Drop zone */}
      <div
        onDragEnter={e => { e.preventDefault(); setDragOver(true); }}
        onDragOver={e => e.preventDefault()}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files[0];
          if (f) run(f);
        }}
        className={cn(
          'rounded-md border-2 border-dashed transition-colors text-center py-12 px-6',
          dragOver
            ? 'border-indigo-500/60 bg-indigo-500/5'
            : 'border-[#1f1f1f] hover:border-[#2a2a2a]',
        )}
      >
        <div className="text-[15px] font-medium text-slate-200">
          Drop a document here
        </div>
        <div className="text-[12.5px] text-slate-500 mt-1">
          PDF, PNG, or JPG — or{' '}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-indigo-400 hover:text-indigo-300 underline"
          >
            pick from your computer
          </button>
        </div>
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

      {/* Result */}
      <div className="mt-8">
        <Card>
          <CardHeader>
            <CardTitle>Extraction</CardTitle>
            {file && (
              <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                {file.name} · {(file.size / 1024).toFixed(0)} KB
              </span>
            )}
          </CardHeader>

          {extract.isPending ? (
            <div className="p-5 space-y-3">
              <Skeleton width={140} height={14} />
              <Skeleton width={240} height={14} />
              <Skeleton width={180} height={14} />
              <Skeleton width={200} height={14} />
              <div className="text-[11px] text-slate-500 mt-2">
                Routing through gemini-proxy · {file?.type}
              </div>
            </div>
          ) : extract.error ? (
            <EmptyState
              tone="danger"
              title="Couldn't extract"
              description={extract.error.message}
              action={file ? { label: 'Retry', onClick: () => run(file) } : undefined}
            />
          ) : result ? (
            <CardBody>
              <dl className="space-y-3 text-[13px]">
                <Row label="Kind"         value={<Badge variant="info" dot>{result.kind}</Badge>} />
                <Row label="Number"       value={result.number ?? <span className="text-slate-600">—</span>} />
                <Row label="Counterparty" value={result.counterparty ?? <span className="text-slate-600">—</span>} />
                <Row label="Date"         value={result.date ?? <span className="text-slate-600">—</span>} />
                <Row label="Total"        value={<span className="font-mono tabular-nums">{fmtMoney(result.totalAmount, result.currency)}</span>} />
                {result.notes && (
                  <Row label="Notes" value={<span className="text-slate-400 text-[12.5px]">{result.notes}</span>} />
                )}
              </dl>
              <div className="mt-6 pt-4 border-t border-[#1f1f1f]">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-2">Raw JSON</div>
                <pre className="text-[11.5px] text-slate-400 font-mono bg-[#0f0f0f] rounded-md border border-[#1f1f1f] p-3 overflow-auto max-h-64">
                  {JSON.stringify(result.raw, null, 2)}
                </pre>
              </div>
            </CardBody>
          ) : (
            <EmptyState
              title="No document yet"
              description="Extraction results land here once you upload."
            />
          )}
        </Card>
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-start gap-4">
    <dt className="w-40 shrink-0 text-slate-500 text-[11px] uppercase tracking-wider font-medium">
      {label}
    </dt>
    <dd className="flex-1 min-w-0 text-slate-200 break-words">{value}</dd>
  </div>
);

export default AiUploadV2;
