// Phase 3B — Proforma documents modal for Sales Orders.
//
// Mirrors the v1 Sales Orders doc flow: Preview / Download / Email
// the proforma PDF for a selected sales order. Shares the email
// preview pattern from DeliveryDocsModal so attachments flow through
// the MSAL / Gmail-backed sendEmail instead of falling back to
// browser downloads.

import React, { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  X as XIcon, FileText, Eye, Download, Loader2, Mail, Send,
} from 'lucide-react';
import { useToast } from '../primitives/Toast';
import { Button } from '../primitives/Button';
import { useCompany } from '../providers/CompanyProvider';
import { useCompanies } from '../queries/useCompanies';
import { useCustomers } from '../queries/useCustomers';
import { useBookings } from '../queries/useBookings';
import { useCompanyImages } from '../queries/useCompanyImages';
import { useSupabaseQuery } from '../queries/useSupabaseQuery';
import { getSupabaseClient } from '../../services/supabase';
import { SalesOrder } from '../queries/useSalesOrders';
import {
  generateProformaPdf, ProformaOrder, PdfBank,
} from '../services/pdf/proformaPdf';
import { findCompany } from '../services/pdf/types';
import { sendEmail } from '../../services/emailService';
import { resolveRecipientsSync, joinRecipients } from '../services/recipients';

interface Props {
  order: SalesOrder | null;
  onOpenChange: (open: boolean) => void;
  /**
   * When set, skip the "Proforma Documents" list modal and jump
   * straight to the target flow as soon as the PDF is built:
   *   - 'preview' → inline iframe preview
   *   - 'email'   → email preview draft
   * The outer list modal stays hidden in this mode.
   */
  autoAction?: 'preview' | 'email';
}

const docToBlobUrl = (doc: any): string => {
  const blob = doc.output('blob');
  return URL.createObjectURL(blob);
};

const downloadDoc = (doc: any, filename: string) => doc.save(filename);

const docToBase64 = (doc: any): string =>
  doc.output('datauristring').split(',')[1];

const toProformaOrder = (so: SalesOrder): ProformaOrder => ({
  id:               so.id,
  companyId:        so.companyId,
  orderNumber:      so.orderNumber,
  orderDate:        so.orderDate,
  createdAt:        so.createdAt,
  customerId:       so.customerId,
  customerName:     so.customerName,
  notifyPartyId:    so.notifyPartyId,
  notifyPartyName:  so.notifyPartyName,
  deliveryAddress:  so.deliveryAddress,
  deliveryDate:     so.deliveryDate,
  paymentTerms:     so.paymentTerms,
  incoterm:         so.incoterm,
  pod:              so.pod,
  bankId:           so.bankId,
  items: (so.items ?? []).map(i => ({
    productName:        (i as { productName?: string }).productName ?? '',
    customerDescription: (i as { customerDescription?: string }).customerDescription ?? null,
    hsCode:             (i as { hsCode?: string }).hsCode ?? null,
    quantity:           Number((i as { quantity?: unknown }).quantity) || 0,
    unitPrice:          Number((i as { unitPrice?: unknown }).unitPrice) || 0,
  })),
});

function useBanks() {
  return useSupabaseQuery<PdfBank[]>(['banks'], async () => {
    const sb = getSupabaseClient();
    const { data, error } = await sb.from('banks').select('*').limit(200);
    if (error) throw new Error(error.message);
    return (data as unknown as PdfBank[] | null) ?? [];
  });
}

const iconBtn =
  'p-1.5 rounded-sm text-slate-500 hover:text-slate-100 hover:bg-[#161616] ' +
  'transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

export const ProformaDocsModal: React.FC<Props> = ({ order, onOpenChange, autoAction }) => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const companies = useCompanies();
  const customers = useCustomers();
  const bookings  = useBookings();
  const banks     = useBanks();
  const logos     = useCompanyImages('LOGO');

  // Stamp — v1 fetches /public/ec4_stamp.png once and converts to a
  // data URL so jsPDF can embed it without a CORS dance. Same here.
  const [stampUrl, setStampUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch('/ec4_stamp.png');
        if (!resp.ok) return;
        const blob = await resp.blob();
        const reader = new FileReader();
        reader.onload = () => {
          if (!cancelled) setStampUrl(reader.result as string);
        };
        reader.readAsDataURL(blob);
      } catch { /* no stamp */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const [busy, setBusy] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Email preview draft.
  interface Attachment { name: string; contentBytes: string; contentType: string }
  interface EmailDraft { to: string; cc: string; subject: string; htmlBody: string; attachments: Attachment[] }
  const [emailDraft, setEmailDraft] = useState<EmailDraft>({
    to: '', cc: '', subject: '', htmlBody: '', attachments: [],
  });
  const [emailPreviewOpen, setEmailPreviewOpen] = useState(false);

  useEffect(() => {
    if (!order) return;
    setBusy(null);
  }, [order?.id]);

  const company = useMemo(
    () => findCompany(companies.data ?? [], currentCompanyId),
    [companies.data, currentCompanyId],
  );

  const logoUrl = useMemo(() => {
    if (!logos.data || logos.data.length === 0) return null;
    const own = logos.data.find(i => i.companyId === currentCompanyId);
    return (own || logos.data[0]).url || null;
  }, [logos.data, currentCompanyId]);

  // Cleanup blob URL when the outer modal closes.
  useEffect(() => {
    if (!order && previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  }, [order, previewUrl]);

  // Auto-run preview or email flow when the parent passes
  // `autoAction`. Guard with a ref so we only fire once per order.
  const autoFiredRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (!order || !autoAction) {
      autoFiredRef.current = null;
      return;
    }
    if (autoFiredRef.current === order.id) return;
    autoFiredRef.current = order.id;
    // Defer one tick so the rest of the effects (logos, banks, etc.)
    // have a chance to populate before the PDF is built.
    const t = setTimeout(() => {
      if (autoAction === 'preview') {
        try {
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          const doc = generateProformaPdf(toProformaOrder(order), {
            company,
            customers: customers.data ?? [],
            bookings:  bookings.data  ?? [],
            banks:     banks.data     ?? [],
            logoUrl, stampUrl,
          });
          setPreviewUrl(docToBlobUrl(doc));
        } catch (err) {
          toast.push({
            kind: 'error',
            title: 'Proforma preview failed',
            description: err instanceof Error ? err.message : String(err),
          });
        }
      } else if (autoAction === 'email') {
        // prepareEmail is defined below — call via microtask wrapper.
        // Build the email draft + open the preview inline.
        try {
          const doc = generateProformaPdf(toProformaOrder(order), {
            company,
            customers: customers.data ?? [],
            bookings:  bookings.data  ?? [],
            banks:     banks.data     ?? [],
            logoUrl, stampUrl,
          });
          const filename = `Proforma_${order.orderNumber}.pdf`;
          const attachments = [{
            name: filename,
            contentBytes: docToBase64(doc),
            contentType: 'application/pdf',
          }];
          const recipients = resolveRecipientsSync({
            actors: [{ customerId: order.customerId, customerName: order.customerName }],
            customers: customers.data ?? [],
          });
          const joined = joinRecipients(recipients);
          const companyName = company?.name || 'EC4 Enterprises';
          const subject = `Proforma Invoice #${order.orderNumber} - ${order.customerName}`;
          const body = [
            `Dear ${order.customerName},`, '',
            'Please find attached the Proforma Invoice for the following order:', '',
            `• Order #: ${order.orderNumber}`,
            order.incoterm    ? `• Incoterm: ${order.incoterm}${order.pod ? ' ' + order.pod : ''}` : '',
            order.paymentTerms ? `• Payment terms: ${order.paymentTerms}` : '',
            order.deliveryDate ? `• Shipping date: ${order.deliveryDate}` : '',
            `• Total: $${Number(order.totalAmount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            '', 'Please review and confirm.', '',
            'Best regards,', companyName,
          ].filter(Boolean).join('\n');
          setEmailDraft({
            to: joined.to,
            cc: joined.cc,
            subject, htmlBody: body, attachments,
          });
          setEmailPreviewOpen(true);
        } catch (err) {
          toast.push({
            kind: 'error',
            title: 'Email draft build failed',
            description: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }, 20);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, autoAction, company, logoUrl, stampUrl,
      customers.data, bookings.data, banks.data]);

  if (!order) return null;

  const buildDoc = () => generateProformaPdf(toProformaOrder(order), {
    company,
    customers: customers.data ?? [],
    bookings:  bookings.data  ?? [],
    banks:     banks.data     ?? [],
    logoUrl, stampUrl,
  });

  const runAction = (action: 'preview' | 'download') => {
    const filename = `Proforma_${order.orderNumber}.pdf`;
    setBusy(action);
    try {
      const doc = buildDoc();
      if (action === 'preview') {
        // In-app iframe preview — matches v1 behavior and bypasses
        // browser PDF auto-download on blob URLs opened in new tabs.
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(docToBlobUrl(doc));
      } else {
        downloadDoc(doc, filename);
      }
    } catch (err) {
      toast.push({
        kind: 'error',
        title: `Proforma ${action} failed`,
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  };

  const prepareEmail = () => {
    try {
      const doc = buildDoc();
      const filename = `Proforma_${order.orderNumber}.pdf`;
      const attachments: Attachment[] = [{
        name: filename,
        contentBytes: docToBase64(doc),
        contentType: 'application/pdf',
      }];

      const recipients = resolveRecipientsSync({
        actors: [{ customerId: order.customerId, customerName: order.customerName }],
        customers: customers.data ?? [],
      });
      const joined = joinRecipients(recipients);
      const companyName = company?.name || 'EC4 Enterprises';

      const subject = `Proforma Invoice #${order.orderNumber} - ${order.customerName}`;
      const body = [
        `Dear ${order.customerName},`,
        '',
        'Please find attached the Proforma Invoice for the following order:',
        '',
        `• Order #: ${order.orderNumber}`,
        order.incoterm ? `• Incoterm: ${order.incoterm}${order.pod ? ' ' + order.pod : ''}` : '',
        order.paymentTerms ? `• Payment terms: ${order.paymentTerms}` : '',
        order.deliveryDate ? `• Shipping date: ${order.deliveryDate}` : '',
        `• Total: $${Number(order.totalAmount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        '',
        'Please review and confirm.',
        '',
        'Best regards,',
        companyName,
      ].filter(Boolean).join('\n');

      setEmailDraft({
        to: joined.to,
        cc: joined.cc,
        subject, htmlBody: body, attachments,
      });
      setEmailPreviewOpen(true);
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Email draft build failed',
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const sendEmailFromPreview = async () => {
    if (!emailDraft.to.trim()) {
      toast.push({ kind: 'warning', title: 'Recipient required' });
      return;
    }
    setSending(true);
    try {
      const toList = emailDraft.to.split(/[;,]/).map(e => e.trim()).filter(Boolean);
      const ccList = emailDraft.cc.split(/[;,]/).map(e => e.trim()).filter(Boolean);
      const escaped = emailDraft.htmlBody.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const htmlBody = `<div style="font-family: Arial, sans-serif; max-width: 640px; white-space: pre-wrap; color:#0f172a; line-height:1.6;">${escaped}</div>`;

      const result = await sendEmail({
        to: toList,
        cc: ccList.length > 0 ? ccList : undefined,
        subject: emailDraft.subject,
        htmlBody,
        attachments: emailDraft.attachments,
      });

      if (result.success) {
        toast.push({
          kind: 'success',
          title: `Sent via ${result.provider}`,
          description: toList.join(', '),
        });
        setEmailPreviewOpen(false);
        setTimeout(() => onOpenChange(false), 400);
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

  // When autoAction is set we suppress the outer list modal and let
  // the iframe / email preview dialogs drive visibility. Closing any
  // inner dialog bubbles up via onOpenChange.
  const showListModal = !!order && !autoAction;

  return (
    <>
      <Dialog.Root open={showListModal} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-[8%] -translate-x-1/2 z-50 w-[min(96vw,540px)] rounded-md border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_16px_48px_rgba(0,0,0,0.6)] flex flex-col max-h-[80vh]">
          <div className="px-5 py-4 border-b border-[#1f1f1f] flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-[14px] font-semibold text-slate-100 truncate">
                Proforma Documents
              </Dialog.Title>
              <Dialog.Description className="text-[12px] text-slate-500 mt-0.5 truncate">
                {order.orderNumber} · {order.customerName}
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close"
              className="text-slate-500 hover:text-slate-100 transition-colors p-1 -m-1"
            >
              <XIcon size={14} />
            </Dialog.Close>
          </div>

          <div className="px-5 py-4 space-y-2">
            <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="text-indigo-300 shrink-0"><FileText size={14} /></div>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium text-slate-100">Proforma Invoice</div>
                  <div className="text-[11px] text-slate-500 truncate">
                    EC4 Enterprises layout · line items + bank info + signatures
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => runAction('preview')}
                  disabled={busy !== null || sending}
                  title="Preview"
                  className={iconBtn}
                >
                  {busy === 'preview' ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
                </button>
                <button
                  type="button"
                  onClick={() => runAction('download')}
                  disabled={busy !== null || sending}
                  title="Download"
                  className={iconBtn}
                >
                  {busy === 'download' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                </button>
              </div>
            </div>
          </div>

          <div className="border-t border-[#1f1f1f] px-5 py-3 flex items-center gap-2 justify-end">
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
              onClick={prepareEmail}
              disabled={sending || busy !== null}
              className="bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
            >
              <Mail size={12} /> Email Proforma
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>

      {/* PDF preview — inline iframe so the browser never auto-
          downloads what the user wanted to preview. */}
      <Dialog.Root
        open={!!previewUrl}
        onOpenChange={(o) => {
          if (!o && previewUrl) {
            URL.revokeObjectURL(previewUrl);
            setPreviewUrl(null);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[55] bg-black/70 backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-[3%] -translate-x-1/2 z-[65] w-[min(96vw,960px)] h-[92vh] rounded-md border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_16px_48px_rgba(0,0,0,0.6)] flex flex-col">
            <div className="px-4 py-2.5 border-b border-[#1f1f1f] flex items-center gap-2">
              <FileText size={13} className="text-indigo-300 shrink-0" />
              <Dialog.Title className="text-[13px] font-semibold text-slate-100 truncate">
                Proforma_{order.orderNumber}.pdf
              </Dialog.Title>
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => runAction('download')}
                  title="Download"
                  className={iconBtn}
                >
                  <Download size={13} />
                </button>
                <Dialog.Close
                  aria-label="Close preview"
                  className={iconBtn}
                >
                  <XIcon size={13} />
                </Dialog.Close>
              </div>
            </div>
            {previewUrl && (
              <iframe
                src={previewUrl}
                title="Proforma preview"
                className="flex-1 w-full bg-white rounded-b-md"
              />
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Email preview */}
      <Dialog.Root open={emailPreviewOpen} onOpenChange={setEmailPreviewOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-[6%] -translate-x-1/2 z-[70] w-[min(96vw,720px)] rounded-md border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_16px_48px_rgba(0,0,0,0.6)] flex flex-col max-h-[86vh]">
            <div className="px-5 py-4 border-b border-[#1f1f1f] flex items-start gap-3">
              <div className="p-1.5 rounded-md bg-indigo-600/10 text-indigo-300">
                <Mail size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <Dialog.Title className="text-[14px] font-semibold text-slate-100">
                  Email preview
                </Dialog.Title>
                <Dialog.Description className="text-[12px] text-slate-500 mt-0.5">
                  Review and send — routes through your signed-in Outlook or Gmail. Proforma PDF attached.
                </Dialog.Description>
              </div>
              <Dialog.Close
                aria-label="Close"
                className="text-slate-500 hover:text-slate-100 transition-colors p-1 -m-1"
              >
                <XIcon size={14} />
              </Dialog.Close>
            </div>

            <div className="px-5 py-4 overflow-y-auto space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium block mb-1">To</label>
                <input
                  type="text"
                  value={emailDraft.to}
                  onChange={e => setEmailDraft(d => ({ ...d, to: e.target.value }))}
                  placeholder="recipient@example.com"
                  className="w-full px-2.5 py-1.5 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] rounded-md text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium block mb-1">CC</label>
                <input
                  type="text"
                  value={emailDraft.cc}
                  onChange={e => setEmailDraft(d => ({ ...d, cc: e.target.value }))}
                  placeholder="Optional — comma or semicolon separated"
                  className="w-full px-2.5 py-1.5 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] rounded-md text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium block mb-1">Subject</label>
                <input
                  type="text"
                  value={emailDraft.subject}
                  onChange={e => setEmailDraft(d => ({ ...d, subject: e.target.value }))}
                  className="w-full px-2.5 py-1.5 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] rounded-md text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium block mb-1">Message</label>
                <textarea
                  value={emailDraft.htmlBody}
                  onChange={e => setEmailDraft(d => ({ ...d, htmlBody: e.target.value }))}
                  rows={10}
                  className="w-full px-2.5 py-1.5 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] rounded-md text-slate-200 focus:outline-none focus:border-indigo-500 resize-y"
                />
              </div>
              {emailDraft.attachments.length > 0 && (
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium block mb-1">
                    Attachments ({emailDraft.attachments.length})
                  </label>
                  <div className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] divide-y divide-[#1f1f1f]">
                    {emailDraft.attachments.map((att, idx) => (
                      <div key={idx} className="flex items-center gap-2 px-3 py-2 text-[11.5px]">
                        <FileText size={12} className="text-indigo-300 shrink-0" />
                        <span className="font-mono truncate text-slate-200">{att.name}</span>
                        <span className="ml-auto text-slate-500 tabular-nums">
                          {Math.round(att.contentBytes.length * 0.75 / 1024)} KB
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-[#1f1f1f] flex items-center gap-2 justify-end">
              <Dialog.Close className="px-3 py-1.5 text-[12px] text-slate-400 hover:text-slate-100 rounded-md hover:bg-[#141414] transition-colors">
                Cancel
              </Dialog.Close>
              <Button
                size="sm"
                onClick={sendEmailFromPreview}
                disabled={sending || !emailDraft.to.trim()}
                loading={sending}
                className="bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40 h-7 px-3 text-[12px] font-medium rounded-md"
              >
                {sending ? 'Sending…' : <><Send size={12} /> Send email</>}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      </Dialog.Root>
    </>
  );
};
