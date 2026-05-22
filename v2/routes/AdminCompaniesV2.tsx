// Phase 3B — v2 Admin Companies.

import React, { useState } from 'react';
import { Button, ConfirmDialog } from '../primitives';
import { useToast } from '../primitives/Toast';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { RowActions } from '../components/RowActions';
import { CompanyEditDrawer, CompanyDrawerMode } from '../components/CompanyEditDrawer';
import { useEntityDelete } from '../queries/useEntityMutations';
import { useAdminCompanies, CompanyAdminRow } from '../queries/useAdminCompanies';

const columns: DataTableColumn<CompanyAdminRow>[] = [
  { id: 'name', header: 'Name', sortable: true, filterable: true,
    value: r => r.name,
    cell: r => (
      <div>
        <div className="text-slate-100 font-medium">{r.name}</div>
        {r.nickname && (
          <div className="text-[11px] text-slate-500">{r.nickname}</div>
        )}
      </div>
    ) },
  { id: 'id', header: 'ID', mono: true, sortable: true, filterable: true,
    value: r => r.id,
    cell: r => <span className="text-slate-500">{r.id}</span> },
  { id: 'city', header: 'City', sortable: true, filterable: true,
    value: r => r.city ?? '', cell: r => r.city ?? '—' },
  { id: 'country', header: 'Country', sortable: true, filterable: true,
    value: r => r.country ?? '', cell: r => r.country ?? '—' },
  { id: 'ein', header: 'EIN', mono: true, sortable: true, filterable: true,
    value: r => r.ein ?? '',
    cell: r => <span className="text-slate-400">{r.ein ?? '—'}</span> },
  { id: 'phone', header: 'Phone', mono: true, align: 'right', sortable: true,
    value: r => r.phone ?? '',
    cell: r => <span className="text-slate-500">{r.phone ?? '—'}</span> },
];

const createFields: FieldDef[] = [
  { key: 'name',     label: 'Legal name', required: true, fullWidth: true },
  { key: 'nickname', label: 'Nickname', placeholder: 'Short display name' },
  { key: 'ein',      label: 'EIN / Tax ID', mono: true },
  { key: 'address',  label: 'Address', fullWidth: true },
  { key: 'city',     label: 'City' },
  { key: 'state',    label: 'State / Region' },
  { key: 'zip',      label: 'ZIP / Postal code', mono: true },
  { key: 'country',  label: 'Country' },
  { key: 'phone',    label: 'Phone', mono: true },
  { key: 'email',    label: 'Email', fullWidth: true },
];

const AdminCompaniesV2: React.FC = () => {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [inspectRow, setInspectRow] = useState<CompanyAdminRow | null>(null);
  const [inspectMode, setInspectMode] = useState<CompanyDrawerMode>('view');
  const [deleteRow, setDeleteRow] = useState<CompanyAdminRow | null>(null);

  const companies = useAdminCompanies(search);
  const del = useEntityDelete({ table: 'companies', listQueryKeys: ['adminCompanies', 'companies'] });

  const openView = (row: CompanyAdminRow) => { setInspectRow(row); setInspectMode('view'); };
  const openEdit = (row: CompanyAdminRow) => { setInspectRow(row); setInspectMode('edit'); };
  const openCreate = () => setCreateOpen(true);

  const rowActions = (row: CompanyAdminRow): React.ReactNode => (
    <RowActions
      onView={() => openView(row)}
      onEdit={() => openEdit(row)}
      onDelete={() => setDeleteRow(row)}
    />
  );

  return (
    <>
      <ListPage<CompanyAdminRow>
        title="Companies"
        subtitle={
          companies.data
            ? `${companies.data.length} companies${search ? ` · "${search}"` : ''}`
            : 'Loading…'
        }
        search={search}
        setSearch={setSearch}
        searchPlaceholder="Name, nickname, country"
        cardTitle="All companies"
        columns={columns}
        getRowId={r => r.id}
        data={companies.data}
        isLoading={companies.isLoading}
        error={companies.error}
        onRetry={companies.refetch}
        onRowClick={openView}
        rowActions={rowActions}
        headerAction={
          <Button size="sm" onClick={openCreate}
            className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
            + New company
          </Button>
        }
        emptyAction={search ? undefined : { label: '+ New company', onClick: openCreate }}
        skeletonCols={[180, 120, 120, 120, 80, 100]}
      />
      <QuickCreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New company"
        description="Register a new legal entity. Users and data are scoped to it afterwards."
        table="companies"
        idPrefix="CO"
        listQueryKeys={['adminCompanies', 'companies']}
        fields={createFields}
      />
      <CompanyEditDrawer
        open={!!inspectRow}
        onOpenChange={(o) => !o && setInspectRow(null)}
        mode={inspectMode}
        onModeChange={setInspectMode}
        row={inspectRow}
      />
      <ConfirmDialog
        open={!!deleteRow}
        onOpenChange={(o) => !o && setDeleteRow(null)}
        title={`Delete ${deleteRow?.name ?? ''}?`}
        description="This removes the company permanently. Records that reference it may break until fixed."
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={() => {
          if (!deleteRow) return;
          const label = deleteRow.name;
          del.mutate(deleteRow.id, {
            onSuccess: () => {
              toast.push({ kind: 'success', title: 'Deleted', description: label });
              setDeleteRow(null);
            },
            onError: (err) => {
              toast.push({
                kind: 'error', title: 'Delete failed', description: err.message,
              });
              setDeleteRow(null);
            },
          });
        }}
      />
    </>
  );
};

export default AdminCompaniesV2;
