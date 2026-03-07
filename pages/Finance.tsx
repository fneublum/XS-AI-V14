
import React from 'react';
import { PieChart, DollarSign, TrendingUp, CreditCard, Receipt, ArrowUpRight, ArrowDownRight } from 'lucide-react';

const Finance: React.FC = () => {
    return (
        <div className="p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-3 mb-8">
                <div className="p-2.5 bg-amber-50 rounded-xl">
                    <PieChart size={22} className="text-amber-600" />
                </div>
                <div>
                    <h1 className="text-xl font-bold text-slate-800">Finance</h1>
                    <p className="text-xs text-slate-500">Financial overview and management</p>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                {[
                    { label: 'Revenue', value: '$0.00', icon: DollarSign, color: 'emerald', change: '+0%', up: true },
                    { label: 'Expenses', value: '$0.00', icon: CreditCard, color: 'rose', change: '0%', up: false },
                    { label: 'Profit', value: '$0.00', icon: TrendingUp, color: 'blue', change: '+0%', up: true },
                    { label: 'Pending', value: '$0.00', icon: Receipt, color: 'amber', change: '0%', up: true },
                ].map(card => {
                    const CardIcon = card.icon;
                    return (
                        <div key={card.label} className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-shadow">
                            <div className="flex items-center justify-between mb-3">
                                <div className={`p-2 rounded-lg bg-${card.color}-50`}>
                                    <CardIcon size={18} className={`text-${card.color}-600`} />
                                </div>
                                <div className={`flex items-center gap-0.5 text-xs font-medium ${card.up ? 'text-emerald-600' : 'text-rose-600'}`}>
                                    {card.up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                                    {card.change}
                                </div>
                            </div>
                            <p className="text-2xl font-bold text-slate-800">{card.value}</p>
                            <p className="text-xs text-slate-500 mt-1">{card.label}</p>
                        </div>
                    );
                })}
            </div>

            {/* Coming Soon */}
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-50 rounded-2xl mb-4">
                    <PieChart size={28} className="text-amber-600" />
                </div>
                <h2 className="text-lg font-bold text-slate-800 mb-2">Finance Module</h2>
                <p className="text-sm text-slate-500 max-w-md mx-auto">
                    Financial reports, accounts receivable, accounts payable, and cash flow management will be available here.
                </p>
            </div>
        </div>
    );
};

export default Finance;
