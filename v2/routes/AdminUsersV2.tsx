// Phase 3B — v2 Admin Users.

import React, { useState } from 'react';
import { Badge } from '../primitives';
import { DataTableColumn } from '../primitives/DataTable';
import { ListPage } from '../components/ListPage';
import { useUsers, UserRow } from '../queries/useUsers';
import { useToast } from '../primitives/Toast';

type BadgeTone = 'success' | 'info' | 'warning' | 'neutral' | 'danger';
const roleTone = (role: string): BadgeTone => {
  const s = role.toUpperCase();
  if (s === 'ADMIN' || s === 'OWNER')   return 'info';
  if (s === 'MANAGER' || s === 'FINANCE') return 'success';
  if (s === 'USER' || s === 'MEMBER')   return 'neutral';
  return 'neutral';
};

const columns: DataTableColumn<UserRow>[] = [
  { id: 'name',     header: 'Name', cell: r => (
      <span className="text-slate-100 font-medium">{r.name}</span>
    ) },
  { id: 'username', header: 'Username', mono: true, cell: r => r.username },
  { id: 'email',    header: 'Email', cell: r => r.email ?? '—' },
  { id: 'role',     header: 'Role', cell: r => (
      <Badge variant={roleTone(r.role)}>{r.role}</Badge>
    ) },
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

const AdminUsersV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const toast = useToast();
  const users = useUsers(search);

  return (
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
      onRowClick={r => toast.push({
        kind: 'info',
        title: r.name,
        description: `${r.role} · ${r.email ?? r.username}`,
      })}
      skeletonCols={[140, 120, 220, 80, 60]}
    />
  );
};

export default AdminUsersV2;
