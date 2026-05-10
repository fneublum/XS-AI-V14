// Autonomous reply drafter.
//
// Scans the inbox for unread emails (any — with or without attachment),
// classifies intent via Gemini, and if the sender is asking for a doc
// we already have in the DB, prepares a Graph / Gmail **draft** with
// the matching PDF attached. We never auto-send; the user reviews in
// their mail client.
//
// Chat feedback: one line per drafted reply goes through the existing
// `sx-doc-saved` event so it lands in the XS Agent feed.

import { analyzeDocument } from '../../services/geminiService';
import {
  getAccountFor, getTokenFor, getGoogleAccount, getTokenForGoogle,
} from '../../services/smailAuth';
import { getSupabaseClient } from '../../services/supabase';
import { generateInvoicePdf } from './pdf/invoicePdf';
import type { PdfInvoice, InvoicePdfCtx } from './pdf/types';
import { decideCorrection, fieldLabel } from './correctionsEngine';

// ─── Types ────────────────────────────────────────────────────────

export type ReplyIntent = 'document_request' | 'correction_request' | 'status_check' | 'greeting' | 'other';

export type CorrectionField =
  | 'grossWeight' | 'netWeight' | 'totalVolumes'
  | 'incoterm' | 'paymentTerms' | 'poa' | 'pod'
  | 'billToName' | 'soldTo'
  | 'other';           // anything we can't normalize — punts to manual review

export interface CorrectionClaim {
  field: CorrectionField;
  requestedValue: string | number | null;
  summary: string;
}

export interface ReplyAnalysis {
  intent: ReplyIntent;
  docType: 'INVOICE' | 'PURCHASE ORDER' | 'BILL OF LADING' | 'PACKING LIST' | null;
  refNumber: string | null;
  summary: string;
  correction?: CorrectionClaim | null;
}

export type ReplyAction =
  | 'drafted'
  | 'skipped'
  | 'no_match'
  | 'failed'
  | 'correction_proposed'
  | 'correction_confirmed_current'
  | 'correction_manual_only';

export interface ReplyResult {
  messageId: string;
  source: 'outlook' | 'gmail';
  from: string;
  fromAddress?: string;
  subject: string;
  receivedAt?: string;
  analysis: ReplyAnalysis;
  action: ReplyAction;
  message: string;
  error?: string;
  // Populated on `drafted` so the UI can "Send now" later.
  draftId?: string;
  replyTo?: string;
  replySubject?: string;
  entityKind?: string;
  entityId?: string;
  entityLabel?: string;
  // Correction-specific payload.
  correctionField?: CorrectionField;
  correctionCurrent?: string | number | null;
  correctionRequested?: string | number | null;
}

// ─── Email listing (unread, last 24h) ─────────────────────────────

interface EmailHit {
  id: string;
  source: 'outlook' | 'gmail';
  from: string;
  fromAddress: string;
  subject: string;
  bodyPreview: string;
  receivedAt: string;
}

async function listUnreadOutlook(limit = 15): Promise<EmailHit[]> {
  const acct = getAccountFor('automation') || getAccountFor('my');
  if (!acct) return [];
  const key = getAccountFor('automation') ? 'automation' : 'my';
  try {
    const token = await getTokenFor(key, ['Mail.Read']);
    const url = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$filter=isRead eq false&$top=${limit}&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,bodyPreview`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return [];
    const body = await res.json();
    return ((body?.value as any[]) ?? []).map(m => ({
      id: m.id,
      source: 'outlook' as const,
      from: m.from?.emailAddress?.name ?? m.from?.emailAddress?.address ?? 'unknown',
      fromAddress: m.from?.emailAddress?.address ?? '',
      subject: m.subject ?? '(no subject)',
      bodyPreview: (m.bodyPreview ?? '').slice(0, 1000),
      receivedAt: m.receivedDateTime ?? new Date().toISOString(),
    }));
  } catch { return []; }
}

async function listUnreadGmail(limit = 10): Promise<EmailHit[]> {
  const acct = getGoogleAccount();
  if (!acct) return [];
  try {
    const token = await getTokenForGoogle();
    const listRes = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=${limit}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!listRes.ok) return [];
    const listBody = await listRes.json();
    const ids = (listBody?.messages as Array<{ id: string }> | undefined) ?? [];
    const out: EmailHit[] = [];
    for (const { id } of ids) {
      const res = await fetch(
        `https://www.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) continue;
      const body = await res.json();
      const headers = (body?.payload?.headers as Array<{ name: string; value: string }> | undefined) ?? [];
      const headerVal = (name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
      out.push({
        id: body.id,
        source: 'gmail',
        from: headerVal('From'),
        fromAddress: (headerVal('From').match(/<([^>]+)>/)?.[1]) ?? headerVal('From'),
        subject: headerVal('Subject') || '(no subject)',
        bodyPreview: (body?.snippet ?? '').slice(0, 1000),
        receivedAt: body?.internalDate ? new Date(Number(body.internalDate)).toISOString() : new Date().toISOString(),
      });
    }
    return out;
  } catch { return []; }
}

// ─── Intent classification ────────────────────────────────────────

const INTENT_PROMPT = `Classify the intent of this email and extract any document reference number.
Return JSON:
{"intent": "document_request" | "correction_request" | "status_check" | "greeting" | "other",
 "docType": "INVOICE" | "PURCHASE ORDER" | "BILL OF LADING" | "PACKING LIST" | null,
 "refNumber": "string or null",
 "correction": {
    "field": "grossWeight" | "netWeight" | "totalVolumes" | "incoterm" | "paymentTerms" | "poa" | "pod" | "billToName" | "soldTo" | "other",
    "requestedValue": "string or number or null",
    "summary": "one phrase describing what should change"
 } | null,
 "summary": "one short sentence describing what the sender wants"}

Rules:
- "document_request": sender is asking to send / resend / share a doc (invoice, BL, PL, PO).
- "correction_request": sender says a value in an existing doc is WRONG and tells us the correct value. Extract the field they want changed + the requested value:
    * weight → grossWeight / netWeight (strip "kg"/"lbs"; return the number)
    * volumes / colli / bales / packages count → totalVolumes (integer)
    * incoterm code (FOB/CFR/CIF/EXW/etc.) → incoterm
    * payment terms text → paymentTerms
    * port of origin (code or name) → poa
    * port of destination → pod
    * bill-to company typo → billToName
    * sold-to company typo → soldTo
    * any other field → "other" (we'll route to manual review)
- "status_check": asking about status of a shipment/order without a doc / value correction.
- "greeting": auto-reply, out-of-office, thank-you, no action needed.
- "other": everything else.

If "correction_request", always populate the "correction" object. For all other intents, correction is null.
Return ONLY valid JSON, no commentary.`;

function parseJsonLoose(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const VALID_INTENTS: ReplyIntent[] = ['document_request', 'correction_request', 'status_check', 'greeting', 'other'];
const VALID_CORRECTION_FIELDS: CorrectionField[] = [
  'grossWeight', 'netWeight', 'totalVolumes',
  'incoterm', 'paymentTerms', 'poa', 'pod',
  'billToName', 'soldTo', 'other',
];

async function classifyIntent(subject: string, bodyPreview: string): Promise<ReplyAnalysis> {
  const context = `Subject: ${subject}\n\nBody:\n${bodyPreview}`;
  // analyzeDocument sends to Gemini as text. It accepts a base64 image
  // OR a plain text prompt when mime is text/plain. But the helper
  // signature expects base64 — for a text-only classification we
  // encode the context as a UTF-8 base64 string.
  const b64 = btoa(unescape(encodeURIComponent(context)));
  let raw = '';
  try {
    raw = String(await analyzeDocument(b64, 'text/plain', INTENT_PROMPT) ?? '');
  } catch { /* swallow */ }
  const parsed = parseJsonLoose(raw);
  if (!parsed) {
    return { intent: 'other', docType: null, refNumber: null, summary: 'Could not classify' };
  }
  const intent = (parsed.intent as string) || 'other';
  const safeIntent = (VALID_INTENTS.includes(intent as ReplyIntent) ? intent : 'other') as ReplyIntent;

  // Normalize the correction object if present.
  let correction: CorrectionClaim | null = null;
  const rawCorr = parsed.correction as Record<string, unknown> | null | undefined;
  if (safeIntent === 'correction_request' && rawCorr && typeof rawCorr === 'object') {
    const rawField = String(rawCorr.field ?? 'other');
    const field = (VALID_CORRECTION_FIELDS.includes(rawField as CorrectionField) ? rawField : 'other') as CorrectionField;
    const rv = rawCorr.requestedValue;
    const requestedValue =
      rv == null || rv === 'null' || rv === ''
        ? null
        : (typeof rv === 'number' ? rv : String(rv));
    correction = {
      field,
      requestedValue,
      summary: typeof rawCorr.summary === 'string' ? rawCorr.summary : '',
    };
  }

  return {
    intent: safeIntent,
    docType: (parsed.docType as any) ?? null,
    refNumber: typeof parsed.refNumber === 'string' && parsed.refNumber !== 'null' ? parsed.refNumber : null,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    correction,
  };
}

// ─── Match request to an existing record ─────────────────────────

async function findInvoiceByNumber(ref: string) {
  const sb = getSupabaseClient();
  const { data } = await sb.from('invoices')
    .select('*')
    .ilike('invoiceNumber', `%${ref.replace(/[#\s]/g, '')}%`)
    .limit(1);
  return (data as any[] | null)?.[0] ?? null;
}

// ─── Draft creation (Outlook + Gmail) ────────────────────────────

interface DraftPayload {
  to: string;
  subject: string;
  htmlBody: string;
  attachment?: { name: string; contentBytes: string; contentType: string };
}

async function createOutlookDraft(p: DraftPayload): Promise<string | null> {
  const acct = getAccountFor('automation') || getAccountFor('my');
  if (!acct) return null;
  const key = getAccountFor('automation') ? 'automation' : 'my';
  try {
    const token = await getTokenFor(key, ['Mail.ReadWrite']);
    const body: any = {
      subject: p.subject,
      body: { contentType: 'HTML', content: p.htmlBody },
      toRecipients: [{ emailAddress: { address: p.to } }],
    };
    if (p.attachment) {
      body.attachments = [{
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: p.attachment.name,
        contentBytes: p.attachment.contentBytes,
        contentType: p.attachment.contentType,
      }];
    }
    const res = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return (json?.id as string | undefined) ?? null;
  } catch { return null; }
}

async function createGmailDraft(p: DraftPayload): Promise<string | null> {
  const acct = getGoogleAccount();
  if (!acct) return null;
  try {
    const token = await getTokenForGoogle();
    const boundary = `boundary_${Date.now()}`;
    let raw = '';
    raw += `To: ${p.to}\r\n`;
    raw += `Subject: ${p.subject}\r\n`;
    raw += `MIME-Version: 1.0\r\n`;
    if (p.attachment) {
      raw += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;
      raw += `--${boundary}\r\n`;
      raw += `Content-Type: text/html; charset="UTF-8"\r\n\r\n`;
      raw += `${p.htmlBody}\r\n`;
      raw += `--${boundary}\r\n`;
      raw += `Content-Type: ${p.attachment.contentType}; name="${p.attachment.name}"\r\n`;
      raw += `Content-Disposition: attachment; filename="${p.attachment.name}"\r\n`;
      raw += `Content-Transfer-Encoding: base64\r\n\r\n`;
      raw += `${p.attachment.contentBytes}\r\n`;
      raw += `--${boundary}--\r\n`;
    } else {
      raw += `Content-Type: text/html; charset="UTF-8"\r\n\r\n`;
      raw += p.htmlBody;
    }
    const encoded = btoa(unescape(encodeURIComponent(raw)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await fetch('https://www.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw: encoded } }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return (json?.id as string | undefined) ?? null;
  } catch { return null; }
}

async function createDraft(hit: EmailHit, p: DraftPayload): Promise<string | null> {
  return hit.source === 'outlook'
    ? createOutlookDraft(p)
    : createGmailDraft(p);
}

// ─── Send an existing draft ───────────────────────────────────────

export async function sendOutlookDraft(draftId: string): Promise<boolean> {
  const acct = getAccountFor('automation') || getAccountFor('my');
  if (!acct) return false;
  const key = getAccountFor('automation') ? 'automation' : 'my';
  try {
    const token = await getTokenFor(key, ['Mail.Send']);
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${draftId}/send`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
    );
    return res.ok;
  } catch { return false; }
}

export async function sendGmailDraft(draftId: string): Promise<boolean> {
  const acct = getGoogleAccount();
  if (!acct) return false;
  try {
    const token = await getTokenForGoogle();
    const res = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/drafts/send`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draftId }),
      },
    );
    return res.ok;
  } catch { return false; }
}

export async function sendDraft(source: 'outlook' | 'gmail', draftId: string): Promise<boolean> {
  return source === 'outlook' ? sendOutlookDraft(draftId) : sendGmailDraft(draftId);
}

// ─── Public API ───────────────────────────────────────────────────

/** Scan unread inbox, classify intent, and create drafts for
 *  document requests we can fulfill. Returns one ReplyResult per
 *  unread email (including skipped ones, for UI logging). */
export async function runReplyDrafter(): Promise<ReplyResult[]> {
  const hits: EmailHit[] = [
    ...(await listUnreadOutlook(15)),
    ...(await listUnreadGmail(10)),
  ];
  const out: ReplyResult[] = [];
  for (const hit of hits) {
    try {
      const analysis = await classifyIntent(hit.subject, hit.bodyPreview);

      // Correction request: look up the invoice, compare claimed value
      // vs current DB value, propose an approval-gated update. Never
      // auto-mutates — only logs a proposal for the Corrections queue.
      if (analysis.intent === 'correction_request' && analysis.correction) {
        const invoice = analysis.refNumber ? await findInvoiceByNumber(analysis.refNumber) : null;
        if (!invoice) {
          out.push({
            messageId: hit.id, source: hit.source, from: hit.from, fromAddress: hit.fromAddress,
            subject: hit.subject, receivedAt: hit.receivedAt,
            analysis, action: 'no_match',
            message: `🛠️  ${hit.from} asked to correct ${analysis.refNumber ?? '(no ref)'} — invoice not found; review manually.`,
          });
          continue;
        }
        const decision = decideCorrection(invoice as Record<string, unknown>, analysis.correction);
        const entityLabel = `${invoice.invoiceNumber}${invoice.soldTo ? ` · ${invoice.soldTo}` : ''}`;
        if (decision.kind === 'already_correct') {
          out.push({
            messageId: hit.id, source: hit.source, from: hit.from, fromAddress: hit.fromAddress,
            subject: hit.subject, receivedAt: hit.receivedAt,
            analysis, action: 'correction_confirmed_current',
            message: `✅ ${hit.from} asked to correct ${fieldLabel(analysis.correction.field)} on ${invoice.invoiceNumber} — already matches current value (${decision.current}).`,
            entityKind: 'invoice', entityId: invoice.id, entityLabel,
            correctionField: analysis.correction.field,
            correctionCurrent: decision.current,
            correctionRequested: analysis.correction.requestedValue,
          });
          continue;
        }
        if (decision.kind === 'manual') {
          out.push({
            messageId: hit.id, source: hit.source, from: hit.from, fromAddress: hit.fromAddress,
            subject: hit.subject, receivedAt: hit.receivedAt,
            analysis, action: 'correction_manual_only',
            message: `🛠️  ${hit.from} requested a correction on ${invoice.invoiceNumber} — ${decision.reason} Review manually.`,
            entityKind: 'invoice', entityId: invoice.id, entityLabel,
            correctionField: analysis.correction.field,
            correctionRequested: analysis.correction.requestedValue,
          });
          continue;
        }
        // kind === 'propose'
        out.push({
          messageId: hit.id, source: hit.source, from: hit.from, fromAddress: hit.fromAddress,
          subject: hit.subject, receivedAt: hit.receivedAt,
          analysis, action: 'correction_proposed',
          message: `🛠️  ${hit.from} proposed fix on ${invoice.invoiceNumber}: ${fieldLabel(decision.field)} ${decision.current ?? '—'} → ${decision.requested}. Awaiting approval.`,
          entityKind: 'invoice', entityId: invoice.id, entityLabel,
          correctionField: decision.field,
          correctionCurrent: decision.current,
          correctionRequested: decision.requested,
        });
        continue;
      }

      if (analysis.intent !== 'document_request') {
        out.push({
          messageId: hit.id, source: hit.source, from: hit.from, fromAddress: hit.fromAddress,
          subject: hit.subject, receivedAt: hit.receivedAt,
          analysis, action: 'skipped',
          message: `⏭️  ${hit.from} — ${analysis.summary || 'not a doc request'}`,
        });
        continue;
      }

      // Document request — look up match. Right now we support invoices.
      if (analysis.docType !== 'INVOICE' && analysis.docType !== null) {
        out.push({
          messageId: hit.id, source: hit.source, from: hit.from, fromAddress: hit.fromAddress,
          subject: hit.subject, receivedAt: hit.receivedAt,
          analysis, action: 'no_match',
          message: `✉️ ${hit.from} asked for ${analysis.docType} ${analysis.refNumber ?? ''} — only Invoice drafting is wired; review manually.`,
        });
        continue;
      }

      const invoice = analysis.refNumber ? await findInvoiceByNumber(analysis.refNumber) : null;
      if (!invoice) {
        out.push({
          messageId: hit.id, source: hit.source, from: hit.from, fromAddress: hit.fromAddress,
          subject: hit.subject, receivedAt: hit.receivedAt,
          analysis, action: 'no_match',
          message: `✉️ ${hit.from} asked for Invoice ${analysis.refNumber ?? '(unspecified)'} — no match in DB; review manually.`,
        });
        continue;
      }

      // Generate the PDF with a minimal ctx. Email-driven flows don't
      // have the full company/customer/product lookups handy — the PDF
      // falls back to EC4 defaults for missing company data.
      const ctx: InvoicePdfCtx = {
        company: undefined, customers: [], suppliers: [], products: [],
        packingLists: [], bookings: [], ports: [], logoUrl: null, stampUrl: null,
      };
      const doc = generateInvoicePdf(invoice as PdfInvoice, ctx, false);
      const base64 = doc.output('datauristring').split(',')[1];

      const subject = `Re: ${hit.subject}`;
      const body = [
        `<p>Hello,</p>`,
        `<p>Attached is Invoice <strong>${invoice.invoiceNumber}</strong>${invoice.totalAmount ? ` for ${invoice.currency ?? 'USD'} ${Number(invoice.totalAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''} as requested.</p>`,
        `<p>Let us know if you need anything else.</p>`,
        `<p>Best regards,<br/>EC4 Enterprises</p>`,
      ].join('');

      const draftId = await createDraft(hit, {
        to: hit.fromAddress || hit.from,
        subject,
        htmlBody: body,
        attachment: {
          name: `Invoice_${invoice.invoiceNumber || invoice.id}.pdf`,
          contentBytes: base64,
          contentType: 'application/pdf',
        },
      });

      const entityLabel = `${invoice.invoiceNumber}${invoice.soldTo ? ` · ${invoice.soldTo}` : ''}`;

      out.push(draftId ? {
        messageId: hit.id, source: hit.source, from: hit.from, fromAddress: hit.fromAddress,
        subject: hit.subject, receivedAt: hit.receivedAt,
        analysis, action: 'drafted',
        message: `✉️ Draft reply to ${hit.from} — Invoice ${invoice.invoiceNumber} attached · review in ${hit.source === 'outlook' ? 'Outlook' : 'Gmail'} Drafts.`,
        draftId, replyTo: hit.fromAddress || hit.from, replySubject: subject,
        entityKind: 'invoice', entityId: invoice.id, entityLabel,
      } : {
        messageId: hit.id, source: hit.source, from: hit.from, fromAddress: hit.fromAddress,
        subject: hit.subject, receivedAt: hit.receivedAt,
        analysis, action: 'failed',
        message: `⚠️ Could not create draft for ${hit.from}`,
        error: 'draft-api-failed',
      });
    } catch (err) {
      out.push({
        messageId: hit.id, source: hit.source, from: hit.from, fromAddress: hit.fromAddress,
        subject: hit.subject, receivedAt: hit.receivedAt,
        analysis: { intent: 'other', docType: null, refNumber: null, summary: '' },
        action: 'failed',
        message: `⚠️ Reply drafter error on ${hit.from}`,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}
