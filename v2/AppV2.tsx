// Phase 3A/B — v2 application shell.
// Mounts when index.tsx detects `?v2=1`.

import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { AuthProvider } from './providers/AuthProvider';
import { CompanyProvider, useCompany } from './providers/CompanyProvider';
import { QueryProvider } from './providers/QueryProvider';
import { ToastProvider, useToast } from './primitives/Toast';
import { EditorProvider, useEditor } from './providers/EditorProvider';
import { AppShell } from './layout/AppShell';
import { CompanySwitcher } from './layout/CompanySwitcher';
import { CommandPalette, PaletteCommand, PaletteDataProvider } from './layout/CommandPalette';
import { SalesOrderDrawer } from './components/SalesOrderDrawer';
import { getSupabaseClient } from '../services/supabase';
import { SalesOrder } from './queries/useSalesOrders';

const DashboardV2      = lazy(() => import('./routes/DashboardV2'));
const CustomersV2      = lazy(() => import('./routes/CustomersV2'));
const SalesOrdersV2    = lazy(() => import('./routes/SalesOrdersV2'));
const SuppliersV2      = lazy(() => import('./routes/SuppliersV2'));
const PurchaseOrdersV2 = lazy(() => import('./routes/PurchaseOrdersV2'));

const sections = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { id: 'dashboard',       label: 'Dashboard',       hint: 'D' },
      { id: 'customers',       label: 'Customers',       hint: 'C' },
      { id: 'sales-orders',    label: 'Sales Orders',    hint: 'O' },
      { id: 'suppliers',       label: 'Suppliers',       hint: 'S' },
      { id: 'purchase-orders', label: 'Purchase Orders', hint: 'P' },
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
  'dashboard':       'Dashboard',
  'customers':       'Customers',
  'sales-orders':    'Sales Orders',
  'suppliers':       'Suppliers',
  'purchase-orders': 'Purchase Orders',
};

const routeHotkeys: Record<string, string> = {
  d: 'dashboard',
  c: 'customers',
  o: 'sales-orders',
  s: 'suppliers',
  p: 'purchase-orders',
};

const Fallback: React.FC = () => (
  <div className="flex items-center justify-center h-[40vh] text-slate-500">
    <span aria-live="polite">Loading…</span>
  </div>
);

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

const AppV2Inner: React.FC = () => {
  const [activeId, setActiveId] = useState(() => {
    const stored = typeof window !== 'undefined'
      ? sessionStorage.getItem('xs_v2_active_route')
      : null;
    return stored && routeTitles[stored] ? stored : 'dashboard';
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const { editingSalesOrder, openSalesOrder, closeSalesOrder } = useEditor();

  const navigate = useCallback((id: string) => {
    if (!routeTitles[id]) return;
    setActiveId(id);
    try { sessionStorage.setItem('xs_v2_active_route', id); } catch { /* noop */ }
  }, []);

  // Single-letter hotkeys outside inputs.
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

  // Static palette commands.
  const commands: PaletteCommand[] = useMemo(() => [
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

  // Async palette providers — search customers + sales orders live.
  const dataProviders: PaletteDataProvider[] = useMemo(() => [
    {
      id: 'customers',
      section: 'Customers',
      minQueryLength: 2,
      fetch: async (query, signal) => {
        const supabase = getSupabaseClient();
        const base = scopeByCompany(
          supabase.from('customers')
            .select('id, name, email, country')
            .order('name')
            .limit(6),
          currentCompanyId,
        );
        const { data, error } = await base.ilike('name', `%${query}%`).abortSignal(signal);
        if (error || !data) return [];
        return (data as Array<{ id: string; name: string; email: string | null; country: string | null }>)
          .map(c => ({
            id: `cust.${c.id}`,
            label: c.name,
            hint: c.country ?? c.email ?? '',
            section: 'Customers',
            onSelect: () => {
              navigate('customers');
              toast.push({ kind: 'info', title: c.name, description: c.email ?? c.country ?? '' });
            },
          }));
      },
    },
    {
      id: 'sales-orders',
      section: 'Sales Orders',
      minQueryLength: 2,
      fetch: async (query, signal) => {
        const supabase = getSupabaseClient();
        const base = scopeByCompany(
          supabase.from('sales_orders')
            .select('id, orderNumber, customerName, status, totalAmount, currency, orderDate, createdAt, paymentTerms, incoterm, deliveryDate')
            .order('createdAt', { ascending: false })
            .limit(6),
          currentCompanyId,
        );
        const { data, error } = await base
          .or(`orderNumber.ilike.*${query}*,customerName.ilike.*${query}*`)
          .abortSignal(signal);
        if (error || !data) return [];
        return (data as Array<{
          id: string; orderNumber: string | null; customerName: string | null; status: string | null;
          totalAmount: number | null; currency: string | null; orderDate: string | null;
          createdAt: string | null; paymentTerms: string | null; incoterm: string | null;
          deliveryDate: string | null;
        }>).map(r => {
          const order: SalesOrder = {
            id: r.id,
            orderNumber: r.orderNumber ?? r.id,
            customerName: r.customerName ?? '—',
            status: r.status ?? 'PENDING',
            totalAmount: Number(r.totalAmount) || 0,
            currency: r.currency ?? 'USD',
            orderDate: r.orderDate ?? '',
            createdAt: r.createdAt ?? '',
            paymentTerms: r.paymentTerms,
            incoterm: r.incoterm,
            deliveryDate: r.deliveryDate,
          };
          return {
            id: `so.${r.id}`,
            label: `${order.orderNumber} · ${order.customerName}`,
            hint: order.status,
            section: 'Sales Orders',
            onSelect: () => openSalesOrder(order),
          };
        });
      },
    },
  ], [currentCompanyId, navigate, toast, openSalesOrder]);

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
          {activeId === 'dashboard'       && <DashboardV2 />}
          {activeId === 'customers'       && <CustomersV2 />}
          {activeId === 'sales-orders'    && <SalesOrdersV2 />}
          {activeId === 'suppliers'       && <SuppliersV2 />}
          {activeId === 'purchase-orders' && <PurchaseOrdersV2 />}
        </Suspense>
      </AppShell>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        commands={commands}
        dataProviders={dataProviders}
      />

      <SalesOrderDrawer
        order={editingSalesOrder}
        onOpenChange={open => { if (!open) closeSalesOrder(); }}
      />
    </>
  );
};

const AppV2: React.FC = () => (
  <QueryProvider>
    <AuthProvider>
      <CompanyProvider>
        <ToastProvider>
          <EditorProvider>
            <AppV2Inner />
          </EditorProvider>
        </ToastProvider>
      </CompanyProvider>
    </AuthProvider>
  </QueryProvider>
);

export default AppV2;
