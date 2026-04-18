// Phase 3B — Trading Follow Up.
//
// v2 port of pages/SalesFollowUp.tsx. Mirrors the v1 logic — per-
// customer balance of sales orders vs invoices shipped across a
// date range, with running balance and unit conversion (LBS/KGS).
// QuickBooks statement, PDF export, and email draft are deferred;
// those sit behind external services and belong in a follow-up.

import React, { useCallback, useMemo, useState } from 'react';
import { Calendar, FileText, Package, RefreshCw, User } from 'lucide-react';
import {
  Card, CardHeader, CardTitle, CardBody, Badge, EmptyState, StatCard, StatGrid,
} from '../primitives';
import { cn } from '../primitives/utils';
import { useCustomers, Customer } from '../queries/useCustomers';
import { useSalesOrders, SalesOrder } from '../queries/useSalesOrders';
import { useInvoices, Invoice } from '../queries/useInvoices';
import { BASIC_PRESETS, PresetId, computeRange } from '../lib/datePresets';

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

const orderItems = (so: SalesOrder) =>
  (so.items ?? []).map(i => ({
    productName: String((i as { productName?: string }).productName ?? '').trim(),
    quantity: toNum((i as { quantity?: unknown }).quantity),
  }));

const invoiceItems = (inv: Invoice) =>
  (inv.items ?? []).map(i => ({
    productName: String((i as { productName?: string }).productName ?? '').trim(),
    quantity: toNum((i as { quantity?: unknown }).quantity),
  }));

const joinProductNames = (items: Array<{ productName: string }>): string => {
  const names = items.map(i => i.productName).filter(Boolean);
  if (names.length === 0) return '—';
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1}`;
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

const formatDate = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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

  const loading = customers.isLoading || salesOrders.isLoading || invoices.isLoading;
  const dataReady = !loading && sortedCustomers.length > 0;

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
                    <th className="px-3 py-2 font-medium text-right">Qty ({unitLabel(unit)})</th>
                    <th className="px-3 py-2 font-medium text-right">Ordered</th>
                    <th className="px-3 py-2 font-medium text-right">Shipped</th>
                    <th className="px-3 py-2 font-medium text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(entry => {
                    if (entry.kind === 'order') {
                      const so = entry.data;
                      const items = orderItems(so);
                      const qty = totalQty(items);
                      return (
                        <tr key={`so-${so.id}`} className="border-b border-[#141414] hover:bg-[#0f0f0f] transition-colors">
                          <td className="px-3 py-1.5 whitespace-nowrap text-slate-400 font-mono tabular-nums">{formatDate(so.orderDate)}</td>
                          <td className="px-3 py-1.5">
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-sm bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                              <FileText size={9} /> Sales Order
                            </span>
                          </td>
                          <td className="px-3 py-1.5 font-mono text-[11px] text-slate-300">{so.orderNumber || so.id}</td>
                          <td className="px-3 py-1.5 text-[11px] text-slate-500">{so.status || '—'}</td>
                          <td className="px-3 py-1.5 text-slate-300 truncate max-w-[220px]" title={items.map(i => i.productName).filter(Boolean).join(', ')}>
                            {joinProductNames(items)}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{formatQty(qty, unit)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-100">{formatCurrency(so.totalAmount, so.currency)}</td>
                          <td className="px-3 py-1.5 text-right text-slate-700">—</td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-medium text-slate-100">{formatCurrency(entry.runningBalance)}</td>
                        </tr>
                      );
                    }
                    const inv = entry.data;
                    const invItemsData = invoiceItems(inv);
                    const invQty = totalQty(invItemsData) || toNum(inv.grossWeight);
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
                        <td className="px-3 py-1.5 text-slate-300 truncate max-w-[220px]" title={invItemsData.map(i => i.productName).filter(Boolean).join(', ')}>
                          {joinProductNames(invItemsData)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{formatQty(invQty, unit)}</td>
                        <td className="px-3 py-1.5 text-right text-slate-700">—</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-emerald-300">{formatCurrency(inv.totalAmount, inv.currency)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium text-slate-100">{formatCurrency(entry.runningBalance)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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
