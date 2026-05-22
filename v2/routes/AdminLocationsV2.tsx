// v2 admin: Saved Locations (pickup / drop points).
// Mirrors v1 DATA → LOCATIONS.

import React, { useState } from 'react';
import { Button } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { useRowCrud } from '../components/useRowCrud';
import { useSupabaseQuery } from '../queries/useSupabaseQuery';
import { getSupabaseClient } from '../../services/supabase';
import { useCompany } from '../providers/CompanyProvider';

interface LocationRow {
  id: string;
  companyId: string | null;
  code: string | null;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  entityType: string | null;
  entityName: string | null;
  contact: string | null;
  email: string | null;
  phone: string | null;
}

const useAdminLocations = (search: string, currentCompanyId: string) =>
  useSupabaseQuery<LocationRow[]>(
    ['adminLocations', currentCompanyId, search.trim()],
    async () => {
      const supabase = getSupabaseClient();
      let q = supabase.from('saved_locations')
        .select('id, companyId, code, name, address, city, state, zip, country, entityType, entityName, contact, email, phone')
        .order('name', { ascending: true })
        .limit(1000);
      // Scope by company unless ALL is active.
      if (currentCompanyId && currentCompanyId !== 'ALL') {
        q = q.or(`"companyId".eq.${currentCompanyId},"companyId".eq.ALL`);
      }
      const needle = search.trim();
      if (needle) {
        q = q.or(`name.ilike.*${needle}*,code.ilike.*${needle}*,city.ilike.*${needle}*,country.ilike.*${needle}*,entityName.ilike.*${needle}*`);
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const rows = (data as Array<Partial<LocationRow>> | null) ?? [];
      return rows.map(r => ({
        id: r.id ?? '',
        companyId: r.companyId ?? null,
        code: r.code ?? null,
        name: r.name ?? r.id ?? '',
        address: r.address ?? null,
        city: r.city ?? null,
        state: r.state ?? null,
        zip: r.zip ?? null,
        country: r.country ?? null,
        entityType: r.entityType ?? null,
        entityName: r.entityName ?? null,
        contact: r.contact ?? null,
        email: r.email ?? null,
        phone: r.phone ?? null,
      }));
    },
  );

const columns: DataTableColumn<LocationRow>[] = [
  { id: 'name', header: 'Name', sortable: true, filterable: true,
    value: r => r.name,
    cell: r => (
      <div>
        <div className="text-slate-100 font-medium">{r.name}</div>
        {r.entityName && <div className="text-[11px] text-slate-500">{r.entityName}</div>}
      </div>
    ) },
  { id: 'entityType', header: 'Type', sortable: true, filterable: true,
    value: r => r.entityType ?? '', cell: r => r.entityType ?? '—' },
  { id: 'city', header: 'City', sortable: true, filterable: true,
    value: r => r.city ?? '', cell: r => r.city ?? '—' },
  { id: 'state', header: 'State', sortable: true,
    value: r => r.state ?? '', cell: r => r.state ?? '—' },
  { id: 'country', header: 'Country', sortable: true, filterable: true,
    value: r => r.country ?? '', cell: r => r.country ?? '—' },
  { id: 'contact', header: 'Contact', sortable: true,
    value: r => r.contact ?? '', cell: r => r.contact ?? '—' },
];

const fields: FieldDef[] = [
  { key: 'name',       label: 'Location name', required: true, fullWidth: true },
  { key: 'code',       label: 'Short code', mono: true },
  { key: 'entityType', label: 'Entity type', type: 'select',
    options: ['CUSTOMER', 'SUPPLIER', 'WAREHOUSE', 'OTHER'] },
  { key: 'entityName', label: 'Linked entity name' },
  { key: 'address',    label: 'Address', fullWidth: true },
  { key: 'city',       label: 'City' },
  { key: 'state',      label: 'State / Region' },
  { key: 'zip',        label: 'ZIP / Postal code', mono: true },
  { key: 'country',    label: 'Country' },
  { key: 'contact',    label: 'Contact person' },
  { key: 'email',      label: 'Email' },
  { key: 'phone',      label: 'Phone', mono: true },
];

const AdminLocationsV2: React.FC = () => {
  const { currentCompanyId } = useCompany();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const locations = useAdminLocations(search, currentCompanyId);

  const { rowActions, drawers, openView } = useRowCrud<LocationRow>({
    table: 'saved_locations',
    listQueryKeys: ['adminLocations', 'saved_locations'],
    rowLabel: r => r.name,
    fields,
  });

  return (
    <>
      <ListPage<LocationRow>
        title="Locations"
        subtitle={locations.data
          ? `${locations.data.length} locations${search ? ` · "${search}"` : ''}`
          : 'Loading…'}
        search={search}
        setSearch={setSearch}
        searchPlaceholder="Name, code, city, country, entity"
        cardTitle="All locations"
        columns={columns}
        getRowId={r => r.id}
        data={locations.data}
        isLoading={locations.isLoading}
        error={locations.error}
        onRetry={locations.refetch}
        onRowClick={openView}
        rowActions={rowActions}
        headerAction={
          <Button size="sm" onClick={() => setCreateOpen(true)}
            className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
            + New location
          </Button>
        }
        emptyAction={search ? undefined : { label: '+ New location', onClick: () => setCreateOpen(true) }}
        skeletonCols={[200, 120, 120, 80, 120, 140]}
      />
      <QuickCreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New location"
        description="Pickup or drop-off point linked to a supplier, customer, or warehouse."
        table="saved_locations"
        idPrefix="LOC"
        listQueryKeys={['adminLocations', 'saved_locations']}
        fields={fields}
        scopeByCompany
      />
      {drawers}
    </>
  );
};

export default AdminLocationsV2;
