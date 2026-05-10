// Quick "view purchase order" preview dialog.
//
// Mirrors InvoicePreviewDialog: generates the PO PDF inline, renders
// it in an iframe, and offers Download + Email shortcuts. Surfaced
// from the Purchase Orders list's RowActions PDF icon.

import React, { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X as XIcon, Download, Loader2, Mail, AlertCircle } from 'lucide-react';
import { Button } from '../primitives/Button';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import { useCompanies } from '../queries/useCompanies';
import { useSuppliers } from '../queries/useSuppliers';
import { useCompanyImages } from '../queries/useCompanyImages';
import { PurchaseOrder } from '../queries/usePurchaseOrders';
import { generatePurchaseOrderPdf } from '../services/pdf/purchaseOrderPdf';
import { findCompany } from '../services/pdf/types';

interface Props {
  po: PurchaseOrder | null;
  onOpenChange: (open: boolean) => void;
  /** Optional — when provided, the "Email" shortcut hands off to the
   *  parent's existing EmailComposeDrawer flow. */
  onEmail?: (po: PurchaseOrder) => void;
}

export const PurchaseOrderPreviewDialog: React.FC<Props> = ({ po, onOpenChange, onEmail }) => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const companies = useCompanies();
  const suppliers = useSuppliers();
  const logos = useCompanyImages('LOGO');

  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const company = useMemo(
    () => findCompany(companies.data ?? [], currentCompanyId),
    [companies.data, currentCompanyId],
  );

  const supplier = useMemo(() => {
    if (!po) return null;
    const list = suppliers.data ?? [];
    if (po.supplierId) {
      const byId = list.find(s => s.id === po.supplierId);
      if (byId) return byId;
    }
    if (po.supplierName) {
      return list.find(s => s.name?.trim().toLowerCase() === po.supplierName.trim().toLowerCase()) ?? null;
    }
    return null;
  }, [po, suppliers.data]);

  const logoUrl = useMemo(() => {
    if (!logos.data || logos.data.length === 0) return null;
    const own = logos.data.find(i => i.companyId === currentCompanyId);
    return (own || logos.data[0]).url || null;
  }, [logos.data, currentCompanyId]);

  useEffect(() => {
    if (!po) {
      if (url) URL.revokeObjectURL(url);
      setUrl(null);
      setError(null);
      return;
    }
    setPending(true);
    try {
      const doc = generatePurchaseOrderPdf(po, { company, supplier, logoUrl });
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
  }, [po?.id, company?.id, supplier?.id, logoUrl]);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  if (!po) return null;

  const download = () => {
    try {
      const doc = generatePurchaseOrderPdf(po, { company, supplier, logoUrl });
      const safeId = po.id.replace(/[^a-zA-Z0-9_\-]/g, '_');
      doc.save(`PO_${safeId}.pdf`);
    } catch (err) {
      toast.push({ kind: 'error', title: 'Download failed', description: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleEmail = () => {
    onOpenChange(false);
    onEmail?.(po);
  };

  return (
    <Dialog.Root open={!!po} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[55] bg-black/70 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-[3%] -translate-x-1/2 z-[65] w-[min(96vw,960px)] h-[92vh] rounded-md border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_16px_48px_rgba(0,0,0,0.6)] flex flex-col">
          <div className="px-4 py-2.5 border-b border-[#1f1f1f] flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-[13.5px] font-semibold text-slate-100 truncate">
                Purchase Order {po.id.slice(0, 24)}
              </Dialog.Title>
              <Dialog.Description className="text-[11.5px] text-slate-500 truncate">
                {po.supplierName || '—'}
              </Dialog.Description>
            </div>
            {onEmail && (
              <Button
                size="sm" variant="secondary"
                onClick={handleEmail}
                className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
              >
                <Mail size={12} /> Email
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
                title={`Purchase Order ${po.id}`}
                className="w-full h-full bg-white"
              />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
