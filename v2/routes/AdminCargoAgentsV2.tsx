// v2 admin: Cargo Agents (forwarders + brokers). Mirrors v1 DATA → AGENTS.

import React, { useState } from 'react';
import { Button } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { useRowCrud } from '../components/useRowCrud';
import { useSupabaseQuery } from '../queries/useSupabaseQuery';
import { getSupabaseClient } from '../../services/supabase';

interface CargoAgentRow {
  id: string;
  companyId: string | null;
  code: string | null;
  name: string;
  contact: string | null;
  email: string | null;
  email2: string | null;
  phone: string | null;
  country: string | null;
}

const useAdminCargoAgents = (search: string) =>
  useSupabaseQuery<CargoAgentRow[]>(
    ['adminCargoAgents', search.trim()],
    async () => {
      const supabase = getSupabaseClient();
      let q = supabase.from('cargo_agents')
        .select('id, companyId, code, name, contact, email, email2, phone, country')
        .order('name', { ascending: true })
        .limit(500);
      const needle = search.trim();
      if (needle) {
        q = q.or(`name.ilike.*${needle}*,code.ilike.*${needle}*,contact.ilike.*${needle}*,country.ilike.*${needle}*`);
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const rows = (data as Array<Partial<CargoAgentRow>> | null) ?? [];
      return rows.map(r => ({
        id: r.id ?? '',
        companyId: r.companyId ?? null,
        code: r.code ?? null,
        name: r.name ?? r.id ?? '',
        contact: r.contact ?? null,
        email: r.email ?? null,
        email2: r.email2 ?? null,
        phone: r.phone ?? null,
        country: r.country ?? null,
      }));
    },
  );

const columns: DataTableColumn<CargoAgentRow>[] = [
  { id: 'name', header: 'Name', sortable: true, filterable: true,
    value: r => r.name,
    cell: r => (
      <div>
        <div className="text-slate-100 font-medium">{r.name}</div>
        {r.code && <div className="text-[11px] text-slate-500 font-mono tabular-nums">{r.code}</div>}
      </div>
    ) },
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
  { key: 'code',    label: 'Short code', mono: true },
  { key: 'country', label: 'Country' },
  { key: 'contact', label: 'Contact person' },
  { key: 'email',   label: 'Email' },
  { key: 'email2',  label: 'Email (cc)' },
  { key: 'phone',   label: 'Phone', mono: true },
];

const AdminCargoAgentsV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const agents = useAdminCargoAgents(search);

  const { rowActions, drawers, openView } = useRowCrud<CargoAgentRow>({
    table: 'cargo_agents',
    listQueryKeys: ['adminCargoAgents', 'cargoAgents'],
    rowLabel: r => r.name,
    fields,
  });

  return (
    <>
      <ListPage<CargoAgentRow>
        title="Cargo Agents"
        subtitle={agents.data
          ? `${agents.data.length} agents${search ? ` · "${search}"` : ''}`
          : 'Loading…'}
        search={search}
        setSearch={setSearch}
        searchPlaceholder="Name, code, contact, country"
        cardTitle="All cargo agents"
        columns={columns}
        getRowId={r => r.id}
        data={agents.data}
        isLoading={agents.isLoading}
        error={agents.error}
        onRetry={agents.refetch}
        onRowClick={openView}
        rowActions={rowActions}
        headerAction={
          <Button size="sm" onClick={() => setCreateOpen(true)}
            className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
            + New agent
          </Button>
        }
        emptyAction={search ? undefined : { label: '+ New agent', onClick: () => setCreateOpen(true) }}
        skeletonCols={[180, 140, 180, 120, 100]}
      />
      <QuickCreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New cargo agent"
        description="Forwarder or customs broker the team uses on bookings & quotes."
        table="cargo_agents"
        idPrefix="AGT"
        listQueryKeys={['adminCargoAgents', 'cargoAgents']}
        fields={fields}
        extras={{ companyId: 'ALL' }}
      />
      {drawers}
    </>
  );
};

export default AdminCargoAgentsV2;
