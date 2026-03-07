
import React, { useState } from 'react';
import { Activity, Building2 } from 'lucide-react';
import { User, Company, Role, BillOfLading, Booking, Estimate, ProformaInvoice, PurchaseOrderExtract, Invoice, PackingList, SupplierInvoice, Port } from '../types';
import AiDashboard from './AiDashboard';

import WhatsAppChatWidget from '../components/WhatsAppChatWidget';

interface DashboardProps {
    currentUser: User;
    currentCompanyId: string;
    availableCompanies: Company[];
    // Doc OCR callbacks
    onSaveBL?: (data: BillOfLading) => Promise<void> | void;
    onSaveBooking?: (data: Booking) => Promise<void> | void;
    onSaveEstimate?: (data: Estimate) => Promise<void> | void;
    onSaveProforma?: (data: ProformaInvoice) => Promise<void> | void;
    onSavePO?: (data: PurchaseOrderExtract) => Promise<void> | void;
    onSaveInvoice?: (data: Invoice) => Promise<void> | void;
    onSaveSupplierInvoice?: (data: SupplierInvoice) => Promise<void> | void;
    onSavePackingList?: (data: PackingList) => Promise<void> | void;
    ports?: Port[];
    // Accept any extra props gracefully (from App.tsx)
    [key: string]: any;
}

// Basic Error Boundary Component
interface ErrorBoundaryProps {
    children: React.ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: any) {
        return { hasError: true };
    }

    componentDidCatch(error: any, errorInfo: any) {
        console.error("Dashboard Error:", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col items-center justify-center h-full p-8 text-center text-slate-500">
                    <div className="bg-red-50 p-4 rounded-full mb-4">
                        <Activity className="text-red-500" size={32} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 mb-2">Dashboard Component Error</h3>
                    <p className="text-sm max-w-md">The Intelligence Interface encountered an unexpected issue. Please refresh the page or contact support.</p>
                </div>
            );
        }

        return this.props.children;
    }
}

const Dashboard: React.FC<DashboardProps> = ({
    currentUser,
    currentCompanyId,
    availableCompanies = [],
    onSaveBL, onSaveBooking, onSaveEstimate, onSaveProforma, onSavePO, onSaveInvoice, onSaveSupplierInvoice, onSavePackingList,
    ports = [],
    ...rest
}) => {
    const currentCompanyName = (currentCompanyId === 'ALL' || !availableCompanies)
        ? 'Global View'
        : availableCompanies.find(c => c.id === currentCompanyId)?.name || 'Company Dashboard';

    const userName = currentUser?.name ? currentUser.name.split(' ')[0] : 'User';

    // Bridge: WhatsApp OCR drop zone → AiDashboard file handler
    const [ocrFile, setOcrFile] = useState<File | null>(null);

    return (
        <div className="h-full overflow-hidden animate-in fade-in duration-500 flex flex-col">

            {/* Minimal Header */}
            <div className="shrink-0 flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                    <h1 className="text-xl font-bold text-slate-800">Hello, {userName}</h1>
                    <span className="text-slate-400">•</span>
                    <div className="flex items-center gap-2 text-slate-500 text-sm">
                        <Building2 size={14} />
                        <span>{currentCompanyName}</span>
                    </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</span>
                </div>
            </div>

            {/* Layout: AI widget (left) + WhatsApp (right) */}
            <div className="flex-1 min-h-0 flex gap-3 overflow-hidden">

                {/* Left: AI Assistant Widget (full height) */}
                <div className="flex-1 min-w-0 overflow-hidden h-full">
                    <ErrorBoundary>
                        <AiDashboard
                            currentUser={currentUser}
                            currentCompanyId={currentCompanyId}
                            customers={rest.customers || []}
                            suppliers={rest.suppliers || []}
                            products={rest.products || []}
                            salesOrders={rest.salesOrdersData || []}
                            purchaseOrders={rest.purchaseOrders || []}
                            bookings={rest.bookingsData || []}
                            billOfLadings={rest.billOfLadingsData || []}
                            cargoAgents={rest.cargoAgentsData || []}
                            freightQuotes={rest.freightQuotesData || []}
                            invoices={rest.invoicesData || []}
                            estimates={rest.estimatesData || []}
                            proformas={rest.proformasData || []}
                            packingLists={rest.packingListsData || []}
                            supplierInvoices={rest.supplierInvoicesData || []}
                            commissions={rest.commissionsData || []}
                            onAddCustomer={rest.onAddCustomer}
                            onUpdateCustomer={rest.onUpdateCustomer}
                            onAddSupplier={rest.onAddSupplier}
                            onUpdateSupplier={rest.onUpdateSupplier}
                            onAddProduct={rest.onAddProduct}
                            onAddSalesOrder={rest.onAddSalesOrder}
                            onAddPurchaseOrder={rest.onAddPurchaseOrder}
                            onAddBooking={rest.onAddBooking}
                            onAddCargoAgent={rest.onAddCargoAgent}
                            onAddFreightQuote={rest.onAddFreightQuote}
                            onSaveBL={onSaveBL}
                            onSaveBooking={onSaveBooking}
                            onSaveEstimate={onSaveEstimate}
                            onSaveProforma={onSaveProforma}
                            onSavePO={onSavePO}
                            onSaveInvoice={onSaveInvoice}
                            onSaveSupplierInvoice={onSaveSupplierInvoice}
                            onSavePackingList={onSavePackingList}
                            ports={ports}
                            pendingOcrFile={ocrFile}
                            onOcrFileProcessed={() => setOcrFile(null)}
                        />
                    </ErrorBoundary>
                </div>

                {/* Right: WhatsApp Chat Widget (full height) */}
                <div className="w-[420px] shrink-0 overflow-hidden">
                    <WhatsAppChatWidget currentCompanyId={currentCompanyId} onOcrUpload={setOcrFile} />
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
