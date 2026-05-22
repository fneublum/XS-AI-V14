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
  Card, CardHeader, CardTitle, CardBody, Badge, Button, Input, Skeleton, EmptyState, Drawer,
} from '../primitives';
import { useToast } from '../primitives/Toast';
import { DataTable, DataTableColumn } from '../primitives/DataTable';
import { useBlAudits, useBlAuditPatch, type BlAudit, type BlAuditStatus, type BlAuditIssue } from '../queries/useBlAudits';
import { formatDate as fmtDate } from '../lib/formatDate';

const STATUS_LABEL: Record<BlAuditStatus, string> = {
  green: 'Green',
  red: 'Red',
  pending: 'Pending',
  broken_linkage: 'Broken linkage',
  resolved: 'Resolved',
};

const STATUS_TONE: Record<BlAuditStatus, 'success' | 'danger' | 'info' | 'warning' | 'neutral'> = {
  green: 'success',
  red: 'danger',
  pending: 'info',
  broken_linkage: 'warning',
  resolved: 'success',
};

// Sort priority for status — red first (act now), then broken / pending,
// then resolved / green at the bottom.
const STATUS_RANK: Record<BlAuditStatus, number> = {
  red: 0, broken_linkage: 1, pending: 2, resolved: 3, green: 4,
};

const StatusIcon: React.FC<{ s: BlAuditStatus; size?: number }> = ({ s, size = 13 }) => {
  if (s === 'red') return <ShieldAlert size={size} className="text-rose-400" />;
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
  const [companyFilter, setCompanyFilter] = useState<string | 'ALL'>('ALL');
  const [since, setSince] = useState<SinceFilter>('all');
  const [search, setSearch] = useState('');
  const [openBl, setOpenBl] = useState<string | null>(null);

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
    const t = { red: 0, pending: 0, broken_linkage: 0, green: 0, resolved: 0 };
    for (const r of audits.data ?? []) {
      if (r.status in t) (t as Record<string, number>)[r.status]++;
    }
    return t;
  }, [audits.data]);

  const companies = useMemo(() => {
    const s = new Set<string>();
    for (const r of audits.data ?? []) if (r.company) s.add(r.company);
    return [...s].sort();
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
      id: 'deal_name', header: 'Deal', sortable: true, filterable: true,
      value: r => r.deal_name ?? '',
      cell: r => <span className="text-slate-300">{r.deal_name ?? '—'}</span>,
    },
    {
      id: 'company', header: 'Company', sortable: true, filterable: true,
      value: r => r.company ?? '',
      cell: r => r.company
        ? <Badge variant="neutral">{r.company}</Badge>
        : <span className="text-slate-600">—</span>,
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
      id: 'correction_carrier', header: 'Carrier', sortable: true, filterable: true,
      value: r => r.correction_carrier ?? '',
      cell: r => r.correction_carrier
        ? <span className="text-slate-400 text-[11.5px]">{r.correction_carrier}</span>
        : <span className="text-slate-700">—</span>,
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
            <Pill active={statusFilter === 'pending'} onClick={() => setStatusFilter('pending')} label="Pending" count={totals.pending} tone="info" />
            <Pill active={statusFilter === 'broken_linkage'} onClick={() => setStatusFilter('broken_linkage')} label="Broken linkage" count={totals.broken_linkage} tone="warning" />
            <Pill active={statusFilter === 'green'} onClick={() => setStatusFilter('green')} label="Green" count={totals.green} tone="success" />
            <Pill active={statusFilter === 'resolved'} onClick={() => setStatusFilter('resolved')} label="Resolved" count={totals.resolved} tone="success" />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500 uppercase tracking-wider mr-1">Company</span>
              <Pill active={companyFilter === 'ALL'} onClick={() => setCompanyFilter('ALL')} label="All" count={null} />
              {companies.map(c => (
                <Pill key={c} active={companyFilter === c} onClick={() => setCompanyFilter(c)} label={c} count={null} />
              ))}
            </div>

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

      <BlAuditDrawer
        row={openRow}
        onOpenChange={(o) => !o && setOpenBl(null)}
        onAuthorize={onAuthorize}
        onDismiss={onDismiss}
        onSaveBody={saveEditedBody}
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

// ── Detail drawer ──────────────────────────────────────────────────

const DEFAULT_BODY = `Hi,

Please find our findings on the draft BL below. Two fields need correcting before the BL is finalised. Let us know once a revised copy is ready.

Thanks.`;

const BlAuditDrawer: React.FC<{
  row: BlAudit | null;
  onOpenChange: (open: boolean) => void;
  onAuthorize: (row: BlAudit, opts?: { editBody?: string }) => void;
  onDismiss: (row: BlAudit) => void;
  onSaveBody: (row: BlAudit, body: string) => void;
  busy: boolean;
}> = ({ row, onOpenChange, onAuthorize, onDismiss, onSaveBody, busy }) => {
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

  return (
    <Drawer
      open={!!row}
      onOpenChange={onOpenChange}
      title={`${row.bl_number}${row.deal_name ? ' · ' + row.deal_name : ''}`}
      description={`Audited ${relativeAgo(row.audited_at)} by Hermes · ${carrier} · ${row.company ?? 'unknown company'}`}
      footer={
        <>
          <Button
            size="sm" variant="secondary"
            onClick={() => onOpenChange(false)}
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
                {dirty ? 'Save & authorize' : 'Authorize correction'}
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="space-y-5">
        {/* Header strip */}
        <div className="flex items-center gap-2 flex-wrap p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
          <StatusIcon s={row.status} size={16} />
          <Badge variant={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
          {row.hold_risk_count > 0 && (
            <Badge variant="danger">{row.hold_risk_count} hold-risk</Badge>
          )}
          {row.warn_count > 0 && (
            <Badge variant="warning">{row.warn_count} warnings</Badge>
          )}
          {row.correction_authorized && (
            <Badge variant="info" title="Hermes will dispatch when it next polls.">authorized</Badge>
          )}
          {row.correction_dismissed && (
            <Badge variant="neutral">dismissed</Badge>
          )}
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
                    <th className="text-left px-2 py-1.5 font-medium uppercase tracking-wider w-[80px]">Severity</th>
                    <th className="text-left px-2 py-1.5 font-medium uppercase tracking-wider w-[120px]">Field</th>
                    <th className="text-left px-2 py-1.5 font-medium uppercase tracking-wider w-[140px]">CI</th>
                    <th className="text-left px-2 py-1.5 font-medium uppercase tracking-wider w-[140px]">PL</th>
                    <th className="text-left px-2 py-1.5 font-medium uppercase tracking-wider w-[140px]">BL</th>
                    <th className="text-left px-2 py-1.5 font-medium uppercase tracking-wider">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1a1a1a] bg-[#0f0f0f]">
                  {row.issues_json.map((iss, i) => (
                    <IssueRow key={i} iss={iss} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* Correction email editor */}
        {row.status === 'red' && (
          <Section title="Correction email draft">
            <div className="space-y-2">
              <div className="text-[11.5px] text-slate-500">
                To: <span className="text-slate-300">{carrier}</span> · Subject: <span className="text-slate-300 font-mono">{row.bl_number} — Draft BL corrections needed</span>
              </div>
              <textarea
                value={body}
                onChange={e => { setBody(e.target.value); setDirty(true); }}
                rows={10}
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

        {/* Footer info */}
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
    </Drawer>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="space-y-2">
    <div className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">{title}</div>
    {children}
  </div>
);

const IssueRow: React.FC<{ iss: BlAuditIssue }> = ({ iss }) => {
  const sev = iss.severity === 'red' ? 'danger' : 'warning';
  const cell = (v: string | null) => v ? <span className="font-mono tabular-nums text-slate-200">{v}</span> : <span className="text-slate-600 italic">missing</span>;
  return (
    <tr>
      <td className="px-2 py-1.5">
        <Badge variant={sev}>{iss.severity === 'red' ? 'RED' : 'WARN'}</Badge>
      </td>
      <td className="px-2 py-1.5 text-slate-100 font-mono">{iss.field}</td>
      <td className="px-2 py-1.5">{cell(iss.ci)}</td>
      <td className="px-2 py-1.5">{cell(iss.pl)}</td>
      <td className="px-2 py-1.5">{cell(iss.bl)}</td>
      <td className="px-2 py-1.5 text-slate-300">
        <div className="flex items-start gap-1.5">
          {iss.severity === 'red' && <AlertTriangle size={11} className="text-rose-400 shrink-0 mt-0.5" />}
          <span>{iss.note}</span>
        </div>
      </td>
    </tr>
  );
};

export default DocumentAuditV2;
