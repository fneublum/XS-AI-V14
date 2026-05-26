// Phase 3B — Trading Follow Up.
//
// v2 port of pages/SalesFollowUp.tsx. Mirrors the v1 logic — per-
// customer balance of sales orders vs invoices shipped across a
// date range, with running balance and unit conversion (LBS/KGS).
// QuickBooks statement, PDF export, and email draft are deferred;
// those sit behind external services and belong in a follow-up.

import React, { useCallback, useMemo, useState } from 'react';
import { Calendar, ClipboardList, Download, FileText, Package, RefreshCw, User } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import {
  Card, CardHeader, CardTitle, CardBody, Badge, EmptyState, StatCard, StatGrid,
} from '../primitives';
import { cn } from '../primitives/utils';
import { useCustomers, Customer } from '../queries/useCustomers';
import { useSalesOrders, SalesOrder } from '../queries/useSalesOrders';
import { useInvoices, Invoice } from '../queries/useInvoices';
import { useProducts, Product } from '../queries/useProducts';
import { usePorts } from '../queries/usePorts';
import { useBookings } from '../queries/useBookings';
import { BASIC_PRESETS, PresetId, computeRange } from '../lib/datePresets';
import { formatDate } from '../lib/formatDate';

// ─── Helpers (ported from v1 SalesFollowUp) ──────────────────────

const normalizeName = (s: string | undefined | null): string =>
  (s || '')
    .toLowerCase()
    .replace(/[.,'"`()\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const toNum = (val: unknown): number => {
  if (val == null) return 0;
  if (typeof val === 'number') return Number.isNaN(val) ? 0 : val;
  const cleaned = String(val).replace(/,/g, '').replace(/[^0-9.-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? 0 : n;
};

const LBS_TO_KGS = 0.453592;
type Unit = 'LBS' | 'KGS';

const formatQty = (lbs: number, unit: Unit): string => {
  if (!lbs) return '—';
  if (unit === 'KGS') return `${Math.round(lbs * LBS_TO_KGS).toLocaleString()} kgs`;
  return `${Math.round(lbs).toLocaleString()} lbs`;
};

const unitLabel = (unit: Unit) => (unit === 'KGS' ? 'KGS' : 'LBS');

// Product-name key: collapse polymer + form variants so naming noise
// ("PP GRANULAR", "PP natural granular (Granular)", "PP granular
// powder scrap") sums into one "pp granular" row.
const POLYMER_KEYWORDS = ['pp', 'pe', 'hdpe', 'ldpe', 'lldpe', 'pet', 'abs', 'ps', 'pc', 'pvc', 'pa'];
const FORM_KEYWORDS = ['granular', 'chunks', 'chunk', 'spheres', 'sphere', 'powder', 'flakes', 'flake', 'pellets', 'pellet', 'regrind'];
const productKey = (s: string | undefined | null): string => {
  const normalized = (s || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[.,'"`\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  const tokens = normalized.split(' ');
  const polymer = tokens.find(t => POLYMER_KEYWORDS.includes(t));
  const form = tokens.find(t => FORM_KEYWORDS.includes(t));
  if (polymer && form) return `${polymer} ${form.replace(/s$/, '')}`;
  return normalized;
};

const orderItems = (so: SalesOrder) =>
  (so.items ?? []).map(i => ({
    productId: ((i as { productId?: string }).productId ?? '').trim() || null,
    productName: String((i as { productName?: string }).productName ?? '').trim(),
    quantity: toNum((i as { quantity?: unknown }).quantity),
    total:    toNum((i as { total?: unknown }).total),
  }));

const invoiceItems = (inv: Invoice) =>
  (inv.items ?? []).map(i => ({
    productId: ((i as { productId?: string }).productId ?? '').trim() || null,
    productName: String((i as { productName?: string }).productName ?? '').trim(),
    quantity: toNum((i as { quantity?: unknown }).quantity),
  }));

/** Extract container numbers from an invoice. The `containers` column is
 *  a JSON-encoded array (sometimes wrapped as `{__meta, items}`) and
 *  each entry carries a `container` or `containerNo` field depending on
 *  which engine wrote it (v1 vs v2). Falls back to the legacy flat
 *  `containerNumber` field when no detailed list is present. */
const invoiceContainerNumbers = (inv: Invoice): string[] => {
  const raw = (inv as { containers?: unknown }).containers;
  let parsed: unknown = raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  }
  let items: unknown[] = [];
  if (Array.isArray(parsed)) items = parsed;
  else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.items)) items = obj.items;
  }
  const nums = items
    .map(x => {
      const c = x as Record<string, unknown>;
      const v = (c.container ?? c.containerNo ?? c.containerNumber ?? '');
      return String(v).trim();
    })
    .filter(Boolean);
  // Deduplicate while preserving order.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const n of nums) {
    if (!seen.has(n)) { seen.add(n); unique.push(n); }
  }
  if (unique.length > 0) return unique;
  const flat = String((inv as { containerNumber?: string }).containerNumber ?? '').trim();
  return flat ? [flat] : [];
};

const joinProductNames = (items: Array<{ productName: string }>): string => {
  const names = items.map(i => i.productName).filter(Boolean);
  if (names.length === 0) return '—';
  if (names.length === 1) return names[0];
  if (names.length === 2) return names.join(', ');
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
};

const totalQty = (items: Array<{ quantity: number }>): number =>
  items.reduce((s, i) => s + (i.quantity || 0), 0);

const formatCurrency = (val: number | null | undefined, currency = 'USD'): string => {
  const n = typeof val === 'number' ? val : parseFloat(val as unknown as string);
  if (n == null || Number.isNaN(n)) return '—';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
  } catch {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
  }
};


const DEFAULT_PRESET: PresetId = 'last_12_months';

type Entry =
  | { kind: 'order';   date: string | null; data: SalesOrder }
  | { kind: 'shipped'; date: string | null; data: Invoice };

// ─── Component ────────────────────────────────────────────────────

const TradingFollowUpV2: React.FC = () => {
  const customers = useCustomers();
  const salesOrders = useSalesOrders({ limit: 500 });
  const invoices = useInvoices();
  const products = useProducts();
  const ports = usePorts();
  // Used to look up `eta` for the Shipped table's ETA column when the
  // invoice has a matching bookingNumber.
  const bookings = useBookings();

  const initialRange = useMemo(
    () => computeRange(DEFAULT_PRESET) ?? { startDate: '', endDate: '' },
    [],
  );

  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [preset, setPreset] = useState<PresetId>(DEFAULT_PRESET);
  const [startDate, setStartDate] = useState(initialRange.startDate);
  const [endDate, setEndDate] = useState(initialRange.endDate);
  const [unit, setUnit] = useState<Unit>('LBS');
  const [generated, setGenerated] = useState(false);

  // Resolve each line item to the canonical catalog product name,
  // falling back to the raw productName if no catalog match. Used
  // by both the balance table and the per-product summary.
  const resolveCatalogName = useMemo(() => {
    const catalog: Product[] = products.data ?? [];
    const byId = new Map<string, Product>();
    const byNameKey = new Map<string, Product>();
    for (const p of catalog) {
      byId.set(p.id, p);
      const nk = productKey(p.name);
      if (nk && !byNameKey.has(nk)) byNameKey.set(nk, p);
    }
    return (item: { productId: string | null; productName: string }): string => {
      const viaId = item.productId ? byId.get(item.productId) : null;
      if (viaId) return viaId.name;
      const nk = productKey(item.productName);
      const viaName = nk ? byNameKey.get(nk) : null;
      if (viaName) return viaName.name;
      return item.productName || '(unspecified)';
    };
  }, [products.data]);

  // ETA resolver — looks up the booking by number first, otherwise
  // estimates from the POD country and the invoice date per EC4's
  // shipping lane defaults:
  //   USA → Brazil  : invoice date + 30
  //   USA → Europe  : invoice date + 40 (incl. Turkey)
  //   USA → Asia    : invoice date + 40
  //   Else          : blank
  const bookingEtaByNumber = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const b of bookings.data ?? []) {
      const key = (b.bookingNumber ?? '').trim();
      if (!key) continue;
      map.set(key, b.eta ?? null);
    }
    return map;
  }, [bookings.data]);

  // Port catalog lookup: name → country code so we can resolve PODs
  // entered as plain text.
  const podCountryByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of ports.data ?? []) {
      const name = (p.name ?? '').toLowerCase();
      const code = (p.code ?? '').toUpperCase();
      if (name && code) m.set(name, code.slice(0, 2));
    }
    return m;
  }, [ports.data]);

  const inferEtaFromPodAndDate = useCallback(
    (pod: string | null | undefined, invDate: string | null | undefined): string | null => {
      if (!invDate) return null;
      const base = new Date(invDate);
      if (Number.isNaN(base.getTime())) return null;
      // Pull the 2-letter country code: either out of an embedded
      // UN/LOCODE like "(BRMAO)" / "BRMAO", or via the ports catalog.
      let cc = '';
      const v = (pod || '').trim();
      const m = v.match(/[A-Z]{5}/);
      if (m) cc = m[0].slice(0, 2);
      else {
        const cleanName = v.replace(/\s*\([A-Z]{5}\)\s*$/, '').toLowerCase();
        cc = podCountryByName.get(cleanName) ?? '';
      }
      if (!cc) return null;

      const BRAZIL = 'BR';
      const EUROPE_AND_TURKEY = new Set([
        'AL','AT','BA','BE','BG','BY','CH','CY','CZ','DE','DK','EE','ES','FI',
        'FR','GB','GR','HR','HU','IE','IS','IT','LT','LU','LV','MD','ME','MK',
        'MT','NL','NO','PL','PT','RO','RS','RU','SE','SI','SK','TR','UA','XK',
      ]);
      const ASIA = new Set([
        'AE','AF','AM','AZ','BD','BH','BN','BT','CN','GE','HK','ID','IL','IN',
        'IQ','IR','JO','JP','KG','KH','KP','KR','KW','KZ','LA','LB','LK','MM',
        'MN','MO','MV','MY','NP','OM','PH','PK','PS','QA','SA','SG','SY','TH',
        'TJ','TL','TM','TW','UZ','VN','YE',
      ]);
      let days: number | null = null;
      if (cc === BRAZIL)              days = 30;
      else if (EUROPE_AND_TURKEY.has(cc)) days = 40;
      else if (ASIA.has(cc))          days = 40;
      if (days === null) return null;
      base.setDate(base.getDate() + days);
      return base.toISOString().slice(0, 10);
    },
    [podCountryByName],
  );

  const etaForInvoice = useCallback(
    (inv: Invoice): { eta: string | null; source: 'booking' | 'estimated' | 'none' } => {
      const bn = (inv.bookingNumber ?? '').trim();
      if (bn) {
        const fromBooking = bookingEtaByNumber.get(bn);
        if (fromBooking) return { eta: fromBooking, source: 'booking' };
      }
      const est = inferEtaFromPodAndDate(inv.pod, inv.invoiceDate);
      if (est) return { eta: est, source: 'estimated' };
      return { eta: null, source: 'none' };
    },
    [bookingEtaByNumber, inferEtaFromPodAndDate],
  );

  // ETA for a sales order (used in the To Ship table). Mirrors etaForInvoice
  // but reads from so.bookingNumber and so.orderDate.
  const etaForSalesOrder = useCallback(
    (so: { bookingNumber: string | null; pod: string | null; orderDate: string | null }):
      { eta: string | null; source: 'booking' | 'estimated' | 'none' } => {
      const bn = (so.bookingNumber ?? '').trim();
      if (bn) {
        const fromBooking = bookingEtaByNumber.get(bn);
        if (fromBooking) return { eta: fromBooking, source: 'booking' };
      }
      const est = inferEtaFromPodAndDate(so.pod, so.orderDate);
      if (est) return { eta: est, source: 'estimated' };
      return { eta: null, source: 'none' };
    },
    [bookingEtaByNumber, inferEtaFromPodAndDate],
  );

  // Render POD as "Name (CODE)" when the ports catalog has the
  // code; fall back to the raw value (which may already be a name
  // or "Name (CODE)" from prior data entry).
  const formatPod = useMemo(() => {
    const byCode = new Map<string, { code: string; name: string }>();
    const byName = new Map<string, { code: string; name: string }>();
    for (const p of ports.data ?? []) {
      const rec = { code: (p.code || '').toUpperCase(), name: p.name || '' };
      if (rec.code) byCode.set(rec.code, rec);
      if (rec.name) byName.set(rec.name.toLowerCase(), rec);
    }
    return (raw: string | null | undefined): string => {
      const v = (raw || '').trim();
      if (!v) return '—';
      // Already in "Name (CODE)" form — leave alone.
      if (/\([A-Z]{5}\)\s*$/.test(v)) return v;
      const byCodeHit = byCode.get(v.toUpperCase());
      if (byCodeHit) return `${byCodeHit.name} (${byCodeHit.code})`;
      const byNameHit = byName.get(v.toLowerCase());
      if (byNameHit) return `${byNameHit.name} (${byNameHit.code})`;
      return v;
    };
  }, [ports.data]);

  const applyPreset = useCallback((id: PresetId) => {
    setPreset(id);
    const r = computeRange(id);
    if (r) {
      setStartDate(r.startDate);
      setEndDate(r.endDate);
    }
  }, []);

  const sortedCustomers = useMemo<Customer[]>(
    () => [...(customers.data ?? [])].sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [customers.data],
  );

  const selectedCustomer = useMemo(
    () => sortedCustomers.find(c => c.id === selectedCustomerId),
    [sortedCustomers, selectedCustomerId],
  );

  const inRange = useCallback((dateStr: string | null | undefined): boolean => {
    if (!dateStr) return false;
    if (startDate && dateStr < startDate) return false;
    if (endDate   && dateStr > endDate)   return false;
    return true;
  }, [startDate, endDate]);

  const customerOrders = useMemo<SalesOrder[]>(() => {
    if (!selectedCustomer) return [];
    const cname = normalizeName(selectedCustomer.name);
    return (salesOrders.data ?? []).filter(so => {
      if (so.status === 'REJECTED') return false;
      const match = so.customerId === selectedCustomer.id
                 || normalizeName(so.customerName) === cname;
      return match && inRange(so.orderDate);
    });
  }, [salesOrders.data, selectedCustomer, inRange]);

  const customerInvoices = useMemo<Invoice[]>(() => {
    if (!selectedCustomer) return [];
    const cname = normalizeName(selectedCustomer.name);
    return (invoices.data ?? []).filter(inv => {
      const soldTo = normalizeName(inv.soldTo || inv.billToName);
      const match = soldTo === cname || normalizeName(inv.shipperName) === cname;
      return match && inRange(inv.invoiceDate);
    });
  }, [invoices.data, selectedCustomer, inRange]);

  const entries = useMemo<Array<Entry & { runningBalance: number }>>(() => {
    const merged: Entry[] = [
      ...customerOrders.map<Entry>(so  => ({ kind: 'order',   date: so.orderDate,   data: so })),
      ...customerInvoices.map<Entry>(inv => ({ kind: 'shipped', date: inv.invoiceDate, data: inv })),
    ];
    merged.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    let running = 0;
    return merged.map(e => {
      const amt = toNum(e.data.totalAmount);
      if (e.kind === 'order') running += amt;
      else                    running -= amt;
      return { ...e, runningBalance: running };
    });
  }, [customerOrders, customerInvoices]);

  const totals = useMemo(() => {
    const totalOrdered = customerOrders.reduce((s, so)  => s + toNum(so.totalAmount),  0);
    const totalShipped = customerInvoices.reduce((s, inv) => s + toNum(inv.totalAmount), 0);
    const qtyOrdered   = customerOrders.reduce((s, so)  => s + totalQty(orderItems(so)), 0);
    const qtyShipped   = customerInvoices.reduce((s, inv) => {
      const fromItems = totalQty(invoiceItems(inv));
      return s + (fromItems || toNum(inv.grossWeight));
    }, 0);
    return { totalOrdered, totalShipped, pending: totalOrdered - totalShipped, qtyOrdered, qtyShipped };
  }, [customerOrders, customerInvoices]);

  // ── TO SHIP — per-SO pending qty/amount ─────────────────────
  // For each sales order in range, match invoices by `soNumber` and
  // subtract their shipped qty + amount. Only SOs with a positive
  // pending qty (or amount, if quantity isn't recorded) make the
  // table — fully-shipped SOs drop out automatically. Mirrors the
  // shipped-table row shape so the two tables read as a single
  // ordered ↔ shipped pipeline view.
  interface ToShipRow {
    so: SalesOrder;
    pendingQty: number;
    pendingAmount: number;
  }
  const toShipRows = useMemo<ToShipRow[]>(() => {
    // Sum shipped qty + amount per SO number (matched against
    // invoice.soNumber). One SO can have several invoices when
    // shipments are split across multiple containers / dates.
    const shippedBySo = new Map<string, { qty: number; amount: number }>();
    for (const inv of customerInvoices) {
      const ref = (inv.soNumber ?? '').trim();
      if (!ref) continue;
      const cur = shippedBySo.get(ref) ?? { qty: 0, amount: 0 };
      const fromItems = totalQty(invoiceItems(inv));
      cur.qty    += fromItems || toNum(inv.grossWeight);
      cur.amount += toNum(inv.totalAmount);
      shippedBySo.set(ref, cur);
    }
    // Terminal SO statuses — the user has explicitly closed these,
    // so they don't belong in the "To Ship" list even if the qty
    // math hasn't fully zeroed out (e.g. partial fulfilment that
    // the user accepted as complete).
    const terminalStatus = new Set(['FULFILLED', 'REJECTED', 'COMPLETED', 'CLOSED', 'CANCELLED']);
    const rows: ToShipRow[] = [];
    for (const so of customerOrders) {
      const status = (so.status ?? '').trim().toUpperCase();
      if (terminalStatus.has(status)) continue;
      const orderedQty    = totalQty(orderItems(so));
      const orderedAmount = toNum(so.totalAmount);
      const ref = (so.orderNumber ?? '').trim() || so.id;
      const shipped = shippedBySo.get(ref) ?? { qty: 0, amount: 0 };
      const pendingQty    = Math.max(0, orderedQty - shipped.qty);
      const pendingAmount = Math.max(0, orderedAmount - shipped.amount);
      if (pendingQty <= 0 && pendingAmount <= 0) continue;
      rows.push({ so, pendingQty, pendingAmount });
    }
    rows.sort((a, b) => (a.so.orderDate ?? '').localeCompare(b.so.orderDate ?? ''));
    return rows;
  }, [customerOrders, customerInvoices]);

  const toShipTotals = useMemo(() => {
    const qty    = toShipRows.reduce((s, r) => s + r.pendingQty, 0);
    const amount = toShipRows.reduce((s, r) => s + r.pendingAmount, 0);
    return { qty, amount };
  }, [toShipRows]);

  // Per-product aggregation — sum quantities and amounts across
  // orders and invoices, keyed by a normalized product name so
  // minor spelling variants merge. Mirror v1 SalesFollowUp.
  interface ProductRow {
    productName: string;
    orderedLbs: number;
    orderedAmount: number;
    shippedLbs: number;
    shippedAmount: number;
  }
  const productSummary = useMemo<ProductRow[]>(() => {
    const catalog: Product[] = products.data ?? [];
    const byId = new Map<string, Product>();
    const byNameKey = new Map<string, Product>();
    for (const p of catalog) {
      byId.set(p.id, p);
      const nk = productKey(p.name);
      if (nk && !byNameKey.has(nk)) byNameKey.set(nk, p);
    }
    const resolve = (item: { productId: string | null; productName: string }): { key: string; displayName: string } => {
      const viaId = item.productId ? byId.get(item.productId) : null;
      if (viaId) return { key: `id:${viaId.id}`, displayName: viaId.name };
      const nk = productKey(item.productName);
      const viaName = nk ? byNameKey.get(nk) : null;
      if (viaName) return { key: `id:${viaName.id}`, displayName: viaName.name };
      return { key: nk || '__unnamed__', displayName: item.productName || '(unspecified)' };
    };
    const map = new Map<string, ProductRow>();
    const ensure = (item: { productId: string | null; productName: string }): ProductRow => {
      const { key, displayName } = resolve(item);
      let row = map.get(key);
      if (!row) {
        row = {
          productName: displayName,
          orderedLbs: 0, orderedAmount: 0, shippedLbs: 0, shippedAmount: 0,
        };
        map.set(key, row);
      }
      return row;
    };
    for (const so of customerOrders) {
      for (const item of orderItems(so)) {
        const row = ensure(item);
        row.orderedLbs    += item.quantity;
        row.orderedAmount += item.total;
      }
    }
    for (const inv of customerInvoices) {
      const items = invoiceItems(inv);
      if (items.length === 0) continue;
      for (const item of items) {
        const row = ensure(item);
        row.shippedLbs += item.quantity;
      }
      // Split invoice total proportionally by quantity so per-
      // product shipped amount approximates without needing item-
      // level unit price parsed out of the JSON blob.
      const invQtyTotal = items.reduce((s, i) => s + i.quantity, 0);
      const invAmount   = toNum(inv.totalAmount);
      if (invQtyTotal > 0 && invAmount > 0) {
        for (const item of items) {
          const row = ensure(item);
          row.shippedAmount += invAmount * (item.quantity / invQtyTotal);
        }
      }
    }
    return Array.from(map.values())
      .sort((a, b) => (b.orderedLbs + b.shippedLbs) - (a.orderedLbs + a.shippedLbs));
  }, [customerOrders, customerInvoices, products.data]);

  const loading = customers.isLoading || salesOrders.isLoading || invoices.isLoading;
  const dataReady = !loading && sortedCustomers.length > 0;

  // ─── Export helpers ────────────────────────────────────────────
  // Build a plain rows[] from the shipped entries currently in
  // `entries` — matches the on-screen table so users get exactly
  // what they see.
  // Build the two table sections (Shipped and To Ship) that mirror the
  // on-screen layout. Each section has its own header / body / totals.
  const buildExportSections = useCallback(() => {
    // ── Shipped ─────────────────────────────────────────────────
    const shippedHeader = [
      'Date', 'Type', 'Reference', 'Details', 'Product', 'POD',
      'Container', 'ETA', 'Qty (LBS)', 'Qty (KGS)', 'Shipped',
    ];
    const shippedRows = entries.filter(e => e.kind === 'shipped');
    const shippedBody = shippedRows.map(entry => {
      const inv = entry.data as Invoice;
      const items = invoiceItems(inv);
      const invQty = totalQty(items) || toNum(inv.grossWeight);
      const productNames = Array.from(new Set(items.map(resolveCatalogName))).filter(Boolean).join(', ') || '—';
      const containers = invoiceContainerNumbers(inv);
      const { eta, source } = etaForInvoice(inv);
      const etaCell = eta
        ? `${formatDate(eta)}${source === 'estimated' ? ' (est)' : ''}`
        : '—';
      return [
        formatDate(inv.invoiceDate) || '',
        'Shipped',
        inv.invoiceNumber || inv.id || '',
        inv.soNumber || inv.pod || '—',
        productNames,
        formatPod(inv.pod),
        containers.length > 0 ? containers.join(', ') : '—',
        etaCell,
        formatQty(invQty, 'LBS'),
        formatQty(invQty, 'KGS'),
        formatCurrency(inv.totalAmount, inv.currency),
      ];
    });
    const shippedTotals = [
      '', '', '', '', '', '', '', 'TOTAL',
      formatQty(totals.qtyShipped, 'LBS'),
      formatQty(totals.qtyShipped, 'KGS'),
      formatCurrency(totals.totalShipped),
    ];

    // ── To Ship ─────────────────────────────────────────────────
    const toShipHeader = [
      'Date', 'Type', 'Reference', 'Details', 'Product', 'POD', 'ETA',
      'Qty Pending (LBS)', 'Qty Pending (KGS)', 'Pending $',
    ];
    const toShipBody = toShipRows.map(({ so, pendingQty, pendingAmount }) => {
      const productNames = Array.from(new Set(
        orderItems(so).map(resolveCatalogName).filter(Boolean),
      )).join(', ') || '—';
      const { eta, source } = etaForSalesOrder(so);
      const etaCell = eta ? `${formatDate(eta)}${source === 'estimated' ? ' (est)' : ''}` : '—';
      return [
        formatDate(so.orderDate) || '',
        'To Ship',
        so.orderNumber || so.id || '',
        so.status || '—',
        productNames,
        formatPod(so.pod),
        etaCell,
        formatQty(pendingQty, 'LBS'),
        formatQty(pendingQty, 'KGS'),
        formatCurrency(pendingAmount, so.currency),
      ];
    });
    const toShipTotalsRow = [
      '', '', '', '', '', '', 'TOTAL',
      formatQty(toShipTotals.qty, 'LBS'),
      formatQty(toShipTotals.qty, 'KGS'),
      formatCurrency(toShipTotals.amount),
    ];

    return {
      shipped:  { header: shippedHeader, body: shippedBody, totals: shippedTotals },
      toShip:   { header: toShipHeader,   body: toShipBody,   totals: toShipTotalsRow },
    };
  }, [entries, toShipRows, resolveCatalogName, formatPod, etaForInvoice, etaForSalesOrder, totals.qtyShipped, totals.totalShipped, toShipTotals.qty, toShipTotals.amount]);

  const exportFilename = useCallback((ext: 'pdf' | 'xlsx') => {
    const cname = (selectedCustomer?.name || 'customer').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
    const range = `${startDate || 'any'}_${endDate || 'any'}`;
    return `TradingFollowUp_${cname}_${range}.${ext}`;
  }, [selectedCustomer, startDate, endDate]);

  const downloadPdf = useCallback(() => {
    if (!selectedCustomer) return;
    const { shipped, toShip } = buildExportSections();
    const doc = new jsPDF({ orientation: 'landscape' });

    // Document title block — same content for both PDF and XLSX exports.
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Trading Follow Up', 14, 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(selectedCustomer.name, 14, 22);
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(
      `Period: ${formatDate(startDate) || 'Any'} → ${formatDate(endDate) || 'Any'}`,
      14, 28,
    );
    doc.setTextColor(0);

    // ── Shipped section ────────────────────────────────────────
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Shipped', 14, 36);
    doc.setFont('helvetica', 'normal');
    autoTable(doc, {
      head: [shipped.header],
      body: shipped.body.length > 0 ? shipped.body : [['—', '—', '—', '—', '—', '—', '—', '—', '—', '—']],
      foot: shipped.body.length > 0 ? [shipped.totals] : undefined,
      startY: 39,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [16, 122, 87], textColor: 255 },
      footStyles: { fillColor: [241, 245, 249], textColor: 0, fontStyle: 'bold' },
      // Columns 0-7: text. 8-10: numeric (right-aligned).
      columnStyles: { 8: { halign: 'right' }, 9: { halign: 'right' }, 10: { halign: 'right' } },
    });

    // ── To Ship section ────────────────────────────────────────
    const shippedEndY = (doc as any).lastAutoTable?.finalY ?? 39;
    const toShipTitleY = shippedEndY + 10;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('To Ship', 14, toShipTitleY);
    doc.setFont('helvetica', 'normal');
    autoTable(doc, {
      head: [toShip.header],
      body: toShip.body.length > 0
        ? toShip.body
        : [['—', '—', '—', '—', '—', '—', '—', '—', '—']],
      foot: toShip.body.length > 0 ? [toShip.totals] : undefined,
      startY: toShipTitleY + 3,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [180, 83, 9], textColor: 255 },
      footStyles: { fillColor: [241, 245, 249], textColor: 0, fontStyle: 'bold' },
      columnStyles: { 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } },
    });

    doc.save(exportFilename('pdf'));
  }, [selectedCustomer, buildExportSections, startDate, endDate, exportFilename]);

  const downloadXlsx = useCallback(() => {
    if (!selectedCustomer) return;
    const { shipped, toShip } = buildExportSections();
    const periodLine = `Period: ${formatDate(startDate) || 'Any'} → ${formatDate(endDate) || 'Any'}`;

    // Stitch one sheet with: title block + Shipped section + spacer +
    // To Ship section. Cleaner than two sheets because users typically
    // print or share a single page.
    const aoa: (string | number)[][] = [
      ['Trading Follow Up'],
      [selectedCustomer.name],
      [periodLine],
      [],
      ['Shipped'],
      shipped.header,
      ...(shipped.body.length > 0 ? shipped.body : [['—'.padEnd(10, ' ')]]),
      ...(shipped.body.length > 0 ? [shipped.totals] : []),
      [],
      ['To Ship'],
      toShip.header,
      ...(toShip.body.length > 0 ? toShip.body : [['—'.padEnd(10, ' ')]]),
      ...(toShip.body.length > 0 ? [toShip.totals] : []),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 14 },
      { wch: 40 }, { wch: 22 }, { wch: 16 }, { wch: 14 },
      { wch: 16 }, { wch: 16 }, { wch: 14 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Balance');
    XLSX.writeFile(wb, exportFilename('xlsx'));
  }, [selectedCustomer, buildExportSections, startDate, endDate, exportFilename]);

  return (
    <div className="max-w-[1200px] space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">
            Trading Follow Up
          </h1>
          <Badge variant="info">Live</Badge>
        </div>
        <p className="text-[13px] text-slate-500 mt-1">
          Per-customer balance of sales orders vs invoices shipped across a date range.
        </p>
      </div>

      {/* Filter bar */}
      <Card>
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="md:col-span-2">
              <FilterLabel icon={<User size={11} />} text="Customer" />
              <select
                value={selectedCustomerId}
                onChange={e => { setSelectedCustomerId(e.target.value); setGenerated(false); }}
                disabled={!dataReady}
                className="mt-1 w-full px-2.5 py-1.5 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] rounded-md text-slate-200 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
              >
                <option value="">
                  {loading
                    ? 'Loading customers…'
                    : sortedCustomers.length === 0
                      ? 'No customers available'
                      : `Select a customer (${sortedCustomers.length})`}
                </option>
                {sortedCustomers.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <FilterLabel icon={<Calendar size={11} />} text="Range" />
              <select
                value={preset}
                onChange={e => applyPreset(e.target.value as PresetId)}
                className="mt-1 w-full px-2.5 py-1.5 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] rounded-md text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                {BASIC_PRESETS.map(p => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>

            <div>
              <FilterLabel icon={<Calendar size={11} />} text="From" />
              <input
                type="date"
                value={startDate}
                onChange={e => { setStartDate(e.target.value); setPreset('custom'); }}
                className="mt-1 w-full px-2.5 py-1.5 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] rounded-md text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <FilterLabel icon={<Calendar size={11} />} text="To" />
              <input
                type="date"
                value={endDate}
                onChange={e => { setEndDate(e.target.value); setPreset('custom'); }}
                className="mt-1 w-full px-2.5 py-1.5 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] rounded-md text-slate-200 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <div className="inline-flex rounded-md border border-[#1f1f1f] overflow-hidden" role="group" aria-label="Quantity unit">
              {(['LBS', 'KGS'] as Unit[]).map(u => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setUnit(u)}
                  className={cn(
                    'px-2.5 py-1 text-[11px] font-semibold transition-colors',
                    unit === u
                      ? 'bg-indigo-600 text-white'
                      : 'bg-[#0f0f0f] text-slate-400 hover:text-slate-100 hover:bg-[#141414]',
                  )}
                >
                  {u}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setGenerated(true)}
              disabled={!selectedCustomerId}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors',
                selectedCustomerId
                  ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                  : 'bg-[#141414] text-slate-600 cursor-not-allowed',
              )}
            >
              <RefreshCw size={12} />
              Generate Balance
            </button>
            {customers.error && (
              <span className="text-[11px] text-red-400">
                Customer load failed: {customers.error.message}
              </span>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Totals */}
      {generated && selectedCustomer && (
        <StatGrid columns={3}>
          <StatCard
            label="Total Ordered"
            value={formatCurrency(totals.totalOrdered)}
            delta={{ text: `${customerOrders.length} sales order${customerOrders.length === 1 ? '' : 's'}`, tone: 'neutral' }}
          />
          <StatCard
            label="Total Shipped"
            value={formatCurrency(totals.totalShipped)}
            delta={{ text: `${customerInvoices.length} invoice${customerInvoices.length === 1 ? '' : 's'}`, tone: 'positive' }}
          />
          <StatCard
            label="Pending to Ship"
            value={formatCurrency(totals.pending)}
            delta={{
              text: `${formatQty(totals.qtyOrdered - totals.qtyShipped, unit)} unshipped`,
              tone: totals.pending > 0 ? 'warning' : 'neutral',
            }}
          />
        </StatGrid>
      )}

      {/* Balance table */}
      {generated && selectedCustomer && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{selectedCustomer.name}</CardTitle>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Period: {formatDate(startDate) || 'Any'} → {formatDate(endDate) || 'Any'}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={downloadPdf}
                disabled={entries.length === 0}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-medium bg-[#141414] border border-[#1f1f1f] text-slate-300 hover:text-slate-100 hover:border-[#2a2a2a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Download size={11} /> PDF
              </button>
              <button
                type="button"
                onClick={downloadXlsx}
                disabled={entries.length === 0}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-medium bg-[#141414] border border-[#1f1f1f] text-slate-300 hover:text-slate-100 hover:border-[#2a2a2a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Download size={11} /> XLSX
              </button>
            </div>
          </CardHeader>

          {entries.length === 0 ? (
            <EmptyState
              title="No orders or invoices"
              description="This customer has no records in the selected range."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-[#0f0f0f] border-b border-[#1f1f1f]">
                  <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Reference</th>
                    <th className="px-3 py-2 font-medium">Details</th>
                    <th className="px-3 py-2 font-medium">Product</th>
                    <th className="px-3 py-2 font-medium">POD</th>
                    <th className="px-3 py-2 font-medium">Container</th>
                    <th className="px-3 py-2 font-medium">ETA</th>
                    <th className="px-3 py-2 font-medium text-right">Qty (LBS)</th>
                    <th className="px-3 py-2 font-medium text-right">Qty (KGS)</th>
                    <th className="px-3 py-2 font-medium text-right">Shipped</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.filter(e => e.kind === 'shipped').map(entry => {
                    const inv = entry.data;
                    const invItemsData = invoiceItems(inv);
                    const invQty = totalQty(invItemsData) || toNum(inv.grossWeight);
                    const invContainers = invoiceContainerNumbers(inv);
                    const invContainersDisplay = invContainers.length === 0
                      ? '—'
                      : invContainers.length <= 2
                        ? invContainers.join(', ')
                        : `${invContainers[0]}, ${invContainers[1]} +${invContainers.length - 2}`;
                    return (
                      <tr key={`inv-${inv.id}`} className="border-b border-[#141414] hover:bg-[#0f0f0f] transition-colors">
                        <td className="px-3 py-1.5 whitespace-nowrap text-slate-400 font-mono tabular-nums">{formatDate(inv.invoiceDate)}</td>
                        <td className="px-3 py-1.5">
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-sm bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                            <Package size={9} /> Shipped
                          </span>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[11px] text-slate-300">{inv.invoiceNumber || inv.id}</td>
                        <td className="px-3 py-1.5 text-[11px] text-slate-500">{inv.soNumber || inv.pod || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-300 max-w-[220px]" title={Array.from(new Set(invItemsData.map(resolveCatalogName))).filter(Boolean).join(', ')}>
                          <div className="line-clamp-2 leading-tight">{joinProductNames(Array.from(new Set(invItemsData.map(resolveCatalogName))).map(productName => ({ productName })))}</div>
                        </td>
                        <td className="px-3 py-1.5 text-[11px] text-slate-400 whitespace-nowrap">{formatPod(inv.pod)}</td>
                        <td className="px-3 py-1.5 text-[11px] text-slate-300 font-mono whitespace-nowrap" title={invContainers.join(', ')}>{invContainersDisplay}</td>
                        {(() => {
                          const { eta, source } = etaForInvoice(inv);
                          return (
                            <td className="px-3 py-1.5 whitespace-nowrap text-[11px] font-mono tabular-nums text-slate-400"
                              title={
                                source === 'booking' ? `From booking ${inv.bookingNumber}`
                                : source === 'estimated' ? `Estimated from POD + invoice date`
                                : 'Not enough info to compute'
                              }>
                              {eta ? formatDate(eta) : '—'}
                              {source === 'estimated' && eta && (
                                <span className="ml-1 text-[9px] text-amber-400 align-top">est</span>
                              )}
                            </td>
                          );
                        })()}
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{formatQty(invQty, 'LBS')}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{formatQty(invQty, 'KGS')}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-emerald-300">{formatCurrency(inv.totalAmount, inv.currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-[#0f0f0f] border-t border-[#1f1f1f]">
                  <tr className="text-[11px] uppercase tracking-wider text-slate-400">
                    <td colSpan={8} className="px-3 py-2 text-right font-medium">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-100">{formatQty(totals.qtyShipped, 'LBS')}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-100">{formatQty(totals.qtyShipped, 'KGS')}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-300">{formatCurrency(totals.totalShipped)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* TO SHIP — sales orders with pending qty/amount after netting
          out any matching invoices. Mirrors the shipped table shape so
          the two read as ordered ↔ shipped on the same screen. */}
      {generated && selectedCustomer && toShipRows.length > 0 && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>To Ship</CardTitle>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Sales orders with quantities not yet invoiced. Period: {formatDate(startDate) || 'Any'} → {formatDate(endDate) || 'Any'}.
              </div>
            </div>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-[#0f0f0f] border-b border-[#1f1f1f]">
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Reference</th>
                  <th className="px-3 py-2 font-medium">Details</th>
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium">POD</th>
                  <th className="px-3 py-2 font-medium">ETA</th>
                  <th className="px-3 py-2 font-medium text-right">Qty Pending (LBS)</th>
                  <th className="px-3 py-2 font-medium text-right">Qty Pending (KGS)</th>
                  <th className="px-3 py-2 font-medium text-right">Pending $</th>
                </tr>
              </thead>
              <tbody>
                {toShipRows.map(({ so, pendingQty, pendingAmount }) => {
                  const soItemsData = orderItems(so);
                  const productNames = Array.from(new Set(
                    soItemsData.map(resolveCatalogName).filter(Boolean),
                  ));
                  return (
                    <tr key={`tos-${so.id}`} className="border-b border-[#141414] hover:bg-[#0f0f0f] transition-colors">
                      <td className="px-3 py-1.5 whitespace-nowrap text-slate-400 font-mono tabular-nums">{formatDate(so.orderDate)}</td>
                      <td className="px-3 py-1.5">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-sm bg-amber-500/10 text-amber-300 border border-amber-500/20">
                          <ClipboardList size={9} /> To Ship
                        </span>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[11px] text-slate-300">{so.orderNumber || so.id}</td>
                      <td className="px-3 py-1.5 text-[11px] text-slate-500">{so.status || '—'}</td>
                      <td className="px-3 py-1.5 text-slate-300 max-w-[220px]" title={productNames.join(', ')}>
                        <div className="line-clamp-2 leading-tight">{joinProductNames(productNames.map(productName => ({ productName })))}</div>
                      </td>
                      <td className="px-3 py-1.5 text-[11px] text-slate-400 whitespace-nowrap">{formatPod(so.pod)}</td>
                      {(() => {
                        const { eta, source } = etaForSalesOrder(so);
                        return (
                          <td className="px-3 py-1.5 whitespace-nowrap text-[11px] font-mono tabular-nums text-slate-400"
                            title={
                              source === 'booking' ? `From booking ${so.bookingNumber}`
                              : source === 'estimated' ? `Estimated from POD + order date`
                              : 'Not enough info to compute'
                            }>
                            {eta ? formatDate(eta) : '—'}
                            {source === 'estimated' && eta && (
                              <span className="ml-1 text-[9px] text-amber-400 align-top">est</span>
                            )}
                          </td>
                        );
                      })()}
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{formatQty(pendingQty, 'LBS')}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{formatQty(pendingQty, 'KGS')}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-amber-300">{formatCurrency(pendingAmount, so.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-[#0f0f0f] border-t border-[#1f1f1f]">
                <tr className="text-[11px] uppercase tracking-wider text-slate-400">
                  <td colSpan={7} className="px-3 py-2 text-right font-medium">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-100">{formatQty(toShipTotals.qty, 'LBS')}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-100">{formatQty(toShipTotals.qty, 'KGS')}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-amber-300">{formatCurrency(toShipTotals.amount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      {/* Per-Product Summary — ordered vs shipped, aggregated by product */}
      {generated && selectedCustomer && productSummary.length > 0 && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Per-Product Summary</CardTitle>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Ordered vs invoiced quantities and amounts, aggregated by product.
              </div>
            </div>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-[#0f0f0f] border-b border-[#1f1f1f]">
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 font-medium text-right">Ordered ({unitLabel(unit)})</th>
                  <th className="px-3 py-2 font-medium text-right">Ordered $</th>
                  <th className="px-3 py-2 font-medium text-right">Shipped ({unitLabel(unit)})</th>
                  <th className="px-3 py-2 font-medium text-right">Shipped $</th>
                  <th className="px-3 py-2 font-medium text-right">Pending ({unitLabel(unit)})</th>
                  <th className="px-3 py-2 font-medium text-right">Pending $</th>
                </tr>
              </thead>
              <tbody>
                {productSummary.map(row => {
                  const pendLbs    = row.orderedLbs    - row.shippedLbs;
                  const pendAmount = row.orderedAmount - row.shippedAmount;
                  return (
                    <tr key={row.productName} className="border-b border-[#141414] hover:bg-[#0f0f0f] transition-colors">
                      <td className="px-3 py-1.5 text-slate-200 truncate max-w-[280px]" title={row.productName}>
                        {row.productName}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{formatQty(row.orderedLbs, unit)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-100">{formatCurrency(row.orderedAmount)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-300">{formatQty(row.shippedLbs, unit)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-emerald-300">{formatCurrency(row.shippedAmount)}</td>
                      <td className={cn('px-3 py-1.5 text-right tabular-nums', pendLbs > 0 ? 'text-amber-300' : 'text-slate-500')}>
                        {formatQty(Math.max(pendLbs, 0), unit)}
                      </td>
                      <td className={cn('px-3 py-1.5 text-right tabular-nums font-medium', pendAmount > 0 ? 'text-amber-300' : 'text-slate-500')}>
                        {formatCurrency(Math.max(pendAmount, 0))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-[#0f0f0f] border-t-2 border-[#1f1f1f]">
                <tr className="text-[11.5px]">
                  <td className="px-3 py-2 font-semibold text-slate-300">TOTALS</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-100">
                    {formatQty(productSummary.reduce((s, r) => s + r.orderedLbs, 0), unit)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-100">
                    {formatCurrency(productSummary.reduce((s, r) => s + r.orderedAmount, 0))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-100">
                    {formatQty(productSummary.reduce((s, r) => s + r.shippedLbs, 0), unit)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-300">
                    {formatCurrency(productSummary.reduce((s, r) => s + r.shippedAmount, 0))}
                  </td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2" />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      {/* Pre-generate guidance */}
      {!generated && (
        <Card>
          <EmptyState
            title="Pick a customer and range"
            description="Select a customer and date range above, then press Generate Balance. Orders and shipped invoices will be merged into a running balance."
          />
        </Card>
      )}
    </div>
  );
};

const FilterLabel: React.FC<{ icon: React.ReactNode; text: string }> = ({ icon, text }) => (
  <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium flex items-center gap-1">
    {icon} {text}
  </label>
);

export default TradingFollowUpV2;
