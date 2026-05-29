// App-level supplier-proforma viewer.
//
// Background: when this modal lived inside PurchaseOrderDrawer, it
// rendered on top of the drawer overlay and the drawer's stacking
// context (Radix Dialog portal) intermittently swallowed clicks on
// the modal's Close button. We solved the symptom with z-[60] +
// e.stopPropagation, but the problem kept resurfacing under specific
// browsers / iframe states.
//
// The clean fix: close the PO drawer first, then open this modal at
// the app level (next to the other drawers in AppV2). No portal
// rivalry, no z-index gymnastics, three reliable close paths
// (Close button, Escape, backdrop click) handled by Modal primitive.
//
// The drawer passes a self-contained `payload`: URL, PO ref,
// supplier name, download filename, plus a pre-built EmailDraft so
// the modal doesn't need access to supplier-resolution helpers that
// live in the drawer scope.

import React from 'react';
import { Download, Send, FileText, X } from 'lucide-react';
import { Modal } from '../primitives';
import type { EmailDraft } from './EmailComposeDrawer';

export interface ProformaViewerPayload {
  url: string;
  poRef: string;
  supplierName: string;
  /** Suggested filename for the Download action — pre-computed at
   *  open-time using the PO ref + supplier + MIME extension. */
  downloadFilename: string;
  /** Pre-built EmailDraft so the modal can hand it straight to
   *  EmailComposeDrawer without re-running recipient resolution. */
  emailDraft: EmailDraft;
}

const inferDataUrlMime = (url: string): string => {
  const m = url.match(/^data:([^;,]+)[;,]/i);
  return m ? m[1].toLowerCase() : '';
};

const downloadDataUrl = (url: string, filename: string) => {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

interface Props {
  payload: ProformaViewerPayload | null;
  onClose: () => void;
  /** Triggered when user clicks "Email to supplier" — parent (AppV2)
   *  downloads the file, closes this modal, and opens the
   *  EmailComposeDrawer with the pre-built draft. */
  onEmail: (draft: EmailDraft, downloadFilename: string, url: string) => void;
}

export const ProformaViewerModal: React.FC<Props> = ({ payload, onClose, onEmail }) => {
  if (!payload) {
    // Render the Modal closed so its useEffect cleanup runs cleanly
    // if the payload disappears while the modal was open.
    return <Modal open={false} onClose={onClose}>{null}</Modal>;
  }

  const { url, poRef, supplierName, downloadFilename, emailDraft } = payload;
  const mime    = inferDataUrlMime(url);
  const isPdf   = mime === 'application/pdf';
  const isImage = mime.startsWith('image/');

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    downloadDataUrl(url, downloadFilename);
  };

  const handleEmail = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEmail(emailDraft, downloadFilename, url);
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      className="bg-[#0a0a0a] text-slate-200 border border-[#1f1f1f] w-[min(96vw,1100px)] p-0"
    >
      <div className="px-5 py-3 border-b border-[#1f1f1f] flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">
            Proforma invoice · PO {poRef}
          </div>
          <div className="mt-0.5 text-sm text-slate-200 truncate">
            {supplierName || 'Supplier'}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] text-slate-200 border border-[#1f1f1f] hover:border-indigo-500/40 hover:text-indigo-200"
          >
            <Download size={13} /> Download
          </button>
          <button
            type="button"
            onClick={handleEmail}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] text-emerald-200 border border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10"
          >
            <Send size={13} /> Email to supplier
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] text-slate-300 border border-[#1f1f1f] hover:border-rose-500/40 hover:text-rose-300"
            title="Close (Esc)"
            autoFocus
          >
            <X size={13} /> Close
          </button>
        </div>
      </div>
      <div className="h-[78vh] bg-[#1a1a1a] flex items-center justify-center overflow-auto">
        {isPdf && (
          <iframe
            src={url}
            title="Proforma invoice"
            className="w-full h-full border-0 bg-white"
          />
        )}
        {isImage && (
          <img
            src={url}
            alt="Proforma invoice"
            className="max-w-full max-h-full object-contain"
          />
        )}
        {!isPdf && !isImage && (
          <div className="text-center text-slate-400 text-[13px] p-6">
            <FileText size={32} className="mx-auto mb-2 opacity-50" />
            Preview not available for this file type ({mime || 'unknown'}).<br />
            Use <span className="text-indigo-300">Download</span> to open it locally.
          </div>
        )}
      </div>
    </Modal>
  );
};
