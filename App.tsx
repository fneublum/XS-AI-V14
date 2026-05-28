
import React, { useState, useEffect, useCallback, useMemo, Suspense, lazy } from 'react';
import {
    User, Company, Customer, Product, Opportunity, Shipment,
    InventoryItem, InventoryLog, Supplier, SupplierQuote,
    SupplierOffer, PurchaseOrder, CostCalculation, Port, Bank,
    BillOfLading, Booking, Estimate, ProformaInvoice,
    PurchaseOrderExtract, Invoice, PackingList, SupplierInvoice,
    CargoAgent, Carrier, SavedLocation, FreightQuote, Role, CompanyImage, SalesOrder,
    CommissionSalesOrder
} from './types';
import TopNavigation from './components/TopNavigation';
import Dock from './components/Dock';
import AiCopilotSidebar from './components/AiCopilotSidebar';
import ErrorBoundary from './components/ErrorBoundary';
import { navigationConfig } from './config/navigation';
import Login from './pages/Login';

// ─── Auto-retry for stale cache after deploys ──────────────────────
// When a new version is deployed, chunk filenames change. If the browser
// still has a cached index.html pointing to old chunks, the dynamic import
// will 404. This wrapper catches that and force-reloads ONCE.
const lazyWithRetry = (componentImport: () => Promise<any>) =>
    lazy(async () => {
        const hasRefreshed = sessionStorage.getItem('app_chunk_retry');
        try {
            const component = await componentImport();
            // Success — clear any retry flag
            sessionStorage.removeItem('app_chunk_retry');
            return component;
        } catch (error: any) {
            if (!hasRefreshed) {
                // First failure — set flag and reload to get fresh chunks
                sessionStorage.setItem('app_chunk_retry', '1');
                window.location.reload();
                // Return a dummy component while the page reloads
                return { default: () => null };
            }
            // Already retried — throw the error (avoid infinite loop)
            throw error;
        }
    });

// Lazy-loaded page components (code splitting with auto-retry)
const Dashboard = lazyWithRetry(() => import('./pages/Dashboard'));
const Pipeline = lazyWithRetry(() => import('./pages/Pipeline'));
const Products = lazyWithRetry(() => import('./pages/Products'));
const Inventory = lazyWithRetry(() => import('./pages/Inventory'));
const Shipments = lazyWithRetry(() => import('./pages/Shipments'));
const PurchaseOrders = lazyWithRetry(() => import('./pages/PurchaseOrders'));
const Suppliers = lazyWithRetry(() => import('./pages/Suppliers'));
const SupplierQuotes = lazyWithRetry(() => import('./pages/SupplierQuotes'));
const SupplierOffers = lazyWithRetry(() => import('./pages/SupplierOffers'));
const FreightQuotes = lazyWithRetry(() => import('./pages/FreightQuotes'));
const BigCalculator = lazyWithRetry(() => import('./pages/BigCalculator'));
const AiUpload = lazyWithRetry(() => import('./pages/AiUpload'));
const AdminUsers = lazyWithRetry(() => import('./pages/AdminUsers'));
const AdminCompanies = lazyWithRetry(() => import('./pages/AdminCompanies'));
const AdminSettings = lazyWithRetry(() => import('./pages/AdminSettings'));
const BrainDiagnostics = lazyWithRetry(() => import('./pages/BrainDiagnostics'));
const AdminBranding = lazyWithRetry(() => import('./pages/AdminBranding'));
const AdminCredentials = lazyWithRetry(() => import('./pages/AdminCredentials'));
const Customers = lazyWithRetry(() => import('./pages/Customers'));
const Ports = lazyWithRetry(() => import('./pages/Ports'));
const CargoAgents = lazyWithRetry(() => import('./pages/CargoAgents'));
const Carriers = lazyWithRetry(() => import('./pages/Carriers'));
const Locations = lazyWithRetry(() => import('./pages/Locations'));
const LogisticsDocuments = lazyWithRetry(() => import('./pages/LogisticsDocuments'));
const Documents = lazyWithRetry(() => import('./pages/Documents'));
const CustomerStatus = lazyWithRetry(() => import('./pages/CustomerStatus'));
const AISalesHub = lazyWithRetry(() => import('./pages/PriceForecasting'));
const Logistics = lazyWithRetry(() => import('./pages/Logistics'));
const HelpCenter = lazyWithRetry(() => import('./components/HelpCenter'));
const DocViewer = lazyWithRetry(() => import('./pages/DocViewer'));
const AiProcurement = lazyWithRetry(() => import('./pages/AiProcurement'));
const AiDataAssistant = lazyWithRetry(() => import('./pages/AiDataAssistant'));
const AiLogistics = lazyWithRetry(() => import('./pages/AiLogistics'));
const AiCalculator = lazyWithRetry(() => import('./pages/AiCalculator'));
const PLEngine = lazyWithRetry(() => import('./pages/PLEngine'));
const PLInvoiceEngine = lazyWithRetry(() => import('./pages/PLInvoiceEngine'));
const SOPICIComissions = lazyWithRetry(() => import('./pages/SOPICIComissions'));
const Banks = lazyWithRetry(() => import('./pages/Banks'));
const PaymentTerms = lazyWithRetry(() => import('./pages/PaymentTerms'));
const InvoiceEngine = lazyWithRetry(() => import('./pages/InvoiceEngine'));
const MyMailProcessorPage = lazyWithRetry(() => import('./pages/MyMailProcessorPage'));
const ConnectionsHub = lazyWithRetry(() => import('./pages/ConnectionsHub'));
const SmailApp = lazyWithRetry(() => import('./pages/SmailApp'));
const SalesOrders = lazyWithRetry(() => import('./pages/SalesOrders'));
const SaleBrazil = lazyWithRetry(() => import('./pages/SaleBrazil'));
const CustomerPortal = lazyWithRetry(() => import('./pages/CustomerPortal'));
const SalesHub = lazyWithRetry(() => import('./pages/SalesHub'));

const ICRM = lazyWithRetry(() => import('./pages/ICRM'));

const ShipmentPipeline = lazyWithRetry(() => import('./pages/ShipmentPipeline'));
const Commissions = lazyWithRetry(() => import('./pages/Commissions'));
const ProposalEngine = lazyWithRetry(() => import('./pages/ProposalEngine'));

const CostProfitAI = lazyWithRetry(() => import('./pages/CostProfitAI'));
const Finance = lazyWithRetry(() => import('./pages/Finance'));
const FinancePayables = lazyWithRetry(() => import('./pages/FinancePayables'));
const FinanceReceivables = lazyWithRetry(() => import('./pages/FinanceReceivables'));
const FinanceBalances = lazyWithRetry(() => import('./pages/FinanceBalances'));
const SalesFollowUp = lazyWithRetry(() => import('./pages/SalesFollowUp'));

import { Database, Wifi } from 'lucide-react';
import PendingDocsBanner from './components/PendingDocsBanner';

import { useSupabase } from './hooks/useSupabase';
import { checkSupabaseConnection, getSupabaseClient } from './services/supabase';
import { checkAndTriggerAutoBackup } from './services/backupService';
import { activityLogger } from './services/activityLogService';
import { clearSession } from './services/memoryService';

// Suspense loading fallback
const PageLoader = () => (
    <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
            <p className="text-xs text-slate-400 font-medium">Loading...</p>
        </div>
    </div>
);

const BRFlag = ({ size = 16, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
        <rect width="24" height="24" rx="2" fill="#009C3B" />
        <path d="M12 4L20 12L12 20L4 12L12 4Z" fill="#FFDF00" />
        <circle cx="12" cy="12" r="3.5" fill="#002776" />
        <path d="M10.5 13.5C10.5 13.5 11.5 11.5 14 11.5" stroke="white" strokeWidth="0.5" strokeLinecap="round" />
    </svg>
);

const App: React.FC = () => {
    // Authentication State — session is owned by Supabase Auth and
    // persisted to localStorage by supabase-js (autoRefreshToken: true).
    // The currentUser is the application's User row, resolved from the
    // session by the restore effect below once the users table loads.
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    // True until the boot-time supabase.auth.getSession() check has
    // settled. While true we render the loading shell instead of Login,
    // so a logged-in user who refreshes never sees a flash of the login
    // screen before their session restores.
    const [authRestoring, setAuthRestoring] = useState<boolean>(true);
    const [dbConnectionStatus, setDbConnectionStatus] = useState<boolean>(false);

    // Navigation State
    //
    // On mount, check for v2-to-v1 handshake keys set by v2 row/module
    // actions. The v2 preview doesn't have full parity for every
    // module, so some entries in the v2 sidebar hand off to the
    // matching v1 page. Each handshake owns its own sessionStorage
    // key, read once here and cleared where appropriate (e.g. the
    // Documents Modal clears its key after auto-opening).
    const readInitialModule = (): [string, string] => {
        if (typeof window === 'undefined') return ['DASHBOARD', ''];
        try {
            if (sessionStorage.getItem('xs_pending_delivery_docs')) {
                // Cleared by PLInvoiceEngine after it auto-opens the modal.
                return ['PAPERWORK', 'PL_INVOICE_ENGINE'];
            }
            if (sessionStorage.getItem('xs_pending_finance_balances')) {
                sessionStorage.removeItem('xs_pending_finance_balances');
                return ['FINANCE', 'BALANCES'];
            }
            // Generic handoff from the v2 Data / Settings pop-up menus.
            // Payload shape: { module: 'DATA', submodule: 'PORTS' }.
            const rawNav = sessionStorage.getItem('xs_pending_v1_nav');
            if (rawNav) {
                sessionStorage.removeItem('xs_pending_v1_nav');
                try {
                    const parsed = JSON.parse(rawNav) as { module?: string; submodule?: string };
                    if (parsed.module) return [parsed.module, parsed.submodule ?? ''];
                } catch { /* noop */ }
            }
        } catch { /* noop */ }
        return ['DASHBOARD', ''];
    };
    const [initialModule, initialSub] = readInitialModule();
    const [activeModule, setActiveModule] = useState(initialModule);
    const [subModule, setSubModule] = useState<string>(initialSub);
    const [currentCompanyId, setCurrentCompanyId] = useState<string>('ALL');
    const [pendingCalcOffer, setPendingCalcOffer] = useState<any>(null);
    const [pendingEditOfferId, setPendingEditOfferId] = useState<string | null>(null);
    const [costViewMode, setCostViewMode] = useState<'SHEET' | 'IMPORT'>('SHEET');

    // Help Center
    const [showHelp, setShowHelp] = useState(false);
    const [showAiSidebar, setShowAiSidebar] = useState(false);

    // --- DATA HOOKS (Supabase) ---
    // CORE DATA: Always fetched (used by 5+ modules)
    const users = useSupabase<User>('users');
    const companies = useSupabase<Company>('companies');
    const customers = useSupabase<Customer>('customers', { pageSize: 200 });
    const suppliers = useSupabase<Supplier>('suppliers');
    const products = useSupabase<Product>('products');
    const ports = useSupabase<Port>('ports');
    const banks = useSupabase<Bank>('banks');
    const paymentTermsData = useSupabase<any>('payment_terms');
    const cargoAgents = useSupabase<CargoAgent>('cargo_agents');
    const freightQuotes = useSupabase<FreightQuote>('freight_quotes');
    const bookings = useSupabase<Booking>('bookings', { pageSize: 100 });
    const billOfLadings = useSupabase<BillOfLading>('bill_landings', { pageSize: 100 });
    const invoices = useSupabase<Invoice>('invoices', {
        select: 'id, companyId, createdAt, invoiceNumber, invoiceDate, shipperName, shipperAddress, soldTo, shipTo, paymentTerms, incoterm, dateOrder, customerPo, carrier, transportRef, freightTerms, items, grossWeight, netWeight, tareWeight, totalQuantity, subtotal, totalAmount, currency, remitTo, bankName, bankAddress, swiftCode, routingNumber, accountNumber, supplier, date, soNumber, bookingNumber, shipper, consignee, pod, poa, bl, memo, containers, plNumber, billToName, bolUrl',
        pageSize: 100
    });
    const { data: salesOrders, addRecord: addSalesOrder, updateRecord: updateSalesOrder, deleteRecord: deleteSalesOrder } = useSupabase<SalesOrder>('sales_orders', { pageSize: 100 });

    // LAZY DATA: Only fetched when user navigates to a module that needs it
    const mod = activeModule;
    const needsOpportunities = ['DASHBOARD', 'COST_PROFIT_AI', 'SALES_FORCE', 'SALES_HUB'].includes(mod);
    const needsCostCalcs = ['BUY', 'COST_PROFIT_AI', 'AI_UPLOAD', 'SALES_FORCE'].includes(mod);
    const needsSupplierQuotes = ['DASHBOARD', 'BUY', 'COST_PROFIT_AI', 'SALES_FORCE'].includes(mod);
    const needsSupplierOffers = ['DASHBOARD', 'BUY', 'COST_PROFIT_AI', 'SALES_FORCE', 'AI_UPLOAD'].includes(mod);
    const needsPurchaseOrders = ['DASHBOARD', 'BUY', 'DATA'].includes(mod);
    const needsInventory = ['DASHBOARD', 'BUY', 'LOGISTICS'].includes(mod);
    const needsShipments = ['DASHBOARD', 'COST_PROFIT_AI', 'LOGISTICS'].includes(mod);
    const needsDocuments = ['DASHBOARD', 'DATA', 'CONNECTIONS', 'AI_UPLOAD', 'PAPERWORK', 'COMMISSIONS'].includes(mod);
    const needsCommissions = ['DASHBOARD', 'COMMISSIONS', 'SALES_HUB', 'LOGISTICS', 'AI_UPLOAD'].includes(mod);
    const needsCarriers = ['BUY', 'LOGISTICS', 'SALES_FORCE'].includes(mod);
    const needsLocations = ['BUY', 'SALES_FORCE', 'DATA'].includes(mod);
    const needsImages = ['DATA', 'BUY'].includes(mod);
    const needsSupplierInvoices = ['DASHBOARD', 'FINANCE', 'DATA', 'CONNECTIONS', 'AI_UPLOAD'].includes(mod);

    const opportunities = useSupabase<Opportunity>('opportunities', { enabled: needsOpportunities });
    const costCalculations = useSupabase<CostCalculation>('cost_calculations', { enabled: needsCostCalcs });
    const supplierQuotes = useSupabase<SupplierQuote>('supplier_quotes', { enabled: needsSupplierQuotes });
    const supplierOffers = useSupabase<SupplierOffer>('supplier_offers', { enabled: needsSupplierOffers });
    const purchaseOrders = useSupabase<PurchaseOrder>('purchase_orders', { enabled: needsPurchaseOrders });
    const inventory = useSupabase<InventoryItem>('inventory', { enabled: needsInventory });
    const inventoryLogs = useSupabase<InventoryLog>('inventory_logs', { enabled: needsInventory });
    const shipments = useSupabase<Shipment>('shipments', { enabled: needsShipments });
    const carriers = useSupabase<Carrier>('carriers', { enabled: needsCarriers });
    const locations = useSupabase<SavedLocation>('saved_locations', { enabled: needsLocations });

    const estimates = useSupabase<Estimate>('estimates', {
        select: 'id, companyId, createdAt, estimateNumber, supplier, buyer, shipTo, payTo, date, terms, incoterm, subtotal, tax, totalAmount, currency, items, acceptedBy, acceptedDate',
        enabled: needsDocuments
    });
    const proformas = useSupabase<ProformaInvoice>('proforma_invoices', {
        select: 'id, companyId, createdAt, piNumber, supplier, buyer, shipTo, payTo, date, terms, incoterm, subtotal, tax, totalAmount, currency, items, acceptedBy, acceptedDate',
        enabled: needsDocuments
    });
    const supplierInvoices = useSupabase<SupplierInvoice>('invoices_suppliers', { enabled: needsSupplierInvoices });
    const packingLists = useSupabase<PackingList>('packing_lists', {
        select: 'id, companyId, createdAt, plNumber, blNumber, shipper, supplier, consignee, shippingPoint, destination, date, carrier, containerNumber, sealNumber, vesselVoyage, productDescription, unitCount, unitNumbers, grossWeight, netWeight, freightTerms, poNumber, notes, scheduledShipDate, items, soNumber, status',
        enabled: needsDocuments
    });
    const poExtracts = useSupabase<PurchaseOrderExtract>('purchase_order_extracts', {
        select: 'id, companyId, createdAt, poNumber, vendor, date, totalAmount, currency, items',
        enabled: needsDocuments
    });

    const commissions = useSupabase<CommissionSalesOrder>('commission_sales_orders', {
        select: 'id, orderNumber, invoiceNumber, sellerName, customerName, pod, deliveryDate, status, orderTotal, invoiceStatus, commissionAmount, commissionPaymentStatus, createdAt, companyId, items, commissionRate, commissionType, blNumber, blDocumentUrl, pol, etd, eta',
        pageSize: 100,
        orderBy: { column: 'createdAt', ascending: false },
        enabled: needsCommissions
    });

    const images = useSupabase<CompanyImage>('imagens', { enabled: needsImages });

    useEffect(() => {
        checkSupabaseConnection().then(status => setDbConnectionStatus(status));
    }, []);

    // ── Session restore + auth state listener ────────────────────────────
    // On mount we ask Supabase Auth for any existing session (read from
    // localStorage by supabase-js). If one exists, we wait for the users
    // table to finish loading, then resolve session.user.id → User row
    // and rehydrate currentUser. We also subscribe to onAuthStateChange
    // so a sign-out from a sibling tab (or a forced token revocation)
    // drops currentUser here too.
    useEffect(() => {
        let cancelled = false;
        const client = getSupabaseClient();

        // Subscribe first so we never miss a state-change event that
        // fires between getSession() resolving and the listener attaching.
        const { data: sub } = client.auth.onAuthStateChange((event) => {
            if (cancelled) return;
            if (event === 'SIGNED_OUT') {
                setCurrentUser(null);
                activityLogger.clearContext();
            }
            // SIGNED_IN / TOKEN_REFRESHED are handled by the explicit
            // login flow in handleLogin — nothing to do here.
        });

        return () => {
            cancelled = true;
            sub.subscription.unsubscribe();
        };
    }, []);

    // Resolve session.user → users row once the users table has loaded.
    // Kept separate from the auth-listener effect so it can react to
    // users.loading transitions without re-subscribing to auth events.
    useEffect(() => {
        if (currentUser) {
            // Already restored / freshly logged in — nothing to do.
            if (authRestoring) setAuthRestoring(false);
            return;
        }
        if (users.loading) return; // wait for the users table

        let cancelled = false;
        const client = getSupabaseClient();

        client.auth.getSession().then(({ data }) => {
            if (cancelled) return;
            const session = data.session;
            if (!session) {
                // No persisted session — show Login.
                setAuthRestoring(false);
                return;
            }

            // Look up the application user via the auth_id linkage
            // written by scripts/backfill-supabase-auth.mjs. If no row
            // matches (orphan auth identity left behind after a users
            // row was deleted), sign out cleanly and fall through to
            // Login rather than rendering a half-authed UI.
            const dbUser = users.data.find(u => u.auth_id && u.auth_id === session.user.id);
            if (!dbUser) {
                console.warn('[App] session restored but no users row for', session.user.id, '— signing out');
                client.auth.signOut().catch(() => { /* best-effort */ });
                setAuthRestoring(false);
                return;
            }

            setCurrentUser(dbUser);
            activityLogger.setUserContext(dbUser.id, dbUser.role, 'ALL');
            if (dbUser.role !== Role.ADMIN && dbUser.allowed_company_ids && dbUser.allowed_company_ids.length > 0) {
                setCurrentCompanyId(dbUser.allowed_company_ids[0]);
                activityLogger.setUserContext(dbUser.id, dbUser.role, dbUser.allowed_company_ids[0]);
            }
            // NOTE: deliberately NOT calling activityLogger.logAuth('LOGIN')
            // or resetting activeModule here — this is a session restore,
            // not a fresh login. The user keeps whatever route they were on.
            setAuthRestoring(false);
        }).catch(err => {
            console.error('[App] session restore failed', err);
            if (!cancelled) setAuthRestoring(false);
        });

        return () => { cancelled = true; };
    }, [users.loading, users.data, currentUser, authRestoring]);

    // Automated Backup Scheduler
    useEffect(() => {
        const interval = setInterval(() => {
            if (currentUser && currentUser.role === Role.ADMIN) {
                checkAndTriggerAutoBackup();
            }
        }, 60000);

        return () => clearInterval(interval);
    }, [currentUser]);

    const handleLogin = useCallback((user: User) => {
        setCurrentUser(user);
        // Session persistence is now owned by Supabase Auth (localStorage,
        // auto-refreshed). No app-side mirror needed — the auth-restore
        // effect rehydrates currentUser on page load from the session.
        setTimeout(() => window.scrollTo(0, 0), 100);

        // Clear previous dashboard chat session so user starts fresh
        clearSession(user.id).catch(() => {});

        // Activity Log: set user context and log login
        activityLogger.setUserContext(user.id, user.role, 'ALL');
        activityLogger.logAuth('LOGIN', { id: user.id, name: user.name, role: user.role });

        if (user.role !== Role.ADMIN && user.allowed_company_ids && user.allowed_company_ids.length > 0) {
            setCurrentCompanyId(user.allowed_company_ids[0]);
            activityLogger.setUserContext(user.id, user.role, user.allowed_company_ids[0]);
        } else {
            setCurrentCompanyId('ALL');
        }

        if (user.role === Role.CARGO_AGENT) {
            setActiveModule('LOGISTICS');
            setSubModule('FREIGHT');
            activityLogger.logNavigation('LOGISTICS', 'FREIGHT');
        } else if (user.role === Role.CUSTOMER) {
            setActiveModule('CUSTOMER_PORTAL');
            activityLogger.logNavigation('CUSTOMER_PORTAL');
        } else if (user.role === Role.SALES) {
            setActiveModule('SALES_HUB');
            activityLogger.logNavigation('SALES_HUB');
        } else {
            activityLogger.logNavigation('DASHBOARD');
        }
    }, []);

    const handleLogout = useCallback(() => {
        // Activity Log: log logout before clearing context
        activityLogger.logAuth('LOGOUT');
        activityLogger.flush();
        activityLogger.clearContext();

        // Tear down the Supabase Auth session. The onAuthStateChange
        // listener in services/edgeAuth.ts will null out the cached
        // access token; downstream Edge Function calls will then 401
        // until the user signs back in. We don't await — sign-out is
        // local-first in supabase-js, the network revocation happens in
        // the background.
        try {
            getSupabaseClient().auth.signOut().catch(() => { /* best-effort */ });
        } catch { /* client unavailable — nothing to sign out of */ }

        setCurrentUser(null);
        setActiveModule('DASHBOARD');
        setSubModule('');
    }, []);

    // Auto-refresh bookings/BL data when navigating to those views
    useEffect(() => {
        if (subModule === 'BOOKINGS') bookings.refetch();
        if (subModule === 'BL') billOfLadings.refetch();
    }, [subModule]);

    const filterByCompany = useCallback((data: any[]) => {
        if (currentCompanyId === 'ALL') return data;
        return data.filter(item => {
            const itemCompanyId = item.companyId || item.company_id;
            return itemCompanyId === currentCompanyId ||
                itemCompanyId === 'ALL' ||
                (item.sharedWith && Array.isArray(item.sharedWith) && item.sharedWith.includes(currentCompanyId));
        });
    }, [currentCompanyId]);

    const filterByCompanyStrict = useCallback((data: any[]) => {
        if (currentCompanyId === 'ALL') return data;
        return data.filter(item => (item.companyId || item.company_id) === currentCompanyId);
    }, [currentCompanyId]);

    const filterByProductCategory = useCallback((data: any[]) => {
        const cats = currentUser?.allowed_product_categories;
        if (!cats || cats.length === 0) return data;
        return data.filter(item => item.category && cats.includes(item.category));
    }, [currentUser?.allowed_product_categories]);

    const filterCalcsByProductCategory = useCallback((data: any[]) => {
        const cats = currentUser?.allowed_product_categories;
        if (!cats || cats.length === 0) return data;
        const allowedProductNames = new Set(
            products.data.filter(p => p.category && cats.includes(p.category)).map(p => p.name)
        );
        return data.filter(item => item.productName && allowedProductNames.has(item.productName));
    }, [currentUser?.allowed_product_categories, products.data]);

    const filterSalesOrdersByCreator = useCallback((orders: SalesOrder[]) => {
        if (!currentUser || currentUser.role === Role.ADMIN || currentUser.role === Role.CEO) return orders;
        return orders.filter(o =>
            o.createdBy === currentUser.id || o.createdBy === currentUser.name
        );
    }, [currentUser]);

    // SALES ROLE DATA SCOPING: opportunities by assignedTo
    const filterOpportunitiesBySales = useCallback((opps: any[]) => {
        if (!currentUser || currentUser.role !== Role.SALES) return opps;
        return opps.filter(o =>
            o.assignedTo === currentUser.name || o.assignedTo === currentUser.id
        );
    }, [currentUser]);

    // SALES ROLE DATA SCOPING: commissions by customer assigned to sales user
    const filterCommissionsBySales = useCallback((comms: any[]) => {
        if (!currentUser || currentUser.role !== Role.SALES) return comms;
        const myCustomerNames = new Set(
            customers.data
                .filter(c => c.sales_person_id === currentUser.id || c.sales_person_name === currentUser.name)
                .map(c => c.name.toUpperCase())
        );
        return comms.filter(c =>
            myCustomerNames.has((c.customerName || '').toUpperCase())
        );
    }, [currentUser, customers.data]);

    // SALES ROLE DATA SCOPING: customers by sales_person_id
    const filterCustomersBySales = useCallback((custs: any[]) => {
        if (!currentUser || currentUser.role !== Role.SALES) return custs;
        return custs.filter(c =>
            c.sales_person_id === currentUser.id || c.sales_person_name === currentUser.name
        );
    }, [currentUser]);

    // ─── MEMOIZED FILTERED DATA (prevents new array refs on every render) ───
    const mCustomers = useMemo(() => filterByCompany(customers.data), [customers.data, currentCompanyId]);
    const mSuppliers = useMemo(() => filterByCompany(suppliers.data), [suppliers.data, currentCompanyId]);
    const mProducts = useMemo(() => filterByCompany(products.data), [products.data, currentCompanyId]);
    const mOpportunities = useMemo(() => filterByCompany(opportunities.data), [opportunities.data, currentCompanyId]);
    const mShipments = useMemo(() => filterByCompany(shipments.data), [shipments.data, currentCompanyId]);
    const mSupplierQuotes = useMemo(() => filterByCompany(supplierQuotes.data), [supplierQuotes.data, currentCompanyId]);
    const mSupplierOffers = useMemo(() => filterByCompany(supplierOffers.data), [supplierOffers.data, currentCompanyId]);
    const mPurchaseOrders = useMemo(() => filterByCompany(purchaseOrders.data), [purchaseOrders.data, currentCompanyId]);
    const mInventory = useMemo(() => filterByCompany(inventory.data), [inventory.data, currentCompanyId]);
    const mInventoryLogs = useMemo(() => filterByCompany(inventoryLogs.data), [inventoryLogs.data, currentCompanyId]);
    const mBookings = useMemo(() => filterByCompany(bookings.data), [bookings.data, currentCompanyId]);
    const mBookingsStrict = useMemo(() => filterByCompanyStrict(bookings.data), [bookings.data, currentCompanyId]);
    const mBillOfLadings = useMemo(() => filterByCompany(billOfLadings.data), [billOfLadings.data, currentCompanyId]);
    const mInvoices = useMemo(() => filterByCompanyStrict(invoices.data), [invoices.data, currentCompanyId]);
    const mEstimates = useMemo(() => filterByCompany(estimates.data), [estimates.data, currentCompanyId]);
    const mProformas = useMemo(() => filterByCompany(proformas.data), [proformas.data, currentCompanyId]);
    const mPackingLists = useMemo(() => filterByCompanyStrict(packingLists.data), [packingLists.data, currentCompanyId]);
    const mSupplierInvoices = useMemo(() => filterByCompany(supplierInvoices.data), [supplierInvoices.data, currentCompanyId]);
    const mPoExtracts = useMemo(() => filterByCompany(poExtracts.data), [poExtracts.data, currentCompanyId]);
    const mCommissions = useMemo(() => filterByCompany(commissions.data), [commissions.data, currentCompanyId]);
    const mCostCalculations = useMemo(() => filterByCompany(costCalculations.data), [costCalculations.data, currentCompanyId]);
    const mBanks = useMemo(() => filterByCompany(banks.data), [banks.data, currentCompanyId]);
    const mLocations = useMemo(() => filterByCompany(locations.data), [locations.data, currentCompanyId]);
    const mSalesOrders = useMemo(() => filterByCompany(salesOrders), [salesOrders, currentCompanyId]);
    // Payment Terms: include ALL-company terms for everyone (seed data) + company-specific
    const mPaymentTerms = useMemo(() => paymentTermsData.data.filter((pt: any) => {
        // Supabase returns snake_case columns; support both spellings
        const cid = pt.company_id ?? pt.companyId;
        return !cid || cid === 'ALL' || cid === currentCompanyId;
    }), [paymentTermsData.data, currentCompanyId]);

    // Composite memoized filters (role-scoped)
    const mSalesOrdersScoped = useMemo(() => filterSalesOrdersByCreator(mSalesOrders), [mSalesOrders, currentUser]);
    const mOpportunitiesScoped = useMemo(() => filterOpportunitiesBySales(mOpportunities), [mOpportunities, currentUser]);
    const mCommissionsScoped = useMemo(() => filterCommissionsBySales(mCommissions), [mCommissions, currentUser, customers.data]);
    const mCustomersScoped = useMemo(() => filterCustomersBySales(mCustomers), [mCustomers, currentUser]);
    const mProductsFiltered = useMemo(() => filterByProductCategory(mProducts), [mProducts, currentUser?.allowed_product_categories]);
    const mCalcsFiltered = useMemo(() => filterCalcsByProductCategory(mCostCalculations), [mCostCalculations, currentUser?.allowed_product_categories, products.data]);

    // While Supabase Auth restores the session and the users table loads,
    // keep showing the loading shell instead of bouncing to Login — a
    // logged-in user refreshing the page should not flash the login form.
    if (authRestoring) {
        return <PageLoader />;
    }

    if (!currentUser) {
        return (
            <Login
                onLogin={handleLogin}
                users={users.data}
                isLoading={users.loading}
                dbError={!dbConnectionStatus ? "Database unreachable" : null}
            />
        );
    }

    const renderContent = () => {
        switch (activeModule) {
            case 'DASHBOARD':
                return (
                    <Dashboard
                        currentUser={currentUser}
                        currentCompanyId={currentCompanyId}
                        availableCompanies={companies.data}
                        customers={mCustomers}
                        suppliers={mSuppliers}
                        ports={ports.data}
                        salesQuotes={[]}
                        supplierQuoteRequests={mSupplierQuotes}
                        supplierOffers={mSupplierOffers}
                        opportunities={mOpportunities}
                        shipments={mShipments}
                        purchaseOrders={mPurchaseOrders}
                        products={mProducts}
                        inventory={mInventory}
                        inventoryLogs={mInventoryLogs}
                        onSaveBL={billOfLadings.addRecord}
                        onSaveBooking={bookings.addRecord}
                        onSaveEstimate={estimates.addRecord}
                        onSaveProforma={proformas.addRecord}
                        onSavePO={poExtracts.addRecord}
                        onSaveInvoice={invoices.addRecord}
                        onSaveSupplierInvoice={supplierInvoices.addRecord}
                        onSavePackingList={packingLists.addRecord}
                        // AI Assistant CRUD callbacks
                        onAddCustomer={customers.addRecord}
                        onUpdateCustomer={customers.updateRecord}
                        onAddSupplier={suppliers.addRecord}
                        onUpdateSupplier={suppliers.updateRecord}
                        onAddProduct={products.addRecord}
                        onAddSalesOrder={addSalesOrder}
                        onAddPurchaseOrder={purchaseOrders.addRecord}
                        onAddBooking={bookings.addRecord}
                        onAddCargoAgent={cargoAgents.addRecord}
                        onAddFreightQuote={freightQuotes.addRecord}
                        salesOrdersData={mSalesOrdersScoped}
                        bookingsData={mBookings}
                        billOfLadingsData={mBillOfLadings}
                        cargoAgentsData={filterByCompany(cargoAgents.data)}
                        freightQuotesData={filterByCompany(freightQuotes.data)}
                        invoicesData={mInvoices}
                        estimatesData={mEstimates}
                        proformasData={mProformas}
                        packingListsData={mPackingLists}
                        supplierInvoicesData={mSupplierInvoices}
                        commissionsData={mCommissions}
                    />
                );

            case 'BUY':
                return (
                    <div className="h-full flex flex-col">
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {(subModule === '' || subModule === 'SUPPLIERS') && (
                                <Suppliers
                                    suppliers={mSuppliers}
                                    onAdd={suppliers.addRecord}
                                    onUpdate={suppliers.updateRecord}
                                    onDelete={suppliers.deleteRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    supplierQuotes={filterByCompany(supplierQuotes.data)}
                                    purchaseOrders={filterByCompany(purchaseOrders.data)}
                                />
                            )}
                            {subModule === 'OFFERS' && (
                                <SupplierOffers
                                    offers={mSupplierOffers}
                                    onAdd={supplierOffers.addRecord}
                                    onUpdate={supplierOffers.updateRecord}
                                    onDelete={supplierOffers.deleteRecord}
                                    suppliers={mSuppliers}
                                    products={mProducts}
                                    onAddProduct={products.addRecord}
                                    onAddSupplier={suppliers.addRecord}
                                    ports={ports.data}
                                    onAddPort={ports.addRecord}
                                    locations={filterByCompany(locations.data)}
                                    onAddLocation={locations.addRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    initialEditId={pendingEditOfferId}
                                    onOpenCalculator={(data) => {
                                        setPendingCalcOffer(data);
                                        setSubModule('IMPORT');
                                    }}
                                />
                            )}
                            {subModule === 'PO' && (
                                <PurchaseOrders
                                    purchaseOrders={mPurchaseOrders}
                                    onAdd={purchaseOrders.addRecord}
                                    onUpdate={purchaseOrders.updateRecord}
                                    onDelete={purchaseOrders.deleteRecord}
                                    suppliers={mSuppliers}
                                    products={mProducts}
                                    onAddProduct={products.addRecord}
                                    onAddSupplier={suppliers.addRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    companyImages={images.data}
                                    paymentTerms={mPaymentTerms}
                                />
                            )}
                            {subModule === 'AI' && (
                                <AiProcurement
                                    suppliers={mSuppliers}
                                    purchaseOrders={mPurchaseOrders}
                                    supplierOffers={mSupplierOffers}
                                />
                            )}
                            {subModule === 'STOCK' && (
                                <Inventory
                                    inventory={mInventory}
                                    logs={mInventoryLogs}
                                    onAdd={inventory.addRecord}
                                    onUpdate={inventory.updateRecord}
                                    onDelete={inventory.deleteRecord}
                                    onAddLog={inventoryLogs.addRecord}
                                    onUpdateLog={inventoryLogs.updateRecord}
                                    onDeleteLog={inventoryLogs.deleteRecord}
                                    products={mProducts}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    currentUser={currentUser}
                                />
                            )}

                            {(() => {
                                const calcSubModules = ['COST', 'HISTORY', 'PRICE_LIST', 'EXPORT', 'LOCAL', 'IMPORT', 'SHEET'];
                                if (!calcSubModules.includes(subModule)) return null;

                                const getCalcModeBuy = () => {
                                    if (subModule === 'EXPORT') return 'EXPORT';
                                    if (subModule === 'LOCAL') return 'LOCAL';
                                    if (subModule === 'PRICE_LIST') return 'PRICE_LIST';
                                    if (subModule === 'HISTORY') return 'HISTORY';
                                    if (subModule === '' || subModule === 'COST') return costViewMode;
                                    return 'IMPORT';
                                };

                                const calcProps = {
                                    products: mProducts,
                                    suppliers: mSuppliers,
                                    supplierOffers: mSupplierOffers,
                                    supplierQuotes: mSupplierQuotes,
                                    freightQuotes: freightQuotes.data,
                                    salesOrders: mSalesOrdersScoped,
                                    ports: ports.data,
                                    savedCalculations: mCostCalculations,
                                    onSave: costCalculations.addRecord,
                                    onUpdate: costCalculations.updateRecord,
                                    onDelete: costCalculations.deleteRecord,
                                    onAddProduct: products.addRecord,
                                    onAddPort: ports.addRecord,
                                    onAddSupplier: suppliers.addRecord,
                                    currentCompanyId,
                                    availableCompanies: companies.data,
                                    carriers: carriers.data,
                                    onAddCarrier: carriers.addRecord,
                                    locations: locations.data,
                                    onAddLocation: locations.addRecord,
                                    currentUser: currentUser,
                                    pendingOfferData: pendingCalcOffer,
                                    onClearPendingOffer: () => setPendingCalcOffer(null),
                                };

                                if (subModule === 'COST') {
                                    return (
                                        <div>
                                            <div className="flex items-center gap-2 px-6 pt-4 pb-2">
                                                <button
                                                    onClick={() => setCostViewMode('SHEET')}
                                                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${costViewMode === 'SHEET'
                                                        ? 'bg-violet-600 text-white shadow-md'
                                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                                >
                                                    Cost Sheet
                                                </button>
                                                <button
                                                    onClick={() => setCostViewMode('IMPORT')}
                                                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${costViewMode === 'IMPORT'
                                                        ? 'bg-violet-600 text-white shadow-md'
                                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                                >
                                                    Cost Calculation
                                                </button>
                                            </div>
                                            <BigCalculator
                                                key={costViewMode}
                                                {...calcProps}
                                                initialMode={costViewMode}
                                                initialHistoryOnly={false}
                                            />
                                        </div>
                                    );
                                }

                                return (
                                    <BigCalculator
                                        {...calcProps}
                                        initialMode={getCalcModeBuy()}
                                        initialHistoryOnly={subModule === 'HISTORY'}
                                    />
                                );
                            })()}
                        </div>
                    </div>
                );

            case 'COMMISSIONS':
                return (
                    <div className="h-full flex flex-col">
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {(subModule === '' || subModule === 'PL_INVOICE_ENGINE') && <SOPICIComissions
                                packingLists={mPackingLists}
                                customers={mCustomers}
                                invoices={mInvoices}
                                salesOrders={mSalesOrdersScoped}
                                bookings={mBookings}
                                ports={ports.data}
                                onSaveInvoice={invoices.addRecord}
                                onUpdateInvoice={invoices.updateRecord}
                                onDeleteInvoice={invoices.deleteRecord}
                                currentCompanyId={currentCompanyId}
                                availableCompanies={companies.data}
                                onRefreshData={async () => {
                                    await Promise.all([
                                        packingLists.refetch(),
                                        invoices.refetch()
                                    ]);
                                }}
                                banks={mBanks}
                                onAddCommission={commissions.addRecord}
                                availablePaymentTerms={mPaymentTerms}
                            />}
                            {subModule === 'ORDERS' && (
                                <Commissions
                                    commissions={filterCommissionsBySales(mCommissions)}
                                    onAdd={commissions.addRecord}
                                    onUpdate={commissions.updateRecord}
                                    onDelete={commissions.deleteRecord}
                                    customers={mCustomers}
                                    suppliers={mSuppliers}
                                    currentUser={currentUser}
                                    currentCompanyId={currentCompanyId}
                                    ports={ports.data}
                                    billOfLadings={mBillOfLadings}
                                    onSaveBL={billOfLadings.addRecord}
                                    initialView="ORDERS"
                                    availablePaymentTerms={mPaymentTerms}
                                />
                            )}
                            {subModule === 'INVOICES' && (
                                <Commissions
                                    commissions={filterCommissionsBySales(mCommissions)}
                                    onAdd={commissions.addRecord}
                                    onUpdate={commissions.updateRecord}
                                    onDelete={commissions.deleteRecord}
                                    customers={mCustomers}
                                    suppliers={mSuppliers}
                                    currentUser={currentUser}
                                    currentCompanyId={currentCompanyId}
                                    ports={ports.data}
                                    billOfLadings={mBillOfLadings}
                                    onSaveBL={billOfLadings.addRecord}
                                    initialView="INVOICES"
                                    availablePaymentTerms={mPaymentTerms}
                                />
                            )}
                        </div>
                    </div>
                );

            case 'SALES_HUB':
                return (
                    <div className="h-full flex flex-col">
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            <SalesHub
                                currentUser={currentUser}
                                currentCompanyId={currentCompanyId}
                                opportunities={filterOpportunitiesBySales(mOpportunities)}
                                salesOrders={mSalesOrdersScoped}
                                commissions={filterCommissionsBySales(mCommissions)}
                                customers={filterCustomersBySales(mCustomers)}
                                onNavigate={(mod: string, sub: string) => { setActiveModule(mod); setSubModule(sub); }}
                            />
                        </div>
                    </div>
                );

            case 'SALES_FORCE':
                return (
                    <div className="h-full flex flex-col">
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {(subModule === '' || subModule === 'ICRM') && (
                                <ICRM
                                    opportunities={filterOpportunitiesBySales(mOpportunities)}
                                    customers={mCustomers}
                                    products={mProducts}
                                    onAddOpportunity={opportunities.addRecord}
                                    onUpdateOpportunity={opportunities.updateRecord}
                                    onDeleteOpportunity={opportunities.deleteRecord}
                                    addProduct={products.addRecord}
                                    addCustomer={customers.addRecord}
                                    availableCompanies={companies.data}
                                    currentCompanyId={currentCompanyId}
                                />
                            )}
                            {subModule === 'CUSTOMERS' && (
                                <Customers
                                    customers={filterCustomersBySales(mCustomers)}
                                    onAdd={customers.addRecord}
                                    onUpdate={customers.updateRecord}
                                    onDelete={customers.deleteRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    ports={ports.data}
                                    onAddPort={ports.addRecord}
                                    users={users.data}
                                    currentUser={currentUser}
                                    paymentTerms={mPaymentTerms}
                                />
                            )}
                            {subModule === 'PIPELINE' && (
                                <Pipeline
                                    opportunities={filterOpportunitiesBySales(mOpportunities)}
                                    onAdd={opportunities.addRecord}
                                    onUpdate={opportunities.updateRecord}
                                    onDelete={opportunities.deleteRecord}
                                    customers={mCustomers}
                                    products={mProducts}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    addProduct={products.addRecord}
                                    addCustomer={customers.addRecord}
                                />
                            )}
                            {subModule === 'PRICELIST' && (
                                <BigCalculator
                                    products={filterByProductCategory(mProducts)}
                                    suppliers={mSuppliers}
                                    supplierOffers={mSupplierOffers}
                                    supplierQuotes={mSupplierQuotes}
                                    freightQuotes={filterByCompany(freightQuotes.data)}
                                    ports={ports.data}
                                    savedCalculations={filterCalcsByProductCategory(mCostCalculations)}
                                    onSave={costCalculations.addRecord}
                                    onUpdate={costCalculations.updateRecord}
                                    onDelete={costCalculations.deleteRecord}
                                    onAddProduct={products.addRecord}
                                    onAddPort={ports.addRecord}
                                    onAddSupplier={suppliers.addRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    carriers={filterByCompany(carriers.data)}
                                    onAddCarrier={carriers.addRecord}
                                    locations={filterByCompany(locations.data)}
                                    onAddLocation={locations.addRecord}
                                    initialMode='PRICE_LIST'
                                    allowMargin={true}
                                    readOnly={true}
                                />
                            )}
                            {subModule === 'ORDERS' && (
                                <SalesOrders
                                    currentUser={currentUser}
                                    currentCompanyId={currentCompanyId}
                                    customers={mCustomers}
                                    products={mProducts}
                                    bookings={mBookingsStrict}
                                    onAddBooking={bookings.addRecord}
                                    onUpdateBooking={bookings.updateRecord}
                                    ports={ports.data}
                                    onAddPort={ports.addRecord}
                                    freightQuotes={filterByCompany(freightQuotes.data)}
                                    onAddFreightQuote={freightQuotes.addRecord}
                                    locations={filterByCompany(locations.data)}
                                    onAddLocation={locations.addRecord}
                                    salesOrders={mSalesOrdersScoped}
                                    banks={mBanks}
                                    onAdd={addSalesOrder}
                                    onUpdate={updateSalesOrder}
                                    onDelete={deleteSalesOrder}
                                    paymentTerms={mPaymentTerms}
                                    invoices={mInvoices}
                                />
                            )}
                        </div>
                    </div>
                );

            case 'FINANCE':
                return (
                    <div className="h-full flex flex-col">
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {(subModule === '' || subModule === 'PAYABLES') && (
                                <FinancePayables invoices={mSupplierInvoices} onDelete={supplierInvoices.deleteRecord} onUpdate={supplierInvoices.updateRecord} onSave={supplierInvoices.addRecord} currentCompanyId={currentCompanyId} banks={mBanks} />
                            )}
                            {subModule === 'RECEIVABLES' && (
                                <FinanceReceivables invoices={mInvoices} onDelete={invoices.deleteRecord} onUpdate={invoices.updateRecord} onSave={invoices.addRecord} currentCompanyId={currentCompanyId} />
                            )}
                            {subModule === 'BALANCES' && (
                                <FinanceBalances currentCompanyId={currentCompanyId} availableCompanies={companies.data} erpCustomers={mCustomers} />
                            )}
                        </div>
                    </div>
                );

            case 'CONNECTIONS':
                return (
                    <div className="h-full flex flex-col">
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            <ConnectionsHub
                                onNavigate={(mod, sub) => { setActiveModule(mod); setSubModule(sub); }}
                                onSaveBL={billOfLadings.addRecord}
                                onSaveBooking={bookings.addRecord}
                                onSaveEstimate={estimates.addRecord}
                                onSaveProforma={proformas.addRecord}
                                onSavePO={poExtracts.addRecord}
                                onSaveInvoice={invoices.addRecord}
                                onSaveSupplierInvoice={supplierInvoices.addRecord}
                                onSavePackingList={packingLists.addRecord}
                                currentCompanyId={currentCompanyId}
                                ports={ports.data}
                                currentUser={currentUser}
                            />
                        </div>
                    </div>
                );

            case 'COST_PROFIT_AI':
                return (
                    <div className="h-full flex flex-col">
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {(subModule === '' || subModule === 'ORDER_SALE') && (
                                <CostProfitAI
                                    supplierOffers={mSupplierOffers}
                                    costCalculations={mCostCalculations}
                                    freightQuotes={filterByCompany(freightQuotes.data)}
                                    products={mProducts}
                                    ports={ports.data}
                                    suppliers={mSuppliers}
                                    onSaveCalculation={costCalculations.addRecord}
                                    onUpdateCalculation={async (id, updates) => costCalculations.updateRecord({ ...updates, id } as any)}
                                    onDeleteCalculation={costCalculations.deleteRecord}
                                    onNavigate={(mod, sub, editId) => { if (editId) setPendingEditOfferId(editId); setActiveModule(mod); setSubModule(sub); }}
                                    currentCompanyId={currentCompanyId}
                                    currentUser={currentUser}
                                    onAddOffer={supplierOffers.addRecord}
                                    onDeleteOffer={supplierOffers.deleteRecord}
                                    onAddSupplier={suppliers.addRecord}
                                    onAddProduct={products.addRecord}
                                    onAddPort={ports.addRecord}
                                    availableCompanies={companies.data}
                                    customers={mCustomers}
                                    onSaveSalesOrder={addSalesOrder}
                                    onDeleteSalesOrder={deleteSalesOrder}
                                    onUpdateSalesOrder={updateSalesOrder}
                                    banks={mBanks}
                                    salesOrders={mSalesOrdersScoped}
                                    cargoAgents={filterByCompany(cargoAgents.data)}
                                />
                            )}
                            {subModule === 'ICRM' && (
                                <ICRM
                                    opportunities={filterOpportunitiesBySales(mOpportunities)}
                                    customers={mCustomers}
                                    products={filterByProductCategory(mProducts)}
                                    onAddOpportunity={opportunities.addRecord}
                                    onUpdateOpportunity={opportunities.updateRecord}
                                    onDeleteOpportunity={opportunities.deleteRecord}
                                    addProduct={products.addRecord}
                                    addCustomer={customers.addRecord}
                                    availableCompanies={companies.data}
                                    currentCompanyId={currentCompanyId}
                                />
                            )}
                            {subModule === 'CUSTOMERS' && (
                                <Customers
                                    customers={filterCustomersBySales(mCustomers)}
                                    onAdd={customers.addRecord}
                                    onUpdate={customers.updateRecord}
                                    onDelete={customers.deleteRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    ports={ports.data}
                                    onAddPort={ports.addRecord}
                                    users={users.data}
                                    currentUser={currentUser}
                                    paymentTerms={mPaymentTerms}
                                />
                            )}
                            {subModule === 'PIPELINE' && (
                                <Pipeline
                                    opportunities={filterOpportunitiesBySales(mOpportunities)}
                                    onAdd={opportunities.addRecord}
                                    onUpdate={opportunities.updateRecord}
                                    onDelete={opportunities.deleteRecord}
                                    customers={mCustomers}
                                    products={mProducts}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    addProduct={products.addRecord}
                                    addCustomer={customers.addRecord}
                                />
                            )}
                            {subModule === 'STATUS' && (
                                <CustomerStatus
                                    customers={mCustomers}
                                    opportunities={mOpportunities}
                                    shipments={mShipments}
                                />
                            )}
                            {subModule === 'PRICELIST' && (
                                <BigCalculator
                                    products={mProducts}
                                    suppliers={mSuppliers}
                                    supplierOffers={mSupplierOffers}
                                    supplierQuotes={mSupplierQuotes}
                                    freightQuotes={filterByCompany(freightQuotes.data)}
                                    ports={ports.data}
                                    savedCalculations={filterCalcsByProductCategory(mCostCalculations)}
                                    onSave={costCalculations.addRecord}
                                    onUpdate={costCalculations.updateRecord}
                                    onDelete={costCalculations.deleteRecord}
                                    onAddProduct={products.addRecord}
                                    onAddPort={ports.addRecord}
                                    onAddSupplier={suppliers.addRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    carriers={filterByCompany(carriers.data)}
                                    onAddCarrier={carriers.addRecord}
                                    locations={filterByCompany(locations.data)}
                                    onAddLocation={locations.addRecord}
                                    initialMode='PRICE_LIST'
                                    allowMargin={true}
                                />
                            )}
                            {subModule === 'ORDERS' && (
                                <SalesOrders
                                    currentUser={currentUser}
                                    currentCompanyId={currentCompanyId}
                                    customers={mCustomers}
                                    products={mProducts}
                                    bookings={mBookingsStrict}
                                    onAddBooking={bookings.addRecord}
                                    onUpdateBooking={bookings.updateRecord}
                                    ports={ports.data}
                                    onAddPort={ports.addRecord}
                                    freightQuotes={filterByCompany(freightQuotes.data)}
                                    onAddFreightQuote={freightQuotes.addRecord}
                                    locations={filterByCompany(locations.data)}
                                    onAddLocation={locations.addRecord}
                                    salesOrders={mSalesOrdersScoped}
                                    banks={mBanks}
                                    onAdd={addSalesOrder}
                                    onUpdate={updateSalesOrder}
                                    onDelete={deleteSalesOrder}
                                />
                            )}
                            {subModule === 'SALE_BRAZIL' && (
                                <SaleBrazil products={filterByProductCategory(mProducts)} />
                            )}
                        </div>
                    </div>
                );

            case 'PAPERWORK':
                return (
                    <div className="h-full flex flex-col">
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {(subModule === '' || subModule === 'PL_INVOICE_ENGINE') && <PLInvoiceEngine
                                packingLists={mPackingLists}
                                customers={mCustomers}
                                invoices={mInvoices}
                                salesOrders={mSalesOrdersScoped}
                                bookings={mBookings}
                                ports={ports.data}
                                onSaveInvoice={invoices.addRecord}
                                onUpdateInvoice={invoices.updateRecord}
                                onDeleteInvoice={invoices.deleteRecord}
                                currentCompanyId={currentCompanyId}
                                availableCompanies={companies.data}
                                onRefreshData={async () => {
                                    await Promise.all([
                                        packingLists.refetch(),
                                        invoices.refetch()
                                    ]);
                                }}
                                banks={mBanks}
                            />}
                            {subModule === 'SALES_FOLLOW_UP' && (
                                <SalesFollowUp
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    customers={mCustomers}
                                    salesOrders={mSalesOrdersScoped}
                                    invoices={mInvoices}
                                />
                            )}
                        </div>
                    </div>
                );

            case 'LOGISTICS':
                // CARGO_AGENT gets a simplified view without SubNav, but respects subModule
                if (currentUser.role === Role.CARGO_AGENT) {
                    if (subModule === 'BOOKINGS' || subModule === 'BL') {
                        return (
                            <LogisticsDocuments
                                activeType={subModule === 'BL' ? 'BL' : 'BOOKING'}
                                bookings={bookings.data}
                                billOfLadings={billOfLadings.data}
                                onDeleteBooking={bookings.deleteRecord}
                                onUpdateBooking={bookings.updateRecord}
                                onSaveBooking={bookings.addRecord}
                                onDeleteBL={billOfLadings.deleteRecord}
                                onUpdateBillOfLading={billOfLadings.updateRecord}
                                onSaveBL={billOfLadings.addRecord}
                                ports={ports.data}
                                shipments={shipments.data}
                                currentCompanyId={currentCompanyId}
                                currentUser={currentUser}
                                cargoAgents={cargoAgents.data}
                            />
                        );
                    }
                    // Default to FreightQuotes for CARGO_AGENT (subModule '' or 'FREIGHT')
                    return (
                        <FreightQuotes
                            quotes={freightQuotes.data}
                            dbError={freightQuotes.error}
                            onAdd={freightQuotes.addRecord}
                            onUpdate={freightQuotes.updateRecord}
                            onDelete={freightQuotes.deleteRecord}
                            ports={ports.data}
                            onAddPort={ports.addRecord}
                            cargoAgents={cargoAgents.data}
                            onAddAgent={cargoAgents.addRecord}
                            carriers={carriers.data}
                            onAddCarrier={carriers.addRecord}
                            locations={locations.data}
                            onAddLocation={locations.addRecord}
                            currentCompanyId={currentCompanyId}
                            availableCompanies={companies.data}
                            currentUser={currentUser}
                            suppliers={suppliers.data}
                        />
                    );
                }

                return (
                    <div className="h-full flex flex-col">
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {subModule === 'LOGISTICS_MANAGE' && (
                                <Logistics
                                    bookings={mBookings}
                                    billOfLadings={mBillOfLadings}
                                    inventory={mInventory}
                                    freightQuotes={filterByCompany(freightQuotes.data)}
                                    salesOrders={mSalesOrdersScoped}
                                    cargoAgents={filterByCompany(cargoAgents.data)}
                                    customers={mCustomers}
                                    ports={ports.data}
                                    invoices={mInvoices}
                                    currentCompanyId={currentCompanyId}
                                    onUpdateSalesOrder={updateSalesOrder}
                                    onUpdateFreightQuote={freightQuotes.updateRecord}
                                />
                            )}
                            {(subModule === '' || subModule === 'LOGISTICS_AI') && (
                                <ShipmentPipeline
                                    salesOrders={mSalesOrdersScoped}
                                    commissionOrders={mCommissions}
                                    bookings={mBookings}
                                    invoices={mInvoices}
                                    billOfLadings={mBillOfLadings}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    ports={ports.data}
                                    onUpdateCommission={commissions.updateRecord}
                                    onUpdateBooking={bookings.updateRecord}
                                />
                            )}
                            {(subModule === 'BOOKINGS' || subModule === 'BL') && (
                                <LogisticsDocuments
                                    activeType={subModule === 'BL' ? 'BL' : 'BOOKING'}
                                    bookings={mBookings}
                                    billOfLadings={mBillOfLadings}
                                    onDeleteBooking={bookings.deleteRecord}
                                    onUpdateBooking={bookings.updateRecord}
                                    onSaveBooking={bookings.addRecord}
                                    onDeleteBL={billOfLadings.deleteRecord}
                                    onUpdateBillOfLading={billOfLadings.updateRecord}
                                    onSaveBL={billOfLadings.addRecord}
                                    ports={ports.data}
                                    shipments={mShipments}
                                    currentCompanyId={currentCompanyId}
                                    currentUser={currentUser}
                                    cargoAgents={filterByCompany(cargoAgents.data)}
                                />
                            )}
                            {subModule === 'STOCK' && (
                                <Inventory
                                    inventory={mInventory}
                                    logs={mInventoryLogs}
                                    onAdd={inventory.addRecord}
                                    onUpdate={inventory.updateRecord}
                                    onDelete={inventory.deleteRecord}
                                    onAddLog={inventoryLogs.addRecord}
                                    onUpdateLog={inventoryLogs.updateRecord}
                                    onDeleteLog={inventoryLogs.deleteRecord}
                                    products={mProducts}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    currentUser={currentUser}
                                />
                            )}
                            {subModule === 'FREIGHT' && (
                                <FreightQuotes
                                    quotes={filterByCompany(freightQuotes.data)}
                                    onAdd={freightQuotes.addRecord}
                                    onUpdate={freightQuotes.updateRecord}
                                    onDelete={freightQuotes.deleteRecord}
                                    ports={ports.data}
                                    onAddPort={ports.addRecord}
                                    cargoAgents={filterByCompany(cargoAgents.data)}
                                    onAddAgent={cargoAgents.addRecord}
                                    carriers={filterByCompany(carriers.data)}
                                    onAddCarrier={carriers.addRecord}
                                    locations={filterByCompany(locations.data)}
                                    onAddLocation={locations.addRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    currentUser={currentUser}
                                    suppliers={mSuppliers}
                                />
                            )}
                            {subModule === 'AGENTS' && (
                                <CargoAgents
                                    agents={filterByCompany(cargoAgents.data)}
                                    onAdd={cargoAgents.addRecord}
                                    onUpdate={cargoAgents.updateRecord}
                                    onDelete={cargoAgents.deleteRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                />
                            )}

                        </div>
                    </div>
                );

            case 'DATA':
                return (
                    <div className="h-full flex flex-col">
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {(subModule === 'PRODUCTS' || subModule === '') && (
                                <Products
                                    products={filterByProductCategory(mProducts)}
                                    suppliers={mSuppliers}
                                    onAdd={products.addRecord}
                                    onUpdate={products.updateRecord}
                                    onDelete={products.deleteRecord}
                                    onAddSupplier={suppliers.addRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    currentUser={currentUser}
                                    productImages={images.data}
                                    onAddImage={images.addRecord}
                                    onDeleteImage={images.deleteRecord}
                                />
                            )}
                            {subModule === 'SUPPLIERS' && (
                                <Suppliers
                                    suppliers={mSuppliers}
                                    onAdd={suppliers.addRecord}
                                    onUpdate={suppliers.updateRecord}
                                    onDelete={suppliers.deleteRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    supplierQuotes={filterByCompany(supplierQuotes.data)}
                                    purchaseOrders={filterByCompany(purchaseOrders.data)}
                                />
                            )}
                            {subModule === 'PAYMENT_TERMS' && (
                                <PaymentTerms
                                    paymentTerms={mPaymentTerms}
                                    onAdd={paymentTermsData.addRecord}
                                    onUpdate={paymentTermsData.updateRecord}
                                    onDelete={paymentTermsData.deleteRecord}
                                    currentCompanyId={currentCompanyId}
                                />
                            )}
                            {subModule === 'CUSTOMERS' && (
                                <Customers
                                    customers={mCustomers}
                                    onAdd={customers.addRecord}
                                    onUpdate={customers.updateRecord}
                                    onDelete={customers.deleteRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    ports={ports.data}
                                    onAddPort={ports.addRecord}
                                    users={users.data}
                                    currentUser={currentUser}
                                    paymentTerms={mPaymentTerms}
                                />
                            )}
                            {subModule === 'PORTS' && (
                                <Ports
                                    ports={ports.data}
                                    onAdd={ports.addRecord}
                                    onUpdate={ports.updateRecord}
                                    onDelete={ports.deleteRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                />
                            )}
                            {subModule === 'AGENTS' && (
                                <CargoAgents
                                    agents={filterByCompany(cargoAgents.data)}
                                    onAdd={cargoAgents.addRecord}
                                    onUpdate={cargoAgents.updateRecord}
                                    onDelete={cargoAgents.deleteRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                />
                            )}
                            {subModule === 'BANKS' && (
                                <Banks
                                    banks={mBanks}
                                    onAdd={banks.addRecord}
                                    onUpdate={banks.updateRecord}
                                    onDelete={banks.deleteRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                />
                            )}
                            {subModule === 'CARRIERS' && (
                                <Carriers
                                    carriers={filterByCompany(carriers.data)}
                                    onAdd={carriers.addRecord}
                                    onUpdate={carriers.updateRecord}
                                    onDelete={carriers.deleteRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                />
                            )}
                            {subModule === 'LOCATIONS' && (
                                <Locations
                                    locations={mLocations}
                                    onAdd={locations.addRecord}
                                    onUpdate={locations.updateRecord}
                                    onDelete={locations.deleteRecord}
                                    suppliers={mSuppliers}
                                    customers={mCustomers}
                                    onAddSupplier={suppliers.addRecord}
                                    onAddCustomer={customers.addRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                />
                            )}
                            {subModule === 'DOC_VIEWER' && (
                                <DocViewer
                                    purchaseOrders={mPoExtracts}
                                    estimates={mEstimates}
                                    proformas={mProformas}
                                    bookings={mBookings}
                                    invoices={mInvoices}
                                    packingLists={mPackingLists}
                                    billOfLadings={mBillOfLadings}
                                />
                            )}
                            {subModule === 'AI' && (
                                <AiDataAssistant
                                    products={mProducts}
                                    suppliers={mSuppliers}
                                    customers={mCustomers}
                                    ports={ports.data}
                                />
                            )}
                            {subModule === 'INVOICE' && (
                                <div className="h-full overflow-y-auto custom-scrollbar">
                                    <AiUpload
                                        onSaveBL={billOfLadings.addRecord}
                                        onSaveBooking={bookings.addRecord}
                                        onSaveEstimate={estimates.addRecord}
                                        onSaveProforma={proformas.addRecord}
                                        onSavePO={poExtracts.addRecord}
                                        onSaveInvoice={invoices.addRecord}
                                        onSaveSupplierInvoice={supplierInvoices.addRecord}
                                        onSavePackingList={packingLists.addRecord}
                                        currentCompanyId={currentCompanyId}
                                        ports={ports.data}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                );

            case 'AI_UPLOAD':
                return (
                    <div className="h-full flex flex-col">
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {(subModule === 'INVOICE' || subModule === '') && (
                                <div className="h-full overflow-y-auto custom-scrollbar">
                                    <AiUpload
                                        onSaveBL={billOfLadings.addRecord}
                                        onSaveBooking={bookings.addRecord}
                                        onSaveEstimate={estimates.addRecord}
                                        onSaveProforma={proformas.addRecord}
                                        onSavePO={poExtracts.addRecord}
                                        onSaveInvoice={invoices.addRecord}
                                        onSaveSupplierInvoice={supplierInvoices.addRecord}
                                        onSavePackingList={packingLists.addRecord}
                                        currentCompanyId={currentCompanyId}
                                        ports={ports.data}
                                    />
                                </div>
                            )}

                            {subModule === 'INBOX_SCANNER' && (
                                <ConnectionsHub
                                    onNavigate={(mod, sub) => { setActiveModule(mod); setSubModule(sub); }}
                                    onSaveBL={billOfLadings.addRecord}
                                    onSaveBooking={bookings.addRecord}
                                    onSaveEstimate={estimates.addRecord}
                                    onSaveProforma={proformas.addRecord}
                                    onSavePO={poExtracts.addRecord}
                                    onSaveInvoice={invoices.addRecord}
                                    onSaveSupplierInvoice={supplierInvoices.addRecord}
                                    onSavePackingList={packingLists.addRecord}
                                    currentCompanyId={currentCompanyId}
                                    ports={ports.data}
                                    currentUser={currentUser}
                                />
                            )}
                            {(subModule === 'COST_PROFIT_AI' || subModule === '' || subModule === 'PROPOSAL_ENGINE') && (
                                <CostProfitAI
                                    initialStep={subModule === 'PROPOSAL_ENGINE' ? 0 : undefined}
                                    supplierOffers={mSupplierOffers}
                                    costCalculations={mCostCalculations}
                                    freightQuotes={filterByCompany(freightQuotes.data)}
                                    products={mProducts}
                                    ports={ports.data}
                                    suppliers={mSuppliers}
                                    onSaveCalculation={costCalculations.addRecord}
                                    onUpdateCalculation={async (id, updates) => costCalculations.updateRecord({ ...updates, id } as any)}
                                    onDeleteCalculation={costCalculations.deleteRecord}
                                    onNavigate={(mod, sub, editId) => { if (editId) setPendingEditOfferId(editId); setActiveModule(mod); setSubModule(sub); }}
                                    currentCompanyId={currentCompanyId}
                                    currentUser={currentUser}
                                    onAddOffer={supplierOffers.addRecord}
                                    onDeleteOffer={supplierOffers.deleteRecord}
                                    onAddSupplier={suppliers.addRecord}
                                    onAddProduct={products.addRecord}
                                    onAddPort={ports.addRecord}
                                    availableCompanies={companies.data}
                                    customers={mCustomers}
                                    onSaveSalesOrder={addSalesOrder}
                                    onDeleteSalesOrder={deleteSalesOrder}
                                    onUpdateSalesOrder={updateSalesOrder}
                                    banks={mBanks}
                                    salesOrders={mSalesOrdersScoped}
                                    cargoAgents={filterByCompany(cargoAgents.data)}
                                />
                            )}
                            {subModule === 'CALC_AI' && (
                                <AiCalculator
                                    savedCalculations={mCostCalculations}
                                    products={mProducts}
                                    freightQuotes={filterByCompany(freightQuotes.data)}
                                />
                            )}
                        </div>
                    </div>
                );



            // NEW: Customer Portal
            case 'CUSTOMER_PORTAL':
                // Determine customer context
                let customerName = 'Guest';
                let mySalesOrders: any[] = [];
                let myBookings: any[] = [];
                let myBLs: any[] = [];
                let myInvoices: any[] = [];

                if (currentUser.role === Role.CUSTOMER && currentUser.linked_entity_id) {
                    const myCustomer = customers.data.find(c => c.id === currentUser.linked_entity_id);
                    if (myCustomer) {
                        customerName = myCustomer.name;
                        // Filter string based on name match (fuzzy for flexibility)
                        mySalesOrders = salesOrders.filter(o => o.customerId === myCustomer.id);
                        myBookings = bookings.data.filter(b => b.customer && b.customer.toLowerCase().includes(myCustomer.name.toLowerCase()));
                        myBLs = billOfLadings.data.filter(bl => bl.consignee && bl.consignee.toLowerCase().includes(myCustomer.name.toLowerCase()));
                        myInvoices = invoices.data.filter(inv => inv.soldTo && inv.soldTo.toLowerCase().includes(myCustomer.name.toLowerCase()));
                    }
                } else if (currentUser.role === Role.ADMIN || currentUser.role === Role.CEO) {
                    // Admin View: Pass all data (or filtered by company context)
                    customerName = 'Internal View';
                    const scopedData = filterByCompanyStrict; // Use helper
                    mySalesOrders = salesOrders; // Already filtered by hook/company context logic usually, but here distinct
                    myBookings = scopedData(bookings.data);
                    myBLs = scopedData(billOfLadings.data);
                    myInvoices = scopedData(invoices.data);
                }

                return (
                    <CustomerPortal
                        customerName={customerName}
                        currentUser={currentUser}
                        salesOrders={mySalesOrders}
                        bookings={myBookings}
                        billOfLadings={myBLs}
                        allBillOfLadings={billOfLadings.data}
                        invoices={myInvoices}
                    />
                );


            case 'SETTINGS':
                return (
                    <div className="h-full flex flex-col">
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {subModule === '' && (
                                <AdminUsers
                                    users={users.data}
                                    onAdd={users.addRecord}
                                    onUpdate={users.updateRecord}
                                    onDelete={users.deleteRecord}
                                    companies={companies.data}
                                    cargoAgents={cargoAgents.data}
                                    currentUser={currentUser}
                                    customers={customers.data}
                                    products={products.data}
                                />
                            )}
                            {subModule === 'COMPANIES' && (
                                <AdminCompanies
                                    companies={companies.data}
                                    onAdd={companies.addRecord}
                                    onUpdate={companies.updateRecord}
                                    onDelete={companies.deleteRecord}
                                />
                            )}

                            {subModule === 'DB' && <AdminSettings />}
                            {subModule === 'BRANDING' && <AdminBranding />}
                            {subModule === 'INTEGRATIONS' && <AdminCredentials />}

                            {subModule === 'BRAIN' && <BrainDiagnostics />}
                            {subModule === 'USERS' && (
                                <AdminUsers
                                    users={users.data}
                                    onAdd={users.addRecord}
                                    onUpdate={users.updateRecord}
                                    onDelete={users.deleteRecord}
                                    companies={companies.data}
                                    cargoAgents={cargoAgents.data}
                                    currentUser={currentUser!}
                                    customers={customers.data}
                                    products={products.data}
                                />
                            )}
                        </div>
                    </div>
                );

            default:
                return <div>Module Not Found</div>;
        }
    };

    return (
        <div className="flex flex-col bg-slate-50 h-screen overflow-hidden font-sans text-slate-900">
            <TopNavigation
                activeModule={activeModule}
                setActiveModule={(mod) => {
                    setActiveModule(mod);
                    // Activity Log: module switch
                    activityLogger.logNavigation(mod);
                    // Don't reset subModule here - TopNavigation handles it via setSubModule prop
                    // The old code was calling setSubModule('') which conflicted with dropdown item clicks
                }}
                subModule={subModule}
                setSubModule={(sub: string) => {
                    setSubModule(sub);
                    // Activity Log: sub-module switch
                    activityLogger.logNavigation(activeModule, sub);
                }}
                currentUser={currentUser}
                onLogout={handleLogout}
                availableCompanies={companies.data}
                currentCompanyId={currentCompanyId}
                onSwitchCompany={setCurrentCompanyId}
                onToggleAiSidebar={() => setShowAiSidebar(true)}
            />

            <div className="flex-1 flex flex-col h-screen pt-14 relative">
                <main className="flex-1 p-3 overflow-hidden flex flex-col">
                    <ErrorBoundary>
                        <Suspense fallback={<PageLoader />}>
                            {renderContent()}
                        </Suspense>
                    </ErrorBoundary>
                </main>

                <footer className="bg-white border-t border-slate-100 flex items-center justify-between px-4 text-[10px] text-slate-400 tracking-wider shrink-0 z-50 select-none py-0.5">
                    <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${dbConnectionStatus ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                        <span className="flex items-center gap-1"><Wifi size={10} /> {dbConnectionStatus ? 'Online' : 'Offline'}</span>
                    </div>

                    <div className="flex-1 flex justify-center -my-0.5">
                        {activeModule !== 'CUSTOMER_PORTAL' && (
                            <Dock
                                activeModule={activeModule}
                                subModule={subModule}
                                setActiveModule={setActiveModule}
                                setSubModule={setSubModule}
                                currentUser={currentUser}
                                onUpdateUser={setCurrentUser}
                                onToggleHelp={() => setShowHelp(true)}
                            />
                        )}
                    </div>

                    <div className="flex items-center gap-1">
                        <Database size={10} />
                        <span>Live</span>
                    </div>
                </footer>
            </div>


            {showHelp && (
                <HelpCenter onClose={() => setShowHelp(false)} role={currentUser.role} />
            )}

            {/* Auto-Create Pipeline: Pending Documents Review Banner */}
            <PendingDocsBanner companyId={currentCompanyId} />

            <AiCopilotSidebar
                isOpen={showAiSidebar}
                onClose={() => setShowAiSidebar(false)}
                currentUser={currentUser}
                activeModule={activeModule}
                subModule={subModule}
                currentCompany={currentCompanyId}
                allowedModules={currentUser.allowed_modules || Object.keys(navigationConfig)}
                contextData={{
                    customers: { count: mCustomers.length, sample: mCustomers.slice(0, 8).map((c: any) => c.name || c.customerName || 'N/A') },
                    products: { count: mProducts.length, sample: mProducts.slice(0, 8).map((p: any) => p.name || 'N/A') },
                    salesOrders: { count: mSalesOrdersScoped.length, recent: mSalesOrdersScoped.slice(0, 5).map((o: any) => ({ id: o.id, customer: o.customerName, status: o.status, total: o.totalAmount })) },
                    suppliers: { count: mSuppliers.length, sample: mSuppliers.slice(0, 8).map((s: any) => s.name || 'N/A') },
                    opportunities: { count: mOpportunities.length },
                    bookings: { count: mBookings.length, active: mBookings.filter((b: any) => b.status !== 'COMPLETED').slice(0, 5).map((b: any) => ({ booking: b.bookingNumber, customer: b.customer, pol: b.pol, pod: b.pod, status: b.status })) },
                    billOfLadings: { count: mBillOfLadings.length },
                    shipments: { count: mShipments.length },
                    freightQuotes: { count: freightQuotes.data.length },
                    purchaseOrders: { count: mPurchaseOrders.length },
                    inventory: { count: mInventory.length },
                    costCalculations: { count: mCostCalculations.length },
                    ports: { count: ports.data.length, sample: ports.data.slice(0, 8).map((p: any) => p.name || p.portName || 'N/A') },
                    cargoAgents: { count: cargoAgents.data.length, sample: cargoAgents.data.slice(0, 5).map((a: any) => a.name || 'N/A') }
                }}
                onAddPort={ports.addRecord}
            />
        </div>
    );
};

export default App;
