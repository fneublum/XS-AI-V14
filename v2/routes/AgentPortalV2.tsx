// Agent portal — a focused view for users with Role === 'Cargo Agent'.
// Resolves the logged-in user's linked_entity_id to a cargo_agents.name,
// then renders two tables filtered to that agent: their freight quotes
// and their bookings. Read-only; management stays in FreightQuotesV2 /
// BookingsV2 for staff.

import React, { useEffect, useState } from 'react';
import { Badge } from '../primitives';
import { DataTable, DataTableColumn } from '../primitives/DataTable';
import { Card, CardHeader, CardTitle, CardBody } from '../primitives/Card';
import { useAuth } from '../providers/AuthProvider';
import { useCompany } from '../providers/CompanyProvider';
import { useFreightQuotes, FreightQuote } from '../queries/useFreightQuotes';
import { useBookings, Booking } from '../queries/useBookings';
import { useRowCrud } from '../components/useRowCrud';
import { FieldDef } from '../components/QuickCreateDrawer';
import { getSupabaseClient } from '../../services/supabase';
import { formatDate as fmtDate } from '../lib/formatDate';
import { formatMoney as fmtMoney } from '../lib/formatMoney';
import { shortName, tooltipName } from '../lib/formatName';
import { vividStatusClass, BadgeTone } from '../lib/statusBadge';

// Field schemas for the Inspect/Edit drawer opened from row actions.
// Kept minimal — agents mostly need to correct a rate / ETA and retag
// a port, not rewrite the whole record. Mirrors the dbKey mappings in
// FreightQuotesV2 (snake_case) and BookingsV2 (camelCase).
const quoteFields: FieldDef[] = [
  { key: 'agentName', dbKey: 'agent_name', label: 'Agent', required: true, fullWidth: true,
    source: { table: 'cargo_agents', valueColumn: 'name', labelColumn: 'name', secondaryColumn: 'country', scopeByCompany: true } },
  { key: 'carrier', label: 'Carrier',
    source: { table: 'carriers', valueColumn: 'name', labelColumn: 'name', secondaryColumn: 'scac', scopeByCompany: true } },
  { key: 'freightType', dbKey: 'freight_type', label: 'Type', type: 'select',
    options: ['OCEAN', 'AIR', 'TRUCK', 'RAIL'] },
  // Same ports-source wiring as FreightQuotesV2 — picking a port fills
  // both the 5-char code and the friendly port name via writeAlso.
  { key: 'originPortCode', dbKey: 'origin_port_code', label: 'POA (origin port code)', mono: true,
    source: { table: 'ports', valueColumn: 'code', labelColumn: 'name', secondaryColumn: 'country',
      writeAlso: [{ sourceColumn: 'name', targetKey: 'originPort' }] } },
  { key: 'destinationPortCode', dbKey: 'destination_port_code', label: 'POD (destination port code)', mono: true,
    source: { table: 'ports', valueColumn: 'code', labelColumn: 'name', secondaryColumn: 'country',
      writeAlso: [{ sourceColumn: 'name', targetKey: 'destinationPort' }] } },
  { key: 'originPort',          dbKey: 'origin_port',           label: 'Origin port (name)' },
  { key: 'destinationPort',     dbKey: 'destination_port',      label: 'Destination port (name)' },
  { key: 'rate',     label: 'Rate', type: 'number', mono: true, min: 0, step: 1 },
  { key: 'currency', label: 'Currency', mono: true, type: 'select', defaultValue: 'USD',
    options: ['USD', 'EUR', 'GBP', 'BRL', 'MXN', 'ARS', 'CLP', 'COP', 'PEN', 'CNY', 'JPY', 'KRW', 'INR', 'AED'] },
  { key: 'freeTime',    dbKey: 'free_time',    label: 'Free time (days)', type: 'number', mono: true, min: 0, step: 1 },
  { key: 'transitTime', dbKey: 'transit_time', label: 'Transit (days)',   type: 'number', mono: true, min: 0, step: 1 },
  { key: 'validUntil',  dbKey: 'valid_until',  label: 'Valid until', type: 'date' },
  { key: 'status', label: 'Status', type: 'select',
    options: ['ACTIVE', 'PENDING', 'ACCEPTED', 'EXPIRED', 'REJECTED'], defaultValue: 'ACTIVE' },

  // Pickup / delivery — free-form addresses. Dropdown sources distinct
  // values this org has already used on freight_quotes so agents see
  // prior pickups/deliveries rather than ports. `allowFreeText` keeps
  // brand-new addresses editable.
  { key: 'pickupLocation', dbKey: 'pickup_location', label: 'Pickup location', fullWidth: true,
    source: { table: 'freight_quotes', valueColumn: 'pickup_location',
              orderBy: 'pickup_location', scopeByCompany: true, companyIdColumn: 'company_id' },
    allowFreeText: true },
  { key: 'pickupZip',      dbKey: 'pickup_zip',      label: 'Pickup ZIP', mono: true },
  { key: 'pickupCity',     label: 'Pickup city' },
  { key: 'pickupCountry',  label: 'Pickup country' },
  { key: 'deliveryLocation', dbKey: 'delivery_location', label: 'Delivery location', fullWidth: true,
    source: { table: 'freight_quotes', valueColumn: 'delivery_location',
              orderBy: 'delivery_location', scopeByCompany: true, companyIdColumn: 'company_id' },
    allowFreeText: true },
  { key: 'deliveryZip',    dbKey: 'delivery_zip',    label: 'Delivery ZIP', mono: true },

  // Equipment + demurrage / release windows.
  { key: 'containerCount',   dbKey: 'container_count', label: 'Container count',
    type: 'number', mono: true, min: 0, step: 1 },
  { key: 'containerType',    dbKey: 'container_type',  label: 'Container type', type: 'select',
    options: ['20GP', '20DC', '20HC', '20RE', '20OT', '20FR',
              '40GP', '40DC', '40HC', '40HQ', '40RE', '40OT', '40FR',
              '45HC', 'ISO TANK'] },
  { key: 'containerReturn',  dbKey: 'container_return', label: 'Container return' },
  { key: 'blRelease',        dbKey: 'bl_release',       label: 'BL release' },

  // Flags — booleans stored in PG.
  { key: 'chassis',    label: 'Chassis', type: 'select',
    options: [{ value: '', label: '—' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] },
  { key: 'overweight', label: 'Overweight', type: 'select',
    options: [{ value: '', label: '—' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] },
  { key: 'isAllIn',    dbKey: 'is_all_in', label: 'All-in rate', type: 'select',
    options: [{ value: '', label: '—' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] },

  // Cost breakdown.
  { key: 'pickupCost',      dbKey: 'pickup_cost',      label: 'Pickup cost',      type: 'number', mono: true, min: 0, step: 1 },
  { key: 'oceanCost',       dbKey: 'ocean_cost',       label: 'Ocean cost',       type: 'number', mono: true, min: 0, step: 1 },
  { key: 'deliveryCost',    dbKey: 'delivery_cost',    label: 'Delivery cost',    type: 'number', mono: true, min: 0, step: 1 },
  { key: 'portFees',        dbKey: 'port_fees',        label: 'Port fees',        type: 'number', mono: true, min: 0, step: 1 },
  { key: 'thc',             label: 'THC',              type: 'number', mono: true, min: 0, step: 1 },
  { key: 'isps',            label: 'ISPS',             type: 'number', mono: true, min: 0, step: 1 },
  { key: 'trs',             label: 'TRS',              type: 'number', mono: true, min: 0, step: 1 },
  { key: 'deconsolidation', label: 'Deconsolidation',  type: 'number', mono: true, min: 0, step: 1 },
  { key: 'securityFee',     dbKey: 'security_fee',     label: 'Security fee',     type: 'number', mono: true, min: 0, step: 1 },
  { key: 'bunkerSurcharge', dbKey: 'bunker_surcharge', label: 'Bunker surcharge', type: 'number', mono: true, min: 0, step: 1 },
  { key: 'exwCharges',      dbKey: 'exw_charges',      label: 'EXW charges',      type: 'number', mono: true, min: 0, step: 1 },

  // Notes.
  { key: 'comments',    label: 'Comments',    type: 'textarea', fullWidth: true },
  { key: 'observation', label: 'Observation', type: 'textarea', fullWidth: true },
];

// Mirror of BookingsV2.fields (staff view) so agent-portal edits expose
// the same surface — freeTime, terminal, cargo/VGM/draft cut-offs and
// the linked sales order all round-trip via the drawer.
const bookingFields: FieldDef[] = [
  { key: 'bookingNumber', label: 'Booking #', required: true, mono: true },
  { key: 'customer', label: 'Customer',
    source: { table: 'customers', valueColumn: 'name', labelColumn: 'name', secondaryColumn: 'country', scopeByCompany: true } },
  { key: 'agentName', label: 'Agent',
    source: { table: 'cargo_agents', valueColumn: 'name', labelColumn: 'name', secondaryColumn: 'country', scopeByCompany: true } },
  { key: 'vesselVoyage', label: 'Vessel / Voyage', mono: true, fullWidth: true },
  { key: 'pol', label: 'POL (origin port)', mono: true,
    source: { table: 'ports', valueColumn: 'code', labelColumn: 'name', secondaryColumn: 'country' } },
  { key: 'pod', label: 'POD (destination port)', mono: true,
    source: { table: 'ports', valueColumn: 'code', labelColumn: 'name', secondaryColumn: 'country' } },
  { key: 'equipment',   label: 'Equipment' },
  { key: 'freeTime',    label: 'Free time', mono: true, placeholder: 'e.g. 21 or 21 Day(s)' },
  { key: 'terminal',    label: 'Terminal' },
  { key: 'salesOrderId', label: 'Sales order',
    source: { table: 'sales_orders', valueColumn: 'id', labelColumn: 'orderNumber', secondaryColumn: 'customerName', scopeByCompany: true } },
  { key: 'status',      label: 'Status', type: 'select',
    options: ['AVAILABLE', 'LOADED', 'DEPARTED', 'SHIPPED', 'CANCELLED'],
    defaultValue: 'AVAILABLE' },
  { key: 'etd',         label: 'ETD', type: 'date' },
  { key: 'eta',         label: 'ETA', type: 'date' },
  { key: 'cargoCutOff', label: 'Cargo cut-off', type: 'date' },
  { key: 'vgmCutOff',   label: 'VGM cut-off',   type: 'date' },
  { key: 'draftCutOff', label: 'Draft cut-off', type: 'date' },
];

const quoteStatusTone = (s: string): BadgeTone => {
  const v = s.toUpperCase();
  if (v.includes('ACTIVE') || v.includes('ACCEPT')) return 'success';
  if (v.includes('PEND')) return 'warning';
  if (v.includes('EXPIR') || v.includes('REJECT')) return 'danger';
  return 'neutral';
};

const bookingStatusTone = (s: string): BadgeTone => {
  const v = s.toUpperCase();
  // SHIPPED (cargo on the water / delivered) → green, AVAILABLE (ready
  // to ship but not yet moved) → yellow. Keep the existing buckets for
  // the other status values bookings cycle through.
  if (v.includes('SHIP') || v.includes('LOAD') || v.includes('DEPART')) return 'success';
  if (v.includes('AVAIL') || v.includes('BOOK') || v.includes('PEND')) return 'warning';
  if (v.includes('CONFIRM') || v.includes('ROLL')) return 'info';
  if (v.includes('CANCEL')) return 'danger';
  return 'neutral';
};

/** Normalise booking `freeTime` for display. Column is a free-text
 *  column in the DB (values like `"21 Day(s)"`, `"7"`, `""`). Extract
 *  the leading number and render as `"N d"`; em-dash if no number. */
const fmtFreeTime = (v: string | null): string => {
  const s = (v ?? '').trim();
  if (!s) return '—';
  const m = s.match(/-?\d+(?:\.\d+)?/);
  return m ? `${m[0]} d` : '—';
};

const quoteColumns: DataTableColumn<FreightQuote>[] = [
  // `freight_quotes` has no separate human-readable number column — the
  // `id` (e.g. `FQ1769642878151`) is the only identifier. Surface it as
  // "Quote #" mirroring how Bookings surfaces `bookingNumber`.
  { id: 'number', header: 'Quote #', mono: true, sortable: true, filterable: true,
    value: r => r.id, cell: r => r.id },
  { id: 'route', header: 'Route', sortable: true, filterable: true,
    value: r => `${r.originPort ?? ''} → ${r.destinationPort ?? ''}`,
    cell: r => (
      <span className="font-mono tabular-nums text-[11.5px] text-slate-300">
        {(r.originPort ?? '—')} → {(r.destinationPort ?? '—')}
      </span>
    ) },
  { id: 'poa', header: 'POA', mono: true, sortable: true, filterable: true,
    value: r => (r.originPortCode ?? '').slice(0, 5),
    cell: r => (
      <span className="font-mono uppercase tracking-wider text-[11.5px] text-slate-300">
        {(r.originPortCode ?? '—').slice(0, 5)}
      </span>
    ) },
  { id: 'pod', header: 'POD', mono: true, sortable: true, filterable: true,
    value: r => (r.destinationPortCode ?? '').slice(0, 5),
    cell: r => (
      <span className="font-mono uppercase tracking-wider text-[11.5px] text-slate-300">
        {(r.destinationPortCode ?? '—').slice(0, 5)}
      </span>
    ) },
  { id: 'carrier', header: 'Carrier', sortable: true, filterable: true,
    value: r => r.carrier ?? '', cell: r => r.carrier ?? '—' },
  { id: 'rate', header: 'Rate', align: 'right', mono: true, sortable: true,
    value: r => r.rate ?? 0, cell: r => fmtMoney(r.rate, r.currency) },
  { id: 'free', header: 'Free time', align: 'right', mono: true, sortable: true,
    value: r => r.freeTime ?? 0,
    cell: r => r.freeTime !== null ? `${r.freeTime} d` : '—' },
  { id: 'transit', header: 'Transit', align: 'right', mono: true, sortable: true,
    value: r => r.transitTime ?? 0,
    cell: r => r.transitTime !== null ? `${r.transitTime} d` : '—' },
  { id: 'status', header: 'Status', sortable: true, filterable: true,
    value: r => r.status,
    cell: r => {
      const tone = quoteStatusTone(r.status);
      return <Badge variant={tone} dot className={vividStatusClass(tone)}>{r.status}</Badge>;
    } },
  { id: 'until', header: 'Valid until', align: 'right', sortable: true,
    value: r => r.validUntil ?? '',
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.validUntil)}
      </span>
    ) },
];

const bookingColumns: DataTableColumn<Booking>[] = [
  { id: 'number', header: 'Booking #', mono: true, sortable: true, filterable: true,
    value: r => r.bookingNumber, cell: r => r.bookingNumber },
  // Bookings reference long legal entity names (e.g. "RECIRCULAR
  // INDUSTRIA E COMERCIO DE PLASTICOS LTDA"). Reuse the shared
  // shortName/tooltipName helpers so Agent Portal matches the
  // truncation convention used on BookingsV2 and every other v2 list.
  { id: 'customer', header: 'Customer', sortable: true, filterable: true,
    value: r => r.customer ?? '',
    cell: r => <span className="text-slate-100" title={tooltipName(r.customer)}>{shortName(r.customer)}</span> },
  { id: 'vessel', header: 'Vessel / Voyage', sortable: true, filterable: true,
    value: r => r.vesselVoyage ?? '',
    cell: r => <span className="font-mono text-[11.5px] text-slate-300">{r.vesselVoyage ?? '—'}</span> },
  { id: 'route', header: 'POL → POD', sortable: true, filterable: true,
    value: r => `${r.pol ?? ''} → ${r.pod ?? ''}`,
    cell: r => (
      <span className="font-mono tabular-nums text-[11.5px] text-slate-300">
        {(r.pol ?? '—')} → {(r.pod ?? '—')}
      </span>
    ) },
  { id: 'status', header: 'Status', sortable: true, filterable: true,
    value: r => r.status,
    cell: r => {
      const tone = bookingStatusTone(r.status);
      // Default Badge variants are `bg-*-500/10` — too pale for booking
      // status chips that need to read at a glance. Override with a
      // solid tint on success/warning (SHIPPED / AVAILABLE-family) and
      // leave the rest on the default soft wash.
      const vivid = vividStatusClass(tone);
      return <Badge variant={tone} dot className={vivid}>{r.status}</Badge>;
    } },
  { id: 'free', header: 'Free time', align: 'right', mono: true, sortable: true,
    value: r => r.freeTime ?? '',
    cell: r => <span className="text-slate-300">{fmtFreeTime(r.freeTime)}</span> },
  { id: 'transit', header: 'Transit', align: 'right', mono: true, sortable: true,
    value: r => r.transitDays ?? 0,
    cell: r => r.transitDays !== null ? `${r.transitDays} d` : '—' },
  { id: 'etd', header: 'ETD', align: 'right', sortable: true,
    value: r => r.etd ?? '',
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">{fmtDate(r.etd)}</span>
    ) },
  { id: 'eta', header: 'ETA', align: 'right', sortable: true,
    value: r => r.eta ?? '',
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">{fmtDate(r.eta)}</span>
    ) },
];

interface Props {
  view: 'quotes' | 'bookings';
}

const AgentPortalV2: React.FC<Props> = ({ view }) => {
  const { user, loading: authLoading } = useAuth();
  const { currentCompanyId } = useCompany();
  const [agentNames, setAgentNames] = useState<string[]>([]);
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'ready' | 'missing'>('idle');

  // Users can be linked to multiple cargo_agents rows (CSV-encoded in
  // users.linked_entity_id — see AuthProvider). Resolve every linked
  // id to its name in a single `in (...)` query so downstream filters
  // can OR across all of them.
  const linkedIds = user?.linkedEntityIds && user.linkedEntityIds.length > 0
    ? user.linkedEntityIds
    : (user?.linkedEntityId ? [user.linkedEntityId] : []);
  const linkedIdsKey = linkedIds.join(',');

  useEffect(() => {
    if (authLoading) return;
    if (linkedIds.length === 0) { setLookupState('missing'); return; }
    let cancelled = false;
    setLookupState('loading');
    (async () => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('cargo_agents')
        .select('id, name')
        .in('id', linkedIds);
      if (cancelled) return;
      const names = ((data as Array<{ name?: string | null }> | null) ?? [])
        .map(r => (r.name ?? '').toString())
        .filter(Boolean);
      if (error || names.length === 0) { setLookupState('missing'); return; }
      setAgentNames(names);
      setLookupState('ready');
    })();
    return () => { cancelled = true; };
    // linkedIdsKey stringifies the array so the effect only re-runs
    // when the actual set of linked agents changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, linkedIdsKey]);

  const quotes = useFreightQuotes(undefined, view === 'quotes' ? agentNames : undefined);
  const bookings = useBookings(undefined, view === 'bookings' ? agentNames : undefined);

  const quoteCrud = useRowCrud<FreightQuote>({
    table: 'freight_quotes',
    listQueryKeys: ['freightQuotes', 'logisticsDocs'],
    rowLabel: r => r.agentName ?? r.id,
    fields: quoteFields,
  });
  const bookingCrud = useRowCrud<Booking>({
    table: 'bookings',
    listQueryKeys: ['bookings', 'logisticsDocs'],
    rowLabel: r => r.bookingNumber,
    fields: bookingFields,
  });

  if (authLoading || lookupState === 'loading' || lookupState === 'idle') {
    return <div className="p-6 text-slate-500 text-sm">Loading agent portal…</div>;
  }

  if (!user || user.role !== 'Cargo Agent') {
    // A stale `xs_v2_active_route` shouldn't be able to strand a
    // non-Cargo-Agent user on this screen. Clear it and bounce to
    // Dashboard via the global navigate event.
    if (typeof window !== 'undefined') {
      try { sessionStorage.removeItem('xs_v2_active_route'); } catch { /* noop */ }
      window.dispatchEvent(new CustomEvent('xs-v2-navigate', { detail: { id: 'dashboard' } }));
    }
    return (
      <div className="p-6">
        <Card>
          <CardBody>
            <p className="text-slate-200 text-sm">
              This portal is only available to Cargo Agent users. Redirecting…
            </p>
            <p className="text-slate-500 text-xs mt-1">
              Current role: {user?.role ?? 'none'}.
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (lookupState === 'missing' || agentNames.length === 0) {
    return (
      <div className="p-6">
        <Card>
          <CardBody>
            <p className="text-slate-200 text-sm">
              Your user account isn't linked to a cargo agent record yet.
            </p>
            <p className="text-slate-500 text-xs mt-1">
              Ask an admin to set <code className="text-slate-300">linked_entity_id</code> on your user to one or more rows in <code className="text-slate-300">cargo_agents</code>.
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  const heading = view === 'quotes' ? 'Freight Quotes' : 'Bookings';
  const agentLabel = agentNames.length === 1 ? agentNames[0] : `${agentNames.length} agents`;
  const subtitle = `${agentLabel} · ${currentCompanyId === 'ALL' ? 'All companies' : 'Current company'}`;

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-[18px] font-semibold text-slate-100">{heading}</h1>
        <p className="text-[12.5px] text-slate-500 mt-0.5">{subtitle}</p>
      </header>

      {view === 'quotes' ? (
        <Card>
          <CardHeader>
            <CardTitle>
              Freight quotes
              <span className="ml-2 text-[11px] text-slate-500 font-normal">
                {quotes.data ? `${quotes.data.length} row${quotes.data.length === 1 ? '' : 's'}` : '…'}
              </span>
            </CardTitle>
          </CardHeader>
          <CardBody>
            {quotes.error ? (
              <p className="text-red-400 text-sm">Failed to load quotes: {quotes.error.message}</p>
            ) : quotes.isLoading ? (
              <p className="text-slate-500 text-sm">Loading…</p>
            ) : (
              <DataTable<FreightQuote>
                columns={quoteColumns}
                rows={quotes.data ?? []}
                getRowId={r => r.id}
                onRowClick={quoteCrud.openView}
                rowActions={quoteCrud.rowActions}
                emptyMessage="No freight quotes yet."
              />
            )}
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              Bookings
              <span className="ml-2 text-[11px] text-slate-500 font-normal">
                {bookings.data ? `${bookings.data.length} row${bookings.data.length === 1 ? '' : 's'}` : '…'}
              </span>
            </CardTitle>
          </CardHeader>
          <CardBody>
            {bookings.error ? (
              <p className="text-red-400 text-sm">Failed to load bookings: {bookings.error.message}</p>
            ) : bookings.isLoading ? (
              <p className="text-slate-500 text-sm">Loading…</p>
            ) : (
              <DataTable<Booking>
                columns={bookingColumns}
                rows={bookings.data ?? []}
                getRowId={r => r.id}
                onRowClick={bookingCrud.openView}
                rowActions={bookingCrud.rowActions}
                emptyMessage="No bookings assigned to you yet."
              />
            )}
          </CardBody>
        </Card>
      )}

      {view === 'quotes' ? quoteCrud.drawers : bookingCrud.drawers}
    </div>
  );
};

export default AgentPortalV2;
