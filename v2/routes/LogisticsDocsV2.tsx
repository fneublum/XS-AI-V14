// Phase 3B — v2 Logistics Docs (union view).

import React, { useState } from 'react';
import { Badge } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { useLogisticsDocs, LogisticsDoc } from '../queries/useLogisticsDocs';
import { useToast } from '../primitives/Toast';

const kindLabel: Record<LogisticsDoc['kind'], string> = {
  BL: 'Bill of Lading',
  PL: 'Packing List',
  FQ: 'Freight Quote',
  BK: 'Booking',
};

const kindTone: Record<LogisticsDoc['kind'], 'info' | 'success' | 'warning' | 'neutral'> = {
  BL: 'info',
  PL: 'success',
  FQ: 'warning',
  BK: 'neutral',
};

const fmtDate = (iso: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: '2-digit' });
};

const columns: DataTableColumn<LogisticsDoc>[] = [
  { id: 'kind', header: 'Type', cell: r => (
      <Badge variant={kindTone[r.kind]} dot>{kindLabel[r.kind]}</Badge>
    ) },
  { id: 'ref',  header: 'Reference', mono: true, cell: r => r.reference },
  { id: 'subj', header: 'Subject', cell: r => (
      <span className="text-slate-100">{r.subject}</span>
    ) },
  { id: 'created', header: 'Added', align: 'right', cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.createdAt)}
      </span>
    ) },
];

const LogisticsDocsV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const toast = useToast();
  const docs = useLogisticsDocs(search);

  return (
    <ListPage<LogisticsDoc>
      title="Logistics Docs"
      subtitle={
        docs.data
          ? `${docs.data.length} documents${search ? ` · "${search}"` : ''} · union of B/L, PL, FQ, Booking PDFs`
          : 'Loading…'
      }
      search={search}
      setSearch={setSearch}
      searchPlaceholder="Reference, subject, kind"
      cardTitle="All documents"
      columns={columns}
      getRowId={r => r.id}
      data={docs.data}
      isLoading={docs.isLoading}
      error={docs.error}
      onRetry={docs.refetch}
      onRowClick={r => {
        if (r.url) {
          window.open(r.url, '_blank', 'noopener,noreferrer');
        } else {
          toast.push({ kind: 'warning', title: 'No URL on this record', description: r.reference });
        }
      }}
      skeletonCols={[120, 140, 240, 60]}
    />
  );
};

export default LogisticsDocsV2;
