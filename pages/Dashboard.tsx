
import React, { useState, useCallback, useMemo } from 'react';
import { Activity, Building2 } from 'lucide-react';
import { User, Company, Role, BillOfLading, Booking, Estimate, ProformaInvoice, PurchaseOrderExtract, Invoice, PackingList, SupplierInvoice, Port } from '../types';
import AiDashboard from './AiDashboard';
import DailyBriefing from '../components/DailyBriefing';
import SmartSuggestionsBar from '../components/SmartSuggestionsBar';

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
    // When mounted inside v2 Workspace, hide the Daily Briefing and
    // Smart Suggestions bar to keep the surface minimal. Defaults to
    // false so the standalone v1 shell is unchanged.
    hideInsights?: boolean;
    // When mounted inside v2 Workspace, v2 renders the greeting in the
    // top bar — suppress v1's internal "Hello, X · Company · Date" header.
    hideHeader?: boolean;
    // Optional content rendered inside the right column, above the
    // WhatsApp widget. Used by v2 to surface a document drop zone
    // without reordering the v1 layout.
    whatsAppHeader?: React.ReactNode;
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
    hideInsights = false,
    hideHeader = false,
    whatsAppHeader,
    ...rest
}) => {
    // ── Company Scoping ─────────────────────────────────────────────
    // Resolve 'ALL' to the user's primary company so XS Agent, Briefing,
    // and Suggestions always operate on a single company's data.
    const resolvedCompanyId = useMemo(() => {
        if (currentCompanyId && currentCompanyId !== 'ALL') return currentCompanyId;
        // 1. Use user's first allowed company
        if (currentUser?.allowed_company_ids?.length) return currentUser.allowed_company_ids[0];
        // 2. Fall back to first available company
        if (availableCompanies.length > 0) return availableCompanies[0].id;
        // 3. Last resort — keep 'ALL' (should not happen in practice)
        return currentCompanyId;
    }, [currentCompanyId, currentUser?.allowed_company_ids, availableCompanies]);

    const currentCompanyName = useMemo(() => {
        if (!availableCompanies || availableCompanies.length === 0) return 'Company Dashboard';
        const match = availableCompanies.find(c => c.id === resolvedCompanyId);
        return match?.name || 'Company Dashboard';
    }, [resolvedCompanyId, availableCompanies]);

    const userName = currentUser?.name ? currentUser.name.split(' ')[0] : 'User';

    // ── Data Scoping ────────────────────────────────────────────────
    // When currentCompanyId was 'ALL' but we resolved to a specific company,
    // re-filter data arrays so XS Agent only sees the resolved company's records.
    const needsLocalFilter = currentCompanyId === 'ALL' && resolvedCompanyId !== 'ALL';
    const scopeByCompany = useCallback((data: any[]) => {
        if (!needsLocalFilter || !data) return data;
        return data.filter(item => {
            const cid = item.companyId || item.company_id;
            return cid === resolvedCompanyId || cid === 'ALL' ||
                (item.sharedWith && Array.isArray(item.sharedWith) && item.sharedWith.includes(resolvedCompanyId));
        });
    }, [needsLocalFilter, resolvedCompanyId]);

    // Bridge: WhatsApp OCR drop zone → AiDashboard file handler
    const [ocrFile, setOcrFile] = useState<File | null>(null);

    // Bridge: Smart suggestion / briefing action → AiDashboard chat input
    const [pendingCommand, setPendingCommand] = useState<string | null>(null);
    const handleInsightAction = useCallback((command: string) => {
        setPendingCommand(command);
        // Clear after a tick so AiDashboard can pick it up
        setTimeout(() => setPendingCommand(null), 100);
    }, []);


    return (
        <div className="h-full overflow-hidden animate-in fade-in duration-500 flex flex-col">

            {!hideHeader && (
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
            )}

            {!hideInsights && (
                <>
                    {/* Daily Briefing — shows once per day on first login, scoped to resolved company */}
                    <DailyBriefing
                        companyId={resolvedCompanyId}
                        userName={userName}
                        onActionCommand={handleInsightAction}
                    />

                    {/* Smart Suggestions Bar — proactive insights, scoped to resolved company */}
                    <SmartSuggestionsBar
                        companyId={resolvedCompanyId}
                        onActionCommand={handleInsightAction}
                        className="shrink-0 mb-2"
                    />
                </>
            )}

            {/* Layout: AI widget (left) + WhatsApp (right) */}
            <div className="flex-1 min-h-0 flex gap-3 overflow-hidden">

                {/* Left: AI Assistant Widget (full height), scoped to resolved company */}
                <div className="flex-1 min-w-0 overflow-hidden h-full">
                    <ErrorBoundary>
                        <AiDashboard
                            currentUser={currentUser}
                            currentCompanyId={resolvedCompanyId}
                            customers={scopeByCompany(rest.customers || [])}
                            suppliers={scopeByCompany(rest.suppliers || [])}
                            products={scopeByCompany(rest.products || [])}
                            salesOrders={scopeByCompany(rest.salesOrdersData || [])}
                            purchaseOrders={scopeByCompany(rest.purchaseOrders || [])}
                            bookings={scopeByCompany(rest.bookingsData || [])}
                            billOfLadings={scopeByCompany(rest.billOfLadingsData || [])}
                            cargoAgents={scopeByCompany(rest.cargoAgentsData || [])}
                            freightQuotes={scopeByCompany(rest.freightQuotesData || [])}
                            invoices={scopeByCompany(rest.invoicesData || [])}
                            estimates={scopeByCompany(rest.estimatesData || [])}
                            proformas={scopeByCompany(rest.proformasData || [])}
                            packingLists={scopeByCompany(rest.packingListsData || [])}
                            supplierInvoices={scopeByCompany(rest.supplierInvoicesData || [])}
                            commissions={scopeByCompany(rest.commissionsData || [])}
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
                            pendingCommand={pendingCommand}
                        />
                    </ErrorBoundary>
                </div>

                {/* Right column: optional header slot (20% of column
                    height) stacked above the WhatsApp widget. */}
                <div className="w-[420px] shrink-0 flex flex-col gap-2 overflow-hidden">
                    {whatsAppHeader && (
                        <div className="shrink-0 h-1/5 min-h-[90px]">
                            {whatsAppHeader}
                        </div>
                    )}
                    <div className="flex-1 min-h-0 overflow-hidden">
                        <WhatsAppChatWidget currentCompanyId={resolvedCompanyId} onOcrUpload={setOcrFile} />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;

