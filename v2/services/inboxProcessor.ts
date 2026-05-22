// Inbox processor — turns `TriageItem[]` into concrete actions.
//
// For each detected email attachment:
//   • Match exists  → attach the raw PDF to the matching row's
//                     `originalDocument` column so the source is
//                     auditable from the drawer.
//   • No match, but doc type is classifiable  → insert a new row
//                     into the appropriate table with the fields we
//                     can reliably extract.
//   • Otherwise  → surface a "needs review" note in the chat.
//
// After a successful action we mark the source email as read so the
// next scan won't re-process it.

import { getSupabaseClient } from '../../services/supabase';
import { analyzeDocument } from '../../services/geminiService';
import { markEmailAsRead } from '../../services/smailGraph';
import { getTokenForGoogle, getGoogleAccount } from '../../services/smailAuth';
import type { TriageItem, TriageDocType } from './inboxAutoTriage';

// ─── Types ────────────────────────────────────────────────────────

export type ProcessAction =
  | 'attached_to_existing'
  | 'saved_new_invoice'
  | 'saved_new_purchase_order'
  | 'saved_new_bill_of_lading'
  | 'saved_new_packing_list'
  | 'saved_new_booking'
  | 'skipped_unclassified'
  | 'failed';

export interface ProcessResult {
  item: TriageItem;
  action: ProcessAction;
  message: string;
  entityId?: string;
  error?: string;
}

// ─── Extraction prompts ───────────────────────────────────────────
// Kept compact: we only ask for the fields the DB table needs.
// Returns JSON; caller parses.

const PROMPT_INVOICE = `Extract commercial invoice fields as JSON:
{"invoiceNumber": string|null, "invoiceDate": string|null, "soldTo": string|null, "billToName": string|null, "supplier": string|null, "soNumber": string|null, "customerPo": string|null, "incoterm": string|null, "paymentTerms": string|null, "currency": string|null, "totalAmount": number|null, "subtotal": number|null, "grossWeight": number|null, "netWeight": number|null, "items": [{"productName": string, "hsCode": string|null, "netLbs": number|null, "netKg": number|null, "grossLbs": number|null, "grossKg": number|null, "volumes": number|null, "unitPrice": number|null, "amount": number|null, "containerNo": string|null, "sealNo": string|null}]}
Return ONLY valid JSON.`;

const PROMPT_PO = `Extract purchase order fields as JSON:
{"poNumber": string|null, "orderDate": string|null, "supplierName": string|null, "incoterm": string|null, "paymentTerms": string|null, "currency": string|null, "totalAmount": number|null, "originPort": string|null, "destinationPort": string|null, "items": [{"productName": string, "quantity": number|null, "unitPrice": number|null, "total": number|null}]}
Return ONLY valid JSON.`;

const PROMPT_BL = `Extract Bill of Lading fields as JSON:
{"blNumber": string|null, "shipper": string|null, "consignee": string|null, "notifyParty": string|null, "vesselVoyage": string|null, "portLoading": string|null, "portDischarge": string|null, "placeReceipt": string|null, "placeDelivery": string|null, "shippedDate": string|null, "container": string|null, "seal": string|null, "description": string|null, "grossWeight": string|null, "measurement": string|null, "packages": string|null, "freightPayable": string|null}
Return ONLY valid JSON.`;

const PROMPT_PL = `Extract Packing List fields as JSON:
{"plNumber": string|null, "blNumber": string|null, "shipper": string|null, "consignee": string|null, "shippingPoint": string|null, "destination": string|null, "date": string|null, "carrier": string|null, "containerNumber": string|null, "sealNumber": string|null, "vesselVoyage": string|null, "productDescription": string|null, "grossWeight": string|null, "netWeight": string|null, "poNumber": string|null}
Return ONLY valid JSON.`;

// Carrier booking confirmations (Maersk, Hapag, MSC, KAPPALOG NVOCC,
// etc.). The DB columns mirror what shows up across these carriers'
// PDFs — port codes are 5-letter UN/LOCODE (USCHS, BRPEC), dates are
// loose strings, equipment is e.g. "2x45GP" or "1x40HC".
//
// `pol` / `pod` MUST come back as the 5-letter UN/LOCODE only
// (e.g. "USHOU", not "USHOU - Houston, Texas"). We post-process and
// validate against the `ports` table after extraction.
const PROMPT_BOOKING = `Extract Booking Confirmation fields as JSON:
{"bookingNumber": string|null, "customer": string|null, "agentName": string|null, "vesselVoyage": string|null, "pol": string|null, "pod": string|null, "equipment": string|null, "etd": string|null, "eta": string|null, "cargoCutOff": string|null, "vgmCutOff": string|null, "draftCutOff": string|null, "freeTime": string|null, "terminal": string|null}
For "pol" and "pod" return ONLY the 5-letter UN/LOCODE (uppercase), e.g. "USHOU" — never the city name or descriptive form.
Return ONLY valid JSON.`;

function promptFor(docType: TriageDocType): string | null {
  if (docType === 'INVOICE') return PROMPT_INVOICE;
  if (docType === 'PURCHASE ORDER') return PROMPT_PO;
  if (docType === 'BILL OF LADING') return PROMPT_BL;
  if (docType === 'PACKING LIST') return PROMPT_PL;
  if (docType === 'PROFORMA INVOICE') return PROMPT_INVOICE;
  if (docType === 'BOOKING') return PROMPT_BOOKING;
  return null;
}

function parseJsonLoose(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// ─── Helpers ──────────────────────────────────────────────────────

const pickStr = (o: Record<string, unknown>, k: string): string | null => {
  const v = o[k];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};
const pickNum = (o: Record<string, unknown>, k: string): number | null => {
  const v = o[k];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d.\-]/g, ''));
    if (Number.isFinite(n) && v.trim() !== '') return n;
  }
  return null;
};

// ─── Gmail markAsRead (Outlook has one already in smailGraph.ts) ──

async function markGmailAsRead(messageId: string): Promise<boolean> {
  const acct = getGoogleAccount();
  if (!acct) return false;
  try {
    const token = await getTokenForGoogle();
    const res = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
      },
    );
    return res.ok;
  } catch { return false; }
}

async function markRead(item: TriageItem): Promise<void> {
  try {
    if (item.source === 'outlook') {
      await markEmailAsRead('automation', item.messageId).catch(() =>
        markEmailAsRead('my', item.messageId).catch(() => {}));
    } else {
      await markGmailAsRead(item.messageId);
    }
  } catch { /* noop */ }
}

// ─── Attach PDF to an existing matching entity ───────────────────

async function attachToExisting(item: TriageItem, base64: string, mime: string): Promise<ProcessResult> {
  const match = item.match!;
  const sb = getSupabaseClient();
  const dataUrl = `data:${mime};base64,${base64}`;
  // Map kind → table + column. bill_of_ladings uses `bl` column on
  // invoices (a data URL) per the live schema we probed.
  const tableByKind: Record<string, string> = {
    invoice: 'invoices',
    sales_order: 'sales_orders',
    purchase_order: 'purchase_orders',
    booking: 'bookings',
    bill_of_ladings: 'bill_landings',
  };
  const table = tableByKind[match.kind];
  if (!table) {
    return { item, action: 'failed', message: `Unknown match kind: ${match.kind}`, error: 'no-table' };
  }
  try {
    const { error } = await sb.from(table).update({ originalDocument: dataUrl }).eq('id', match.id);
    if (error) throw new Error(error.message);
    return {
      item,
      action: 'attached_to_existing',
      message: `📎 ${item.docType} ${item.extractedRef ?? ''} from ${item.from} — attached to existing ${match.label}`,
      entityId: match.id,
    };
  } catch (err) {
    return {
      item, action: 'failed',
      message: `⚠️ Failed to attach ${item.attachmentName} to ${match.label}: ${err instanceof Error ? err.message : String(err)}`,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Full-field extraction + insert ──────────────────────────────

async function fetchOutlookAttachmentBase64(messageId: string, attachmentName: string): Promise<string | null> {
  // The triage pass already downloaded this; re-fetch via Graph.
  const { getTokenFor, getAccountFor } = await import('../../services/smailAuth');
  const account = getAccountFor('automation') || getAccountFor('my');
  if (!account) return null;
  const key = getAccountFor('automation') ? 'automation' : 'my';
  try {
    const token = await getTokenFor(key, ['Mail.Read']);
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}/attachments`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const body = await res.json();
    const att = (body?.value as any[])?.find((a: any) => a.name === attachmentName && a.contentType === 'application/pdf');
    return att?.contentBytes ?? null;
  } catch { return null; }
}

async function fetchGmailAttachmentBase64(messageId: string, attachmentName: string): Promise<string | null> {
  const acct = getGoogleAccount();
  if (!acct) return null;
  try {
    const token = await getTokenForGoogle();
    const msgRes = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!msgRes.ok) return null;
    const body = await msgRes.json();
    // Walk parts to find the PDF with matching filename.
    const walk = (parts: any[] | undefined): { attachmentId: string } | null => {
      if (!parts) return null;
      for (const p of parts) {
        if (p.mimeType === 'application/pdf' && p.filename === attachmentName && p.body?.attachmentId) {
          return { attachmentId: p.body.attachmentId };
        }
        if (p.parts) {
          const nested = walk(p.parts);
          if (nested) return nested;
        }
      }
      return null;
    };
    const found = walk(body?.payload?.parts);
    if (!found) return null;
    const attRes = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${found.attachmentId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!attRes.ok) return null;
    const att = await attRes.json();
    const data = att?.data as string | undefined;
    if (!data) return null;
    return data.replace(/-/g, '+').replace(/_/g, '/');
  } catch { return null; }
}

async function getAttachmentBase64(item: TriageItem): Promise<string | null> {
  return item.source === 'outlook'
    ? fetchOutlookAttachmentBase64(item.messageId, item.attachmentName)
    : fetchGmailAttachmentBase64(item.messageId, item.attachmentName);
}

async function saveNewInvoice(item: TriageItem, base64: string): Promise<ProcessResult> {
  const parsed = parseJsonLoose(String(await analyzeDocument(base64, 'application/pdf', PROMPT_INVOICE) ?? ''));
  if (!parsed) return { item, action: 'failed', message: `⚠️ Could not extract invoice fields from ${item.attachmentName}`, error: 'extract-failed' };
  const invoiceNumber = pickStr(parsed, 'invoiceNumber') ?? item.extractedRef ?? `INV-${Date.now()}`;
  const row = {
    id: `INV${Date.now()}`,
    invoiceNumber,
    invoiceDate: pickStr(parsed, 'invoiceDate'),
    soldTo: pickStr(parsed, 'soldTo'),
    billToName: pickStr(parsed, 'billToName'),
    supplier: pickStr(parsed, 'supplier'),
    soNumber: pickStr(parsed, 'soNumber'),
    customerPo: pickStr(parsed, 'customerPo'),
    incoterm: pickStr(parsed, 'incoterm'),
    paymentTerms: pickStr(parsed, 'paymentTerms'),
    currency: pickStr(parsed, 'currency') ?? 'USD',
    totalAmount: pickNum(parsed, 'totalAmount'),
    subtotal: pickNum(parsed, 'subtotal'),
    grossWeight: pickNum(parsed, 'grossWeight'),
    netWeight: pickNum(parsed, 'netWeight'),
    items: JSON.stringify(Array.isArray(parsed.items) ? parsed.items : []),
    originalDocument: `data:application/pdf;base64,${base64}`,
    status: 'DRAFT',
  };
  const sb = getSupabaseClient();
  const { error } = await sb.from('invoices').insert(row);
  if (error) return { item, action: 'failed', message: `⚠️ Invoice save failed: ${error.message}`, error: error.message };
  // Auto-fulfil the linked SO so the Trading Follow Up "To Ship" table
  // drops it now that an invoice exists. Mirror the manual-create logic.
  const linkedSo = (row.soNumber ?? '').trim();
  if (linkedSo) {
    const { error: soErr } = await sb
      .from('sales_orders')
      .update({ status: 'FULFILLED' })
      .eq('orderNumber', linkedSo)
      .neq('status', 'FULFILLED');
    if (soErr) {
      // eslint-disable-next-line no-console
      console.warn(`[inboxProcessor] linkSalesOrder ${linkedSo} failed:`, soErr);
    }
  }
  return {
    item, action: 'saved_new_invoice', entityId: row.id,
    message: `📄 Invoice ${invoiceNumber}${row.soldTo ? ` from ${row.soldTo}` : ''} · saved from email (${item.from})`,
  };
}

async function saveNewPO(item: TriageItem, base64: string): Promise<ProcessResult> {
  const parsed = parseJsonLoose(String(await analyzeDocument(base64, 'application/pdf', PROMPT_PO) ?? ''));
  if (!parsed) return { item, action: 'failed', message: `⚠️ Could not extract PO fields from ${item.attachmentName}`, error: 'extract-failed' };
  const id = `PO${Date.now()}`;
  const row = {
    id,
    supplierName: pickStr(parsed, 'supplierName'),
    orderDate: pickStr(parsed, 'orderDate'),
    incoterm: pickStr(parsed, 'incoterm'),
    paymentTerms: pickStr(parsed, 'paymentTerms'),
    currency: pickStr(parsed, 'currency') ?? 'USD',
    totalAmount: pickNum(parsed, 'totalAmount'),
    originPort: pickStr(parsed, 'originPort'),
    destinationPort: pickStr(parsed, 'destinationPort'),
    items: JSON.stringify(Array.isArray(parsed.items) ? parsed.items : []),
    status: 'DRAFT',
  };
  const sb = getSupabaseClient();
  const { error } = await sb.from('purchase_orders').insert(row);
  if (error) return { item, action: 'failed', message: `⚠️ PO save failed: ${error.message}`, error: error.message };
  const ref = pickStr(parsed, 'poNumber') ?? id;
  return { item, action: 'saved_new_purchase_order', entityId: id,
    message: `📄 Purchase Order ${ref}${row.supplierName ? ` from ${row.supplierName}` : ''} · saved from email` };
}

async function saveNewBL(item: TriageItem, base64: string): Promise<ProcessResult> {
  const parsed = parseJsonLoose(String(await analyzeDocument(base64, 'application/pdf', PROMPT_BL) ?? ''));
  if (!parsed) return { item, action: 'failed', message: `⚠️ Could not extract BL fields from ${item.attachmentName}`, error: 'extract-failed' };
  const blNumber = pickStr(parsed, 'blNumber') ?? item.extractedRef ?? `BL-${Date.now()}`;
  const row = {
    id: `BL${Date.now()}`,
    blNumber,
    shipper: pickStr(parsed, 'shipper'),
    consignee: pickStr(parsed, 'consignee'),
    notifyParty: pickStr(parsed, 'notifyParty'),
    vesselVoyage: pickStr(parsed, 'vesselVoyage'),
    portLoading: pickStr(parsed, 'portLoading'),
    portDischarge: pickStr(parsed, 'portDischarge'),
    placeReceipt: pickStr(parsed, 'placeReceipt'),
    placeDelivery: pickStr(parsed, 'placeDelivery'),
    shippedDate: pickStr(parsed, 'shippedDate'),
    container: pickStr(parsed, 'container'),
    seal: pickStr(parsed, 'seal'),
    description: pickStr(parsed, 'description'),
    grossWeight: pickStr(parsed, 'grossWeight'),
    measurement: pickStr(parsed, 'measurement'),
    packages: pickStr(parsed, 'packages'),
    freightPayable: pickStr(parsed, 'freightPayable'),
    originalDocument: `data:application/pdf;base64,${base64}`,
    status: 'RECEIVED',
  };
  const sb = getSupabaseClient();
  const { error } = await sb.from('bill_landings').insert(row);
  if (error) return { item, action: 'failed', message: `⚠️ BL save failed: ${error.message}`, error: error.message };
  return { item, action: 'saved_new_bill_of_lading', entityId: row.id,
    message: `📄 Bill of Lading ${blNumber}${row.shipper ? ` · ${row.shipper}` : ''} · saved from email` };
}

/** Best-effort UN/LOCODE extractor. Inputs we see in the wild:
 *   - "USHOU"                                 → "USHOU"
 *   - "USHOU - Houston, Texas, United States" → "USHOU"
 *   - "Houston (USHOU)"                       → "USHOU"
 *   - "Manaus, Brazil"                        → null (no code present)
 * After extraction we validate against the `ports` table so a typo
 * doesn't end up persisted as a fake code. */
function extractLocode(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toUpperCase();
  // Anchored 5-letter form ("USHOU - Houston" / "USHOU")
  const anchored = /^([A-Z]{5})\b/.exec(trimmed);
  if (anchored) return anchored[1];
  // Parenthesised form: "Houston (USHOU)"
  const parens = /\(([A-Z]{5})\)/.exec(trimmed);
  if (parens) return parens[1];
  // Any 5-letter word that's not a common city ALL-CAPS word.
  const loose = /\b([A-Z]{5})\b/.exec(trimmed);
  return loose ? loose[1] : null;
}

async function resolvePortCode(raw: string | null): Promise<string | null> {
  const candidate = extractLocode(raw);
  if (!candidate) return raw && raw.trim() ? raw.trim() : null;
  // Validate against the ports table. We only auto-replace when the
  // code exists — that way a typo from the LLM doesn't quietly land
  // as a fake UN/LOCODE; we keep the raw text in that case so the
  // user can spot it in "Needs review" / the bookings list.
  const sb = getSupabaseClient();
  const { data } = await sb.from('ports').select('code').eq('code', candidate).maybeSingle();
  if (data?.code) return data.code;
  // Code shape looks right but doesn't exist in the table — surface
  // the bare code anyway since that's what the user wants to see.
  // (If we later flip this to keep `raw`, the Bookings list goes back
  // to "USHOU - Houston, Texas, United States" verbose strings.)
  return candidate;
}

/** Resolve a concrete companyId for auto-save rows. The inbox scan
 *  runs in the background and doesn't carry React context, so we read
 *  the user's selected company straight from sessionStorage. When the
 *  user is in "ALL" mode, fall back to their first allowed company so
 *  the new row lands somewhere they can see — null companyId leaves
 *  the row invisible to every company-scoped query. */
function resolveCompanyIdForSave(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = sessionStorage.getItem('xs_v2_current_company');
    if (stored && stored !== 'ALL') return stored;
    // Fall back to the logged-in user's first allowed company.
    const userRaw = sessionStorage.getItem('xs_current_user');
    if (userRaw) {
      const u = JSON.parse(userRaw) as { allowed_company_ids?: string[]; allowedCompanyIds?: string[] };
      const ids = u.allowed_company_ids ?? u.allowedCompanyIds ?? [];
      if (Array.isArray(ids) && ids.length > 0) return ids[0];
    }
  } catch { /* noop */ }
  return null;
}

async function saveNewBooking(item: TriageItem, base64: string): Promise<ProcessResult> {
  const parsed = parseJsonLoose(String(await analyzeDocument(base64, 'application/pdf', PROMPT_BOOKING) ?? ''));
  if (!parsed) return { item, action: 'failed', message: `⚠️ Could not extract Booking fields from ${item.attachmentName}`, error: 'extract-failed' };
  const bookingNumber = pickStr(parsed, 'bookingNumber') ?? item.extractedRef ?? `BK-${Date.now()}`;

  const sb = getSupabaseClient();

  // Duplicate guard. The same booking confirmation often arrives more
  // than once (forwarded thread, agent re-send, attachment-only reply).
  // We previously inserted blindly and the bookings table had two
  // identical rows for 270999154 after the latest scan. Look it up
  // first — if a row already exists, attach this PDF to it instead.
  const existingRes = await sb.from('bookings')
    .select('id')
    .eq('bookingNumber', bookingNumber)
    .maybeSingle<{ id: string }>();
  if (existingRes.data?.id) {
    const dataUrl = `data:application/pdf;base64,${base64}`;
    const { error: upErr } = await sb.from('bookings')
      .update({ originalDocument: dataUrl })
      .eq('id', existingRes.data.id);
    if (upErr) {
      return { item, action: 'failed', message: `⚠️ Booking ${bookingNumber} already existed; PDF attach failed: ${upErr.message}`, error: upErr.message };
    }
    return {
      item, action: 'attached_to_existing', entityId: existingRes.data.id,
      message: `📎 Booking ${bookingNumber} already exists — PDF attached.`,
    };
  }

  // Normalize POL/POD to UN/LOCODE matched against the ports table.
  const [pol, pod] = await Promise.all([
    resolvePortCode(pickStr(parsed, 'pol')),
    resolvePortCode(pickStr(parsed, 'pod')),
  ]);

  // Booking IDs follow V1's pattern `BK<timestamp>` so existing reads
  // (e.g. useBookings) treat the row the same as a manually-created one.
  // companyId + createdAt are mandatory for the Bookings page to show
  // the row at all — null companyId + null createdAt left the previous
  // auto-saves invisible behind the company-scoped query.
  const row = {
    id: `BK${Date.now()}`,
    bookingNumber,
    companyId: resolveCompanyIdForSave(),
    customer: pickStr(parsed, 'customer'),
    agentName: pickStr(parsed, 'agentName'),
    vesselVoyage: pickStr(parsed, 'vesselVoyage'),
    pol,
    pod,
    equipment: pickStr(parsed, 'equipment'),
    etd: pickStr(parsed, 'etd'),
    eta: pickStr(parsed, 'eta'),
    cargoCutOff: pickStr(parsed, 'cargoCutOff'),
    vgmCutOff: pickStr(parsed, 'vgmCutOff'),
    draftCutOff: pickStr(parsed, 'draftCutOff'),
    freeTime: pickStr(parsed, 'freeTime'),
    terminal: pickStr(parsed, 'terminal'),
    originalDocument: `data:application/pdf;base64,${base64}`,
    status: 'AVAILABLE',
    createdAt: new Date().toISOString(),
  };
  const { error } = await sb.from('bookings').insert(row);
  if (error) return { item, action: 'failed', message: `⚠️ Booking save failed: ${error.message}`, error: error.message };
  return { item, action: 'saved_new_booking', entityId: row.id,
    message: `📦 Booking ${bookingNumber}${row.customer ? ` · ${row.customer}` : ''} · saved from email` };
}

async function saveNewPL(item: TriageItem, base64: string): Promise<ProcessResult> {
  const parsed = parseJsonLoose(String(await analyzeDocument(base64, 'application/pdf', PROMPT_PL) ?? ''));
  if (!parsed) return { item, action: 'failed', message: `⚠️ Could not extract PL fields from ${item.attachmentName}`, error: 'extract-failed' };
  const plNumber = pickStr(parsed, 'plNumber') ?? item.extractedRef ?? `PL-${Date.now()}`;
  const row = {
    id: `PL${Date.now()}`,
    plNumber,
    blNumber: pickStr(parsed, 'blNumber'),
    shipper: pickStr(parsed, 'shipper'),
    consignee: pickStr(parsed, 'consignee'),
    shippingPoint: pickStr(parsed, 'shippingPoint'),
    destination: pickStr(parsed, 'destination'),
    date: pickStr(parsed, 'date'),
    carrier: pickStr(parsed, 'carrier'),
    containerNumber: pickStr(parsed, 'containerNumber'),
    sealNumber: pickStr(parsed, 'sealNumber'),
    vesselVoyage: pickStr(parsed, 'vesselVoyage'),
    productDescription: pickStr(parsed, 'productDescription'),
    grossWeight: pickStr(parsed, 'grossWeight'),
    netWeight: pickStr(parsed, 'netWeight'),
    poNumber: pickStr(parsed, 'poNumber'),
    originalDocument: `data:application/pdf;base64,${base64}`,
    status: 'RECEIVED',
  };
  const sb = getSupabaseClient();
  const { error } = await sb.from('packing_lists').insert(row);
  if (error) return { item, action: 'failed', message: `⚠️ PL save failed: ${error.message}`, error: error.message };
  return { item, action: 'saved_new_packing_list', entityId: row.id,
    message: `📄 Packing List ${plNumber}${row.shipper ? ` · ${row.shipper}` : ''} · saved from email` };
}

// ─── Public API ───────────────────────────────────────────────────

/** Process a single triage item end-to-end. Marks the source email
 *  as read after any successful action. Safe to call concurrently on
 *  different items (each acts on its own email). */
export async function processTriageItem(item: TriageItem): Promise<ProcessResult> {
  const b64 = await getAttachmentBase64(item);
  if (!b64) {
    return { item, action: 'failed', message: `⚠️ Couldn't re-fetch ${item.attachmentName} to save`, error: 'no-attachment-bytes' };
  }
  let result: ProcessResult;
  if (item.match) {
    result = await attachToExisting(item, b64, 'application/pdf');
  } else {
    const prompt = promptFor(item.docType);
    if (!prompt) {
      result = {
        item, action: 'skipped_unclassified',
        message: `📥 Email "${item.subject}" from ${item.from} has ${item.docType} attachment — not auto-saveable; review manually.`,
      };
    } else if (item.docType === 'INVOICE' || item.docType === 'PROFORMA INVOICE') {
      result = await saveNewInvoice(item, b64);
    } else if (item.docType === 'PURCHASE ORDER') {
      result = await saveNewPO(item, b64);
    } else if (item.docType === 'BILL OF LADING') {
      result = await saveNewBL(item, b64);
    } else if (item.docType === 'PACKING LIST') {
      result = await saveNewPL(item, b64);
    } else if (item.docType === 'BOOKING') {
      result = await saveNewBooking(item, b64);
    } else {
      result = { item, action: 'skipped_unclassified',
        message: `📥 Email "${item.subject}" from ${item.from} · classifier: ${item.docType}` };
    }
  }
  if (result.action !== 'failed' && result.action !== 'skipped_unclassified') {
    await markRead(item);
  }
  return result;
}

export async function processTriageItems(items: TriageItem[]): Promise<ProcessResult[]> {
  const results: ProcessResult[] = [];
  for (const it of items) {
    results.push(await processTriageItem(it));
  }
  return results;
}
