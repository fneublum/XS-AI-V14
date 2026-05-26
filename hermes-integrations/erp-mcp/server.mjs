#!/usr/bin/env node
/**
 * erp-mcp — XS-AI ERP access tools for HERMES agents.
 *
 * Gives Max/Lara/Matt/Logan/Sal direct read+OCR access to the
 * XS-AI ERP (Supabase qfskvevighylzzmyiwre) without writing raw SQL.
 *
 * Tools:
 *   list_bookings(status?, customer?, limit?)
 *   lookup_booking(bookingNumber)
 *   bookings_with_cutoff_in_days(days)         — for daily briefing
 *   customer_outstanding(customerName)         — open invoice total
 *   recent_invoices(customerName?, limit?)
 *   ocr_and_save_booking(pdf_base64, source?)  — PDF → bookings row
 *
 * Credentials read from /Users/maxsmart/mcp-credentials/erp-credentials.json
 * Mirrors the bl-eta-mcp / quickbooks-mcp / container-tracking-mcp pattern.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'node:fs';

// ── Credentials ─────────────────────────────────────────────────────────────
const CREDS_PATH = process.env.ERP_CREDS || '/Users/maxsmart/mcp-credentials/erp-credentials.json';
const CREDS = JSON.parse(readFileSync(CREDS_PATH, 'utf8'));
const SUPABASE_URL   = CREDS.SUPABASE_URL;
const SUPABASE_KEY   = CREDS.SUPABASE_ANON_KEY;
const GEMINI_API_KEY = CREDS.GEMINI_API_KEY;

const sbHeaders = () => ({
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
});

// ── Date helpers (mirrors v2/lib/isoDate.ts) ─────────────────────────────────
function toIsoDate(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const y  = d.getUTCFullYear();
  const m  = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dy = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dy}`;
}

// ── Supabase REST helpers ────────────────────────────────────────────────────
async function sbSelect(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}
async function sbInsert(table, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST', headers: sbHeaders(), body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Supabase insert ${res.status}: ${await res.text()}`);
  return res.json();
}
async function sbUpdate(table, query, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Supabase update ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Gemini OCR ───────────────────────────────────────────────────────────────
const PROMPT_BOOKING = `Extract Booking Confirmation fields as JSON:
{"bookingNumber": string|null, "customer": string|null, "agentName": string|null, "vesselVoyage": string|null, "pol": string|null, "pod": string|null, "equipment": string|null, "etd": string|null, "eta": string|null, "cargoCutOff": string|null, "vgmCutOff": string|null, "draftCutOff": string|null, "freeTime": string|null, "terminal": string|null}
For pol and pod return ONLY the 5-letter UN/LOCODE (uppercase), never the city name.
Return ONLY valid JSON.`;

const PROMPT_INVOICE = `Extract commercial invoice fields as JSON:
{"invoiceNumber": string|null, "invoiceDate": string|null, "supplier": string|null, "soldTo": string|null, "billToName": string|null, "shipper": string|null, "consignee": string|null, "soNumber": string|null, "customerPo": string|null, "bookingNumber": string|null, "incoterm": string|null, "paymentTerms": string|null, "currency": string|null, "totalAmount": number|null, "subtotal": number|null, "grossWeight": number|null, "netWeight": number|null, "carrier": string|null, "pod": string|null, "containers": string|null}
Return ONLY valid JSON.`;

const PROMPT_BL = `Extract Bill of Lading fields as JSON:
{"blNumber": string|null, "shipper": string|null, "consignee": string|null, "notifyParty": string|null, "vesselVoyage": string|null, "portLoading": string|null, "portDischarge": string|null, "placeReceipt": string|null, "placeDelivery": string|null, "shippedDate": string|null, "container": string|null, "seal": string|null, "description": string|null, "grossWeight": string|null, "measurement": string|null, "packages": string|null, "freightPayable": string|null, "agentName": string|null}
For portLoading and portDischarge return the 5-letter UN/LOCODE when possible.
Return ONLY valid JSON.`;

const PROMPT_PL = `Extract Packing List fields as JSON:
{"plNumber": string|null, "blNumber": string|null, "shipper": string|null, "consignee": string|null, "shippingPoint": string|null, "destination": string|null, "date": string|null, "carrier": string|null, "containerNumber": string|null, "sealNumber": string|null, "vesselVoyage": string|null, "productDescription": string|null, "grossWeight": string|null, "netWeight": string|null, "poNumber": string|null, "soNumber": string|null, "supplier": string|null}
Return ONLY valid JSON.`;

async function geminiOcr(base64, prompt = PROMPT_BOOKING) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'application/pdf', data: base64 } },
          { text: prompt },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const j = await res.json();
  const text = j.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function pickNum(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d.\-]/g, ''));
    if (Number.isFinite(n) && v.trim() !== '') return n;
  }
  return null;
}

// ── Tool implementations ─────────────────────────────────────────────────────
async function listBookings({ status, customer, limit = 25 }) {
  const params = new URLSearchParams();
  params.set('select', 'bookingNumber,customer,vesselVoyage,pol,pod,equipment,etd,eta,cargoCutOff,status');
  params.set('order',  'createdAt.desc.nullslast');
  params.set('limit',  String(limit));
  if (status)   params.set('status',   `eq.${status}`);
  if (customer) params.set('customer', `ilike.*${customer}*`);
  const rows = await sbSelect(`bookings?${params}`);
  return { count: rows.length, bookings: rows };
}

async function lookupBooking({ bookingNumber }) {
  const params = new URLSearchParams();
  params.set('select', '*');
  params.set('bookingNumber', `eq.${bookingNumber}`);
  params.set('limit',  '1');
  const rows = await sbSelect(`bookings?${params}`);
  if (rows.length === 0) return { error: `Booking ${bookingNumber} not found` };
  const r = rows[0];
  // Strip the giant originalDocument from the response
  delete r.originalDocument;
  return r;
}

async function bookingsWithCutoffInDays({ days = 7 }) {
  const today    = new Date();
  const horizon  = new Date(today); horizon.setDate(today.getDate() + days);
  const params = new URLSearchParams();
  params.set('select', 'bookingNumber,customer,pol,pod,equipment,etd,cargoCutOff,vgmCutOff,vesselVoyage');
  params.set('status', 'eq.AVAILABLE');
  params.set('order',  'cargoCutOff.asc.nullslast');
  params.set('limit',  '100');
  const rows = await sbSelect(`bookings?${params}`);
  const todayStr = today.toISOString().slice(0, 10);
  const horizonStr = horizon.toISOString().slice(0, 10);
  const overdue  = [];
  const upcoming = [];
  for (const r of rows) {
    if (!r.cargoCutOff) continue;
    if (r.cargoCutOff <  todayStr) overdue.push(r);
    else if (r.cargoCutOff <= horizonStr) upcoming.push(r);
  }
  return { today: todayStr, horizon_days: days, overdue, upcoming };
}

async function customerOutstanding({ customerName }) {
  const params = new URLSearchParams();
  params.set('select', 'invoiceNumber,totalAmount,status,soldTo,invoiceDate');
  params.set('soldTo', `ilike.*${customerName}*`);
  params.set('status', 'neq.PAID');
  params.set('limit',  '200');
  const rows = await sbSelect(`invoices?${params}`);
  const total = rows.reduce((sum, r) => sum + (Number(r.totalAmount) || 0), 0);
  return {
    customer: customerName,
    open_invoice_count: rows.length,
    open_total_usd: Math.round(total * 100) / 100,
    invoices: rows.slice(0, 20),
  };
}

async function recentInvoices({ customerName, limit = 10 }) {
  const params = new URLSearchParams();
  params.set('select', 'invoiceNumber,soldTo,totalAmount,status,invoiceDate');
  params.set('order',  'invoiceDate.desc.nullslast');
  params.set('limit',  String(limit));
  if (customerName) params.set('soldTo', `ilike.*${customerName}*`);
  return sbSelect(`invoices?${params}`);
}

async function ocrAndSaveBooking({ pdf_base64, source = 'whatsapp' }) {
  if (!pdf_base64 || pdf_base64.length < 200) {
    return { error: 'pdf_base64 missing or too small' };
  }
  const parsed = await geminiOcr(pdf_base64, PROMPT_BOOKING);
  if (!parsed) return { error: 'OCR returned no parseable JSON' };

  const bookingNumber = (parsed.bookingNumber || '').trim() || `BK-${Date.now()}`;

  // Duplicate check
  const existing = await sbSelect(`bookings?bookingNumber=eq.${bookingNumber}&select=id&limit=1`);
  if (existing.length > 0) {
    const id = existing[0].id;
    await sbUpdate('bookings', `id=eq.${id}`, {
      originalDocument: `data:application/pdf;base64,${pdf_base64}`,
    });
    return {
      action: 'attached_to_existing',
      bookingNumber,
      id,
      message: `Booking ${bookingNumber} already existed — PDF attached.`,
    };
  }

  // Validate POL/POD against ports
  const validate = async (raw) => {
    if (!raw) return null;
    const code = String(raw).replace(/\s*-.*$/, '').trim().toUpperCase();
    if (!/^[A-Z]{5}$/.test(code)) return raw;
    const rows = await sbSelect(`ports?code=eq.${code}&select=code&limit=1`);
    return rows[0]?.code ?? code;
  };
  const [pol, pod] = await Promise.all([validate(parsed.pol), validate(parsed.pod)]);

  const row = {
    id:               `BK${Date.now()}`,
    bookingNumber,
    companyId:        null,
    customer:         parsed.customer || null,
    agentName:        parsed.agentName || null,
    vesselVoyage:     parsed.vesselVoyage || null,
    pol, pod,
    equipment:        parsed.equipment || null,
    etd:              toIsoDate(parsed.etd),
    eta:              toIsoDate(parsed.eta),
    cargoCutOff:      toIsoDate(parsed.cargoCutOff),
    vgmCutOff:        toIsoDate(parsed.vgmCutOff),
    draftCutOff:      toIsoDate(parsed.draftCutOff),
    freeTime:         parsed.freeTime || null,
    terminal:         parsed.terminal || null,
    originalDocument: `data:application/pdf;base64,${pdf_base64}`,
    status:           'AVAILABLE',
    createdAt:        new Date().toISOString(),
  };
  await sbInsert('bookings', row);
  return {
    action: 'inserted',
    bookingNumber,
    id: row.id,
    summary: {
      customer: row.customer,
      route: `${row.pol || '?'} → ${row.pod || '?'}`,
      equipment: row.equipment,
      etd: row.etd,
      cargoCutOff: row.cargoCutOff,
    },
    source,
  };
}

// ── Generic insert helpers used by Lara/Logan/Matt ────────────────────────────
//
// Pattern:
//  1. OCR pdf with type-specific prompt
//  2. Look up by natural key (invoiceNumber / blNumber / plNumber)
//  3. If exists → attach PDF + tag ai_source_email_id; return attached_to_existing
//  4. If new   → insert row, return inserted with summary
//
// All three set `ai_status='EXTRACTED'`, `ai_extracted_by='hermes'`,
// `ai_extracted_at=now`, and (when provided) `ai_source_email_id`. That
// lets the React app's Document Audit view distinguish hermes-auto rows.

async function ocrAndSaveInvoice({ pdf_base64, source = 'whatsapp', ai_source_email_id = null }) {
  if (!pdf_base64 || pdf_base64.length < 200) return { error: 'pdf_base64 missing or too small' };
  const parsed = await geminiOcr(pdf_base64, PROMPT_INVOICE);
  if (!parsed) return { error: 'OCR returned no parseable JSON' };

  const invoiceNumber = (parsed.invoiceNumber || '').trim() || `INV-${Date.now()}`;
  const existing = await sbSelect(`invoices?invoiceNumber=eq.${encodeURIComponent(invoiceNumber)}&select=id&limit=1`);
  if (existing.length > 0) {
    const id = existing[0].id;
    await sbUpdate('invoices', `id=eq.${id}`, {
      originalDocument: `data:application/pdf;base64,${pdf_base64}`,
      ai_source_email_id, ai_extracted_at: new Date().toISOString(),
    });
    return { action: 'attached_to_existing', invoiceNumber, id };
  }

  const row = {
    id: `INV${Date.now()}`,
    companyId:        null,
    invoiceNumber,
    supplier:         parsed.supplier || null,
    soldTo:           parsed.soldTo || null,
    billToName:       parsed.billToName || null,
    shipper:          parsed.shipper || null,
    consignee:        parsed.consignee || null,
    invoiceDate:      toIsoDate(parsed.invoiceDate),
    date:             toIsoDate(parsed.invoiceDate),
    soNumber:         parsed.soNumber || null,
    customerPo:       parsed.customerPo || null,
    bookingNumber:    parsed.bookingNumber || null,
    incoterm:         parsed.incoterm || null,
    paymentTerms:     parsed.paymentTerms || null,
    currency:         parsed.currency || 'USD',
    totalAmount:      pickNum(parsed.totalAmount),
    subtotal:         pickNum(parsed.subtotal),
    grossWeight:      pickNum(parsed.grossWeight),
    netWeight:        pickNum(parsed.netWeight),
    carrier:          parsed.carrier || null,
    pod:              parsed.pod || null,
    containers:       parsed.containers || null,
    originalDocument: `data:application/pdf;base64,${pdf_base64}`,
    status:           'DRAFT',
    ai_status:        'EXTRACTED',
    ai_extracted_by:  'hermes',
    ai_extracted_at:  new Date().toISOString(),
    ai_source_email_id,
    createdAt:        new Date().toISOString(),
  };
  await sbInsert('invoices', row);
  return {
    action: 'inserted',
    invoiceNumber,
    id: row.id,
    summary: { supplier: row.supplier, soldTo: row.soldTo, total: row.totalAmount, currency: row.currency },
    source,
  };
}

async function ocrAndSaveBl({ pdf_base64, source = 'whatsapp', ai_source_email_id = null }) {
  if (!pdf_base64 || pdf_base64.length < 200) return { error: 'pdf_base64 missing or too small' };
  const parsed = await geminiOcr(pdf_base64, PROMPT_BL);
  if (!parsed) return { error: 'OCR returned no parseable JSON' };

  const blNumber = (parsed.blNumber || '').trim() || `BL-${Date.now()}`;
  const existing = await sbSelect(`bill_landings?blNumber=eq.${encodeURIComponent(blNumber)}&select=id&limit=1`);
  if (existing.length > 0) {
    const id = existing[0].id;
    await sbUpdate('bill_landings', `id=eq.${id}`, {
      originalDocument: `data:application/pdf;base64,${pdf_base64}`,
      ai_source_email_id,
    });
    return { action: 'attached_to_existing', blNumber, id };
  }

  const row = {
    id: `BL${Date.now()}`,
    companyId:        null,
    blNumber,
    shipper:          parsed.shipper || null,
    consignee:        parsed.consignee || null,
    notifyParty:      parsed.notifyParty || null,
    vesselVoyage:     parsed.vesselVoyage || null,
    portLoading:      parsed.portLoading || null,
    portDischarge:    parsed.portDischarge || null,
    placeReceipt:     parsed.placeReceipt || null,
    placeDelivery:    parsed.placeDelivery || null,
    shippedDate:      toIsoDate(parsed.shippedDate),
    container:        parsed.container || null,
    seal:             parsed.seal || null,
    description:      parsed.description || null,
    grossWeight:      parsed.grossWeight || null,
    measurement:      parsed.measurement || null,
    packages:         parsed.packages || null,
    freightPayable:   parsed.freightPayable || null,
    agentName:        parsed.agentName || null,
    originalDocument: `data:application/pdf;base64,${pdf_base64}`,
    status:           'DRAFT',
    createdAt:        new Date().toISOString(),
  };
  await sbInsert('bill_landings', row);
  return {
    action: 'inserted',
    blNumber,
    id: row.id,
    summary: { shipper: row.shipper, consignee: row.consignee, vessel: row.vesselVoyage, route: `${row.portLoading || '?'}→${row.portDischarge || '?'}` },
    source,
  };
}

async function ocrAndSavePackingList({ pdf_base64, source = 'whatsapp', ai_source_email_id = null }) {
  if (!pdf_base64 || pdf_base64.length < 200) return { error: 'pdf_base64 missing or too small' };
  const parsed = await geminiOcr(pdf_base64, PROMPT_PL);
  if (!parsed) return { error: 'OCR returned no parseable JSON' };

  const plNumber = (parsed.plNumber || '').trim() || `PL-${Date.now()}`;
  const existing = await sbSelect(`packing_lists?plNumber=eq.${encodeURIComponent(plNumber)}&select=id&limit=1`);
  if (existing.length > 0) {
    const id = existing[0].id;
    await sbUpdate('packing_lists', `id=eq.${id}`, {
      originalDocument: `data:application/pdf;base64,${pdf_base64}`,
      ai_source_email_id, ai_extracted_at: new Date().toISOString(),
    });
    return { action: 'attached_to_existing', plNumber, id };
  }

  const row = {
    id: `PL${Date.now()}`,
    companyId:        null,
    plNumber,
    blNumber:         parsed.blNumber || null,
    shipper:          parsed.shipper || null,
    consignee:        parsed.consignee || null,
    shippingPoint:    parsed.shippingPoint || null,
    destination:      parsed.destination || null,
    date:             toIsoDate(parsed.date),
    carrier:          parsed.carrier || null,
    containerNumber:  parsed.containerNumber || null,
    sealNumber:       parsed.sealNumber || null,
    vesselVoyage:     parsed.vesselVoyage || null,
    productDescription: parsed.productDescription || null,
    grossWeight:      parsed.grossWeight || null,
    netWeight:        parsed.netWeight || null,
    poNumber:         parsed.poNumber || null,
    soNumber:         parsed.soNumber || null,
    supplier:         parsed.supplier || null,
    originalDocument: `data:application/pdf;base64,${pdf_base64}`,
    status:           'DRAFT',
    ai_status:        'EXTRACTED',
    ai_extracted_by:  'hermes',
    ai_extracted_at:  new Date().toISOString(),
    ai_source_email_id,
    createdAt:        new Date().toISOString(),
  };
  await sbInsert('packing_lists', row);
  return {
    action: 'inserted',
    plNumber,
    id: row.id,
    summary: { shipper: row.shipper, consignee: row.consignee, container: row.containerNumber, vessel: row.vesselVoyage },
    source,
  };
}

// ── MCP wiring ───────────────────────────────────────────────────────────────
const tools = [
  {
    name: 'list_bookings',
    description: 'List bookings from the XS-AI ERP. Optional filters: status (AVAILABLE/SHIPPED/...), customer (partial name match). Default limit 25.',
    inputSchema: {
      type: 'object',
      properties: {
        status:   { type: 'string', description: 'AVAILABLE | SHIPPED | DELIVERED' },
        customer: { type: 'string', description: 'Partial customer name (case-insensitive)' },
        limit:    { type: 'number', description: 'Max rows (default 25)' },
      },
    },
  },
  {
    name: 'lookup_booking',
    description: 'Get full details for one booking by booking number (e.g. "271230293").',
    inputSchema: {
      type: 'object',
      properties: { bookingNumber: { type: 'string' } },
      required: ['bookingNumber'],
    },
  },
  {
    name: 'bookings_with_cutoff_in_days',
    description: 'Return AVAILABLE bookings split into overdue and upcoming groups for the next N days. Use for cut-off briefings and reminders.',
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Horizon in days (default 7)' } },
    },
  },
  {
    name: 'customer_outstanding',
    description: 'Return open (unpaid) invoices and total outstanding USD for a customer (partial name match).',
    inputSchema: {
      type: 'object',
      properties: { customerName: { type: 'string' } },
      required: ['customerName'],
    },
  },
  {
    name: 'recent_invoices',
    description: 'Return the most recent invoices, optionally filtered by customer name.',
    inputSchema: {
      type: 'object',
      properties: {
        customerName: { type: 'string', description: 'Optional partial customer name' },
        limit:        { type: 'number', description: 'Default 10' },
      },
    },
  },
  {
    name: 'ocr_and_save_booking',
    description: 'OCR a booking confirmation PDF (base64) via Gemini 2.5 Flash and insert as a new AVAILABLE row in bookings. If the bookingNumber already exists, only the PDF is re-attached. Use whenever a booking PDF arrives via WhatsApp or email.',
    inputSchema: {
      type: 'object',
      properties: {
        pdf_base64:          { type: 'string', description: 'Raw base64 of the PDF (no data: prefix)' },
        source:              { type: 'string', description: 'Optional source tag (whatsapp/email/etc)' },
        ai_source_email_id:  { type: 'string', description: 'Optional source email message-id for audit trail' },
      },
      required: ['pdf_base64'],
    },
  },
  {
    name: 'ocr_and_save_invoice',
    description: 'OCR a commercial invoice PDF (base64) and insert as a new DRAFT row in invoices. Deduplicated by invoiceNumber — re-attaches PDF if already present. Use when Lara classifies an attachment as INVOICE.',
    inputSchema: {
      type: 'object',
      properties: {
        pdf_base64:         { type: 'string' },
        source:             { type: 'string' },
        ai_source_email_id: { type: 'string' },
      },
      required: ['pdf_base64'],
    },
  },
  {
    name: 'ocr_and_save_bl',
    description: 'OCR a Bill of Lading PDF (base64) and insert as a new DRAFT row in bill_landings. Deduplicated by blNumber. Use when Lara/Logan see a BL attachment.',
    inputSchema: {
      type: 'object',
      properties: {
        pdf_base64:         { type: 'string' },
        source:             { type: 'string' },
        ai_source_email_id: { type: 'string' },
      },
      required: ['pdf_base64'],
    },
  },
  {
    name: 'ocr_and_save_packing_list',
    description: 'OCR a Packing List PDF (base64) and insert as a new DRAFT row in packing_lists. Deduplicated by plNumber. Use when Lara/Logan see a packing-list attachment.',
    inputSchema: {
      type: 'object',
      properties: {
        pdf_base64:         { type: 'string' },
        source:             { type: 'string' },
        ai_source_email_id: { type: 'string' },
      },
      required: ['pdf_base64'],
    },
  },
];

const server = new Server(
  { name: 'erp', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    let result;
    switch (name) {
      case 'list_bookings':                 result = await listBookings(args || {}); break;
      case 'lookup_booking':                result = await lookupBooking(args); break;
      case 'bookings_with_cutoff_in_days':  result = await bookingsWithCutoffInDays(args || {}); break;
      case 'customer_outstanding':          result = await customerOutstanding(args); break;
      case 'recent_invoices':               result = await recentInvoices(args || {}); break;
      case 'ocr_and_save_booking':          result = await ocrAndSaveBooking(args); break;
      case 'ocr_and_save_invoice':          result = await ocrAndSaveInvoice(args); break;
      case 'ocr_and_save_bl':               result = await ocrAndSaveBl(args); break;
      case 'ocr_and_save_packing_list':     result = await ocrAndSavePackingList(args); break;
      default: throw new Error(`Unknown tool: ${name}`);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
