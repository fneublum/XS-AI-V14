// Finance → Margins.
//
// Per-sales-invoice landed-cost + margin breakdown. Powered by
// useInvoiceMargins (auto-attribution by bookingNumber/soNumber with
// invoice_costings overrides). The table is sortable and filterable;
// each row opens a drawer that exposes the override fields + the
// auto-matched links so the user can correct attribution.

import React, { useMemo, useState } from 'react';
import { Filter, RefreshCw, Save, Loader2, AlertCircle, X as XIcon, Info, Sparkles, Link2, Unlink } from 'lucide-react';
import { useInvoiceMargins, upsertInvoiceCosting, type InvoiceMarginRow } from '../queries/useInvoiceMargins';
import { useToast } from '../primitives/Toast';
import { useQueryClient } from '@tanstack/react-query';
import { usePayables, type Payable } from '../queries/usePayables';
import { useFreightQuotes, type FreightQuote } from '../queries/useFreightQuotes';

function fmtMoney(n: number, c: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(n);
}
function fmtPct(p: number): string {
  if (!Number.isFinite(p)) return '—';
  return (p * 100).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
}
function fmtDate(d: string | null): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: '2-digit' }); }
  catch { return d; }
}

type SortKey = 'date' | 'invoice' | 'customer' | 'revenue' | 'landed' | 'marginUSD' | 'marginPct';

const MarginsV2: React.FC = () => {
  const margins = useInvoiceMargins();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('marginPct');
  const [sortDesc, setSortDesc] = useState(true);
  const [hideZeroRevenue, setHideZeroRevenue] = useState(true);
  const [editRow, setEditRow] = useState<InvoiceMarginRow | null>(null);

  const rows = useMemo(() => {
    if (!margins.data) return [];
    const needle = search.trim().toLowerCase();
    let r = margins.data;
    if (hideZeroRevenue) r = r.filter(x => x.revenue > 0.005);
    if (needle) {
      r = r.filter(x =>
        x.invoiceNumber.toLowerCase().includes(needle) ||
        (x.customerName ?? '').toLowerCase().includes(needle) ||
        (x.bookingNumber ?? '').toLowerCase().includes(needle) ||
        (x.soNumber ?? '').toLowerCase().includes(needle),
      );
    }
    const sorter = (a: InvoiceMarginRow, b: InvoiceMarginRow): number => {
      let av: any, bv: any;
      switch (sortKey) {
        case 'date':       av = a.invoiceDate ?? ''; bv = b.invoiceDate ?? ''; break;
        case 'invoice':    av = a.invoiceNumber;     bv = b.invoiceNumber;     break;
        case 'customer':   av = a.customerName ?? ''; bv = b.customerName ?? ''; break;
        case 'revenue':    av = a.revenue;            bv = b.revenue;            break;
        case 'landed':     av = a.landedCost;         bv = b.landedCost;         break;
        case 'marginUSD':  av = a.marginUSD;          bv = b.marginUSD;          break;
        case 'marginPct':  av = a.marginPct;          bv = b.marginPct;          break;
      }
      if (av < bv) return sortDesc ? 1 : -1;
      if (av > bv) return sortDesc ? -1 : 1;
      return 0;
    };
    return [...r].sort(sorter);
  }, [margins.data, search, sortKey, sortDesc, hideZeroRevenue]);

  const totals = useMemo(() => {
    let revenue = 0, supplier = 0, freight = 0, localF = 0, oceanF = 0, other = 0, landed = 0, margin = 0;
    for (const r of rows) {
      revenue += r.revenue;
      supplier += r.supplierCost;
      freight  += r.freightCost;
      localF   += r.localFreightCost;
      oceanF   += r.oceanFreightCost;
      other    += r.otherCost;
      landed   += r.landedCost;
      margin   += r.marginUSD;
    }
    return {
      revenue, supplier, freight, localF, oceanF, other, landed, margin,
      marginPct: revenue > 0 ? margin / revenue : 0,
    };
  }, [rows]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) { setSortDesc(d => !d); return; }
    setSortKey(k);
    // Money columns and date default desc; text columns default asc.
    setSortDesc(['date', 'revenue', 'landed', 'marginUSD', 'marginPct'].includes(k));
  }

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="bento-scope p-4 space-y-4" style={{ maxWidth: '1480px' }}>
      {/* Header */}
      <div className="flex items-end gap-4 flex-wrap pb-2">
        <div className="flex items-center gap-3">
          <span className="block w-1 h-9 rounded-full" style={{ background: 'var(--b-teal-2)' }} />
          <div>
            <h1 className="b-display font-semibold leading-none"
                style={{ color: 'var(--b-text)', fontSize: '32px', fontVariationSettings: "'opsz' 64, 'wght' 600", letterSpacing: '-0.02em' }}>
              Margins
            </h1>
            <p className="text-[13px] mt-1.5" style={{ color: 'var(--b-text-mute)' }}>
              Per-invoice landed cost + gross margin. Auto-attributes supplier cost (by SO/PO) and freight (by booking); click a row to override.
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => margins.refetch()}
            title="Refresh"
            className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 rounded-full transition-colors disabled:opacity-40"
            style={{ background: 'var(--b-surface-2)', color: 'var(--b-text-soft)', border: '1px solid var(--b-line)' }}
          >
            <RefreshCw size={12} className={margins.isLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* KPI row — Freight is now split into Local + Ocean. */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <KpiCard label="Revenue"           value={fmtMoney(totals.revenue)} />
        <KpiCard label="Supplier cost"     value={fmtMoney(totals.supplier)} />
        <KpiCard label="Local freight"     value={fmtMoney(totals.localF)} />
        <KpiCard label="Ocean freight"     value={fmtMoney(totals.oceanF)} />
        <KpiCard label="Other"             value={fmtMoney(totals.other)} />
        <KpiCard
          label="Gross margin"
          value={`${fmtMoney(totals.margin)} · ${fmtPct(totals.marginPct)}`}
          color={totals.margin >= 0 ? 'var(--b-emerald)' : 'var(--b-rose)'}
        />
      </div>

      {/* Controls */}
      <div className="rounded-[14px] border p-3 flex items-center gap-3 flex-wrap" style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)' }}>
        <div className="flex items-center gap-2 flex-1 min-w-[260px]">
          <Filter size={14} style={{ color: 'var(--b-text-mute)' }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search invoice # · customer · booking · SO"
            className="flex-1 px-2 py-1.5 rounded text-[12.5px]"
            style={{ background: 'var(--b-surface-2)', border: '1px solid var(--b-line)', color: 'var(--b-text)' }}
          />
        </div>
        <label className="flex items-center gap-1.5 text-[11.5px]" style={{ color: 'var(--b-text-mute)' }}>
          <input
            type="checkbox"
            checked={hideZeroRevenue}
            onChange={e => setHideZeroRevenue(e.target.checked)}
          />
          Hide zero-revenue rows
        </label>
        <span className="text-[11.5px]" style={{ color: 'var(--b-text-mute)' }}>
          {margins.isLoading ? 'Loading…' : `${rows.length} invoice${rows.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {/* Table */}
      {margins.error ? (
        <div className="rounded-[14px] border p-6 flex items-start gap-2 text-[13px]" style={{ background: 'var(--b-surface)', borderColor: 'var(--b-rose)', color: 'var(--b-rose)' }}>
          <AlertCircle size={16} />
          {(margins.error as Error).message}
        </div>
      ) : (
        <div className="rounded-[14px] border overflow-hidden" style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)' }}>
          <div
            className="grid items-center gap-3 px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] border-b"
            style={{
              gridTemplateColumns: '90px 100px 1fr 110px 110px 100px 100px 90px 120px 100px',
              borderColor: 'var(--b-line-soft)',
              color: 'var(--b-text-mute)',
            }}
          >
            <Th label="Date"       onClick={() => toggleSort('date')}      active={sortKey === 'date'}      desc={sortDesc} />
            <Th label="Invoice"    onClick={() => toggleSort('invoice')}   active={sortKey === 'invoice'}   desc={sortDesc} />
            <Th label="Customer"   onClick={() => toggleSort('customer')}  active={sortKey === 'customer'}  desc={sortDesc} />
            <Th label="Revenue"    onClick={() => toggleSort('revenue')}   active={sortKey === 'revenue'}   desc={sortDesc} align="right" />
            <Th label="Supplier"   align="right" />
            <Th label="Local frt"  align="right" />
            <Th label="Ocean frt"  align="right" />
            <Th label="Other"      align="right" />
            <Th label="Margin $"   onClick={() => toggleSort('marginUSD')} active={sortKey === 'marginUSD'} desc={sortDesc} align="right" />
            <Th label="Margin %"   onClick={() => toggleSort('marginPct')} active={sortKey === 'marginPct'} desc={sortDesc} align="right" />
          </div>
          {margins.isLoading && !margins.data ? (
            <div className="p-6 text-center text-[12.5px]" style={{ color: 'var(--b-text-mute)' }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-[12.5px]" style={{ color: 'var(--b-text-mute)' }}>No invoices in scope.</div>
          ) : rows.map(r => (
            <div
              key={r.invoiceId}
              role="button"
              onClick={() => setEditRow(r)}
              title="Click to override the auto-attributed cost"
              className="grid items-center gap-3 px-4 py-2 text-[12.5px] border-b cursor-pointer hover:bg-[#0f0f0f]"
              style={{
                gridTemplateColumns: '90px 100px 1fr 110px 110px 100px 100px 90px 120px 100px',
                borderColor: 'var(--b-line-soft)',
                color: 'var(--b-text)',
              }}
            >
              <span className="b-mono text-[11.5px]" style={{ color: 'var(--b-text-mute)' }}>{fmtDate(r.invoiceDate)}</span>
              <span className="b-mono font-medium">{r.invoiceNumber}</span>
              <span className="truncate" title={r.customerName ?? ''}>
                {r.customerName ?? <span style={{ color: 'var(--b-text-faint)' }}>—</span>}
                {r.hasOverrides && <span className="ml-1.5 text-[10px] text-amber-400" title="Has manual overrides">●</span>}
              </span>
              <span className="text-right b-mono tabular-nums">{fmtMoney(r.revenue, r.currency)}</span>
              <span
                className="text-right b-mono tabular-nums"
                title={r.supplierCost > 0
                  ? `Source: ${r.supplierCostSource}`
                  : (r.supplierCostReason || 'no supplier cost matched')}
              >
                {r.supplierCost > 0
                  ? fmtMoney(r.supplierCost, r.currency)
                  : <span style={{ color: 'var(--b-text-faint)' }} className="cursor-help">— ⓘ</span>}
              </span>
              <span
                className="text-right b-mono tabular-nums"
                title={r.localFreightCost > 0
                  ? `Source: ${r.freightCostSource === 'override' ? 'override (combined, bucketed to ocean)' : r.freightCostSource}`
                  : (r.freightCostReason || 'no freight cost matched')}
              >
                {r.localFreightCost > 0
                  ? fmtMoney(r.localFreightCost, r.currency)
                  : <span style={{ color: 'var(--b-text-faint)' }} className="cursor-help">— ⓘ</span>}
              </span>
              <span
                className="text-right b-mono tabular-nums"
                title={r.oceanFreightCost > 0
                  ? `Source: ${r.freightCostSource}`
                  : (r.freightCostReason || 'no freight cost matched')}
              >
                {r.oceanFreightCost > 0
                  ? fmtMoney(r.oceanFreightCost, r.currency)
                  : <span style={{ color: 'var(--b-text-faint)' }} className="cursor-help">— ⓘ</span>}
              </span>
              <span className="text-right b-mono tabular-nums">
                {r.otherCost > 0 ? fmtMoney(r.otherCost, r.currency) : <span style={{ color: 'var(--b-text-faint)' }}>—</span>}
              </span>
              <span className="text-right b-mono tabular-nums font-semibold"
                style={{ color: r.marginUSD >= 0 ? 'var(--b-emerald)' : 'var(--b-rose)' }}>
                {fmtMoney(r.marginUSD, r.currency)}
              </span>
              <span className="text-right b-mono tabular-nums font-semibold"
                style={{ color: r.marginPct >= 0.1 ? 'var(--b-emerald)' : r.marginPct >= 0 ? 'var(--b-gold)' : 'var(--b-rose)' }}>
                {fmtPct(r.marginPct)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Edit drawer */}
      {editRow && (
        <MarginEditModal
          row={editRow}
          onClose={() => setEditRow(null)}
          onSaved={() => { setEditRow(null); margins.refetch(); }}
        />
      )}
    </div>
  );
};

const KpiCard: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <div className="rounded-[14px] border p-3" style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)' }}>
    <div className="text-[10.5px] uppercase tracking-[0.14em] mb-1.5" style={{ color: 'var(--b-text-mute)' }}>{label}</div>
    <div className="b-display font-semibold tabular-nums" style={{ color: color ?? 'var(--b-text)', fontSize: '20px', letterSpacing: '-0.02em' }}>{value}</div>
  </div>
);

interface ThProps { label: string; onClick?: () => void; active?: boolean; desc?: boolean; align?: 'left' | 'right' }
const Th: React.FC<ThProps> = ({ label, onClick, active, desc, align = 'left' }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={!onClick}
    className={`${align === 'right' ? 'text-right' : 'text-left'} ${onClick ? 'hover:text-slate-200' : ''}`}
    style={{ color: active ? 'var(--b-teal-2)' : undefined }}
  >
    {label}{active ? (desc ? ' ↓' : ' ↑') : ''}
  </button>
);

// ── Override drawer ────────────────────────────────────────────────
interface EditProps {
  row: InvoiceMarginRow;
  onClose: () => void;
  onSaved: () => void;
}

const MarginEditModal: React.FC<EditProps> = ({ row, onClose, onSaved }) => {
  const toast = useToast();
  const qc = useQueryClient();
  // Drafts seeded from the row's computed values so the user sees
  // the auto-attributed numbers and can choose to override.
  const [supOverride, setSupOverride] = useState<string>('');
  const [frOverride,  setFrOverride]  = useState<string>('');
  const [duty,        setDuty]        = useState<string>('0');
  const [broker,      setBroker]      = useState<string>('0');
  const [insurance,   setInsurance]   = useState<string>('0');
  const [bankFees,    setBankFees]    = useState<string>('0');
  const [other,       setOther]       = useState<string>('0');
  const [notes,       setNotes]       = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [supLinks, setSupLinks] = useState<string>(row.supplierCostLinkIds.join(','));
  const [frLinks,  setFrLinks]  = useState<string>(row.freightCostLinkIds.join(','));

  // Hydrate from the existing costing row if any. We re-fetch here so
  // the drawer sees the latest values even if the table data is stale.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const sb = (await import('../../services/supabase')).getSupabaseClient();
      const { data } = await sb.from('invoice_costings').select('*').eq('invoiceId', row.invoiceId).maybeSingle();
      if (cancelled || !data) return;
      const c: any = data;
      if (c.supplierCostOverride != null) setSupOverride(String(c.supplierCostOverride));
      if (c.freightCostOverride  != null) setFrOverride(String(c.freightCostOverride));
      setDuty(String(c.dutyUSD ?? '0'));
      setBroker(String(c.brokerageUSD ?? '0'));
      setInsurance(String(c.insuranceUSD ?? '0'));
      setBankFees(String(c.bankFeesUSD ?? '0'));
      setOther(String(c.otherUSD ?? '0'));
      setNotes(c.notes ?? '');
      if (c.supplierInvoiceIds) setSupLinks(c.supplierInvoiceIds);
      if (c.freightQuoteIds)    setFrLinks(c.freightQuoteIds);
    })();
    return () => { cancelled = true; };
  }, [row.invoiceId]);

  // Live preview of the new margin if the user saves.
  const numOrNull = (s: string): number | null => {
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const num = (s: string): number => Number(s) || 0;

  const effSupplier = numOrNull(supOverride) ?? row.supplierCost;
  const effFreight  = numOrNull(frOverride)  ?? row.freightCost;
  const effOther    = num(duty) + num(broker) + num(insurance) + num(bankFees) + num(other);
  const effLanded   = effSupplier + effFreight + effOther;
  const effMargin   = row.revenue - effLanded;
  const effMarginPct = row.revenue > 0 ? effMargin / row.revenue : 0;

  async function save() {
    setSaving(true);
    try {
      await upsertInvoiceCosting({
        invoiceId: row.invoiceId,
        companyId: null,
        supplierCostOverride: numOrNull(supOverride),
        freightCostOverride:  numOrNull(frOverride),
        dutyUSD: num(duty),
        brokerageUSD: num(broker),
        insuranceUSD: num(insurance),
        bankFeesUSD: num(bankFees),
        otherUSD: num(other),
        notes: notes.trim() || null,
        supplierInvoiceIds: supLinks.trim() || null,
        freightQuoteIds:    frLinks.trim() || null,
      });
      toast.push({ kind: 'success', title: 'Costing saved' });
      qc.invalidateQueries({ queryKey: ['margins_costings'] });
      onSaved();
    } catch (e: any) {
      toast.push({ kind: 'error', title: 'Save failed', description: e?.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="bg-[#0a0a0a] border border-[#1f1f1f] rounded-lg shadow-2xl flex flex-col w-full" style={{ maxWidth: '760px', maxHeight: '90vh' }}>
        <div className="px-5 py-3 border-b border-[#1f1f1f] flex items-center justify-between">
          <div>
            <div className="text-[13px] font-semibold text-slate-100">Costing · {row.invoiceNumber}</div>
            <div className="text-[11.5px] text-slate-500">{row.customerName ?? '—'} · Revenue {fmtMoney(row.revenue, row.currency)}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100 w-7 h-7 rounded inline-flex items-center justify-center hover:bg-slate-700/40 text-xl leading-none">×</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-4 text-[12.5px]">
          {/* Supplier override + picker */}
          <Section
            title="Supplier cost"
            hint={row.supplierCost > 0
              ? `Auto: ${fmtMoney(row.supplierCost, row.currency)} (${row.supplierCostSource})`
              : (row.supplierCostReason || 'No auto-match. Pick a supplier bill below or set an override.')}
          >
            <SupplierInvoicePicker
              value={supLinks}
              onChange={setSupLinks}
              currency={row.currency}
            />
            <FieldRow>
              <Field
                label="Override $ (skips the link above)"
                value={supOverride}
                onChange={setSupOverride}
                placeholder={`leave blank to use ${fmtMoney(row.supplierCost, row.currency)}`}
              />
            </FieldRow>
          </Section>

          {/* Freight override + picker */}
          <Section
            title="Freight cost"
            hint={row.freightCost > 0
              ? `Auto: ${fmtMoney(row.freightCost, row.currency)} (${row.freightCostSource})`
              : (row.freightCostReason || 'No auto-match. Pick a freight quote below or set an override.')}
          >
            <FreightQuotePicker
              value={frLinks}
              onChange={setFrLinks}
              currency={row.currency}
            />
            <FieldRow>
              <Field
                label="Override $ (skips the link above)"
                value={frOverride}
                onChange={setFrOverride}
                placeholder={`leave blank to use ${fmtMoney(row.freightCost, row.currency)}`}
              />
            </FieldRow>
          </Section>

          {/* Other costs */}
          <Section title="Other costs">
            <FieldRow>
              <Field label="Duty"        value={duty}      onChange={setDuty} />
              <Field label="Brokerage"   value={broker}    onChange={setBroker} />
              <Field label="Insurance"   value={insurance} onChange={setInsurance} />
            </FieldRow>
            <FieldRow>
              <Field label="Bank fees"   value={bankFees}  onChange={setBankFees} />
              <Field label="Misc"        value={other}     onChange={setOther} />
            </FieldRow>
          </Section>

          <Section title="Notes">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Optional context for the costing decisions above…"
              className="w-full px-2.5 py-1.5 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] rounded text-slate-200 focus:outline-none focus:border-teal-500"
            />
          </Section>

          {/* Live preview of the resulting margin */}
          <div className="rounded border border-[#1f1f1f] bg-[#0f0f0f] p-3">
            <div className="flex items-center justify-between text-[11.5px] text-slate-400">
              <span>Effective landed cost</span>
              <span className="font-mono tabular-nums">{fmtMoney(effLanded, row.currency)}</span>
            </div>
            <div className="flex items-center justify-between mt-1 pt-1 border-t border-[#1f1f1f]">
              <span className="text-[12.5px] font-semibold" style={{ color: effMargin >= 0 ? 'var(--b-emerald)' : 'var(--b-rose)' }}>
                New margin
              </span>
              <span className="font-mono tabular-nums font-semibold" style={{ color: effMargin >= 0 ? 'var(--b-emerald)' : 'var(--b-rose)' }}>
                {fmtMoney(effMargin, row.currency)} · {fmtPct(effMarginPct)}
              </span>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[#1f1f1f] flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-[12px] text-slate-400 hover:text-slate-100 rounded hover:bg-[#141414]">Cancel</button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-medium bg-teal-600 text-white hover:bg-teal-500 disabled:bg-[#141414] disabled:text-slate-600"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            {saving ? 'Saving…' : 'Save costing'}
          </button>
        </div>
      </div>
    </div>
  );
};

const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
  <div>
    <div className="flex items-center justify-between mb-2">
      <div className="text-[10.5px] uppercase tracking-wider text-slate-500 font-medium">{title}</div>
      {hint && <div className="text-[10.5px] text-slate-600 italic inline-flex items-center gap-1"><Info size={10} />{hint}</div>}
    </div>
    <div className="space-y-2">{children}</div>
  </div>
);

const FieldRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex gap-2 items-end flex-wrap">{children}</div>
);

const Field: React.FC<{ label: string; value: string; onChange: (v: string) => void; placeholder?: string; wide?: boolean }> = ({ label, value, onChange, placeholder, wide }) => (
  <div className={wide ? 'flex-1 min-w-[200px]' : 'flex-1 min-w-[100px]'}>
    <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">{label}</div>
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-2 py-1.5 text-[12px] bg-[#0f0f0f] border border-[#1f1f1f] rounded text-slate-200 focus:outline-none focus:border-teal-500 font-mono tabular-nums"
    />
  </div>
);

// ── Pickers ──────────────────────────────────────────────────────
//
// Both pickers convert between a CSV-of-ids (the format the
// invoice_costings table stores) and a multi-select UX. For v1 the
// "select" is a single-row picker — adding additional rows updates
// the CSV to comma-join the ids. Each row shows the picked
// document's totals + a remove button.

const SupplierInvoicePicker: React.FC<{
  value: string;                           // CSV of supplier_invoice ids
  onChange: (csv: string) => void;
  currency: string;
}> = ({ value, onChange, currency }) => {
  const payables = usePayables();
  const [search, setSearch] = useState('');
  const linkedIds = useMemo(
    () => value.split(',').map(s => s.trim()).filter(Boolean),
    [value],
  );
  const all = payables.data ?? [];
  const linked = all.filter(p => linkedIds.includes(p.id));
  // Filter the picker dropdown by search needle on invoice # or
  // supplier name. Already-linked rows are hidden from the
  // dropdown so the user can't double-add.
  const linkedSet = new Set(linkedIds);
  const available = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all
      .filter(p => !linkedSet.has(p.id))
      .filter(p => !needle
        || p.invoiceNumber.toLowerCase().includes(needle)
        || (p.supplier ?? '').toLowerCase().includes(needle));
  }, [all, linkedSet, search]);

  function addId(id: string) {
    if (linkedIds.includes(id)) return;
    onChange([...linkedIds, id].join(','));
    setSearch('');
  }
  function removeId(id: string) {
    onChange(linkedIds.filter(x => x !== id).join(','));
  }
  const totalLinked = linked.reduce((s, p) => s + p.totalAmount, 0);

  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Linked supplier bills</div>
      {/* Linked rows */}
      {linked.length === 0 ? (
        <div className="rounded border border-dashed border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2 text-[11.5px] text-slate-500 italic">
          {payables.isLoading ? 'Loading payables…' : 'No bills linked. Pick one below to attribute its total as supplier cost.'}
        </div>
      ) : (
        <div className="space-y-1">
          {linked.map(p => (
            <div key={p.id} className="flex items-center gap-2 rounded border border-[#1f1f1f] bg-[#0f0f0f] px-2.5 py-1.5">
              <Link2 size={11} className="text-emerald-400 shrink-0" />
              <span className="text-[11.5px] text-slate-200 font-mono shrink-0">{p.invoiceNumber}</span>
              <span className="text-[11.5px] text-slate-400 truncate flex-1">{p.supplier ?? '—'}</span>
              <span className="text-[11.5px] text-slate-300 font-mono tabular-nums">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: p.currency, maximumFractionDigits: 2 }).format(p.totalAmount)}
              </span>
              <button
                type="button"
                onClick={() => removeId(p.id)}
                title="Unlink"
                className="text-slate-500 hover:text-red-400"
              >
                <Unlink size={11} />
              </button>
            </div>
          ))}
          {linked.length > 1 && (
            <div className="text-[10.5px] text-slate-500 text-right font-mono tabular-nums px-2">
              Total linked: {new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(totalLinked)}
            </div>
          )}
        </div>
      )}

      {/* Search-narrowed dropdown of all available bills. The list
          is open by default (user requested: show payable invoices
          without forcing a search) — typing in the search box just
          filters the same list. */}
      <div className="rounded border border-[#1f1f1f] bg-[#0a0a0a] p-1.5">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search bill # or supplier to narrow…"
          className="w-full px-2 py-1 text-[11.5px] bg-transparent text-slate-200 placeholder:text-slate-600 focus:outline-none"
        />
        <div className="max-h-48 overflow-y-auto mt-1 border-t border-[#1f1f1f] pt-1">
          {payables.isLoading ? (
            <div className="px-2 py-1.5 text-[11px] text-slate-600 italic">Loading bills…</div>
          ) : available.length === 0 ? (
            <div className="px-2 py-1.5 text-[11px] text-slate-600 italic">
              {all.length === 0
                ? 'No supplier bills in scope yet.'
                : (search.trim() ? 'No bills match the search.' : 'All bills are already linked.')}
            </div>
          ) : available.slice(0, 25).map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => addId(p.id)}
              className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#141414] text-[11.5px]"
            >
              <span className="text-slate-200 font-mono shrink-0">{p.invoiceNumber}</span>
              <span className="text-slate-400 truncate flex-1">{p.supplier ?? '—'}</span>
              <span className="text-slate-300 font-mono tabular-nums">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: p.currency, maximumFractionDigits: 2 }).format(p.totalAmount)}
              </span>
            </button>
          ))}
          {!payables.isLoading && available.length > 25 && (
            <div className="px-2 py-1 text-[10.5px] text-slate-600 italic text-center">
              {available.length - 25} more — narrow with search.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const FreightQuotePicker: React.FC<{
  value: string;
  onChange: (csv: string) => void;
  currency: string;
}> = ({ value, onChange, currency }) => {
  const quotes = useFreightQuotes();
  const [search, setSearch] = useState('');
  const linkedIds = useMemo(
    () => value.split(',').map(s => s.trim()).filter(Boolean),
    [value],
  );
  const all = quotes.data ?? [];
  const linked = all.filter(q => linkedIds.includes(q.id));
  const linkedSet = new Set(linkedIds);
  const available = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all
      .filter(q => !linkedSet.has(q.id))
      .filter(q => !needle
        || (q.agentName ?? '').toLowerCase().includes(needle)
        || (q.carrier ?? '').toLowerCase().includes(needle)
        || (q.originPort ?? '').toLowerCase().includes(needle)
        || (q.destinationPort ?? '').toLowerCase().includes(needle));
  }, [all, linkedSet, search]);

  function addId(id: string) {
    if (linkedIds.includes(id)) return;
    onChange([...linkedIds, id].join(','));
    setSearch('');
  }
  function removeId(id: string) {
    onChange(linkedIds.filter(x => x !== id).join(','));
  }
  const totalLinked = linked.reduce((s, q) => s + (q.rate ?? 0), 0);
  const labelFor = (q: FreightQuote) =>
    `${q.agentName ?? q.carrier ?? '—'} · ${q.originPortCode ?? q.originPort ?? '—'} → ${q.destinationPortCode ?? q.destinationPort ?? '—'}`;

  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">Linked freight quotes</div>
      {linked.length === 0 ? (
        <div className="rounded border border-dashed border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2 text-[11.5px] text-slate-500 italic">
          {quotes.isLoading ? 'Loading freight quotes…' : 'No quotes linked. Pick one below to attribute its rate as freight cost.'}
        </div>
      ) : (
        <div className="space-y-1">
          {linked.map(q => (
            <div key={q.id} className="flex items-center gap-2 rounded border border-[#1f1f1f] bg-[#0f0f0f] px-2.5 py-1.5">
              <Link2 size={11} className="text-emerald-400 shrink-0" />
              <span className="text-[11.5px] text-slate-200 truncate flex-1">{labelFor(q)}</span>
              <span className="text-[11.5px] text-slate-300 font-mono tabular-nums shrink-0">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: q.currency, maximumFractionDigits: 2 }).format(q.rate ?? 0)}
              </span>
              <button
                type="button"
                onClick={() => removeId(q.id)}
                title="Unlink"
                className="text-slate-500 hover:text-red-400"
              >
                <Unlink size={11} />
              </button>
            </div>
          ))}
          {linked.length > 1 && (
            <div className="text-[10.5px] text-slate-500 text-right font-mono tabular-nums px-2">
              Total linked: {new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(totalLinked)}
            </div>
          )}
        </div>
      )}

      <div className="rounded border border-[#1f1f1f] bg-[#0a0a0a] p-1.5">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search agent / carrier / port to narrow…"
          className="w-full px-2 py-1 text-[11.5px] bg-transparent text-slate-200 placeholder:text-slate-600 focus:outline-none"
        />
        <div className="max-h-48 overflow-y-auto mt-1 border-t border-[#1f1f1f] pt-1">
          {quotes.isLoading ? (
            <div className="px-2 py-1.5 text-[11px] text-slate-600 italic">Loading freight quotes…</div>
          ) : available.length === 0 ? (
            <div className="px-2 py-1.5 text-[11px] text-slate-600 italic">
              {all.length === 0
                ? 'No freight quotes in the workspace yet.'
                : (search.trim() ? 'No quotes match the search.' : 'All quotes are already linked.')}
            </div>
          ) : available.slice(0, 25).map(q => (
              <button
                key={q.id}
                type="button"
                onClick={() => addId(q.id)}
                className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#141414] text-[11.5px]"
              >
                <span className="text-slate-200 truncate flex-1">{labelFor(q)}</span>
                <span className="text-slate-300 font-mono tabular-nums shrink-0">
                  {new Intl.NumberFormat('en-US', { style: 'currency', currency: q.currency, maximumFractionDigits: 2 }).format(q.rate ?? 0)}
                </span>
              </button>
            ))}
          {!quotes.isLoading && available.length > 25 && (
            <div className="px-2 py-1 text-[10.5px] text-slate-600 italic text-center">
              {available.length - 25} more — narrow with search.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MarginsV2;
