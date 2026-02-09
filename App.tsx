
import React, { useState, useEffect } from 'react';
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
import PLEngine from './pages/PLEngine';
import PLInvoiceEngine from './pages/PLInvoiceEngine';
import Banks from './pages/Banks';
import InvoiceEngine from './pages/InvoiceEngine';
import MyMailProcessorPage from './pages/MyMailProcessorPage';
import AiEmailProcessor from './pages/AiEmailAssistant'; // Consolidating names if needed, or import distinct?
// Wait, AiEmailAssistant is the new one. AiEmailProcessor was used for SCANNER.
// I should import BOTH if they are different.
// Step 3973 showed AiEmailAssistant.tsx default export is AiEmailAssistant.
import AiEmailAssistant from './pages/AiEmailAssistant';
import SmailApp from './pages/SmailApp';
import SalesOrders from './pages/SalesOrders';
import SaleBrazil from './pages/SaleBrazil';
import CustomerPortal from './pages/CustomerPortal';
import FormBuilder from './pages/FormBuilder';
import ICRM from './pages/ICRM';
import AiLogisticsManager from './pages/AiLogisticsManager';
import ShipmentPipeline from './pages/ShipmentPipeline';
import Commissions from './pages/Commissions';
import ProposalEngine from './pages/ProposalEngine';
import TwilioIntegration from './pages/TwilioIntegration';

import { LayoutDashboard, FileText, Container, ClipboardList, Mail, MessageCircleQuestion, Database, Wifi, Package, Anchor, Truck, Ship, MapPin, Building, ShoppingCart, Tag, FileQuestion, Users, TrendingUp, PieChart, Bot, List, Calculator, Globe, Plane, Table, History, User as UserIcon, Sparkles, Receipt, Warehouse, PenTool, LayoutTemplate, Target, DollarSign } from 'lucide-react';

import { useSupabase } from './hooks/useSupabase';
import { checkSupabaseConnection } from './services/supabase';
import { checkAndTriggerAutoBackup } from './services/backupService';

const BRFlag = ({ size = 16, className = "" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
        <rect width="24" height="24" rx="2" fill="#009C3B" />
        <path d="M12 4L20 12L12 20L4 12L12 4Z" fill="#FFDF00" />
        <circle cx="12" cy="12" r="3.5" fill="#002776" />
        <path d="M10.5 13.5C10.5 13.5 11.5 11.5 14 11.5" stroke="white" strokeWidth="0.5" strokeLinecap="round" />
    </svg>
);

const App: React.FC = () => {
    // Authentication State
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [dbConnectionStatus, setDbConnectionStatus] = useState<boolean>(false);

    // Navigation State
    const [activeModule, setActiveModule] = useState('DASHBOARD');
    const [subModule, setSubModule] = useState<string>('');
    const [currentCompanyId, setCurrentCompanyId] = useState<string>('ALL');
    const [pendingCalcOffer, setPendingCalcOffer] = useState<any>(null);

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

    const billOfLadings = useSupabase<BillOfLading>('bill_landings', {
        select: 'id, companyId, createdAt, blNumber, bookingNumber, shipper, consignee, notifyParty, vesselVoyage, portLoading, portDischarge, placeReceipt, placeDelivery, shippedDate, eta, originals, container, seal, description, grossWeight, measurement, packages, freightPayable, remarks, status, originalDocument'
    });
    const bookings = useSupabase<Booking>('bookings', {
        select: 'id, companyId, createdAt, bookingNumber, customer, vesselVoyage, pol, pod, equipment, etd, eta, cargoCutOff, vgmCutOff, draftCutOff, freeTime, terminal, agentName, salesOrderId, status'
    });

    const estimates = useSupabase<Estimate>('estimates', {
        select: 'id, companyId, createdAt, estimateNumber, supplier, buyer, shipTo, payTo, date, terms, incoterm, subtotal, tax, totalAmount, currency, items, acceptedBy, acceptedDate'
    });
    const proformas = useSupabase<ProformaInvoice>('proforma_invoices', {
        select: 'id, companyId, createdAt, piNumber, supplier, buyer, shipTo, payTo, date, terms, incoterm, subtotal, tax, totalAmount, currency, items, acceptedBy, acceptedDate'
    });
    const invoices = useSupabase<Invoice>('invoices', {
        select: 'id, companyId, createdAt, invoiceNumber, invoiceDate, shipperName, shipperAddress, soldTo, shipTo, paymentTerms, incoterm, dateOrder, customerPo, carrier, transportRef, freightTerms, items, grossWeight, netWeight, tareWeight, totalQuantity, subtotal, totalAmount, currency, remitTo, bankName, bankAddress, swiftCode, routingNumber, accountNumber, supplier, date, soNumber, originalDocument, bookingNumber, shipper, consignee, pod, containers, plNumber, billToName, memo, bolUrl, bl'
    });
    const supplierInvoices = useSupabase<SupplierInvoice>('invoices_suppliers');
    const packingLists = useSupabase<PackingList>('packing_lists', {
        select: 'id, companyId, createdAt, plNumber, blNumber, shipper, supplier, consignee, shippingPoint, destination, date, carrier, containerNumber, sealNumber, vesselVoyage, productDescription, unitCount, unitNumbers, grossWeight, netWeight, freightTerms, poNumber, notes, scheduledShipDate, items, soNumber'
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
        return data.filter(item => {
            const itemCompanyId = item.companyId || item.company_id;
            return itemCompanyId === currentCompanyId ||
                itemCompanyId === 'ALL' ||
                (item.sharedWith && Array.isArray(item.sharedWith) && item.sharedWith.includes(currentCompanyId));
        });
    };

    const filterByCompanyStrict = (data: any[]) => {
        if (currentCompanyId === 'ALL') return data;
        return data.filter(item => (item.companyId || item.company_id) === currentCompanyId);
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
        console.log('[App renderContent] activeModule:', activeModule, 'subModule:', subModule);
        console.log('[App DEBUG] bookings.data.length:', bookings.data.length, 'bookings.loading:', bookings.loading, 'bookings.error:', bookings.error);
        console.log('[App DEBUG] currentCompanyId:', currentCompanyId);
        if (bookings.data.length > 0) {
            console.log('[App DEBUG] First booking companyId:', bookings.data[0].companyId, 'Sample:', bookings.data.slice(0, 3).map(b => ({ id: b.id, companyId: b.companyId, bookingNumber: b.bookingNumber })));
        }
        console.log('[App DEBUG] filterByCompany result count:', filterByCompany(bookings.data).length);
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
                    <div className="h-full flex flex-col">
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
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
                                    onOpenCalculator={(data) => {
                                        setPendingCalcOffer(data);
                                        setActiveModule('CALCULATOR');
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
                        </div>
                    </div>
                );

            case 'SELL':
                return (
                    <div className="h-full flex flex-col">
                        <div className={`flex-1 ${subModule === 'SMAIL' ? 'overflow-hidden' : 'overflow-y-auto custom-scrollbar'}`}>
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
                            {subModule === 'SMAIL' && (
                                <SmailApp />
                            )}
                            {subModule === 'SALE_BRAZIL' && (
                                <SaleBrazil />
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
                    <div className="h-full flex flex-col">
                        <div className="flex-1 overflow-y-auto custom-scrollbar">
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
                                    salesOrders={filterByCompany(salesOrders)}
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
                                    pendingOfferData={pendingCalcOffer}
                                    onClearPendingOffer={() => setPendingCalcOffer(null)}
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
                            {(subModule === '' || subModule === 'LOGISTICS_MANAGE') && (
                                <Logistics
                                    bookings={filterByCompany(bookings.data)}
                                    billOfLadings={filterByCompany(billOfLadings.data)}
                                    inventory={filterByCompany(inventory.data)}
                                    freightQuotes={freightQuotes.data}
                                    salesOrders={filterByCompany(salesOrders)}
                                    cargoAgents={cargoAgents.data}
                                    customers={filterByCompany(customers.data)}
                                    ports={ports.data}
                                    invoices={filterByCompany(invoices.data)}
                                    currentCompanyId={currentCompanyId}
                                    onUpdateSalesOrder={updateSalesOrder}
                                    onUpdateFreightQuote={freightQuotes.updateRecord}
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
                            {subModule === 'AI' && (
                                <AiLogisticsManager
                                    salesOrders={filterByCompany(salesOrders)}
                                    bookings={filterByCompany(bookings.data)}
                                    billOfLadings={filterByCompany(billOfLadings.data)} // Passed here
                                    freightQuotes={freightQuotes.data}
                                    cargoAgents={cargoAgents.data}
                                    onUpdateBooking={bookings.updateRecord}
                                    onAddBooking={bookings.addRecord}
                                    onAddFreightQuote={freightQuotes.addRecord}
                                    currentUser={currentUser}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    showPendingOrders={false} // HIDE PENDING ORDERS FOR LOGISTICS CONTEXT
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
                            {subModule === 'PL_ENGINE' && (
                                <PLInvoiceEngine
                                    packingLists={filterByCompany(packingLists.data)}
                                    customers={filterByCompany(customers.data)}
                                    invoices={filterByCompany(invoices.data)}
                                    salesOrders={filterByCompany(salesOrders)}
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
                                />
                            )}
                            {subModule === 'INBOX_SCANNER' && (
                                <AiEmailAssistant />
                            )}
                            {subModule === 'PROPOSAL_ENGINE' && (
                                <ProposalEngine
                                    suppliers={filterByCompany(suppliers.data)}
                                    customers={filterByCompany(customers.data)}
                                    onAddSupplierOffer={supplierOffers.addRecord}
                                    currentCompanyId={currentCompanyId}
                                />
                            )}
                            {subModule === 'LOGISTICS_AI' && (
                                <ShipmentPipeline
                                    salesOrders={filterByCompany(salesOrders)}
                                    commissionOrders={filterByCompany(commissions.data)}
                                    bookings={filterByCompany(bookings.data)}
                                    invoices={filterByCompany(invoices.data)}
                                    billOfLadings={filterByCompany(billOfLadings.data)}
                                    currentCompanyId={currentCompanyId}
                                    availableCompanies={companies.data}
                                    ports={ports.data}
                                    onUpdateCommission={commissions.updateRecord}
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
                                    currentCompanyId={currentCompanyId}
                                    ports={ports.data}
                                    billOfLadings={filterByCompany(billOfLadings.data)}
                                    onSaveBL={billOfLadings.addRecord}
                                />
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
                console.log('[App renderContent] SETTINGS case, subModule:', subModule);
                return (
                    <div className="h-full flex flex-col">
                        {/* DEBUG: Shows if SETTINGS case is reached */}
                        <div className="bg-yellow-200 text-yellow-800 p-2 text-xs font-mono">
                            DEBUG: SETTINGS case reached. subModule = "{subModule}"
                        </div>
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
                                    customers={customers.data} // Add this
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
                            {subModule === 'TWILIO' && <TwilioIntegration />}
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
        <div className="flex flex-col bg-slate-50 min-h-screen font-sans text-slate-900">
            <TopNavigation
                activeModule={activeModule}
                setActiveModule={(mod) => {
                    setActiveModule(mod);
                    // Don't reset subModule here - TopNavigation handles it via setSubModule prop
                    // The old code was calling setSubModule('') which conflicted with dropdown item clicks
                }}
                subModule={subModule}
                setSubModule={setSubModule}
                currentUser={currentUser}
                onLogout={handleLogout}
                availableCompanies={companies.data}
                currentCompanyId={currentCompanyId}
                onSwitchCompany={setCurrentCompanyId}
                onToggleAiSidebar={() => setShowAiSidebar(true)}
            />

            <div className="flex-1 flex flex-col h-screen pt-20 relative">
                <main className="flex-1 p-3 overflow-hidden flex flex-col">
                    {renderContent()}
                </main>

                <footer className="bg-white border-t border-slate-200 flex items-center justify-between px-4 text-[10px] text-slate-400 uppercase tracking-wider shrink-0 z-50 select-none py-1">
                    <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${dbConnectionStatus ? 'bg-emerald-500' : 'bg-red-500'} animate-pulse`}></span>
                        <span className="flex items-center gap-1"><Wifi size={10} /> System: {dbConnectionStatus ? 'Connected' : 'Offline'}</span>
                    </div>

                    <div className="flex-1 flex justify-center -my-1">
                        {activeModule !== 'CUSTOMER_PORTAL' && (
                            <Dock
                                activeModule={activeModule}
                                subModule={subModule}
                                setActiveModule={setActiveModule}
                                setSubModule={setSubModule}
                                currentUser={currentUser}
                                onToggleHelp={() => setShowHelp(true)}
                            />
                        )}
                    </div>

                    <div className="flex items-center gap-1">
                        <Database size={10} />
                        <span>Database Status: Live Records</span>
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
            />
        </div>
    );
};

export default App;
