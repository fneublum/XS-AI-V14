// Phase 3B — v2 Admin Companies.

import React, { useState } from 'react';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { useAdminCompanies, CompanyAdminRow } from '../queries/useAdminCompanies';
import { useToast } from '../primitives/Toast';

const columns: DataTableColumn<CompanyAdminRow>[] = [
  { id: 'name', header: 'Name', cell: r => (
      <div>
        <div className="text-slate-100 font-medium">{r.name}</div>
        {r.nickname && (
          <div className="text-[11px] text-slate-500">{r.nickname}</div>
        )}
      </div>
    ) },
  { id: 'id',      header: 'ID', mono: true, cell: r => (
      <span className="text-slate-500">{r.id}</span>
    ) },
  { id: 'city',    header: 'City', cell: r => r.city ?? '—' },
  { id: 'country', header: 'Country', cell: r => r.country ?? '—' },
  { id: 'ein',     header: 'EIN', mono: true, cell: r => (
      <span className="text-slate-400">{r.ein ?? '—'}</span>
    ) },
  { id: 'phone',   header: 'Phone', mono: true, align: 'right', cell: r => (
      <span className="text-slate-500">{r.phone ?? '—'}</span>
    ) },
];

const AdminCompaniesV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const toast = useToast();
  const companies = useAdminCompanies(search);

  return (
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
      onRowClick={r => toast.push({
        kind: 'info',
        title: r.name,
        description: [r.nickname, r.country].filter(Boolean).join(' · ') || r.id,
      })}
      skeletonCols={[180, 120, 120, 120, 80, 100]}
    />
  );
};

export default AdminCompaniesV2;
