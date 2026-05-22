// Save the 3 delivery documents (Invoice PDF, Packing List PDF, BOL)
// to a Dropbox folder via the `dropbox-upload` Edge Function.
//
// The PDFs are generated client-side using the same v2 generators that
// the Delivery Documents modal uses, so what lands in Dropbox is
// byte-identical to what the user would preview/download from there.
// The BOL is taken from the invoice row's `bolUrl` (data URL stored at
// upload time); if no BOL has been uploaded yet, the call is rejected.
//
// Caller is responsible for loading the InvoicePdfCtx (customers,
// suppliers, products, packing lists, bookings, ports, logo, stamp) —
// this matches the pattern in DeliveryDocsModal where every query hook
// runs at component scope. See useDropboxSave for the React-friendly
// wrapper that lifts those queries automatically.

import jsPDF from 'jspdf';
import { generateInvoicePdf } from './pdf/invoicePdf';
import { generatePLPerProductPdf, generatePLPerContainerPdf } from './pdf/plResumePdf';
import type { InvoicePdfCtx, PdfInvoice } from './pdf/types';
import type { Invoice } from '../queries/useInvoices';
import { plRowToDraft } from '../routes/packingListShared';
import { invokeEdgeFunction } from '../../services/edgeAuth';
import { getSupabaseClient } from '../../services/supabase';

export interface SaveResult {
    folderPath: string;
    uploaded: Array<{ name: string; path: string }>;
}

// Strip the data-URL prefix and return raw base64. Tolerates both raw
// base64 and full `data:application/pdf;base64,...` inputs.
const toBase64Payload = (raw: string): string => {
    if (raw.startsWith('data:')) {
        const comma = raw.indexOf(',');
        return comma >= 0 ? raw.slice(comma + 1) : raw;
    }
    return raw;
};

// jsPDF returns a full data URL via `output('datauristring')`. We strip
// the prefix for the JSON wire payload.
const docToBase64 = (doc: jsPDF): string =>
    toBase64Payload(doc.output('datauristring'));

// Sniff content type from a data URL; default to PDF if unknown.
const sniffContentType = (raw: string): string => {
    if (raw.startsWith('data:')) {
        const m = raw.match(/^data:([^;]+);/);
        return m ? m[1] : 'application/octet-stream';
    }
    return 'application/pdf';
};

// "INV-8004" → "8004" for the folder suffix. Falls back to the raw
// invoice number if it doesn't follow the standard pattern.
const stripInvPrefix = (invNumber: string): string => {
    const m = invNumber.match(/(\d+)\s*$/);
    return m ? m[1] : invNumber;
};

// Pull the linked `packing_lists` row for an invoice. Returns the
// full row (or null if not found / on error) so the caller can build a
// PLDraft for the per-product / per-container generators AND read the
// supplier's original PDF off `originalDocument` in a single fetch.
// `usePackingLists` deliberately skips these columns to keep the list
// query small, so we go direct.
async function fetchLinkedPlRow(plNumber: string): Promise<Record<string, unknown> | null> {
    try {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase
            .from('packing_lists')
            .select('*')
            .eq('plNumber', plNumber)
            .limit(1)
            .maybeSingle();
        if (error || !data) return null;
        return data as Record<string, unknown>;
    } catch {
        return null;
    }
}

// First word of the customer name — typically the trading name
// (e.g., "BEATRIZ TEXTIL SA" → "BEATRIZ", "RECIRCULAR INDUSTRIA E
// COMERCIO LTDA" → "RECIRCULAR"). Falls back to "UNKNOWN" if neither
// soldTo nor billToName is populated.
const firstNameToken = (inv: Invoice): string => {
    const raw = (inv.soldTo ?? inv.billToName ?? '').trim();
    if (!raw) return 'UNKNOWN';
    // Strip surrounding punctuation, then take everything up to the
    // first whitespace.
    const cleaned = raw.replace(/^[\s\W]+/, '');
    const token = cleaned.split(/\s+/)[0] || 'UNKNOWN';
    return token.toUpperCase();
};

/**
 * Build the target folder name per EC4 convention:
 *   `<first word of customer> CI-<invoice number>`
 * E.g. "BEATRIZ CI-8004". The full Dropbox path is composed on the
 * server using the configured `rootPath` (default
 * `/EC4 COMEC - 3. SHIPPED WITH BL`).
 */
export const dropboxFolderName = (inv: Invoice): string => {
    const customer = firstNameToken(inv);
    const num = stripInvPrefix(inv.invoiceNumber ?? '');
    return `${customer} CI-${num}`;
};

export interface SaveInputs {
    invoice: Invoice;
    pdfInvoice: PdfInvoice;
    ctx: InvoicePdfCtx;
}

/**
 * Generate the delivery-doc PDFs and push them to Dropbox. Returns the
 * folder path and per-file uploaded paths on success. Throws on any
 * error so the caller can surface a toast.
 *
 * Files written into the folder:
 *   - `Invoice_<inv#>.pdf`               — always (from app data)
 *   - `PLPerProduct_<plnum>.pdf`         — always (when a PL row exists)
 *   - `PLPerContainer_<plnum>.pdf`       — always (when a PL row exists)
 *   - `SupplierPL_<plnum>.<ext>`         — only if `packing_lists.originalDocument` is set
 *   - `BOL_<inv#>.<ext>`                 — only if `invoices.bolUrl` is set
 *
 * If the invoice has no linked PL row, the per-product and per-container
 * PDFs are skipped silently (nothing to render from).
 */
export async function saveToDropbox(inputs: SaveInputs): Promise<SaveResult> {
    const { invoice, pdfInvoice, ctx } = inputs;
    const bolRaw = (invoice as any).bolUrl || (invoice as any).bolurl;
    const hasBol = typeof bolRaw === 'string' && bolRaw.startsWith('data:');

    const invoiceDoc = generateInvoicePdf(pdfInvoice, ctx, false);

    const num = stripInvPrefix(invoice.invoiceNumber ?? '');
    const plNumber = (invoice as any).plNumber || '';
    const plLabel = plNumber ? String(plNumber).replace(/\s+/g, '_') : `PL-${num}`;

    const folderName = dropboxFolderName(invoice);
    const files: Array<{ name: string; contentType: string; base64: string }> = [
        {
            name: `Invoice_${invoice.invoiceNumber || num}.pdf`,
            contentType: 'application/pdf',
            base64: docToBase64(invoiceDoc),
        },
    ];

    // Per-product and per-container PLs. These are the always-saved
    // generated views derived from the linked packing_lists row. If no
    // PL row is linked we can't build them — log and continue.
    if (plNumber) {
        const plRow = await fetchLinkedPlRow(String(plNumber));
        if (plRow) {
            try {
                const draft = plRowToDraft(plRow);
                const perProduct = generatePLPerProductPdf(draft).doc;
                const perContainer = generatePLPerContainerPdf(draft).doc;
                files.push({
                    name: `PLPerProduct_${plLabel}.pdf`,
                    contentType: 'application/pdf',
                    base64: docToBase64(perProduct),
                });
                files.push({
                    name: `PLPerContainer_${plLabel}.pdf`,
                    contentType: 'application/pdf',
                    base64: docToBase64(perContainer),
                });
            } catch (e) {
                // eslint-disable-next-line no-console
                console.warn('[saveToDropbox] PL Resume PDFs failed:', e);
            }

            // Supplier's original PL document (PDF the AI extractor
            // consumed when this PL row was created). Optional.
            const supplierRaw = (plRow as { originalDocument?: string | null }).originalDocument;
            if (typeof supplierRaw === 'string' && supplierRaw.startsWith('data:')) {
                const splCt = sniffContentType(supplierRaw);
                const splExt = splCt === 'application/pdf' ? 'pdf'
                    : splCt === 'image/png' ? 'png'
                    : splCt === 'image/jpeg' ? 'jpg'
                    : splCt === 'image/webp' ? 'webp'
                    : 'bin';
                files.push({
                    name: `SupplierPL_${plLabel}.${splExt}`,
                    contentType: splCt,
                    base64: toBase64Payload(supplierRaw),
                });
            }
        } else {
            // eslint-disable-next-line no-console
            console.warn(`[saveToDropbox] No packing_lists row for plNumber=${plNumber}; skipping PL PDFs.`);
        }
    }

    if (hasBol) {
        // BOL filename uses the original mime type to pick the
        // extension (Dropbox is content-type-agnostic but a sensible
        // extension helps the EC4 ops team find it in Finder).
        const bolContentType = sniffContentType(bolRaw);
        const bolExt = bolContentType === 'application/pdf' ? 'pdf'
            : bolContentType === 'image/png' ? 'png'
            : bolContentType === 'image/jpeg' ? 'jpg'
            : bolContentType === 'image/webp' ? 'webp'
            : 'bin';
        files.push({
            name: `BOL_${invoice.invoiceNumber || num}.${bolExt}`,
            contentType: bolContentType,
            base64: toBase64Payload(bolRaw),
        });
    }

    const result = await invokeEdgeFunction('dropbox-upload', {
        body: { folderName, files },
    }) as { ok?: boolean; folderPath?: string; uploaded?: any[]; error?: string };

    if (!result?.ok || !result.folderPath) {
        throw new Error(result?.error || 'Dropbox upload failed (no response).');
    }
    return {
        folderPath: result.folderPath,
        uploaded: Array.isArray(result.uploaded) ? result.uploaded : [],
    };
}
