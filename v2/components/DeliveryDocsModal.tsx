// Phase 3B — Native Delivery Documents modal.
//
// Mirrors v1's PLInvoiceEngine Documents Modal. Invoice / Packing List
// / SLI now generate natively via v2/services/pdf/. BOL is still
// stored as a data-URL on the invoice row when present; otherwise
// v1's upload UI is the fallback.
//
// BR and 50% checkboxes in the footer adjust the PDF prices exactly
// the way v1's "BR" mode + Patex 50% override do — see
// v2/services/pdf/priceAdjust.ts. Email Selected composes an email
// through v1's shared `services/emailService.sendEmail` so attachments
// actually land in the recipient's inbox (Outlook via MSAL or Gmail
// via Google Identity — whichever is connected in Settings).

import React, { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  X as XIcon, FileText, Package, ClipboardList, Ship,
  Eye, Download, Loader2, Mail, Upload, AlertCircle, CheckCircle2,
} from 'lucide-react';
import { useToast } from '../primitives/Toast';
import { Button } from '../primitives/Button';
import { useCompany } from '../providers/CompanyProvider';
import { useCompanies } from '../queries/useCompanies';
import { useCustomers } from '../queries/useCustomers';
import { useSuppliers } from '../queries/useSuppliers';
import { useProducts } from '../queries/useProducts';
import { usePackingLists } from '../queries/usePackingLists';
import { useBookings } from '../queries/useBookings';
import { useCompanyImages } from '../queries/useCompanyImages';
import { Invoice } from '../queries/useInvoices';
import { generateInvoicePdf } from '../services/pdf/invoicePdf';
import { generatePackingListPdf } from '../services/pdf/packingListPdf';
import { generateSliPdf } from '../services/pdf/sliPdf';
import { applyAdjustments } from '../services/pdf/priceAdjust';
import { findCompany, PdfInvoice, InvoicePdfCtx } from '../services/pdf/types';
import { sendEmail } from '../../services/emailService';

interface Props {
  invoice: Invoice | null;
  onOpenChange: (open: boolean) => void;
}

const toPdfInvoice = (inv: Invoice): PdfInvoice => ({
  ...inv,
  incoterm: inv.incoterm ?? undefined,
  date: inv.invoiceDate ?? undefined,
} as PdfInvoice);

const openPreview = (doc: any, filename: string) => {
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  if (!win) doc.save(filename);
};

const downloadDoc = (doc: any, filename: string) => doc.save(filename);

/** jsPDF's `output('datauristring')` returns a full data URL; split off
 *  the base64 payload for the email attachment's `contentBytes`. */
const docToBase64 = (doc: any): string =>
  doc.output('datauristring').split(',')[1];

const DocRow: React.FC<{
  checked: boolean;
  onToggle: (v: boolean) => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}> = ({ checked, onToggle, icon, title, subtitle, children }) => (
  <div className={
    'flex items-center justify-between gap-3 px-3 py-2.5 rounded-md border transition-colors ' +
    (checked ? 'bg-indigo-500/5 border-indigo-500/30' : 'bg-[#0f0f0f] border-[#1f1f1f]')
  }>
    <label className="flex items-center gap-3 cursor-pointer min-w-0 flex-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onToggle(e.target.checked)}
        className="w-3.5 h-3.5 accent-indigo-600"
      />
      <div className="text-indigo-300 shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium text-slate-100">{title}</div>
        <div className="text-[11px] text-slate-500 truncate">{subtitle}</div>
      </div>
    </label>
    <div className="flex items-center gap-1 shrink-0">{children}</div>
  </div>
);

const iconBtn =
  'p-1.5 rounded-sm text-slate-500 hover:text-slate-100 hover:bg-[#161616] ' +
  'transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

const handoffToV1 = (invoiceId: string) => {
  try { sessionStorage.setItem('xs_pending_delivery_docs', invoiceId); }
  catch { /* noop */ }
  window.location.href = '/?v2=0';
};

export const DeliveryDocsModal: React.FC<Props> = ({ invoice, onOpenChange }) => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const companies = useCompanies();
  const customers = useCustomers();
  const suppliers = useSuppliers();
  const products = useProducts();
  const packingLists = usePackingLists();
  const bookings = useBookings();
  const logos = useCompanyImages('LOGO');

  const [selection, setSelection] = useState({ invoice: true, pl: false, sli: false, bol: false });
  const [brMode, setBrMode] = useState(false);
  const [halfMode, setHalfMode] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!invoice) return;
    setSelection({ invoice: true, pl: false, sli: false, bol: false });
    setBrMode(false);
    setHalfMode(false);
  }, [invoice?.id]);

  const company = useMemo(
    () => findCompany(companies.data ?? [], currentCompanyId),
    [companies.data, currentCompanyId],
  );

  const logoUrl = useMemo(() => {
    if (!logos.data || logos.data.length === 0) return null;
    const own = logos.data.find(i => i.companyId === currentCompanyId);
    return (own || logos.data[0]).url || null;
  }, [logos.data, currentCompanyId]);

  if (!invoice) return null;

  const buildCtx = (): InvoicePdfCtx => ({
    company,
    customers: customers.data ?? [],
    suppliers: suppliers.data ?? [],
    products: products.data ?? [],
    packingLists: packingLists.data ?? [],
    bookings: bookings.data ?? [],
    ports: [],
    logoUrl,
    stampUrl: null,
    brMode,
  });

  const adjustedInvoice = (): PdfInvoice =>
    applyAdjustments(toPdfInvoice(invoice), { brMode, halfMode });

  // ─── Preview / Download handlers ─────────────────────────────
  const docFactory = (kind: 'invoice' | 'pl' | 'sli') => {
    const inv = adjustedInvoice();
    const ctx = buildCtx();
    if (kind === 'invoice') return generateInvoicePdf(inv, ctx, false);
    if (kind === 'pl')      return generatePackingListPdf(inv, ctx, false);
    return generateSliPdf(inv, ctx, false);
  };

  const runAction = (
    kind: 'invoice' | 'pl' | 'sli',
    action: 'preview' | 'download',
    filename: string,
  ) => {
    const key = `${kind}-${action}`;
    setBusy(key);
    try {
      const doc = docFactory(kind);
      if (action === 'preview') openPreview(doc, filename);
      else downloadDoc(doc, filename);
    } catch (err) {
      toast.push({
        kind: 'error',
        title: `${kind} ${action} failed`,
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  };

  // ─── Email selected — real send with attachments ────────────
  const emailSelected = async () => {
    const selectedCount = Object.values(selection).filter(Boolean).length;
    if (selectedCount === 0) {
      toast.push({ kind: 'warning', title: 'Select at least one document' });
      return;
    }

    setSending(true);
    try {
      const inv = adjustedInvoice();
      const ctx = buildCtx();
      const attachments: { name: string; contentBytes: string; contentType: string }[] = [];

      if (selection.invoice) {
        const doc = generateInvoicePdf(inv, ctx, false);
        attachments.push({
          name: `Invoice_${inv.invoiceNumber || 'unknown'}.pdf`,
          contentBytes: docToBase64(doc),
          contentType: 'application/pdf',
        });
      }
      if (selection.pl) {
        const doc = generatePackingListPdf(inv, ctx, false);
        attachments.push({
          name: `PackingList_${invoice.plNumber || invoice.invoiceNumber || 'unknown'}.pdf`,
          contentBytes: docToBase64(doc),
          contentType: 'application/pdf',
        });
      }
      if (selection.sli) {
        const doc = generateSliPdf(inv, ctx, false);
        attachments.push({
          name: `SLI_${invoice.invoiceNumber || 'unknown'}.pdf`,
          contentBytes: docToBase64(doc),
          contentType: 'application/pdf',
        });
      }
      // BOL is stored as a data URL on the invoice row — skip in BR mode
      // to match v1 behavior (BR-mode shipments don't attach BOL).
      const bolUrl = (invoice as any).bolUrl || (invoice as any).bolurl;
      if (selection.bol && !brMode && bolUrl && typeof bolUrl === 'string' && bolUrl.startsWith('data:')) {
        const payload = bolUrl.split(',')[1];
        const mimeMatch = bolUrl.match(/data:([^;]+);/);
        const mime = mimeMatch ? mimeMatch[1] : 'application/pdf';
        attachments.push({
          name: `BOL_${invoice.invoiceNumber || 'unknown'}.pdf`,
          contentBytes: payload,
          contentType: mime,
        });
      }

      // Build recipient list + subject + body.
      const customer = customers.data?.find(c =>
        c.name === invoice.billToName || c.name === invoice.soldTo,
      );
      const toList = customer?.email ? [customer.email] : [];
      const companyName = company?.name || 'X-Solution';

      const subject = brMode
        ? `BR Documents - Invoice #${inv.invoiceNumber}`
        : `Shipping Documents - Invoice #${invoice.invoiceNumber}`;

      const bodyLines = [
        brMode ? 'Dear Partner,' : `Dear ${customer?.name || 'Customer'},`,
        '',
        'Please find attached the documents for your order:',
        '',
        selection.invoice ? `• Commercial Invoice: ${inv.invoiceNumber}` : '',
        selection.pl      ? `• Packing List: ${invoice.plNumber || 'N/A'}` : '',
        selection.sli     ? `• Shipper's Letter of Instruction (SLI)` : '',
        selection.bol && !brMode && bolUrl ? `• Bill of Lading (BOL)` : '',
        '',
        `Total Amount: $${Number(inv.totalAmount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
        '',
        'Best regards,',
        companyName,
      ].filter(Boolean);

      const htmlBody = `<div style="font-family: Arial, sans-serif; max-width: 600px;">${bodyLines.map(l => l || '<br>').join('<br>')}</div>`;

      if (toList.length === 0) {
        // No recipient stored on the customer — open compose drawer so
        // the user can type it in. Include attachments via download
        // fallback until a contact record exists.
        toast.push({
          kind: 'warning',
          title: 'No recipient email on file',
          description: 'Add the email to the customer record or type it in the compose drawer. Documents downloaded for manual attach.',
        });
        attachments.forEach(a => {
          // data:application/pdf;base64,...
          const href = `data:${a.contentType};base64,${a.contentBytes}`;
          const link = document.createElement('a');
          link.href = href;
          link.download = a.name;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        });
        return;
      }

      const result = await sendEmail({
        to: toList,
        subject,
        htmlBody,
        attachments,
      });

      if (result.success) {
        toast.push({
          kind: 'success',
          title: `Sent via ${result.provider}`,
          description: toList.join(', '),
        });
        onOpenChange(false);
      } else {
        toast.push({
          kind: 'error',
          title: 'Email send failed',
          description: result.message || 'Check the Connections tab to link Outlook or Gmail.',
        });
      }
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Email send error',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSending(false);
    }
  };

  const selectedCount = Object.values(selection).filter(Boolean).length;
  const bolUrl = (invoice as any).bolUrl || (invoice as any).bolurl || null;

  return (
    <Dialog.Root open={!!invoice} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-[6%] -translate-x-1/2 z-50 w-[min(96vw,660px)] rounded-md border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_16px_48px_rgba(0,0,0,0.6)] flex flex-col max-h-[88vh]">
          <div className="px-5 py-4 border-b border-[#1f1f1f] flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-[14px] font-semibold text-slate-100 truncate">
                Delivery Documents
              </Dialog.Title>
              <Dialog.Description className="text-[12px] text-slate-500 mt-0.5 truncate">
                Invoice #{invoice.invoiceNumber} · {invoice.billToName ?? invoice.soldTo ?? '—'}
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="text-slate-500 hover:text-slate-100 transition-colors p-1 -m-1"
            >
              <XIcon size={14} />
            </Dialog.Close>
          </div>

          <div className="px-5 py-4 overflow-y-auto space-y-2">
            {/* Invoice — native */}
            <DocRow
              checked={selection.invoice}
              onToggle={(v) => setSelection(s => ({ ...s, invoice: v }))}
              icon={<FileText size={14} />}
              title="Invoice"
              subtitle={`#${brMode ? 'EC' + (invoice.invoiceNumber || '').replace(/\D/g, '').slice(-2) : invoice.invoiceNumber}${halfMode ? ' · 50% off' : ''}${brMode ? ' · BR' : ''}`}
            >
              <button
                type="button"
                onClick={() => runAction('invoice', 'preview', `Invoice_${invoice.invoiceNumber}.pdf`)}
                disabled={busy !== null || sending}
                title="Preview"
                className={iconBtn}
              >
                {busy === 'invoice-preview' ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
              </button>
              <button
                type="button"
                onClick={() => runAction('invoice', 'download', `Invoice_${invoice.invoiceNumber}.pdf`)}
                disabled={busy !== null || sending}
                title="Download"
                className={iconBtn}
              >
                {busy === 'invoice-download' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              </button>
            </DocRow>

            {/* Packing List — native */}
            <DocRow
              checked={selection.pl}
              onToggle={(v) => setSelection(s => ({ ...s, pl: v }))}
              icon={<Package size={14} />}
              title="Packing List"
              subtitle={invoice.plNumber ? `PL ${invoice.plNumber}` : 'Derived from invoice data'}
            >
              <button
                type="button"
                onClick={() => runAction('pl', 'preview', `PackingList_${invoice.plNumber || invoice.invoiceNumber}.pdf`)}
                disabled={busy !== null || sending}
                title="Preview"
                className={iconBtn}
              >
                {busy === 'pl-preview' ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
              </button>
              <button
                type="button"
                onClick={() => runAction('pl', 'download', `PackingList_${invoice.plNumber || invoice.invoiceNumber}.pdf`)}
                disabled={busy !== null || sending}
                title="Download"
                className={iconBtn}
              >
                {busy === 'pl-download' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              </button>
            </DocRow>

            {/* SLI — native */}
            <DocRow
              checked={selection.sli}
              onToggle={(v) => setSelection(s => ({ ...s, sli: v }))}
              icon={<ClipboardList size={14} />}
              title="Shipper's Letter of Instruction"
              subtitle="Auto-generated from invoice + supplier"
            >
              <button
                type="button"
                onClick={() => runAction('sli', 'preview', `SLI_${invoice.invoiceNumber}.pdf`)}
                disabled={busy !== null || sending}
                title="Preview"
                className={iconBtn}
              >
                {busy === 'sli-preview' ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
              </button>
              <button
                type="button"
                onClick={() => runAction('sli', 'download', `SLI_${invoice.invoiceNumber}.pdf`)}
                disabled={busy !== null || sending}
                title="Download"
                className={iconBtn}
              >
                {busy === 'sli-download' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              </button>
            </DocRow>

            {/* BOL — stored url or upload */}
            <DocRow
              checked={selection.bol}
              onToggle={(v) => setSelection(s => ({ ...s, bol: v }))}
              icon={<Ship size={14} />}
              title="Bill of Lading"
              subtitle={bolUrl ? 'Uploaded' : 'Upload required'}
            >
              {bolUrl ? (
                <>
                  <button
                    type="button"
                    onClick={() => window.open(bolUrl, '_blank', 'noopener,noreferrer')}
                    title="Preview"
                    className={iconBtn}
                  >
                    <Eye size={13} />
                  </button>
                  <a
                    href={bolUrl}
                    download={`BOL_${invoice.invoiceNumber || 'document'}.pdf`}
                    title="Download"
                    className={iconBtn}
                  >
                    <Download size={13} />
                  </a>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => handoffToV1(invoice.id)}
                  title="Upload BOL in v1"
                  className={iconBtn}
                >
                  <Upload size={13} />
                </button>
              )}
            </DocRow>

            {brMode && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-emerald-500/5 border border-emerald-500/20 text-[11px] text-emerald-200/80">
                <CheckCircle2 size={12} className="shrink-0 mt-0.5" />
                <span>
                  BR mode: invoice renamed to <span className="font-mono tabular-nums">EC{(invoice.invoiceNumber || '').replace(/\D/g, '').slice(-2)}</span>
                  {(invoice.billToName || '').toUpperCase().includes('BEATRIZ') && ', Beatriz pricing fixed at $0.28/kg'}
                  {((invoice.billToName || '').toUpperCase().includes('PATEX') || (invoice.billToName || '').toUpperCase().includes('PATAMUTE')) && ', Patex price 50% off'}
                  , BOL excluded from email.
                </span>
              </div>
            )}
            {halfMode && !brMode && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-amber-500/5 border border-amber-500/20 text-[11px] text-amber-200/80">
                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                <span>50% discount applied to all unit prices in the generated PDFs.</span>
              </div>
            )}
          </div>

          <div className="border-t border-[#1f1f1f] px-5 py-3 flex items-center gap-3 bg-[#0a0a0a]">
            {/* BR + 50% toggles — match v1 modal footer */}
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-[12px]" title="Brazil mode">
              <input
                type="checkbox"
                checked={brMode}
                onChange={e => setBrMode(e.target.checked)}
                className="w-3.5 h-3.5 accent-emerald-600"
              />
              <span className="font-semibold text-emerald-400">BR</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-[12px]" title="50% off all unit prices">
              <input
                type="checkbox"
                checked={halfMode}
                onChange={e => setHalfMode(e.target.checked)}
                className="w-3.5 h-3.5 accent-amber-600"
              />
              <span className="font-semibold text-amber-400">50%</span>
            </label>

            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm" variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={sending}
                className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
              >
                Close
              </Button>
              <Button
                size="sm"
                onClick={emailSelected}
                disabled={selectedCount === 0 || sending}
                loading={sending}
                className="bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
              >
                {sending ? 'Sending…' : (<><Mail size={12} /> Email selected ({selectedCount})</>)}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
