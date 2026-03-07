
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
const Banks = lazyWithRetry(() => import('./pages/Banks'));
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

import { Database, Wifi } from 'lucide-react';

import { useSupabase } from './hooks/useSupabase';
import { checkSupabaseConnection } from './services/supabase';
import { checkAndTriggerAutoBackup } from './services/backupService';
import { activityLogger } from './services/activityLogService';

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
    // Authentication State - only restore session if returning from MSAL OAuth redirect
    const [currentUser, setCurrentUser] = useState<User | null>(() => {
        try {
            const isMsalRedirect = window.location.hash.includes('code=') || window.location.hash.includes('state=');
            if (isMsalRedirect) {
                const saved = sessionStorage.getItem('xs_current_user');
                return saved ? JSON.parse(saved) : null;
            }
            sessionStorage.removeItem('xs_current_user');
            return null;
        } catch { return null; }
    });
    const [dbConnectionStatus, setDbConnectionStatus] = useState<boolean>(false);

    // Navigation State
    const [activeModule, setActiveModule] = useState('DASHBOARD');
    const [subModule, setSubModule] = useState<string>('');
    const [currentCompanyId, setCurrentCompanyId] = useState<string>('ALL');
    const [pendingCalcOffer, setPendingCalcOffer] = useState<any>(null);
    const [pendingEditOfferId, setPendingEditOfferId] = useState<string | null>(null);
    const [costViewMode, setCostViewMode] = useState<'SHEET' | 'IMPORT'>('SHEET');

    // Help Center
    const [showHelp, setShowHelp] = useState(false);
    const [showAiSidebar, setShowAiSidebar] = useState(false);

    // --- DATA HOOKS (Supabase) ---
    const users = useSupabase<User>('users');
    const companies = useSupabase<Company>('companies');

    const customers = useSupabase<Customer>('customers');
    const suppliers = useSupabase<Supplier>('suppliers');
    const cargoAgents = useSupabase<CargoAgent>('cargo_agents');
    const carriers = useSupabase<Carrier>('carriers');

    const products = useSupabase<Product>('products');
    const ports = useSupabase<Port>('ports');
    const banks = useSupabase<Bank>('banks');
    const locations = useSupabase<SavedLocation>('saved_locations');

    const opportunities = useSupabase<Opportunity>('opportunities');
    const costCalculations = useSupabase<CostCalculation>('cost_calculations');

    const supplierQuotes = useSupabase<SupplierQuote>('supplier_quotes');
    const supplierOffers = useSupabase<SupplierOffer>('supplier_offers');
    const purchaseOrders = useSupabase<PurchaseOrder>('purchase_orders');
    const freightQuotes = useSupabase<FreightQuote>('freight_quotes');

    const inventory = useSupabase<InventoryItem>('inventory');
    const inventoryLogs = useSupabase<InventoryLog>('inventory_logs');
    const shipments = useSupabase<Shipment>('shipments');

    const billOfLadings = useSupabase<BillOfLading>('bill_landings');
    const bookings = useSupabase<Booking>('bookings', {
        select: 'id, companyId, createdAt, bookingNumber, customer, vesselVoyage, pol, pod, equipment, etd, eta, cargoCutOff, vgmCutOff, draftCutOff, freeTime, terminal, agentName, salesOrderId, status, originalDocument'
    });

    const estimates = useSupabase<Estimate>('estimates', {
        select: 'id, companyId, createdAt, estimateNumber, supplier, buyer, shipTo, payTo, date, terms, incoterm, subtotal, tax, totalAmount, currency, items, acceptedBy, acceptedDate'
    });
    const proformas = useSupabase<ProformaInvoice>('proforma_invoices', {
        select: 'id, companyId, createdAt, piNumber, supplier, buyer, shipTo, payTo, date, terms, incoterm, subtotal, tax, totalAmount, currency, items, acceptedBy, acceptedDate'
    });
    const invoices = useSupabase<Invoice>('invoices', {
        select: 'id, companyId, createdAt, invoiceNumber, invoiceDate, shipperName, shipperAddress, soldTo, shipTo, paymentTerms, incoterm, dateOrder, customerPo, carrier, transportRef, freightTerms, items, grossWeight, netWeight, tareWeight, totalQuantity, subtotal, totalAmount, currency, remitTo, bankName, bankAddress, swiftCode, routingNumber, accountNumber, supplier, date, soNumber, bookingNumber, shipper, consignee, pod, poa, bl, memo, containers, plNumber, billToName, bolUrl'
    });
    const supplierInvoices = useSupabase<SupplierInvoice>('invoices_suppliers');
    const packingLists = useSupabase<PackingList>('packing_lists', {
        select: 'id, companyId, createdAt, plNumber, blNumber, shipper, supplier, consignee, shippingPoint, destination, date, carrier, containerNumber, sealNumber, vesselVoyage, productDescription, unitCount, unitNumbers, grossWeight, netWeight, freightTerms, poNumber, notes, scheduledShipDate, items, soNumber, status'
    });
    const poExtracts = useSupabase<PurchaseOrderExtract>('purchase_order_extracts', {
        select: 'id, companyId, createdAt, poNumber, vendor, date, totalAmount, currency, items'
    });

    const { data: salesOrders, addRecord: addSalesOrder, updateRecord: updateSalesOrder, deleteRecord: deleteSalesOrder } = useSupabase<SalesOrder>('sales_orders');

    // Applied limit and specific column selection to avoid timeout due to Base64 columns
    const commissions = useSupabase<CommissionSalesOrder>('commission_sales_orders', {
        select: 'id, orderNumber, invoiceNumber, sellerName, customerName, pod, deliveryDate, status, orderTotal, invoiceStatus, commissionAmount, commissionPaymentStatus, createdAt, companyId, items, commissionRate, commissionType, blNumber, blDocumentUrl, pol, etd, eta',
        limit: 51,
        orderBy: { column: 'createdAt', ascending: false }
    });

    const images = useSupabase<CompanyImage>('imagens');

    useEffect(() => {
        checkSupabaseConnection().then(status => setDbConnectionStatus(status));
    }, []);

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
        sessionStorage.setItem('xs_current_user', JSON.stringify(user));
        setTimeout(() => window.scrollTo(0, 0), 100);

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

        setCurrentUser(null);
        sessionStorage.removeItem('xs_current_user');
        setActiveModule('DASHBOARD');
        setSubModule('');
    }, []);

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
                        customers={filterByCompany(customers.data)}
                        suppliers={filterByCompany(suppliers.data)}
                        ports={ports.data}
                        salesQuotes={[]}
                        supplierQuoteRequests={filterByCompany(supplierQuotes.data)}
                        supplierOffers={filterByCompany(supplierOffers.data)}
                        opportunities={filterByCompany(opportunities.data)}
                        shipments={filterByCompany(shipments.data)}
                        purchaseOrders={filterByCompany(purchaseOrders.data)}
                        products={filterByCompany(products.data)}
                        inventory={filterByCompany(inventory.data)}
                        inventoryLogs={filterByCompany(inventoryLogs.data)}
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
                        salesOrdersData={filterSalesOrdersByCreator(filterByCompany(salesOrders))}
                        bookingsData={filterByCompany(bookings.data)}
                        billOfLadingsData={filterByCompany(billOfLadings.data)}
                        cargoAgentsData={filterByCompany(cargoAgents.data)}
                        freightQuotesData={filterByCompany(freightQuotes.data)}
                        invoicesData={filterByCompany(invoices.data)}
                        estimatesData={filterByCompany(estimates.data)}
                        proformasData={filterByCompany(proformas.data)}
                        packingListsData={filterByCompany(packingLists.data)}
                        supplierInvoicesData={filterByCompany(supplierInvoices.data)}
                        commissionsData={filterByCompany(commissions.data)}
                    />
                );

            case 'BUY':
                return (
                    <div className="h-full flex flex-col">
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {(subModule === '' || subModule === 'SUPPLIERS') && (
                                <Suppliers
                                    suppliers={filterByCompany(suppliers.data)}
                                    onAdd={suppliers.addRecord}
                                    onUpdate={suppliers.updateRecord}
                                    onDelete={suppliers.deleteRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    supplierQuotes={supplierQuotes.data}
                                    purchaseOrders={purchaseOrders.data}
                                />
                            )}
                            {subModule === 'OFFERS' && (
                                <SupplierOffers
                                    offers={filterByCompany(supplierOffers.data)}
                                    onAdd={supplierOffers.addRecord}
                                    onUpdate={supplierOffers.updateRecord}
                                    onDelete={supplierOffers.deleteRecord}
                                    suppliers={filterByCompany(suppliers.data)}
                                    products={filterByCompany(products.data)}
                                    onAddProduct={products.addRecord}
                                    onAddSupplier={suppliers.addRecord}
                                    ports={ports.data}
                                    onAddPort={ports.addRecord}
                                    locations={locations.data}
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
                                    purchaseOrders={filterByCompany(purchaseOrders.data)}
                                    onAdd={purchaseOrders.addRecord}
                                    onUpdate={purchaseOrders.updateRecord}
                                    onDelete={purchaseOrders.deleteRecord}
                                    suppliers={filterByCompany(suppliers.data)}
                                    products={filterByCompany(products.data)}
                                    onAddProduct={products.addRecord}
                                    onAddSupplier={suppliers.addRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                />
                            )}
                            {subModule === 'AI' && (
                                <AiProcurement
                                    suppliers={filterByCompany(suppliers.data)}
                                    purchaseOrders={filterByCompany(purchaseOrders.data)}
                                    supplierOffers={filterByCompany(supplierOffers.data)}
                                />
                            )}
                            {subModule === 'STOCK' && (
                                <Inventory
                                    inventory={filterByCompany(inventory.data)}
                                    logs={filterByCompany(inventoryLogs.data)}
                                    onAdd={inventory.addRecord}
                                    onUpdate={inventory.updateRecord}
                                    onDelete={inventory.deleteRecord}
                                    onAddLog={inventoryLogs.addRecord}
                                    onUpdateLog={inventoryLogs.updateRecord}
                                    onDeleteLog={inventoryLogs.deleteRecord}
                                    products={filterByCompany(products.data)}
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
                                    products: filterByCompany(products.data),
                                    suppliers: filterByCompany(suppliers.data),
                                    supplierOffers: filterByCompany(supplierOffers.data),
                                    supplierQuotes: filterByCompany(supplierQuotes.data),
                                    freightQuotes: freightQuotes.data,
                                    salesOrders: filterSalesOrdersByCreator(filterByCompany(salesOrders)),
                                    ports: ports.data,
                                    savedCalculations: filterByCompany(costCalculations.data),
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
                            <Commissions
                                commissions={filterCommissionsBySales(filterByCompany(commissions.data))}
                                onAdd={commissions.addRecord}
                                onUpdate={commissions.updateRecord}
                                onDelete={commissions.deleteRecord}
                                customers={filterByCompany(customers.data)}
                                suppliers={filterByCompany(suppliers.data)}
                                currentUser={currentUser}
                                currentCompanyId={currentCompanyId}
                                ports={ports.data}
                                billOfLadings={filterByCompany(billOfLadings.data)}
                                onSaveBL={billOfLadings.addRecord}
                            />
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
                                opportunities={filterOpportunitiesBySales(filterByCompany(opportunities.data))}
                                salesOrders={filterSalesOrdersByCreator(filterByCompany(salesOrders))}
                                commissions={filterCommissionsBySales(filterByCompany(commissions.data))}
                                customers={filterCustomersBySales(filterByCompany(customers.data))}
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
                                    opportunities={filterOpportunitiesBySales(filterByCompany(opportunities.data))}
                                    customers={filterByCompany(customers.data)}
                                    products={filterByCompany(products.data)}
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
                                    customers={filterCustomersBySales(filterByCompany(customers.data))}
                                    onAdd={customers.addRecord}
                                    onUpdate={customers.updateRecord}
                                    onDelete={customers.deleteRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    ports={ports.data}
                                    onAddPort={ports.addRecord}
                                    users={users.data}
                                    currentUser={currentUser}
                                />
                            )}
                            {subModule === 'PIPELINE' && (
                                <Pipeline
                                    opportunities={filterOpportunitiesBySales(filterByCompany(opportunities.data))}
                                    onAdd={opportunities.addRecord}
                                    onUpdate={opportunities.updateRecord}
                                    onDelete={opportunities.deleteRecord}
                                    customers={filterByCompany(customers.data)}
                                    products={filterByCompany(products.data)}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    addProduct={products.addRecord}
                                    addCustomer={customers.addRecord}
                                />
                            )}
                            {subModule === 'PRICELIST' && (
                                <BigCalculator
                                    products={filterByProductCategory(filterByCompany(products.data))}
                                    suppliers={filterByCompany(suppliers.data)}
                                    supplierOffers={filterByCompany(supplierOffers.data)}
                                    supplierQuotes={filterByCompany(supplierQuotes.data)}
                                    freightQuotes={freightQuotes.data}
                                    ports={ports.data}
                                    savedCalculations={filterCalcsByProductCategory(filterByCompany(costCalculations.data))}
                                    onSave={costCalculations.addRecord}
                                    onUpdate={costCalculations.updateRecord}
                                    onDelete={costCalculations.deleteRecord}
                                    onAddProduct={products.addRecord}
                                    onAddPort={ports.addRecord}
                                    onAddSupplier={suppliers.addRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    carriers={carriers.data}
                                    onAddCarrier={carriers.addRecord}
                                    locations={locations.data}
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
                                    customers={filterByCompany(customers.data)}
                                    products={filterByCompany(products.data)}
                                    bookings={filterByCompanyStrict(bookings.data)}
                                    onAddBooking={bookings.addRecord}
                                    onUpdateBooking={bookings.updateRecord}
                                    ports={ports.data}
                                    onAddPort={ports.addRecord}
                                    freightQuotes={freightQuotes.data}
                                    onAddFreightQuote={freightQuotes.addRecord}
                                    locations={locations.data}
                                    onAddLocation={locations.addRecord}
                                    salesOrders={filterSalesOrdersByCreator(filterByCompany(salesOrders))}
                                    banks={filterByCompany(banks.data)}
                                    onAdd={addSalesOrder}
                                    onUpdate={updateSalesOrder}
                                    onDelete={deleteSalesOrder}
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
                                <FinancePayables invoices={filterByCompany(supplierInvoices.data)} onDelete={supplierInvoices.deleteRecord} onUpdate={supplierInvoices.updateRecord} onSave={supplierInvoices.addRecord} currentCompanyId={currentCompanyId} banks={filterByCompany(banks.data)} />
                            )}
                            {subModule === 'RECEIVABLES' && (
                                <FinanceReceivables invoices={filterByCompany(invoices.data)} onDelete={invoices.deleteRecord} onUpdate={invoices.updateRecord} onSave={invoices.addRecord} currentCompanyId={currentCompanyId} />
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
                                    supplierOffers={filterByCompany(supplierOffers.data)}
                                    costCalculations={filterByCompany(costCalculations.data)}
                                    freightQuotes={filterByCompany(freightQuotes.data)}
                                    products={filterByCompany(products.data)}
                                    ports={ports.data}
                                    suppliers={filterByCompany(suppliers.data)}
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
                                    customers={filterByCompany(customers.data)}
                                    onSaveSalesOrder={addSalesOrder}
                                    onDeleteSalesOrder={deleteSalesOrder}
                                    onUpdateSalesOrder={updateSalesOrder}
                                    banks={filterByCompany(banks.data)}
                                    salesOrders={filterSalesOrdersByCreator(filterByCompany(salesOrders))}
                                    cargoAgents={cargoAgents.data}
                                />
                            )}
                            {subModule === 'ICRM' && (
                                <ICRM
                                    opportunities={filterOpportunitiesBySales(filterByCompany(opportunities.data))}
                                    customers={filterByCompany(customers.data)}
                                    products={filterByProductCategory(filterByCompany(products.data))}
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
                                    customers={filterCustomersBySales(filterByCompany(customers.data))}
                                    onAdd={customers.addRecord}
                                    onUpdate={customers.updateRecord}
                                    onDelete={customers.deleteRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    ports={ports.data}
                                    onAddPort={ports.addRecord}
                                    users={users.data}
                                    currentUser={currentUser}
                                />
                            )}
                            {subModule === 'PIPELINE' && (
                                <Pipeline
                                    opportunities={filterOpportunitiesBySales(filterByCompany(opportunities.data))}
                                    onAdd={opportunities.addRecord}
                                    onUpdate={opportunities.updateRecord}
                                    onDelete={opportunities.deleteRecord}
                                    customers={filterByCompany(customers.data)}
                                    products={filterByCompany(products.data)}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    addProduct={products.addRecord}
                                    addCustomer={customers.addRecord}
                                />
                            )}
                            {subModule === 'STATUS' && (
                                <CustomerStatus
                                    customers={filterByCompany(customers.data)}
                                    opportunities={filterByCompany(opportunities.data)}
                                    shipments={filterByCompany(shipments.data)}
                                />
                            )}
                            {subModule === 'PRICELIST' && (
                                <BigCalculator
                                    products={filterByCompany(products.data)}
                                    suppliers={filterByCompany(suppliers.data)}
                                    supplierOffers={filterByCompany(supplierOffers.data)}
                                    supplierQuotes={filterByCompany(supplierQuotes.data)}
                                    freightQuotes={freightQuotes.data}
                                    ports={ports.data}
                                    savedCalculations={filterCalcsByProductCategory(filterByCompany(costCalculations.data))}
                                    onSave={costCalculations.addRecord}
                                    onUpdate={costCalculations.updateRecord}
                                    onDelete={costCalculations.deleteRecord}
                                    onAddProduct={products.addRecord}
                                    onAddPort={ports.addRecord}
                                    onAddSupplier={suppliers.addRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    carriers={carriers.data}
                                    onAddCarrier={carriers.addRecord}
                                    locations={locations.data}
                                    onAddLocation={locations.addRecord}
                                    initialMode='PRICE_LIST'
                                    allowMargin={true}
                                />
                            )}
                            {subModule === 'ORDERS' && (
                                <SalesOrders
                                    currentUser={currentUser}
                                    currentCompanyId={currentCompanyId}
                                    customers={filterByCompany(customers.data)}
                                    products={filterByCompany(products.data)}
                                    bookings={filterByCompanyStrict(bookings.data)}
                                    onAddBooking={bookings.addRecord}
                                    onUpdateBooking={bookings.updateRecord}
                                    ports={ports.data}
                                    onAddPort={ports.addRecord}
                                    freightQuotes={freightQuotes.data}
                                    onAddFreightQuote={freightQuotes.addRecord}
                                    locations={locations.data}
                                    onAddLocation={locations.addRecord}
                                    salesOrders={filterSalesOrdersByCreator(filterByCompany(salesOrders))}
                                    banks={filterByCompany(banks.data)}
                                    onAdd={addSalesOrder}
                                    onUpdate={updateSalesOrder}
                                    onDelete={deleteSalesOrder}
                                />
                            )}
                            {subModule === 'SALE_BRAZIL' && (
                                <SaleBrazil products={filterByProductCategory(filterByCompany(products.data))} />
                            )}
                        </div>
                    </div>
                );

            case 'PAPERWORK':
                return (
                    <div className="h-full flex flex-col">
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {(subModule === '' || subModule === 'PL_INVOICE_ENGINE') && <PLInvoiceEngine
                                packingLists={filterByCompany(packingLists.data)}
                                customers={filterByCompany(customers.data)}
                                invoices={filterByCompany(invoices.data)}
                                salesOrders={filterSalesOrdersByCreator(filterByCompany(salesOrders))}
                                bookings={filterByCompany(bookings.data)}
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
                                banks={filterByCompany(banks.data)}
                            />}
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
                                bookings={filterByCompany(bookings.data)}
                                billOfLadings={filterByCompany(billOfLadings.data)}
                                onDeleteBooking={bookings.deleteRecord}
                                onUpdateBooking={bookings.updateRecord}
                                onSaveBooking={bookings.addRecord}
                                onDeleteBL={billOfLadings.deleteRecord}
                                onUpdateBillOfLading={billOfLadings.updateRecord}
                                onSaveBL={billOfLadings.addRecord}
                                ports={ports.data}
                                shipments={filterByCompany(shipments.data)}
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
                        />
                    );
                }

                return (
                    <div className="h-full flex flex-col">
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
                            {subModule === 'LOGISTICS_MANAGE' && (
                                <Logistics
                                    bookings={filterByCompany(bookings.data)}
                                    billOfLadings={filterByCompany(billOfLadings.data)}
                                    inventory={filterByCompany(inventory.data)}
                                    freightQuotes={freightQuotes.data}
                                    salesOrders={filterSalesOrdersByCreator(filterByCompany(salesOrders))}
                                    cargoAgents={cargoAgents.data}
                                    customers={filterByCompany(customers.data)}
                                    ports={ports.data}
                                    invoices={filterByCompany(invoices.data)}
                                    currentCompanyId={currentCompanyId}
                                    onUpdateSalesOrder={updateSalesOrder}
                                    onUpdateFreightQuote={freightQuotes.updateRecord}
                                />
                            )}
                            {(subModule === '' || subModule === 'LOGISTICS_AI') && (
                                <ShipmentPipeline
                                    salesOrders={filterSalesOrdersByCreator(filterByCompany(salesOrders))}
                                    commissionOrders={filterByCompany(commissions.data)}
                                    bookings={filterByCompany(bookings.data)}
                                    invoices={filterByCompany(invoices.data)}
                                    billOfLadings={filterByCompany(billOfLadings.data)}
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
                                    bookings={filterByCompany(bookings.data)}
                                    billOfLadings={filterByCompany(billOfLadings.data)}
                                    onDeleteBooking={bookings.deleteRecord}
                                    onUpdateBooking={bookings.updateRecord}
                                    onSaveBooking={bookings.addRecord}
                                    onDeleteBL={billOfLadings.deleteRecord}
                                    onUpdateBillOfLading={billOfLadings.updateRecord}
                                    onSaveBL={billOfLadings.addRecord}
                                    ports={ports.data}
                                    shipments={filterByCompany(shipments.data)}
                                    currentCompanyId={currentCompanyId}
                                    currentUser={currentUser}
                                    cargoAgents={cargoAgents.data}
                                />
                            )}
                            {subModule === 'STOCK' && (
                                <Inventory
                                    inventory={filterByCompany(inventory.data)}
                                    logs={filterByCompany(inventoryLogs.data)}
                                    onAdd={inventory.addRecord}
                                    onUpdate={inventory.updateRecord}
                                    onDelete={inventory.deleteRecord}
                                    onAddLog={inventoryLogs.addRecord}
                                    onUpdateLog={inventoryLogs.updateRecord}
                                    onDeleteLog={inventoryLogs.deleteRecord}
                                    products={filterByCompany(products.data)}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    currentUser={currentUser}
                                />
                            )}
                            {subModule === 'FREIGHT' && (
                                <FreightQuotes
                                    quotes={freightQuotes.data}
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
                                />
                            )}
                            {subModule === 'AGENTS' && (
                                <CargoAgents
                                    agents={cargoAgents.data}
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
                                    products={filterByProductCategory(filterByCompany(products.data))}
                                    suppliers={filterByCompany(suppliers.data)}
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
                                    suppliers={filterByCompany(suppliers.data)}
                                    onAdd={suppliers.addRecord}
                                    onUpdate={suppliers.updateRecord}
                                    onDelete={suppliers.deleteRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    supplierQuotes={supplierQuotes.data}
                                    purchaseOrders={purchaseOrders.data}
                                />
                            )}
                            {subModule === 'CUSTOMERS' && (
                                <Customers
                                    customers={filterByCompany(customers.data)}
                                    onAdd={customers.addRecord}
                                    onUpdate={customers.updateRecord}
                                    onDelete={customers.deleteRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    ports={ports.data}
                                    onAddPort={ports.addRecord}
                                    users={users.data}
                                    currentUser={currentUser}
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
                                    agents={cargoAgents.data}
                                    onAdd={cargoAgents.addRecord}
                                    onUpdate={cargoAgents.updateRecord}
                                    onDelete={cargoAgents.deleteRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                />
                            )}
                            {subModule === 'BANKS' && (
                                <Banks
                                    banks={filterByCompany(banks.data)}
                                    onAdd={banks.addRecord}
                                    onUpdate={banks.updateRecord}
                                    onDelete={banks.deleteRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                />
                            )}
                            {subModule === 'CARRIERS' && (
                                <Carriers
                                    carriers={carriers.data}
                                    onAdd={carriers.addRecord}
                                    onUpdate={carriers.updateRecord}
                                    onDelete={carriers.deleteRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                />
                            )}
                            {subModule === 'LOCATIONS' && (
                                <Locations
                                    locations={filterByCompany(locations.data)}
                                    onAdd={locations.addRecord}
                                    onUpdate={locations.updateRecord}
                                    onDelete={locations.deleteRecord}
                                    suppliers={filterByCompany(suppliers.data)}
                                    customers={filterByCompany(customers.data)}
                                    onAddSupplier={suppliers.addRecord}
                                    onAddCustomer={customers.addRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                />
                            )}
                            {subModule === 'DOC_VIEWER' && (
                                <DocViewer
                                    purchaseOrders={filterByCompany(poExtracts.data)}
                                    estimates={filterByCompany(estimates.data)}
                                    proformas={filterByCompany(proformas.data)}
                                    bookings={filterByCompany(bookings.data)}
                                    invoices={filterByCompany(invoices.data)}
                                    packingLists={filterByCompany(packingLists.data)}
                                    billOfLadings={filterByCompany(billOfLadings.data)}
                                />
                            )}
                            {subModule === 'AI' && (
                                <AiDataAssistant
                                    products={filterByCompany(products.data)}
                                    suppliers={filterByCompany(suppliers.data)}
                                    customers={filterByCompany(customers.data)}
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
                                    supplierOffers={filterByCompany(supplierOffers.data)}
                                    costCalculations={filterByCompany(costCalculations.data)}
                                    freightQuotes={filterByCompany(freightQuotes.data)}
                                    products={filterByCompany(products.data)}
                                    ports={ports.data}
                                    suppliers={filterByCompany(suppliers.data)}
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
                                    customers={filterByCompany(customers.data)}
                                    onSaveSalesOrder={addSalesOrder}
                                    onDeleteSalesOrder={deleteSalesOrder}
                                    onUpdateSalesOrder={updateSalesOrder}
                                    banks={filterByCompany(banks.data)}
                                    salesOrders={filterSalesOrdersByCreator(filterByCompany(salesOrders))}
                                    cargoAgents={cargoAgents.data}
                                />
                            )}
                            {subModule === 'CALC_AI' && (
                                <AiCalculator
                                    savedCalculations={filterByCompany(costCalculations.data)}
                                    products={filterByCompany(products.data)}
                                    freightQuotes={freightQuotes.data}
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
                    <Suspense fallback={<PageLoader />}>
                        {renderContent()}
                    </Suspense>
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

            <AiCopilotSidebar
                isOpen={showAiSidebar}
                onClose={() => setShowAiSidebar(false)}
                currentUser={currentUser}
                activeModule={activeModule}
                subModule={subModule}
                currentCompany={currentCompanyId}
                allowedModules={currentUser.allowed_modules || Object.keys(navigationConfig)}
                contextData={{
                    customers: { count: filterByCompany(customers.data).length, sample: filterByCompany(customers.data).slice(0, 8).map((c: any) => c.name || c.customerName || 'N/A') },
                    products: { count: filterByCompany(products.data).length, sample: filterByCompany(products.data).slice(0, 8).map((p: any) => p.name || 'N/A') },
                    salesOrders: { count: filterSalesOrdersByCreator(filterByCompany(salesOrders || [])).length, recent: filterSalesOrdersByCreator(filterByCompany(salesOrders || [])).slice(0, 5).map((o: any) => ({ id: o.id, customer: o.customerName, status: o.status, total: o.totalAmount })) },
                    suppliers: { count: filterByCompany(suppliers.data).length, sample: filterByCompany(suppliers.data).slice(0, 8).map((s: any) => s.name || 'N/A') },
                    opportunities: { count: filterByCompany(opportunities.data).length },
                    bookings: { count: filterByCompany(bookings.data).length, active: filterByCompany(bookings.data).filter((b: any) => b.status !== 'COMPLETED').slice(0, 5).map((b: any) => ({ booking: b.bookingNumber, customer: b.customer, pol: b.pol, pod: b.pod, status: b.status })) },
                    billOfLadings: { count: filterByCompany(billOfLadings.data).length },
                    shipments: { count: filterByCompany(shipments.data).length },
                    freightQuotes: { count: filterByCompany(freightQuotes.data).length },
                    purchaseOrders: { count: filterByCompany(purchaseOrders.data).length },
                    inventory: { count: filterByCompany(inventory.data).length },
                    costCalculations: { count: filterByCompany(costCalculations.data).length },
                    ports: { count: ports.data.length, sample: ports.data.slice(0, 8).map((p: any) => p.name || p.portName || 'N/A') },
                    cargoAgents: { count: filterByCompany(cargoAgents.data).length, sample: filterByCompany(cargoAgents.data).slice(0, 5).map((a: any) => a.name || 'N/A') }
                }}
            />
        </div>
    );
};

export default App;
