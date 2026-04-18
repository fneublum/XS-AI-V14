// Phase 3B — v2 Bookings.

import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Badge, Button, Input, FormField, Label } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { SupabaseSelectField } from '../components/SupabaseSelectField';
import { AiUploadModal } from '../components/AiUploadModal';
import { useRowCrud } from '../components/useRowCrud';
import { useCompany } from '../providers/CompanyProvider';
import { useToast } from '../primitives/Toast';
import { useEntityInsert } from '../queries/useEntityMutations';
import { useBookings, Booking } from '../queries/useBookings';
import { formatDate as fmtDate } from '../lib/formatDate';

type BadgeTone = 'success' | 'info' | 'warning' | 'neutral' | 'danger';
const statusTone = (status: string): BadgeTone => {
  const s = status.toUpperCase();
  if (s.includes('CONFIRM') || s.includes('ROLL'))  return 'info';
  if (s.includes('LOAD') || s.includes('DEPART'))   return 'success';
  if (s.includes('BOOK') || s.includes('PEND'))     return 'warning';
  if (s.includes('CANCEL'))                         return 'danger';
  return 'neutral';
};

const columns: DataTableColumn<Booking>[] = [
  { id: 'number', header: 'Booking #', mono: true, sortable: true, filterable: true,
    value: r => r.bookingNumber, cell: r => r.bookingNumber },
  { id: 'customer', header: 'Customer', sortable: true, filterable: true,
    value: r => r.customer ?? '',
    cell: r => <span className="text-slate-100">{r.customer ?? '—'}</span> },
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
  { id: 'equip', header: 'Equipment', sortable: true, filterable: true,
    value: r => r.equipment ?? '', cell: r => r.equipment ?? '—' },
  { id: 'status', header: 'Status', sortable: true, filterable: true,
    value: r => r.status,
    cell: r => <Badge variant={statusTone(r.status)} dot>{r.status}</Badge> },
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

const fields: FieldDef[] = [
  { key: 'bookingNumber', label: 'Booking #', required: true, mono: true },
  { key: 'customer', label: 'Customer',
    source: {
      table: 'customers', valueColumn: 'name', labelColumn: 'name',
      secondaryColumn: 'country', scopeByCompany: true,
    } },
  { key: 'agentName', label: 'Agent',
    source: {
      table: 'cargo_agents', valueColumn: 'name', labelColumn: 'name',
      secondaryColumn: 'country', scopeByCompany: true,
    } },
  { key: 'vesselVoyage',  label: 'Vessel / Voyage', mono: true, fullWidth: true },
  { key: 'pol', label: 'POL (origin port)', mono: true,
    source: {
      table: 'ports', valueColumn: 'code', labelColumn: 'name',
      secondaryColumn: 'country',
    } },
  { key: 'pod', label: 'POD (destination port)', mono: true,
    source: {
      table: 'ports', valueColumn: 'code', labelColumn: 'name',
      secondaryColumn: 'country',
    } },
  { key: 'equipment',     label: 'Equipment' },
  { key: 'freeTime',      label: 'Free time (days)', type: 'number',
    mono: true, min: 0, step: 1 },
  { key: 'terminal',      label: 'Terminal' },
  { key: 'status',        label: 'Status', type: 'select',
    options: ['BOOKED', 'CONFIRMED', 'LOADED', 'DEPARTED', 'CANCELLED'],
    defaultValue: 'BOOKED' },
  { key: 'etd',           label: 'ETD', type: 'date' },
  { key: 'eta',           label: 'ETA', type: 'date' },
  { key: 'cargoCutOff',   label: 'Cargo cut-off', type: 'date' },
  { key: 'vgmCutOff',     label: 'VGM cut-off', type: 'date' },
  { key: 'draftCutOff',   label: 'Draft cut-off', type: 'date' },
];

interface BookingDraft {
  bookingNumber: string;
  customer: string;
  agentName: string;
  vesselVoyage: string;
  pol: string;
  pod: string;
  equipment: string;
  freeTime: string;
  terminal: string;
  status: string;
  etd: string;
  eta: string;
  cargoCutOff: string;
  vgmCutOff: string;
  draftCutOff: string;
}

const emptyBookingDraft = (): BookingDraft => ({
  bookingNumber: '', customer: '', agentName: '', vesselVoyage: '',
  pol: '', pod: '', equipment: '', freeTime: '', terminal: '',
  status: 'BOOKED', etd: '', eta: '', cargoCutOff: '', vgmCutOff: '', draftCutOff: '',
});

const BOOKING_PROMPT = `You are extracting fields from a SHIPPING BOOKING CONFIRMATION
(ocean carrier or NVOCC). Return JSON with exactly these keys; missing
values must be null — never guess.

{
  "bookingNumber": string | null,
  "customer":      string | null,
  "agentName":     string | null,   // forwarder / NVOCC / cargo agent
  "vesselVoyage":  string | null,   // "MAERSK EINDHOVEN / 331S"
  "pol":           string | null,   // 5-char UN/LOCODE origin port, uppercase (e.g. "BRSSZ")
  "pod":           string | null,   // 5-char UN/LOCODE destination port, uppercase
  "equipment":     string | null,   // "1 x 40HC" etc.
  "freeTime":      number | null,   // days
  "terminal":      string | null,
  "status":        "BOOKED" | "CONFIRMED" | "LOADED" | "DEPARTED" | "CANCELLED" | null,
  "etd":           string | null,   // YYYY-MM-DD
  "eta":           string | null,   // YYYY-MM-DD
  "cargoCutOff":   string | null,   // YYYY-MM-DD or ISO datetime
  "vgmCutOff":     string | null,   // YYYY-MM-DD or ISO datetime
  "draftCutOff":   string | null    // YYYY-MM-DD or ISO datetime
}

Rules:
- UN/LOCODEs are 5 uppercase characters (2-letter country + 3-letter port).
- Convert "15/May/2026" or "15-MAY-2026" to ISO YYYY-MM-DD.
- Return ONLY valid JSON — no markdown fences, no commentary.`;

function normalizeBookingJson(parsed: Record<string, unknown>): BookingDraft {
  const str = (k: string): string => {
    const v = parsed[k];
    return typeof v === 'string' ? v.trim() : '';
  };
  const num = (k: string): string => {
    const v = parsed[k];
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'string') {
      const n = Number(v.replace(/[^0-9.\-]/g, ''));
      return Number.isFinite(n) && v.trim() !== '' ? String(n) : '';
    }
    return '';
  };
  const status = str('status').toUpperCase();
  return {
    bookingNumber: str('bookingNumber'),
    customer:      str('customer'),
    agentName:     str('agentName'),
    vesselVoyage:  str('vesselVoyage'),
    pol:           str('pol').toUpperCase().slice(0, 5),
    pod:           str('pod').toUpperCase().slice(0, 5),
    equipment:     str('equipment'),
    freeTime:      num('freeTime'),
    terminal:      str('terminal'),
    status:        (['BOOKED','CONFIRMED','LOADED','DEPARTED','CANCELLED'].includes(status)
                     ? status : 'BOOKED'),
    etd:           str('etd'),
    eta:           str('eta'),
    cargoCutOff:   str('cargoCutOff'),
    vgmCutOff:     str('vgmCutOff'),
    draftCutOff:   str('draftCutOff'),
  };
}

const BookingsV2: React.FC = () => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [aiUploadOpen, setAiUploadOpen] = useState(false);
  const bookings = useBookings(search);
  const insert = useEntityInsert<Record<string, unknown>>({
    table: 'bookings',
    listQueryKeys: ['bookings', 'logisticsDocs'],
    idPrefix: 'BKG',
  });

  const { rowActions, drawers, openView } = useRowCrud<Booking>({
    table: 'bookings',
    listQueryKeys: ['bookings', 'logisticsDocs'],
    rowLabel: r => r.bookingNumber,
    fields,
  });

  const openCreate = () => setCreateOpen(true);

  return (
    <>
      <ListPage<Booking>
        title="Bookings"
        subtitle={
          bookings.data
            ? `${bookings.data.length} shown${search ? ` · "${search}"` : ''}`
            : 'Loading…'
        }
        search={search}
        setSearch={setSearch}
        searchPlaceholder="Booking #, customer, vessel"
        columns={columns}
        getRowId={r => r.id}
        data={bookings.data}
        isLoading={bookings.isLoading}
        error={bookings.error}
        onRetry={bookings.refetch}
        onRowClick={openView}
        rowActions={rowActions}
        headerAction={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={openCreate}
              className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
              + New booking
            </Button>
            <Button size="sm" onClick={() => setAiUploadOpen(true)}
              className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/40 text-indigo-200 hover:from-indigo-500/30 hover:to-purple-500/30 h-7 px-2.5 text-[12px] font-medium rounded-md inline-flex items-center gap-1.5">
              <Sparkles size={12} />
              AI Upload
            </Button>
          </div>
        }
        emptyAction={search ? undefined : { label: '+ New booking', onClick: openCreate }}
        skeletonCols={[120, 160, 140, 140, 80, 60]}
      />
      <QuickCreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New booking"
        description="Register a booking with a carrier or forwarder."
        table="bookings"
        idPrefix="BKG"
        listQueryKeys={['bookings']}
        scopeByCompany
        fields={fields}
      />
      {aiUploadOpen && (
        <AiUploadModal<BookingDraft>
          open={aiUploadOpen}
          onOpenChange={setAiUploadOpen}
          config={{
            title: 'AI upload — booking confirmation',
            description: 'Drop a booking PDF / image, pick a file, or paste text or a screenshot. Gemini extracts the fields; you review and save.',
            emptyDraft: emptyBookingDraft,
            fromExtracted: (d) => d,
            extractSpec: { prompt: BOOKING_PROMPT, normalize: normalizeBookingJson },
            extractSummary: (d) =>
              [d.bookingNumber, d.pol, d.pod].filter(Boolean).join(' · ') || null,
            validate: (d) =>
              d.bookingNumber.trim() === '' ? 'Booking # is required.' : null,
            renderReview: (d, setD) => (
              <div className="grid grid-cols-2 gap-3">
                <FormField className="col-span-2">
                  <FieldLabel>Booking # *</FieldLabel>
                  <Input value={d.bookingNumber}
                    onChange={e => setD({ ...d, bookingNumber: e.target.value })}
                    className={inputCls + ' font-mono'} />
                </FormField>
                <FormField>
                  <FieldLabel>Customer</FieldLabel>
                  <SupabaseSelectField
                    source={{
                      table: 'customers', valueColumn: 'name', labelColumn: 'name',
                      secondaryColumn: 'country', scopeByCompany: true,
                    }}
                    value={d.customer}
                    onPick={v => setD({ ...d, customer: v })} />
                </FormField>
                <FormField>
                  <FieldLabel>Agent</FieldLabel>
                  <SupabaseSelectField
                    source={{
                      table: 'cargo_agents', valueColumn: 'name', labelColumn: 'name',
                      secondaryColumn: 'country', scopeByCompany: true,
                    }}
                    value={d.agentName}
                    onPick={v => setD({ ...d, agentName: v })} />
                </FormField>
                <FormField className="col-span-2">
                  <FieldLabel>Vessel / Voyage</FieldLabel>
                  <Input value={d.vesselVoyage}
                    onChange={e => setD({ ...d, vesselVoyage: e.target.value })}
                    className={inputCls + ' font-mono'} />
                </FormField>
                <FormField>
                  <FieldLabel>POL</FieldLabel>
                  <SupabaseSelectField
                    source={{
                      table: 'ports', valueColumn: 'code', labelColumn: 'name',
                      secondaryColumn: 'country',
                    }}
                    value={d.pol} mono
                    onPick={v => setD({ ...d, pol: v })} />
                </FormField>
                <FormField>
                  <FieldLabel>POD</FieldLabel>
                  <SupabaseSelectField
                    source={{
                      table: 'ports', valueColumn: 'code', labelColumn: 'name',
                      secondaryColumn: 'country',
                    }}
                    value={d.pod} mono
                    onPick={v => setD({ ...d, pod: v })} />
                </FormField>
                <FormField>
                  <FieldLabel>Equipment</FieldLabel>
                  <Input value={d.equipment}
                    onChange={e => setD({ ...d, equipment: e.target.value })}
                    className={inputCls} />
                </FormField>
                <FormField>
                  <FieldLabel>Terminal</FieldLabel>
                  <Input value={d.terminal}
                    onChange={e => setD({ ...d, terminal: e.target.value })}
                    className={inputCls} />
                </FormField>
                <FormField>
                  <FieldLabel>Free time (days)</FieldLabel>
                  <Input type="number" value={d.freeTime}
                    onChange={e => setD({ ...d, freeTime: e.target.value })}
                    className={inputCls + ' font-mono tabular-nums'} />
                </FormField>
                <FormField>
                  <FieldLabel>Status</FieldLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {(['BOOKED','CONFIRMED','LOADED','DEPARTED','CANCELLED'] as const).map(opt => (
                      <button key={opt} type="button"
                        onClick={() => setD({ ...d, status: opt })}
                        className={d.status === opt
                          ? 'px-2.5 py-1 rounded-md text-[11px] font-medium bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                          : 'px-2.5 py-1 rounded-md text-[11px] text-slate-400 border border-[#1f1f1f] hover:text-slate-200 hover:border-[#2a2a2a]'}>
                        {opt}
                      </button>
                    ))}
                  </div>
                </FormField>
                <FormField>
                  <FieldLabel>ETD</FieldLabel>
                  <Input type="date" value={d.etd}
                    onChange={e => setD({ ...d, etd: e.target.value })}
                    className={inputCls} />
                </FormField>
                <FormField>
                  <FieldLabel>ETA</FieldLabel>
                  <Input type="date" value={d.eta}
                    onChange={e => setD({ ...d, eta: e.target.value })}
                    className={inputCls} />
                </FormField>
                <FormField>
                  <FieldLabel>Cargo cut-off</FieldLabel>
                  <Input type="date" value={d.cargoCutOff?.slice(0, 10) ?? ''}
                    onChange={e => setD({ ...d, cargoCutOff: e.target.value })}
                    className={inputCls} />
                </FormField>
                <FormField>
                  <FieldLabel>VGM cut-off</FieldLabel>
                  <Input type="date" value={d.vgmCutOff?.slice(0, 10) ?? ''}
                    onChange={e => setD({ ...d, vgmCutOff: e.target.value })}
                    className={inputCls} />
                </FormField>
                <FormField className="col-span-2">
                  <FieldLabel>Draft cut-off</FieldLabel>
                  <Input type="date" value={d.draftCutOff?.slice(0, 10) ?? ''}
                    onChange={e => setD({ ...d, draftCutOff: e.target.value })}
                    className={inputCls} />
                </FormField>
              </div>
            ),
            save: async (d) => {
              const payload: Record<string, unknown> = {
                bookingNumber: d.bookingNumber.trim(),
                customer:      d.customer.trim() || null,
                agentName:     d.agentName.trim() || null,
                vesselVoyage:  d.vesselVoyage.trim() || null,
                pol:           d.pol.trim().toUpperCase() || null,
                pod:           d.pod.trim().toUpperCase() || null,
                equipment:     d.equipment.trim() || null,
                freeTime:      d.freeTime.trim() === '' ? null : Number(d.freeTime),
                terminal:      d.terminal.trim() || null,
                status:        d.status || 'BOOKED',
                etd:           d.etd || null,
                eta:           d.eta || null,
                cargoCutOff:   d.cargoCutOff || null,
                vgmCutOff:     d.vgmCutOff || null,
                draftCutOff:   d.draftCutOff || null,
              };
              if (currentCompanyId && currentCompanyId !== 'ALL') {
                payload.companyId = currentCompanyId;
              }
              await insert.mutateAsync(payload);
              toast.push({
                kind: 'success',
                title: 'Booking saved',
                description: d.bookingNumber,
              });
            },
          }}
        />
      )}
      {drawers}
    </>
  );
};

const inputCls =
  'h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200';

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
    {children}
  </Label>
);

export default BookingsV2;
