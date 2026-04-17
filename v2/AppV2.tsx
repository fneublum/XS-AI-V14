// Phase 3A/B — v2 application shell.
// Mounts when index.tsx detects `?v2=1`.

import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { AuthProvider } from './providers/AuthProvider';
import { CompanyProvider } from './providers/CompanyProvider';
import { QueryProvider } from './providers/QueryProvider';
import { ToastProvider, useToast } from './primitives/Toast';
import { AppShell } from './layout/AppShell';

const DashboardV2 = lazy(() => import('./routes/DashboardV2'));
const CustomersV2 = lazy(() => import('./routes/CustomersV2'));

// Each section item either has `route: true` (navigable) or defaults to
// disabled placeholder until the corresponding Phase 3B port lands.
const sections = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { id: 'dashboard',       label: 'Dashboard',       hint: 'D', route: true },
      { id: 'customers',       label: 'Customers',       hint: 'C', route: true },
      { id: 'suppliers',       label: 'Suppliers',       count: 42,  disabled: true },
      { id: 'sales-orders',    label: 'Sales Orders',    count: 7,   disabled: true },
      { id: 'purchase-orders', label: 'Purchase Orders', disabled: true },
      { id: 'logistics',       label: 'Logistics',       disabled: true },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    items: [
      { id: 'receivables', label: 'Receivables', disabled: true },
      { id: 'payables',    label: 'Payables',    disabled: true },
      { id: 'commissions', label: 'Commissions', disabled: true },
    ],
  },
];

const routeTitles: Record<string, string> = {
  dashboard: 'Dashboard',
  customers: 'Customers',
};

const routeHotkeys: Record<string, string> = {
  d: 'dashboard',
  c: 'customers',
};

const Fallback: React.FC = () => (
  <div className="flex items-center justify-center h-[40vh] text-slate-500">
    <span aria-live="polite">Loading…</span>
  </div>
);

const AppV2Inner: React.FC = () => {
  const [activeId, setActiveId] = useState(() => {
    const stored = typeof window !== 'undefined'
      ? sessionStorage.getItem('xs_v2_active_route')
      : null;
    return stored && routeTitles[stored] ? stored : 'dashboard';
  });
  const toast = useToast();

  const navigate = useCallback((id: string) => {
    if (!routeTitles[id]) return; // ignore disabled/unknown items
    setActiveId(id);
    try { sessionStorage.setItem('xs_v2_active_route', id); } catch { /* noop */ }
  }, []);

  // Keyboard shortcut: plain letter with no modifier (Linear-style).
  // Ignored while typing in inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (target?.isContentEditable) return;
      const next = routeHotkeys[e.key.toLowerCase()];
      if (next) {
        e.preventDefault();
        navigate(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const breadcrumbs = useMemo(
    () => [
      { id: 'ws', label: 'ACME' },
      { id: activeId, label: routeTitles[activeId] ?? activeId, current: true },
    ],
    [activeId],
  );

  return (
    <AppShell
      sections={sections}
      activeId={activeId}
      onNavigate={navigate}
      workspace={{ name: 'XS-ERP', subtitle: 'v12' }}
      user={{ name: 'Felipe N.', role: 'Admin' }}
      breadcrumbs={breadcrumbs}
      onSearch={() => toast.push({
        kind: 'info',
        title: 'Command palette',
        description: 'Coming soon — for now press D or C to jump.',
      })}
      primaryAction={{
        label: '+ New order',
        onClick: () => toast.push({
          kind: 'success',
          title: 'New order',
          description: 'Wiring lands with the Sales Orders port.',
        }),
      }}
    >
      <Suspense fallback={<Fallback />}>
        {activeId === 'dashboard' && <DashboardV2 />}
        {activeId === 'customers' && <CustomersV2 />}
      </Suspense>
    </AppShell>
  );
};

const AppV2: React.FC = () => (
  <QueryProvider>
    <AuthProvider>
      <CompanyProvider>
        <ToastProvider>
          <AppV2Inner />
        </ToastProvider>
      </CompanyProvider>
    </AuthProvider>
  </QueryProvider>
);

export default AppV2;
