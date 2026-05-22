// Phase 3B — v2 Admin Users.

import React, { useMemo, useState } from 'react';
import { Badge, Button } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { QuickCreateDrawer, FieldDef } from '../components/QuickCreateDrawer';
import { useRowCrud } from '../components/useRowCrud';
import { useUsers, UserRow } from '../queries/useUsers';
import { useCompanies } from '../queries/useCompanies';
import { useCargoAgents } from '../queries/useCargoAgents';

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

// Canonical module list — mirrors `allowed_modules` values stored on
// each user. Values are the coarse-grained gate IDs that the v1 Dock /
// TopNavigation and the v2 sidebar both honour. Labels match the v2
// sidebar wording where the two diverge (Purchase & cost / Order-Sale).
// Grouped by sidebar section for readability; the underlying values are
// what's stored in DB. Rows created before a module shipped still
// round-trip via the raw array value, so adding new modules here is
// additive — no migration needed.
const MODULE_OPTIONS: Array<{ value: string; label: string }> = [
  // ── Workspace ─────────────────────────────────────────────────
  { value: 'DASHBOARD',          label: 'Dashboard' },
  { value: 'CONNECTIONS',        label: 'Connections' },
  { value: 'AI_SALES_AGENT',     label: 'AI Sales Agent' },
  // ── Trading ───────────────────────────────────────────────────
  { value: 'BUY',                label: 'Purchase & cost' },
  { value: 'COST_PROFIT_AI',     label: 'Order-Sale' },
  { value: 'PAPERWORK',          label: 'Paperwork' },
  // ── Sales / Agent Sales ───────────────────────────────────────
  { value: 'SALES_HUB',          label: 'Sales Hub' },
  { value: 'SALES_FORCE',        label: 'Sales Force' },
  { value: 'COMMISSIONS',        label: 'Commissions' },
  // ── Logistics / Finance ───────────────────────────────────────
  { value: 'LOGISTICS',          label: 'Logistics' },
  { value: 'FINANCE',            label: 'Finance' },
  // ── System / AI / Portals ─────────────────────────────────────
  { value: 'DATA',               label: 'Data' },
  { value: 'AI_UPLOAD',          label: 'AI Upload' },
  { value: 'SETTINGS',           label: 'Settings' },
  { value: 'CUSTOMER_PORTAL',    label: 'Customer Portal' },
  { value: 'CARGO_AGENT_PORTAL', label: 'Cargo Agent Portal' },
];

const ROLE_OPTIONS = [
  // Display labels are all-caps for visual consistency; `value`
  // stays at whatever string the role gates expect (sidebar checks
  // `user.role === 'Cargo Agent'`, so the stored value must keep
  // its title-case form with the space). Keep legacy uppercase
  // values verbatim so existing rows still round-trip unchanged.
  { value: 'OWNER',       label: 'OWNER' },
  { value: 'ADMIN',       label: 'ADMIN' },
  { value: 'MANAGER',     label: 'MANAGER' },
  { value: 'FINANCE',     label: 'FINANCE' },
  { value: 'USER',        label: 'USER' },
  { value: 'Cargo Agent', label: 'CARGO AGENT' },
  { value: 'Sales Agent', label: 'SALES AGENT' },
];

const AdminUsersV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const users = useUsers(search);
  // Companies list is async — once loaded we rebuild `fields` so the
  // companies multiselect shows real names. Modules are static.
  const companies = useCompanies();
  const cargoAgents = useCargoAgents();

  const fields: FieldDef[] = useMemo(() => [
    { key: 'name',     label: 'Name', required: true, fullWidth: true },
    { key: 'username', label: 'Username', required: true, mono: true },
    { key: 'email',    label: 'Email', placeholder: 'name@company.com' },
    { key: 'phone',    label: 'Phone', mono: true },
    // Password is write-only: useUsers deliberately doesn't fetch it,
    // and `skipIfEmpty` keeps an empty edit field from wiping the
    // stored value. New-user create accepts an initial password here;
    // edit drawer leaves it blank by default and only sends an UPDATE
    // when the admin types a new one.
    { key: 'password', label: 'Password', type: 'password',
      skipIfEmpty: true, fullWidth: true,
      placeholder: 'Set or leave blank' },
    { key: 'role',     label: 'Role', required: true, type: 'select',
      options: ROLE_OPTIONS,
      defaultValue: 'USER' },
    // Only meaningful for the 'Cargo Agent' role — picks which row(s) in
    // `cargo_agents` this user represents so the Agent Portal can
    // scope its freight quotes + bookings list. Ignored for other
    // roles. Stored CSV-encoded in the existing text column
    // `users.linked_entity_id` (see serialize: 'csv') so admins can
    // link one user to several agent offices without a schema change.
    { key: 'linked_entity_id', label: 'Linked cargo agents',
      type: 'multiselect',
      serialize: 'csv',
      fullWidth: true,
      options: (cargoAgents.data ?? []).map(a => ({ value: a.id, label: a.name || a.id })),
    },
    // View/read uses the hook's camelCase keys (`allowedCompanies` /
    // `allowedModules` per useUsers.ts). `dbKey` maps back to the
    // snake_case column PostgREST expects on write.
    { key: 'allowedCompanies', dbKey: 'allowed_company_ids',
      label: 'Companies', type: 'multiselect', fullWidth: true,
      options: (companies.data ?? []).map(c => ({ value: c.id, label: c.name || c.id })) },
    { key: 'allowedModules',   dbKey: 'allowed_modules',
      label: 'Modules',   type: 'multiselect', fullWidth: true,
      options: MODULE_OPTIONS },
  ], [companies.data, cargoAgents.data]);

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
