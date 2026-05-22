// Logistics Follow Up — operational view of every commercial invoice
// stitched together with its packing list (for the BL number) and
// booking (for ETD/ETA). One row per invoice. Filters + sort + totals
// come for free from the v2 DataTable; PDF/XLSX export mirrors the
// shape so the user can hand it off to the cargo agent or import it
// into a spreadsheet.

import React, { useCallback, useMemo, useState } from 'react';
import { Truck, Download, RefreshCw } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '../primitives';
import { DataTable, DataTableColumn } from '../primitives/DataTable';
import { useInvoices, Invoice } from '../queries/useInvoices';
import { useBookings } from '../queries/useBookings';
import { usePackingLists } from '../queries/usePackingLists';
import { useCompany } from '../providers/CompanyProvider';
import { Card, CardHeader, CardTitle } from '../primitives/Card';
import { formatDate as fmtDate } from '../lib/formatDate';
import { shortName, tooltipName } from '../lib/formatName';
import { useSupabaseQuery } from '../queries/useSupabaseQuery';
import { getSupabaseClient } from '../../services/supabase';
import { invokeEdgeFunction } from '../../services/edgeAuth';

interface RefreshSummary {
  scanned: number;
  trackable: number;
  registered: number;
  updated: number;
  unchanged: number;
  noProviderHit: number;
  noTrackingKey: number;
  alreadyArrived: number;
  errors: number;
}

interface RefreshErrorDetail {
  bookingNumber: string;
  key: string;
  keyType: 'container' | 'bl' | 'booking';
  stage: 'tracker' | 'booking-read' | 'booking-update';
  message: string;
}

/** Which key the ShipsGo / Maersk refresh function would use for this
 *  invoice. Mirrors the Edge Function's `pickTrackingKey` priority:
 *  first container → BL → bookingNumber. Surfaced per-row so failures
 *  ("we picked a non-trackable key") are visible without digging into
 *  the summary toast. */
type TrackSourceType = 'container' | 'bl' | 'booking' | 'none';
interface TrackSource {
  type: TrackSourceType;
  key: string | null;
  /** When ShipsGo last successfully read tracking data for this key.
   *  Null when the cache has no entry (key never registered, or the
   *  active provider doesn't use the ShipsGo cache). */
  lastSeenAt: string | null;
}

interface LogisticsRow {
  id: string;
  invoiceDate: string | null;
  invoiceNumber: string;
  customer: string | null;
  bookingNumber: string | null;
  blNumber: string | null;
  containers: string[];
  trackSource: TrackSource;
  etd: string | null;
  eta: string | null;
}

/** Pull just the container numbers out of an invoice's stored containers
 *  blob. Tolerant of both JSON-string and array shapes (legacy rows). */
function parseContainerNumbers(raw: unknown): string[] {
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try { arr = JSON.parse(s); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of arr) {
    const c = String((r as { container?: unknown })?.container ?? '').trim();
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

const LogisticsFollowUpV2: React.FC = () => {
  const { currentCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const invoices = useInvoices();
  const bookings = useBookings();
  const packingLists = usePackingLists();
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [refreshErr, setRefreshErr] = useState<string | null>(null);
  const [refreshErrorDetails, setRefreshErrorDetails] = useState<RefreshErrorDetail[]>([]);

  // Booking lookup: bookingNumber → { etd, eta }
  const bookingByNumber = useMemo(() => {
    const m = new Map<string, { etd: string | null; eta: string | null }>();
    for (const b of bookings.data ?? []) {
      const key = (b.bookingNumber ?? '').trim();
      if (!key) continue;
      m.set(key, { etd: b.etd ?? null, eta: b.eta ?? null });
    }
    return m;
  }, [bookings.data]);

  // Packing-list lookup: plNumber → blNumber. The BL number is the
  // canonical "container left port" anchor used by the cargo agent;
  // it's stored on the packing list row, not the invoice.
  const blByPlNumber = useMemo(() => {
    const m = new Map<string, string>();
    for (const pl of packingLists.data ?? []) {
      const key = (pl.plNumber ?? '').trim();
      const bl  = (pl.blNumber ?? '').trim();
      if (key && bl) m.set(key, bl);
    }
    return m;
  }, [packingLists.data]);

  // ShipsGo cache lookup: containerNumber → last_seen_at. Used to
  // populate the "Last refresh" cell per row so the user can tell at
  // a glance which invoices ever made it past the registration step.
  const shipsgoCache = useSupabaseQuery<Array<{ container_number: string; last_seen_at: string | null }>>(
    ['shipsgoTrackingRefs'],
    async () => {
      const { data, error } = await getSupabaseClient()
        .from('shipsgo_tracking_refs')
        .select('container_number, last_seen_at')
        .limit(5000);
      // Older deployments may not have the read policy yet — surface
      // an empty cache instead of bricking the page on a 401/403.
      if (error) {
        console.warn('[LogisticsFollowUp] tracking_refs read failed:', error.message);
        return [];
      }
      return (data as any) ?? [];
    },
  );
  const lastSeenByContainer = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const r of shipsgoCache.data ?? []) {
      m.set((r.container_number ?? '').toUpperCase(), r.last_seen_at);
    }
    return m;
  }, [shipsgoCache.data]);

  // Flatten invoices into the row shape this view cares about. We sort
  // newest-first by invoice date so the most recent shipments sit at
  // the top — the operations team reads top-down.
  //
  // BL resolution order:
  //   1. `invoices.bl` — the canonical column. Populated by the OCR
  //      step that fires when the user uploads the BOL via the
  //      Delivery Docs modal.
  //   2. `packing_lists.blNumber` — legacy fallback for rows where the
  //      BL is only stored on the linked PL.
  //   3. Filter out placeholder cases where the resolved BL equals
  //      the booking number (older PL rows seed blNumber from the
  //      booking).
  const rows = useMemo<LogisticsRow[]>(() => {
    const out: LogisticsRow[] = (invoices.data ?? []).map(inv => {
      const plKey = (inv.plNumber ?? '').trim();
      const bkKey = (inv.bookingNumber ?? '').trim();
      const bk = bkKey ? bookingByNumber.get(bkKey) : null;
      const fromInvoice = ((inv as { bl?: string | null }).bl ?? '').trim();
      const fromPl = plKey ? (blByPlNumber.get(plKey) ?? '').trim() : '';
      const candidate = fromInvoice || fromPl;
      const blNumber = candidate && (!bkKey || candidate !== bkKey) ? candidate : null;
      const containers = parseContainerNumbers((inv as { containers?: unknown }).containers);
      // Mirror the Edge Function's pickTrackingKey priority. ShipsGo
      // cache lookup keys on uppercase container numbers, so we
      // normalise the same way before reading lastSeenByContainer.
      let trackSource: TrackSource;
      if (containers.length > 0) {
        const key = containers[0].toUpperCase();
        trackSource = { type: 'container', key, lastSeenAt: lastSeenByContainer.get(key) ?? null };
      } else if (blNumber) {
        trackSource = { type: 'bl', key: blNumber, lastSeenAt: null };
      } else if (bkKey) {
        trackSource = { type: 'booking', key: bkKey, lastSeenAt: null };
      } else {
        trackSource = { type: 'none', key: null, lastSeenAt: null };
      }
      return {
        id: inv.id,
        invoiceDate: inv.invoiceDate,
        invoiceNumber: inv.invoiceNumber,
        customer: inv.soldTo ?? inv.billToName,
        bookingNumber: bkKey || null,
        blNumber,
        containers,
        trackSource,
        etd: bk?.etd ?? null,
        eta: bk?.eta ?? null,
      };
    });
    out.sort((a, b) => (b.invoiceDate ?? '').localeCompare(a.invoiceDate ?? ''));
    return out;
  }, [invoices.data, bookingByNumber, blByPlNumber, lastSeenByContainer]);

  // Page-level search across the visible cell text. Each column
  // already has a per-column funnel filter (provided by DataTable);
  // this top-bar input is the quick "find me anything" hatch.
  const filtered = useMemo<LogisticsRow[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      (r.invoiceNumber ?? '').toLowerCase().includes(q)
      || (r.customer ?? '').toLowerCase().includes(q)
      || (r.bookingNumber ?? '').toLowerCase().includes(q)
      || (r.blNumber ?? '').toLowerCase().includes(q)
      || r.containers.some(c => c.toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const columns: DataTableColumn<LogisticsRow>[] = [
    {
      id: 'invoiceDate', header: 'Date', sortable: true, mono: true,
      value: r => r.invoiceDate ?? '',
      cell: r => (
        <span className="text-slate-400 font-mono tabular-nums text-[11.5px]">
          {fmtDate(r.invoiceDate)}
        </span>
      ),
    },
    {
      id: 'invoiceNumber', header: 'Invoice', sortable: true, filterable: true, mono: true,
      value: r => r.invoiceNumber,
      cell: r => <span className="text-slate-100">{r.invoiceNumber}</span>,
    },
    {
      id: 'customer', header: 'Customer', sortable: true, filterable: true,
      value: r => r.customer ?? '',
      cell: r => (
        <span className="text-slate-200" title={tooltipName(r.customer)}>
          {shortName(r.customer)}
        </span>
      ),
    },
    {
      id: 'bookingNumber', header: 'Booking', sortable: true, filterable: true, mono: true,
      value: r => r.bookingNumber ?? '',
      cell: r => r.bookingNumber
        ? <span className="text-slate-300 font-mono text-[11.5px]">{r.bookingNumber}</span>
        : <span className="text-slate-600">—</span>,
    },
    {
      id: 'blNumber', header: 'B/L', sortable: true, filterable: true, mono: true,
      value: r => r.blNumber ?? '',
      cell: r => r.blNumber
        ? <span className="text-slate-300 font-mono text-[11.5px]">{r.blNumber}</span>
        : <span className="text-slate-600">—</span>,
    },
    {
      id: 'containers', header: 'Containers', sortable: true, filterable: true, mono: true,
      value: r => r.containers.join(', '),
      cell: r => r.containers.length === 0
        ? <span className="text-slate-600">—</span>
        : (
          <span
            className="text-slate-300 font-mono text-[11.5px] inline-flex items-center gap-1"
            title={r.containers.join('\n')}
          >
            <span>{r.containers[0]}</span>
            {r.containers.length > 1 && (
              <span className="px-1 py-0.5 rounded text-[10px] text-slate-500 bg-[#161616] border border-[#1f1f1f]">
                +{r.containers.length - 1}
              </span>
            )}
          </span>
        ),
    },
    {
      id: 'etd', header: 'ETD', sortable: true, mono: true, align: 'right',
      value: r => r.etd ?? '',
      cell: r => r.etd
        ? <span className="text-slate-400 font-mono tabular-nums text-[11.5px]">{fmtDate(r.etd)}</span>
        : <span className="text-slate-600">—</span>,
    },
    {
      id: 'eta', header: 'ETA', sortable: true, mono: true, align: 'right',
      value: r => r.eta ?? '',
      cell: r => r.eta
        ? <span className="text-slate-400 font-mono tabular-nums text-[11.5px]">{fmtDate(r.eta)}</span>
        : <span className="text-slate-600">—</span>,
    },
    {
      id: 'trackSource', header: 'Tracked by', sortable: true, filterable: true,
      value: r => r.trackSource.type,
      cell: r => {
        const t = r.trackSource;
        if (t.type === 'none') {
          return <span className="text-rose-400 text-[10.5px] uppercase tracking-wider" title="No container, B/L, or booking on this invoice — ETA refresh can't run.">no key</span>;
        }
        const tone =
          t.type === 'container' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
          : t.type === 'bl'      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
          :                        'bg-slate-500/15 text-slate-300 border-slate-500/30';
        const tip =
          t.type === 'container'
            ? `ShipsGo registers and polls this container. Best chance of success.`
            : t.type === 'bl'
              ? `No container on invoice — falling back to BL. Carrier coverage varies.`
              : `No container or BL — falling back to booking number. Lowest success rate.`;
        return (
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] border ${tone}`} title={tip}>
            <span className="uppercase tracking-wider">{t.type}</span>
            <span className="font-mono tabular-nums text-slate-200">{t.key}</span>
          </span>
        );
      },
    },
    {
      id: 'lastRefresh', header: 'Last refresh', sortable: true, mono: true, align: 'right',
      value: r => r.trackSource.lastSeenAt ?? '',
      cell: r => {
        const ts = r.trackSource.lastSeenAt;
        if (!ts) {
          if (r.trackSource.type === 'container') {
            return <span className="text-slate-600 text-[10.5px] uppercase tracking-wider" title="ShipsGo has never polled this container. It may not be registered yet, or the function hasn't run.">never</span>;
          }
          return <span className="text-slate-700">—</span>;
        }
        const ageDays = Math.round((Date.now() - new Date(ts).getTime()) / 86400000);
        const tone =
          ageDays <= 1 ? 'text-emerald-300'
          : ageDays <= 7 ? 'text-slate-300'
          : 'text-amber-300';
        const label = ageDays === 0 ? 'today' : ageDays === 1 ? '1d ago' : `${ageDays}d ago`;
        return (
          <span className={`font-mono tabular-nums text-[11.5px] ${tone}`} title={new Date(ts).toLocaleString()}>
            {label}
          </span>
        );
      },
    },
  ];

  // ─── Export helpers ────────────────────────────────────────────
  const exportFilename = useCallback((ext: 'pdf' | 'xlsx') => {
    const today = new Date().toISOString().slice(0, 10);
    return `LogisticsFollowUp_${currentCompanyId || 'ALL'}_${today}.${ext}`;
  }, [currentCompanyId]);

  const buildExportRows = useCallback(() => {
    const header = ['Date', 'Invoice', 'Customer', 'Booking', 'B/L', 'Containers', 'ETD', 'ETA', 'Tracked by', 'Last refresh'];
    const body = filtered.map(r => [
      fmtDate(r.invoiceDate) || '',
      r.invoiceNumber || '',
      r.customer || '',
      r.bookingNumber || '—',
      r.blNumber || '—',
      r.containers.length > 0 ? r.containers.join(', ') : '—',
      r.etd ? fmtDate(r.etd) : '—',
      r.eta ? fmtDate(r.eta) : '—',
      r.trackSource.type === 'none' ? '— no key —'
        : `${r.trackSource.type}:${r.trackSource.key}`,
      r.trackSource.lastSeenAt || (r.trackSource.type === 'container' ? 'never' : '—'),
    ]);
    return { header, body };
  }, [filtered]);

  const downloadPdf = useCallback(() => {
    const { header, body } = buildExportRows();
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Logistics Follow Up', 14, 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(
      `Company: ${currentCompanyId || 'ALL'} · ${filtered.length} invoices · Exported ${new Date().toLocaleString()}`,
      14, 21,
    );
    doc.setTextColor(0);
    autoTable(doc, {
      head: [header],
      body: body.length > 0 ? body : [['—', '—', '—', '—', '—', '—', '—']],
      startY: 26,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [180, 83, 9], textColor: 255 },
      columnStyles: { 5: { halign: 'right' }, 6: { halign: 'right' } },
    });
    doc.save(exportFilename('pdf'));
  }, [buildExportRows, currentCompanyId, filtered.length, exportFilename]);

  const downloadXlsx = useCallback(() => {
    const { header, body } = buildExportRows();
    const aoa = [
      ['Logistics Follow Up'],
      [`Company: ${currentCompanyId || 'ALL'} · ${filtered.length} invoices`],
      [],
      header,
      ...body,
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 12 }, { wch: 14 }, { wch: 40 }, { wch: 16 },
      { wch: 16 }, { wch: 12 }, { wch: 12 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'LogisticsFollowUp');
    XLSX.writeFile(wb, exportFilename('xlsx'));
  }, [buildExportRows, currentCompanyId, filtered.length, exportFilename]);

  // Live API refresh — hits the `update-shipment-eta` Edge Function,
  // which iterates in-transit invoices, asks ShipsGo for current ETD/
  // ETA, and writes changes back to the linked `bookings` rows. We then
  // invalidate the bookings cache so the table re-renders with the
  // freshest dates. The same function also runs from pg_cron each
  // morning; this button is for "I need it now" moments.
  const refreshLive = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshMsg(null);
    setRefreshErr(null);
    setRefreshErrorDetails([]);
    try {
      const res = await invokeEdgeFunction('update-shipment-eta', {});
      const s = (res?.summary ?? {}) as Partial<RefreshSummary>;
      const parts: string[] = [];
      if (typeof s.scanned === 'number') parts.push(`${s.scanned} scanned`);
      if (typeof s.trackable === 'number') parts.push(`${s.trackable} trackable`);
      if (typeof s.updated === 'number') parts.push(`${s.updated} updated`);
      if (typeof s.unchanged === 'number') parts.push(`${s.unchanged} unchanged`);
      if (typeof s.registered === 'number' && s.registered > 0) parts.push(`${s.registered} newly registered`);
      if (typeof s.alreadyArrived === 'number' && s.alreadyArrived > 0) parts.push(`${s.alreadyArrived} already arrived (skipped)`);
      if (typeof s.noProviderHit === 'number' && s.noProviderHit > 0) parts.push(`${s.noProviderHit} no provider data`);
      if (typeof s.noTrackingKey === 'number' && s.noTrackingKey > 0) parts.push(`${s.noTrackingKey} no container/BL`);
      if (typeof s.errors === 'number' && s.errors > 0) parts.push(`${s.errors} errors`);
      setRefreshMsg(parts.length ? parts.join(' · ') : 'Done.');
      const details = Array.isArray(res?.errorDetails) ? res.errorDetails as RefreshErrorDetail[] : [];
      setRefreshErrorDetails(details);
      // Refresh both bookings (for ETD/ETA) and the shipsgo cache view.
      await queryClient.invalidateQueries({ queryKey: ['bookings'] });
    } catch (e) {
      setRefreshErr((e as Error)?.message || 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, queryClient]);

  const loading = invoices.isLoading || bookings.isLoading || packingLists.isLoading;
  const error = invoices.error || bookings.error || packingLists.error;

  return (
    <div className="max-w-[1400px] space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <Truck size={18} className="text-amber-300" />
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">
            Logistics Follow Up
          </h1>
          <Badge variant="info">Live</Badge>
        </div>
        <p className="text-[13px] text-slate-500 mt-1">
          Per-invoice shipment view — stitches booking ETD/ETA and the
          linked B/L number alongside the customer + invoice date.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Invoices</CardTitle>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {loading
                ? 'Loading…'
                : `${filtered.length} of ${rows.length} invoices${search ? ` · "${search}"` : ''}`}
              {refreshMsg && (
                <span className="ml-2 text-indigo-300">· {refreshMsg}</span>
              )}
              {refreshErr && (
                <span className="ml-2 text-rose-300">· {refreshErr}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Invoice #, customer, booking, B/L…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 px-2 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] rounded text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 w-[280px]"
            />
            <button
              type="button"
              onClick={refreshLive}
              disabled={refreshing}
              title="Pull live ETD/ETA from container tracking provider (ShipsGo)"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-medium bg-indigo-500/10 border border-indigo-500/30 text-indigo-200 hover:text-indigo-100 hover:border-indigo-400/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Refreshing…' : 'Refresh ETAs'}
            </button>
            <button
              type="button"
              onClick={downloadPdf}
              disabled={filtered.length === 0}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-medium bg-[#141414] border border-[#1f1f1f] text-slate-300 hover:text-slate-100 hover:border-[#2a2a2a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Download size={11} /> PDF
            </button>
            <button
              type="button"
              onClick={downloadXlsx}
              disabled={filtered.length === 0}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-medium bg-[#141414] border border-[#1f1f1f] text-slate-300 hover:text-slate-100 hover:border-[#2a2a2a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Download size={11} /> XLSX
            </button>
          </div>
        </CardHeader>
        {error ? (
          <div className="px-4 py-6 text-center text-[12.5px] text-rose-300">
            Couldn't load logistics view — {(error as Error).message}
          </div>
        ) : (
          <DataTable<LogisticsRow>
            columns={columns}
            rows={filtered}
            getRowId={r => r.id}
            emptyMessage={loading ? 'Loading…' : 'No invoices in range.'}
            zebra
          />
        )}
      </Card>

      {refreshErrorDetails.length > 0 && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Refresh errors</CardTitle>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {refreshErrorDetails.length} booking{refreshErrorDetails.length === 1 ? '' : 's'} failed during the last refresh
              </div>
            </div>
          </CardHeader>
          <div className="px-4 pb-3 text-[12px]">
            <table className="w-full">
              <thead>
                <tr className="text-left text-slate-500 border-b border-[#1f1f1f]">
                  <th className="py-1.5 pr-3 font-medium">Booking</th>
                  <th className="py-1.5 pr-3 font-medium">Key</th>
                  <th className="py-1.5 pr-3 font-medium">Type</th>
                  <th className="py-1.5 pr-3 font-medium">Stage</th>
                  <th className="py-1.5 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {refreshErrorDetails.map((d, i) => (
                  <tr key={i} className="border-b border-[#161616]">
                    <td className="py-1.5 pr-3 font-mono text-slate-300">{d.bookingNumber}</td>
                    <td className="py-1.5 pr-3 font-mono text-slate-300">{d.key}</td>
                    <td className="py-1.5 pr-3 text-slate-400">{d.keyType}</td>
                    <td className="py-1.5 pr-3 text-amber-300">{d.stage}</td>
                    <td className="py-1.5 text-rose-300">{d.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
};

export default LogisticsFollowUpV2;
