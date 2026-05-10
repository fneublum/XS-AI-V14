// Quick "view invoice" preview dialog.
//
// The Invoices list's View icon opens this instead of the edit drawer.
// Generates the Invoice PDF via v2/services/pdf/invoicePdf.ts, renders
// it inline in an iframe, and offers Download + Open-full-doc-set
// shortcuts so the user can jump to Delivery Docs without closing.

import React, { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X as XIcon, Download, Loader2, FileStack, AlertCircle } from 'lucide-react';
import { Button } from '../primitives/Button';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import { useCompanies } from '../queries/useCompanies';
import { useCustomers } from '../queries/useCustomers';
import { useSuppliers } from '../queries/useSuppliers';
import { useProducts } from '../queries/useProducts';
import { usePackingLists } from '../queries/usePackingLists';
import { useBookings } from '../queries/useBookings';
import { usePorts } from '../queries/usePorts';
import { useCompanyImages } from '../queries/useCompanyImages';
import { Invoice } from '../queries/useInvoices';
import { generateInvoicePdf } from '../services/pdf/invoicePdf';
import { findCompany, PdfInvoice, InvoicePdfCtx } from '../services/pdf/types';

interface Props {
  invoice: Invoice | null;
  onOpenChange: (open: boolean) => void;
  /** Optional — when provided, the "Delivery docs" shortcut opens the
   *  full DeliveryDocsModal in the parent. */
  onOpenDeliveryDocs?: (invoice: Invoice) => void;
}

const toPdfInvoice = (inv: Invoice): PdfInvoice => ({
  ...inv,
  incoterm: inv.incoterm ?? undefined,
  date: inv.invoiceDate ?? undefined,
} as PdfInvoice);

export const InvoicePreviewDialog: React.FC<Props> = ({ invoice, onOpenChange, onOpenDeliveryDocs }) => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const companies = useCompanies();
  const customers = useCustomers();
  const suppliers = useSuppliers();
  const products = useProducts();
  const packingLists = usePackingLists();
  const bookings = useBookings();
  const ports = usePorts();
  const logos = useCompanyImages('LOGO');

  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const company = useMemo(
    () => findCompany(companies.data ?? [], currentCompanyId),
    [companies.data, currentCompanyId],
  );
  const logoUrl = useMemo(() => {
    if (!logos.data || logos.data.length === 0) return null;
    const own = logos.data.find(i => i.companyId === currentCompanyId);
    return (own || logos.data[0]).url || null;
  }, [logos.data, currentCompanyId]);

  // Generate the PDF whenever the invoice changes. The heavy queries
  // (customers / products / etc.) usually arrive in <1s after mount;
  // regenerate the moment we have them so the preview isn't stuck on a
  // fallback rendering.
  useEffect(() => {
    if (!invoice) {
      if (url) URL.revokeObjectURL(url);
      setUrl(null);
      setError(null);
      return;
    }
    setPending(true);
    try {
      const ctx: InvoicePdfCtx = {
        company,
        customers: customers.data ?? [],
        suppliers: suppliers.data ?? [],
        products: products.data ?? [],
        packingLists: packingLists.data ?? [],
        bookings: bookings.data ?? [],
        ports: (ports.data ?? []).map(p => ({ id: p.id, code: p.code, name: p.name, country: p.country ?? undefined })),
        logoUrl,
        stampUrl: null,
      };
      const doc = generateInvoicePdf(toPdfInvoice(invoice), ctx, false);
      const blob = doc.output('blob');
      const next = URL.createObjectURL(blob);
      if (url) URL.revokeObjectURL(url);
      setUrl(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
    // `url` is intentionally excluded — we manage its lifecycle above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id, company?.id, logoUrl,
      customers.data, suppliers.data, products.data,
      packingLists.data, bookings.data, ports.data]);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  if (!invoice) return null;

  const download = () => {
    try {
      const ctx: InvoicePdfCtx = {
        company,
        customers: customers.data ?? [],
        suppliers: suppliers.data ?? [],
        products: products.data ?? [],
        packingLists: packingLists.data ?? [],
        bookings: bookings.data ?? [],
        ports: (ports.data ?? []).map(p => ({ id: p.id, code: p.code, name: p.name, country: p.country ?? undefined })),
        logoUrl,
        stampUrl: null,
      };
      const doc = generateInvoicePdf(toPdfInvoice(invoice), ctx, false);
      doc.save(`Invoice_${invoice.invoiceNumber || invoice.id}.pdf`);
    } catch (err) {
      toast.push({ kind: 'error', title: 'Download failed', description: err instanceof Error ? err.message : String(err) });
    }
  };

  const openDeliveryDocs = () => {
    onOpenChange(false);
    onOpenDeliveryDocs?.(invoice);
  };

  return (
    <Dialog.Root open={!!invoice} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[55] bg-black/70 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-[3%] -translate-x-1/2 z-[65] w-[min(96vw,960px)] h-[92vh] rounded-md border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_16px_48px_rgba(0,0,0,0.6)] flex flex-col">
          <div className="px-4 py-2.5 border-b border-[#1f1f1f] flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-[13.5px] font-semibold text-slate-100 truncate">
                Invoice {invoice.invoiceNumber}
              </Dialog.Title>
              <Dialog.Description className="text-[11.5px] text-slate-500 truncate">
                {invoice.billToName ?? invoice.soldTo ?? '—'}
              </Dialog.Description>
            </div>
            {onOpenDeliveryDocs && (
              <Button
                size="sm" variant="secondary"
                onClick={openDeliveryDocs}
                className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
              >
                <FileStack size={12} /> Delivery docs
              </Button>
            )}
            <Button
              size="sm"
              onClick={download}
              className="bg-indigo-600 text-white hover:bg-indigo-500"
            >
              <Download size={12} /> Download
            </Button>
            <Dialog.Close
              aria-label="Close"
              className="text-slate-500 hover:text-slate-100 transition-colors p-1 -m-1"
            >
              <XIcon size={14} />
            </Dialog.Close>
          </div>
          <div className="flex-1 min-h-0 bg-[#111111]">
            {error ? (
              <div className="h-full flex items-center justify-center text-center p-8">
                <div className="max-w-sm">
                  <AlertCircle size={28} className="mx-auto mb-3 text-red-400" />
                  <div className="text-[13px] font-medium text-slate-100 mb-1">Couldn't generate preview</div>
                  <div className="text-[11.5px] text-slate-500">{error}</div>
                </div>
              </div>
            ) : pending || !url ? (
              <div className="h-full flex items-center justify-center text-slate-500 text-[12px]">
                <Loader2 size={14} className="animate-spin mr-2" /> Rendering PDF…
              </div>
            ) : (
              <iframe
                src={url}
                title={`Invoice ${invoice.invoiceNumber}`}
                className="w-full h-full bg-white"
              />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
