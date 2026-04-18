// Phase 3B — Connections.
//
// Per-integration connect / disconnect / test / scope panel.
// Everything here routes through the existing v1 service layer — no
// new OAuth code. Each integration exposes four actions:
//   • Refresh status (cheap local / edge probe)
//   • Connect (login / OAuth)
//   • Test connection (live API ping)
//   • Disconnect (clear tokens)
//
// Scope inspection is read-only — we surface whatever identifier and
// scope list each service already knows about.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, XCircle, Loader2, AlertCircle, RefreshCw, Activity,
  Plug, Unplug, Database, Mail, Ship, Landmark,
} from 'lucide-react';
import { Card, CardBody, Badge } from '../primitives';
import { cn } from '../primitives/utils';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import {
  connectToQuickBooks, disconnectQuickBooks, getQBConnectionStatus,
  fetchQBCustomers,
} from '../../services/quickbooksService';
import {
  ProcessorKey, initializeMsal, getAccountFor, loginFor, logoutFor, loginRequest,
  getGoogleAccount, loginForGoogle, logoutGoogle, getTokenForGoogle,
} from '../../services/smailAuth';
import { getUserProfile } from '../../services/smailGraph';
import { getSupabaseClient, checkSupabaseConnection } from '../../services/supabase';
import { getEdgeToken, clearEdgeToken } from '../../services/edgeAuth';

// ── Types ────────────────────────────────────────────────────────

type Status = 'connected' | 'disconnected' | 'unknown' | 'error';

interface IntegrationState {
  status: Status;
  identity: string | null;     // email, realmId, etc.
  scopes: string[];            // granted scopes (may be empty)
  lastChecked: string | null;  // ISO timestamp
  errorMessage: string | null; // surfaced on status = 'error'
  details: Record<string, string>; // key/value metadata for "Scope" block
}

const EMPTY_STATE: IntegrationState = {
  status: 'unknown',
  identity: null,
  scopes: [],
  lastChecked: null,
  errorMessage: null,
  details: {},
};

// ── Component ────────────────────────────────────────────────────

const ConnectionsV2: React.FC = () => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const companyId = currentCompanyId || 'ALL';

  const [supabase,   setSupabase]   = useState<IntegrationState>(EMPTY_STATE);
  const [qb,         setQb]         = useState<IntegrationState>(EMPTY_STATE);
  const [msPrimary,  setMsPrimary]  = useState<IntegrationState>(EMPTY_STATE);
  const [msAuto,     setMsAuto]     = useState<IntegrationState>(EMPTY_STATE);
  const [gmail,      setGmail]      = useState<IntegrationState>(EMPTY_STATE);

  // Action flags per integration so individual buttons spin
  // independently.
  const [busy, setBusy] = useState<Record<string, string | null>>({});
  const setBusyFor = (id: string, action: string | null) =>
    setBusy(prev => ({ ...prev, [id]: action }));

  // ── Status readers ────────────────────────────────────────────

  const refreshSupabase = useCallback(async () => {
    setBusyFor('supabase', 'refresh');
    const client = getSupabaseClient();
    try {
      const ok = await checkSupabaseConnection();
      const edgeToken = getEdgeToken();
      setSupabase({
        status: ok ? 'connected' : 'disconnected',
        identity: client ? 'qfskvevighylzzmyiwre.supabase.co' : null,
        scopes: edgeToken ? ['edge-auth', 'user-jwt'] : ['anon'],
        lastChecked: new Date().toISOString(),
        errorMessage: null,
        details: {
          'Project': 'qfskvevighylzzmyiwre',
          'Edge token': edgeToken ? 'present (sessionStorage)' : 'missing',
          'Anon client': client ? 'ready' : 'not initialized',
        },
      });
    } catch (err) {
      setSupabase({
        ...EMPTY_STATE,
        status: 'error',
        lastChecked: new Date().toISOString(),
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyFor('supabase', null);
    }
  }, []);

  const refreshQb = useCallback(async () => {
    setBusyFor('qb', 'refresh');
    try {
      const res = await getQBConnectionStatus(companyId);
      setQb({
        status: res.connected ? 'connected' : 'disconnected',
        identity: res.realmId ?? null,
        scopes: res.connected ? ['com.intuit.quickbooks.accounting'] : [],
        lastChecked: new Date().toISOString(),
        errorMessage: null,
        details: {
          'Company':        companyId,
          'Realm ID':       res.realmId ?? '—',
          'Company name':   res.companyName ?? '—',
          'Last refreshed': res.lastRefreshed ?? '—',
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQb({
        ...EMPTY_STATE,
        status: msg.includes('not connected') || msg.includes('reconnect') ? 'disconnected' : 'error',
        lastChecked: new Date().toISOString(),
        errorMessage: msg,
      });
    } finally {
      setBusyFor('qb', null);
    }
  }, [companyId]);

  const refreshMs = useCallback(async (key: ProcessorKey) => {
    const id = `ms-${key}`;
    const setter = key === 'my' ? setMsPrimary : setMsAuto;
    setBusyFor(id, 'refresh');
    try {
      await initializeMsal();
      const account = getAccountFor(key);
      if (!account) {
        setter({
          ...EMPTY_STATE,
          status: 'disconnected',
          lastChecked: new Date().toISOString(),
        });
        return;
      }
      setter({
        status: 'connected',
        identity: account.username,
        scopes: loginRequest.scopes ?? [],
        lastChecked: new Date().toISOString(),
        errorMessage: null,
        details: {
          'Account email':    account.username ?? '—',
          'Home account id':  account.homeAccountId?.slice(0, 16) + '…',
          'Tenant':           account.tenantId ?? '—',
          'Local account id': account.localAccountId?.slice(0, 16) + '…',
        },
      });
    } catch (err) {
      setter({
        ...EMPTY_STATE,
        status: 'error',
        lastChecked: new Date().toISOString(),
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyFor(id, null);
    }
  }, []);

  const refreshGmail = useCallback(async () => {
    setBusyFor('gmail', 'refresh');
    try {
      const acc = getGoogleAccount();
      if (!acc) {
        setGmail({
          ...EMPTY_STATE,
          status: 'disconnected',
          lastChecked: new Date().toISOString(),
        });
        return;
      }
      const expiryRaw = localStorage.getItem('smail.google.expiry');
      const expiry = expiryRaw ? new Date(Number(expiryRaw)) : null;
      const expired = expiry ? expiry.getTime() < Date.now() : true;
      setGmail({
        status: expired ? 'disconnected' : 'connected',
        identity: acc.email,
        scopes: [
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/gmail.send',
          'https://www.googleapis.com/auth/userinfo.email',
        ],
        lastChecked: new Date().toISOString(),
        errorMessage: expired ? 'Token expired — reconnect to refresh.' : null,
        details: {
          'Email':     acc.email,
          'Expires':   expiry ? expiry.toLocaleString() : '—',
          'Expired':   expired ? 'yes' : 'no',
        },
      });
    } catch (err) {
      setGmail({
        ...EMPTY_STATE,
        status: 'error',
        lastChecked: new Date().toISOString(),
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyFor('gmail', null);
    }
  }, []);

  // Initial + company-change refresh.
  useEffect(() => {
    refreshSupabase();
    refreshQb();
    refreshMs('my');
    refreshMs('automation');
    refreshGmail();
  }, [refreshSupabase, refreshQb, refreshMs, refreshGmail]);

  // ── Test connection (live API ping) ──────────────────────────

  const testSupabase = useCallback(async () => {
    setBusyFor('supabase', 'test');
    try {
      const ok = await checkSupabaseConnection();
      if (ok) {
        toast.push({ kind: 'success', title: 'Supabase reachable', description: 'auth.getSession() returned OK.' });
      } else {
        toast.push({ kind: 'error', title: 'Supabase unreachable', description: 'Client did not respond.' });
      }
    } catch (err) {
      toast.push({
        kind: 'error', title: 'Supabase test failed',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyFor('supabase', null);
    }
  }, [toast]);

  const testQb = useCallback(async () => {
    setBusyFor('qb', 'test');
    try {
      const customers = await fetchQBCustomers(companyId);
      toast.push({
        kind: 'success',
        title: 'QuickBooks reachable',
        description: `Fetched ${customers.length} customer${customers.length === 1 ? '' : 's'}.`,
      });
      // Refresh metadata after a successful live ping.
      await refreshQb();
    } catch (err) {
      toast.push({
        kind: 'error', title: 'QuickBooks test failed',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyFor('qb', null);
    }
  }, [companyId, toast, refreshQb]);

  const testMs = useCallback(async (key: ProcessorKey) => {
    const id = `ms-${key}`;
    setBusyFor(id, 'test');
    try {
      const profile = await getUserProfile(key);
      if (profile && typeof profile === 'object' && 'mail' in profile) {
        const p = profile as { mail?: string; userPrincipalName?: string; displayName?: string };
        toast.push({
          kind: 'success',
          title: 'Microsoft Graph reachable',
          description: `/me → ${p.displayName ?? p.userPrincipalName ?? p.mail ?? 'OK'}`,
        });
      } else {
        toast.push({ kind: 'warning', title: 'Microsoft Graph returned', description: 'Unexpected payload — check console.' });
      }
      await refreshMs(key);
    } catch (err) {
      toast.push({
        kind: 'error', title: 'Microsoft Graph test failed',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyFor(id, null);
    }
  }, [toast, refreshMs]);

  const testGmail = useCallback(async () => {
    setBusyFor('gmail', 'test');
    try {
      const token = await getTokenForGoogle();
      const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const profile = await res.json() as { email?: string };
        toast.push({
          kind: 'success',
          title: 'Gmail reachable',
          description: `userinfo → ${profile.email ?? 'OK'}`,
        });
      } else {
        toast.push({
          kind: 'error', title: 'Gmail test failed',
          description: `HTTP ${res.status}`,
        });
      }
      await refreshGmail();
    } catch (err) {
      toast.push({
        kind: 'error', title: 'Gmail test failed',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyFor('gmail', null);
    }
  }, [toast, refreshGmail]);

  // ── Connect / Disconnect ──────────────────────────────────────

  const connectSupabase = useCallback(() => {
    toast.push({
      kind: 'info',
      title: 'Supabase sign-in',
      description: 'Use the main login screen to issue a new edge-auth token.',
    });
  }, [toast]);

  const disconnectSupabase = useCallback(() => {
    clearEdgeToken();
    toast.push({ kind: 'success', title: 'Edge token cleared', description: 'Sign in again to restore authenticated edge calls.' });
    refreshSupabase();
  }, [toast, refreshSupabase]);

  const connectQb = useCallback(async () => {
    setBusyFor('qb', 'connect');
    try {
      const ok = await connectToQuickBooks(companyId);
      if (ok) {
        toast.push({ kind: 'success', title: 'QuickBooks connected' });
        await refreshQb();
      } else {
        toast.push({ kind: 'warning', title: 'QuickBooks connect cancelled' });
      }
    } catch (err) {
      toast.push({
        kind: 'error', title: 'QuickBooks connect failed',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyFor('qb', null);
    }
  }, [companyId, toast, refreshQb]);

  const disconnectQb = useCallback(async () => {
    setBusyFor('qb', 'disconnect');
    try {
      await disconnectQuickBooks(companyId);
      toast.push({ kind: 'success', title: 'QuickBooks disconnected' });
      await refreshQb();
    } catch (err) {
      toast.push({
        kind: 'error', title: 'QuickBooks disconnect failed',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyFor('qb', null);
    }
  }, [companyId, toast, refreshQb]);

  const connectMs = useCallback(async (key: ProcessorKey) => {
    const id = `ms-${key}`;
    setBusyFor(id, 'connect');
    try {
      await initializeMsal();
      const account = await loginFor(key, loginRequest.scopes);
      toast.push({
        kind: 'success',
        title: 'Microsoft 365 connected',
        description: account.username,
      });
      await refreshMs(key);
    } catch (err) {
      toast.push({
        kind: 'error', title: 'Microsoft 365 connect failed',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyFor(id, null);
    }
  }, [toast, refreshMs]);

  const disconnectMs = useCallback(async (key: ProcessorKey) => {
    const id = `ms-${key}`;
    setBusyFor(id, 'disconnect');
    try {
      await logoutFor(key);
      toast.push({ kind: 'success', title: 'Microsoft 365 disconnected' });
      await refreshMs(key);
    } catch (err) {
      toast.push({
        kind: 'error', title: 'Microsoft 365 disconnect failed',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyFor(id, null);
    }
  }, [toast, refreshMs]);

  const connectGmail = useCallback(async () => {
    setBusyFor('gmail', 'connect');
    try {
      const result = await loginForGoogle();
      toast.push({
        kind: 'success',
        title: 'Gmail connected',
        description: result.email,
      });
      await refreshGmail();
    } catch (err) {
      toast.push({
        kind: 'error', title: 'Gmail connect failed',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyFor('gmail', null);
    }
  }, [toast, refreshGmail]);

  const disconnectGmail = useCallback(() => {
    logoutGoogle();
    toast.push({ kind: 'success', title: 'Gmail disconnected' });
    refreshGmail();
  }, [toast, refreshGmail]);

  // ── Render ───────────────────────────────────────────────────

  const panels = useMemo(() => ([
    {
      id: 'supabase',
      icon: <Database size={18} />,
      iconTint: 'bg-emerald-500/10 text-emerald-300',
      name: 'Supabase',
      description: 'Primary data store · Edge Functions · RLS policies',
      state: supabase,
      onConnect: connectSupabase,
      onDisconnect: disconnectSupabase,
      onTest: testSupabase,
      onRefresh: refreshSupabase,
      connectDisabled: true,
      connectLabel: 'Sign in (use login screen)',
    },
    {
      id: 'qb',
      icon: <Landmark size={18} />,
      iconTint: 'bg-green-500/10 text-green-300',
      name: 'QuickBooks Online',
      description: 'Customer statements · payables · receivables sync',
      state: qb,
      onConnect: connectQb,
      onDisconnect: disconnectQb,
      onTest: testQb,
      onRefresh: refreshQb,
    },
    {
      id: 'ms-my',
      icon: <Mail size={18} />,
      iconTint: 'bg-blue-500/10 text-blue-300',
      name: 'Microsoft 365 — Primary',
      description: 'Your inbox · AI Email Assistant · Outlook send',
      state: msPrimary,
      onConnect: () => connectMs('my'),
      onDisconnect: () => disconnectMs('my'),
      onTest: () => testMs('my'),
      onRefresh: () => refreshMs('my'),
    },
    {
      id: 'ms-automation',
      icon: <Ship size={18} />,
      iconTint: 'bg-indigo-500/10 text-indigo-300',
      name: 'Microsoft 365 — Automation',
      description: 'Shared automation mailbox for outbound agent emails',
      state: msAuto,
      onConnect: () => connectMs('automation'),
      onDisconnect: () => disconnectMs('automation'),
      onTest: () => testMs('automation'),
      onRefresh: () => refreshMs('automation'),
    },
    {
      id: 'gmail',
      icon: <Mail size={18} />,
      iconTint: 'bg-red-500/10 text-red-300',
      name: 'Google Gmail',
      description: 'Gmail send + read via Google Identity Services',
      state: gmail,
      onConnect: connectGmail,
      onDisconnect: disconnectGmail,
      onTest: testGmail,
      onRefresh: refreshGmail,
    },
  ] as const), [
    supabase, qb, msPrimary, msAuto, gmail,
    connectSupabase, disconnectSupabase, testSupabase, refreshSupabase,
    connectQb, disconnectQb, testQb, refreshQb,
    connectMs, disconnectMs, testMs, refreshMs,
    connectGmail, disconnectGmail, testGmail, refreshGmail,
  ]);

  return (
    <div className="max-w-[980px] space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">
            Connections
          </h1>
          <Badge variant="info">Live</Badge>
        </div>
        <p className="text-[13px] text-slate-500 mt-1">
          Per-integration connect, disconnect, test, and scope inspection.
          All actions route through the existing v1 service layer — no new OAuth code.
        </p>
      </div>

      {panels.map(p => (
        <IntegrationPanel
          key={p.id}
          id={p.id}
          icon={p.icon}
          iconTint={p.iconTint}
          name={p.name}
          description={p.description}
          state={p.state}
          busy={busy[p.id] ?? null}
          onConnect={p.onConnect}
          onDisconnect={p.onDisconnect}
          onTest={p.onTest}
          onRefresh={p.onRefresh}
          connectDisabled={'connectDisabled' in p ? p.connectDisabled : false}
          connectLabel={'connectLabel' in p ? p.connectLabel : 'Connect'}
        />
      ))}
    </div>
  );
};

// ── Panel ────────────────────────────────────────────────────────

interface PanelProps {
  id: string;
  icon: React.ReactNode;
  iconTint: string;
  name: string;
  description: string;
  state: IntegrationState;
  busy: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onTest: () => void;
  onRefresh: () => void;
  connectDisabled?: boolean;
  connectLabel?: string;
}

const IntegrationPanel: React.FC<PanelProps> = ({
  icon, iconTint, name, description, state, busy,
  onConnect, onDisconnect, onTest, onRefresh,
  connectDisabled = false, connectLabel = 'Connect',
}) => {
  const isConnected = state.status === 'connected';

  return (
    <Card>
      <CardBody>
        <div className="flex items-start gap-3">
          <div className={cn('p-2 rounded-md shrink-0', iconTint)}>{icon}</div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-slate-100">{name}</span>
                  <StatusBadge status={state.status} />
                </div>
                <div className="text-[12px] text-slate-500 mt-0.5">{description}</div>
                {state.identity && (
                  <div className="text-[11.5px] text-slate-400 mt-1 font-mono truncate">
                    {state.identity}
                  </div>
                )}
                {state.errorMessage && (
                  <div className="text-[11.5px] text-red-300 mt-1 flex items-center gap-1">
                    <AlertCircle size={10} /> {state.errorMessage}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <ActionButton
                  onClick={onRefresh}
                  busy={busy === 'refresh'}
                  icon={<RefreshCw size={11} />}
                  label="Refresh"
                  tone="ghost"
                />
                <ActionButton
                  onClick={onTest}
                  busy={busy === 'test'}
                  icon={<Activity size={11} />}
                  label="Test"
                  tone="ghost"
                  disabled={!isConnected}
                />
                {isConnected ? (
                  <ActionButton
                    onClick={onDisconnect}
                    busy={busy === 'disconnect'}
                    icon={<Unplug size={11} />}
                    label="Disconnect"
                    tone="danger"
                  />
                ) : (
                  <ActionButton
                    onClick={onConnect}
                    busy={busy === 'connect'}
                    icon={<Plug size={11} />}
                    label={connectLabel}
                    tone="primary"
                    disabled={connectDisabled}
                  />
                )}
              </div>
            </div>

            {/* Scope + details */}
            {(state.scopes.length > 0 || Object.keys(state.details).length > 0) && (
              <div className="mt-3 pt-3 border-t border-[#1f1f1f] grid grid-cols-1 md:grid-cols-2 gap-3">
                {state.scopes.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1.5">
                      Scopes
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {state.scopes.map(s => (
                        <span
                          key={s}
                          className="inline-flex items-center px-1.5 py-0.5 rounded-sm bg-[#0f0f0f] border border-[#1f1f1f] text-[10.5px] text-slate-400 font-mono"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {Object.keys(state.details).length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1.5">
                      Details
                    </div>
                    <dl className="space-y-1 text-[11px]">
                      {Object.entries(state.details).map(([k, v]) => (
                        <div key={k} className="flex items-start gap-2">
                          <dt className="text-slate-500 w-28 shrink-0">{k}</dt>
                          <dd className="text-slate-300 font-mono truncate min-w-0 flex-1">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
              </div>
            )}

            {state.lastChecked && (
              <div className="mt-2 text-[10.5px] text-slate-600">
                Last checked {new Date(state.lastChecked).toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
};

const StatusBadge: React.FC<{ status: Status }> = ({ status }) => {
  switch (status) {
    case 'connected':
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[10.5px] font-medium">
          <CheckCircle2 size={10} /> Connected
        </span>
      );
    case 'disconnected':
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-[#0f0f0f] text-slate-400 border border-[#1f1f1f] text-[10.5px] font-medium">
          <XCircle size={10} /> Disconnected
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-red-500/10 text-red-300 border border-red-500/20 text-[10.5px] font-medium">
          <AlertCircle size={10} /> Error
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-[#0f0f0f] text-slate-500 border border-[#1f1f1f] text-[10.5px] font-medium">
          <Loader2 size={10} className="animate-spin" /> Checking
        </span>
      );
  }
};

interface ActionButtonProps {
  onClick: () => void;
  busy: boolean;
  icon: React.ReactNode;
  label: string;
  tone: 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
}

const ActionButton: React.FC<ActionButtonProps> = ({ onClick, busy, icon, label, tone, disabled }) => {
  const toneClass =
    tone === 'primary'
      ? 'bg-indigo-600 text-white hover:bg-indigo-500'
      : tone === 'danger'
        ? 'bg-red-500/10 text-red-300 border border-red-500/30 hover:bg-red-500/20'
        : 'bg-[#141414] border border-[#1f1f1f] text-slate-300 hover:bg-[#1a1a1a] hover:border-[#2a2a2a]';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={cn(
        'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors',
        disabled ? 'opacity-40 cursor-not-allowed' : '',
        busy ? 'opacity-70 cursor-wait' : '',
        toneClass,
      )}
    >
      {busy ? <Loader2 size={11} className="animate-spin" /> : icon}
      {label}
    </button>
  );
};

export default ConnectionsV2;
