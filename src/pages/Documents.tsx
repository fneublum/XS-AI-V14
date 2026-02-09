
import React, { useState } from 'react';
import { ProformaInvoice, Invoice, PackingList, Company } from '../types';
import { Search, LayoutGrid, List, FileText, ClipboardList, Receipt, Eye, Trash2, Building, Calendar, DollarSign, AlertCircle } from 'lucide-react';

interface DocumentsProps {
    proformaInvoices: ProformaInvoice[];
    invoices: Invoice[];
    packingLists: PackingList[];
    onDeleteProforma: (id: string) => void;
    onDeleteInvoice: (id: string) => void;
    onDeletePackingList: (id: string) => void;
    currentCompanyId: string;
    availableCompanies: Company[];
}

const Documents: React.FC<DocumentsProps> = ({ 
    proformaInvoices, invoices, packingLists,
    onDeleteProforma, onDeleteInvoice, onDeletePackingList,
    currentCompanyId, availableCompanies
}) => {
    const [activeTab, setActiveTab] = useState<'PROFORMA' | 'INVOICE' | 'PACKING'>('PROFORMA');
    const [viewMode, setViewMode] = useState<'grid' | 'table'>('table');
    const [searchTerm, setSearchTerm] = useState('');

    const getFilteredData = () => {
        const lowerSearch = searchTerm.toLowerCase();
        
        if (activeTab === 'PROFORMA') {
            return proformaInvoices.filter(doc => {
                const matches = (doc.piNumber?.toLowerCase().includes(lowerSearch) || 
                        doc.supplier?.toLowerCase().includes(lowerSearch) ||
                        doc.buyer?.toLowerCase().includes(lowerSearch));
                return matches;
            });
        }
        if (activeTab === 'INVOICE') {
            return invoices.filter(doc => {
                const matches = (doc.invoiceNumber?.toLowerCase().includes(lowerSearch) || 
                        doc.supplier?.toLowerCase().includes(lowerSearch));
                return matches;
            });
        }
        if (activeTab === 'PACKING') {
            return packingLists.filter(doc => {
                const matches = (doc.plNumber?.toLowerCase().includes(lowerSearch) || 
                        doc.shipper?.toLowerCase().includes(lowerSearch) ||
                        doc.consignee?.toLowerCase().includes(lowerSearch));
                return matches;
            });
        }
        return [];
    };

    const data = getFilteredData();

    const openDocument = (docUrl?: string) => {
        if (!docUrl) return;
        try {
            if (docUrl.startsWith('data:') || docUrl.length > 500) {
                 const win = window.open();
                 if(win) win.document.write(`<iframe src="${docUrl}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`);
            } else {
                window.open(docUrl, '_blank');
            }
        } catch (e) {
            console.error("Error opening document", e);
        }
    };

    const handleDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!window.confirm("Are you sure you want to delete this document?")) return;
        if (activeTab === 'PROFORMA') onDeleteProforma(id);
        if (activeTab === 'INVOICE') onDeleteInvoice(id);
        if (activeTab === 'PACKING') onDeletePackingList(id);
    };

    return (
        <div className="space-y-6">
            {/* Header & Controls */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Documents Repository</h2>
                    <p className="text-slate-500 text-sm">Manage extracted commercial documents</p>
                </div>
                <div className="flex gap-2 w-full md:w-auto">
                    <div className="relative flex-1 md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input 
                            type="text" 
                            placeholder={`Search ${activeTab.toLowerCase().replace('_', ' ')}s...`}
                            className="w-full pl-10 pr-4 py-2 border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="bg-white border border-slate-200 rounded-lg p-1 flex gap-1">
                        <button onClick={() => setViewMode('grid')} className={`p-2 rounded transition-all ${viewMode === 'grid' ? 'bg-slate-100 text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}><LayoutGrid size={18} /></button>
                        <button onClick={() => setViewMode('table')} className={`p-2 rounded transition-all ${viewMode === 'table' ? 'bg-slate-100 text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}><List size={18} /></button>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-200">
                <button 
                    onClick={() => { setActiveTab('PROFORMA'); setSearchTerm(''); }}
                    className={`px-6 py-3 text-sm font-bold border-b-2 flex items-center gap-2 transition-colors ${activeTab === 'PROFORMA' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                    <FileText size={16}/> Proforma Invoices
                </button>
                <button 
                    onClick={() => { setActiveTab('INVOICE'); setSearchTerm(''); }}
                    className={`px-6 py-3 text-sm font-bold border-b-2 flex items-center gap-2 transition-colors ${activeTab === 'INVOICE' ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                    <Receipt size={16}/> Commercial Invoices
                </button>
                <button 
                    onClick={() => { setActiveTab('PACKING'); setSearchTerm(''); }}
                    className={`px-6 py-3 text-sm font-bold border-b-2 flex items-center gap-2 transition-colors ${activeTab === 'PACKING' ? 'border-orange-600 text-orange-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                    <ClipboardList size={16}/> Packing Lists
                </button>
            </div>

            {/* Content */}
            <div className="w-full">
                {data.length === 0 ? (
                    <div className="p-12 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl">
                        <AlertCircle size={48} className="mx-auto mb-4 opacity-20" />
                        <p>No documents found.</p>
                    </div>
                ) : viewMode === 'grid' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {data.map((doc: any) => (
                            <div key={doc.id} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow group relative">
                                <div className="flex justify-between items-start mb-3">
                                    <div>
                                        <h3 className="font-bold text-slate-800 text-lg">{doc.piNumber || doc.invoiceNumber || doc.plNumber}</h3>
                                        <p className="text-xs text-slate-500">{doc.date}</p>
                                    </div>
                                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => openDocument(doc.originalDocument)} className="text-slate-400 hover:text-blue-500 p-1 rounded hover:bg-blue-50"><Eye size={16} /></button>
                                        <button onClick={(e) => handleDelete(doc.id, e)} className="text-slate-400 hover:text-red-500 p-1 rounded hover:bg-red-50"><Trash2 size={16} /></button>
                                    </div>
                                </div>
                                <div className="space-y-2 mb-3">
                                    {(doc.supplier || doc.shipper) && (
                                        <div className="flex items-center gap-2 text-sm text-slate-600">
                                            <Building size={14} className="text-slate-400"/> {doc.supplier || doc.shipper}
                                        </div>
                                    )}
                                    {(doc.buyer || doc.consignee) && (
                                        <div className="flex items-center gap-2 text-sm text-slate-600">
                                            <Building size={14} className="text-slate-400"/> {doc.buyer || doc.consignee}
                                        </div>
                                    )}
                                </div>
                                {(doc.totalAmount !== undefined) && (
                                    <div className="pt-3 border-t border-slate-100 flex justify-between items-center">
                                        <span className="text-xs text-slate-400 uppercase font-bold">Total</span>
                                        <span className="text-lg font-bold text-slate-800">{doc.currency} {Number(doc.totalAmount).toLocaleString()}</span>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-slate-50 border-b border-slate-200">
                                <tr>
                                    <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Document #</th>
                                    <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">
                                        {activeTab === 'PACKING' ? 'Shipper' : 'Supplier'}
                                    </th>
                                    <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">
                                        {activeTab === 'PACKING' ? 'Consignee' : 'Buyer'}
                                    </th>
                                    <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Date</th>
                                    {activeTab !== 'PACKING' && <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase text-right">Amount</th>}
                                    <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {data.map((doc: any) => (
                                    <tr key={doc.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-6 py-4 font-mono font-bold text-slate-700 text-sm">
                                            {doc.piNumber || doc.invoiceNumber || doc.plNumber}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-slate-700">{doc.supplier || doc.shipper}</td>
                                        <td className="px-6 py-4 text-sm text-slate-600">{doc.buyer || doc.consignee}</td>
                                        <td className="px-6 py-4 text-sm text-slate-500">{doc.date}</td>
                                        {activeTab !== 'PACKING' && (
                                            <td className="px-6 py-4 text-right font-bold text-slate-800">
                                                {doc.currency} {Number(doc.totalAmount).toLocaleString()}
                                            </td>
                                        )}
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button onClick={() => openDocument(doc.originalDocument)} className="text-slate-400 hover:text-blue-600 p-1 rounded hover:bg-blue-50 transition-colors"><Eye size={16} /></button>
                                                <button onClick={(e) => handleDelete(doc.id, e)} className="text-slate-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition-colors"><Trash2 size={16} /></button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Documents;
