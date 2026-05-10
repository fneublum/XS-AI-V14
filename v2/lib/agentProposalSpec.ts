// Shared proposal-extraction spec — used by both the
// AgentOrderWorkflowDrawer (re-extract on an existing row) and the
// list-level "OCR new proposal" entry point on AgentSalesOrdersV2.

import type { WorkBook } from 'xlsx';
import * as XLSX from 'xlsx';

export interface ProposalDraft {
  sellerName: string;
  customerName: string;
  orderNumber: string;
  incoterm: string;
  paymentTerms: string;
  pod: string;
  deliveryDate: string;
  items: Array<{ description: string; quantity: number; unit: string; unitPrice: number; total: number }>;
  originalDocument: string | null;
}

export const PROPOSAL_PROMPT = `You are extracting fields from a SUPPLIER PROPOSAL document sent to
a sales agent. Return JSON with these keys exactly — missing values
must be null.

{
  "sellerName":   string | null,
  "customerName": string | null,
  "orderNumber":  string | null,
  "incoterm":     "FOB"|"CFR"|"CIF"|"EXW"|"DAP"|"DDP" | null,
  "paymentTerms": string | null,
  "pod":          string | null,
  "deliveryDate": string | null,
  "items": [
    { "description": string, "quantity": number|null, "unit": string|null, "unitPrice": number|null, "total": number|null }
  ]
}

Return ONLY valid JSON — no markdown fences, no commentary.`;

// Local XLSX → ProposalDraft. Mirrors the v1 SOPICIComissions.tsx
// logic: scan the first 10 rows for a header row that mentions
// product / item / description / color, then read each subsequent row
// where col 0/1 is the description and the next 1–3 numeric values
// are interpreted as qty / unitPrice / amount. If only qty +
// unitPrice are found, amount is computed.
export function parseProposalXlsx(workbook: WorkBook): ProposalDraft | null {
  const items: ProposalDraft['items'] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const row = rows[i];
      if (!Array.isArray(row)) continue;
      const rowStr = row.map(c => String(c ?? '')).join(' ').toLowerCase();
      if (/(product|item|description|color)/.test(rowStr)) {
        headerRowIndex = i;
        break;
      }
    }
    const startRow = headerRowIndex >= 0 ? headerRowIndex + 1 : 1;
    for (let i = startRow; i < rows.length; i++) {
      const row = rows[i];
      if (!Array.isArray(row) || row.length < 2) continue;
      const desc = String(row[0] ?? row[1] ?? '').trim();
      if (!desc || desc.length < 2) continue;
      let qty = 0, unitPrice = 0, amount = 0;
      for (let j = 1; j < row.length; j++) {
        const val = parseFloat(String(row[j]));
        if (!Number.isNaN(val) && val > 0) {
          if (qty === 0) qty = val;
          else if (unitPrice === 0) unitPrice = val;
          else if (amount === 0) amount = val;
        }
      }
      if (amount === 0) amount = qty * unitPrice;
      if (qty > 0) {
        items.push({ description: desc, quantity: qty, unit: 'Kgs', unitPrice, total: amount });
      }
    }
  }
  if (items.length === 0) return null;
  return {
    sellerName:   '',
    customerName: '',
    orderNumber:  '',
    incoterm:     '',
    paymentTerms: '',
    pod:          '',
    deliveryDate: '',
    originalDocument: null,
    items,
  };
}

// Coerce common supplier-side unit spellings into the canonical
// values our picker offers. Mirrors the version in
// AgentOrderWorkflowDrawer.tsx.
function normalizeUnitToken(raw: string): string {
  const s = (raw ?? '').trim();
  if (!s) return 'Lbs';
  const u = s.toLowerCase();
  if (u === 'lb' || u === 'lbs' || u === 'pound' || u === 'pounds') return 'Lbs';
  if (u === 'kg' || u === 'kgs' || u === 'kilo' || u === 'kilos' || u === 'kilogram' || u === 'kilograms') return 'Kgs';
  if (u === 'mt' || u === 'mton' || u === 'tonne' || u === 'tonnes' || u === 'ton' || u === 'tons' || u === 'metric ton' || u === 'metric tons') return 'MT';
  if (u === 'bag' || u === 'bags') return 'Bags';
  if (u === 'bale' || u === 'bales') return 'Bales';
  if (u === 'pc' || u === 'pcs' || u === 'piece' || u === 'pieces') return 'Pcs';
  if (u === 'set' || u === 'sets') return 'Sets';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function normalizeProposal(parsed: Record<string, unknown>): ProposalDraft {
  const str = (k: string): string => {
    const v = parsed[k];
    return typeof v === 'string' ? v.trim() : '';
  };
  const rawItems = Array.isArray(parsed.items) ? parsed.items as any[] : [];
  return {
    sellerName:   str('sellerName'),
    customerName: str('customerName'),
    orderNumber:  str('orderNumber'),
    incoterm:     str('incoterm').toUpperCase(),
    paymentTerms: str('paymentTerms'),
    pod:          str('pod'),
    deliveryDate: str('deliveryDate'),
    originalDocument: null,
    items: rawItems.map(it => ({
      description: String(it?.description ?? ''),
      quantity:    Number(it?.quantity) || 0,
      unit:        normalizeUnitToken(String(it?.unit ?? 'Lbs')),
      unitPrice:   Number(it?.unitPrice) || 0,
      total:       Number(it?.total) || (Number(it?.quantity ?? 0) * Number(it?.unitPrice ?? 0)),
    })),
  };
}
