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
import { Badge, Button, Card, CardBody, EmptyState, Skeleton } from '../primitives';
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
    <div className="h-full flex flex-col max-w-6xl">
      <div className="flex items-baseline justify-between mb-4 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-amber-400" />
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">
              AI Drafts
            </h1>
            <Badge variant="info">Hermes</Badge>
          </div>
          <p className="text-[13px] text-slate-500 mt-1">
            Packing lists + commercial invoices auto-extracted from supplier
            emails. Review the fields, then Approve to flip into live data —
            or Reject if the extraction is wrong.
          </p>
        </div>
        <Button
          variant="secondary" size="sm"
          onClick={() => drafts.refetch()}
          disabled={drafts.isFetching}
          className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616] h-8 px-3 text-[12px]"
        >
          Refresh
        </Button>
      </div>

      <Card className="flex-1 min-h-0 flex flex-col">
        <CardBody className="shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-slate-500 uppercase tracking-wider mr-1">Source</span>
            {(['ALL', 'PL', 'CI'] as SourceFilter[]).map(s => (
              <button
                key={s}
                onClick={() => setSourceFilter(s)}
                className={
                  'h-7 px-2.5 text-[11.5px] font-medium rounded-md border transition-colors ' +
                  (sourceFilter === s
                    ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-200'
                    : 'bg-transparent border-[#1f1f1f] text-slate-400 hover:bg-[#161616]')
                }
              >
                {s === 'ALL' ? 'All' : s}{' '}
                <span className="ml-1 text-slate-500">{counts[s]}</span>
              </button>
            ))}
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Doc #, shipper, consignee"
              className="ml-auto h-7 text-[12px] bg-[#111111] border border-[#1f1f1f] text-slate-200 placeholder:text-slate-500 rounded-md px-2 outline-none focus:ring-1 focus:ring-indigo-500 w-72"
            />
          </div>
        </CardBody>

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
      </Card>
    </div>
  );
};

export default AiDraftsV2;
