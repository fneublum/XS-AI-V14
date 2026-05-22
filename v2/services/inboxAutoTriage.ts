// Auto-triage scanner for Outlook / Gmail inboxes.
//
// Pulls the N most recent unread emails, downloads PDF attachments,
// runs Gemini OCR to classify the doc and extract its primary ref
// number, then tries to match that number against existing invoices /
// sales_orders / purchase_orders / bookings rows.
//
// Pure detection — no DB writes. Surfaces results to the caller who
// decides whether to link, dismiss, or open the row in a drawer.

import { getAccountFor, getTokenFor, getGoogleAccount, getTokenForGoogle } from '../../services/smailAuth';
import { analyzeDocument } from '../../services/geminiService';
import { getSupabaseClient } from '../../services/supabase';
import { listInboxLog } from './inboxLog';

// ─── Types ────────────────────────────────────────────────────────

export type TriageDocType =
  | 'INVOICE'
  | 'PURCHASE ORDER'
  | 'PROFORMA INVOICE'
  | 'BILL OF LADING'
  | 'PACKING LIST'
  | 'BOOKING'
  | 'OTHER';

export type TriageEntityKind = 'invoice' | 'sales_order' | 'purchase_order' | 'booking' | 'bill_of_lading';

export interface TriageMatch {
  kind: TriageEntityKind;
  id: string;
  label: string; // e.g. "INV-123 · ACME Corp"
}

export interface TriageItem {
  source: 'outlook' | 'gmail';
  messageId: string;
  subject: string;
  from: string;
  receivedAt: string; // ISO
  attachmentName: string;
  docType: TriageDocType;
  extractedRef: string | null;
  match: TriageMatch | null;
  confidence: 'high' | 'low';
  scannedAt: string;
}

// ─── Prompts ──────────────────────────────────────────────────────

const IDENTIFICATION_PROMPT = `Classify the attached document into one of:
INVOICE, PURCHASE ORDER, PROFORMA INVOICE, BILL OF LADING, PACKING LIST, BOOKING, OTHER.
Return only the category name, no other text.`;

const REF_PROMPT = `Return only the primary reference number visible at the top of this document as plain text (no label, no punctuation). Examples: "INV-4821", "PO-00123", "PI040626-3", "HLCU-SANS-LAX-123456", "BK-99". If you cannot find one, return "NONE".`;

// ─── Outlook / Graph ──────────────────────────────────────────────

interface OutlookMsg {
  id: string;
  subject?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  receivedDateTime?: string;
  hasAttachments?: boolean;
  isRead?: boolean;
}

interface OutlookAtt {
  id: string;
  '@odata.type': string;
  name?: string;
  contentType?: string;
  contentBytes?: string; // base64
  size?: number;
}

/** Window in hours that the scanner looks back. Used in both Outlook
 *  and Gmail fetchers — needs to be wider than the scan interval so a
 *  briefly-skipped tick (sleep, tab inactive) doesn't drop messages on
 *  the floor. The log de-dup ensures we don't re-OCR known messages. */
const SCAN_LOOKBACK_HOURS = 24;

/** Microsoft Graph rejects fractional seconds in `$filter` datetime
 *  values (`2026-05-17T19:05:24.801Z` → 400 InvalidFilterClauseValue).
 *  Strip milliseconds and emit second-precision ISO. */
function lookbackCutoffGraph(hours: number): string {
  const iso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  // "2026-05-17T19:05:24.801Z" → "2026-05-17T19:05:24Z"
  return iso.replace(/\.\d+Z$/, 'Z');
}

async function fetchRecentOutlook(limit = 20): Promise<OutlookMsg[]> {
  const account = getAccountFor('automation') || getAccountFor('my');
  if (!account) return [];
  const key = getAccountFor('automation') ? 'automation' : 'my';
  try {
    const token = await getTokenFor(key, ['Mail.Read']);
    // Pull every recent message with attachments, regardless of read
    // state. The previous `isRead eq false` filter silently dropped
    // any email the user happened to open in Outlook before the next
    // scan tick — bookings disappeared from the AI Inbox as soon as
    // they were viewed. Wider window + log de-dup is safer.
    //
    // Two Microsoft Graph quirks land here:
    //   1. When `$orderby` references a property, that property must
    //      appear FIRST in `$filter`. So `receivedDateTime` leads.
    //   2. `$filter` datetime values reject fractional seconds —
    //      hence `lookbackCutoffGraph`.
    const cutoff = lookbackCutoffGraph(SCAN_LOOKBACK_HOURS);
    const url =
      `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages` +
      `?$filter=receivedDateTime ge ${cutoff} and hasAttachments eq true` +
      `&$top=${limit}&$orderby=receivedDateTime desc` +
      `&$select=id,subject,from,receivedDateTime,hasAttachments,isRead`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      // Surface the 400/401 reason so silent failures stop being silent.
      const detail = await res.text().catch(() => '');
      console.warn(`[inbox-scan] Outlook list failed (${res.status}): ${detail.slice(0, 300)}`);
      return [];
    }
    const body = await res.json();
    return (body?.value as OutlookMsg[]) ?? [];
  } catch (e) {
    console.warn('[inbox-scan] Outlook list threw:', e);
    return [];
  }
}

async function fetchOutlookAttachments(messageId: string): Promise<OutlookAtt[]> {
  const account = getAccountFor('automation') || getAccountFor('my');
  if (!account) return [];
  const key = getAccountFor('automation') ? 'automation' : 'my';
  try {
    const token = await getTokenFor(key, ['Mail.Read']);
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}/attachments`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return [];
    const body = await res.json();
    return (body?.value as OutlookAtt[]) ?? [];
  } catch {
    return [];
  }
}

// ─── Gmail ────────────────────────────────────────────────────────

interface GmailMsg {
  id: string;
  threadId?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    parts?: Array<{
      filename?: string;
      mimeType?: string;
      body?: { attachmentId?: string; data?: string; size?: number };
      parts?: any[];
    }>;
  };
  internalDate?: string;
}

async function fetchRecentGmail(limit = 20): Promise<GmailMsg[]> {
  const acct = getGoogleAccount();
  if (!acct) return [];
  try {
    const token = await getTokenForGoogle();
    // Gmail's search-style query — `newer_than:1d` matches the
    // Outlook lookback window. Dropped `is:unread` for the same
    // reason as Outlook: read state is unreliable as a filter.
    const q = encodeURIComponent('has:attachment newer_than:1d');
    const listRes = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=${limit}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!listRes.ok) return [];
    const listBody = await listRes.json();
    const ids = (listBody?.messages as Array<{ id: string }> | undefined) ?? [];
    const out: GmailMsg[] = [];
    for (const { id } of ids) {
      const res = await fetch(
        `https://www.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) out.push(await res.json());
    }
    return out;
  } catch {
    return [];
  }
}

// Recursively find the first PDF part in a Gmail payload.
function findPdfPart(parts?: GmailMsg['payload']['parts']): { filename: string; attachmentId: string } | null {
  if (!parts) return null;
  for (const p of parts) {
    if (p.mimeType === 'application/pdf' && p.filename && p.body?.attachmentId) {
      return { filename: p.filename, attachmentId: p.body.attachmentId };
    }
    if (p.parts) {
      const nested = findPdfPart(p.parts);
      if (nested) return nested;
    }
  }
  return null;
}

async function fetchGmailAttachment(messageId: string, attachmentId: string): Promise<string | null> {
  try {
    const token = await getTokenForGoogle();
    const res = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const body = await res.json();
    const data = body?.data as string | undefined;
    if (!data) return null;
    // Gmail uses url-safe base64 — normalize.
    return data.replace(/-/g, '+').replace(/_/g, '/');
  } catch {
    return null;
  }
}

// ─── Matchers ─────────────────────────────────────────────────────

async function matchRef(docType: TriageDocType, ref: string): Promise<TriageMatch | null> {
  if (!ref || ref === 'NONE') return null;
  const sb = getSupabaseClient();
  // Strip obvious punctuation so "PO #00123" and "PO-00123" both match.
  const clean = ref.replace(/[#\s]/g, '').trim();

  const byInvoice = async () => {
    const { data } = await sb.from('invoices')
      .select('id, invoiceNumber, soldTo, billToName')
      .ilike('invoiceNumber', `%${clean}%`).limit(1);
    const row = (data as any[] | null)?.[0];
    if (!row) return null;
    return { kind: 'invoice' as const, id: row.id as string, label: `${row.invoiceNumber} · ${row.soldTo ?? row.billToName ?? ''}` };
  };
  const bySO = async () => {
    const { data } = await sb.from('sales_orders')
      .select('id, orderNumber, customerName')
      .ilike('orderNumber', `%${clean}%`).limit(1);
    const row = (data as any[] | null)?.[0];
    if (!row) return null;
    return { kind: 'sales_order' as const, id: row.id as string, label: `${row.orderNumber} · ${row.customerName ?? ''}` };
  };
  // Purchase orders don't carry a dedicated PO number column — the
  // supplier's own PO reference lives on invoices as `customerPo`. So
  // we match PO-like refs against that field and surface the linked
  // invoice (which is what the user usually wants to reconcile).
  const byPOviaInvoice = async () => {
    const { data } = await sb.from('invoices')
      .select('id, invoiceNumber, customerPo, soldTo, billToName')
      .ilike('customerPo', `%${clean}%`).limit(1);
    const row = (data as any[] | null)?.[0];
    if (!row) return null;
    return { kind: 'invoice' as const, id: row.id as string, label: `${row.invoiceNumber} (PO ${row.customerPo}) · ${row.soldTo ?? row.billToName ?? ''}` };
  };
  const byBooking = async () => {
    const { data } = await sb.from('bookings')
      .select('id, bookingNumber, customer')
      .ilike('bookingNumber', `%${clean}%`).limit(1);
    const row = (data as any[] | null)?.[0];
    if (!row) return null;
    return { kind: 'booking' as const, id: row.id as string, label: `${row.bookingNumber} · ${row.customer ?? ''}` };
  };
  const byBL = async () => {
    const { data } = await sb.from('bill_landings')
      .select('id, blNumber, shipper')
      .ilike('blNumber', `%${clean}%`).limit(1);
    const row = (data as any[] | null)?.[0];
    if (!row) return null;
    return { kind: 'bill_of_ladings' as any, id: row.id as string, label: `${row.blNumber} · ${row.shipper ?? ''}` };
  };

  // Prefer the lane suggested by the doc type; fall back to any match.
  const order = {
    'INVOICE':           [byInvoice, byPOviaInvoice, bySO],
    'PURCHASE ORDER':    [byPOviaInvoice, byInvoice, bySO],
    'PROFORMA INVOICE':  [bySO, byInvoice],
    'BILL OF LADING':    [byBL, byBooking],
    'PACKING LIST':      [byBL, byBooking, byInvoice],
    'BOOKING':           [byBooking, byBL],
    'OTHER':             [byInvoice, bySO, byPOviaInvoice, byBooking, byBL],
  }[docType] ?? [byInvoice, bySO, byPOviaInvoice];

  for (const fn of order) {
    const hit = await fn();
    if (hit) return hit;
  }
  return null;
}

// ─── Core scanner ─────────────────────────────────────────────────

/** Decode the first printable bytes of a base64 string to sniff for
 *  the %PDF- magic header — keeps us from sending non-PDFs to Gemini. */
function looksLikePdf(base64: string): boolean {
  try {
    const firstChunk = atob(base64.slice(0, 40));
    return firstChunk.startsWith('%PDF-');
  } catch {
    return false;
  }
}

async function triageOne(
  source: TriageItem['source'],
  messageId: string,
  subject: string,
  from: string,
  receivedAt: string,
  attachmentName: string,
  base64: string,
): Promise<TriageItem | null> {
  if (!looksLikePdf(base64)) return null;
  try {
    const idRaw = await analyzeDocument(base64, 'application/pdf', IDENTIFICATION_PROMPT);
    const docType = (String(idRaw ?? '').toUpperCase().replace(/[^A-Z ]/g, '').trim() || 'OTHER') as TriageDocType;

    const refRaw = await analyzeDocument(base64, 'application/pdf', REF_PROMPT);
    const ref = String(refRaw ?? '').trim().replace(/[\r\n"`*]/g, '').slice(0, 64);
    const extractedRef = ref && ref.toUpperCase() !== 'NONE' ? ref : null;

    const match = extractedRef ? await matchRef(docType, extractedRef) : null;

    return {
      source,
      messageId,
      subject,
      from,
      receivedAt,
      attachmentName,
      docType,
      extractedRef,
      match,
      confidence: match ? 'high' : 'low',
      scannedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Scan recent messages with attachments across both connected
 *  providers. Skips messages already in the inbox log so we don't
 *  pay Gemini OCR for the same attachment twice. Runs attachments
 *  sequentially — keeps Gemini concurrency low so a background tick
 *  doesn't monopolize the quota. */
export async function scanInbox(opts?: { outlookLimit?: number; gmailLimit?: number }): Promise<TriageItem[]> {
  const outLimit = opts?.outlookLimit ?? 15;
  const gmailLimit = opts?.gmailLimit ?? 10;
  const out: TriageItem[] = [];

  // Build a set of messageIds we've already FULLY processed so we skip
  // them here instead of paying for OCR. The inbox log is per-browser
  // (localStorage), which is fine because the scan only runs while
  // the user's tab is open.
  //
  // Important: dedup only on terminal-success actions. Items that
  // ended in `skipped_unclassified`, `no_match`, or `failed` need a
  // second chance — when we ship a new doc-type handler (e.g. the
  // recent BOOKING support) the previously-skipped messages should
  // get reprocessed, not stay stuck in "Needs review" forever.
  const TERMINAL_ACTIONS = new Set([
    'saved_new_invoice',
    'saved_new_purchase_order',
    'saved_new_bill_of_lading',
    'saved_new_packing_list',
    'saved_new_booking',
    'attached_to_existing',
    'drafted',
    'correction_proposed',
    'correction_applied',
    'correction_confirmed_current',
  ]);
  const seen = new Set<string>(
    listInboxLog()
      .filter(e => e.status === 'active' && TERMINAL_ACTIONS.has(e.action))
      .map(e => e.messageId)
      .filter((id): id is string => !!id),
  );

  // Outlook
  const outlookMsgs = await fetchRecentOutlook(outLimit);
  for (const m of outlookMsgs) {
    if (seen.has(m.id)) continue;
    const atts = await fetchOutlookAttachments(m.id);
    for (const a of atts) {
      if (a['@odata.type']?.includes('fileAttachment') &&
          a.contentType === 'application/pdf' &&
          a.contentBytes) {
        const item = await triageOne(
          'outlook',
          m.id,
          m.subject ?? '(no subject)',
          m.from?.emailAddress?.address ?? m.from?.emailAddress?.name ?? 'unknown',
          m.receivedDateTime ?? new Date().toISOString(),
          a.name ?? 'attachment.pdf',
          a.contentBytes,
        );
        if (item) out.push(item);
      }
    }
  }

  // Gmail
  const gmailMsgs = await fetchRecentGmail(gmailLimit);
  for (const m of gmailMsgs) {
    if (seen.has(m.id)) continue;
    const pdfPart = findPdfPart(m.payload?.parts);
    if (!pdfPart) continue;
    const base64 = await fetchGmailAttachment(m.id, pdfPart.attachmentId);
    if (!base64) continue;
    const headers = m.payload?.headers ?? [];
    const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value ?? '(no subject)';
    const from = headers.find(h => h.name.toLowerCase() === 'from')?.value ?? 'unknown';
    const receivedAt = m.internalDate ? new Date(Number(m.internalDate)).toISOString() : new Date().toISOString();
    const item = await triageOne(
      'gmail',
      m.id,
      subject,
      from,
      receivedAt,
      pdfPart.filename,
      base64,
    );
    if (item) out.push(item);
  }

  return out;
}
