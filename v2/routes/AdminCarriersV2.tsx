// v2 admin: Carriers (ocean / air / trucking). Mirrors v1 DATA → CARRIERS.

import React, { useState } from 'react';
import { Button } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { useRowCrud } from '../components/useRowCrud';
import { useSupabaseQuery } from '../queries/useSupabaseQuery';
import { getSupabaseClient } from '../../services/supabase';

interface CarrierRow {
  id: string;
  companyId: string | null;
  code: string | null;
  name: string;
  scac: string | null;
  contact: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
}

const useAdminCarriers = (search: string) =>
  useSupabaseQuery<CarrierRow[]>(
    ['adminCarriers', search.trim()],
    async () => {
      const supabase = getSupabaseClient();
      let q = supabase.from('carriers')
        .select('id, companyId, code, name, scac, contact, email, phone, country')
        .order('name', { ascending: true })
        .limit(500);
      const needle = search.trim();
      if (needle) {
        q = q.or(`name.ilike.*${needle}*,scac.ilike.*${needle}*,code.ilike.*${needle}*,country.ilike.*${needle}*`);
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const rows = (data as Array<Partial<CarrierRow>> | null) ?? [];
      return rows.map(r => ({
        id: r.id ?? '',
        companyId: r.companyId ?? null,
        code: r.code ?? null,
        name: r.name ?? r.id ?? '',
        scac: r.scac ?? null,
        contact: r.contact ?? null,
        email: r.email ?? null,
        phone: r.phone ?? null,
        country: r.country ?? null,
      }));
    },
  );

const columns: DataTableColumn<CarrierRow>[] = [
  { id: 'name', header: 'Name', sortable: true, filterable: true,
    value: r => r.name,
    cell: r => (
      <div>
        <div className="text-slate-100 font-medium">{r.name}</div>
        {r.code && <div className="text-[11px] text-slate-500 font-mono tabular-nums">{r.code}</div>}
      </div>
    ) },
  { id: 'scac', header: 'SCAC', mono: true, sortable: true, filterable: true,
    value: r => r.scac ?? '', cell: r => r.scac ?? '—' },
  { id: 'contact', header: 'Contact', sortable: true, filterable: true,
    value: r => r.contact ?? '', cell: r => r.contact ?? '—' },
  { id: 'email', header: 'Email', sortable: true, filterable: true,
    value: r => r.email ?? '', cell: r => r.email ?? '—' },
  { id: 'phone', header: 'Phone', mono: true, sortable: true,
    value: r => r.phone ?? '', cell: r => r.phone ?? '—' },
  { id: 'country', header: 'Country', sortable: true, filterable: true,
    value: r => r.country ?? '', cell: r => r.country ?? '—' },
];

const fields: FieldDef[] = [
  { key: 'name',    label: 'Name', required: true, fullWidth: true },
  { key: 'scac',    label: 'SCAC code', mono: true },
  { key: 'code',    label: 'Short code', mono: true },
  { key: 'country', label: 'Country' },
  { key: 'contact', label: 'Contact person' },
  { key: 'email',   label: 'Email' },
  { key: 'phone',   label: 'Phone', mono: true },
];

const AdminCarriersV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const carriers = useAdminCarriers(search);

  const { rowActions, drawers, openView } = useRowCrud<CarrierRow>({
    table: 'carriers',
    listQueryKeys: ['adminCarriers', 'carriers'],
    rowLabel: r => r.name,
    fields,
  });

  return (
    <>
      <ListPage<CarrierRow>
        title="Carriers"
        subtitle={carriers.data
          ? `${carriers.data.length} carriers${search ? ` · "${search}"` : ''}`
          : 'Loading…'}
        search={search}
        setSearch={setSearch}
        searchPlaceholder="Name, SCAC, code, country"
        cardTitle="All carriers"
        columns={columns}
        getRowId={r => r.id}
        data={carriers.data}
        isLoading={carriers.isLoading}
        error={carriers.error}
        onRetry={carriers.refetch}
        onRowClick={openView}
        rowActions={rowActions}
        headerAction={
          <Button size="sm" onClick={() => setCreateOpen(true)}
            className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
            + New carrier
          </Button>
        }
        emptyAction={search ? undefined : { label: '+ New carrier', onClick: () => setCreateOpen(true) }}
        skeletonCols={[180, 80, 140, 180, 120, 100]}
      />
      <QuickCreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New carrier"
        description="Ocean / air / trucking carrier used on bookings, BoLs, and freight quotes."
        table="carriers"
        idPrefix="CRR"
        listQueryKeys={['adminCarriers', 'carriers']}
        fields={fields}
        extras={{ companyId: 'ALL' }}
      />
      {drawers}
    </>
  );
};

export default AdminCarriersV2;
