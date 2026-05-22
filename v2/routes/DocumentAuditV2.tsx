// Document Audit menu — Hermes BL audits read + decision UI.
//
// See /Users/felipeneublum/Desktop/XS-AI-Document-Audit-Menu-Briefing.md
// for the spec. List + filters + detail drawer with editable correction
// email and Authorize / Edit / Dismiss actions.

import React, { useMemo, useState } from 'react';
import {
  ShieldAlert, ShieldCheck, ShieldQuestion, Link2, CheckCircle2, AlertTriangle,
  Eye, Pencil, X as XIcon, Send, RefreshCw, Clock, Loader2,
} from 'lucide-react';
import {
  Card, CardHeader, CardTitle, CardBody, Badge, Button, Input, Skeleton, EmptyState,
} from '../primitives';
import { Modal } from '../primitives/Modal';
import { useToast } from '../primitives/Toast';
import { DataTable, DataTableColumn } from '../primitives/DataTable';
import { useBlAudits, useBlAuditPatch, type AppliedCorrection, type BlAudit, type BlAuditStatus, type BlAuditIssue } from '../queries/useBlAudits';
import { useCompany } from '../providers/CompanyProvider';
import { useCompanies } from '../queries/useCompanies';
import { formatDate as fmtDate } from '../lib/formatDate';

const STATUS_LABEL: Record<BlAuditStatus, string> = {
  green: 'Green',
  yellow: 'Yellow',
  red: 'Red',
  pending: 'Pending',
  broken_linkage: 'Broken linkage',
  resolved: 'Resolved',
};

const STATUS_TONE: Record<BlAuditStatus, 'success' | 'danger' | 'info' | 'warning' | 'neutral'> = {
  green: 'success',
  yellow: 'warning',
  red: 'danger',
  pending: 'info',
  broken_linkage: 'warning',
  resolved: 'success',
};

// Sort priority for status — red first (act now), yellow next (warnings),
// then broken / pending, then resolved / green at the bottom.
const STATUS_RANK: Record<BlAuditStatus, number> = {
  red: 0, yellow: 1, broken_linkage: 2, pending: 3, resolved: 4, green: 5,
};

const StatusIcon: React.FC<{ s: BlAuditStatus; size?: number }> = ({ s, size = 13 }) => {
  if (s === 'red') return <ShieldAlert size={size} className="text-rose-400" />;
  if (s === 'yellow') return <AlertTriangle size={size} className="text-amber-400" />;
  if (s === 'green') return <ShieldCheck size={size} className="text-emerald-400" />;
  if (s === 'resolved') return <CheckCircle2 size={size} className="text-emerald-400" />;
  if (s === 'pending') return <Loader2 size={size} className="text-indigo-300 animate-spin" />;
  if (s === 'broken_linkage') return <Link2 size={size} className="text-amber-400" />;
  return <ShieldQuestion size={size} className="text-slate-500" />;
};

type SinceFilter = 'today' | '7d' | '30d' | 'all';
const SINCE_LABEL: Record<SinceFilter, string> = {
  today: 'Today', '7d': 'Last 7d', '30d': 'Last 30d', all: 'All time',
};
function sinceIsoFor(f: SinceFilter): string | null {
  if (f === 'all') return null;
  const now = new Date();
  const days = f === 'today' ? 0 : f === '7d' ? 7 : 30;
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  if (f === 'today') cutoff.setHours(0, 0, 0, 0);
  return cutoff.toISOString();
}

// Hermes writes raw snake_case keys into issues_json[].field (e.g.
// "hs_code", "ci_bl_date_gap"). The rest of the ERP — Sales Orders /
// Invoices / Packing List drawers — uses human field labels. This map
// keeps the Document Audit issues table reading the same way as
// every other view, so users don't have to translate "hscode" → "HS Code"
// in their head.
const FIELD_LABELS: Record<string, string> = {
  hs_code:          'HS Code',
  hscode:           'HS Code',
  ncm:              'NCM Code',
  incoterm:         'Incoterm',
  payment_terms:    'Payment terms',
  paymentterms:     'Payment terms',
  net_weight:       'Net weight',
  gross_weight:     'Gross weight',
  netweight:        'Net weight',
  grossweight:      'Gross weight',
  net_lbs:          'Net weight (lbs)',
  gross_lbs:        'Gross weight (lbs)',
  net_kg:           'Net weight (kg)',
  gross_kg:         'Gross weight (kg)',
  quantity:         'Quantity',
  unit_price:       'Unit price',
  total:            'Total',
  total_amount:     'Total amount',
  currency:         'Currency',
  container_number: 'Container #',
  container:        'Container #',
  seal_number:      'Seal #',
  seal:             'Seal #',
  pol:              'POL (origin)',
  pod:              'POD (destination)',
  origin:           'Origin',
  destination:      'Destination',
  shipper:          'Shipper',
  consignee:        'Consignee',
  notify:           'Notify party',
  notify_party:     'Notify party',
  supplier:         'Supplier',
  customer:         'Customer',
  vessel:           'Vessel / Voyage',
  vessel_voyage:    'Vessel / Voyage',
  voyage:           'Vessel / Voyage',
  booking_number:   'Booking #',
  bookingnumber:    'Booking #',
  bl_number:        'B/L #',
  blnumber:         'B/L #',
  invoice_number:   'Invoice #',
  invoicenumber:    'Invoice #',
  pl_number:        'PL #',
  plnumber:         'PL #',
  so_number:        'SO #',
  sonumber:         'SO #',
  date:             'Date',
  invoice_date:     'Invoice date',
  bl_date:          'B/L date',
  etd:              'ETD',
  eta:              'ETA',
  ci_bl_date_gap:   'CI ↔ BL date gap',
  ci_pl_date_gap:   'CI ↔ PL date gap',
  pl_bl_date_gap:   'PL ↔ BL date gap',
  linkage:          'Document linkage',
  marks_numbers:    'Marks & numbers',
  package_count:    'Package count',
  goods_description:'Goods description',
};
function fieldLabel(key: string | null | undefined): string {
  const raw = String(key ?? '').trim();
  if (!raw) return '—';
  const direct = FIELD_LABELS[raw.toLowerCase()];
  if (direct) return direct;
  // Fallback: snake_case / camelCase → Title Case with spaces.
  return raw
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function relativeAgo(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return fmtDate(iso);
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return fmtDate(iso);
}

const DocumentAuditV2: React.FC = () => {
  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState<BlAuditStatus | 'ALL'>('ALL');
  const [since, setSince] = useState<SinceFilter>('all');
  const [search, setSearch] = useState('');
  const [openBl, setOpenBl] = useState<string | null>(null);

  // Derive the company filter from the global company switcher (top sidebar).
  // currentCompanyId is either 'ALL' or a company row id like 'COMP1764818591026'.
  // bl_audits.company stores the company short-code (EC4/XSOLUTION/UP8) which
  // matches the `nickname` column on the companies row.
  const { currentCompanyId } = useCompany();
  const { data: companiesList } = useCompanies();
  const companyFilter: string | 'ALL' = useMemo(() => {
    if (currentCompanyId === 'ALL') return 'ALL';
    const co = (companiesList ?? []).find(c => c.id === currentCompanyId);
    return co?.nickname || co?.name || 'ALL';
  }, [currentCompanyId, companiesList]);

  const audits = useBlAudits({
    status: statusFilter,
    company: companyFilter,
    sinceIso: sinceIsoFor(since),
    search,
  });
  const patch = useBlAuditPatch();

  // Sort: status priority then most-recently audited first.
  const rows = useMemo(() => {
    const list = audits.data ?? [];
    return [...list].sort((a, b) => {
      const rA = STATUS_RANK[a.status] ?? 99;
      const rB = STATUS_RANK[b.status] ?? 99;
      if (rA !== rB) return rA - rB;
      return (b.audited_at ?? '').localeCompare(a.audited_at ?? '');
    });
  }, [audits.data]);

  const totals = useMemo(() => {
    const t = { red: 0, yellow: 0, pending: 0, broken_linkage: 0, green: 0, resolved: 0 };
    for (const r of audits.data ?? []) {
      if (r.status in t) (t as Record<string, number>)[r.status]++;
    }
    return t;
  }, [audits.data]);

  const openRow = audits.data?.find(r => r.bl_number === openBl) ?? null;

  const onAuthorize = (row: BlAudit, opts?: { editBody?: string }) => {
    const p: Partial<BlAudit> = { correction_authorized: true, correction_dismissed: false };
    if (opts?.editBody !== undefined) p.correction_edit_body = opts.editBody;
    patch.mutate({ bl_number: row.bl_number, patch: p }, {
      onSuccess: () => toast.push({
        kind: 'success',
        title: 'Authorized',
        description: `Hermes will send the correction for ${row.bl_number} within ~60s.`,
      }),
      onError: (err) => toast.push({ kind: 'error', title: 'Authorize failed', description: err.message }),
    });
  };
  const onDismiss = (row: BlAudit) => {
    patch.mutate({ bl_number: row.bl_number, patch: { correction_dismissed: true, correction_authorized: false } }, {
      onSuccess: () => toast.push({
        kind: 'success', title: 'Dismissed',
        description: `${row.bl_number} accepted as-is. No correction email.`,
      }),
      onError: (err) => toast.push({ kind: 'error', title: 'Dismiss failed', description: err.message }),
    });
  };
  const saveEditedBody = (row: BlAudit, body: string) =>
    patch.mutate({ bl_number: row.bl_number, patch: { correction_edit_body: body } }, {
      onSuccess: () => toast.push({ kind: 'success', title: 'Draft saved' }),
      onError: (err) => toast.push({ kind: 'error', title: 'Save failed', description: err.message }),
    });

  /**
   * Approve an ERP-suggested CI/PL correction. Appends to
   * bl_audits.applied_corrections (JSONB array) as audit trail. A
   * follow-up Hermes worker will read this list and patch the
   * underlying CI / PL record in XS-AI.
   */
  const onApplyCorrection = (row: BlAudit, correction: AppliedCorrection) => {
    const prev = row.applied_corrections ?? [];
    const next = [...prev.filter(c => !(c.field === correction.field && c.doc === correction.doc)), correction];
    patch.mutate({ bl_number: row.bl_number, patch: { applied_corrections: next } as Partial<BlAudit> }, {
      onSuccess: () => toast.push({
        kind: 'success',
        title: `Applied to ${correction.doc}`,
        description: `${correction.field} = ${correction.new_value}`,
      }),
      onError: (err) => toast.push({ kind: 'error', title: 'Apply failed', description: err.message }),
    });
  };

  const columns: DataTableColumn<BlAudit>[] = [
    {
      id: 'status', header: '', sortable: true,
      value: r => STATUS_RANK[r.status] ?? 99,
      cell: r => (
        <span className="inline-flex items-center" title={STATUS_LABEL[r.status]}>
          <StatusIcon s={r.status} />
        </span>
      ),
    },
    // Column order requested: status / date / shipper / consignee /
    // invoice # / BL # / Issues / Warns / Audited / Actions.
    // (Deal + Carrier dropped from the list view; both still visible in
    // the audit detail modal.)
    {
      id: 'bl_date', header: 'Date', sortable: true, mono: true,
      value: r => r.bl_date ?? '',
      cell: r => r.bl_date
        ? <span className="font-mono tabular-nums text-slate-300 text-[11.5px]">{fmtDate(r.bl_date)}</span>
        : <span className="text-slate-700">—</span>,
    },
    {
      id: 'shipper', header: 'Shipper', sortable: true, filterable: true,
      value: r => r.shipper ?? '',
      cell: r => r.shipper
        ? <span className="text-slate-300 text-[11.5px]" title={r.shipper}>{r.shipper}</span>
        : <span className="text-slate-700">—</span>,
    },
    {
      id: 'consignee', header: 'Consignee', sortable: true, filterable: true,
      value: r => r.consignee ?? '',
      cell: r => r.consignee
        ? <span className="text-slate-300 text-[11.5px]" title={r.consignee}>{r.consignee}</span>
        : <span className="text-slate-700">—</span>,
    },
    {
      id: 'invoice_number', header: 'Invoice #', sortable: true, filterable: true, mono: true,
      value: r => r.invoice_number ?? '',
      cell: r => r.invoice_number
        ? <span className="font-mono text-slate-300 text-[11.5px]">{r.invoice_number}</span>
        : <span className="text-slate-700">—</span>,
    },
    {
      id: 'bl_number', header: 'BL #', sortable: true, filterable: true, mono: true,
      value: r => r.bl_number,
      cell: r => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpenBl(r.bl_number); }}
          className="text-slate-100 font-mono hover:text-indigo-300 hover:underline"
        >
          {r.bl_number}
        </button>
      ),
    },
    {
      id: 'hold_risk_count', header: 'Issues', sortable: true, mono: true, align: 'right',
      value: r => r.hold_risk_count,
      cell: r => r.hold_risk_count > 0
        ? <Badge variant="danger">{r.hold_risk_count}</Badge>
        : <span className="text-slate-600">—</span>,
    },
    {
      id: 'warn_count', header: 'Warns', sortable: true, mono: true, align: 'right',
      value: r => r.warn_count,
      cell: r => r.warn_count > 0
        ? <Badge variant="warning">{r.warn_count}</Badge>
        : <span className="text-slate-600">—</span>,
    },
    {
      id: 'audited_at', header: 'Audited', sortable: true, mono: true, align: 'right',
      value: r => r.audited_at,
      cell: r => (
        <span className="text-slate-500 font-mono tabular-nums text-[11.5px]" title={new Date(r.audited_at).toLocaleString()}>
          {relativeAgo(r.audited_at)}
        </span>
      ),
    },
    {
      id: 'actions', header: '', sortable: false, align: 'right',
      value: () => '',
      cell: r => (
        <div className="flex items-center justify-end gap-0.5">
          <button
            type="button" title="View" aria-label="View"
            onClick={(e) => { e.stopPropagation(); setOpenBl(r.bl_number); }}
            className="p-1 rounded-sm text-slate-500 hover:text-slate-100 hover:bg-[#161616]"
          ><Eye size={14} /></button>
          {r.status === 'red' && !r.correction_authorized && !r.correction_dismissed && (
            <>
              <button
                type="button" title="Authorize correction email"
                onClick={(e) => { e.stopPropagation(); onAuthorize(r); }}
                disabled={patch.isPending}
                className="p-1 rounded-sm text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40"
              ><CheckCircle2 size={14} /></button>
              <button
                type="button" title="Dismiss (accept BL as-is)"
                onClick={(e) => { e.stopPropagation(); onDismiss(r); }}
                disabled={patch.isPending}
                className="p-1 rounded-sm text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 disabled:opacity-40"
              ><XIcon size={14} /></button>
            </>
          )}
          {r.correction_authorized && !r.correction_email_sent_at && (
            <Badge variant="info" title="Hermes will dispatch within ~60s">authorized</Badge>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-[1400px] space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert size={18} className="text-rose-400" />
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">
              Document Audit
            </h1>
            <Badge variant="info">Hermes</Badge>
          </div>
          <p className="text-[13px] text-slate-500 mt-1">
            Audit results from the Hermes Agent — draft BLs compared against CI + PL. Authorize the correction email or dismiss it from here.
          </p>
        </div>
        <Button
          variant="secondary" size="sm"
          onClick={() => audits.refetch()}
          disabled={audits.isFetching}
          className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616] h-8 px-3 text-[12px]"
        >
          <RefreshCw size={13} className={`mr-1.5 ${audits.isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-500 uppercase tracking-wider mr-1">Status</span>
            <Pill active={statusFilter === 'ALL'} onClick={() => setStatusFilter('ALL')} label="All" count={audits.data?.length ?? null} />
            <Pill active={statusFilter === 'red'} onClick={() => setStatusFilter('red')} label={<><ShieldAlert size={11} className="inline -mt-0.5 mr-1 text-rose-400" /> Red</>} count={totals.red} tone="danger" />
            <Pill active={statusFilter === 'yellow'} onClick={() => setStatusFilter('yellow')} label={<><AlertTriangle size={11} className="inline -mt-0.5 mr-1 text-amber-400" /> Yellow</>} count={totals.yellow} tone="warning" />
            <Pill active={statusFilter === 'pending'} onClick={() => setStatusFilter('pending')} label="Pending" count={totals.pending} tone="info" />
            <Pill active={statusFilter === 'broken_linkage'} onClick={() => setStatusFilter('broken_linkage')} label="Broken linkage" count={totals.broken_linkage} tone="warning" />
            <Pill active={statusFilter === 'green'} onClick={() => setStatusFilter('green')} label="Green" count={totals.green} tone="success" />
            <Pill active={statusFilter === 'resolved'} onClick={() => setStatusFilter('resolved')} label="Resolved" count={totals.resolved} tone="success" />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500 uppercase tracking-wider mr-1">Audited</span>
              {(['today', '7d', '30d', 'all'] as const).map(opt => (
                <Pill key={opt} active={since === opt} onClick={() => setSince(opt)} label={SINCE_LABEL[opt]} count={null} />
              ))}
            </div>

            <div className="flex-1 min-w-[240px]">
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="BL #, deal, or carrier"
                className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 w-full"
              />
            </div>
          </div>
        </CardBody>
      </Card>

      {audits.isLoading ? (
        <Card><CardBody><Skeleton className="h-40 w-full" /></CardBody></Card>
      ) : audits.error ? (
        <Card><CardBody>
          <div className="text-rose-400 text-[12.5px]">
            Could not load: {String(audits.error)}{' '}
            <button onClick={() => audits.refetch()} className="underline">Retry</button>
          </div>
        </CardBody></Card>
      ) : rows.length === 0 ? (
        <Card><CardBody>
          <EmptyState
            title="No audits in scope"
            description="Loosen the filters above, or wait for Hermes to drop in fresh audits."
          />
        </CardBody></Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>BL audits</CardTitle>
            <Badge variant="neutral" dot>{rows.length}</Badge>
            <span className="text-[11.5px] text-slate-500">red first · newest within each bucket</span>
          </CardHeader>
          <CardBody className="p-0">
            <DataTable<BlAudit>
              columns={columns}
              rows={rows}
              getRowId={r => r.bl_number}
              onRowClick={r => setOpenBl(r.bl_number)}
            />
          </CardBody>
        </Card>
      )}

      <BlAuditModal
        row={openRow}
        onClose={() => setOpenBl(null)}
        onAuthorize={onAuthorize}
        onDismiss={onDismiss}
        onSaveBody={saveEditedBody}
        onApplyCorrection={onApplyCorrection}
        busy={patch.isPending}
      />
    </div>
  );
};

const Pill: React.FC<{
  active?: boolean;
  onClick: () => void;
  label: React.ReactNode;
  count: number | null;
  tone?: 'success' | 'danger' | 'info' | 'warning';
}> = ({ active, onClick, label, count, tone }) => (
  <button
    type="button"
    onClick={onClick}
    className={[
      'inline-flex items-center gap-1.5 h-7 px-2.5 text-[11.5px] rounded-md border transition-colors',
      active
        ? 'bg-indigo-600/15 text-indigo-200 border-indigo-500/40'
        : 'bg-[#0f0f0f] text-slate-400 border-[#1f1f1f] hover:text-slate-200 hover:border-[#2a2a2a]',
    ].join(' ')}
  >
    <span>{label}</span>
    {count != null && count > 0 && (
      <span className={[
        'px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums',
        tone === 'danger'  ? 'bg-rose-500/15 text-rose-300' :
        tone === 'warning' ? 'bg-amber-500/15 text-amber-300' :
        tone === 'success' ? 'bg-emerald-500/15 text-emerald-300' :
        tone === 'info'    ? 'bg-indigo-500/15 text-indigo-300' :
                              'bg-[#1a1a1a] text-slate-500',
      ].join(' ')}>{count}</span>
    )}
  </button>
);

// ── Detail modal ───────────────────────────────────────────────────

const DEFAULT_BODY = `Hi,

Please find our findings on the draft BL below. Two fields need correcting before the BL is finalised. Let us know once a revised copy is ready.

Thanks.`;

/**
 * If CI or PL has a missing field that's filled on the other doc, suggest
 * cross-filling. Returns null when no auto-suggestion is possible (e.g. a
 * BL-side mismatch — that requires emailing the carrier instead).
 */
function suggestionFor(iss: BlAuditIssue): { doc: 'CI' | 'PL'; value: string } | null {
  if (!iss.ci && iss.pl) return { doc: 'CI', value: iss.pl };
  if (!iss.pl && iss.ci) return { doc: 'PL', value: iss.ci };
  return null;
}

function isApplied(applied: AppliedCorrection[], field: string, doc: 'CI' | 'PL'): boolean {
  return applied.some(a => a.field === field && a.doc === doc);
}

const BlAuditModal: React.FC<{
  row: BlAudit | null;
  onClose: () => void;
  onAuthorize: (row: BlAudit, opts?: { editBody?: string }) => void;
  onDismiss: (row: BlAudit) => void;
  onSaveBody: (row: BlAudit, body: string) => void;
  onApplyCorrection: (row: BlAudit, correction: AppliedCorrection) => void;
  busy: boolean;
}> = ({ row, onClose, onAuthorize, onDismiss, onSaveBody, onApplyCorrection, busy }) => {
  const [body, setBody] = useState('');
  const [dirty, setDirty] = useState(false);

  React.useEffect(() => {
    if (!row) return;
    const initial = row.correction_edit_body ?? DEFAULT_BODY;
    setBody(initial);
    setDirty(false);
  }, [row?.bl_number]);

  if (!row) return null;
  const canAct = row.status === 'red' && !row.correction_authorized && !row.correction_dismissed;
  const carrier = row.correction_carrier ?? 'carrier';
  const applied = row.applied_corrections ?? [];

  return (
    <Modal
      open={!!row}
      onClose={onClose}
      className="!w-[min(96vw,1100px)] !max-h-[92vh] !bg-[#0a0a0a] !text-slate-200 !border !border-[#1f1f1f] !p-0"
    >
      {/* Modal header */}
      <div className="px-5 pt-5 pb-3 border-b border-[#1f1f1f] flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-slate-100 flex items-center gap-2">
            <StatusIcon s={row.status} size={16} />
            <span className="font-mono">{row.bl_number}</span>
            {row.deal_name && <span className="text-slate-500">·</span>}
            {row.deal_name && <span className="text-slate-300 truncate">{row.deal_name}</span>}
          </div>
          <div className="mt-1 text-[11.5px] text-slate-500">
            Audited {relativeAgo(row.audited_at)} by Hermes · {carrier} · {row.company ?? 'unknown company'}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-200 transition-colors rounded p-1"
          aria-label="Close"
        >
          <XIcon size={16} />
        </button>
      </div>

      {/* Modal body */}
      <div className="px-5 py-4 space-y-5 overflow-auto" style={{ maxHeight: 'calc(92vh - 180px)' }}>
        {/* Status strip */}
        <div className="flex items-center gap-2 flex-wrap p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
          <Badge variant={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
          {row.hold_risk_count > 0 && <Badge variant="danger">{row.hold_risk_count} hold-risk</Badge>}
          {row.warn_count > 0 && <Badge variant="warning">{row.warn_count} warnings</Badge>}
          {row.correction_authorized && <Badge variant="info" title="Hermes will dispatch when it next polls.">authorized</Badge>}
          {row.correction_dismissed && <Badge variant="neutral">dismissed</Badge>}
          {applied.length > 0 && <Badge variant="success">{applied.length} correction{applied.length !== 1 ? 's' : ''} applied</Badge>}
          {row.correction_email_sent_at && (
            <span className="text-[11.5px] text-slate-500 flex items-center gap-1">
              <Clock size={11} /> sent {relativeAgo(row.correction_email_sent_at)}
            </span>
          )}
          {row.resolved_at && (
            <span className="text-[11.5px] text-emerald-300 flex items-center gap-1">
              <CheckCircle2 size={11} /> resolved {relativeAgo(row.resolved_at)}
            </span>
          )}
        </div>

        {/* Issues */}
        <Section title={`Issues found (${row.issues_json.length})`}>
          {row.issues_json.length === 0 ? (
            <div className="text-[12.5px] text-slate-500 italic">
              No discrepancies — Hermes found CI, PL, and BL consistent.
            </div>
          ) : (
            <div className="rounded-md border border-[#1f1f1f] overflow-hidden">
              <table className="w-full text-[11.5px]">
                <thead className="bg-[#0a0a0a] text-slate-500">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-medium uppercase tracking-wider w-[70px]">Severity</th>
                    <th className="text-left px-2 py-1.5 font-medium uppercase tracking-wider w-[120px]">Field</th>
                    <th className="text-left px-2 py-1.5 font-medium uppercase tracking-wider w-[100px]">CI</th>
                    <th className="text-left px-2 py-1.5 font-medium uppercase tracking-wider w-[100px]">PL</th>
                    <th className="text-left px-2 py-1.5 font-medium uppercase tracking-wider w-[100px]">BL</th>
                    <th className="text-left px-2 py-1.5 font-medium uppercase tracking-wider">Note</th>
                    <th className="text-right px-2 py-1.5 font-medium uppercase tracking-wider w-[180px]">Suggested correction</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1a1a1a] bg-[#0f0f0f]">
                  {row.issues_json.map((iss, i) => (
                    <IssueRow
                      key={i}
                      iss={iss}
                      suggestion={suggestionFor(iss)}
                      applied={isApplied(applied, iss.field, suggestionFor(iss)?.doc ?? 'CI')}
                      onApprove={() => {
                        const sug = suggestionFor(iss);
                        if (!sug) return;
                        onApplyCorrection(row, {
                          field: iss.field, doc: sug.doc,
                          old_value: sug.doc === 'CI' ? iss.ci : iss.pl,
                          new_value: sug.value,
                          approved_at: new Date().toISOString(),
                        });
                      }}
                      busy={busy}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* Inline email draft — only when there are BL-side issues that need carrier action */}
        {row.status === 'red' && (
          <Section title="Email to BL issuer">
            <div className="space-y-2">
              <div className="text-[11.5px] text-slate-500">
                To: <span className="text-slate-300">{carrier}</span> · Subject: <span className="text-slate-300 font-mono">{row.bl_number} — Draft BL corrections needed</span>
              </div>
              <textarea
                value={body}
                onChange={e => { setBody(e.target.value); setDirty(true); }}
                rows={9}
                className="w-full rounded-md border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2 text-[12.5px] text-slate-200 leading-relaxed font-mono whitespace-pre-wrap resize-y focus:outline-none focus:border-indigo-500"
                disabled={!canAct}
              />
              {!canAct && (
                <div className="text-[11px] text-slate-500 italic">
                  {row.correction_authorized && 'Already authorized — Hermes will send (or has sent).'}
                  {row.correction_dismissed && 'Marked as dismissed — no email will be sent.'}
                  {row.status !== 'red' && row.status !== 'pending' && `Status is "${STATUS_LABEL[row.status]}" — no correction email needed.`}
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Audit-trail footer info */}
        <div className="pt-2 border-t border-[#1f1f1f] text-[11px] text-slate-500 flex items-center gap-3 flex-wrap">
          <Badge variant="neutral">bl_audits</Badge>
          {row.report_log_path && (
            <span className="font-mono tabular-nums truncate" title={row.report_log_path}>log: {row.report_log_path}</span>
          )}
          {row.last_carrier_reply_at && (
            <span>Carrier replied {relativeAgo(row.last_carrier_reply_at)}</span>
          )}
        </div>
      </div>

      {/* Modal footer — action bar */}
      <div className="px-5 py-3 border-t border-[#1f1f1f] bg-[#0d0d0d] flex items-center gap-2 flex-wrap">
        <Button
          size="sm" variant="secondary"
          onClick={onClose}
          className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
        >
          Close
        </Button>
        {canAct && (
          <>
            <Button
              size="sm" variant="secondary"
              onClick={() => onDismiss(row)}
              disabled={busy}
              className="bg-transparent border border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
            >
              <XIcon size={13} className="mr-1.5" /> Dismiss
            </Button>
            {dirty && (
              <Button
                size="sm" variant="secondary"
                onClick={() => { onSaveBody(row, body); setDirty(false); }}
                disabled={busy}
                className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
              >
                <Pencil size={13} className="mr-1.5" /> Save edited body
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => onAuthorize(row, dirty ? { editBody: body } : undefined)}
              disabled={busy}
              loading={busy}
              className="ml-auto bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              <Send size={13} className="mr-1.5" />
              Email correction to issuer
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="space-y-2">
    <div className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">{title}</div>
    {children}
  </div>
);

const IssueRow: React.FC<{
  iss: BlAuditIssue;
  suggestion: { doc: 'CI' | 'PL'; value: string } | null;
  applied: boolean;
  onApprove: () => void;
  busy: boolean;
}> = ({ iss, suggestion, applied, onApprove, busy }) => {
  const sev = iss.severity === 'red' ? 'danger' : 'warning';
  const cell = (v: string | null, highlight?: 'CI' | 'PL') => {
    if (v) return <span className="font-mono tabular-nums text-slate-200">{v}</span>;
    // Missing AND we have a suggestion for this column → render the suggested value in green
    if (suggestion && suggestion.doc === highlight) {
      return (
        <span className="font-mono tabular-nums text-emerald-400" title="ERP-suggested correction (not yet applied)">
          {suggestion.value}
          <span className="text-emerald-500/70 ml-1">↩</span>
        </span>
      );
    }
    return <span className="text-slate-600 italic">missing</span>;
  };

  return (
    <tr>
      <td className="px-2 py-1.5"><Badge variant={sev}>{iss.severity === 'red' ? 'RED' : 'WARN'}</Badge></td>
      <td className="px-2 py-1.5 text-slate-100" title={iss.field}>{fieldLabel(iss.field)}</td>
      <td className="px-2 py-1.5">{cell(iss.ci, 'CI')}</td>
      <td className="px-2 py-1.5">{cell(iss.pl, 'PL')}</td>
      <td className="px-2 py-1.5">{cell(iss.bl)}</td>
      <td className="px-2 py-1.5 text-slate-300">
        <div className="flex items-start gap-1.5">
          {iss.severity === 'red' && <AlertTriangle size={11} className="text-rose-400 shrink-0 mt-0.5" />}
          <span>{iss.note}</span>
        </div>
      </td>
      <td className="px-2 py-1.5 text-right">
        {applied ? (
          <Badge variant="success" title="Saved to bl_audits.applied_corrections">
            <CheckCircle2 size={10} className="mr-1 inline" />Applied to {suggestion?.doc}
          </Badge>
        ) : suggestion ? (
          <div className="flex items-center gap-1 justify-end">
            <Button
              size="sm" variant="secondary"
              onClick={onApprove}
              disabled={busy}
              className="bg-emerald-600/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/25 px-2 py-0.5 text-[11px]"
              title={`Approve: set ${iss.field} = ${suggestion.value} on ${suggestion.doc}`}
            >
              ✓ Approve
            </Button>
            <Button
              size="sm" variant="secondary"
              onClick={() => { /* reject = no-op for now; suggestion just stays unapplied */ }}
              disabled={busy}
              className="bg-transparent border border-[#1f1f1f] text-slate-500 hover:bg-[#161616] px-2 py-0.5 text-[11px]"
              title="Reject — leave field as-is"
            >
              ✗
            </Button>
          </div>
        ) : (
          <span className="text-[10.5px] text-slate-600 italic">email carrier</span>
        )}
      </td>
    </tr>
  );
};

export default DocumentAuditV2;
