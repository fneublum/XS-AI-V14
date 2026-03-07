
import React, { useMemo } from 'react';
import {
    TrendingUp, Package, Trophy, DollarSign, ArrowRight, Users,
    ClipboardList, List, Target, Briefcase, ChevronRight, Calendar,
    BarChart3, Sparkles
} from 'lucide-react';

interface SalesHubProps {
    currentUser: any;
    currentCompanyId: string;
    opportunities: any[];
    salesOrders: any[];
    commissions: any[];
    customers: any[];
    onNavigate: (module: string, subModule: string) => void;
}

const SalesHub: React.FC<SalesHubProps> = ({
    currentUser,
    currentCompanyId,
    opportunities,
    salesOrders,
    commissions,
    customers,
    onNavigate
}) => {
    // ─── Metrics ──────────────────────────────────────────────────
    const metrics = useMemo(() => {
        const activeStages = ['Lead', 'First Contact', 'Requirements', 'Quote Sent', 'Negotiation', 'PO Expected'];
        const activeOpps = opportunities.filter(o => activeStages.includes(o.stage));
        const pipelineValue = activeOpps.reduce((sum, o) => sum + (o.value || 0), 0);

        const wonOpps = opportunities.filter(o => o.stage === 'Closed Won');
        const dealsWon = wonOpps.length;

        const pendingOrders = salesOrders.filter(o => o.status === 'PENDING' || o.status === 'APPROVED');
        const activeOrdersCount = pendingOrders.length;

        const unpaidCommissions = commissions.filter(c =>
            c.id?.startsWith('CSI-') && c.commissionPaymentStatus !== 'PAID'
        );
        const totalUnpaidCommission = unpaidCommissions.reduce((sum, c) => sum + (c.commissionAmount || 0), 0);

        return { pipelineValue, dealsWon, activeOrdersCount, totalUnpaidCommission, activeOpps, pendingOrders, unpaidCommissions };
    }, [opportunities, salesOrders, commissions]);

    // ─── Time of Day Greeting ──────────────────────────────────
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const firstName = currentUser?.name?.split(/[\s,]+/)[0] || 'there';

    // ─── Quick Actions ────────────────────────────────────────
    const quickActions = [
        { label: 'New Sales Order', icon: ClipboardList, module: 'SALES_FORCE', sub: 'ORDERS', color: 'from-blue-600 to-indigo-600' },
        { label: 'Price List', icon: List, module: 'SALES_FORCE', sub: 'PRICELIST', color: 'from-violet-600 to-purple-600' },
        { label: 'Customers', icon: Users, module: 'SALES_FORCE', sub: 'CUSTOMERS', color: 'from-emerald-600 to-teal-600' },
        { label: 'iCRM', icon: Target, module: 'SALES_FORCE', sub: 'ICRM', color: 'from-amber-600 to-orange-600' },
        { label: 'Pipeline', icon: TrendingUp, module: 'SALES_FORCE', sub: 'PIPELINE', color: 'from-cyan-600 to-blue-600' },
        { label: 'Commissions', icon: DollarSign, module: 'COMMISSIONS', sub: '', color: 'from-rose-600 to-pink-600' },
    ];

    const getStageColor = (stage: string) => {
        const colors: Record<string, string> = {
            'Lead': 'bg-slate-100 text-slate-700',
            'First Contact': 'bg-blue-100 text-blue-700',
            'Requirements': 'bg-indigo-100 text-indigo-700',
            'Quote Sent': 'bg-violet-100 text-violet-700',
            'Negotiation': 'bg-amber-100 text-amber-700',
            'PO Expected': 'bg-orange-100 text-orange-700',
            'PO Received': 'bg-emerald-100 text-emerald-700',
            'PO Delivered': 'bg-teal-100 text-teal-700',
            'Closed Won': 'bg-green-100 text-green-700',
            'Closed Lost': 'bg-red-100 text-red-700',
        };
        return colors[stage] || 'bg-slate-100 text-slate-700';
    };

    const getOrderStatusColor = (status: string) => {
        const colors: Record<string, string> = {
            'PENDING': 'bg-amber-100 text-amber-700',
            'APPROVED': 'bg-emerald-100 text-emerald-700',
            'REJECTED': 'bg-red-100 text-red-700',
            'FULFILLED': 'bg-blue-100 text-blue-700',
        };
        return colors[status] || 'bg-slate-100 text-slate-700';
    };

    return (
        <div className="p-6 space-y-6 max-w-7xl mx-auto">

            {/* ─── Welcome Header ──────────────────────────────── */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">
                        {greeting}, <span className="bg-gradient-to-r from-rose-600 to-pink-600 bg-clip-text text-transparent">{firstName}</span> 👋
                    </h1>
                    <p className="text-sm text-slate-500 mt-0.5">Here's your sales performance overview</p>
                </div>
                <div className="flex items-center gap-2 bg-rose-50 text-rose-700 px-3 py-1.5 rounded-lg border border-rose-200">
                    <Briefcase size={14} />
                    <span className="text-xs font-bold uppercase tracking-wide">Sales Hub</span>
                </div>
            </div>

            {/* ─── KPI Cards ───────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Pipeline Value */}
                <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl p-5 text-white shadow-lg shadow-blue-200/50 relative overflow-hidden group hover:shadow-xl transition-shadow">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -mr-8 -mt-8 group-hover:scale-110 transition-transform" />
                    <div className="flex items-center gap-2 mb-3 relative z-10">
                        <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm"><BarChart3 size={18} /></div>
                        <span className="text-xs font-semibold uppercase tracking-wider text-blue-100">Pipeline Value</span>
                    </div>
                    <p className="text-2xl font-black relative z-10">${metrics.pipelineValue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                    <p className="text-xs text-blue-200 mt-1">{metrics.activeOpps.length} active opportunities</p>
                </div>

                {/* Active Orders */}
                <div className="bg-gradient-to-br from-emerald-600 to-teal-700 rounded-xl p-5 text-white shadow-lg shadow-emerald-200/50 relative overflow-hidden group hover:shadow-xl transition-shadow">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -mr-8 -mt-8 group-hover:scale-110 transition-transform" />
                    <div className="flex items-center gap-2 mb-3 relative z-10">
                        <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm"><Package size={18} /></div>
                        <span className="text-xs font-semibold uppercase tracking-wider text-emerald-100">Active Orders</span>
                    </div>
                    <p className="text-2xl font-black relative z-10">{metrics.activeOrdersCount}</p>
                    <p className="text-xs text-emerald-200 mt-1">Pending & approved</p>
                </div>

                {/* Deals Won */}
                <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl p-5 text-white shadow-lg shadow-amber-200/50 relative overflow-hidden group hover:shadow-xl transition-shadow">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -mr-8 -mt-8 group-hover:scale-110 transition-transform" />
                    <div className="flex items-center gap-2 mb-3 relative z-10">
                        <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm"><Trophy size={18} /></div>
                        <span className="text-xs font-semibold uppercase tracking-wider text-amber-100">Deals Won</span>
                    </div>
                    <p className="text-2xl font-black relative z-10">{metrics.dealsWon}</p>
                    <p className="text-xs text-amber-200 mt-1">Total closed won</p>
                </div>

                {/* My Commissions */}
                <div className="bg-gradient-to-br from-rose-600 to-pink-700 rounded-xl p-5 text-white shadow-lg shadow-rose-200/50 relative overflow-hidden group hover:shadow-xl transition-shadow">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -mr-8 -mt-8 group-hover:scale-110 transition-transform" />
                    <div className="flex items-center gap-2 mb-3 relative z-10">
                        <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm"><DollarSign size={18} /></div>
                        <span className="text-xs font-semibold uppercase tracking-wider text-rose-100">Unpaid Commission</span>
                    </div>
                    <p className="text-2xl font-black relative z-10">${metrics.totalUnpaidCommission.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                    <p className="text-xs text-rose-200 mt-1">{metrics.unpaidCommissions.length} pending invoices</p>
                </div>
            </div>

            {/* ─── Quick Actions ────────────────────────────────── */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Sparkles size={14} className="text-rose-500" /> Quick Actions
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    {quickActions.map(action => (
                        <button
                            key={action.label}
                            onClick={() => onNavigate(action.module, action.sub)}
                            className="group flex flex-col items-center gap-2 p-4 rounded-xl border border-slate-200 hover:border-transparent hover:shadow-lg transition-all duration-200 bg-white hover:bg-gradient-to-br hover:text-white relative overflow-hidden"
                            style={{ ['--tw-gradient-from' as any]: undefined }}
                        >
                            <div className={`p-2.5 rounded-xl bg-gradient-to-br ${action.color} text-white shadow-sm group-hover:scale-110 transition-transform`}>
                                <action.icon size={18} />
                            </div>
                            <span className="text-xs font-bold text-slate-700 group-hover:text-slate-900">{action.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* ─── Two-Column Layout: Pipeline + Orders ─────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* My Active Pipeline */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-blue-50 to-indigo-50">
                        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                            <TrendingUp size={16} className="text-blue-600" /> My Active Pipeline
                        </h2>
                        <button
                            onClick={() => onNavigate('SALES_FORCE', 'PIPELINE')}
                            className="text-xs text-blue-600 font-bold hover:underline flex items-center gap-1"
                        >
                            View All <ChevronRight size={12} />
                        </button>
                    </div>
                    <div className="max-h-80 overflow-y-auto custom-scrollbar">
                        {metrics.activeOpps.length > 0 ? (
                            <table className="w-full text-xs">
                                <thead className="bg-slate-50 sticky top-0">
                                    <tr>
                                        <th className="text-left px-4 py-2 font-bold text-slate-500 uppercase">Customer</th>
                                        <th className="text-left px-4 py-2 font-bold text-slate-500 uppercase">Product</th>
                                        <th className="text-left px-4 py-2 font-bold text-slate-500 uppercase">Stage</th>
                                        <th className="text-right px-4 py-2 font-bold text-slate-500 uppercase">Value</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {metrics.activeOpps.slice(0, 10).map((opp: any) => (
                                        <tr key={opp.id} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-4 py-2.5 font-medium text-slate-800">{opp.customerName?.split(/[\s,]+/)[0]}</td>
                                            <td className="px-4 py-2.5 text-slate-600">{opp.productName?.split(/[\s,]+/)[0]}</td>
                                            <td className="px-4 py-2.5">
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${getStageColor(opp.stage)}`}>
                                                    {opp.stage}
                                                </span>
                                            </td>
                                            <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-700">
                                                ${(opp.value || 0).toLocaleString()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                                <TrendingUp size={32} className="mb-2 opacity-40" />
                                <p className="text-sm font-medium">No active opportunities</p>
                                <button onClick={() => onNavigate('SALES_FORCE', 'PIPELINE')} className="text-blue-600 text-xs font-bold mt-2 hover:underline">
                                    Go to Pipeline →
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Recent Sales Orders */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-teal-50">
                        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                            <ClipboardList size={16} className="text-emerald-600" /> Recent Sales Orders
                        </h2>
                        <button
                            onClick={() => onNavigate('SALES_FORCE', 'ORDERS')}
                            className="text-xs text-emerald-600 font-bold hover:underline flex items-center gap-1"
                        >
                            View All <ChevronRight size={12} />
                        </button>
                    </div>
                    <div className="max-h-80 overflow-y-auto custom-scrollbar">
                        {salesOrders.length > 0 ? (
                            <table className="w-full text-xs">
                                <thead className="bg-slate-50 sticky top-0">
                                    <tr>
                                        <th className="text-left px-4 py-2 font-bold text-slate-500 uppercase">Order #</th>
                                        <th className="text-left px-4 py-2 font-bold text-slate-500 uppercase">Customer</th>
                                        <th className="text-left px-4 py-2 font-bold text-slate-500 uppercase">Status</th>
                                        <th className="text-right px-4 py-2 font-bold text-slate-500 uppercase">Total</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {salesOrders.slice(0, 10).map((order: any) => (
                                        <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-4 py-2.5 font-mono font-bold text-blue-600">{order.orderNumber}</td>
                                            <td className="px-4 py-2.5 text-slate-800 font-medium">{order.customerName?.split(/[\s,]+/)[0]}</td>
                                            <td className="px-4 py-2.5">
                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${getOrderStatusColor(order.status)}`}>
                                                    {order.status}
                                                </span>
                                            </td>
                                            <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-700">
                                                ${(order.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                                <ClipboardList size={32} className="mb-2 opacity-40" />
                                <p className="text-sm font-medium">No sales orders yet</p>
                                <button onClick={() => onNavigate('SALES_FORCE', 'ORDERS')} className="text-emerald-600 text-xs font-bold mt-2 hover:underline">
                                    Create Sales Order →
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ─── Commission Tracker ──────────────────────────── */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-rose-50 to-pink-50">
                    <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                        <DollarSign size={16} className="text-rose-600" /> Commission Tracker
                    </h2>
                    <button
                        onClick={() => onNavigate('COMMISSIONS', '')}
                        className="text-xs text-rose-600 font-bold hover:underline flex items-center gap-1"
                    >
                        View All <ChevronRight size={12} />
                    </button>
                </div>
                {(() => {
                    const invoices = commissions.filter(c => c.id?.startsWith('CSI-'));
                    const paidInvoices = invoices.filter(c => c.commissionPaymentStatus === 'PAID');
                    const unpaidInvoices = invoices.filter(c => c.commissionPaymentStatus !== 'PAID');
                    const totalPaid = paidInvoices.reduce((s, c) => s + (c.commissionAmount || 0), 0);
                    const totalUnpaid = unpaidInvoices.reduce((s, c) => s + (c.commissionAmount || 0), 0);

                    return (
                        <div className="p-5">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                                    <p className="text-xs text-slate-500 font-bold uppercase">Total Invoices</p>
                                    <p className="text-2xl font-black text-slate-800 mt-1">{invoices.length}</p>
                                </div>
                                <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
                                    <p className="text-xs text-amber-600 font-bold uppercase">Unpaid</p>
                                    <p className="text-2xl font-black text-amber-700 mt-1">${totalUnpaid.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                                    <p className="text-[10px] text-amber-500 mt-0.5">{unpaidInvoices.length} invoices</p>
                                </div>
                                <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100">
                                    <p className="text-xs text-emerald-600 font-bold uppercase">Paid</p>
                                    <p className="text-2xl font-black text-emerald-700 mt-1">${totalPaid.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                                    <p className="text-[10px] text-emerald-500 mt-0.5">{paidInvoices.length} invoices</p>
                                </div>
                            </div>

                            {/* Recent unpaid commissions list */}
                            {unpaidInvoices.length > 0 && (
                                <div className="border border-slate-200 rounded-lg overflow-hidden">
                                    <table className="w-full text-xs">
                                        <thead className="bg-slate-50">
                                            <tr>
                                                <th className="text-left px-4 py-2 font-bold text-slate-500 uppercase">Invoice #</th>
                                                <th className="text-left px-4 py-2 font-bold text-slate-500 uppercase">Seller</th>
                                                <th className="text-left px-4 py-2 font-bold text-slate-500 uppercase">Customer</th>
                                                <th className="text-right px-4 py-2 font-bold text-slate-500 uppercase">Order Total</th>
                                                <th className="text-right px-4 py-2 font-bold text-slate-500 uppercase">Commission</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {unpaidInvoices.slice(0, 8).map((inv: any) => (
                                                <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                                                    <td className="px-4 py-2.5 font-mono text-blue-600 font-bold">{inv.invoiceNumber || inv.orderNumber || '—'}</td>
                                                    <td className="px-4 py-2.5 text-slate-700">{inv.sellerName?.split(/[\s,]+/)[0] || '—'}</td>
                                                    <td className="px-4 py-2.5 text-slate-700">{inv.customerName?.split(/[\s,]+/)[0] || '—'}</td>
                                                    <td className="px-4 py-2.5 text-right font-mono text-slate-600">
                                                        ${(inv.orderTotal || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right font-mono font-bold text-rose-600">
                                                        ${(inv.commissionAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    );
                })()}
            </div>
        </div>
    );
};

export default SalesHub;
