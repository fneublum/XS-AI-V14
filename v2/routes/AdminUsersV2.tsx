// Phase 3B — v2 Admin Users.

import React, { useState } from 'react';
import { Badge, Button } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { useRowCrud } from '../components/useRowCrud';
import { useUsers, UserRow } from '../queries/useUsers';

type BadgeTone = 'success' | 'info' | 'warning' | 'neutral' | 'danger';
const roleTone = (role: string): BadgeTone => {
  const s = role.toUpperCase();
  if (s === 'ADMIN' || s === 'OWNER')   return 'info';
  if (s === 'MANAGER' || s === 'FINANCE') return 'success';
  if (s === 'USER' || s === 'MEMBER')   return 'neutral';
  return 'neutral';
};

const columns: DataTableColumn<UserRow>[] = [
  { id: 'name', header: 'Name', sortable: true, filterable: true,
    value: r => r.name,
    cell: r => <span className="text-slate-100 font-medium">{r.name}</span> },
  { id: 'username', header: 'Username', mono: true, sortable: true, filterable: true,
    value: r => r.username, cell: r => r.username },
  { id: 'email', header: 'Email', sortable: true, filterable: true,
    value: r => r.email ?? '', cell: r => r.email ?? '—' },
  { id: 'role', header: 'Role', sortable: true, filterable: true,
    value: r => r.role,
    cell: r => <Badge variant={roleTone(r.role)}>{r.role}</Badge> },
  { id: 'companies',header: 'Companies', cell: r => (
      r.allowedCompanies.length > 0
        ? <div className="flex flex-wrap gap-1">
            {r.allowedCompanies.slice(0, 3).map(id => (
              <span key={id} className="font-mono tabular-nums text-[10px] text-slate-500">
                {id}
              </span>
            ))}
            {r.allowedCompanies.length > 3 && (
              <span className="text-[10px] text-slate-500 font-mono tabular-nums">
                +{r.allowedCompanies.length - 3}
              </span>
            )}
          </div>
        : <span className="text-slate-600">—</span>
    ) },
  { id: 'modules',  header: 'Modules', align: 'right', cell: r => (
      <span className="font-mono tabular-nums text-[11px] text-slate-500">
        {r.allowedModules.length}
      </span>
    ) },
];

const fields: FieldDef[] = [
  { key: 'name',     label: 'Name', required: true, fullWidth: true },
  { key: 'username', label: 'Username', required: true, mono: true },
  { key: 'email',    label: 'Email', placeholder: 'name@company.com' },
  { key: 'phone',    label: 'Phone', mono: true },
  { key: 'role',     label: 'Role', required: true, type: 'select',
    options: ['OWNER', 'ADMIN', 'MANAGER', 'FINANCE', 'USER'],
    defaultValue: 'USER' },
];

const AdminUsersV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const users = useUsers(search);

  const { rowActions, drawers, openView } = useRowCrud<UserRow>({
    table: 'users',
    listQueryKeys: ['users'],
    rowLabel: r => r.name,
    fields,
  });

  const openCreate = () => setCreateOpen(true);

  return (
    <>
      <ListPage<UserRow>
        title="Users"
        subtitle={
          users.data
            ? `${users.data.length} users${search ? ` · "${search}"` : ''}`
            : 'Loading…'
        }
        search={search}
        setSearch={setSearch}
        searchPlaceholder="Name, username, email"
        cardTitle="All users"
        columns={columns}
        getRowId={r => r.id}
        data={users.data}
        isLoading={users.isLoading}
        error={users.error}
        onRetry={users.refetch}
        onRowClick={openView}
        rowActions={rowActions}
        headerAction={
          <Button size="sm" onClick={openCreate}
            className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
            + New user
          </Button>
        }
        emptyAction={search ? undefined : { label: '+ New user', onClick: openCreate }}
        skeletonCols={[140, 120, 220, 80, 60]}
      />
      <QuickCreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New user"
        description="Provision access. Companies and modules are assigned later."
        table="users"
        idPrefix="USR"
        listQueryKeys={['users']}
        extras={{ allowed_company_ids: [], allowed_modules: [] }}
        fields={fields}
      />
      {drawers}
    </>
  );
};

export default AdminUsersV2;
