// Phase 3B — Native Delivery Documents modal.
//
// Mirrors v1's PLInvoiceEngine Documents Modal. Invoice / Packing List
// / SLI generate natively via v2/services/pdf/. BOL is stored as a
// data-URL on the invoice row; native upload via the BOL row's
// Upload button (no more v1 handoff).
//
// BR and 50% checkboxes in the footer adjust the PDF prices exactly
// the way v1's "BR" mode + Patex 50% override do — see
// v2/services/pdf/priceAdjust.ts. Email Selected composes an email
// through v1's shared `services/emailService.sendEmail` so attachments
// actually land in the recipient's inbox (Outlook via MSAL or Gmail
// via Google Identity — whichever is connected in Settings).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  X as XIcon, FileText, Package, ClipboardList, Ship, BadgeCheck,
  Eye, Download, Loader2, Mail, Upload, AlertCircle, CheckCircle2,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '../primitives/Toast';
import { Button } from '../primitives/Button';
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
import { getSupabaseClient } from '../../services/supabase';
import { generateInvoicePdf } from '../services/pdf/invoicePdf';
import { generatePackingListPdf } from '../services/pdf/packingListPdf';
import { generateSliPdf } from '../services/pdf/sliPdf';
import { generateCooPdf } from '../services/pdf/cooPdf';
import { applyAdjustments } from '../services/pdf/priceAdjust';
import { findCompany, PdfInvoice, InvoicePdfCtx, PdfBankRow } from '../services/pdf/types';
import { isEc4Company } from '../services/pdf/isEc4Company';
import { useSupabaseQuery } from '../queries/useSupabaseQuery';
import { sendEmail } from '../../services/emailService';
import { resolveRecipients, joinRecipients } from '../services/recipients';
import { Send } from 'lucide-react';
import { GoogleGenAI } from '../../services/geminiClient';

// Focused prompt — we only need the BL number, no other extraction.
const BL_OCR_PROMPT = `From this BILL OF LADING document, extract the
BL number (also labelled "B/L No.", "Bill of Lading Number", or
similar). Return JSON with ONE key:

{ "blNumber": string | null }

The number is usually a carrier prefix + digits (e.g. MAEU1234567,
MEDU8675309, HNCGL260020). Drop spaces and punctuation. Return null
if you can't find it. Return ONLY valid JSON, no markdown fences.`;

/**
 * Best-effort Gemini extraction for the BL number from a freshly
 * uploaded BOL file. Returns null on any error so the upload itself
 * never fails because of OCR — the BL number is a nice-to-have that
 * the user can edit later.
 */
async function extractBlNumberFromFile(file: File): Promise<string | null> {
  try {
    const ai = new GoogleGenAI({ apiKey: 'proxy' });
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(file);
    });
    const base64 = dataUrl.split(',')[1] ?? '';
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{
        role: 'user',
        parts: [
          { text: BL_OCR_PROMPT },
          { inlineData: { mimeType: file.type || 'application/pdf', data: base64 } },
        ],
      }],
      config: { responseMimeType: 'application/json', temperature: 0 },
    });
    const text = (result as { text?: string }).text ?? '';
    if (!text) return null;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      const stripped = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '');
      parsed = JSON.parse(stripped);
    }
    const raw = parsed.blNumber;
    if (typeof raw !== 'string') return null;
    const cleaned = raw.replace(/\s+/g, '').trim();
    return cleaned.length > 0 ? cleaned : null;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[DeliveryDocsModal] BL OCR failed:', e);
    return null;
  }
}

interface Props {
  invoice: Invoice | null;
  onOpenChange: (open: boolean) => void;
  /** Pre-select which documents should ship. Defaults to invoice only. */
  initialSelection?: { invoice?: boolean; pl?: boolean; sli?: boolean; bol?: boolean };
  /** When true, auto-open the email preview on mount so the invoice
   *  drawer's Email action lands directly in the compose step. */
  autoEmail?: boolean;
}

const toPdfInvoice = (inv: Invoice): PdfInvoice => ({
  ...inv,
  incoterm: inv.incoterm ?? undefined,
  date: inv.invoiceDate ?? undefined,
} as PdfInvoice);

const docToBlobUrl = (doc: any): string => {
  const blob = doc.output('blob');
  return URL.createObjectURL(blob);
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

// Accepted MIME types for BOL upload. PDF is the primary, images
// supported for phone-camera scans (matches v1 behavior, which accepted
// any file).
const BOL_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';
// Hard cap (5 MB). The data URL is stored inline in the `bolUrl` text
// column on `invoices`, so a stray multi-megabyte scan would bloat
// every query that selects the row. v1 had no cap and we've seen 20 MB
// uploads choke the email composer — enforce here instead.
const BOL_MAX_BYTES = 5 * 1024 * 1024;

export const DeliveryDocsModal: React.FC<Props> = ({ invoice, onOpenChange, initialSelection, autoEmail }) => {
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
  const banks = useSupabaseQuery<PdfBankRow[]>(
    ['banks', 'invoice-ctx'],
    async () => {
      const { data, error } = await getSupabaseClient().from('banks').select('*').limit(500);
      if (error) throw new Error(error.message);
      return (data as PdfBankRow[] | null) ?? [];
    },
  );

  const [selection, setSelection] = useState({
    invoice: initialSelection?.invoice ?? true,
    pl: initialSelection?.pl ?? false,
    sli: initialSelection?.sli ?? false,
    bol: initialSelection?.bol ?? false,
    coo: (initialSelection as any)?.coo ?? false,
  });
  const [brMode, setBrMode] = useState(false);
  const [halfMode, setHalfMode] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFilename, setPreviewFilename] = useState<string>('');

  // Email preview state — mirrors v1 PLInvoiceEngine so the user can
  // review To / CC / Subject / Body + see attachments before sending.
  interface Attachment { name: string; contentBytes: string; contentType: string }
  interface EmailDraft { to: string; cc: string; subject: string; htmlBody: string; attachments: Attachment[] }
  const [emailDraft, setEmailDraft] = useState<EmailDraft>({
    to: '', cc: '', subject: '', htmlBody: '', attachments: [],
  });
  const [emailPreviewOpen, setEmailPreviewOpen] = useState(false);

  // BOL native upload — replaces the legacy v1 handoff. Files are read
  // as data URLs and persisted to invoices.bolUrl, matching v1's
  // storage shape so existing readers (PDF email composer, drawer
  // preview) keep working.
  const queryClient = useQueryClient();
  const bolFileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingBol, setUploadingBol] = useState(false);
  // Local override for the just-uploaded URL. Lets the modal reflect the
  // new BOL immediately while the React Query cache refetches; cleared
  // when the modal opens against a different invoice.
  const [pendingBolUrl, setPendingBolUrl] = useState<string | null>(null);

  // Load the EC4 stamp once so jsPDF can embed it in the signed docs.
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

  useEffect(() => {
    if (!invoice) return;
    setSelection({
      invoice: initialSelection?.invoice ?? true,
      pl: initialSelection?.pl ?? false,
      sli: initialSelection?.sli ?? false,
      bol: initialSelection?.bol ?? false,
      coo: (initialSelection as any)?.coo ?? false,
    });
    setBrMode(false);
    setHalfMode(false);
    setPendingBolUrl(null);
  }, [invoice?.id]);

  // Native BOL upload. Reads the picked file as a data URL, persists
  // it to invoices.bolUrl, then invalidates the invoice list so the
  // drawer + downstream queries pick up the change.
  const handleBolUpload = async (file: File): Promise<void> => {
    if (!invoice) return;
    if (file.size > BOL_MAX_BYTES) {
      toast.push({
        kind: 'warning',
        title: 'BOL too large',
        description: `${(file.size / 1024 / 1024).toFixed(1)} MB exceeds the 5 MB limit.`,
      });
      return;
    }
    setUploadingBol(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('invoices')
        .update({ bolUrl: dataUrl })
        .eq('id', invoice.id);
      if (error) {
        toast.push({
          kind: 'error',
          title: 'Failed to save BOL',
          description: error.message,
        });
        return;
      }
      // Reflect locally so the row flips to "Uploaded" instantly, even
      // before React Query refetches the invoice list.
      setPendingBolUrl(dataUrl);
      // Refetch the invoice list so the parent drawer / table sees the
      // new bolUrl. The wildcard `['invoices']` matches every query key
      // shape `[invoices, companyId, search]`.
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.push({ kind: 'success', title: 'BOL uploaded' });

      // ─── Background OCR: extract the BL number ───────────────
      // Fire-and-forget so the upload's success toast lands first.
      // The follow-up toast either confirms the BL number was saved
      // or stays silent on failure (the user can edit later). Only
      // writes when (a) the OCR succeeded AND (b) the invoice doesn't
      // already have a BL on file — we never overwrite a value the
      // user typed manually.
      void (async () => {
        const blNumber = await extractBlNumberFromFile(file);
        if (!blNumber) return;
        const currentBl = ((invoice as { bl?: string | null }).bl ?? '').trim();
        if (currentBl && currentBl !== (invoice.bookingNumber ?? '').trim()) {
          // Already has a real BL set; don't overwrite.
          return;
        }
        const sb = getSupabaseClient();
        const { error: blErr } = await sb
          .from('invoices')
          .update({ bl: blNumber })
          .eq('id', invoice.id);
        if (blErr) {
          // eslint-disable-next-line no-console
          console.warn('[DeliveryDocsModal] save BL failed:', blErr);
          return;
        }
        await queryClient.invalidateQueries({ queryKey: ['invoices'] });
        toast.push({
          kind: 'success',
          title: 'BL number extracted',
          description: blNumber,
        });
      })();
    } catch (e: any) {
      toast.push({
        kind: 'error',
        title: 'BOL upload failed',
        description: e?.message ?? 'unknown error',
      });
    } finally {
      setUploadingBol(false);
      // Reset the input so re-uploading the same filename triggers
      // onChange again (browsers swallow the event otherwise).
      if (bolFileInputRef.current) bolFileInputRef.current.value = '';
    }
  };

  const company = useMemo(
    () => findCompany(companies.data ?? [], currentCompanyId),
    [companies.data, currentCompanyId],
  );

  const logoUrl = useMemo(() => {
    if (!logos.data || logos.data.length === 0) return null;
    const own = logos.data.find(i => i.companyId === currentCompanyId);
    return (own || logos.data[0]).url || null;
  }, [logos.data, currentCompanyId]);

  // Revoke the blob URL when the outer modal closes. MUST live above
  // the early-return to keep hook order stable across renders.
  useEffect(() => {
    if (!invoice && previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  }, [invoice, previewUrl]);

  // When the parent opens the modal with `autoEmail`, jump straight to
  // the email preview instead of waiting for the user to click "Email
  // selected". Fires once per invoice open, after customers have loaded
  // so the recipient / broker CC come through populated.
  const emailSelectedRef = useRef<() => Promise<void>>();
  const autoFiredRef = useRef(false);
  useEffect(() => {
    if (!invoice) { autoFiredRef.current = false; return; }
    if (!autoEmail) return;
    if (autoFiredRef.current) return;
    if (!customers.data) return;
    autoFiredRef.current = true;
    const t = setTimeout(() => { emailSelectedRef.current?.(); }, 0);
    return () => clearTimeout(t);
  }, [autoEmail, invoice?.id, customers.data]);

  if (!invoice) return null;

  // Lazy stamp fetch — if the mount effect hasn't populated `stampUrl`
  // by the time the user clicks Preview / Download (e.g. a fast click
  // on a slow connection), fetch it synchronously so the stamp never
  // silently drops.
  const ensureStamp = async (): Promise<string | null> => {
    if (stampUrl) return stampUrl;
    try {
      const resp = await fetch('/ec4_stamp.png', { cache: 'force-cache' });
      if (!resp.ok) {
        // eslint-disable-next-line no-console
        console.warn('[DeliveryDocsModal] stamp fetch non-200:', resp.status);
        return null;
      }
      const blob = await resp.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('stamp read failed'));
        reader.readAsDataURL(blob);
      });
      setStampUrl(dataUrl);
      return dataUrl;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[DeliveryDocsModal] stamp fetch error:', e);
      return null;
    }
  };

  const buildCtx = (overrideStamp?: string | null): InvoicePdfCtx => ({
    company,
    customers: customers.data ?? [],
    suppliers: suppliers.data ?? [],
    products: products.data ?? [],
    packingLists: packingLists.data ?? [],
    bookings: bookings.data ?? [],
    ports: (ports.data ?? []).map(p => ({ id: p.id, code: p.code, name: p.name, country: p.country ?? undefined })),
    banks: banks.data ?? [],
    logoUrl,
    stampUrl: isEc4Company(company) ? (overrideStamp ?? stampUrl) : null,
    brMode,
  });

  const adjustedInvoice = (): PdfInvoice =>
    applyAdjustments(toPdfInvoice(invoice), { brMode, halfMode });

  // ─── Preview / Download handlers ─────────────────────────────
  const docFactory = async (kind: 'invoice' | 'pl' | 'sli' | 'coo') => {
    const inv = adjustedInvoice();
    const stamp = await ensureStamp();
    const ctx = buildCtx(stamp);
    if (kind === 'invoice') return generateInvoicePdf(inv, ctx, false);
    if (kind === 'pl')      return generatePackingListPdf(inv, ctx, false);
    if (kind === 'coo')     return generateCooPdf(inv, ctx, false);
    return generateSliPdf(inv, ctx, false);
  };

  const runAction = async (
    kind: 'invoice' | 'pl' | 'sli' | 'coo',
    action: 'preview' | 'download',
    filename: string,
  ) => {
    const key = `${kind}-${action}`;
    setBusy(key);
    try {
      const doc = await docFactory(kind);
      if (action === 'preview') {
        // Inline iframe preview — avoids browser PDF auto-download.
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(docToBlobUrl(doc));
        setPreviewFilename(filename);
      } else {
        downloadDoc(doc, filename);
      }
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

  // ─── Email selected — build attachments + open preview modal
  // Mirror v1 PLInvoiceEngine: build a draft, open a review UI with
  // editable To / CC / Subject / Body + attachment list. Nothing is
  // sent until the user hits Send in the preview.
  const emailSelected = async () => {
    const selectedCount = Object.values(selection).filter(Boolean).length;
    if (selectedCount === 0) {
      toast.push({ kind: 'warning', title: 'Select at least one document' });
      return;
    }
    try {
      const inv = adjustedInvoice();
      const stamp = await ensureStamp();
      const ctx = buildCtx(stamp);
      const attachments: Attachment[] = [];

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
      if (selection.coo) {
        const doc = generateCooPdf(inv, ctx, false);
        attachments.push({
          name: `CertificateOfOrigin_${invoice.invoiceNumber || 'unknown'}.pdf`,
          contentBytes: docToBase64(doc),
          contentType: 'application/pdf',
        });
      }
      // BOL data-URL fallback, skipped in BR mode to match v1.
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

      // Invoice drawer labels these as "Consignee (Sold to)" and
      // "Notify (Bill to)". The unified resolver matches each name to
      // a customer row and merges TO/CC with cargo-agent CC auto-lookup.
      const recipients = await resolveRecipients({
        actors: [
          { customerName: invoice.billToName ?? null, role: 'primary' },
          { customerName: invoice.soldTo    ?? null, role: 'secondary' },
          { customerName: invoice.consignee ?? null, role: 'secondary' },
        ],
        bookingNumber: invoice.bookingNumber || invoice.transportRef || null,
        includeBroker: true,
        customers: customers.data ?? [],
      });
      const joined = joinRecipients(recipients);
      const toAddress = joined.to;
      const ccAddress = joined.cc;
      const primaryCustomer = (customers.data ?? []).find(c =>
        recipients.audit.matchedCustomerIds.includes(c.id),
      );
      const companyName = company?.name || 'X-Solution';

      const bookingTag = invoice.bookingNumber ? `Booking #${invoice.bookingNumber} - ` : '';
      const subject = brMode
        ? `BR Documents - ${bookingTag}Invoice #${inv.invoiceNumber}`
        : `Shipping Documents - ${bookingTag}Invoice #${invoice.invoiceNumber}`;

      const body = [
        brMode ? 'Dear Partner,' : `Dear ${primaryCustomer?.name || 'Customer'},`,
        '',
        'Please find attached the documents for your order:',
        '',
        selection.invoice ? `• Commercial Invoice: ${inv.invoiceNumber}` : '',
        selection.pl      ? `• Packing List: ${invoice.plNumber || 'N/A'}` : '',
        selection.sli     ? `• Shipper's Letter of Instruction (SLI)` : '',
        selection.coo     ? `• Certificate of Origin` : '',
        selection.bol && !brMode && bolUrl ? `• Bill of Lading (BOL)` : '',
        '',
        `Total Amount: $${Number(inv.totalAmount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
        '',
        'Best regards,',
        companyName,
      ].filter(Boolean).join('\n');

      setEmailDraft({
        to: toAddress,
        cc: ccAddress,
        subject,
        htmlBody: body,
        attachments,
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
  // Keep the ref in sync so the `autoEmail` effect (declared above the
  // early-return to respect rules-of-hooks) can invoke this function.
  emailSelectedRef.current = emailSelected;

  // Send the drafted email via the shared email service.
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

  const selectedCount = Object.values(selection).filter(Boolean).length;
  // Prefer the just-uploaded URL so the row flips state without waiting
  // for React Query to refetch.
  const bolUrl = pendingBolUrl
    || (invoice as any).bolUrl
    || (invoice as any).bolurl
    || null;

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

            {/* COO — Certificate of Origin (native generator). */}
            <DocRow
              checked={selection.coo}
              onToggle={(v) => setSelection(s => ({ ...s, coo: v }))}
              icon={<BadgeCheck size={14} />}
              title="Certificate of Origin"
              subtitle="Country of origin declaration · signed by exporter"
            >
              <button
                type="button"
                onClick={() => runAction('coo', 'preview', `CertificateOfOrigin_${invoice.invoiceNumber}.pdf`)}
                disabled={busy !== null || sending}
                title="Preview"
                className={iconBtn}
              >
                {busy === 'coo-preview' ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
              </button>
              <button
                type="button"
                onClick={() => runAction('coo', 'download', `CertificateOfOrigin_${invoice.invoiceNumber}.pdf`)}
                disabled={busy !== null || sending}
                title="Download"
                className={iconBtn}
              >
                {busy === 'coo-download' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
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
                    onClick={() => {
                      // Reuse the same in-modal preview Dialog that
                      // Invoice/PL/SLI use, instead of window.open (popup-
                      // blocked in many Chrome configs). Data URLs work
                      // directly in the iframe src for both PDFs and
                      // images. The Dialog's onOpenChange cleanup calls
                      // URL.revokeObjectURL, which is a no-op on data:
                      // URLs so this is safe.
                      if (previewUrl) URL.revokeObjectURL(previewUrl);
                      const ext = bolUrl.startsWith('data:application/pdf')
                        ? 'pdf'
                        : bolUrl.startsWith('data:image/png') ? 'png'
                        : bolUrl.startsWith('data:image/jpeg') ? 'jpg'
                        : bolUrl.startsWith('data:image/webp') ? 'webp'
                        : 'bin';
                      setPreviewFilename(`BOL_${invoice.invoiceNumber || 'document'}.${ext}`);
                      setPreviewUrl(bolUrl);
                    }}
                    title="Preview"
                    className={iconBtn}
                  >
                    <Eye size={13} />
                  </button>
                  <a
                    href={bolUrl}
                    download={`BOL_${invoice.invoiceNumber || 'document'}.${
                      bolUrl.startsWith('data:application/pdf') ? 'pdf'
                      : bolUrl.startsWith('data:image/png') ? 'png'
                      : bolUrl.startsWith('data:image/jpeg') ? 'jpg'
                      : bolUrl.startsWith('data:image/webp') ? 'webp'
                      : 'bin'
                    }`}
                    title="Download"
                    className={iconBtn}
                  >
                    <Download size={13} />
                  </a>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => bolFileInputRef.current?.click()}
                  disabled={uploadingBol}
                  title="Upload BOL"
                  className={iconBtn}
                >
                  {uploadingBol
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Upload size={13} />}
                </button>
              )}
              <input
                ref={bolFileInputRef}
                type="file"
                accept={BOL_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleBolUpload(f);
                }}
              />
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

      {/* Inline PDF preview */}
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
                {previewFilename}
              </Dialog.Title>
              <div className="ml-auto flex items-center gap-1">
                {previewUrl && (
                  <a
                    href={previewUrl}
                    download={previewFilename}
                    title="Download"
                    className={iconBtn}
                  >
                    <Download size={13} />
                  </a>
                )}
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
                title="PDF preview"
                className="flex-1 w-full bg-white rounded-b-md"
              />
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Email preview modal — mirror of v1 PLInvoiceEngine preview */}
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
                  Review and send — routes through your signed-in Outlook or Gmail. PDFs are attached.
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
                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium block mb-1">
                  To
                </label>
                <input
                  type="text"
                  value={emailDraft.to}
                  onChange={e => setEmailDraft(d => ({ ...d, to: e.target.value }))}
                  placeholder="recipient@example.com"
                  className="w-full px-2.5 py-1.5 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] rounded-md text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium block mb-1">
                  CC
                </label>
                <input
                  type="text"
                  value={emailDraft.cc}
                  onChange={e => setEmailDraft(d => ({ ...d, cc: e.target.value }))}
                  placeholder="Optional — comma or semicolon separated"
                  className="w-full px-2.5 py-1.5 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] rounded-md text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium block mb-1">
                  Subject
                </label>
                <input
                  type="text"
                  value={emailDraft.subject}
                  onChange={e => setEmailDraft(d => ({ ...d, subject: e.target.value }))}
                  className="w-full px-2.5 py-1.5 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] rounded-md text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium block mb-1">
                  Message
                </label>
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
  );
};
