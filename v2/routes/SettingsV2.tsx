// Phase 3B — v2 Settings.

import React from 'react';
import { Card, CardHeader, CardTitle, CardBody, Badge } from '../primitives';
import { useAuth } from '../providers/AuthProvider';
import { useCompany } from '../providers/CompanyProvider';

const SettingsV2: React.FC = () => {
  const { user } = useAuth();
  const { currentCompanyId } = useCompany();

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">Settings</h1>
        <p className="text-[13px] text-slate-500 mt-0.5">
          Account, workspace, and appearance preferences.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="space-y-3 text-[13px]">
            <Row label="Name"     value={user?.name ?? 'Signed out'} />
            <Row label="Email"    value={user?.email ?? '—'} />
            <Row label="Role"     value={<Badge variant="info">{user?.role ?? 'ANON'}</Badge>} />
            <Row label="Scope"    value={<span className="font-mono tabular-nums">{currentCompanyId}</span>} />
            <Row
              label="Allowed companies"
              value={
                user?.allowedCompanies && user.allowedCompanies.length > 0
                  ? <div className="flex flex-wrap gap-1">
                      {user.allowedCompanies.map(c => (
                        <span key={c} className="font-mono tabular-nums text-[11px] text-slate-500">
                          {c}
                        </span>
                      ))}
                    </div>
                  : <span className="text-slate-600">All accessible</span>
              }
            />
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="space-y-3 text-[13px]">
            <Row label="Theme"     value={<Badge variant="neutral" dot>Dark (Linear)</Badge>} />
            <Row label="Density"   value={<span className="text-slate-400">Compact</span>} />
            <Row label="Keyboard shortcuts"
              value={<span className="text-slate-400">Enabled — press <span className="font-mono tabular-nums">?</span> for the full list (soon)</span>}
            />
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="space-y-3 text-[13px]">
            <Row label="Supabase project"
              value={<span className="font-mono tabular-nums text-slate-400">qfskvevighylzzmyiwre</span>} />
            <Row label="Edge functions"
              value={<span className="text-slate-400">auth-issue + gemini-proxy deployed (Phase 1c)</span>} />
            <Row label="RLS policies"
              value={<Badge variant="warning">Not applied — Phase 1d draft</Badge>} />
          </dl>
        </CardBody>
      </Card>
    </div>
  );
};

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-start gap-4">
    <dt className="w-48 shrink-0 text-slate-500 text-[12px] uppercase tracking-wider font-medium">
      {label}
    </dt>
    <dd className="flex-1 min-w-0 text-slate-200 break-words">{value}</dd>
  </div>
);

export default SettingsV2;
