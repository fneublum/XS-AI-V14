// Phase 3A/B — v2 application shell.
// Mounts when index.tsx detects `?v2=1`.

import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { AuthProvider } from './providers/AuthProvider';
import { CompanyProvider } from './providers/CompanyProvider';
import { QueryProvider } from './providers/QueryProvider';
import { ToastProvider, useToast } from './primitives/Toast';
import { AppShell } from './layout/AppShell';
import { CompanySwitcher } from './layout/CompanySwitcher';
import { CommandPalette, PaletteCommand } from './layout/CommandPalette';

const DashboardV2    = lazy(() => import('./routes/DashboardV2'));
const CustomersV2    = lazy(() => import('./routes/CustomersV2'));
const SalesOrdersV2  = lazy(() => import('./routes/SalesOrdersV2'));

const sections = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { id: 'dashboard',       label: 'Dashboard',       hint: 'D', route: true },
      { id: 'customers',       label: 'Customers',       hint: 'C', route: true },
      { id: 'sales-orders',    label: 'Sales Orders',    hint: 'O', route: true },
      { id: 'suppliers',       label: 'Suppliers',       count: 42,  disabled: true },
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
  'dashboard':    'Dashboard',
  'customers':    'Customers',
  'sales-orders': 'Sales Orders',
};

const routeHotkeys: Record<string, string> = {
  d: 'dashboard',
  c: 'customers',
  o: 'sales-orders',
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const toast = useToast();

  const navigate = useCallback((id: string) => {
    if (!routeTitles[id]) return;
    setActiveId(id);
    try { sessionStorage.setItem('xs_v2_active_route', id); } catch { /* noop */ }
  }, []);

  // Single-letter hotkeys (outside inputs, no modifiers).
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

  const commands: PaletteCommand[] = useMemo(() => [
    // Navigation
    ...Object.entries(routeTitles).map<PaletteCommand>(([id, label]) => {
      const letter = Object.keys(routeHotkeys).find(k => routeHotkeys[k] === id);
      return {
        id: `nav.${id}`,
        label: `Go to ${label}`,
        hint: letter?.toUpperCase(),
        section: 'Navigate',
        keywords: `${label} ${id} page route`,
        onSelect: () => navigate(id),
      };
    }),
    // Actions
    {
      id: 'action.new-order',
      label: 'New sales order',
      section: 'Actions',
      keywords: 'create add quote SO',
      onSelect: () => toast.push({
        kind: 'success',
        title: 'New order',
        description: 'Wiring lands with the Sales Orders editor port.',
      }),
    },
    {
      id: 'action.new-customer',
      label: 'New customer',
      section: 'Actions',
      keywords: 'create add account',
      onSelect: () => toast.push({
        kind: 'info',
        title: 'New customer',
        description: 'Form editor lands next.',
      }),
    },
  ], [navigate, toast]);

  return (
    <>
      <AppShell
        sections={sections}
        activeId={activeId}
        onNavigate={navigate}
        workspace={{ name: 'XS-ERP', subtitle: 'v12' }}
        sidebarFooter={<CompanySwitcher />}
        breadcrumbs={breadcrumbs}
        onSearch={() => setPaletteOpen(true)}
        primaryAction={{
          label: '+ New order',
          onClick: () => toast.push({
            kind: 'success',
            title: 'New order',
            description: 'Wiring lands with the Sales Orders editor port.',
          }),
        }}
      >
        <Suspense fallback={<Fallback />}>
          {activeId === 'dashboard'    && <DashboardV2 />}
          {activeId === 'customers'    && <CustomersV2 />}
          {activeId === 'sales-orders' && <SalesOrdersV2 />}
        </Suspense>
      </AppShell>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        commands={commands}
      />
    </>
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
