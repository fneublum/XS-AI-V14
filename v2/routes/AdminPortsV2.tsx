// v2 admin: Ports (POA / POD reference). Mirrors v1 DATA → PORTS.

import React, { useState } from 'react';
import { Button } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { useRowCrud } from '../components/useRowCrud';
import { useSupabaseQuery } from '../queries/useSupabaseQuery';
import { getSupabaseClient } from '../../services/supabase';

interface PortRow {
  id: string;
  companyId: string | null;
  code: string | null;
  name: string;
  country: string | null;
}

const useAdminPorts = (search: string) =>
  useSupabaseQuery<PortRow[]>(
    ['adminPorts', search.trim()],
    async () => {
      const supabase = getSupabaseClient();
      let q = supabase.from('ports')
        .select('id, companyId, code, name, country')
        .order('name', { ascending: true })
        .limit(1000);
      const needle = search.trim();
      if (needle) {
        q = q.or(`name.ilike.*${needle}*,code.ilike.*${needle}*,country.ilike.*${needle}*`);
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const rows = (data as Array<Partial<PortRow>> | null) ?? [];
      return rows.map(r => ({
        id: r.id ?? '',
        companyId: r.companyId ?? null,
        code: r.code ?? null,
        name: r.name ?? r.id ?? '',
        country: r.country ?? null,
      }));
    },
  );

const columns: DataTableColumn<PortRow>[] = [
  { id: 'name', header: 'Name', sortable: true, filterable: true,
    value: r => r.name,
    cell: r => <span className="text-slate-100 font-medium">{r.name}</span> },
  { id: 'code', header: 'Code', mono: true, sortable: true, filterable: true,
    value: r => r.code ?? '',
    cell: r => <span className="text-slate-300 font-mono tabular-nums">{r.code ?? '—'}</span> },
  { id: 'country', header: 'Country', sortable: true, filterable: true,
    value: r => r.country ?? '', cell: r => r.country ?? '—' },
];

const fields: FieldDef[] = [
  { key: 'name',    label: 'Name', required: true, fullWidth: true },
  { key: 'code',    label: 'UN/LOCODE', mono: true },
  { key: 'country', label: 'Country' },
];

const AdminPortsV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const ports = useAdminPorts(search);

  const { rowActions, drawers, openView } = useRowCrud<PortRow>({
    table: 'ports',
    listQueryKeys: ['adminPorts', 'ports'],
    rowLabel: r => r.name,
    fields,
  });

  return (
    <>
      <ListPage<PortRow>
        title="Ports"
        subtitle={ports.data
          ? `${ports.data.length} ports${search ? ` · "${search}"` : ''}`
          : 'Loading…'}
        search={search}
        setSearch={setSearch}
        searchPlaceholder="Name, code, country"
        cardTitle="All ports"
        columns={columns}
        getRowId={r => r.id}
        data={ports.data}
        isLoading={ports.isLoading}
        error={ports.error}
        onRetry={ports.refetch}
        onRowClick={openView}
        rowActions={rowActions}
        headerAction={
          <Button size="sm" onClick={() => setCreateOpen(true)}
            className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
            + New port
          </Button>
        }
        emptyAction={search ? undefined : { label: '+ New port', onClick: () => setCreateOpen(true) }}
        skeletonCols={[200, 100, 120]}
      />
      <QuickCreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New port"
        description="Port of arrival / departure used across orders, bookings, and PDFs."
        table="ports"
        idPrefix="PRT"
        listQueryKeys={['adminPorts', 'ports']}
        fields={fields}
        extras={{ companyId: 'ALL' }}
      />
      {drawers}
    </>
  );
};

export default AdminPortsV2;
