// Phase 3B — v2 Packing Lists.

import React, { useState } from 'react';
import { Sparkles, Check, X } from 'lucide-react';
import { Badge, Button } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer } from '../components/QuickCreateDrawer';
import { AiUploadModal } from '../components/AiUploadModal';
import { PackingListBatchUploadModal } from '../components/PackingListBatchUploadModal';
import { useRowCrud } from '../components/useRowCrud';
import { useCompany } from '../providers/CompanyProvider';
import { useToast } from '../primitives/Toast';
import { useEntityInsert } from '../queries/useEntityMutations';
import { EmailComposeDrawer, EmailDraft } from '../components/EmailComposeDrawer';
import { usePackingLists, PackingList } from '../queries/usePackingLists';
import { useAiDraftAction } from '../queries/useAiDraftActions';
import { formatDate as fmtDate } from '../lib/formatDate';
import { shortName, tooltipName } from '../lib/formatName';
import {
  PLDraft, packingListFields, buildPackingListAiUploadConfig,
} from './packingListShared';

type BadgeTone = 'success' | 'info' | 'warning' | 'neutral' | 'danger';
const statusTone = (status: string): BadgeTone => {
  const s = status.toUpperCase();
  if (s.includes('SHIPPED') || s.includes('DELIVER')) return 'success';
  if (s.includes('ISSUED') || s.includes('CONFIRM'))  return 'info';
  if (s.includes('DRAFT') || s.includes('PEND'))      return 'warning';
  if (s.includes('CANCEL'))                           return 'danger';
  return 'neutral';
};

const columns: DataTableColumn<PackingList>[] = [
  { id: 'pl', header: 'PL #', mono: true, sortable: true, filterable: true,
    value: r => r.plNumber,
    cell: r => (
      <span className="inline-flex items-center gap-1.5">
        {r.ai_status === 'ai_draft' && (
          <span
            title="AI-extracted draft — review before approving"
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[9px] font-semibold uppercase tracking-wider"
          >
            <Sparkles size={9} />AI
          </span>
        )}
        {r.plNumber}
      </span>
    ) },
  { id: 'bl', header: 'B/L #', mono: true, sortable: true, filterable: true,
    value: r => r.blNumber ?? '',
    cell: r => <span className="text-slate-500">{r.blNumber ?? '—'}</span> },
  { id: 'so', header: 'SO #', mono: true, sortable: true, filterable: true,
    value: r => r.soNumber ?? '',
    cell: r => <span className="text-slate-500">{r.soNumber ?? '—'}</span> },
  { id: 'consignee', header: 'Consignee', sortable: true, filterable: true,
    value: r => r.consignee ?? '',
    cell: r => <span className="text-slate-100" title={tooltipName(r.consignee)}>{shortName(r.consignee)}</span> },
  { id: 'container', header: 'Container', mono: true, sortable: true, filterable: true,
    value: r => r.containerNumber ?? '', cell: r => r.containerNumber ?? '—' },
  { id: 'carrier', header: 'Carrier', sortable: true, filterable: true,
    value: r => r.carrier ?? '', cell: r => r.carrier ?? '—' },
  { id: 'status', header: 'Status', sortable: true, filterable: true,
    value: r => r.status,
    cell: r => <Badge variant={statusTone(r.status)} dot>{r.status}</Badge> },
  { id: 'ship', header: 'Ship date', align: 'right', sortable: true,
    value: r => r.scheduledShipDate ?? r.date ?? '',
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.scheduledShipDate ?? r.date)}
      </span>
    ) },
];

const PackingListsV2: React.FC = () => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createSeed, setCreateSeed] = useState<Record<string, string> | undefined>(undefined);
  const [aiUploadOpen, setAiUploadOpen] = useState(false);
  const [batchUploadOpen, setBatchUploadOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const pls = usePackingLists(search);
  const aiDecide = useAiDraftAction({
    onSuccess: () => toast.push({ kind: 'success', title: 'Draft decision saved' }),
  });
  const insert = useEntityInsert<Record<string, unknown>>({
    table: 'packing_lists',
    listQueryKeys: ['packingLists', 'logisticsDocs'],
    idPrefix: 'PL',
  });

  const duplicatePL = (row: PackingList) => {
    const { id: _id, plNumber: _pl, date: _date, ...rest } = row as unknown as Record<string, unknown>;
    const seed: Record<string, string> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v == null) continue;
      if (Array.isArray(v)) seed[k] = v.map(String).join(',');
      else seed[k] = String(v);
    }
    setCreateSeed(seed);
    setCreateOpen(true);
  };

  const { rowActions, drawers, openView } = useRowCrud<PackingList>({
    table: 'packing_lists',
    listQueryKeys: ['packingLists', 'logisticsDocs'],
    rowLabel: r => r.plNumber,
    fields: packingListFields,
    onDuplicate: duplicatePL,
    onEmail: (r) => setEmailDraft({
      to: '',
      subject: `Packing List ${r.plNumber}${r.soNumber ? ` — SO ${r.soNumber}` : ''}`,
      body: [
        `Hello${r.consignee ? ' ' + r.consignee : ''},`,
        '',
        `Please find attached the packing list ${r.plNumber}.`,
        r.containerNumber ? `Container: ${r.containerNumber}` : '',
        r.carrier ? `Carrier: ${r.carrier}` : '',
        r.scheduledShipDate ? `Scheduled ship: ${r.scheduledShipDate.slice(0, 10)}` : '',
        '',
        'Best regards',
      ].filter(Boolean).join('\n'),
      contextLabel: `PL ${r.plNumber}`,
    }),
  });

  const openCreate = () => setCreateOpen(true);

  return (
    <>
      <ListPage<PackingList>
        title="Packing Lists"
        subtitle={
          pls.data
            ? `${pls.data.length} shown${search ? ` · "${search}"` : ''}`
            : 'Loading…'
        }
        search={search}
        setSearch={setSearch}
        searchPlaceholder="PL, B/L, consignee"
        columns={columns}
        getRowId={r => r.id}
        data={pls.data}
        isLoading={pls.isLoading}
        error={pls.error}
        onRetry={pls.refetch}
        onRowClick={openView}
        headerAction={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={openCreate}
              className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
              + New packing list
            </Button>
            <Button size="sm" onClick={() => setAiUploadOpen(true)}
              className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/40 text-indigo-200 hover:from-indigo-500/30 hover:to-purple-500/30 h-7 px-2.5 text-[12px] font-medium rounded-md inline-flex items-center gap-1.5">
              <Sparkles size={12} />
              AI Upload
            </Button>
            <Button size="sm" onClick={() => setBatchUploadOpen(true)}
              className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/40 text-indigo-200 hover:from-indigo-500/30 hover:to-purple-500/30 h-7 px-2.5 text-[12px] font-medium rounded-md inline-flex items-center gap-1.5">
              <Sparkles size={12} />
              Batch upload
            </Button>
          </div>
        }
        emptyAction={search ? undefined : { label: '+ New packing list', onClick: openCreate }}
        skeletonCols={[100, 100, 100, 160, 120, 60]}
        rowClassName={r =>
          r.ai_status === 'ai_draft'
            ? '!bg-amber-500/5 border-l-2 border-l-amber-400'
            : r.ai_status === 'rejected'
            ? 'opacity-50'
            : ''
        }
        rowActions={(r) => (
          <div className="flex items-center justify-end gap-1">
            {r.ai_status === 'ai_draft' && (
              <>
                <Button
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); aiDecide.mutate({ table: 'packing_lists', rowId: r.id, decision: 'approve' }); }}
                  className="bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 h-6 px-2 text-[11px] font-medium rounded-sm inline-flex items-center gap-1"
                  title="Approve AI-extracted draft"
                >
                  <Check size={11} />Approve
                </Button>
                <Button
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); aiDecide.mutate({ table: 'packing_lists', rowId: r.id, decision: 'reject' }); }}
                  className="bg-red-500/15 border border-red-500/40 text-red-300 hover:bg-red-500/25 h-6 px-2 text-[11px] font-medium rounded-sm inline-flex items-center gap-1"
                  title="Reject AI-extracted draft"
                >
                  <X size={11} />Reject
                </Button>
              </>
            )}
            {rowActions(r)}
          </div>
        )}
      />
      <QuickCreateDrawer
        open={createOpen}
        onOpenChange={(o) => { setCreateOpen(o); if (!o) setCreateSeed(undefined); }}
        title={createSeed ? 'Duplicate packing list' : 'New packing list'}
        description="Create a packing list for an outgoing shipment."
        table="packing_lists"
        idPrefix="PL"
        listQueryKeys={['packingLists', 'logisticsDocs']}
        scopeByCompany
        fields={packingListFields}
        seed={createSeed}
      />
      {drawers}
      <EmailComposeDrawer
        open={!!emailDraft}
        onOpenChange={(o) => !o && setEmailDraft(null)}
        draft={emailDraft}
      />
      {aiUploadOpen && (
        <AiUploadModal<PLDraft>
          open={aiUploadOpen}
          onOpenChange={setAiUploadOpen}
          config={buildPackingListAiUploadConfig({ insert, toast, currentCompanyId })}
        />
      )}
      <PackingListBatchUploadModal
        open={batchUploadOpen}
        onOpenChange={setBatchUploadOpen}
        insert={insert}
        currentCompanyId={currentCompanyId}
      />
    </>
  );
};

export default PackingListsV2;
