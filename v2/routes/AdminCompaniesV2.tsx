// Phase 3B — v2 Admin Companies.

import React, { useState } from 'react';
import { Button } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { useRowCrud } from '../components/useRowCrud';
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

const fields: FieldDef[] = [
  { key: 'name',     label: 'Legal name', required: true, fullWidth: true },
  { key: 'nickname', label: 'Nickname', placeholder: 'Short display name' },
  { key: 'ein',      label: 'EIN / Tax ID', mono: true },
  { key: 'city',     label: 'City' },
  { key: 'country',  label: 'Country' },
  { key: 'phone',    label: 'Phone', mono: true },
];

const AdminCompaniesV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const companies = useAdminCompanies(search);

  const { rowActions, drawers, openView } = useRowCrud<CompanyAdminRow>({
    table: 'companies',
    listQueryKeys: ['adminCompanies', 'companies'],
    rowLabel: r => r.name,
    fields,
  });

  const openCreate = () => setCreateOpen(true);

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
        fields={fields}
      />
      {drawers}
    </>
  );
};

export default AdminCompaniesV2;
