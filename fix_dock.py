import os

# Full App.tsx Content with Dock
content = r'''import React, { useState, useEffect } from 'react';
import {
    User, Company, Customer, Product, Opportunity, Shipment,
    InventoryItem, InventoryLog, Supplier, SupplierQuote,
    SupplierOffer, PurchaseOrder, CostCalculation, Port,
    BillOfLading, Booking, Estimate, ProformaInvoice,
    PurchaseOrderExtract, Invoice, PackingList, SupplierInvoice,
    CargoAgent, Carrier, SavedLocation, FreightQuote, Role, CompanyImage, SalesOrder,
    CommissionSalesOrder
} from './types';
import TopNavigation from './components/TopNavigation';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Pipeline from './pages/Pipeline';
import Products from './pages/Products';
import Inventory from './pages/Inventory';
import Shipments from './pages/Shipments';
import PurchaseOrders from './pages/PurchaseOrders';
import Suppliers from './pages/Suppliers';
import SupplierQuotes from './pages/SupplierQuotes';
import SupplierOffers from './pages/SupplierOffers';
import FreightQuotes from './pages/FreightQuotes';
import BigCalculator from './pages/BigCalculator';
import AiUpload from './pages/AiUpload';
import AdminUsers from './pages/AdminUsers';
import AdminCompanies from './pages/AdminCompanies';
import AdminSettings from './pages/AdminSettings';
import AdminBranding from './pages/AdminBranding';
import AdminCredentials from './pages/AdminCredentials';
import Customers from './pages/Customers';
import Ports from './pages/Ports';
import CargoAgents from './pages/CargoAgents';
import Carriers from './pages/Carriers';
import Locations from './pages/Locations';
import LogisticsDocuments from './pages/LogisticsDocuments';
import Documents from './pages/Documents';
import CustomerStatus from './pages/CustomerStatus';
import AISalesHub from './pages/PriceForecasting';
import Logistics from './pages/Logistics';
import HelpCenter from './components/HelpCenter';
import DocViewer from './pages/DocViewer';
import AiProcurement from './pages/AiProcurement';
import AiDataAssistant from './pages/AiDataAssistant';
import AiLogistics from './pages/AiLogistics';
import AiCalculator from './pages/AiCalculator';
import AiEmailProcessor from './pages/AiEmailProcessor';
import PLInvoiceEngine from './pages/PLInvoiceEngine';
import MyMailProcessorPage from './pages/MyEmailProcessor';
import SalesOrders from './pages/SalesOrders';
import CustomerPortal from './pages/CustomerPortal';
import FormBuilder from './pages/FormBuilder';
import ICRM from './pages/ICRM';
import AiLogisticsManager from './pages/AiLogisticsManager';
import Commissions from './pages/Commissions';

import { LayoutDashboard, FileText, Container, ClipboardList, Mail, MessageCircleQuestion, Database, Wifi, Package, Anchor, Truck, Ship, MapPin, Building, ShoppingCart, Tag, FileQuestion, Users, TrendingUp, PieChart, Bot, List, Calculator, Globe, Plane, Table, History, User as UserIcon, Sparkles, Receipt, Warehouse, PenTool, LayoutTemplate, Target, DollarSign, FileSpreadsheet } from 'lucide-react';

import { useSupabase } from './hooks/useSupabase';
import { checkSupabaseConnection } from './services/supabase';
import { checkAndTriggerAutoBackup } from './services/backupService';
import AiCopilotSidebar from './components/AiCopilotSidebar';
import Dock from './components/Dock';

const App: React.FC = () => {
    // FORCE_DEPLOY: Layout Fix - Full Height & Model Text
    console.log("App Version: Layout Fix - Full Height & Model Text");
    // Authentication State
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [dbConnectionStatus, setDbConnectionStatus] = useState<boolean>(false);

    // Navigation State
    const [activeModule, setActiveModule] = useState('DASHBOARD');
    // subModule can be set by TopNavigation (dropdowns) or logical defaults
    const [subModule, setSubModule] = useState<string>('');
    const [currentCompanyId, setCurrentCompanyId] = useState<string>('ALL');

    // Help Center
    const [showHelp, setShowHelp] = useState(false);
    // AI Copilot Sidebar
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
    const bookings = useSupabase<Booking>('bookings');
    const estimates = useSupabase<Estimate>('estimates');
    const proformas = useSupabase<ProformaInvoice>('proforma_invoices');
    const invoices = useSupabase<Invoice>('invoices');
    const supplierInvoices = useSupabase<SupplierInvoice>('invoices_suppliers');
    const packingLists = useSupabase<PackingList>('packing_lists');
    const poExtracts = useSupabase<PurchaseOrderExtract>('purchase_order_extracts');

    const { data: salesOrders, addRecord: addSalesOrder, updateRecord: updateSalesOrder, deleteRecord: deleteSalesOrder } = useSupabase<SalesOrder>('sales_orders');
    // Applied limit and specific column selection to avoid timeout due to Base64 columns
    const commissions = useSupabase<CommissionSalesOrder>('commission_sales_orders', {
        select: 'id, orderNumber, invoiceNumber, sellerName, customerName, pod, deliveryDate, status, orderTotal, invoiceStatus, commissionAmount, commissionPaymentStatus, createdAt, companyId',
        limit: 100,
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

    const handleLogin = (user: User) => {
        setCurrentUser(user);

        // Scroll to top limit to ensure headers are visible
        setTimeout(() => {
            window.scrollTo(0, 0);
        }, 100);

        if (user.role !== Role.ADMIN && user.allowed_company_ids && user.allowed_company_ids.length > 0) {
            setCurrentCompanyId(user.allowed_company_ids[0]);
        } else {
            setCurrentCompanyId('ALL');
        }

        // Role-based Redirects
        if (user.role === Role.CARGO_AGENT) {
            setActiveModule('LOGISTICS');
            setSubModule('FREIGHT');
        } else if (user.role === Role.CUSTOMER) {
            setActiveModule('CUSTOMER_PORTAL');
        }
    };

    const handleLogout = () => {
        setCurrentUser(null);
        setActiveModule('DASHBOARD');
        setSubModule('');
    };

    const filterByCompany = (data: any[]) => {
        if (currentCompanyId === 'ALL') return data;
        return data.filter(item =>
            item.companyId === currentCompanyId ||
            item.companyId === 'ALL' ||
            (item.sharedWith && Array.isArray(item.sharedWith) && item.sharedWith.includes(currentCompanyId))
        );
    };

    const filterByCompanyStrict = (data: any[]) => {
        if (currentCompanyId === 'ALL') return data;
        return data.filter(item => item.companyId === currentCompanyId);
    };

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
                    />
                );

            case 'BUY':
                return (
                    <div className="h-full flex flex-col p-6">
                        <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 overflow-y-auto custom-scrollbar">
                            {subModule === '' && (
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
                                    companyImages={images.data}
                                />
                            )}
                            {subModule === 'AI' && (
                                <AiProcurement
                                    suppliers={filterByCompany(suppliers.data)}
                                    purchaseOrders={filterByCompany(purchaseOrders.data)}
                                    supplierOffers={filterByCompany(supplierOffers.data)}
                                />
                            )}
                        </div>
                    </div>
                );

            case 'SELL':
                return (
                    <div className="h-full flex flex-col p-6">
                        <div className={`flex-1 bg-white rounded-xl shadow-sm border border-slate-200 ${subModule === 'SMAIL' ? 'overflow-hidden' : 'overflow-y-auto custom-scrollbar'}`}>
                            {subModule === '' && (
                                <Customers
                                    customers={filterByCompany(customers.data)}
                                    onAdd={customers.addRecord}
                                    onUpdate={customers.updateRecord}
                                    onDelete={customers.deleteRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    ports={ports.data}
                                    onAddPort={ports.addRecord}
                                />
                            )}
                            {subModule === 'PIPELINE' && (
                                <Pipeline
                                    opportunities={filterByCompany(opportunities.data)}
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
                            {subModule === 'AI' && (
                                <AISalesHub
                                    products={filterByCompany(products.data)}
                                    customers={filterByCompany(customers.data)}
                                    opportunities={filterByCompany(opportunities.data)}
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
                                    savedCalculations={filterByCompany(costCalculations.data)}
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
                                    allowMargin={false}
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
                                    salesOrders={filterByCompany(salesOrders)}
                                    onAdd={addSalesOrder}
                                    onUpdate={updateSalesOrder}
                                    onDelete={deleteSalesOrder}
                                />
                            )}
                            {subModule === 'ICRM' && (
                                <ICRM
                                    opportunities={filterByCompany(opportunities.data)}
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
                        </div>
                    </div>
                );

            case 'CALCULATOR':
                const getCalcMode = () => {
                    if (subModule === 'EXPORT') return 'EXPORT';
                    if (subModule === 'LOCAL') return 'LOCAL';
                    if (subModule === 'SHEET') return 'SHEET';
                    if (subModule === 'PRICE_LIST') return 'PRICE_LIST';
                    if (subModule === 'HISTORY') return 'HISTORY';
                    return 'IMPORT';
                };

                return (
                    <div className="h-full flex flex-col p-6">
                        <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 overflow-y-auto custom-scrollbar">
                            {subModule === 'AI' ? (
                                <AiCalculator
                                    savedCalculations={filterByCompany(costCalculations.data)}
                                    products={filterByCompany(products.data)}
                                    freightQuotes={freightQuotes.data}
                                />
                            ) : (
                                <BigCalculator
                                    products={filterByCompany(products.data)}
                                    suppliers={filterByCompany(suppliers.data)}
                                    supplierOffers={filterByCompany(supplierOffers.data)}
                                    supplierQuotes={filterByCompany(supplierQuotes.data)}
                                    freightQuotes={freightQuotes.data}
                                    ports={ports.data}
                                    savedCalculations={filterByCompany(costCalculations.data)}
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
                                    initialMode={getCalcMode()}
                                    initialHistoryOnly={subModule === 'HISTORY'}
                                />
                            )}
                        </div>
                    </div>
                );

            case 'LOGISTICS':
                if (currentUser.role === Role.CARGO_AGENT) {
                    return (
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
                    );
                }

                return (
                    <div className="h-full flex flex-col p-6">
                        <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 overflow-y-auto custom-scrollbar">
                            {subModule === '' && (
                                <Logistics
                                    bookings={filterByCompanyStrict(bookings.data)}
                                    billOfLadings={filterByCompanyStrict(billOfLadings.data)}
                                    inventory={filterByCompany(inventory.data)}
                                />
                            )}
                            {(subModule === 'BOOKINGS' || subModule === 'BL') && (
                                <LogisticsDocuments
                                    activeType={subModule === 'BL' ? 'BL' : 'BOOKING'}
                                    bookings={filterByCompanyStrict(bookings.data)}
                                    billOfLadings={filterByCompanyStrict(billOfLadings.data)}
                                    onDeleteBooking={bookings.deleteRecord}
                                    onUpdateBooking={bookings.updateRecord}
                                    onDeleteBL={billOfLadings.deleteRecord}
                                    onUpdateBillOfLading={billOfLadings.updateRecord}
                                    ports={ports.data}
                                    shipments={filterByCompany(shipments.data)}
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
                            {subModule === 'AI' && (
                                <AiLogisticsManager
                                    salesOrders={[]}
                                    bookings={filterByCompanyStrict(bookings.data)}
                                    billOfLadings={filterByCompanyStrict(billOfLadings.data)}
                                    freightQuotes={freightQuotes.data}
                                    cargoAgents={cargoAgents.data}
                                    onUpdateBooking={bookings.updateRecord}
                                    onAddBooking={bookings.addRecord}
                                    onAddFreightQuote={freightQuotes.addRecord}
                                    currentUser={currentUser}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    showPendingOrders={false} // HIDE PENDING ORDERS FOR LOGISTICS CONTEXT
                                    customers={filterByCompany(customers.data)}
                                    invoices={filterByCompany(invoices.data)}
                                />
                            )}
                        </div>
                    </div>
                );

            case 'DATA':
                return (
                    <div className="h-full flex flex-col p-6">
                        <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 overflow-y-auto custom-scrollbar">
                            {(subModule === 'PRODUCTS' || subModule === '') && (
                                <Products
                                    products={filterByCompany(products.data)}
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
                        </div>
                    </div>
                );

            case 'AI_UPLOAD':
                return (
                    <div className="h-full flex flex-col">
                        <div className="flex-1 overflow-hidden">
                            {(subModule === 'DOCS' || subModule === '') && (
                                <div className="h-full overflow-hidden">
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
                            {subModule === 'PL_INVOICE_ENGINE' && (
                                <PLInvoiceEngine
                                    packingLists={filterByCompany(packingLists.data)}
                                    customers={filterByCompany(customers.data)}
                                    invoices={filterByCompany(invoices.data)}
                                    salesOrders={filterByCompany(salesOrders)}
                                    onSaveInvoice={invoices.addRecord}
                                    onUpdateInvoice={invoices.updateRecord}
                                    onDeleteInvoice={invoices.deleteRecord}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                />
                            )}
                            {subModule === 'SCANNER' && (
                                <div className="h-full p-6">
                                    <AiEmailProcessor
                                        onSaveBL={billOfLadings.addRecord}
                                        onSaveBooking={bookings.addRecord}
                                        onSaveEstimate={estimates.addRecord}
                                        onSaveProforma={proformas.addRecord}
                                        onSavePO={poExtracts.addRecord}
                                        onSaveInvoice={invoices.addRecord}
                                        onSaveSupplierInvoice={supplierInvoices.addRecord}
                                        onSavePackingList={packingLists.addRecord}
                                        currentCompanyId={currentCompanyId}
                                        processorKey="automation"
                                    />
                                </div>
                            )}
                            {subModule === 'LOGISTICS_AI' && (
                                <AiLogisticsManager
                                    salesOrders={filterByCompany(salesOrders)}
                                    bookings={filterByCompanyStrict(bookings.data)}
                                    billOfLadings={filterByCompanyStrict(billOfLadings.data)} // Passed here
                                    freightQuotes={freightQuotes.data}
                                    cargoAgents={cargoAgents.data}
                                    onUpdateBooking={bookings.updateRecord}
                                    onUpdateBillOfLading={billOfLadings.updateRecord}
                                    onAddBooking={bookings.addRecord}
                                    onAddFreightQuote={freightQuotes.addRecord}
                                    currentUser={currentUser}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    customers={filterByCompany(customers.data)}
                                    invoices={filterByCompany(invoices.data)}
                                />
                            )}
                            {subModule === 'COMMISSIONS' && (
                                <Commissions
                                    commissions={filterByCompany(commissions.data)}
                                    onAdd={commissions.addRecord}
                                    onUpdate={commissions.updateRecord}
                                    onDelete={commissions.deleteRecord}
                                    customers={filterByCompany(customers.data)}
                                    suppliers={filterByCompany(suppliers.data)}
                                    currentUser={currentUser}
                                />
                            )}
                            {subModule === 'SMAIL' && (
                                <MyMailProcessorPage />
                            )}
                        </div>
                    </div>
                );

            case 'FINANCE':
                return (
                    <Documents
                        proformaInvoices={filterByCompany(proformas.data)}
                        invoices={filterByCompany(invoices.data)}
                        packingLists={filterByCompany(packingLists.data)}
                        onDeleteProforma={proformas.deleteRecord}
                        onDeleteInvoice={invoices.deleteRecord}
                        onDeletePackingList={packingLists.deleteRecord}
                        currentCompanyId={currentCompanyId}
                        availableCompanies={companies.data}
                    />
                );

            case 'CUSTOMER_PORTAL': {
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
                        const normalize = (s: string) => s.toLowerCase().trim();
                        const searchTerms = [myCustomer.name, myCustomer.nickname].filter(Boolean).map(t => normalize(t!));

                        // Helper to check if any term matches
                        const matchesCustomer = (field?: string) => {
                            if (!field) return false;
                            const text = normalize(field);
                            return searchTerms.some(term => text.includes(term));
                        };

                        mySalesOrders = salesOrders.filter(o => o.customerId === myCustomer.id);
                        myBookings = bookings.data.filter(b => matchesCustomer(b.customer));
                        myBLs = billOfLadings.data.filter(bl => matchesCustomer(bl.consignee));
                        myInvoices = invoices.data.filter(inv => matchesCustomer(inv.soldTo));
                    }
                } else if (currentUser.role === Role.ADMIN || currentUser.role === Role.CEO) {
                    // Admin View: Pass all data (or filtered by company context)
                    customerName = 'Internal View';
                    const scopedData = filterByCompanyStrict; // Use helper
                    // Admin: Show all relevant data, filtered by company
                    mySalesOrders = scopedData(salesOrders);
                    myBookings = scopedData(bookings.data);
                    myBLs = scopedData(billOfLadings.data);
                    myInvoices = scopedData(invoices.data);
                    // Add admin context for other types if needed later, but focusing on customer view fix first
                }

                // Prepare additional context (even if empty for now, to match prop types)
                let myOpportunities: any[] = [];
                let myEstimates: any[] = [];
                let myProformas: any[] = [];

                if (customerName !== 'Guest' && customerName !== 'Internal View' && currentUser.linked_entity_id) {
                    const myCustomer = customers.data.find(c => c.id === currentUser.linked_entity_id);
                    if (myCustomer) {
                        const normalize = (s: string) => s.toLowerCase().trim();
                        const searchTerms = [myCustomer.name, myCustomer.nickname].filter(Boolean).map(t => normalize(t!));

                        const matchesCustomer = (field?: string) => {
                            if (!field) return false;
                            const text = normalize(field);
                            return searchTerms.some(term => text.includes(term));
                        };

                        // RELAXED FILTERING: Check ID OR Name
                        mySalesOrders = salesOrders.filter(o =>
                            o.customerId === myCustomer.id || matchesCustomer(o.customerName)
                        );

                        // New Data Contexts
                        myOpportunities = opportunities.data.filter(o =>
                            o.customerId === myCustomer.id || matchesCustomer(o.customerName)
                        );
                        myEstimates = estimates.data.filter(e => matchesCustomer(e.buyer));
                        myProformas = proformas.data.filter(p => matchesCustomer(p.buyer));
                    }
                } else if (currentUser.role === Role.ADMIN || currentUser.role === Role.CEO) {
                    const scopedData = filterByCompanyStrict;
                    myOpportunities = scopedData(opportunities.data);
                    myEstimates = scopedData(estimates.data);
                    myProformas = scopedData(proformas.data);
                }

                return (
                    <CustomerPortal
                        customerName={customerName}
                        currentUser={currentUser}
                        salesOrders={mySalesOrders}
                        bookings={myBookings}
                        billOfLadings={myBLs}
                        invoices={myInvoices}
                        opportunities={myOpportunities}
                        estimates={myEstimates}
                        proformas={myProformas}
                    />
                );
            }

            case 'SETTINGS':
                return (
                    <div className="h-full flex flex-col p-6">
                        <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 overflow-y-auto custom-scrollbar">
                            {subModule === '' && <AdminCredentials />}
                            {subModule === 'USERS' && (
                                <AdminUsers
                                    users={users.data}
                                    onAdd={users.addRecord}
                                    onUpdate={users.updateRecord}
                                    onDelete={users.deleteRecord}
                                    companies={companies.data}
                                    cargoAgents={cargoAgents.data}
                                    currentUser={currentUser}
                                    customers={customers.data}
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
                            {subModule === 'FORMS' && <FormBuilder />}
                            {subModule === 'DB' && <AdminSettings />}
                            {subModule === 'BRANDING' && <AdminBranding />}
                            {subModule === 'INTEGRATIONS' && <AdminCredentials />}
                        </div>
                    </div>
                );

            default:
                return <div>Module Not Found</div>;
        }
    };

    return (
        <div className="flex flex-col bg-slate-50 min-h-screen font-sans text-slate-900">
            <TopNavigation
                activeModule={activeModule}
                setActiveModule={(mod) => {
                    setActiveModule(mod);
                    if (mod === 'BUY' || mod === 'DATA' || mod === 'SELL' || mod === 'LOGISTICS' || mod === 'CALCULATOR') {
                        // Optional: default submodules if desired
                    } else {
                        setSubModule('');
                    }
                }}
                setSubModule={setSubModule}
                currentUser={currentUser}
                onLogout={handleLogout}
                availableCompanies={companies.data}
                currentCompanyId={currentCompanyId}
                onSwitchCompany={setCurrentCompanyId}
                onToggleAiSidebar={() => setShowAiSidebar(true)}
            />

            <div className="flex-1 flex flex-col h-screen pt-20 relative">
                <main className="flex-1 p-6 overflow-hidden flex flex-col">
                    {renderContent()}

                </main>

                <footer className="bg-white border-t border-slate-200 flex items-center justify-between px-4 text-[10px] text-slate-400 uppercase tracking-wider shrink-0 z-50 select-none py-1">
                    <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${dbConnectionStatus ? 'bg-emerald-500' : 'bg-red-500'} animate-pulse`}></span>
                        <span className="flex items-center gap-1"><Wifi size={10} /> System: {dbConnectionStatus ? 'Connected' : 'Offline'}</span>
                    </div>

                    <div className="flex-1 flex justify-center -my-1">
                        <Dock
                            activeModule={activeModule}
                            subModule={subModule}
                            setActiveModule={setActiveModule}
                            setSubModule={setSubModule}
                        />
                    </div>

                    <div className="flex items-center gap-1">
                        <Database size={10} />
                        <span>Database Status: Live Records</span>
                    </div>
                </footer>
            </div>

            <button
                onClick={() => setShowHelp(true)}
                className="fixed bottom-6 right-6 bg-white text-slate-600 p-2.5 rounded-full shadow-lg border border-slate-200 hover:text-blue-600 hover:border-blue-300 transition-all z-50 group"
                title="Help Center"
            >
                <span className="sr-only">Help</span>
                <MessageCircleQuestion size={24} className="group-hover:scale-110 transition-transform" />
            </button>
            {/* Help Center Modal */}
            {showHelp && (
                <HelpCenter onClose={() => setShowHelp(false)} role={currentUser.role} />
            )}

            {/* AI Copilot Sidebar */}
            <AiCopilotSidebar
                isOpen={showAiSidebar}
                onClose={() => setShowAiSidebar(false)}
                currentUser={currentUser}
            />
        </div>
    );
};

export default App;
'''

import os
# Check where we are running
print(f"Running in: {os.getcwd()}")

# Attempt to write
try:
    with open('App.tsx', 'w') as f:
        f.write(content)
    print("SUCCESS: App.tsx written successfully.")
except Exception as e:
    print(f"ERROR: {e}")
