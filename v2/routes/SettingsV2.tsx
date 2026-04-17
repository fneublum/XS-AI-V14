// Phase 3B — v2 Settings.

import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardBody, Badge, Button } from '../primitives';
import { useAuth } from '../providers/AuthProvider';
import { useCompany } from '../providers/CompanyProvider';
import { getFlag, setFlag } from '../services/featureFlags';
import { useToast } from '../primitives/Toast';

const SettingsV2: React.FC = () => {
  const { user } = useAuth();
  const { currentCompanyId } = useCompany();
  const [v2Default, setV2Default] = useState<boolean>(() => getFlag('v2-default'));
  const toast = useToast();

  const toggleV2Default = () => {
    const next = !v2Default;
    setFlag('v2-default', next);
    setV2Default(next);
    toast.push({
      kind: next ? 'success' : 'info',
      title: next ? 'v2 is now your default' : 'Reverted to v1 as default',
      description: next
        ? 'Fresh tabs will open v2. Use ?v2=0 to one-off to v1.'
        : 'Fresh tabs will open v1. Use ?v2=1 to one-off to v2.',
    });
  };

  const signOut = () => {
    try {
      sessionStorage.removeItem('xs_current_user');
      sessionStorage.removeItem('xs_edge_auth_token');
      sessionStorage.removeItem('xs_edge_auth_exp');
    } catch { /* noop */ }
    window.location.href = '/?v2=1';
  };

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
          <CardTitle>Preview</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[13px] text-slate-100 font-medium">
                Make v2 the default experience
              </div>
              <div className="text-[12px] text-slate-500 mt-0.5">
                {v2Default
                  ? 'New tabs open v2. Use ?v2=0 to jump to v1 once.'
                  : 'New tabs still open v1. You can always reach v2 via ?v2=1.'}
              </div>
            </div>
            <Button
              size="sm"
              onClick={toggleV2Default}
              className={v2Default
                ? 'bg-emerald-600 text-white hover:bg-emerald-500 h-8 px-3 text-[12.5px] rounded-md'
                : 'bg-indigo-600 text-white hover:bg-indigo-500 h-8 px-3 text-[12.5px] rounded-md'}
            >
              {v2Default ? 'v2 default: on' : 'Make v2 default'}
            </Button>
          </div>
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

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[13px] text-slate-100 font-medium">Sign out</div>
              <div className="text-[12px] text-slate-500 mt-0.5">
                Clears your session and returns to the v2 login.
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={signOut}
              className="bg-transparent border border-red-500/30 text-red-400 hover:bg-red-500/10 h-8 px-3 text-[12.5px] rounded-md"
            >
              Sign out
            </Button>
          </div>
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
