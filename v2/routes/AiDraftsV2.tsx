// AI Drafts inbox — single triage screen for every PL/CI row Hermes
// auto-ingested. Filter by source (PL/CI) + free-text search; Approve /
// Reject inline.
//
// Pairs with the ai_status column on packing_lists + invoices (migration
// 20260522170000_ai_ingestion_and_bl_drift.sql). Once a user approves a
// draft here, the row flips to ai_status='approved' and stops appearing
// in this list.

import React, { useMemo, useState } from 'react';
import { Sparkles, Check, X, ExternalLink, Eye } from 'lucide-react';
import { Badge, Button, EmptyState, Skeleton } from '../primitives';
import { DataTable, DataTableColumn } from '../primitives/DataTable';
import { useToast } from '../primitives/Toast';
import { useAiDrafts, type AiDraft, type AiDraftSource } from '../queries/useAiDrafts';
import { useAiDraftAction } from '../queries/useAiDraftActions';
import { formatDate as fmtDate } from '../lib/formatDate';
import { shortName, tooltipName } from '../lib/formatName';

type SourceFilter = 'ALL' | AiDraftSource;

const AiDraftsV2: React.FC = () => {
  const toast = useToast();
  const drafts = useAiDrafts();
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('ALL');
  const [search, setSearch] = useState('');

  const action = useAiDraftAction({
    onSuccess: () => toast.push({ kind: 'success', title: 'Draft decision saved' }),
  });

  const filtered = useMemo(() => {
    const all = drafts.data ?? [];
    const needle = search.trim().toLowerCase();
    return all.filter(d => {
      if (sourceFilter !== 'ALL' && d.source !== sourceFilter) return false;
      if (!needle) return true;
      return (
        d.docNumber.toLowerCase().includes(needle) ||
        (d.shipper ?? '').toLowerCase().includes(needle) ||
        (d.consignee ?? '').toLowerCase().includes(needle)
      );
    });
  }, [drafts.data, sourceFilter, search]);

  const counts = useMemo(() => {
    const all = drafts.data ?? [];
    return {
      ALL: all.length,
      PL: all.filter(d => d.source === 'PL').length,
      CI: all.filter(d => d.source === 'CI').length,
    };
  }, [drafts.data]);

  const columns: DataTableColumn<AiDraft>[] = [
    {
      id: 'source', header: 'Source', sortable: true, filterable: true,
      value: r => r.source,
      cell: r => (
        <Badge variant={r.source === 'PL' ? 'info' : 'warning'}>
          <Sparkles size={9} className="inline -mt-0.5 mr-1" />
          {r.source}
        </Badge>
      ),
    },
    {
      id: 'doc', header: 'Doc #', mono: true, sortable: true, filterable: true,
      value: r => r.docNumber,
      cell: r => r.docNumber,
    },
    {
      id: 'shipper', header: 'Shipper', sortable: true, filterable: true,
      value: r => r.shipper ?? '',
      cell: r => (
        <span className="text-slate-100" title={tooltipName(r.shipper)}>
          {shortName(r.shipper) || '—'}
        </span>
      ),
    },
    {
      id: 'consignee', header: 'Consignee', sortable: true, filterable: true,
      value: r => r.consignee ?? '',
      cell: r => (
        <span className="text-slate-100" title={tooltipName(r.consignee)}>
          {shortName(r.consignee) || '—'}
        </span>
      ),
    },
    {
      id: 'date', header: 'Doc date', align: 'right', sortable: true,
      value: r => r.date ?? '',
      cell: r => (
        <span className="text-slate-500 font-mono tabular-nums text-[11px]">
          {fmtDate(r.date)}
        </span>
      ),
    },
    {
      id: 'extractedAt', header: 'Extracted', align: 'right', sortable: true,
      value: r => r.extractedAt ?? '',
      cell: r => (
        <span className="text-slate-500 font-mono tabular-nums text-[11px]">
          {fmtDate(r.extractedAt)}
        </span>
      ),
    },
    {
      id: 'source_pdf', header: 'Source PDF', sortable: false, align: 'center',
      value: r => r.sourcePdfPath ? '1' : '',
      cell: r => r.sourcePdfPath
        ? (
            <a
              href={`file://${encodeURI(r.sourcePdfPath)}`}
              target="_blank" rel="noreferrer"
              onClick={e => e.stopPropagation()}
              title={r.sourcePdfPath}
              className="inline-flex items-center text-slate-400 hover:text-indigo-300"
            >
              <ExternalLink size={12} />
            </a>
          )
        : <span className="text-slate-700">—</span>,
    },
    {
      id: 'actions', header: 'Actions', sortable: false, align: 'right',
      value: () => '',
      cell: r => (
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            onClick={() => action.mutate({
              table: r.source === 'PL' ? 'packing_lists' : 'invoices',
              rowId: r.id,
              decision: 'approve',
            })}
            disabled={action.isPending}
            className="bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 h-6 px-2 text-[11px] font-medium rounded-sm inline-flex items-center gap-1"
            title="Approve — flip to live data"
          >
            <Check size={11} />Approve
          </Button>
          <Button
            size="sm"
            onClick={() => action.mutate({
              table: r.source === 'PL' ? 'packing_lists' : 'invoices',
              rowId: r.id,
              decision: 'reject',
            })}
            disabled={action.isPending}
            className="bg-red-500/15 border border-red-500/40 text-red-300 hover:bg-red-500/25 h-6 px-2 text-[11px] font-medium rounded-sm inline-flex items-center gap-1"
            title="Reject — mark as dismissed"
          >
            <X size={11} />Reject
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="bento-scope h-full flex flex-col p-4 gap-4">
      {/* PAGE HEADER */}
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        <Sparkles size={18} style={{ color: 'var(--b-gold)' }} />
        <span className="block w-1 h-9 rounded-full mr-0.5" style={{ background: 'var(--b-teal-2)' }} />
        <h1 className="b-display font-semibold leading-none" style={{ color: 'var(--b-text)', fontSize: '32px', fontVariationSettings: "'opsz' 64, 'wght' 600", letterSpacing: '-0.02em' }}>
          AI Drafts
        </h1>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium b-mono"
              style={{ background: 'var(--b-teal-soft)', color: 'var(--b-teal-2)' }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'currentColor' }} />
          Hermes
        </span>
        <span className="ml-auto" />
        <button
          onClick={() => drafts.refetch()}
          disabled={drafts.isFetching}
          className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full transition-colors disabled:opacity-50"
          style={{ background: 'var(--b-surface)', color: 'var(--b-text-soft)', border: '1px solid var(--b-line)' }}
        >
          Refresh
        </button>
      </div>

      {/* BLURB */}
      <p className="text-[13px] -mt-1 shrink-0" style={{ color: 'var(--b-text-mute)' }}>
        Packing lists + commercial invoices auto-extracted from supplier
        emails. Review the fields, then Approve to flip into live data — or
        Reject if the extraction is wrong.
      </p>

      {/* DATA CARD */}
      <div
        className="flex-1 min-h-0 flex flex-col rounded-[18px] border overflow-hidden"
        style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)' }}
      >
        <div className="shrink-0 px-5 py-3.5 border-b" style={{ borderColor: 'var(--b-line-soft)' }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10.5px] uppercase tracking-[0.14em] mr-1" style={{ color: 'var(--b-text-mute)' }}>Source</span>
            <div className="flex items-center gap-1 p-1 rounded-full" style={{ background: 'var(--b-surface-2)', border: '1px solid var(--b-line)' }}>
              {(['ALL', 'PL', 'CI'] as SourceFilter[]).map(s => (
                <button
                  key={s}
                  onClick={() => setSourceFilter(s)}
                  className="px-3 py-1 rounded-full text-[12px] font-medium transition-colors flex items-center gap-1.5"
                  style={{
                    background: sourceFilter === s ? 'var(--b-teal-2)' : 'transparent',
                    color: sourceFilter === s ? 'white' : 'var(--b-text-mute)',
                  }}
                >
                  {s === 'ALL' ? 'All' : s}
                  <span className="b-mono text-[10.5px]" style={{ opacity: 0.8 }}>{counts[s]}</span>
                </button>
              ))}
            </div>
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Doc #, shipper, consignee"
              className="ml-auto h-7 text-[12px] rounded-full px-3 outline-none focus:ring-2 w-72"
              style={{ background: 'var(--b-page)', border: '1px solid var(--b-line)', color: 'var(--b-text)' }}
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
          {drafts.isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton width={60} height={14} />
                  <Skeleton width={100} height={14} />
                  <Skeleton width={180} height={14} />
                  <Skeleton width={180} height={14} />
                  <Skeleton width={80} height={14} className="ml-auto" />
                </div>
              ))}
            </div>
          ) : drafts.error ? (
            <EmptyState
              tone="danger"
              title="Couldn't load AI drafts"
              description={drafts.error.message}
              action={{ label: 'Retry', onClick: () => drafts.refetch() }}
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              title={search || sourceFilter !== 'ALL' ? 'No matches' : 'Inbox empty'}
              description={
                search || sourceFilter !== 'ALL'
                  ? `Nothing matched the current filter.`
                  : 'Hermes will surface auto-extracted PL/CI rows here as supplier emails land. The ingestion cron runs every 30 minutes.'
              }
            />
          ) : (
            <DataTable
              columns={columns}
              rows={filtered}
              getRowId={r => `${r.source}:${r.id}`}
              zebra
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default AiDraftsV2;
