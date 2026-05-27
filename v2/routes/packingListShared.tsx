// Shared packing-list config for list + engine routes.

import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Input, FormField, Label, Button } from '../primitives';
import { SupabaseSelectField } from '../components/SupabaseSelectField';
import { FieldDef } from '../components/QuickCreateDrawer';
import { AiUploadModalConfig } from '../components/AiUploadModal';
import { useProducts } from '../queries/useProducts';
import { useCompany } from '../providers/CompanyProvider';
import { useCompanies } from '../queries/useCompanies';
import { useEntityInsert } from '../queries/useEntityMutations';
import { useToast } from '../primitives/Toast';
import { useQueryClient } from '@tanstack/react-query';
import { Plus as PlusIcon } from 'lucide-react';

export const PL_STATUS_OPTIONS = [
  'DRAFT', 'ISSUED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED',
] as const;

export type PLStatus = typeof PL_STATUS_OPTIONS[number];

/** Incoterm quick-pick options shown as autocomplete suggestions in
 *  the Freight terms field. Saved value is the full "CODE (Name)"
 *  string so the long form stays visible on the PL record. Free-text
 *  entry is still accepted for any custom term. */
// Full Incoterms 2020 standard. Order follows the official ICC rule
// grouping (E → F → C → D) so the picker reads naturally.
export const INCOTERM_CODES = [
  'EXW (Ex Works)',
  'FCA (Free Carrier)',
  'FAS (Free Alongside Ship)',
  'FOB (Free on Board)',
  'CFR (Cost and Freight)',
  'CIF (Cost + Insurance + Freight)',
  'CPT (Carriage Paid To)',
  'CIP (Carriage and Insurance Paid To)',
  'DAP (Delivered at Place)',
  'DPU (Delivered at Place Unloaded)',
  'DDP (Delivered Duty Paid)',
] as const;

/** Map any raw Incoterm string (OCR output like "EXWORKS", "ex works",
 *  "cost and freight", variants with punctuation) to the canonical
 *  quick-pick option. Falls back to the original string when nothing
 *  matches — the user can still save a custom term. */
export function normalizeIncoterm(raw: string): string {
  const key = raw.toUpperCase().replace(/[^A-Z]/g, '');
  if (!key) return raw;
  const aliases: Record<string, string> = {
    EXW: 'EXW (Ex Works)',
    EXWORKS: 'EXW (Ex Works)',
    FCA: 'FCA (Free Carrier)',
    FREECARRIER: 'FCA (Free Carrier)',
    FAS: 'FAS (Free Alongside Ship)',
    FREEALONGSIDESHIP: 'FAS (Free Alongside Ship)',
    FOB: 'FOB (Free on Board)',
    FREEONBOARD: 'FOB (Free on Board)',
    CFR: 'CFR (Cost and Freight)',
    CANDF: 'CFR (Cost and Freight)',
    COSTANDFREIGHT: 'CFR (Cost and Freight)',
    CIF: 'CIF (Cost + Insurance + Freight)',
    COSTINSURANCEANDFREIGHT: 'CIF (Cost + Insurance + Freight)',
    CPT: 'CPT (Carriage Paid To)',
    CARRIAGEPAIDTO: 'CPT (Carriage Paid To)',
    CIP: 'CIP (Carriage and Insurance Paid To)',
    CARRIAGEANDINSURANCEPAIDTO: 'CIP (Carriage and Insurance Paid To)',
    DAP: 'DAP (Delivered at Place)',
    DELIVEREDATPLACE: 'DAP (Delivered at Place)',
    DPU: 'DPU (Delivered at Place Unloaded)',
    DELIVEREDATPLACEUNLOADED: 'DPU (Delivered at Place Unloaded)',
    DDP: 'DDP (Delivered Duty Paid)',
    DELIVEREDDUTYPAID: 'DDP (Delivered Duty Paid)',
  };
  return aliases[key] ?? raw;
}

export interface PLContainer {
  containerNo: string;
  sealNo: string;
  grossLbs: number | null;
  netLbs: number | null;
  grossKg: number | null;
  netKg: number | null;
  volumes: number | null;
  supplier: string;
  /** Description as it appears on the PL document (free text). */
  description: string;
  /** Linked catalog product name. Picked via dropdown. */
  systemProduct: string;
  blNumber: string;
  unitPrice: number | null;
  totalValue: number | null;
}

export interface PLDraft {
  // Header
  plNumber: string;
  soNumber: string;
  blNumber: string;
  poNumber: string;
  invoiceNumber: string;
  bookingNumber: string;
  shipper: string;
  supplier: string;
  consignee: string;
  carrier: string;
  containerNumber: string;
  sealNumber: string;
  vesselVoyage: string;
  shippingPoint: string;
  destination: string;
  productDescription: string;
  grossWeight: string;
  netWeight: string;
  unitCount: string;
  freightTerms: string;
  currency: string;
  totalValue: string;
  status: string;
  scheduledShipDate: string;
  date: string;
  notes: string;
  /** Source PDF as a data URL (base64 encoded) — persisted so the row
   *  can be re-viewed later. Mirrors V1's PLEngine.originalDocument. */
  originalDocument: string;
  // Line items / containers
  containers: PLContainer[];
}

export const emptyPLDraft = (): PLDraft => ({
  plNumber: '', soNumber: '', blNumber: '', poNumber: '', invoiceNumber: '',
  bookingNumber: '',
  shipper: '', supplier: '', consignee: '', carrier: '',
  containerNumber: '', sealNumber: '', vesselVoyage: '',
  shippingPoint: '', destination: '',
  productDescription: '', grossWeight: '', netWeight: '', unitCount: '',
  freightTerms: '', currency: '', totalValue: '',
  status: 'DRAFT', scheduledShipDate: '', date: '', notes: '',
  originalDocument: '',
  containers: [],
});

/** Normalize a container number — strip whitespace / punctuation and
 *  uppercase. Matches V1's PLEngine.formatContainerNumber. */
export const formatContainerNumber = (raw: string): string =>
  raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

export const packingListFields: FieldDef[] = [
  { key: 'plNumber',          label: 'PL #', required: true, mono: true },
  { key: 'soNumber',          label: 'SO #', mono: true },
  { key: 'blNumber',          label: 'B/L #', mono: true },
  { key: 'poNumber',          label: 'PO #', mono: true },
  { key: 'invoiceNumber',     label: 'Invoice #', mono: true },
  { key: 'bookingNumber',     label: 'Booking #', mono: true },
  { key: 'shipper', label: 'Shipper',
    source: {
      table: 'customers', valueColumn: 'name', labelColumn: 'name',
      secondaryColumn: 'country', scopeByCompany: true,
      sharedWithColumn: 'sharedWith',
    } },
  { key: 'supplier',          label: 'Supplier' },
  { key: 'consignee', label: 'Consignee',
    source: {
      table: 'customers', valueColumn: 'name', labelColumn: 'name',
      secondaryColumn: 'country', scopeByCompany: true,
      sharedWithColumn: 'sharedWith',
    } },
  { key: 'carrier', label: 'Carrier',
    source: {
      table: 'carriers', valueColumn: 'name', labelColumn: 'name',
      secondaryColumn: 'scac', scopeByCompany: true,
    } },
  { key: 'containerNumber',   label: 'Container', mono: true },
  { key: 'sealNumber',        label: 'Seal #', mono: true },
  { key: 'vesselVoyage',      label: 'Vessel / voyage' },
  { key: 'shippingPoint',     label: 'Shipping point (POL)' },
  { key: 'destination',       label: 'Destination (POD)' },
  { key: 'productDescription',label: 'Product description' },
  { key: 'grossWeight',       label: 'Gross weight' },
  { key: 'netWeight',         label: 'Net weight' },
  { key: 'unitCount',         label: 'Units (bales/cartons/…)' },
  { key: 'freightTerms',      label: 'Freight terms (Incoterm)' },
  { key: 'currency',          label: 'Currency', mono: true },
  { key: 'totalValue',        label: 'Total value' },
  { key: 'status',            label: 'Status', type: 'select',
    options: [...PL_STATUS_OPTIONS],
    defaultValue: 'DRAFT' },
  { key: 'scheduledShipDate', label: 'Scheduled ship', type: 'date' },
  { key: 'date',              label: 'Actual ship', type: 'date' },
  { key: 'notes',             label: 'Notes' },
];

export const PL_PROMPT = `You are extracting PACKING-LIST data from a
shipping document. The document may be a formal packing list, a
commercial invoice carrying packing data (container #, seal #, gross
and net weights, material description), or a straight B/L. Always
extract the packing data wherever you find it. Return JSON with
exactly these keys; missing values must be null.

{
  "plNumber":          string | null,
  "soNumber":          string | null,
  "blNumber":          string | null,
  "poNumber":          string | null,
  "invoiceNumber":     string | null,
  "bookingNumber":     string | null,
  "shipper":           string | null,
  "supplier":          string | null,
  "consignee":         string | null,
  "carrier":           string | null,
  "containerNumber":   string | null,
  "sealNumber":        string | null,
  "vesselVoyage":      string | null,
  "shippingPoint":     string | null,
  "destination":       string | null,
  "productDescription":string | null,
  "grossWeight":       string | null,
  "netWeight":         string | null,
  "unitCount":         string | null,
  "freightTerms":      string | null,
  "currency":          string | null,
  "totalValue":        number | null,
  "status":            "DRAFT" | "ISSUED" | "CONFIRMED" | "SHIPPED" | "DELIVERED" | "CANCELLED" | null,
  "scheduledShipDate": string | null,
  "date":              string | null,
  "notes":             string | null,
  "containers": [
    {
      "containerNo":   string | null,
      "sealNo":        string | null,
      "grossLbs":      number | null,
      "netLbs":        number | null,
      "grossKg":       number | null,
      "netKg":         number | null,
      "volumes":       number | null,
      "supplier":      string | null,
      "description":   string | null,
      "blNumber":      string | null,
      "unitPrice":     number | null,
      "totalValue":    number | null
    }
  ]
}

Rules (CRITICAL — follow exactly):
- Convert all dates to YYYY-MM-DD.
- Numeric values must be numbers (no currency symbols, no units inside
  the number).
- If weights are only in KG, convert to LBS (1 KG = 2.20462 LBS). If
  only in LBS, convert to KG.
- "volumes" is the per-container quantity count (e.g. bales, cartons,
  pallets) as a number.
- CONTAINERS ARRAY IS MANDATORY: even if the document describes only ONE
  container, return a "containers" array with exactly one populated
  object. NEVER return an empty array or an array containing an empty
  object. Each container entry MUST include: containerNo, sealNo,
  grossLbs, netLbs, grossKg, netKg, volumes, supplier, description —
  any field genuinely absent from the document may be null, but do not
  skip fields that ARE on the document.
- "supplier" and "description" capture the MATERIAL / MANUFACTURER info
  per container and MUST be filled whenever the document mentions a
  product or supplier.
- When the doc lists multiple containers, fill the array with one
  object per container. Also copy the first container's number and
  seal into the top-level "containerNumber" and "sealNumber" fields.
- "freightTerms" is the Incoterm (CFR, FOB, CIF, EXW, DAP, …).
- Return ONLY valid JSON. No markdown fences, no commentary.`;

const str = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
const numOrNull = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) && n !== 0 ? n : null;
  }
  return null;
};
/** Convert a raw weight / quantity value into a numeric string —
 *  strips embedded units ("lbs", "kg", "gross", commas, etc.) so the
 *  field shows only digits (and optional decimal). Returns '' when the
 *  input has no digits. */
const stripToNumber = (v: unknown): string => {
  const n = numOrNull(v);
  return n == null ? '' : String(Math.round(n));
};

/** Picks the first defined value across several key candidates — lets
 *  us tolerate Gemini returning snake_case, alt names, etc. */
const pick = <T,>(r: Record<string, unknown>, ...keys: string[]): T | undefined => {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== null) return r[k] as T;
  }
  return undefined;
};

function normalizeContainer(raw: unknown): PLContainer {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    containerNo:   formatContainerNumber(str(pick(r, 'containerNo', 'container_no', 'containerNumber', 'container_number', 'container'))),
    sealNo:        str(pick(r, 'sealNo', 'seal_no', 'sealNumber', 'seal_number', 'seal')),
    grossLbs:      numOrNull(pick(r, 'grossLbs', 'gross_lbs', 'grossWeightLbs', 'grossWeight', 'gross_weight_lbs', 'gross_weight', 'gross')),
    netLbs:        numOrNull(pick(r, 'netLbs', 'net_lbs', 'netWeightLbs', 'netWeight', 'net_weight_lbs', 'net_weight', 'net')),
    grossKg:       numOrNull(pick(r, 'grossKg', 'gross_kg', 'grossWeightKg', 'gross_weight_kg')),
    netKg:         numOrNull(pick(r, 'netKg', 'net_kg', 'netWeightKg', 'net_weight_kg')),
    volumes:       numOrNull(pick(r, 'volumes', 'volume', 'qty', 'quantity', 'units', 'unitCount', 'unit_count')),
    supplier:      str(pick(r, 'supplier', 'manufacturer', 'vendor', 'seller')),
    description:   str(pick(r, 'description', 'productDescription', 'product_description', 'material', 'materialDescription', 'material_description', 'product')),
    systemProduct: str(pick(r, 'systemProduct', 'system_product')),
    blNumber:      str(pick(r, 'blNumber', 'bl_number', 'billOfLading', 'bill_of_lading')),
    unitPrice:     numOrNull(pick(r, 'unitPrice', 'unit_price', 'price', 'pricePerUnit')),
    totalValue:    numOrNull(pick(r, 'totalValue', 'total_value', 'total', 'amount', 'totalAmount')),
  };
}

/** Fallback PL number when the OCR doesn't find one on the document.
 *  Format: `PL-99999` (5-digit suffix derived from the current timestamp
 *  so parallel extractions in a batch stay unique). */
export function generatePLNumber(): string {
  const suffix = Math.floor(Date.now() % 100000).toString().padStart(5, '0');
  return `PL-${suffix}`;
}

export function normalizePLJson(parsed: Record<string, unknown>): PLDraft {
  const status = str(parsed.status).toUpperCase();
  const containersRaw = Array.isArray(parsed.containers) ? parsed.containers : [];
  let containers = containersRaw.map(normalizeContainer);
  const totalValue = numOrNull(parsed.totalValue);
  const plNumber = str(parsed.plNumber) || generatePLNumber();

  // Fallback: some OCR responses put everything at the header level and
  // either omit the `containers` array entirely OR return an empty
  // object inside it. In either case, synthesize one container from
  // the header so the sheet isn't blank.
  const firstIsEmpty = (c: PLContainer | undefined): boolean =>
    !c || (
      !c.containerNo && !c.sealNo && !c.supplier && !c.description &&
      c.grossLbs == null && c.netLbs == null &&
      c.volumes == null && c.totalValue == null
    );
  const headerContainerNo = formatContainerNumber(str(parsed.containerNumber));
  const headerSupplier = str(parsed.supplier);
  const headerDescription = str(parsed.productDescription);
  const headerGrossLbs = numOrNull(parsed.grossWeight);
  const headerNetLbs = numOrNull(parsed.netWeight);
  const hasHeaderData = !!(headerContainerNo || headerSupplier || headerDescription
    || headerGrossLbs != null || headerNetLbs != null);
  if ((containers.length === 0 || firstIsEmpty(containers[0])) && hasHeaderData) {
    const synth: PLContainer = {
      containerNo: headerContainerNo,
      sealNo: str(parsed.sealNumber),
      grossLbs: headerGrossLbs,
      netLbs: headerNetLbs,
      grossKg: headerGrossLbs == null ? null : Math.round(headerGrossLbs * 0.453592),
      netKg:   headerNetLbs   == null ? null : Math.round(headerNetLbs   * 0.453592),
      volumes: numOrNull(parsed.unitCount),
      supplier: headerSupplier,
      description: headerDescription,
      systemProduct: '',
      blNumber: '',
      unitPrice: numOrNull(parsed.unitPrice),
      totalValue: numOrNull(parsed.totalValue),
    };
    containers = containers.length === 0 ? [synth] : [synth, ...containers.slice(1)];
  }
  return {
    plNumber,
    soNumber:           str(parsed.soNumber),
    blNumber:           str(parsed.blNumber),
    poNumber:           str(parsed.poNumber),
    invoiceNumber:      str(parsed.invoiceNumber),
    bookingNumber:      str(parsed.bookingNumber),
    shipper:            str(parsed.shipper),
    supplier:           str(parsed.supplier),
    consignee:          str(parsed.consignee),
    carrier:            str(parsed.carrier),
    containerNumber:    str(parsed.containerNumber) || containers[0]?.containerNo || '',
    sealNumber:         str(parsed.sealNumber) || containers[0]?.sealNo || '',
    vesselVoyage:       str(parsed.vesselVoyage),
    shippingPoint:      str(parsed.shippingPoint),
    destination:        str(parsed.destination),
    productDescription: str(parsed.productDescription),
    grossWeight:        stripToNumber(parsed.grossWeight),
    netWeight:          stripToNumber(parsed.netWeight),
    unitCount:          str(parsed.unitCount),
    freightTerms:       normalizeIncoterm(str(parsed.freightTerms)),
    currency:           str(parsed.currency).toUpperCase(),
    totalValue:         totalValue == null ? '' : String(totalValue),
    status:             ((PL_STATUS_OPTIONS as readonly string[]).includes(status) ? status : 'DRAFT'),
    scheduledShipDate:  str(parsed.scheduledShipDate),
    date:               str(parsed.date),
    notes:              str(parsed.notes),
    originalDocument:   str(parsed.originalDocument),
    containers,
  };
}

/** Convert a saved `packing_lists` row (raw Supabase response) into a
 *  PLDraft for the PLReviewForm. Handles the JSON-encoded containers
 *  column and normalizes missing/variant keys. */
export function plRowToDraft(row: Record<string, unknown>): PLDraft {
  const rawContainers = row.containers;
  let containers: PLContainer[] = [];
  // Some fields (bookingNumber, invoiceNumber) don't have a dedicated DB
  // column on every environment. We persist them inside the containers
  // JSON as `__meta` so they survive saves even without a migration.
  let metaBooking = '';
  let metaInvoice = '';
  try {
    let parsed: unknown = rawContainers;
    if (typeof rawContainers === 'string') {
      const trimmed = rawContainers.trim();
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        parsed = JSON.parse(trimmed);
      }
    }
    if (Array.isArray(parsed)) {
      containers = parsed.map(normalizeContainer);
    } else if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.items)) containers = obj.items.map(normalizeContainer);
      const meta = (obj.__meta && typeof obj.__meta === 'object' ? obj.__meta : {}) as Record<string, unknown>;
      if (typeof meta.bookingNumber === 'string') metaBooking = meta.bookingNumber;
      if (typeof meta.invoiceNumber === 'string') metaInvoice = meta.invoiceNumber;
    }
  } catch { /* ignore malformed JSON */ }
  const totalVal = numOrNull(row.totalValue);
  return {
    plNumber:           str(row.plNumber) || str(row.id),
    soNumber:           str(row.soNumber),
    blNumber:           str(row.blNumber),
    poNumber:           str(row.poNumber),
    invoiceNumber:      str(row.invoiceNumber) || metaInvoice,
    bookingNumber:      str(row.bookingNumber) || metaBooking,
    shipper:            str(row.shipper),
    supplier:           str(row.supplier),
    consignee:          str(row.consignee),
    carrier:            str(row.carrier),
    containerNumber:    str(row.containerNumber),
    sealNumber:         str(row.sealNumber),
    vesselVoyage:       str(row.vesselVoyage),
    shippingPoint:      str(row.shippingPoint),
    destination:        str(row.destination),
    productDescription: str(row.productDescription),
    grossWeight:        stripToNumber(row.grossWeight),
    netWeight:          stripToNumber(row.netWeight),
    unitCount:          str(row.unitCount),
    freightTerms:       str(row.freightTerms),
    currency:           str(row.currency),
    totalValue:         totalVal == null ? '' : String(totalVal),
    status:             str(row.status) || 'DRAFT',
    scheduledShipDate:  str(row.scheduledShipDate),
    date:               str(row.date),
    notes:              str(row.notes),
    originalDocument:   str(row.originalDocument),
    containers,
  };
}

export function packingListPayload(
  d: PLDraft,
  currentCompanyId: string | null,
): Record<string, unknown> {
  const totalNum = d.totalValue.trim() === '' ? null : Number(d.totalValue);
  const payload: Record<string, unknown> = {
    plNumber:           d.plNumber.trim(),
    soNumber:           d.soNumber.trim() || null,
    blNumber:           d.blNumber.trim() || null,
    poNumber:           d.poNumber.trim() || null,
    invoiceNumber:      d.invoiceNumber.trim() || null,
    bookingNumber:      d.bookingNumber.trim() || null,
    shipper:            d.shipper.trim() || null,
    supplier:           d.supplier.trim() || null,
    consignee:          d.consignee.trim() || null,
    carrier:            d.carrier.trim() || null,
    containerNumber:    d.containerNumber.trim() || null,
    sealNumber:         d.sealNumber.trim() || null,
    vesselVoyage:       d.vesselVoyage.trim() || null,
    shippingPoint:      d.shippingPoint.trim() || null,
    destination:        d.destination.trim() || null,
    productDescription: d.productDescription.trim() || null,
    grossWeight:        d.grossWeight.trim() || null,
    netWeight:          d.netWeight.trim() || null,
    unitCount:          d.unitCount.trim() || null,
    freightTerms:       d.freightTerms.trim() || null,
    currency:           d.currency.trim() || null,
    totalValue:         totalNum != null && Number.isFinite(totalNum) ? totalNum : null,
    status:             d.status || 'DRAFT',
    scheduledShipDate:  d.scheduledShipDate || null,
    date:               d.date || null,
    notes:              d.notes.trim() || null,
    originalDocument:   d.originalDocument || null,
    // Persist bookingNumber / invoiceNumber inside the containers JSON
    // (as `__meta`) so the values survive when the DB lacks dedicated
    // columns. The matching `plRowToDraft` reads them back out.
    containers: (() => {
      const bkg = d.bookingNumber.trim();
      const inv = d.invoiceNumber.trim();
      const hasMeta = bkg || inv;
      if (!hasMeta && d.containers.length === 0) return null;
      if (!hasMeta) return JSON.stringify(d.containers);
      return JSON.stringify({
        __meta: {
          bookingNumber: bkg || undefined,
          invoiceNumber: inv || undefined,
        },
        items: d.containers,
      });
    })(),
  };
  if (currentCompanyId && currentCompanyId !== 'ALL') {
    payload.companyId = currentCompanyId;
  }
  return payload;
}

const inputCls = 'h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200';

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
    {children}
  </Label>
);

const fmtNum = (n: number | null): string =>
  n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 2 });

const emptyContainer = (): PLContainer => ({
  containerNo: '', sealNo: '',
  grossLbs: null, netLbs: null, grossKg: null, netKg: null,
  volumes: null, supplier: '', description: '', systemProduct: '', blNumber: '',
  unitPrice: null, totalValue: null,
});

const numInputCls =
  'w-full h-7 px-1.5 text-[11px] rounded-sm bg-white border border-slate-300 ' +
  'text-slate-900 font-mono tabular-nums text-right ' +
  'focus:outline-none focus:ring-1 focus:ring-indigo-500/40';
const txtInputCls =
  'w-full h-7 px-1.5 text-[11px] rounded-sm bg-white border border-slate-300 ' +
  'text-slate-900 ' +
  'focus:outline-none focus:ring-1 focus:ring-indigo-500/40';

const LB_TO_KG = 0.453592;

/** Quantity format — commas and two decimal places (999,999.99).
 *  Matches the PDF-side and InvoiceDrawer precision so the drawer
 *  values align with what prints on the delivery docs. */
const fmtWeightStr = (n: number | null): string =>
  n == null ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Money format — commas and two decimals (999,999.99). */
const fmtAmountStr = (n: number | null): string =>
  n == null ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parseNumStripped = (v: string): number | null => {
  const trimmed = v.replace(/,/g, '').trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
};

/** Booking picker — wraps the SupabaseSelectField combo so the user can
 *  pick an existing booking number OR click "+ Add new" to persist the
 *  currently-typed value to the `bookings` table and keep using it on
 *  the packing list. */
const BookingPicker: React.FC<{
  value: string;
  onChange: (v: string) => void;
}> = ({ value, onChange }) => {
  const toast = useToast();
  const qc = useQueryClient();
  const { currentCompanyId } = useCompany();
  const insert = useEntityInsert<Record<string, unknown>>({
    table: 'bookings',
    listQueryKeys: ['bookings', 'ref:bookings:bookingNumber'],
    idPrefix: 'BKG',
  });
  const addNew = async () => {
    const v = value.trim();
    if (!v) {
      toast.push({ kind: 'warning', title: 'Type a booking # first' });
      return;
    }
    try {
      const payload: Record<string, unknown> = { bookingNumber: v, status: 'DRAFT' };
      if (currentCompanyId && currentCompanyId !== 'ALL') payload.companyId = currentCompanyId;
      await insert.mutateAsync(payload);
      toast.push({ kind: 'success', title: 'Booking added', description: v });
      // Force the SupabaseSelectField to refetch so the new row appears.
      await qc.invalidateQueries({ queryKey: ['ref', 'bookings'] });
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Could not add booking',
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };
  return (
    <div className="flex items-stretch gap-1.5">
      <div className="flex-1 min-w-0">
        <SupabaseSelectField
          source={{ table: 'bookings', valueColumn: 'bookingNumber', labelColumn: 'bookingNumber', secondaryColumn: 'customer', scopeByCompany: true }}
          value={value}
          onPick={v => onChange(v)}
          allowFreeText mono placeholder="Pick or type new booking…" />
      </div>
      <button
        type="button"
        onClick={addNew}
        disabled={insert.isPending || !value.trim()}
        title="Create this booking in the bookings table"
        aria-label={insert.isPending ? 'Adding…' : 'Add new booking'}
        className="shrink-0 h-8 w-8 rounded-md border border-indigo-500/40 bg-indigo-500/10 text-indigo-700 hover:bg-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center"
      >
        <PlusIcon size={13} />
      </button>
    </div>
  );
};

/** Inline combo input — shows a dropdown of preset options anchored
 *  below the text field, and still accepts any custom typed value.
 *  Pass `normalize` to auto-map OCR variants to a canonical option. */
const InlineCombo: React.FC<{
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  placeholder?: string;
  normalize?: (raw: string) => string;
}> = ({ value, options, onChange, placeholder, normalize }) => {
  // Auto-normalize on value change: if the raw value maps to one of
  // the canonical options via the provided normalizer, update the
  // stored value so OCR variants ("EXWORKS") snap to the picker's
  // expected form ("EXW (Ex Works)").
  React.useEffect(() => {
    if (!normalize || !value) return;
    const canonical = normalize(value);
    if (canonical !== value && (options as readonly string[]).includes(canonical)) {
      onChange(canonical);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const needle = value.trim().toLowerCase();
  // When the current value EXACTLY matches one of the options, treat
  // that as "the user already picked something" and show the full
  // list so they can switch to a different option. Only filter when
  // the value is a partial/intermediate typed string. Avoids the
  // dropdown collapsing to one entry after every selection.
  const valueMatchesAnOption = !!needle && options.some(o => o.toLowerCase() === needle);
  const substringMatches = needle && !valueMatchesAnOption
    ? options.filter(o => o.toLowerCase().includes(needle))
    : options;
  // If the user typed something that doesn't match any option via
  // substring (e.g. OCR returned "EXWORKS"), still show the full list
  // so they can pick the canonical form instead of living with the
  // unnormalized value.
  const filtered = substringMatches.length > 0 ? substringMatches : options;

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-stretch">
        <Input
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className={inputCls + ' flex-1 pr-7'} />
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="-ml-6 relative z-10 flex items-center justify-center w-6 text-slate-500 hover:text-slate-100"
          aria-label="Toggle options"
        >
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 3 L5 7 L8 3" stroke="currentColor" fill="none" strokeWidth="1.5" /></svg>
        </button>
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-md border border-[#1f1f1f] bg-[#111111] shadow-lg max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-slate-500">Type to add a custom term.</div>
          ) : filtered.map(opt => (
            <button
              key={opt}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onChange(opt); setOpen(false); }}
              className={
                'block w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-[#1a1a1a] ' +
                (value === opt ? 'text-indigo-300' : 'text-slate-200')
              }
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/** Labeled cell used inside a container card — tight label above the
 *  inline input. */
const CardField: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-0.5 min-w-0">
    <div className="text-[9.5px] uppercase tracking-wider text-slate-500 font-medium">{label}</div>
    {children}
  </div>
);

/** Dual LBS / KG input that auto-syncs both sides. `lbs` is the
 *  canonical value (stored as a numeric string). Displays values in
 *  999,999.9 format when blurred, raw digits while focused. */
const DualWeight: React.FC<{
  lbs: string;
  onChangeLbs: (v: string) => void;
  /** Optional authoritative KG value. When provided, the KG cell shows
   *  this verbatim instead of converting from LBS. Used for totals
   *  rows where summing actual container KG entries is more accurate
   *  than converting the LBS sum (a 1 lb rounding gap on each
   *  container compounds into ~0.5 kg of drift on a full PL). */
  kgs?: string | number | null;
}> = ({ lbs, onChangeLbs, kgs }) => {
  const [lbsFocus, setLbsFocus] = React.useState(false);
  const [kgFocus, setKgFocus] = React.useState(false);
  const lbsNum = lbs === '' ? null : Number(lbs);
  const kgsOverride = kgs != null && kgs !== ''
    ? (typeof kgs === 'number' ? kgs : Number(kgs))
    : null;
  // Override wins. When no override, derive from LBS as before.
  const kgsNum = kgsOverride != null && !Number.isNaN(kgsOverride)
    ? kgsOverride
    : (lbsNum == null ? null : lbsNum * LB_TO_KG);
  const lbsDisplay = lbsFocus ? lbs : fmtWeightStr(lbsNum);
  const kgsDisplay = kgFocus
    ? (kgsNum == null ? '' : String(Math.round(kgsNum)))
    : fmtWeightStr(kgsNum);
  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={lbsDisplay}
        onFocus={() => setLbsFocus(true)}
        onBlur={() => setLbsFocus(false)}
        onChange={e => onChangeLbs(stripToNumber(e.target.value))}
        inputMode="decimal"
        placeholder="0"
        className="h-8 text-[12.5px] text-slate-900 font-mono tabular-nums flex-1 text-right" />
      <span className="text-[10px] text-slate-500 w-6">lbs</span>
      <Input
        value={kgsDisplay}
        onFocus={() => setKgFocus(true)}
        onBlur={() => setKgFocus(false)}
        onChange={e => {
          const kg = stripToNumber(e.target.value);
          const newLbs = kg === '' ? '' : String(Math.round(Number(kg) / LB_TO_KG));
          onChangeLbs(newLbs);
        }}
        inputMode="decimal"
        placeholder="0"
        className="h-8 text-[12.5px] text-slate-900 font-mono tabular-nums flex-1 text-right" />
      <span className="text-[10px] text-slate-500 w-6">kgs</span>
    </div>
  );
};

/** Formatted numeric cell — comma-formatted when blurred, raw when focused. */
const NumCell: React.FC<{
  value: number | null;
  onChange: (v: number | null) => void;
  kind: 'weight' | 'amount' | 'count';
  className?: string;
}> = ({ value, onChange, kind, className = '' }) => {
  const [focused, setFocused] = React.useState(false);
  const numStr = (n: number | null): string => n == null ? '' : String(n);
  const fmt = kind === 'amount' ? fmtAmountStr : fmtWeightStr;
  return (
    <input
      type={focused ? 'number' : 'text'}
      inputMode="decimal"
      step={kind === 'amount' ? 0.01 : 1}
      value={focused ? numStr(value) : fmt(value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={e => onChange(parseNumStripped(e.target.value))}
      className={className}
    />
  );
};

interface ContainerSummary {
  containerNo: string;
  sealNo: string;
  netLbs: number;
  volumes: number;
}

const buildContainerSummary = (containers: PLContainer[]): ContainerSummary[] => {
  const map = new Map<string, ContainerSummary>();
  containers.forEach(c => {
    const key = c.containerNo.trim();
    if (!key) return;
    const existing = map.get(key);
    if (existing) {
      existing.netLbs += c.netLbs ?? 0;
      existing.volumes += c.volumes ?? 0;
      if (!existing.sealNo && c.sealNo) existing.sealNo = c.sealNo;
    } else {
      map.set(key, {
        containerNo: key,
        sealNo: c.sealNo,
        netLbs: c.netLbs ?? 0,
        volumes: c.volumes ?? 0,
      });
    }
  });
  return Array.from(map.values());
};

const ContainerSummaryCards: React.FC<{ containers: PLContainer[] }> = ({ containers }) => {
  const summary = buildContainerSummary(containers);
  if (summary.length === 0) return null;
  return (
    <div className="col-span-2 mt-2">
      <div className="rounded-md border border-[#1f1f1f] bg-[#0a0a0a]">
        <div className="px-3 py-2 border-b border-[#1f1f1f] flex items-center gap-1.5 text-slate-300">
          <span className="text-[11px] font-medium">Container Summary ({summary.length})</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-3">
          {summary.map(s => (
            <div key={s.containerNo} className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] px-3 py-2">
              <div className="font-mono tabular-nums text-[12px] text-slate-100">{s.containerNo}</div>
              <div className="text-[10.5px] text-slate-500 mt-0.5">Seal: <span className="font-mono">{s.sealNo || '—'}</span></div>
              <div className="text-[10.5px] text-slate-500 mt-0.5">
                Net: <span className="font-mono tabular-nums">{fmtWeightStr(s.netLbs)}</span> lbs
                {' · '}
                Vol: <span className="font-mono tabular-nums">{s.volumes}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const ContainersEditor: React.FC<{
  containers: PLContainer[];
  onChange: (next: PLContainer[]) => void;
}> = ({ containers, onChange }) => {
  const products = useProducts();
  const productList = products.data ?? [];
  const update = (i: number, patch: Partial<PLContainer>) =>
    onChange(containers.map((c, idx) => idx === i ? { ...c, ...patch } : c));
  const remove = (i: number) => onChange(containers.filter((_, idx) => idx !== i));
  const add = () => onChange([...containers, emptyContainer()]);

  const totals = containers.reduce((acc, c) => ({
    grossLbs: acc.grossLbs + (c.grossLbs ?? 0),
    grossKg:  acc.grossKg  + (c.grossKg  ?? 0),
    netLbs:   acc.netLbs   + (c.netLbs   ?? 0),
    netKg:    acc.netKg    + (c.netKg    ?? 0),
    volumes:  acc.volumes  + (c.volumes  ?? 0),
  }), { grossLbs: 0, grossKg: 0, netLbs: 0, netKg: 0, volumes: 0 });

  return (
    <>
      <div className="col-span-2 mt-2">
        <div className="flex items-center justify-between mb-1">
          <FieldLabel>Containers / materials ({containers.length})</FieldLabel>
          <Button type="button" size="sm" variant="secondary" onClick={add}
            className="bg-[#161616] border border-[#1f1f1f] text-slate-200 hover:bg-[#1a1a1a] h-6 px-2 text-[11px]">
            <Plus size={11} /> Add container
          </Button>
        </div>
        {/* Card-per-container layout — 2 lines each so every field gets room. */}
        <div className="rounded-md border border-[#1f1f1f] divide-y divide-[#1f1f1f] bg-[#0a0a0a]">
          {containers.length === 0 ? (
            <div className="px-3 py-4 text-center text-slate-600 text-[11.5px]">
              No containers — click "Add container" to add one.
            </div>
          ) : containers.map((c, i) => (
            <div key={i} className="px-3 py-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
                  Container {i + 1}
                </span>
                <button type="button" onClick={() => remove(i)}
                  title="Remove container"
                  className="p-1 rounded-sm text-slate-500 hover:text-red-400 hover:bg-red-500/10">
                  <Trash2 size={12} />
                </button>
              </div>
              {/* Line 1 — identification + volumes */}
              <div className="grid grid-cols-[2fr_2fr_1fr_1fr_0.8fr] gap-2">
                <CardField label="Description PL">
                  <Input value={c.description}
                    onChange={e => update(i, { description: e.target.value })}
                    className={txtInputCls} />
                </CardField>
                <CardField label="Description (System)">
                  <select value={c.systemProduct}
                    onChange={e => update(i, { systemProduct: e.target.value })}
                    className={txtInputCls + ' ' + (c.systemProduct ? 'bg-indigo-500/10 border-indigo-500/30' : '')}>
                    <option value="">Pick product…</option>
                    {productList.map(p => (
                      <option key={p.id} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                </CardField>
                <CardField label="Container #">
                  <Input value={c.containerNo}
                    onChange={e => update(i, { containerNo: formatContainerNumber(e.target.value) })}
                    className={txtInputCls + ' font-mono tabular-nums'} />
                </CardField>
                <CardField label="Seal #">
                  <Input value={c.sealNo}
                    onChange={e => update(i, { sealNo: e.target.value })}
                    className={txtInputCls + ' font-mono tabular-nums'} />
                </CardField>
                <CardField label="Volumes">
                  <NumCell
                    value={c.volumes}
                    onChange={v => update(i, { volumes: v == null ? null : Math.round(v) })}
                    kind="count"
                    className={numInputCls} />
                </CardField>
              </div>
              {/* Line 2 — weights */}
              <div className="grid grid-cols-4 gap-2">
                <CardField label="Gross LBS">
                  <NumCell
                    value={c.grossLbs}
                    onChange={lbs => update(i, { grossLbs: lbs == null ? null : Math.round(lbs), grossKg: lbs == null ? null : Math.round(lbs * LB_TO_KG * 10) / 10 })}
                    kind="weight"
                    className={numInputCls} />
                </CardField>
                <CardField label="Gross KG">
                  <NumCell
                    value={c.grossKg}
                    onChange={kg => update(i, { grossKg: kg, grossLbs: kg == null ? null : Math.round(kg / LB_TO_KG) })}
                    kind="amount"
                    className={numInputCls} />
                </CardField>
                <CardField label="Net LBS">
                  <NumCell
                    value={c.netLbs}
                    onChange={lbs => update(i, { netLbs: lbs == null ? null : Math.round(lbs), netKg: lbs == null ? null : Math.round(lbs * LB_TO_KG * 10) / 10 })}
                    kind="weight"
                    className={numInputCls} />
                </CardField>
                <CardField label="Net KG">
                  <NumCell
                    value={c.netKg}
                    onChange={kg => update(i, { netKg: kg, netLbs: kg == null ? null : Math.round(kg / LB_TO_KG) })}
                    kind="amount"
                    className={numInputCls} />
                </CardField>
              </div>
            </div>
          ))}
          {containers.length > 0 && (
            <div className="px-3 py-2 bg-[#0e0e0e] grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-4 items-center text-white font-semibold text-[11px]">
              <span>TOTALS</span>
              <span className="font-mono tabular-nums">Gross {fmtWeightStr(totals.grossLbs)} lbs</span>
              <span className="font-mono tabular-nums text-slate-400">{fmtWeightStr(totals.grossKg)} kgs</span>
              <span className="font-mono tabular-nums">Net {fmtWeightStr(totals.netLbs)} lbs</span>
              <span className="font-mono tabular-nums text-slate-400">{fmtWeightStr(totals.netKg)} kgs</span>
              <span className="font-mono tabular-nums">{totals.volumes.toLocaleString('en-US')} vol</span>
            </div>
          )}
        </div>
      </div>
      <ContainerSummaryCards containers={containers} />
    </>
  );
};

export const PLReviewForm: React.FC<{
  draft: PLDraft;
  setDraft: React.Dispatch<React.SetStateAction<PLDraft>>;
}> = ({ draft: d, setDraft: setD }) => {
  const set = <K extends keyof PLDraft>(k: K, v: PLDraft[K]) => setD({ ...d, [k]: v });

  // Shipper is always the logged-in user's company — OCR-extracted
  // shipper values (typically the doc's seller / supplier, not the
  // user's own company) are ignored. The user can still manually
  // override afterwards via the picker.
  const { currentCompanyId } = useCompany();
  const companies = useCompanies();
  const appliedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const signature = `${currentCompanyId}|${d.plNumber}|${d.date}`;
    if (appliedRef.current === signature) return;
    const match = (companies.data ?? []).find(c =>
      currentCompanyId === 'ALL' ? true : c.id === currentCompanyId);
    if (match?.name) {
      appliedRef.current = signature;
      setD(prev => prev.shipper === match.name ? prev : { ...prev, shipper: match.name });
    }
  }, [currentCompanyId, companies.data, d.plNumber, d.date, setD]);

  return (
    <div className="space-y-3">
      {/* Row 1 — 4 columns: PL / SO / Booking / Date */}
      <div className="grid grid-cols-4 gap-3">
        <FormField>
          <FieldLabel>PL Number *</FieldLabel>
          <Input value={d.plNumber} onChange={e => set('plNumber', e.target.value)}
            className={inputCls + ' font-mono'} />
        </FormField>
        <FormField>
          <FieldLabel>SO Number</FieldLabel>
          <SupabaseSelectField
            source={{ table: 'sales_orders', valueColumn: 'orderNumber', labelColumn: 'orderNumber', secondaryColumn: 'customerName', scopeByCompany: true }}
            value={d.soNumber}
            onPick={v => set('soNumber', v)}
            allowFreeText mono placeholder="Pick or type new SO…" />
        </FormField>
        <FormField>
          <FieldLabel>Booking #</FieldLabel>
          <BookingPicker value={d.bookingNumber} onChange={v => set('bookingNumber', v)} />
        </FormField>
        <FormField>
          <FieldLabel>Date</FieldLabel>
          <Input type="date" value={d.date?.slice(0, 10) ?? ''}
            onChange={e => set('date', e.target.value)}
            className={inputCls} />
        </FormField>
      </div>

      {/* Row 2 — 3 columns: Supplier / Shipper / Consignee */}
      <div className="grid grid-cols-3 gap-3">
        <FormField>
          <FieldLabel>Supplier</FieldLabel>
          <SupabaseSelectField
            source={{ table: 'suppliers', valueColumn: 'name', labelColumn: 'name', secondaryColumn: 'country', scopeByCompany: true }}
            value={d.supplier}
            onPick={v => set('supplier', v)}
            allowFreeText placeholder="Pick or type new supplier…" />
        </FormField>
        <FormField>
          <FieldLabel>Shipper</FieldLabel>
          <SupabaseSelectField
            source={{ table: 'companies', valueColumn: 'name', labelColumn: 'name', secondaryColumn: 'country' }}
            value={d.shipper}
            onPick={v => set('shipper', v)}
            placeholder="Pick your company…" />
        </FormField>
        <FormField>
          <FieldLabel>Consignee</FieldLabel>
          <SupabaseSelectField
            source={{ table: 'customers', valueColumn: 'name', labelColumn: 'name', secondaryColumn: 'country', scopeByCompany: true }}
            value={d.consignee}
            onPick={v => set('consignee', v)} />
        </FormField>
      </div>

      {/* Additional header fields — 2 columns */}
      <div className="grid grid-cols-2 gap-3">
        <FormField>
          <FieldLabel>PO #</FieldLabel>
          <Input value={d.poNumber} onChange={e => set('poNumber', e.target.value)}
            className={inputCls + ' font-mono'} />
        </FormField>
        <FormField>
          <FieldLabel>Invoice #</FieldLabel>
          <Input value={d.invoiceNumber} onChange={e => set('invoiceNumber', e.target.value)}
            className={inputCls + ' font-mono'} />
        </FormField>
        <FormField className="col-span-2">
          <FieldLabel>Freight terms (Incoterm)</FieldLabel>
          <InlineCombo
            value={d.freightTerms}
            options={INCOTERM_CODES}
            onChange={v => set('freightTerms', v)}
            normalize={normalizeIncoterm}
            placeholder="Pick or type (EXW, FOB, CIF, …)" />
        </FormField>

        <ContainersEditor
          containers={d.containers}
          onChange={next => set('containers', next)} />

        {(() => {
          const sumGrossLbs = d.containers.reduce((s, c) => s + (c.grossLbs ?? 0), 0);
          const sumNetLbs   = d.containers.reduce((s, c) => s + (c.netLbs   ?? 0), 0);
          const sumGrossKg  = d.containers.reduce((s, c) => s + (c.grossKg  ?? 0), 0);
          const sumNetKg    = d.containers.reduce((s, c) => s + (c.netKg    ?? 0), 0);
          const sumVolumes  = d.containers.reduce((s, c) => s + (c.volumes  ?? 0), 0);
          // Prefer the per-container sum; fall back to the header-level
          // OCR value when containers haven't supplied weights yet. When
          // we have container sums for KG too (the common case), pass
          // them to DualWeight so the KG cell shows the exact sum of
          // each container's KG field — not LBS-converted-to-KG, which
          // accumulates rounding drift.
          const grossLbs = sumGrossLbs > 0 ? String(Math.round(sumGrossLbs)) : stripToNumber(d.grossWeight);
          const netLbs   = sumNetLbs   > 0 ? String(Math.round(sumNetLbs))   : stripToNumber(d.netWeight);
          const grossKg  = sumGrossKg > 0 ? sumGrossKg : null;
          const netKg    = sumNetKg   > 0 ? sumNetKg   : null;
          return (
            <div className="col-span-2 grid grid-cols-[1fr_1fr_auto] gap-3 items-end">
              <FormField>
                <FieldLabel>Gross weight (total)</FieldLabel>
                <DualWeight lbs={grossLbs} kgs={grossKg} onChangeLbs={v => set('grossWeight', v)} />
              </FormField>
              <FormField>
                <FieldLabel>Net weight (total)</FieldLabel>
                <DualWeight lbs={netLbs} kgs={netKg} onChangeLbs={v => set('netWeight', v)} />
              </FormField>
              <FormField>
                <FieldLabel>Total volumes</FieldLabel>
                <Input value={String(sumVolumes)}
                  readOnly
                  className={inputCls + ' font-mono tabular-nums text-right w-24'} />
              </FormField>
            </div>
          );
        })()}

        <FormField className="col-span-2">
          <FieldLabel>Notes</FieldLabel>
          <textarea value={d.notes} onChange={e => set('notes', e.target.value)}
            rows={3}
            className="w-full rounded-md border px-2.5 py-1.5 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/40" />
        </FormField>
      </div>
    </div>
  );
};

/** Save a PL, transparently retrying without columns the DB doesn't
 *  recognize. Supabase returns "column X does not exist" when the
 *  payload carries an extra key; this helper strips that key and
 *  re-submits so we never fail a save because of a schema gap. */
export async function savePackingListPayload(
  insert: { mutateAsync: (p: Record<string, unknown>) => Promise<unknown> },
  payload: Record<string, unknown>,
): Promise<void> {
  let current = { ...payload };
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      await insert.mutateAsync(current);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const m = msg.match(/column [\w"]*\.?["']?(\w+)["']? does not exist/i)
             ?? msg.match(/Could not find the '(\w+)' column/i);
      if (m && m[1] && m[1] in current) {
        const { [m[1]]: _drop, ...rest } = current;
        current = rest;
        continue;
      }
      throw err;
    }
  }
  throw new Error('Packing list save failed after 12 retries.');
}

export function buildPackingListAiUploadConfig(opts: {
  insert: { mutateAsync: (p: Record<string, unknown>) => Promise<unknown> };
  toast: { push: (t: { kind: 'info' | 'success' | 'warning' | 'error'; title: string; description?: string }) => void };
  currentCompanyId: string | null;
  /** Optional baseline values applied to the empty draft. Used by the
   *  Sales Order → Fill flow to carry SO context (customer / POL /
   *  POD / currency / SO #) into the OCR review. OCR results overlay
   *  the seed; seed only fills blanks the model didn't return. */
  seed?: Partial<PLDraft>;
}): AiUploadModalConfig<PLDraft> {
  const { insert, toast, currentCompanyId, seed } = opts;
  const hasSeed = !!seed && Object.values(seed).some(v => v != null && v !== '');
  return {
    title: hasSeed ? 'AI upload — packing list (from Sales Order)' : 'AI upload — packing list',
    description: hasSeed
      ? `Pre-filled from ${seed?.soNumber || 'the sales order'}. Drop the PL PDF to OCR remaining fields, or fill them in below.`
      : 'Drop a PL PDF, pick a file, or paste text or a screenshot.',
    emptyDraft: () => ({ ...emptyPLDraft(), ...(seed ?? {}) }),
    // Seed only fills blanks the OCR didn't return — typed fields from
    // the PL PDF win over SO context.
    fromExtracted: (d) => {
      const out: PLDraft = { ...d };
      if (seed) {
        for (const [k, v] of Object.entries(seed) as Array<[keyof PLDraft, unknown]>) {
          const cur = (out as Record<string, unknown>)[k as string];
          const blank = cur == null || cur === '' || (Array.isArray(cur) && cur.length === 0);
          if (blank && v != null && v !== '') (out as Record<string, unknown>)[k as string] = v;
        }
      }
      return out;
    },
    extractSpec: { prompt: PL_PROMPT, normalize: normalizePLJson },
    extractSummary: (d) => {
      const parts = [
        d.plNumber,
        d.containerNumber,
        d.containers.length > 0 ? `${d.containers.length} container${d.containers.length === 1 ? '' : 's'}` : '',
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(' · ') : null;
    },
    validate: (d) => d.plNumber.trim() === '' ? 'PL # is required.' : null,
    renderReview: (d, setD) => <PLReviewForm draft={d} setDraft={setD} />,
    save: async (d) => {
      await savePackingListPayload(insert, packingListPayload(d, currentCompanyId));
      toast.push({ kind: 'success', title: 'Packing list saved', description: d.plNumber });
    },
  };
}
