// Phase 3B — Native Delivery Documents modal.
//
// Mirrors the v1 PLInvoiceEngine modal: shows 4 deliverables
// (Invoice, Packing List, Shipper's Letter of Instruction, Bill of
// Lading) with Preview + Download per row, checkboxes to select what
// to attach, and an Email button that opens a mail client with the
// selected attachments prompted as a list. Invoice uses the v2 native
// generator (`v2/services/pdf/invoicePdf.ts`); PL / SLI still hand off
// to v1 via the existing sessionStorage handshake until those
// generators are extracted in a follow-up.

import React, { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X as XIcon, FileText, Package, ClipboardList, Ship, Eye, Download, Loader2, Mail, Upload, AlertCircle } from 'lucide-react';
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
import { findCompany, PdfInvoice } from '../services/pdf/types';
import { EmailComposeDrawer, EmailDraft } from './EmailComposeDrawer';

interface Props {
  invoice: Invoice | null;
  onOpenChange: (open: boolean) => void;
}

const handoffToV1 = (invoiceId: string) => {
  try { sessionStorage.setItem('xs_pending_delivery_docs', invoiceId); }
  catch { /* noop */ }
  window.location.href = '/?v2=0';
};

const downloadDoc = (doc: any, filename: string) => {
  doc.save(filename);
};

const previewDoc = (doc: any, filename: string) => {
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  // Tag the URL so it doesn't leak if the tab closes before the
  // generator finishes painting — real cleanup happens on modal close.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  if (!win) {
    // Popups blocked → fall through to download.
    doc.save(filename);
  }
};

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

export const DeliveryDocsModal: React.FC<Props> = ({ invoice, onOpenChange }) => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const companies = useCompanies();
  const customers = useCustomers();
  const suppliers = useSuppliers();
  const products  = useProducts();
  const packingLists = usePackingLists();
  const bookings     = useBookings();
  const logos    = useCompanyImages('LOGO');

  // Selections + busy state
  const [selection, setSelection] = useState({ invoice: true, pl: false, sli: false, bol: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);

  useEffect(() => {
    if (!invoice) return;
    setSelection({ invoice: true, pl: false, sli: false, bol: false });
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

  const asPdfInvoice = (): PdfInvoice => ({
    ...invoice,
    incoterm: invoice.incoterm ?? undefined,
    date: invoice.invoiceDate ?? undefined,
  });

  const buildCtx = () => ({
    company,
    customers: customers.data ?? [],
    suppliers: suppliers.data ?? [],
    products:  products.data ?? [],
    packingLists: packingLists.data ?? [],
    bookings:  bookings.data ?? [],
    ports:     [],  // Ports not ported to v2 yet; POD name lookup falls back to code.
    logoUrl,
    stampUrl: null,
  });

  const doInvoicePreview = () => {
    setBusy('inv-preview');
    try {
      const doc = generateInvoicePdf(asPdfInvoice(), buildCtx(), false);
      previewDoc(doc, `Invoice_${invoice.invoiceNumber}.pdf`);
      toast.push({ kind: 'success', title: 'Invoice preview opened' });
    } catch (err) {
      toast.push({
        kind: 'error', title: 'Preview failed',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally { setBusy(null); }
  };

  const doInvoiceDownload = () => {
    setBusy('inv-dl');
    try {
      const doc = generateInvoicePdf(asPdfInvoice(), buildCtx(), false);
      downloadDoc(doc, `Invoice_${invoice.invoiceNumber}.pdf`);
      toast.push({ kind: 'success', title: 'Invoice downloaded' });
    } catch (err) {
      toast.push({
        kind: 'error', title: 'Download failed',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally { setBusy(null); }
  };

  const toV1 = () => {
    onOpenChange(false);
    handoffToV1(invoice.id);
  };

  const sendEmail = () => {
    const selectedCount = Object.values(selection).filter(Boolean).length;
    if (selectedCount === 0) {
      toast.push({ kind: 'warning', title: 'Select at least one document' });
      return;
    }
    const selectedDocs: string[] = [];
    if (selection.invoice) selectedDocs.push(`- Invoice ${invoice.invoiceNumber}.pdf`);
    if (selection.pl)      selectedDocs.push(`- Packing List ${invoice.plNumber ?? invoice.invoiceNumber}.pdf`);
    if (selection.sli)     selectedDocs.push(`- Shipper's Letter of Instruction.pdf`);
    if (selection.bol)     selectedDocs.push(`- Bill of Lading ${invoice.invoiceNumber}.pdf`);

    // Trigger invoice download so the user has it to attach.
    if (selection.invoice) {
      try {
        const doc = generateInvoicePdf(asPdfInvoice(), buildCtx(), false);
        downloadDoc(doc, `Invoice_${invoice.invoiceNumber}.pdf`);
      } catch { /* noop — email opens anyway */ }
    }

    setEmailDraft({
      to: '',
      subject: `Delivery Documents — Invoice ${invoice.invoiceNumber}`,
      body: [
        `Hello${invoice.billToName ? ' ' + invoice.billToName : ''},`,
        '',
        `Please find attached the delivery documents for invoice ${invoice.invoiceNumber}:`,
        '',
        ...selectedDocs,
        '',
        invoice.paymentTerms ? `Payment terms: ${invoice.paymentTerms}` : '',
        invoice.incoterm ? `Incoterm: ${invoice.incoterm}` : '',
        '',
        'Best regards',
      ].filter(Boolean).join('\n'),
      contextLabel: `Invoice ${invoice.invoiceNumber}`,
    });
  };

  const selectedCount = Object.values(selection).filter(Boolean).length;
  const invBolUrl = (invoice as any).bolUrl || (invoice as any).bolurl || null;

  return (
    <>
      <Dialog.Root open={!!invoice} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-[8%] -translate-x-1/2 z-50 w-[min(96vw,640px)] rounded-md border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_16px_48px_rgba(0,0,0,0.6)] flex flex-col max-h-[84vh]">
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
                subtitle={`#${invoice.invoiceNumber} · generated natively`}
              >
                <button
                  type="button"
                  onClick={doInvoicePreview}
                  disabled={busy !== null}
                  title="Preview"
                  className={iconBtn}
                >
                  {busy === 'inv-preview' ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
                </button>
                <button
                  type="button"
                  onClick={doInvoiceDownload}
                  disabled={busy !== null}
                  title="Download"
                  className={iconBtn}
                >
                  {busy === 'inv-dl' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                </button>
              </DocRow>

              {/* Packing List — v1 handoff */}
              <DocRow
                checked={selection.pl}
                onToggle={(v) => setSelection(s => ({ ...s, pl: v }))}
                icon={<Package size={14} />}
                title="Packing List"
                subtitle={invoice.plNumber ? `PL ${invoice.plNumber}` : 'Opens in v1 for PDF'}
              >
                <button
                  type="button"
                  onClick={toV1}
                  title="Open in v1"
                  className={iconBtn}
                >
                  <Eye size={13} />
                </button>
              </DocRow>

              {/* SLI — v1 handoff */}
              <DocRow
                checked={selection.sli}
                onToggle={(v) => setSelection(s => ({ ...s, sli: v }))}
                icon={<ClipboardList size={14} />}
                title="Shipper's Letter of Instruction"
                subtitle="Opens in v1 for PDF"
              >
                <button
                  type="button"
                  onClick={toV1}
                  title="Open in v1"
                  className={iconBtn}
                >
                  <Eye size={13} />
                </button>
              </DocRow>

              {/* BOL — stored or upload in v1 */}
              <DocRow
                checked={selection.bol}
                onToggle={(v) => setSelection(s => ({ ...s, bol: v }))}
                icon={<Ship size={14} />}
                title="Bill of Lading"
                subtitle={invBolUrl ? 'Uploaded' : 'Upload required'}
              >
                {invBolUrl ? (
                  <>
                    <button
                      type="button"
                      onClick={() => window.open(invBolUrl, '_blank', 'noopener,noreferrer')}
                      title="Open"
                      className={iconBtn}
                    >
                      <Eye size={13} />
                    </button>
                    <a
                      href={invBolUrl}
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
                    onClick={toV1}
                    title="Upload in v1"
                    className={iconBtn}
                  >
                    <Upload size={13} />
                  </button>
                )}
              </DocRow>

              <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-amber-500/5 border border-amber-500/20 text-[11px] text-amber-200/80">
                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                <span>
                  Invoice PDF generates natively in v2. Packing List / SLI / BOL
                  still hand off to v1 for PDF generation &mdash; they ship in a
                  follow-up pass.
                </span>
              </div>
            </div>

            <div className="border-t border-[#1f1f1f] px-5 py-3 flex items-center gap-2 bg-[#0a0a0a]">
              <button
                type="button"
                onClick={toV1}
                className="text-[11.5px] text-slate-500 hover:text-slate-200"
              >
                Open full v1 flow →
              </button>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  size="sm" variant="secondary"
                  onClick={() => onOpenChange(false)}
                  className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
                >
                  Close
                </Button>
                <Button
                  size="sm"
                  onClick={sendEmail}
                  disabled={selectedCount === 0}
                  className="bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
                >
                  <Mail size={12} /> Email selected ({selectedCount})
                </Button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <EmailComposeDrawer
        open={!!emailDraft}
        onOpenChange={(o) => !o && setEmailDraft(null)}
        draft={emailDraft}
      />
    </>
  );
};
