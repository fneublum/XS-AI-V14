// Phase 3B — v2 Logistics Docs (union view).
//
// Each row is a virtual id `bl.<uuid>` / `pl.<uuid>` etc. Row actions
// therefore don't operate on a single physical table; we surface
// View (open the PDF) + Delete (deletes from the source table) only.

import React, { useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Badge, Button, ConfirmDialog } from '../primitives';
import { useToast } from '../primitives/Toast';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer } from '../components/QuickCreateDrawer';
import { RowActions } from '../components/RowActions';
import { useLogisticsDocs, LogisticsDoc } from '../queries/useLogisticsDocs';
import { useEntityDelete } from '../queries/useEntityMutations';
import { formatDate as fmtDate } from '../lib/formatDate';

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

// Virtual row id prefix → actual table + matching list query keys to
// invalidate after a delete. Kept here (not in useRowCrud) because
// Logistics Docs is the only page with heterogeneous row sources.
const kindTable: Record<LogisticsDoc['kind'], { table: string; listQueryKeys: string[] }> = {
  BL: { table: 'bill_landings',  listQueryKeys: ['billOfLadings', 'logisticsDocs'] },
  PL: { table: 'packing_lists',  listQueryKeys: ['packingLists',  'logisticsDocs'] },
  FQ: { table: 'freight_quotes', listQueryKeys: ['freightQuotes', 'logisticsDocs'] },
  BK: { table: 'bookings',       listQueryKeys: ['bookings',      'logisticsDocs'] },
};


const columns: DataTableColumn<LogisticsDoc>[] = [
  { id: 'kind', header: 'Type', sortable: true, filterable: true,
    value: r => kindLabel[r.kind],
    cell: r => <Badge variant={kindTone[r.kind]} dot>{kindLabel[r.kind]}</Badge> },
  { id: 'ref', header: 'Reference', mono: true, sortable: true, filterable: true,
    value: r => r.reference, cell: r => r.reference },
  { id: 'subj', header: 'Subject', sortable: true, filterable: true,
    value: r => r.subject,
    cell: r => <span className="text-slate-100">{r.subject}</span> },
  { id: 'created', header: 'Added', align: 'right', sortable: true,
    value: r => r.createdAt,
    cell: r => (
      <span className="text-slate-500 font-mono tabular-nums text-[11px]">
        {fmtDate(r.createdAt)}
      </span>
    ) },
];

type DocKind = LogisticsDoc['kind'];

// All four kinds share the same mutation hook with a dynamic table.
// Since react-query hooks can't be called conditionally we create one
// hook per kind and pick at delete time.
const useMultiDelete = () => {
  const bl = useEntityDelete(kindTable.BL);
  const pl = useEntityDelete(kindTable.PL);
  const fq = useEntityDelete(kindTable.FQ);
  const bk = useEntityDelete(kindTable.BK);
  return {
    BL: bl, PL: pl, FQ: fq, BK: bk,
    anyPending: bl.isPending || pl.isPending || fq.isPending || bk.isPending,
  };
};

const LogisticsDocsV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState<DocKind | null>(null);
  const [deleteDoc, setDeleteDoc] = useState<LogisticsDoc | null>(null);
  const toast = useToast();
  const docs = useLogisticsDocs(search);
  const deletes = useMultiDelete();

  const onConfirmDelete = () => {
    if (!deleteDoc) return;
    // Virtual id is `<kind>.<uuid>`; peel off the prefix.
    const bareId = deleteDoc.id.split('.')[1] ?? deleteDoc.id;
    const label = deleteDoc.reference;
    deletes[deleteDoc.kind].mutate(bareId, {
      onSuccess: () => {
        toast.push({ kind: 'success', title: 'Deleted', description: label });
        setDeleteDoc(null);
      },
      onError: (err) => {
        toast.push({ kind: 'error', title: 'Delete failed', description: err.message });
        setDeleteDoc(null);
      },
    });
  };

  const openDoc = (r: LogisticsDoc) => {
    if (r.url) {
      window.open(r.url, '_blank', 'noopener,noreferrer');
    } else {
      toast.push({ kind: 'warning', title: 'No URL on this record', description: r.reference });
    }
  };

  return (
    <>
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
        onRowClick={openDoc}
        rowActions={(row) => (
          <RowActions
            onView={() => openDoc(row)}
            onDelete={() => setDeleteDoc(row)}
            disabled={deletes.anyPending}
          />
        )}
        headerAction={
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button size="sm"
                className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
                + New document ▾
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                className="z-50 min-w-[180px] rounded-md border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_8px_32px_rgba(0,0,0,0.5)] p-1"
              >
                {(['BL', 'PL', 'FQ', 'BK'] as DocKind[]).map(k => (
                  <DropdownMenu.Item
                    key={k}
                    onSelect={() => setCreating(k)}
                    className="px-2.5 py-1.5 text-[12px] text-slate-200 rounded-sm cursor-pointer outline-none data-[highlighted]:bg-[#161616]"
                  >
                    {kindLabel[k]}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        }
        skeletonCols={[120, 140, 240, 60]}
      />

      <QuickCreateDrawer
        open={creating === 'BL'}
        onOpenChange={(o) => !o && setCreating(null)}
        title="New bill of lading"
        table="bill_landings"
        idPrefix="BL"
        listQueryKeys={['billOfLadings', 'logisticsDocs']}
        scopeByCompany
        fields={[
          { key: 'blNumber',      label: 'B/L #', required: true, mono: true },
          { key: 'shipper',       label: 'Shipper' },
          { key: 'consignee',     label: 'Consignee' },
          { key: 'originalDocument', label: 'Document URL', fullWidth: true,
            placeholder: 'https://…' },
          { key: 'status',        label: 'Status', type: 'select',
            options: ['DRAFT', 'ISSUED', 'RELEASED'], defaultValue: 'ISSUED' },
        ]}
      />
      <QuickCreateDrawer
        open={creating === 'PL'}
        onOpenChange={(o) => !o && setCreating(null)}
        title="New packing list"
        table="packing_lists"
        idPrefix="PL"
        listQueryKeys={['packingLists', 'logisticsDocs']}
        scopeByCompany
        fields={[
          { key: 'plNumber',      label: 'PL #', required: true, mono: true },
          { key: 'soNumber',      label: 'SO #', mono: true },
          { key: 'consignee',     label: 'Consignee' },
          { key: 'originalDocument', label: 'Document URL', fullWidth: true,
            placeholder: 'https://…' },
          { key: 'status',        label: 'Status', type: 'select',
            options: ['DRAFT', 'ISSUED', 'SHIPPED'], defaultValue: 'DRAFT' },
        ]}
      />
      <QuickCreateDrawer
        open={creating === 'FQ'}
        onOpenChange={(o) => !o && setCreating(null)}
        title="New freight quote"
        table="freight_quotes"
        idPrefix="FQ"
        listQueryKeys={['freightQuotes', 'logisticsDocs']}
        scopeByCompany
        fields={[
          { key: 'agentName',        label: 'Agent', required: true },
          { key: 'carrier',          label: 'Carrier' },
          { key: 'originPort',       label: 'POL', mono: true },
          { key: 'destinationPort',  label: 'POD', mono: true },
          { key: 'originalDocument', label: 'Document URL', fullWidth: true,
            placeholder: 'https://…' },
          { key: 'status',           label: 'Status', type: 'select',
            options: ['ACTIVE', 'PENDING', 'EXPIRED'], defaultValue: 'ACTIVE' },
        ]}
      />
      <QuickCreateDrawer
        open={creating === 'BK'}
        onOpenChange={(o) => !o && setCreating(null)}
        title="New booking"
        table="bookings"
        idPrefix="BKG"
        listQueryKeys={['bookings', 'logisticsDocs']}
        scopeByCompany
        fields={[
          { key: 'bookingNumber',    label: 'Booking #', required: true, mono: true },
          { key: 'customer',         label: 'Customer' },
          { key: 'vesselVoyage',     label: 'Vessel / Voyage', mono: true, fullWidth: true },
          { key: 'originalDocument', label: 'Document URL', fullWidth: true,
            placeholder: 'https://…' },
          { key: 'status',           label: 'Status', type: 'select',
            options: ['BOOKED', 'CONFIRMED'], defaultValue: 'BOOKED' },
        ]}
      />

      <ConfirmDialog
        open={!!deleteDoc}
        onOpenChange={(o) => !o && setDeleteDoc(null)}
        title={`Delete ${deleteDoc?.reference ?? ''}?`}
        description={`This removes the source ${deleteDoc ? kindLabel[deleteDoc.kind] : 'record'} permanently.`}
        confirmLabel="Delete"
        loading={deletes.anyPending}
        onConfirm={onConfirmDelete}
      />
    </>
  );
};

export default LogisticsDocsV2;
