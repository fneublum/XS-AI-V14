// Phase 3B — Invoice editor drawer. Full v1 parity.

import React, { useEffect, useMemo, useState } from 'react';
import { Mail, FileText, X } from 'lucide-react';
import {
  Drawer, Input, FormField, Label, Button, Badge, ConfirmDialog,
} from '../primitives';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from '../queries/useSupabaseQuery';
import { useQueryClient } from '@tanstack/react-query';
import { useCompanies } from '../queries/useCompanies';
import { useCustomers } from '../queries/useCustomers';
import { Invoice } from '../queries/useInvoices';
import { useEntityUpdate, useEntityInsert, useEntityDelete } from '../queries/useEntityMutations';
import { LineItemsEditor, LineItem, computeSubtotal, sanitizeItems } from './LineItemsEditor';
import { DeliveryDocsModal } from './DeliveryDocsModal';
import { SupabaseSelectField } from './SupabaseSelectField';
import type { EditorMode } from '../providers/EditorProvider';

/** Incoterm options shown on the Invoice drawer — same labels as the
 *  packing-list editor so values pass through without truncation. */
const INCOTERMS: Array<{ code: string; label: string }> = [
  { code: 'EXW', label: 'EXW (Ex Works)' },
  { code: 'FAS', label: 'FAS (Free Alongside Ship)' },
  { code: 'FOB', label: 'FOB (Free on Board)' },
  { code: 'CFR', label: 'CFR (Cost and Freight)' },
  { code: 'CIF', label: 'CIF (Cost + Insurance + Freight)' },
  { code: 'DDP', label: 'DDP (Delivered Duty Paid)' },
];
const FREIGHT_TERMS = ['Prepaid', 'Collect', 'Prepaid & Added', 'Third Party'];

/** Freight terms default derived from the Incoterm: the seller pays
 *  freight for CFR/CIF/DDP (PREPAID), the buyer pays for EXW/FAS/FOB
 *  (COLLECT). Returns '' when the Incoterm doesn't map cleanly. */
const freightTermsForIncoterm = (code: string): string => {
  const c = code.toUpperCase();
  if (['EXW', 'FAS', 'FOB'].includes(c)) return 'Collect';
  if (['CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DDP', 'DPU'].includes(c)) return 'Prepaid';
  return '';
};
const CURRENCIES = ['USD', 'EUR', 'GBP', 'BRL', 'MXN', 'CNY', 'INR'];
const PAYMENT_TERMS = [
  'Net 30 Days', 'Net 60 Days', 'Prepaid', 'L/C at Sight', 'L/C 60 Days',
  'Cash Against Documents', 'Cash on Delivery',
  'T/T 30 Days After B/L', '100% T/T in Advance',
  '40% Advance + 60% Cash Against Documents',
  '30% Advance + 70% on Cash Against Documents',
];

const inputClass =
  'h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 rounded-md px-2 ' +
  'placeholder:text-slate-600 focus:ring-1 focus:ring-indigo-500 outline-none';

const labelClass = 'text-[11px] text-slate-500 uppercase tracking-wider font-medium';
const sectionClass = 'p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f] space-y-3';

/** Boilerplate memo that prints on new commercial invoices. Users can
 *  still edit it per-invoice. */
const DEFAULT_INVOICE_MEMO =
  'TREATED WOOD PRESENT ON THE CARGO\n\n' +
  'Manufacturer: Various generators in the USA. Goods collected and consolidated by EC4 ENTERPRISES LLC';

/** Format a numeric-ish string as 999,999.99 (commas + 2 decimals).
 *  Matches the PDF-side `fmt(...)` so the drawer Weights section
 *  shows the same precision the user sees on the rendered invoice. */
const fmtQty1 = (raw: string): string => {
  const trimmed = (raw ?? '').toString().replace(/,/g, '').trim();
  if (trimmed === '') return '';
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return raw;
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/** Weight input — shows 999,999.9 format on blur, raw digits while
 *  focused so typing stays responsive. Emits the raw string. */
const FmtWeightInput: React.FC<{
  value: string;
  onChange: (next: string) => void;
  className?: string;
  readOnly?: boolean;
}> = ({ value, onChange, className, readOnly }) => {
  const [focused, setFocused] = React.useState(false);
  return (
    <Input
      value={focused ? value : fmtQty1(value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={e => onChange(e.target.value.replace(/,/g, ''))}
      readOnly={readOnly}
      inputMode="decimal"
      placeholder="0"
      className={className}
    />
  );
};

/** Bank row shape (fields are selectively present depending on the
 *  environment — we tolerate missing columns). */
interface BankRow {
  id: string;
  name?: string | null;
  code?: string | null;
  address?: string | null;
  bankAddress?: string | null;
  swift_code?: string | null;
  swiftCode?: string | null;
  routing?: string | null;
  routingNumber?: string | null;
  account_number?: string | null;
  accountNumber?: string | null;
}

/** Dropdown of banks from the `banks` table. Picks a row and emits the
 *  full bank record so callers can auto-populate swift/routing/account.
 *  Defaults to a bank matching CHASE on first render when no bank is
 *  currently selected. */
const BankPicker: React.FC<{
  value: string;
  onChange: (bank: BankRow | null) => void;
}> = ({ value, onChange }) => {
  const { data: banks } = useSupabaseQuery<BankRow[]>(
    ['banks', 'picker'],
    async () => {
      const { data, error } = await getSupabaseClient()
        .from('banks')
        .select('*')
        .order('name', { ascending: true })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data as unknown as BankRow[] | null) ?? [];
    },
  );
  const appliedRef = React.useRef(false);
  React.useEffect(() => {
    if (appliedRef.current) return;
    if (!banks || banks.length === 0) return;
    if (value && value.trim() !== '') { appliedRef.current = true; return; }
    const chase = banks.find(b => (b.name ?? '').toLowerCase().includes('chase'));
    if (chase) {
      appliedRef.current = true;
      onChange(chase);
    }
  }, [banks, value, onChange]);
  const currentId = banks?.find(b => (b.name ?? '').trim() === value.trim())?.id ?? '';
  return (
    <select
      value={currentId}
      onChange={(e) => {
        const next = banks?.find(b => b.id === e.target.value) ?? null;
        onChange(next);
      }}
      className={inputClass + ' w-full appearance-none'}
    >
      <option value="">{value || '— pick bank —'}</option>
      {(banks ?? []).map(b => (
        <option key={b.id} value={b.id}>
          {b.name ?? b.id}
          {b.code ? ` · ${b.code}` : ''}
        </option>
      ))}
    </select>
  );
};

const fmtMoney = (n: number, currency: string) => {
  try {
    return n.toLocaleString('en-US', {
      style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  } catch { return `${currency} ${n.toFixed(2)}`; }
};

// Native DeliveryDocsModal handles the flow inline; the modal itself
// keeps a "Open in v1" escape hatch for PL / SLI / BOL until those
// generators are extracted.

interface Props {
  invoice: Invoice | null;
  mode: EditorMode;
  onOpenChange: (open: boolean) => void;
}

export const InvoiceDrawer: React.FC<Props> = ({ invoice, mode, onOpenChange }) => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const companies = useCompanies();
  const qc = useQueryClient();
  const customers = useCustomers();

  // Header
  const [companyId, setCompanyId]     = useState<string>(currentCompanyId !== 'ALL' ? currentCompanyId : '');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [dateOrder, setDateOrder]     = useState('');
  const [customerPo, setCustomerPo]   = useState('');
  const [soNumber, setSoNumber]       = useState('');
  const [plNumber, setPlNumber]       = useState('');
  const [bookingNumber, setBookingNumber] = useState('');

  // Parties
  const [shipperName, setShipperName]     = useState('');
  const [shipperAddress, setShipperAddress] = useState('');
  const [soldTo, setSoldTo]               = useState('');
  const [shipTo, setShipTo]               = useState('');
  const [consignee, setConsignee]         = useState('');
  const [billToName, setBillToName]       = useState('');

  // Commercial
  const [paymentTerms, setPaymentTerms]   = useState('Net 30 Days');
  const [incoterm, setIncoterm]           = useState('FOB');
  const [currency, setCurrency]           = useState('USD');
  const [freightTerms, setFreightTerms]   = useState('');

  // Shipment
  const [carrier, setCarrier]             = useState('');
  const [transportRef, setTransportRef]   = useState('');
  const [pod, setPod]                     = useState('');
  const [poa, setPoa]                     = useState('');
  // Containers are stored on the row as a JSON-encoded array of
  // `{ id, container, seal, volumes }`. The legacy field was a plain
  // comma string of container numbers — we detect and migrate that
  // on load. `volumes` is per-container colli/bale count; optional.
  interface ContainerRow { id: string; container: string; seal: string; volumes: string }
  const [containerRows, setContainerRows] = useState<ContainerRow[]>([]);

  // Weights — persisted in KG; LBS paired inputs are conversion-only.
  const [grossWeight, setGrossWeight]     = useState('');
  const [netWeight, setNetWeight]         = useState('');
  const [tareWeight, setTareWeight]       = useState('');
  const [totalQuantity, setTotalQuantity] = useState('');
  // Local-only LBS mirrors — derived from the canonical KG state so
  // edits in either field stay in sync without persisting LBS.
  const [grossLbsMirror, setGrossLbsMirror] = useState('');
  const [netLbsMirror, setNetLbsMirror]     = useState('');
  const [tareLbsMirror, setTareLbsMirror]   = useState('');
  // Total volumes (colli / bale count). Persisted if the `invoices`
  // table has a `totalVolumes` column; otherwise the save retries
  // without it and we surface a non-blocking note.
  const [totalVolumes, setTotalVolumes]   = useState('');

  // Banking
  const [remitTo, setRemitTo]             = useState('');
  const [bankName, setBankName]           = useState('');
  const [bankAddress, setBankAddress]     = useState('');
  const [swiftCode, setSwiftCode]         = useState('');
  const [routingNumber, setRoutingNumber] = useState('');
  const [accountNumber, setAccountNumber] = useState('');

  // Items + memo
  const [items, setItems]                 = useState<LineItem[]>([]);
  const [memo, setMemo]                   = useState('');
  const [originalDocument, setOriginalDocument] = useState('');

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [docsOpen, setDocsOpen]           = useState(false);
  // When the user clicks the Email button we reuse the DeliveryDocsModal
  // with Invoice + Packing List pre-selected and the email preview
  // auto-opened, so the CC field lands pre-filled with the customer's
  // broker and both PDFs are attached without an extra click.
  const [docsAutoEmail, setDocsAutoEmail] = useState(false);

  const update = useEntityUpdate<{ id: string } & Record<string, unknown>>({
    table: 'invoices', listQueryKeys: ['invoices', 'receivables'],
  });
  const insert = useEntityInsert<Record<string, unknown>>({
    table: 'invoices', listQueryKeys: ['invoices', 'receivables'], idPrefix: 'INV',
  });
  const del = useEntityDelete({
    table: 'invoices', listQueryKeys: ['invoices', 'receivables'],
  });

  useEffect(() => {
    if (!invoice) return;
    setCompanyId(invoice.companyId ?? (currentCompanyId !== 'ALL' ? currentCompanyId : ''));
    setInvoiceNumber(invoice.invoiceNumber ?? '');
    setInvoiceDate(invoice.invoiceDate ?? new Date().toISOString().slice(0, 10));
    setDateOrder(invoice.dateOrder ?? '');
    setCustomerPo(invoice.customerPo ?? '');
    setSoNumber(invoice.soNumber ?? '');
    setPlNumber(invoice.plNumber ?? '');
    setBookingNumber(invoice.bookingNumber ?? '');
    setShipperName(invoice.shipperName ?? '');
    setShipperAddress(invoice.shipperAddress ?? '');
    setSoldTo(invoice.soldTo ?? '');
    setShipTo(invoice.shipTo ?? '');
    setConsignee(invoice.consignee ?? '');
    setBillToName(invoice.billToName ?? '');
    setPaymentTerms(invoice.paymentTerms ?? 'Net 30 Days');
    setIncoterm(invoice.incoterm ?? 'FOB');
    setCurrency(invoice.currency ?? 'USD');
    // Derive freight terms from the Incoterm when none is stored (new
    // draft or legacy row without the field). An explicitly saved value
    // still wins.
    setFreightTerms(invoice.freightTerms && invoice.freightTerms.trim() !== ''
      ? invoice.freightTerms
      : freightTermsForIncoterm(invoice.incoterm ?? 'FOB'));
    setCarrier(invoice.carrier ?? '');
    setTransportRef(invoice.transportRef ?? '');
    setPod(invoice.pod ?? '');
    setPoa(invoice.poa ?? '');
    // If we have a bookingNumber and no POA/POD yet, pull from the
    // linked bookings row so the invoice inherits the booking's ports.
    const bkg = invoice.bookingNumber?.trim();
    const needsPorts = !invoice.pod || !invoice.poa;
    if (bkg && needsPorts) {
      getSupabaseClient()
        .from('bookings')
        .select('pol, pod')
        .eq('bookingNumber', bkg)
        .limit(1)
        .then(({ data }) => {
          const row = Array.isArray(data) && data.length > 0 ? data[0] as { pol?: string | null; pod?: string | null } : null;
          if (!row) return;
          if (!invoice.poa && row.pol) setPoa(row.pol);
          if (!invoice.pod && row.pod) setPod(row.pod);
        });
    }
    // Normalize containers — string JSON, array, or legacy CSV → rows.
    const rawContainers = invoice.containers as unknown;
    let parsedContainers: ContainerRow[] = [];
    try {
      let arr: any = rawContainers;
      if (typeof arr === 'string') {
        const trimmed = arr.trim();
        if (trimmed.startsWith('[')) {
          arr = JSON.parse(trimmed);
        } else if (trimmed.length > 0) {
          // Legacy: comma-separated container numbers, no seals.
          arr = trimmed.split(/[,\n]/).map(s => ({ container: s.trim(), seal: '', volumes: '' }));
        } else {
          arr = [];
        }
      }
      if (!Array.isArray(arr)) arr = [];
      parsedContainers = arr
        .map((c: any, i: number): ContainerRow => ({
          id: String(c?.id ?? `cont_${i}`),
          container: String(c?.container ?? c?.number ?? c?.containerNo ?? ''),
          seal: String(c?.seal ?? c?.sealNo ?? ''),
          volumes: c?.volumes != null && c?.volumes !== '' ? String(c.volumes) : '',
        }))
        .filter((c: ContainerRow) => c.container || c.seal);
    } catch { parsedContainers = []; }
    // If the row has no explicit containers, synthesize rows from the
    // per-item `containerNo`/`sealNo` pairs — preserves visibility of
    // container assignments that only live on items. Volumes are
    // derived by summing `items[].volumes` whose containerNo matches.
    if (parsedContainers.length === 0 && Array.isArray(invoice.items)) {
      const byContainer = new Map<string, { seal: string; volumes: number }>();
      (invoice.items as any[]).forEach(it => {
        const cn = String(it?.containerNo || '').trim();
        if (!cn) return;
        const entry = byContainer.get(cn) ?? { seal: '', volumes: 0 };
        if (!entry.seal && it?.sealNo) entry.seal = String(it.sealNo);
        entry.volumes += Number(it?.volumes) || 0;
        byContainer.set(cn, entry);
      });
      let idx = 0;
      byContainer.forEach((v, cn) => {
        parsedContainers.push({
          id: `auto_${idx++}`,
          container: cn,
          seal: v.seal,
          volumes: v.volumes > 0 ? String(v.volumes) : '',
        });
      });
    } else if (parsedContainers.length > 0 && Array.isArray(invoice.items)) {
      // When the row *did* persist container rows but without volumes,
      // top them up from the item-level sum so the field isn't blank
      // on legacy data.
      const need = parsedContainers.some(c => !c.volumes);
      if (need) {
        const sumByCn = new Map<string, number>();
        (invoice.items as any[]).forEach(it => {
          const cn = String(it?.containerNo || '').trim();
          if (!cn) return;
          sumByCn.set(cn, (sumByCn.get(cn) ?? 0) + (Number(it?.volumes) || 0));
        });
        parsedContainers = parsedContainers.map(c => {
          if (c.volumes) return c;
          const v = sumByCn.get(c.container) ?? 0;
          return v > 0 ? { ...c, volumes: String(v) } : c;
        });
      }
    }
    setContainerRows(parsedContainers);
    // Legacy rows sometimes stored the lbs value in the kg column. If
    // the stored gross/net/tare (as kg) is unrealistically larger than
    // the product net derived from line items, treat it as lbs and
    // convert — otherwise gross in lbs would display as ~2.2× the real
    // shipped weight.
    const itemsLbs = Array.isArray(invoice.items)
      ? (invoice.items as any[]).reduce(
          (s, it) => s + (Number(it?.netLbs ?? it?.quantity) || 0),
          0,
        )
      : 0;
    const itemsKg = itemsLbs * 0.453592;
    const looksLikeLbs = (raw: string | null): boolean => {
      if (!raw || itemsKg <= 0) return false;
      const n = Number(raw);
      return Number.isFinite(n) && n > itemsKg * 1.5;
    };
    const normalizeKg = (raw: string | null): string => {
      if (!raw) return '';
      const n = Number(raw);
      if (!Number.isFinite(n)) return raw;
      return looksLikeLbs(raw) ? (n * 0.453592).toFixed(2) : raw;
    };
    setGrossWeight(normalizeKg(invoice.grossWeight));
    setNetWeight(normalizeKg(invoice.netWeight));
    setTareWeight(invoice.tareWeight ?? '');
    const toLbs = (kg: string): string => {
      if (!kg) return '';
      const n = Number(kg);
      return Number.isFinite(n) ? (n / 0.453592).toFixed(2) : '';
    };
    setGrossLbsMirror(toLbs(normalizeKg(invoice.grossWeight)));
    setNetLbsMirror(toLbs(normalizeKg(invoice.netWeight)));
    setTareLbsMirror(toLbs(invoice.tareWeight ?? ''));
    // `totalVolumes` may not exist on every row (schema-optional).
    // Fall back to the sum of per-item `volumes` so the drawer shows
    // the same number the PDFs print.
    const rowVol = (invoice as any).totalVolumes;
    if (rowVol !== undefined && rowVol !== null && rowVol !== '') {
      setTotalVolumes(String(rowVol));
    } else {
      // Item-level first, then container-level (legacy rows where
      // items were stripped but containers carry `volumes`).
      const itemsArr = Array.isArray(invoice.items) ? invoice.items as any[] : [];
      const itemsSum = itemsArr.reduce((s: number, it: any) => s + (Number(it?.volumes) || 0), 0);
      let containerSum = 0;
      try {
        const rawC = (invoice as any).containers;
        const arr = typeof rawC === 'string' ? JSON.parse(rawC || '[]') : (Array.isArray(rawC) ? rawC : []);
        containerSum = (arr as any[]).reduce((s, c) => s + (Number(c?.volumes) || 0), 0);
      } catch { /* noop */ }
      const sum = itemsSum > 0 ? itemsSum : containerSum;
      setTotalVolumes(sum > 0 ? String(sum) : '');
    }
    setTotalQuantity(invoice.totalQuantity ?? '');
    setRemitTo(invoice.remitTo ?? '');
    setBankName(invoice.bankName ?? '');
    setBankAddress(invoice.bankAddress ?? '');
    setSwiftCode(invoice.swiftCode ?? '');
    setRoutingNumber(invoice.routingNumber ?? '');
    setAccountNumber(invoice.accountNumber ?? '');
    setItems(invoice.items ?? []);
    setMemo(
      invoice.memo ??
      (mode === 'create' ? DEFAULT_INVOICE_MEMO : '')
    );
    setOriginalDocument(invoice.originalDocument ?? '');
  }, [invoice?.id, mode]);

  // When a NEW invoice is opened with a pre-seeded soNumber (typical
  // path from "Create invoice from this PL" in PLInvoiceEngineV2) the
  // seed doesn't carry commercial terms — so the load effect above
  // falls back to the hardcoded 'Net 30 Days' default. The invoice
  // should inherit Payment Terms from the originating sales order so
  // AR aging, statements, and customer expectations stay consistent.
  // Fetch the SO once on create + soNumber present + no explicit
  // paymentTerms in the seed, and copy the SO's terms in.
  const soTermsAppliedRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (mode !== 'create') return;
    if (!invoice) return;
    const seededSo = (invoice.soNumber ?? '').trim();
    if (!seededSo) return;
    if (invoice.paymentTerms) return;          // explicit seed wins
    if (soTermsAppliedRef.current === seededSo) return;
    soTermsAppliedRef.current = seededSo;
    let cancelled = false;
    (async () => {
      try {
        const sb = getSupabaseClient();
        let q = sb.from('sales_orders')
          .select('paymentTerms, currency, incoterm, poa, pod')
          .eq('orderNumber', seededSo)
          .limit(1);
        if (invoice.soldTo) q = q.eq('customerName', invoice.soldTo);
        const { data } = await q.maybeSingle();
        if (cancelled || !data) return;
        if (data.paymentTerms) setPaymentTerms(data.paymentTerms);
        // Also fill the other commercial fields if the seed left them
        // at their hardcoded defaults — keeps the invoice aligned with
        // the SO without overwriting an explicit seed.
        if (data.currency && !invoice.currency) setCurrency(data.currency);
        if (data.incoterm && !invoice.incoterm) {
          setIncoterm(data.incoterm);
          setFreightTerms(freightTermsForIncoterm(data.incoterm));
        }
        if (data.poa && !invoice.poa) setPoa(data.poa);
        if (data.pod && !invoice.pod) setPod(data.pod);
      } catch {
        // Silent — user can pick payment terms manually.
      }
    })();
    return () => { cancelled = true; };
  }, [invoice?.id, mode]);

  const availableCompanies = companies.data ?? [];
  const availableCustomers = customers.data ?? [];
  const isSystem = currentCompanyId === 'ALL';

  const subtotal = useMemo(() => computeSubtotal(items), [items]);
  const total = subtotal;

  // Derive net weight from line items. Each line item's `quantity` is
  // the product weight in lbs (sanitizeItems also mirrors this into
  // `netLbs`/`netKg`). Net weight is, by definition, the sum of line
  // item quantities — keeping these in sync prevents the drift we saw
  // when legacy rows had lbs stored in the kg column.
  const itemsNetLbs = useMemo(
    () => items.reduce((s, it: any) => s + (Number(it?.netLbs ?? it?.quantity) || 0), 0),
    [items],
  );
  const itemsNetKg = useMemo(() => itemsNetLbs * 0.453592, [itemsNetLbs]);
  const hasItemsWeight = itemsNetLbs > 0;
  const derivedNetKg  = hasItemsWeight ? itemsNetKg.toFixed(2)  : netWeight;
  const derivedNetLbs = hasItemsWeight ? itemsNetLbs.toFixed(2) : netLbsMirror;

  const canSave = invoiceNumber.trim() !== '';
  const pending = update.isPending || insert.isPending || del.isPending;

  const selectSoldTo = (customerId: string) => {
    const c = availableCustomers.find(c => c.id === customerId);
    if (!c) return;
    setSoldTo(c.name);
    if (!billToName) setBillToName(c.name);
    if (!shipTo) setShipTo([c.location, c.city, c.state, c.zip, c.country].filter(Boolean).join(', '));
    if (c.paymentTerms && !paymentTerms) setPaymentTerms(c.paymentTerms);
    // Customer's saved POD always wins when a customer is (re-)picked.
    if (c.pod) setPod(c.pod);
  };

  // Picking an SO copies its Commercial (currency, incoterm, payment
  // terms), Shipment (POA/POD), and line items into the draft. Mirrors
  // what users do manually today; explicit user action so overwriting
  // is expected.
  const applySoToInvoice = async (orderNumber: string): Promise<void> => {
    setSoNumber(orderNumber);
    const trimmed = orderNumber.trim();
    if (!trimmed) return;
    try {
      const sb = getSupabaseClient();
      let q = sb.from('sales_orders')
        .select('*')
        .eq('orderNumber', trimmed)
        .eq('status', 'APPROVED')
        .limit(1);
      if (soldTo) q = q.eq('customerName', soldTo);
      const { data, error } = await q.maybeSingle();
      if (error || !data) return;
      // Commercial
      if (data.currency)     setCurrency(data.currency);
      if (data.incoterm) {
        setIncoterm(data.incoterm);
        setFreightTerms(freightTermsForIncoterm(data.incoterm));
      }
      if (data.paymentTerms) setPaymentTerms(data.paymentTerms);
      // Shipment
      if (data.poa) setPoa(data.poa);
      if (data.pod) setPod(data.pod);
      // Booking (carry-over)
      if (data.bookingNumber && !bookingNumber) setBookingNumber(data.bookingNumber);
      // Line items — parse JSON if stored as string
      let rawItems: unknown = data.items;
      if (typeof rawItems === 'string') {
        try { rawItems = JSON.parse(rawItems); } catch { rawItems = []; }
      }
      if (Array.isArray(rawItems) && rawItems.length > 0) {
        const mapped: LineItem[] = rawItems.map((r: any) => ({
          productId: r?.productId ?? undefined,
          productName: String(r?.productName ?? r?.name ?? ''),
          customerDescription: r?.customerDescription ?? r?.description ?? '',
          hsCode: r?.hsCode ?? '',
          grade: r?.grade ?? '',
          quantity: Number(r?.quantity) || 0,
          unitPrice: Number(r?.unitPrice ?? r?.price) || 0,
          total: Number(r?.total) || ((Number(r?.quantity) || 0) * (Number(r?.unitPrice ?? r?.price) || 0)),
        }));
        setItems(mapped);
      }
      toast.push({
        kind: 'success',
        title: `SO ${trimmed} applied`,
        description: 'Commercial, Shipment, and Line items filled from the sales order.',
      });
    } catch {
      // Silent failure — user can still type the SO number freely.
    }
  };

  // Keep POD in sync with the currently-selected Sold-To customer. As
  // soon as soldTo and the customers list are both populated AND pod
  // is empty, default POD from the customer's saved port (case- and
  // whitespace-tolerant). Manual edits that set pod to a non-empty
  // value block further auto-fill on the same draft.
  const podAppliedDraftRef = React.useRef<string | null>(null);
  useEffect(() => {
    // Reset the applied-draft guard whenever the invoice changes so a
    // fresh draft always attempts to auto-fill.
    podAppliedDraftRef.current = null;
  }, [invoice?.id]);
  useEffect(() => {
    if (!soldTo) return;
    if (availableCustomers.length === 0) return;
    if (pod) return;
    const draftKey = `${invoice?.id ?? 'new'}|${soldTo}`;
    if (podAppliedDraftRef.current === draftKey) return;
    const needle = soldTo.trim().toLowerCase();
    const c = availableCustomers.find(x => (x.name ?? '').trim().toLowerCase() === needle);
    if (c?.pod) {
      podAppliedDraftRef.current = draftKey;
      setPod(c.pod);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soldTo, availableCustomers, pod, invoice?.id]);

  const buildPayload = () => ({
    companyId: companyId || currentCompanyId,
    invoiceNumber: invoiceNumber.trim(),
    invoiceDate: invoiceDate || null,
    dateOrder: dateOrder || null,
    customerPo: customerPo || null,
    soNumber: soNumber || null,
    plNumber: plNumber || null,
    bookingNumber: bookingNumber || null,
    shipperName: shipperName || null,
    shipperAddress: shipperAddress || null,
    soldTo: soldTo || null,
    shipTo: shipTo || null,
    consignee: consignee || null,
    billToName: billToName || null,
    paymentTerms: paymentTerms || null,
    incoterm: incoterm || null,
    // NOTE: legacy `incoterms` (plural) column does not exist on the
    // live `invoices` schema. Only write the canonical `incoterm`.
    currency,
    freightTerms: freightTerms || null,
    carrier: carrier || null,
    transportRef: transportRef || null,
    pod: pod || null,
    poa: poa || null,
    containers: containerRows.length > 0
      ? JSON.stringify(containerRows.map(r => {
          const v = Number(r.volumes);
          return {
            id: r.id,
            container: r.container.trim(),
            seal: r.seal.trim(),
            volumes: Number.isFinite(v) && r.volumes !== '' ? v : null,
          };
        }))
      : null,
    grossWeight: grossWeight || null,
    netWeight: hasItemsWeight ? itemsNetKg.toFixed(2) : (netWeight || null),
    tareWeight: tareWeight || null,
    totalQuantity: totalQuantity || null,
    // Optional — stripped + retried if the column doesn't exist.
    totalVolumes: totalVolumes ? Number(totalVolumes) || null : null,
    remitTo: remitTo || null,
    bankName: bankName || null,
    bankAddress: bankAddress || null,
    swiftCode: swiftCode || null,
    routingNumber: routingNumber || null,
    accountNumber: accountNumber || null,
    // `items` is a text column in the live schema — stringify before insert.
    items: JSON.stringify(sanitizeItems(items)),
    subtotal,
    totalAmount: total,
    memo: memo || null,
    originalDocument: originalDocument || null,
  });

  // Generic retry-on-PGRST204 / 42703 loop: Supabase rejects the whole
  // mutation when ANY payload key doesn't map to a column. We strip
  // the named column and retry until the row lands. Keeps saves
  // resilient across envs with different column sets.
  const extractMissingColumn = (msg: string): string | null => {
    const m = msg.match(/column [\w"]*\.?["']?(\w+)["']? does not exist/i)
           ?? msg.match(/Could not find the '(\w+)' column/i);
    return m?.[1] ?? null;
  };
  const stripColumn = <T extends Record<string, unknown>>(p: T, col: string): T => {
    const { [col]: _drop, ...rest } = p as Record<string, unknown>;
    return rest as T;
  };
  const mutateWithStripRetry = async (
    kind: 'insert' | 'update',
    basePayload: Record<string, unknown>,
  ): Promise<{ droppedColumns: string[] }> => {
    const dropped: string[] = [];
    let current = { ...basePayload };
    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        if (kind === 'insert') await insert.mutateAsync(current as any);
        else                   await update.mutateAsync({ id: invoice!.id, ...current } as any);
        return { droppedColumns: dropped };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const col = extractMissingColumn(msg);
        if (!col || !(col in current)) throw err;
        dropped.push(col);
        current = stripColumn(current, col);
      }
    }
    throw new Error('Save failed after 12 strip-retry attempts.');
  };

  const save = async () => {
    if (!canSave) {
      toast.push({ kind: 'warning', title: 'Invoice # is required' });
      return;
    }
    const payload = buildPayload();

    // After the invoice saves, link the packing list back to it:
    // flip the PL status to INVOICED and record the invoice number on
    // the PL row. Strips unknown columns on PGRST204 so envs without
    // an invoiceNumber column still flip the status.
    const linkPackingList = async () => {
      const plNo = plNumber?.trim();
      const invNo = invoiceNumber?.trim();
      if (!plNo) return;
      const sb = getSupabaseClient();
      const base: Record<string, unknown> = { status: 'INVOICED', invoiceNumber: invNo || null };
      let current = { ...base };
      for (let attempt = 0; attempt < 6; attempt++) {
        const { error } = await sb.from('packing_lists').update(current).eq('plNumber', plNo);
        if (!error) {
          void qc.invalidateQueries({ queryKey: ['packingLists'] });
          void qc.invalidateQueries({ queryKey: ['logisticsDocs'] });
          void qc.invalidateQueries({ queryKey: ['invoices'] });
          return;
        }
        const col = extractMissingColumn(error.message || '');
        if (col && col in current) { current = stripColumn(current, col); continue; }
        // eslint-disable-next-line no-console
        console.warn('[InvoiceDrawer] linkPackingList failed:', error);
        return;
      }
    };

    // Flip the linked sales order to FULFILLED so it stops appearing in
    // the Trading Follow Up "To Ship" table and the SO list reflects
    // that a shipment went out against it. Only runs when the invoice
    // is the FIRST one for this SO (we don't want to flip back to
    // FULFILLED after the user reverts the SO manually), but for now we
    // treat any invoice referencing the SO as fulfilment. If we need
    // partial-shipment support later, switch to a count of matching
    // invoices vs. ordered qty.
    const linkSalesOrder = async () => {
      const soNo = soNumber?.trim();
      if (!soNo) return;
      const sb = getSupabaseClient();
      const { error } = await sb
        .from('sales_orders')
        .update({ status: 'FULFILLED' })
        .eq('orderNumber', soNo)
        .neq('status', 'FULFILLED'); // skip rows already settled
      if (error) {
        // eslint-disable-next-line no-console
        console.warn('[InvoiceDrawer] linkSalesOrder failed:', error);
        return;
      }
      void qc.invalidateQueries({ queryKey: ['salesOrders'] });
    };

    try {
      const { droppedColumns } = await mutateWithStripRetry(
        mode === 'create' ? 'insert' : 'update',
        payload,
      );
      await linkPackingList();
      await linkSalesOrder();
      const title = mode === 'create' ? 'Invoice created' : 'Saved';
      toast.push({
        kind: droppedColumns.length > 0 ? 'warning' : 'success',
        title: droppedColumns.length > 0 ? `${title} (skipped: ${droppedColumns.join(', ')})` : title,
        description: payload.invoiceNumber as string,
      });
      onOpenChange(false);
    } catch (err) {
      toast.push({
        kind: 'error',
        title: mode === 'create' ? 'Create failed' : 'Save failed',
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const deleteInvoice = () => {
    if (!invoice) return;
    del.mutate(invoice.id, {
      onSuccess: () => {
        toast.push({ kind: 'success', title: 'Deleted', description: invoice.invoiceNumber });
        setConfirmDelete(false);
        onOpenChange(false);
      },
      onError: (err) => {
        toast.push({ kind: 'error', title: 'Delete failed', description: err.message });
        setConfirmDelete(false);
      },
    });
  };

  const sendEmail = () => {
    // Open the DeliveryDocsModal with Invoice + PL pre-selected and the
    // email preview auto-opened — attachments and broker CC are built
    // by the modal's emailSelected().
    setDocsAutoEmail(true);
    setDocsOpen(true);
  };

  if (!invoice) return null;

  return (
    <>
      <Drawer
        open={!!invoice}
        onOpenChange={onOpenChange}
        title={mode === 'create' ? 'New invoice' : `Invoice ${invoice.invoiceNumber || invoice.id}`}
        description={mode === 'edit' ? (soldTo || billToName || undefined) : 'Create a customer invoice.'}
        widthClass="w-[min(98vw,1020px)]"
        footer={
          <>
            {mode === 'edit' && (
              <Button
                variant="secondary" size="sm"
                onClick={() => setConfirmDelete(true)}
                disabled={pending}
                className="bg-transparent border border-red-500/30 text-red-400 hover:bg-red-500/10"
              >
                Delete
              </Button>
            )}
            {mode === 'edit' && invoice && (
              <Button
                variant="secondary" size="sm"
                onClick={() => { setDocsAutoEmail(false); setDocsOpen(true); }}
                disabled={pending}
                className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
              >
                <FileText size={12} /> Delivery docs
              </Button>
            )}
            {mode === 'edit' && (
              <Button
                variant="secondary" size="sm"
                onClick={sendEmail}
                disabled={pending}
                className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
              >
                <Mail size={12} /> Email
              </Button>
            )}
            <Button
              variant="secondary" size="sm"
              onClick={() => onOpenChange(false)}
              disabled={pending}
              className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={save}
              disabled={!canSave || pending}
              loading={pending}
              className="ml-auto bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
            >
              {pending ? 'Saving…' : mode === 'create' ? 'Create invoice' : 'Save changes'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Header */}
          <div className={sectionClass}>
            <Label className={labelClass}>Header</Label>
            {isSystem && availableCompanies.length > 0 && (
              <FormField>
                <Label className={labelClass}>Company</Label>
                <select value={companyId} onChange={e => setCompanyId(e.target.value)}
                  className={inputClass + ' w-full appearance-none'}>
                  <option value="">Select…</option>
                  {availableCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </FormField>
            )}
            <div className="grid grid-cols-4 gap-2">
              <FormField>
                <Label className={labelClass}>Invoice # <span className="text-red-400 ml-1">*</span></Label>
                <Input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)}
                  className={inputClass + ' font-mono tabular-nums'} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Invoice date</Label>
                <Input type="date" value={invoiceDate ? invoiceDate.slice(0, 10) : ''}
                  onChange={e => setInvoiceDate(e.target.value)} className={inputClass} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Customer PO</Label>
                <Input value={customerPo} onChange={e => setCustomerPo(e.target.value)}
                  className={inputClass + ' font-mono tabular-nums'} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Order date</Label>
                <Input type="date" value={dateOrder ? dateOrder.slice(0, 10) : ''}
                  onChange={e => setDateOrder(e.target.value)} className={inputClass} />
              </FormField>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <FormField>
                <Label className={labelClass}>
                  SO #
                  {soldTo && (
                    <span className="ml-2 text-[10px] text-slate-600 font-normal normal-case tracking-normal">
                      approved · {soldTo}
                    </span>
                  )}
                </Label>
                <SupabaseSelectField
                  source={{
                    table: 'sales_orders',
                    valueColumn: 'orderNumber',
                    labelColumn: 'orderNumber',
                    secondaryColumn: 'orderDate',
                    scopeByCompany: true,
                    equalsFilter: soldTo
                      ? { status: 'APPROVED', customerName: soldTo }
                      : { status: 'APPROVED' },
                  }}
                  value={soNumber}
                  mono
                  allowFreeText
                  placeholder={soldTo ? 'pick or type' : 'pick consignee first'}
                  onPick={v => { void applySoToInvoice(v); }}
                />
              </FormField>
              <FormField>
                <Label className={labelClass}>PL #</Label>
                <Input value={plNumber} onChange={e => setPlNumber(e.target.value)}
                  className={inputClass + ' font-mono tabular-nums'} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Booking #</Label>
                <Input value={bookingNumber} onChange={e => setBookingNumber(e.target.value)}
                  className={inputClass + ' font-mono tabular-nums'} />
              </FormField>
            </div>
          </div>

          {/* Parties */}
          <div className={sectionClass}>
            <Label className={labelClass}>Parties</Label>
            <div className="grid grid-cols-3 gap-2">
              <FormField>
                <Label className={labelClass}>Shipper</Label>
                <Input value={shipperName} onChange={e => setShipperName(e.target.value)} className={inputClass} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Consignee (Sold to)</Label>
                <select
                  value={availableCustomers.find(c => c.name === soldTo)?.id ?? ''}
                  onChange={e => selectSoldTo(e.target.value)}
                  className={inputClass + ' w-full appearance-none'}
                >
                  <option value="">{soldTo || '— pick customer —'}</option>
                  {[...availableCustomers].sort((a, b) => a.name.localeCompare(b.name))
                    .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </FormField>
              <FormField>
                <Label className={labelClass}>Notify (Bill to)</Label>
                <select
                  value={availableCustomers.find(c => c.name === billToName)?.id ?? ''}
                  onChange={e => {
                    const picked = availableCustomers.find(c => c.id === e.target.value);
                    setBillToName(picked?.name ?? '');
                  }}
                  className={inputClass + ' w-full appearance-none'}
                >
                  <option value="">{billToName || '— pick notify party —'}</option>
                  {[...availableCustomers].sort((a, b) => a.name.localeCompare(b.name))
                    .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </FormField>
            </div>
          </div>

          {/* Commercial */}
          <div className={sectionClass}>
            <Label className={labelClass}>Commercial</Label>
            <div className="grid grid-cols-3 gap-2">
              <FormField>
                <Label className={labelClass}>Currency</Label>
                <select value={currency} onChange={e => setCurrency(e.target.value)}
                  className={inputClass + ' w-full appearance-none'}>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </FormField>
              <FormField>
                <Label className={labelClass}>Incoterm</Label>
                <select value={incoterm} onChange={e => {
                  const next = e.target.value;
                  setIncoterm(next);
                  // Auto-derive freight terms to match the new Incoterm.
                  setFreightTerms(freightTermsForIncoterm(next));
                }}
                  className={inputClass + ' w-full appearance-none'}>
                  {INCOTERMS.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
                </select>
              </FormField>
              <FormField>
                <Label className={labelClass}>Freight terms</Label>
                <select value={freightTerms} onChange={e => setFreightTerms(e.target.value)}
                  className={inputClass + ' w-full appearance-none'}>
                  <option value="">—</option>
                  {FREIGHT_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </FormField>
            </div>
            <FormField>
              <Label className={labelClass}>Payment terms</Label>
              <SupabaseSelectField
                source={{
                  table: 'payment_terms',
                  valueColumn: 'description',
                  labelColumn: 'description',
                  secondaryColumn: 'code',
                  scopeByCompany: true,
                }}
                value={paymentTerms}
                onPick={v => setPaymentTerms(v)}
              />
            </FormField>
          </div>

          {/* Shipment */}
          <div className={sectionClass}>
            <Label className={labelClass}>Shipment</Label>
            <div className="grid grid-cols-3 gap-2">
              <FormField>
                <Label className={labelClass}>POA (origin)</Label>
                <SupabaseSelectField
                  source={{
                    table: 'ports', valueColumn: 'name', labelColumn: 'name',
                    secondaryColumn: 'code',
                  }}
                  value={poa}
                  onPick={v => setPoa(v)}
                />
              </FormField>
              <FormField>
                <Label className={labelClass}>POD (destination)</Label>
                <SupabaseSelectField
                  source={{
                    table: 'ports', valueColumn: 'name', labelColumn: 'name',
                    secondaryColumn: 'code',
                  }}
                  value={pod}
                  onPick={v => setPod(v)}
                />
              </FormField>
            </div>
          </div>

          {/* Line items */}
          <div className={sectionClass}>
            <Label className={labelClass}>Line items</Label>
            <LineItemsEditor items={items} onChange={setItems} currency={currency} showHsCode />

            {/* Container / Seal paired per line item — each row shows
             *  the container number, seal and volumes that ship with
             *  the matching line item. Falls back to the global
             *  container list when item count ≠ container count. */}
            {(items.length > 0 || containerRows.length > 0) && (
              <div className="mt-2 rounded-md border border-slate-200 bg-white">
                <div className="px-3 py-1.5 border-b border-slate-200 flex items-center justify-between">
                  <Label className={labelClass}>Container &amp; Seal per line</Label>
                  <button
                    type="button"
                    onClick={() => setContainerRows(prev => [
                      ...prev,
                      { id: `cont_${Date.now()}`, container: '', seal: '', volumes: '' },
                    ])}
                    className="text-[10.5px] text-indigo-600 hover:text-indigo-700"
                  >
                    + Add container
                  </button>
                </div>
                <div className="divide-y divide-slate-100">
                  {(() => {
                    const pairCount = Math.max(items.length, containerRows.length);
                    if (pairCount === 0) {
                      return (
                        <div className="px-3 py-3 text-center text-[11px] text-slate-500">
                          No containers yet.
                        </div>
                      );
                    }
                    return Array.from({ length: pairCount }).map((_, i) => {
                      const item = items[i];
                      const row = containerRows[i];
                      const rowId = row?.id ?? `cont_${i}_${Date.now()}`;
                      const update = (patch: Partial<typeof row>) => {
                        setContainerRows(prev => {
                          const next = [...prev];
                          while (next.length <= i) next.push({ id: `cont_${next.length}_${Date.now()}`, container: '', seal: '', volumes: '' });
                          next[i] = { ...next[i], ...patch };
                          return next;
                        });
                      };
                      return (
                        <div key={rowId} className="px-3 py-2 grid grid-cols-[40px_1fr_130px_130px_80px_auto] gap-2 items-center">
                          <div className="text-[11px] text-slate-500 font-mono">{i + 1}.</div>
                          <div className="text-[11.5px] text-slate-700 truncate">
                            {item?.customerDescription || item?.productName || '—'}
                          </div>
                          <Input
                            value={row?.container ?? ''}
                            onChange={e => update({ container: e.target.value })}
                            placeholder="Container #"
                            className={inputClass + ' font-mono tabular-nums'}
                          />
                          <Input
                            value={row?.seal ?? ''}
                            onChange={e => update({ seal: e.target.value })}
                            placeholder="Seal #"
                            className={inputClass + ' font-mono tabular-nums'}
                          />
                          <Input
                            value={row?.volumes ?? ''}
                            onChange={e => update({ volumes: e.target.value.replace(/[^\d]/g, '') })}
                            placeholder="Vol"
                            className={inputClass + ' font-mono tabular-nums text-right'}
                          />
                          <button
                            type="button"
                            onClick={() => setContainerRows(prev => prev.filter((_, idx) => idx !== i))}
                            disabled={!row}
                            title="Remove container"
                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-slate-100 rounded disabled:opacity-30"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}
          </div>

          {/* Weights & totals — PL-style layout: a container summary
           *  card list + three columns (Gross/Net dual LBS+KG, Total
           *  volumes). Tare and Total qty stay accessible in an
           *  advanced row below. KG remains the canonical stored
           *  value; LBS mirrors auto-sync on edit. */}
          <div className={sectionClass}>
            <Label className={labelClass}>Weights &amp; totals</Label>

            {containerRows.length > 0 && (
              <div className="rounded-md border border-slate-200 bg-white">
                <div className="px-3 py-2 border-b border-slate-200 text-slate-700 text-[11px] font-medium">
                  Container Summary ({containerRows.length})
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-3">
                  {containerRows.map(c => (
                    <div key={c.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="font-mono tabular-nums text-[12px] text-slate-900">{c.container || '—'}</div>
                      <div className="text-[10.5px] text-slate-500 mt-0.5">Seal: <span className="font-mono">{c.seal || '—'}</span></div>
                      <div className="text-[10.5px] text-slate-500 mt-0.5">
                        Vol: <span className="font-mono tabular-nums">{c.volumes || '0'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-[1fr_1fr_auto] gap-3 items-end">
              <FormField>
                <Label className={labelClass}>Gross weight (total)</Label>
                <div className="flex items-center gap-1.5">
                  <FmtWeightInput
                    value={grossLbsMirror}
                    onChange={v => {
                      setGrossLbsMirror(v);
                      const n = Number(v); if (Number.isFinite(n) && v !== '') {
                        setGrossWeight((n * 0.453592).toFixed(2));
                      } else if (v === '') setGrossWeight('');
                    }}
                    className={inputClass + ' font-mono tabular-nums flex-1 text-right'} />
                  <span className="text-[10px] text-slate-500 w-6">lbs</span>
                  <FmtWeightInput
                    value={grossWeight}
                    onChange={v => {
                      setGrossWeight(v);
                      const n = Number(v); if (Number.isFinite(n) && v !== '') {
                        setGrossLbsMirror((n / 0.453592).toFixed(2));
                      } else if (v === '') setGrossLbsMirror('');
                    }}
                    className={inputClass + ' font-mono tabular-nums flex-1 text-right'} />
                  <span className="text-[10px] text-slate-500 w-6">kgs</span>
                </div>
              </FormField>
              <FormField>
                <Label className={labelClass}>
                  Net weight (total)
                  {hasItemsWeight && (
                    <span className="ml-1.5 text-[10px] text-slate-500 font-normal normal-case">
                      from line items
                    </span>
                  )}
                </Label>
                <div className="flex items-center gap-1.5">
                  <FmtWeightInput
                    value={derivedNetLbs}
                    readOnly={hasItemsWeight}
                    onChange={v => {
                      if (hasItemsWeight) return;
                      setNetLbsMirror(v);
                      const n = Number(v); if (Number.isFinite(n) && v !== '') {
                        setNetWeight((n * 0.453592).toFixed(2));
                      } else if (v === '') setNetWeight('');
                    }}
                    className={inputClass + ' font-mono tabular-nums flex-1 text-right'} />
                  <span className="text-[10px] text-slate-500 w-6">lbs</span>
                  <FmtWeightInput
                    value={derivedNetKg}
                    readOnly={hasItemsWeight}
                    onChange={v => {
                      if (hasItemsWeight) return;
                      setNetWeight(v);
                      const n = Number(v); if (Number.isFinite(n) && v !== '') {
                        setNetLbsMirror((n / 0.453592).toFixed(2));
                      } else if (v === '') setNetLbsMirror('');
                    }}
                    className={inputClass + ' font-mono tabular-nums flex-1 text-right'} />
                  <span className="text-[10px] text-slate-500 w-6">kgs</span>
                </div>
              </FormField>
              <FormField>
                <Label className={labelClass}>Total volumes</Label>
                <Input
                  value={(() => {
                    const sum = containerRows.reduce((s, c) => s + (Number(c.volumes) || 0), 0);
                    return sum > 0 ? String(sum) : totalVolumes;
                  })()}
                  readOnly={containerRows.some(c => (Number(c.volumes) || 0) > 0)}
                  onChange={e => setTotalVolumes(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="108"
                  className={inputClass + ' font-mono tabular-nums text-right w-24'} />
              </FormField>
            </div>

            {/* Advanced — tare / total qty kept but compacted below. */}
            <details className="group">
              <summary className="text-[11px] text-slate-500 cursor-pointer select-none hover:text-slate-700">
                Advanced (tare · total qty)
              </summary>
              <div className="grid grid-cols-3 gap-2 mt-2">
                <FormField>
                  <Label className={labelClass}>Tare (kg)</Label>
                  <Input value={tareWeight}
                    onChange={e => {
                      const v = e.target.value;
                      setTareWeight(v);
                      const n = Number(v); if (Number.isFinite(n) && v !== '') {
                        setTareLbsMirror((n / 0.453592).toFixed(2));
                      } else if (v === '') setTareLbsMirror('');
                    }}
                    className={inputClass + ' font-mono tabular-nums'} />
                </FormField>
                <FormField>
                  <Label className={labelClass}>Tare (lbs)</Label>
                  <Input value={tareLbsMirror}
                    onChange={e => {
                      const v = e.target.value;
                      setTareLbsMirror(v);
                      const n = Number(v); if (Number.isFinite(n) && v !== '') {
                        setTareWeight((n * 0.453592).toFixed(2));
                      } else if (v === '') setTareWeight('');
                    }}
                    className={inputClass + ' font-mono tabular-nums'} />
                </FormField>
                <FormField>
                  <Label className={labelClass}>Total qty</Label>
                  <Input value={totalQuantity} onChange={e => setTotalQuantity(e.target.value)}
                    className={inputClass + ' font-mono tabular-nums'} />
                </FormField>
              </div>
            </details>
          </div>

          {/* Banking — pick the remit-to bank from the banks table.
           *  Picking a bank fills the individual swift / routing /
           *  account fields from the row so downstream PDF generators
           *  don't have to change. Defaults to CHASE when unset. */}
          <div className={sectionClass}>
            <Label className={labelClass}>Remittance / banking</Label>
            <FormField>
              <Label className={labelClass}>Bank (pay-to)</Label>
              <BankPicker
                value={bankName}
                onChange={(bank) => {
                  setBankName(bank?.name ?? '');
                  setBankAddress(bank?.address ?? bank?.bankAddress ?? '');
                  setSwiftCode(bank?.swift_code ?? bank?.swiftCode ?? '');
                  setRoutingNumber(bank?.routing ?? bank?.routingNumber ?? '');
                  setAccountNumber(bank?.account_number ?? bank?.accountNumber ?? '');
                  setRemitTo(bank?.name ?? '');
                }}
              />
            </FormField>
            {(bankName || swiftCode || routingNumber || accountNumber) && (
              <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-[11.5px] text-slate-500 mt-1">
                {bankAddress && <div className="col-span-3">Address: <span className="text-slate-300">{bankAddress}</span></div>}
                {swiftCode && <div>SWIFT: <span className="font-mono tabular-nums text-slate-300">{swiftCode}</span></div>}
                {routingNumber && <div>Routing: <span className="font-mono tabular-nums text-slate-300">{routingNumber}</span></div>}
                {accountNumber && <div>Account: <span className="font-mono tabular-nums text-slate-300">{accountNumber}</span></div>}
              </div>
            )}
          </div>

          {/* Memo */}
          <div className={sectionClass}>
            <Label className={labelClass}>Memo</Label>
            <textarea value={memo} onChange={e => setMemo(e.target.value)} rows={3}
              className="bg-[#111111] border border-[#1f1f1f] rounded-md px-2 py-1.5 text-[12.5px] text-slate-200 placeholder:text-slate-600 resize-y leading-relaxed w-full"
              placeholder="Memo / remarks printed on the invoice" />
          </div>

          <div className="pt-2 border-t border-[#1f1f1f] text-[11px] text-slate-500 flex items-center gap-2">
            <Badge variant="neutral">invoices</Badge>
            <span className="text-slate-600">
              Subtotal <span className="font-mono tabular-nums text-slate-300">{fmtMoney(subtotal, currency)}</span>
            </span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-600">
              Total <span className="font-mono tabular-nums text-indigo-300 font-semibold">{fmtMoney(total, currency)}</span>
            </span>
            <span className="ml-auto font-mono tabular-nums text-slate-600">
              {mode === 'create' ? 'new' : `#${invoice.id.slice(0, 8)}`}
            </span>
          </div>
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete invoice ${invoice?.invoiceNumber ?? ''}?`}
        description="Removes the invoice and breaks any commission / receivable rows that depend on it."
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={deleteInvoice}
      />

      <DeliveryDocsModal
        invoice={docsOpen ? invoice : null}
        onOpenChange={(o) => { if (!o) { setDocsOpen(false); setDocsAutoEmail(false); } }}
        initialSelection={docsAutoEmail ? { invoice: true, pl: true } : undefined}
        autoEmail={docsAutoEmail}
      />
    </>
  );
};
