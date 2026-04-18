// Phase 3B — v2 Packing Lists.

import React, { useState } from 'react';
import { Badge, Button } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { useRowCrud } from '../components/useRowCrud';
import { EmailComposeDrawer, EmailDraft } from '../components/EmailComposeDrawer';
import { usePackingLists, PackingList } from '../queries/usePackingLists';

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: '2-digit' });
};

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
    value: r => r.plNumber, cell: r => r.plNumber },
  { id: 'bl', header: 'B/L #', mono: true, sortable: true, filterable: true,
    value: r => r.blNumber ?? '',
    cell: r => <span className="text-slate-500">{r.blNumber ?? '—'}</span> },
  { id: 'so', header: 'SO #', mono: true, sortable: true, filterable: true,
    value: r => r.soNumber ?? '',
    cell: r => <span className="text-slate-500">{r.soNumber ?? '—'}</span> },
  { id: 'consignee', header: 'Consignee', sortable: true, filterable: true,
    value: r => r.consignee ?? '',
    cell: r => <span className="text-slate-100">{r.consignee ?? '—'}</span> },
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

const fields: FieldDef[] = [
  { key: 'plNumber',          label: 'PL #', required: true, mono: true },
  { key: 'soNumber',          label: 'SO #', mono: true },
  { key: 'blNumber',          label: 'B/L #', mono: true },
  { key: 'shipper',           label: 'Shipper' },
  { key: 'consignee',         label: 'Consignee' },
  { key: 'carrier',           label: 'Carrier' },
  { key: 'containerNumber',   label: 'Container', mono: true },
  { key: 'status',            label: 'Status', type: 'select',
    options: ['DRAFT', 'ISSUED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'],
    defaultValue: 'DRAFT' },
  { key: 'scheduledShipDate', label: 'Scheduled ship', type: 'date' },
  { key: 'date',              label: 'Actual ship', type: 'date' },
];

const PackingListsV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const pls = usePackingLists(search);

  const { rowActions, drawers, openView } = useRowCrud<PackingList>({
    table: 'packing_lists',
    listQueryKeys: ['packingLists', 'logisticsDocs'],
    rowLabel: r => r.plNumber,
    fields,
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
        rowActions={rowActions}
        headerAction={
          <Button size="sm" onClick={openCreate}
            className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
            + New packing list
          </Button>
        }
        emptyAction={search ? undefined : { label: '+ New packing list', onClick: openCreate }}
        skeletonCols={[100, 100, 100, 160, 120, 60]}
      />
      <QuickCreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New packing list"
        description="Create a packing list for an outgoing shipment."
        table="packing_lists"
        idPrefix="PL"
        listQueryKeys={['packingLists', 'logisticsDocs']}
        scopeByCompany
        fields={fields}
      />
      {drawers}
      <EmailComposeDrawer
        open={!!emailDraft}
        onOpenChange={(o) => !o && setEmailDraft(null)}
        draft={emailDraft}
      />
    </>
  );
};

export default PackingListsV2;
