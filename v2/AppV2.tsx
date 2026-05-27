// Phase 3A/B — v2 application shell.
// Mounts when index.tsx detects `?v2=1`.

import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { AuthProvider, useAuth } from './providers/AuthProvider';
import { CompanyProvider, useCompany } from './providers/CompanyProvider';
import { useCompanies } from './queries/useCompanies';
import { formatDate } from './lib/formatDate';
import { QueryProvider } from './providers/QueryProvider';
import { ToastProvider, useToast } from './primitives/Toast';
import { EditorProvider, useEditor } from './providers/EditorProvider';
import { AppShell } from './layout/AppShell';
import {
  LayoutDashboard, Sparkles,
  ShoppingCart, FileSignature, Package, Receipt, BellRing,
  Briefcase, ClipboardCheck,
  Calculator, CalendarCheck, Ship,
  Wallet, ArrowDownLeft, ArrowUpRight, Briefcase as BriefcaseIcon,
  Database, Settings as SettingsIcon,
  Building2, Compass, Handshake, Truck, Banknote, Wrench,
  ShieldAlert,
  Bot,
} from 'lucide-react';
import { CompanySwitcher } from './layout/CompanySwitcher';
import { CommandPalette, PaletteCommand, PaletteDataProvider } from './layout/CommandPalette';
import { SalesOrderDrawer }    from './components/SalesOrderDrawer';
import { CustomerDrawer }      from './components/CustomerDrawer';
import { SupplierDrawer }      from './components/SupplierDrawer';
import { InvoiceDrawer }       from './components/InvoiceDrawer';
import { PurchaseOrderDrawer } from './components/PurchaseOrderDrawer';
import { CommissionDrawer } from './components/CommissionDrawer';
import { ProductDrawer }    from './components/ProductDrawer';
import { ShortcutsHelp, ShortcutGroup } from './layout/ShortcutsHelp';
import { DataMenuModal } from './layout/DataMenuModal';
import { SettingsMenuModal } from './layout/SettingsMenuModal';
import { SessionExpiredBanner } from './components/SessionExpiredBanner';
import { getSupabaseClient } from '../services/supabase';
import { SalesOrder } from './queries/useSalesOrders';
import { useBackgroundJobs } from './hooks/useBackgroundJobs';
import { setInboxLogUser } from './services/inboxLog';
import { Dock } from './layout/Dock';

const DashboardV2       = lazy(() => import('./routes/DashboardV2'));
const CustomersV2       = lazy(() => import('./routes/CustomersV2'));
const SuppliersV2       = lazy(() => import('./routes/SuppliersV2'));
const SalesOrdersV2     = lazy(() => import('./routes/SalesOrdersV2'));
const PurchaseOrdersV2     = lazy(() => import('./routes/PurchaseOrdersV2'));
const PurchaseCostWizardV2 = lazy(() => import('./routes/PurchaseCostWizardV2'));
const OpportunitiesV2   = lazy(() => import('./routes/OpportunitiesV2'));
const ProductsV2        = lazy(() => import('./routes/ProductsV2'));
const InventoryV2       = lazy(() => import('./routes/InventoryV2'));
const FreightQuotesV2   = lazy(() => import('./routes/FreightQuotesV2'));
const BookingsV2        = lazy(() => import('./routes/BookingsV2'));
const ShipmentsV2       = lazy(() => import('./routes/ShipmentsV2'));
const BillOfLadingsV2   = lazy(() => import('./routes/BillOfLadingsV2'));
const DocumentAuditV2   = lazy(() => import('./routes/DocumentAuditV2'));
const AiDraftsV2        = lazy(() => import('./routes/AiDraftsV2'));
const PackingListsV2    = lazy(() => import('./routes/PackingListsV2'));
const InvoicesV2        = lazy(() => import('./routes/InvoicesV2'));
const ReceivablesV2     = lazy(() => import('./routes/ReceivablesV2'));
const PayablesV2        = lazy(() => import('./routes/PayablesV2'));
const CommissionsV2     = lazy(() => import('./routes/CommissionsV2'));
const CustomerBalancesV2 = lazy(() => import('./routes/CustomerBalancesV2'));
const AiSalesV2          = lazy(() => import('./routes/AiSalesV2'));
const TradingFollowUpV2    = lazy(() => import('./routes/TradingFollowUpV2'));
const LogisticsFollowUpV2  = lazy(() => import('./routes/LogisticsFollowUpV2'));
const AgentFollowUpV2      = lazy(() => import('./routes/AgentFollowUpV2'));
const AdminUsersV2      = lazy(() => import('./routes/AdminUsersV2'));
const AdminCompaniesV2  = lazy(() => import('./routes/AdminCompaniesV2'));
const AdminCargoAgentsV2 = lazy(() => import('./routes/AdminCargoAgentsV2'));
const AdminCarriersV2    = lazy(() => import('./routes/AdminCarriersV2'));
const AdminPortsV2       = lazy(() => import('./routes/AdminPortsV2'));
const AdminLocationsV2   = lazy(() => import('./routes/AdminLocationsV2'));
const AiDashboardV2         = lazy(() => import('./routes/AiDashboardV2'));
const AiUploadV2            = lazy(() => import('./routes/AiUploadV2'));
const AiEmailAssistantV2    = lazy(() => import('./routes/AiEmailAssistantV2'));
const AiLogisticsManagerV2  = lazy(() => import('./routes/AiLogisticsManagerV2'));
const EmailAgentV2          = lazy(() => import('./routes/EmailAgentV2'));
const SettingsV2            = lazy(() => import('./routes/SettingsV2'));
const ConnectionsV2         = lazy(() => import('./routes/ConnectionsV2'));
const ConnectionsHubV2      = lazy(() => import('./routes/ConnectionsHubV2'));
const AiInboxV2             = lazy(() => import('./routes/AiInboxV2'));
const PLV2                  = lazy(() => import('./routes/PLV2'));
const LogisticsDocsV2       = lazy(() => import('./routes/LogisticsDocsV2'));
const AgentSalesOrdersV2    = lazy(() => import('./routes/AgentSalesOrdersV2'));
const PLInvoiceEngineV2     = lazy(() => import('./routes/PLInvoiceEngineV2'));
const CostProfitAIV2        = lazy(() => import('./routes/CostProfitAIV2'));
const LoginV2               = lazy(() => import('./routes/LoginV2'));
const PaymentTermsV2        = lazy(() => import('./routes/PaymentTermsV2'));
const AgentPortalV2         = lazy(() => import('./routes/AgentPortalV2'));
const AgenticConsoleV2      = lazy(() => import('./routes/AgenticConsoleV2'));

// Sidebar layout — matches the 2026-04-18 spec. Workspace holds the
// overview + AI surfaces, Trading / Agent Sales / Logistics / Finance
// hold the transactional views, and Data / Settings open pop-up menus
// instead of routing. The pop-ups dispatch into v2 routes where they
// exist and hand off to v1 otherwise (see DataMenuModal + the
// xs_pending_v1_nav handshake in App.tsx).
const buildSections = (
  openDataMenu: () => void,
  openSettingsMenu: () => void,
  userRole?: string,
): import('./layout/Sidebar').SidebarSection[] => {
  // Cargo Agent users get a scoped sidebar — only their portal.
  if (userRole === 'Cargo Agent') {
    return [{
      id: 'portal',
      label: 'Portal',
      items: [
        { id: 'agent-portal-quotes',   label: 'Freight Quotes' },
        { id: 'agent-portal-bookings', label: 'Bookings' },
      ],
    }];
  }
  return [
  {
    id: 'workspace',
    label: 'Workspace',
    accent: 'indigo',
    icon: Building2,
    items: [
      { id: 'dashboard',        label: 'Dashboard',     icon: LayoutDashboard },
      // Agents Console used to live in its own AGENTS section. Moved
      // here so the operator finds it adjacent to the Dashboard chat
      // that mentions the same agents.
      { id: 'agentic-console',  label: 'Agents console', icon: Bot },
      { id: 'ai-sales',         label: 'AI Sales Agent', icon: Sparkles },
    ],
  },
  {
    id: 'trading',
    label: 'Trading',
    accent: 'sky',
    icon: Compass,
    items: [
      { id: 'purchase-orders',  label: 'Purchase & cost',          icon: ShoppingCart },
      // 'Purchase Orders' standalone menu entry removed — the PO list
      // is now Step 5 of the Purchase & cost wizard. The route
      // 'purchase-orders-list' is kept in the dispatcher so existing
      // deep-links still resolve, but it's no longer a sidebar item.
      { id: 'sales-orders',     label: 'Sales Orders (Proformas)', icon: FileSignature },
      { id: 'pl-invoice',       label: 'Packing list & Invoice',   icon: Package },
      { id: 'invoices',         label: 'Invoice & docs',           icon: Receipt },
      { id: 'trading-followup', label: 'Trading Follow Up',        icon: BellRing },
    ],
  },
  {
    id: 'agent-sales',
    label: 'Agent Sales',
    accent: 'violet',
    icon: Handshake,
    items: [
      { id: 'sopici',           label: 'Agent Sales Orders', icon: Briefcase },
      { id: 'agent-followup',   label: 'Agent Follow Up',    icon: ClipboardCheck },
    ],
  },
  {
    id: 'logistics',
    label: 'Logistics',
    accent: 'amber',
    icon: Truck,
    items: [
      { id: 'freight-quotes',     label: 'Freight Quotes',     icon: Calculator },
      { id: 'bookings',           label: 'Bookings',           icon: CalendarCheck },
      { id: 'bol',                label: 'Bill of Ladings',    icon: Ship },
      { id: 'document-audit',     label: 'Document Audit',     icon: ShieldAlert },
      { id: 'ai-drafts',          label: 'AI Drafts',          icon: Sparkles },
      { id: 'logistics-followup', label: 'Logistics Follow Up', icon: BellRing },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    accent: 'emerald',
    icon: Banknote,
    items: [
      { id: 'payables',          label: 'Payables',          icon: ArrowUpRight },
      { id: 'receivables',       label: 'Receivables',       icon: ArrowDownLeft },
      { id: 'customer-balances', label: 'Customer Balances', icon: Wallet },
    ],
  },
  {
    // Data / Settings are click-through menus — `onClick` wins over
    // `onSelect(id)` in Sidebar.tsx so they don't route.
    id: 'system',
    label: 'System',
    accent: 'slate',
    icon: Wrench,
    items: [
      { id: '__data',     label: 'Data',     icon: Database,    onClick: openDataMenu },
      { id: '__settings', label: 'Settings', icon: SettingsIcon, onClick: openSettingsMenu },
    ],
  },
  ];
};

const routeTitles: Record<string, string> = {
  'dashboard':       'Dashboard',
  // Workspace
  'ai-email':        'AI Email Assistant',
  'ai-upload':       'AI Upload',
  'ai-sales':        'AI Sales Agent',
  'ai-inbox':        'AI Inbox',
  'connections-hub': 'Agent log',
  'ai-logistics':    'AI Logistics',
  // Trading
  'purchase-orders': 'Purchase & cost',
  'purchase-orders-list': 'Purchase Orders',
  'sales-orders':    'Sales Orders (Proformas)',
  'pl-invoice':      'Packing list & Invoice',
  'invoices':        'Invoice & docs',
  'trading-followup': 'Trading Follow Up',
  // Agent Sales
  'sopici':          'Agent Sales Orders',
  'commissions':     'Commission Invoices',
  'agent-followup':  'Agent Follow Up',
  // Logistics
  'freight-quotes':    'Freight Quotes',
  'bookings':          'Bookings',
  'bol':               'Bill of Ladings',
  'document-audit':    'Document Audit',
  'ai-drafts':         'AI Drafts',
  'logistics-followup':'Logistics Follow Up',
  // Finance
  'payables':        'Payables',
  'receivables':     'Receivables',
  'customer-balances': 'Customer Balances',
  // Reachable via Data modal or command palette — not in the sidebar
  // tree but still valid routes.
  'customers':       'Customers',
  'suppliers':       'Suppliers',
  'products':        'Products',
  'inventory':       'Inventory',
  'opportunities':   'Opportunities',
  'shipments':       'Shipments',
  'packing-lists':   'Packing Lists',
  'logistics-docs':  'Logistics Docs',
  'payment-terms':   'Payment Terms',
  'cargo-agents':    'Cargo Agents',
  'carriers':        'Carriers',
  'ports':           'Ports',
  'locations':       'Locations',
  // Reachable via Settings modal
  'users':           'Users',
  'companies':       'Companies',
  'connections':     'Connections',
  'settings':        'Settings',
  // Finance deep-linked from other places
  'pl':              'P&L',
  'cost-profit':     'Cost / Profit AI',
  'ai-dashboard':    'AI Dashboard',
  'email-agent':     'Email Agent',
  'agent-portal-quotes':   'Freight Quotes',
  'agent-portal-bookings': 'Bookings',
  // Agents console (XS-agentic) — lives under Workspace.
  'agentic-console':      'Agents console',
};

// Single-letter hotkeys removed per user preference — navigation goes
// via sidebar click, the command palette (⌘K), or the floating Dock.
const routeHotkeys: Record<string, string> = {};

// Section each route belongs to, for breadcrumbs.
const routeSection: Record<string, string> = {
  'dashboard':       'Overview',
  // Workspace
  'agentic-console': 'Workspace',
  'ai-email':        'Workspace',
  'ai-upload':       'Workspace',
  'ai-sales':        'Workspace',
  'ai-inbox':        'Workspace',
  'connections-hub': 'Workspace',
  'ai-logistics':    'Workspace',
  'ai-dashboard':    'Workspace',
  'email-agent':     'Workspace',
  // Trading
  'purchase-orders': 'Trading',
  'purchase-orders-list': 'Trading',
  'sales-orders':    'Trading',
  'pl-invoice':      'Trading',
  'invoices':        'Trading',
  'trading-followup': 'Trading',
  // Agent Sales
  'sopici':          'Agent Sales',
  'commissions':     'Agent Sales',
  'agent-followup':  'Agent Sales',
  // Logistics
  'freight-quotes':     'Logistics',
  'bookings':           'Logistics',
  'bol':                'Logistics',
  'document-audit':     'Logistics',
  'ai-drafts':          'Logistics',
  'logistics-followup': 'Logistics',
  'shipments':       'Logistics',
  'packing-lists':   'Logistics',
  'logistics-docs':  'Logistics',
  // Finance
  'payables':        'Finance',
  'receivables':     'Finance',
  'customer-balances': 'Finance',
  'pl':              'Finance',
  'cost-profit':     'Finance',
  // Data
  'customers':       'Data',
  'suppliers':       'Data',
  'products':        'Data',
  'inventory':       'Data',
  'opportunities':   'Data',
  'payment-terms':   'Data',
  'cargo-agents':    'Data',
  'carriers':        'Data',
  'ports':           'Data',
  'locations':       'Data',
  // Settings
  'users':           'Settings',
  'companies':       'Settings',
  'connections':     'Settings',
  'settings':        'Settings',
  // Agent portal (Cargo Agent users only)
  'agent-portal-quotes':   'Portal',
  'agent-portal-bookings': 'Portal',
};

const Fallback: React.FC = () => (
  <div className="flex items-center justify-center h-[40vh] text-slate-500">
    <span aria-live="polite">Loading…</span>
  </div>
);

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

const shortcutGroups: ShortcutGroup[] = [
  {
    title: 'Global',
    items: [
      { keys: ['⌘', 'K'], label: 'Open command palette' },
      { keys: ['?'], label: 'Show keyboard shortcuts' },
      { keys: ['Esc'], label: 'Close any dialog or drawer' },
    ],
  },
  {
    title: 'Tables',
    items: [
      { keys: ['↵'], label: 'Open selected palette result' },
      { keys: ['Click'], label: 'Open editor drawer for a row' },
    ],
  },
];

const AppV2Inner: React.FC = () => {
  const [activeId, setActiveId] = useState(() => {
    const stored = typeof window !== 'undefined'
      ? sessionStorage.getItem('xs_v2_active_route')
      : null;
    // Legacy → current remap so sessions saved before the AGENTS-menu
    // consolidation don't land on a blank page. Stream/Autonomy/etc were
    // separate sidebar entries; they now live as tabs inside one Console
    // route. "Agent log" (connections-tabs) was removed entirely — its
    // content was a shallow duplicate of the Dashboard.
    const LEGACY_REMAP: Record<string, string> = {
      'agentic-stream':       'agentic-console',
      'agentic-autonomy':     'agentic-console',
      'agentic-capabilities': 'agentic-console',
      'agentic-audit':        'agentic-console',
      'connections-tabs':     'dashboard',
    };
    const resolved = stored && LEGACY_REMAP[stored] ? LEGACY_REMAP[stored] : stored;
    return resolved && routeTitles[resolved] ? resolved : 'dashboard';
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [dataMenuOpen, setDataMenuOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const toast = useToast();
  const { currentCompanyId, setCurrentCompanyId } = useCompany();
  const { user, loading: authLoading } = useAuth();
  const companies = useCompanies();

  // Auto-scope to the only accessible company. When a user has access
  // to a single company, the 'ALL' scope is meaningless — pin the
  // switcher to that company so every query, breadcrumb, and create
  // form gets the right companyId without an extra click. Also covers
  // the case where a stale sessionStorage value points outside the
  // user's now-narrower access list.
  useEffect(() => {
    const allowed = user?.allowedCompanies;
    if (!allowed || allowed.length === 0) return;
    if (allowed.length === 1 && currentCompanyId !== allowed[0]) {
      setCurrentCompanyId(allowed[0]);
      return;
    }
    if (allowed.length > 1 && currentCompanyId !== 'ALL' && !allowed.includes(currentCompanyId)) {
      setCurrentCompanyId(allowed[0]);
    }
  }, [user?.allowedCompanies, currentCompanyId, setCurrentCompanyId]);
  const {
    salesOrder, openSalesOrder, closeSalesOrder,
    customer, closeCustomer,
    supplier, closeSupplier,
    invoice, closeInvoice,
    purchaseOrder, closePurchaseOrder,
    commission, closeCommission,
    product, closeProduct,
  } = useEditor();

  // Autonomous background loop — scans inbox + flags stuck bookings.
  useBackgroundJobs();

  // Scope the inbox log to the current user so a shared browser
  // doesn't cross-contaminate histories.
  useEffect(() => { setInboxLogUser(user?.id); }, [user?.id]);

  // Cargo Agent users land on their portal and can't navigate elsewhere —
  // the sidebar is empty for them, but an old sessionStorage value could
  // still route them into a staff-only view. Pin to one of the two portal
  // routes; default to Freight Quotes.
  useEffect(() => {
    if (user?.role !== 'Cargo Agent') return;
    const portalRoutes = ['agent-portal-quotes', 'agent-portal-bookings'];
    if (!portalRoutes.includes(activeId)) {
      setActiveId('agent-portal-quotes');
      try { sessionStorage.setItem('xs_v2_active_route', 'agent-portal-quotes'); } catch { /* noop */ }
    }
  }, [user?.role, activeId]);

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

  // Global navigate bus — any deep child can request a route change
  // without prop-drilling via `window.dispatchEvent(new CustomEvent(
  // 'xs-v2-navigate', { detail: { id: 'bookings' } }))`.
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const id = (e as CustomEvent).detail?.id as string | undefined;
      if (id) navigate(id);
    };
    window.addEventListener('xs-v2-navigate', onNavigate);
    return () => window.removeEventListener('xs-v2-navigate', onNavigate);
  }, [navigate]);

  const breadcrumbs = useMemo(() => {
    // Dashboard gets a personalized greeting in place of the static
    // workspace / route breadcrumb — the route name already lives in
    // the sidebar's active highlight.
    if (activeId === 'dashboard') {
      const firstName = user?.name?.split(' ')[0] ?? 'there';
      // Mirror v1 Dashboard: when scope is ALL, resolve to user's first
      // allowed company, then fall back to the first loaded company.
      const list = companies.data ?? [];
      let resolvedId = currentCompanyId;
      if (resolvedId === 'ALL') {
        resolvedId = user?.allowedCompanies?.[0] ?? list[0]?.id ?? 'ALL';
      }
      const companyName = list.find(c => c.id === resolvedId)?.name
        ?? (currentCompanyId === 'ALL' ? 'All accessible' : currentCompanyId);
      const dateLabel = formatDate(new Date().toISOString());
      return [
        { id: 'greeting', label: `Hello, ${firstName}` },
        { id: 'company',  label: companyName },
        { id: 'date',     label: dateLabel, current: true },
      ];
    }
    const section = routeSection[activeId];
    // Leading crumb is the current company's name (resolves `ALL` to the
    // user's first allowed company, else the first loaded company). This
    // replaced the hard-coded "ACME" placeholder leftover from the v2
    // scaffold so the breadcrumb reflects real workspace context.
    const list = companies.data ?? [];
    let resolvedId = currentCompanyId;
    if (resolvedId === 'ALL') {
      resolvedId = user?.allowedCompanies?.[0] ?? list[0]?.id ?? 'ALL';
    }
    const wsLabel =
      currentCompanyId === 'ALL' ? 'All companies' :
      (list.find(c => c.id === resolvedId)?.name ?? resolvedId);
    const crumbs = [{ id: 'ws', label: wsLabel }];
    if (section && section !== 'Overview') crumbs.push({ id: 'section', label: section });
    crumbs.push({ id: activeId, label: routeTitles[activeId] ?? activeId, current: true } as typeof crumbs[0] & { current: boolean });
    return crumbs;
  }, [activeId, user?.name, user?.allowedCompanies, currentCompanyId, companies.data]);

  // Static palette commands.
  const commands: PaletteCommand[] = useMemo(() => [
    ...Object.entries(routeTitles).map<PaletteCommand>(([id, label]) => {
      const letter = Object.keys(routeHotkeys).find(k => routeHotkeys[k] === id);
      return {
        id: `nav.${id}`,
        label: `Go to ${label}`,
        hint: letter?.toUpperCase(),
        section: 'Navigate',
        keywords: `${label} ${id} page route ${routeSection[id] ?? ''}`,
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

  // Async palette providers.
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
            companyId: null,
            customerId: null,
            customerName: r.customerName ?? '—',
            orderNumber: r.orderNumber ?? r.id,
            orderDate: r.orderDate ?? '',
            orderType: null,
            status: r.status ?? 'PENDING',
            items: [],
            totalAmount: Number(r.totalAmount) || 0,
            currency: r.currency ?? 'USD',
            paymentTerms: r.paymentTerms,
            incoterm: r.incoterm,
            notes: null,
            createdBy: null,
            approvedBy: null,
            createdAt: r.createdAt ?? '',
            saleType: null,
            deliveryMethod: null,
            deliveryAddress: null,
            deliveryDate: r.deliveryDate,
            pod: null,
            poa: null,
            pickupLocation: null,
            bankId: null,
            notifyPartyId: null,
            notifyPartyName: null,
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

  // Auth gate — show LoginV2 until a user session is present. The
  // AuthProvider flips `loading` to false on its first effect tick, so
  // we don't flash the login page during the initial hydration.
  if (authLoading) {
    return <div className="min-h-screen bg-[#0a0a0a]" aria-hidden />;
  }
  if (!user) {
    return (
      <Suspense fallback={<Fallback />}>
        <LoginV2 />
      </Suspense>
    );
  }

  return (
    <>
      <SessionExpiredBanner />
      <AppShell
        sections={buildSections(
          () => setDataMenuOpen(true),
          () => setSettingsMenuOpen(true),
          user?.role,
        )}
        activeId={activeId}
        onNavigate={navigate}
        workspace={{ name: 'XS-ERP' }}
        sidebarFooter={<CompanySwitcher />}
        breadcrumbs={breadcrumbs}
        onSearch={() => setPaletteOpen(true)}
        onOpenSettings={() => navigate('settings')}
        onOpenConnections={() => navigate('connections')}
      >
        <Suspense fallback={<Fallback />}>
          {activeId === 'dashboard'       && <DashboardV2 />}
          {activeId === 'customers'       && <CustomersV2 />}
          {activeId === 'suppliers'       && <SuppliersV2 />}
          {activeId === 'sales-orders'    && <SalesOrdersV2 />}
          {activeId === 'purchase-orders' && <PurchaseCostWizardV2 />}
          {activeId === 'purchase-orders-list' && <PurchaseOrdersV2 />}
          {activeId === 'opportunities'   && <OpportunitiesV2 />}
          {activeId === 'products'        && <ProductsV2 />}
          {activeId === 'inventory'       && <InventoryV2 />}
          {activeId === 'freight-quotes'  && <FreightQuotesV2 />}
          {activeId === 'bookings'        && <BookingsV2 />}
          {activeId === 'shipments'       && <ShipmentsV2 />}
          {activeId === 'bol'             && <BillOfLadingsV2 />}
          {activeId === 'document-audit'  && <DocumentAuditV2 />}
          {activeId === 'ai-drafts'       && <AiDraftsV2 />}
          {activeId === 'packing-lists'   && <PackingListsV2 />}
          {activeId === 'invoices'        && <InvoicesV2 />}
          {activeId === 'receivables'     && <ReceivablesV2 />}
          {activeId === 'payables'        && <PayablesV2 />}
          {activeId === 'customer-balances' && <CustomerBalancesV2 />}
          {activeId === 'payment-terms'   && <PaymentTermsV2 />}
          {activeId === 'commissions'     && <CommissionsV2 />}
          {activeId === 'users'           && <AdminUsersV2 />}
          {activeId === 'companies'       && <AdminCompaniesV2 />}
          {activeId === 'cargo-agents'    && <AdminCargoAgentsV2 />}
          {activeId === 'carriers'        && <AdminCarriersV2 />}
          {activeId === 'ports'           && <AdminPortsV2 />}
          {activeId === 'locations'       && <AdminLocationsV2 />}
          {activeId === 'logistics-docs'  && <LogisticsDocsV2 />}
          {activeId === 'pl'              && <PLV2 />}
          {activeId === 'ai-dashboard'    && <AiDashboardV2 />}
          {activeId === 'ai-upload'       && <AiUploadV2 />}
          {activeId === 'ai-email'        && <AiEmailAssistantV2 />}
          {activeId === 'ai-logistics'    && <AiLogisticsManagerV2 />}
          {activeId === 'email-agent'     && <EmailAgentV2 />}
          {activeId === 'settings'        && <SettingsV2 />}
          {activeId === 'connections'     && <ConnectionsV2 />}
          {activeId === 'connections-hub'  && <ConnectionsHubV2 />}
          {activeId === 'ai-inbox'         && <AiInboxV2 />}
          {activeId === 'sopici'          && <AgentSalesOrdersV2 />}
          {activeId === 'pl-invoice'      && <PLInvoiceEngineV2 />}
          {activeId === 'cost-profit'     && <CostProfitAIV2 />}
          {activeId === 'ai-sales'        && <AiSalesV2 />}
          {activeId === 'trading-followup'   && <TradingFollowUpV2 />}
          {activeId === 'logistics-followup' && <LogisticsFollowUpV2 />}
          {activeId === 'agent-followup'     && <AgentFollowUpV2 navigate={navigate} />}
          {activeId === 'agent-portal-quotes'   && <AgentPortalV2 view="quotes" />}
          {activeId === 'agent-portal-bookings' && <AgentPortalV2 view="bookings" />}
          {activeId === 'agentic-console'       && <AgenticConsoleV2 />}
        </Suspense>
      </AppShell>

      {/* Cargo Agent users live in a focused portal (Freight Quotes +
       *  Bookings only), so the floating Dock's full-app shortcuts are
       *  irrelevant — hide it for them to keep the portal uncluttered. */}
      {user?.role !== 'Cargo Agent' && <Dock activeId={activeId} userId={user?.id} />}

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        commands={commands}
        dataProviders={dataProviders}
      />

      <DataMenuModal
        open={dataMenuOpen}
        onOpenChange={setDataMenuOpen}
        navigate={navigate}
      />

      <SettingsMenuModal
        open={settingsMenuOpen}
        onOpenChange={setSettingsMenuOpen}
        navigate={navigate}
      />

<ShortcutsHelp
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        groups={shortcutGroups}
      />

      <SalesOrderDrawer
        order={salesOrder.entity}
        mode={salesOrder.mode}
        onOpenChange={open => { if (!open) closeSalesOrder(); }}
      />
      <CustomerDrawer
        customer={customer.entity}
        mode={customer.mode}
        onOpenChange={open => { if (!open) closeCustomer(); }}
      />
      <SupplierDrawer
        supplier={supplier.entity}
        mode={supplier.mode}
        onOpenChange={open => { if (!open) closeSupplier(); }}
      />
      <InvoiceDrawer
        invoice={invoice.entity}
        mode={invoice.mode}
        onOpenChange={open => { if (!open) closeInvoice(); }}
      />
      <PurchaseOrderDrawer
        po={purchaseOrder.entity}
        mode={purchaseOrder.mode}
        onOpenChange={open => { if (!open) closePurchaseOrder(); }}
      />
      <CommissionDrawer
        commission={commission.entity}
        onOpenChange={open => { if (!open) closeCommission(); }}
      />
      <ProductDrawer
        product={product.entity}
        mode={product.mode}
        onOpenChange={open => { if (!open) closeProduct(); }}
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
