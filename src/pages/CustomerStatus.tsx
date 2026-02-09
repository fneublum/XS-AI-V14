
import React, { useState } from 'react';
import { Customer, Opportunity, Shipment, DealStage } from '../types';
import { Building2, Phone, Mail, TrendingUp, Clock, CheckCircle, Package, FileText, ShoppingCart, Truck } from 'lucide-react';

interface CustomerStatusProps {
    customers: Customer[];
    opportunities: Opportunity[];
    shipments: Shipment[];
}

const CustomerStatus: React.FC<CustomerStatusProps> = ({ customers, opportunities, shipments }) => {
    const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
    
    const selectedCustomer = customers.find(c => c.id === selectedCustomerId);
    
    // Filter data
    const customerDeals = selectedCustomer ? opportunities.filter(o => o.customerId === selectedCustomer.id) : [];
    // Shipments no longer directly linked to customer ID in this view

    // Volume Calculations
    const volRequired = customerDeals
        .filter(d => [DealStage.LEAD, DealStage.FIRST_CONTACT, DealStage.REQUIREMENTS].includes(d.stage))
        .reduce((sum, d) => sum + d.volumeLBS, 0);

    const volQuoted = customerDeals
        .filter(d => [DealStage.QUOTE_SENT, DealStage.NEGOTIATION].includes(d.stage))
        .reduce((sum, d) => sum + d.volumeLBS, 0);

    const volWithPO = customerDeals
        .filter(d => [DealStage.PO_EXPECTED, DealStage.PO_RECEIVED].includes(d.stage))
        .reduce((sum, d) => sum + d.volumeLBS, 0);

    const volDelivered = customerDeals
        .filter(d => [DealStage.PO_DELIVERED, DealStage.CLOSED_WON].includes(d.stage))
        .reduce((sum, d) => sum + d.volumeLBS, 0);
    
    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold text-slate-800">Customer 360° Status</h2>
            
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <label className="block text-sm font-medium text-slate-700 mb-2">Select Customer to View</label>
                <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <select 
                        className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg"
                        value={selectedCustomerId}
                        onChange={(e) => setSelectedCustomerId(e.target.value)}
                    >
                        <option value="">-- Choose a Client --</option>
                        {customers.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            {selectedCustomer ? (
                <div className="space-y-6 animate-in fade-in">
                    {/* Header Stats - General Info */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                            <h3 className="text-xs font-bold text-slate-500 uppercase">Total Volume (Historical)</h3>
                            <p className="text-2xl font-bold text-slate-800 mt-1">{selectedCustomer.totalVolumeLBS.toLocaleString()} LBS</p>
                        </div>
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                            <h3 className="text-xs font-bold text-slate-500 uppercase">Credit Used</h3>
                            <p className="text-2xl font-bold text-slate-800 mt-1">40% <span className="text-xs font-normal text-slate-400">of ${selectedCustomer.creditLimit.toLocaleString()}</span></p>
                        </div>
                         <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                            <h3 className="text-xs font-bold text-slate-500 uppercase">Status</h3>
                            <span className={`inline-block mt-2 px-2 py-1 rounded text-sm font-bold ${
                                selectedCustomer.status === 'Active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                            }`}>
                                {selectedCustomer.status}
                            </span>
                        </div>
                    </div>

                    {/* Volume Breakdown Stats */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-white p-4 rounded-xl border border-blue-100 shadow-sm flex flex-col justify-between">
                            <div className="flex items-center gap-2 mb-2">
                                <Package size={16} className="text-blue-500" />
                                <h3 className="text-xs font-bold text-slate-500 uppercase">Total Volume Required</h3>
                            </div>
                            <p className="text-xl font-bold text-slate-800">{volRequired.toLocaleString()}</p>
                            <p className="text-[10px] text-slate-400">Lead / First Contact / Requirements</p>
                        </div>
                        <div className="bg-white p-4 rounded-xl border border-indigo-100 shadow-sm flex flex-col justify-between">
                             <div className="flex items-center gap-2 mb-2">
                                <FileText size={16} className="text-indigo-500" />
                                <h3 className="text-xs font-bold text-slate-500 uppercase">Total Quoted</h3>
                            </div>
                            <p className="text-xl font-bold text-slate-800">{volQuoted.toLocaleString()}</p>
                            <p className="text-[10px] text-slate-400">Quote Sent / Negotiation</p>
                        </div>
                        <div className="bg-white p-4 rounded-xl border border-emerald-100 shadow-sm flex flex-col justify-between">
                             <div className="flex items-center gap-2 mb-2">
                                <ShoppingCart size={16} className="text-emerald-500" />
                                <h3 className="text-xs font-bold text-slate-500 uppercase">Total with PO</h3>
                            </div>
                            <p className="text-xl font-bold text-slate-800">{volWithPO.toLocaleString()}</p>
                            <p className="text-[10px] text-slate-400">PO Expected / Received</p>
                        </div>
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between bg-slate-50">
                             <div className="flex items-center gap-2 mb-2">
                                <Truck size={16} className="text-slate-600" />
                                <h3 className="text-xs font-bold text-slate-500 uppercase">Total Delivered</h3>
                            </div>
                            <p className="text-xl font-bold text-slate-800">{volDelivered.toLocaleString()}</p>
                            <p className="text-[10px] text-slate-400">Delivered / Closed Won</p>
                        </div>
                    </div>

                    {/* Active Deals */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="p-4 border-b border-slate-100 bg-slate-50">
                            <h3 className="font-bold text-slate-700 flex items-center gap-2">
                                <TrendingUp size={18} className="text-blue-500" /> Active Deals
                            </h3>
                        </div>
                        <div className="p-4">
                            {customerDeals.length > 0 ? (
                                <div className="space-y-3">
                                    {customerDeals.map(deal => (
                                        <div key={deal.id} className="flex justify-between items-center p-3 border border-slate-100 rounded-lg">
                                            <div>
                                                <p className="font-medium text-slate-800">{deal.productName}</p>
                                                <p className="text-xs text-slate-500">{deal.stage}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="font-bold text-slate-700">${deal.value.toLocaleString()}</p>
                                                <p className="text-xs text-slate-500">{deal.volumeLBS.toLocaleString()} LBS</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-slate-500 italic">No active opportunities.</p>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="text-center py-12 text-slate-400">
                    <Building2 size={48} className="mx-auto mb-4 opacity-20" />
                    <p>Select a customer to view their 360° dashboard</p>
                </div>
            )}
        </div>
    );
};

export default CustomerStatus;
