// PDF viewer modal — opens a stored PDF (data URL or base64) inside an
// iframe with Download + Email actions, instead of routing the user to
// a new tab. Used today by Bookings (eye icon) and easy to wire into
// other list pages whose rows have an `originalDocument` payload.
//
// The PDF lives in the DB as `data:application/pdf;base64,...`. We
// convert it to a blob URL once on open — Chrome blocks navigation to
// `data:` URLs at the top level, and iframes load blob: URLs faster
// than the giant inline base64.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Mail, Upload, X, Loader2, FileText } from 'lucide-react';
import { sendEmail } from '../../services/emailService';
import { useToast } from '../primitives/Toast';
import {
  getAccountFor, getGoogleAccount, initializeMsal,
} from '../../services/smailAuth';

interface PdfViewerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Data URL like `data:application/pdf;base64,...`. When null/empty
   *  and `onUpload` is provided, the modal renders an empty-state with
   *  a file picker instead of failing silently. */
  dataUrl: string | null;
  /** Human-readable label, e.g. "Booking 270999154". Used in the title
   *  bar, the suggested filename, and the default email subject. */
  title: string;
  /** Default email subject. Defaults to `Document: {title}`. */
  defaultEmailSubject?: string;
  /** Default email body. */
  defaultEmailBody?: string;
  /** When provided, the empty state shows an "Upload PDF" picker. The
   *  callback receives a `data:application/pdf;base64,…` URL and is
   *  expected to persist it (e.g. write to a Supabase column). The
   *  modal swaps to the viewer as soon as the callback resolves. */
  onUpload?: (dataUrl: string) => Promise<void> | void;
}

/** Decode `data:application/pdf;base64,…` into raw base64 + mime. */
function splitDataUrl(dataUrl: string): { base64: string; mime: string } | null {
  if (!dataUrl.startsWith('data:')) return null;
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) return null;
  const meta = dataUrl.slice(5, commaIdx); // strip "data:"
  const [mime] = meta.split(';');
  return { base64: dataUrl.slice(commaIdx + 1), mime: mime || 'application/pdf' };
}

function base64ToBlob(base64: string, mime: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export const PdfViewerModal: React.FC<PdfViewerModalProps> = ({
  open, onOpenChange, dataUrl, title, defaultEmailSubject, defaultEmailBody, onUpload,
}) => {
  const toast = useToast();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [senderHint, setSenderHint] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Build the blob URL whenever a fresh data URL arrives; revoke when
  // the modal closes or a new doc loads.
  useEffect(() => {
    if (!open || !dataUrl) {
      setBlobUrl(null);
      setBase64(null);
      return;
    }
    const parts = splitDataUrl(dataUrl);
    if (!parts) {
      setBlobUrl(null);
      setBase64(null);
      return;
    }
    const blob = base64ToBlob(parts.base64, parts.mime);
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    setBase64(parts.base64);
    return () => { URL.revokeObjectURL(url); };
  }, [open, dataUrl]);

  // Reset email form state on each open + resolve the sender so the
  // form can show "you'll send from X" before the user commits.
  useEffect(() => {
    if (!open) return;
    setShowEmailForm(false);
    setEmailTo('');
    setEmailSubject(defaultEmailSubject ?? `Document: ${title}`);
    setEmailBody(defaultEmailBody ?? `Hi,\n\nAttached is ${title}.\n\nThanks.`);
    setEmailSending(false);
    (async () => {
      try { await initializeMsal(); } catch { /* non-fatal */ }
      const auto = getAccountFor('automation');
      const mine = getAccountFor('my');
      const gmail = getGoogleAccount();
      const out = auto?.username || mine?.username;
      if (out) setSenderHint(`Outlook · ${out}`);
      else if (gmail?.email) setSenderHint(`Gmail · ${gmail.email}`);
      else setSenderHint(null);
    })();
  }, [open, title, defaultEmailSubject, defaultEmailBody]);

  const filename = useMemo(
    () => `${title.replace(/[^\w.-]+/g, '_')}.pdf`,
    [title],
  );

  if (!open) return null;

  const onDownload = () => {
    if (!blobUrl) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const onPickFile = () => fileInputRef.current?.click();
  // Drop-zone state for the empty-state drag target. Reset on
  // drag-leave so the visual ring stays accurate.
  const [dragOver, setDragOver] = useState(false);

  /** Read + persist a chosen / dropped file. Shared by the hidden
   *  file input AND the drag-and-drop handler so the two entry
   *  points have identical behaviour. */
  const ingestFile = async (file: File | null | undefined) => {
    if (!file) return;
    if (!onUpload) return;
    if (file.type !== 'application/pdf') {
      toast.push({ kind: 'warning', title: 'PDF only', description: `Got ${file.type || 'unknown type'}.` });
      return;
    }
    setUploadBusy(true);
    try {
      const reader = new FileReader();
      const url: string = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error || new Error('Read failed'));
        reader.readAsDataURL(file);
      });
      await onUpload(url);
      toast.push({ kind: 'success', title: 'PDF attached', description: file.name });
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Upload failed',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setUploadBusy(false);
    }
  };
  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    ingestFile(file);
  };
  const onDropFile = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    ingestFile(file);
  };

  const onSendEmail = async () => {
    if (!base64) return;
    const to = emailTo.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    if (to.length === 0) {
      toast.push({ kind: 'warning', title: 'Recipient required', description: 'Add at least one email address.' });
      return;
    }
    setEmailSending(true);
    try {
      const res = await sendEmail({
        to,
        subject: emailSubject || `Document: ${title}`,
        htmlBody: emailBody.split('\n').map(p => `<p>${p}</p>`).join(''),
        attachments: [{
          name: filename,
          contentBytes: base64,
          contentType: 'application/pdf',
        }],
      });
      if (res.success) {
        toast.push({
          kind: 'success',
          title: 'Email sent',
          description: res.message ?? `${to.length} recipient${to.length === 1 ? '' : 's'}`,
        });
        setShowEmailForm(false);
      } else {
        toast.push({
          kind: 'error',
          title: 'Email failed',
          description: res.message ?? 'Sender rejected the message.',
        });
      }
    } catch (e) {
      toast.push({
        kind: 'error',
        title: 'Email failed',
        description: (e as Error)?.message ?? 'Unknown error.',
      });
    } finally {
      setEmailSending(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdf-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <button
        aria-label="Close"
        className="absolute inset-0 h-full w-full cursor-default bg-slate-900/60"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative z-10 flex h-[90vh] w-[min(96vw,1100px)] flex-col overflow-hidden rounded-lg bg-[#0f0f0f] border border-[#1f1f1f] shadow-[0_24px_80px_rgba(0,0,0,0.6)]">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2">
          <h2 id="pdf-modal-title" className="truncate text-[13px] font-medium text-slate-100">
            {title}
          </h2>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onDownload}
              disabled={!blobUrl}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#1f1f1f] bg-[#141414] px-2.5 py-1 text-[12px] text-slate-300 hover:bg-[#1a1a1a] hover:text-slate-100 disabled:opacity-40 transition-colors"
            >
              <Download size={12} /> Download
            </button>
            <button
              type="button"
              onClick={() => setShowEmailForm(s => !s)}
              disabled={!base64}
              className="inline-flex items-center gap-1.5 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-[12px] text-indigo-200 hover:border-indigo-400/60 hover:bg-indigo-500/20 disabled:opacity-40 transition-colors"
            >
              <Mail size={12} /> Email
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close PDF"
              className="ml-1 p-1 rounded text-slate-500 hover:text-slate-200 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Email composition strip — only shown after the user clicks Email */}
        {showEmailForm && (
          <div className="border-b border-[#1f1f1f] bg-[#0d0d0d] px-3 py-2.5 space-y-1.5 text-[12px]">
            <div className="text-[11px] text-slate-500">
              From: <span className="text-indigo-200 font-mono">{senderHint ?? '⚠ No account connected — connect Outlook/Gmail in Settings'}</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="w-16 text-slate-500">To:</label>
              <input
                type="text"
                value={emailTo}
                onChange={e => setEmailTo(e.target.value)}
                placeholder="recipient@example.com, …"
                className="flex-1 h-7 px-2 bg-[#0a0a0a] border border-[#1f1f1f] rounded text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="w-16 text-slate-500">Subject:</label>
              <input
                type="text"
                value={emailSubject}
                onChange={e => setEmailSubject(e.target.value)}
                className="flex-1 h-7 px-2 bg-[#0a0a0a] border border-[#1f1f1f] rounded text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="flex items-start gap-2">
              <label className="w-16 pt-1 text-slate-500">Body:</label>
              <textarea
                value={emailBody}
                onChange={e => setEmailBody(e.target.value)}
                rows={3}
                className="flex-1 px-2 py-1 bg-[#0a0a0a] border border-[#1f1f1f] rounded text-slate-200 focus:outline-none focus:border-indigo-500 resize-y"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowEmailForm(false)}
                disabled={emailSending}
                className="px-2.5 py-1 rounded-md text-[12px] text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSendEmail}
                disabled={emailSending || !emailTo.trim() || !senderHint}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[12px] font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {emailSending ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
                {emailSending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        )}

        {/* Hidden file input for the empty-state Upload button */}
        {onUpload && (
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={onFileChosen}
            className="hidden"
          />
        )}

        {/* Viewer */}
        <div className="flex-1 min-h-0 bg-[#0a0a0a]">
          {blobUrl ? (
            <iframe
              key={blobUrl}
              src={blobUrl}
              title={`${title} preview`}
              className="h-full w-full"
            />
          ) : dataUrl ? (
            <div className="flex h-full items-center justify-center text-[12.5px] text-slate-500">
              Loading PDF…
            </div>
          ) : (
            // Empty state — drop target when onUpload is provided.
            // Both the click button AND a full drag-and-drop hit the
            // same ingestFile() so the behaviour is identical.
            <div
              onDragOver={onUpload ? (e) => { e.preventDefault(); setDragOver(true); } : undefined}
              onDragLeave={onUpload ? () => setDragOver(false) : undefined}
              onDrop={onUpload ? onDropFile : undefined}
              className={
                'flex h-full flex-col items-center justify-center gap-3 px-6 text-center transition-colors ' +
                (dragOver ? 'bg-indigo-500/10 ring-2 ring-inset ring-indigo-500/60' : '')
              }
            >
              <FileText size={36} className={dragOver ? 'text-indigo-300' : 'text-slate-600'} />
              <div className="text-[13px] text-slate-300">
                {dragOver
                  ? 'Drop to attach…'
                  : 'No PDF attached to this record yet.'}
              </div>
              {onUpload && !dragOver && (
                <>
                  <div className="text-[11.5px] text-slate-500 max-w-[360px]">
                    Drag a PDF here, or click below to pick a file. Saved on
                    the record so the next click opens it directly.
                  </div>
                  <button
                    type="button"
                    onClick={onPickFile}
                    disabled={uploadBusy}
                    className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
                  >
                    {uploadBusy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                    {uploadBusy ? 'Uploading…' : 'Upload PDF'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
