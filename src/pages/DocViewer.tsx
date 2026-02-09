
import React, { useState } from 'react';
import { BillOfLading, Booking, Estimate, ProformaInvoice, PurchaseOrderExtract, Invoice, PackingList } from '../types';
import { Search, Eye, FileText, Filter, Calendar, LayoutGrid, List, Package, Receipt, Ship, ClipboardList, ShoppingBag, Anchor, Calculator, X } from 'lucide-react';

interface DocViewerProps {
    purchaseOrders: PurchaseOrderExtract[];
    estimates: Estimate[];
    proformas: ProformaInvoice[];
    bookings: Booking[];
    invoices: Invoice[];
    packingLists: PackingList[];
    billOfLadings: BillOfLading[];
}

type DocType = 'ALL' | 'PO' | 'ESTIMATE' | 'PI' | 'BOOKING' | 'INVOICE' | 'PL' | 'BL';

const DocViewer: React.FC<DocViewerProps> = ({
    purchaseOrders,
    estimates,
    proformas,
    bookings,
    invoices,
    packingLists,
    billOfLadings
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState<DocType>('ALL');
    const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
    
    // Document Viewer State
    const [viewingDoc, setViewingDoc] = useState<{ url: string; title: string; isBlob: boolean } | null>(null);

    // Normalize data for display
    const getAllDocs = () => {
        const allDocs: any[] = [];

        purchaseOrders.forEach(d => allDocs.push({
            id: d.id,
            type: 'PO',
            refNumber: d.poNumber,
            entity: d.vendor,
            date: d.date,
            amount: d.totalAmount,
            currency: d.currency,
            url: d.originalDocument
        }));

        estimates.forEach(d => allDocs.push({
            id: d.id,
            type: 'ESTIMATE',
            refNumber: d.estimateNumber,
            entity: d.supplier,
            date: d.date,
            amount: d.totalAmount,
            currency: d.currency,
            url: d.originalDocument
        }));

        proformas.forEach(d => allDocs.push({
            id: d.id,
            type: 'PI',
            refNumber: d.piNumber,
            entity: d.supplier,
            date: d.date,
            amount: d.totalAmount,
            currency: d.currency,
            url: d.originalDocument
        }));

        bookings.forEach(d => allDocs.push({
            id: d.id,
            type: 'BOOKING',
            refNumber: d.bookingNumber,
            entity: d.customer, // or Carrier if available, usually customer/shipper context
            date: d.createdAt ? new Date(d.createdAt).toLocaleDateString() : '',
            amount: '',
            currency: '',
            url: d.originalDocument,
            extra: d.vesselVoyage
        }));

        invoices.forEach(d => allDocs.push({
            id: d.id,
            type: 'INVOICE',
            refNumber: d.invoiceNumber,
            entity: d.supplier || (d as any).shipperName,
            date: d.date || (d as any).invoiceDate,
            amount: d.totalAmount,
            currency: d.currency,
            url: d.originalDocument || (d as any).originalDocument
        }));

        packingLists.forEach(d => allDocs.push({
            id: d.id,
            type: 'PL',
            refNumber: d.plNumber,
            entity: d.shipper,
            date: d.date,
            amount: '',
            currency: '',
            url: d.originalDocument
        }));

        billOfLadings.forEach(d => allDocs.push({
            id: d.id,
            type: 'BL',
            refNumber: d.blNumber,
            entity: d.shipper,
            date: d.shippedDate,
            amount: '',
            currency: '',
            url: d.originalDocument,
            extra: d.vesselVoyage
        }));

        return allDocs;
    };

    const allDocs = getAllDocs();

    const filteredDocs = allDocs.filter(doc => {
        const matchesType = activeTab === 'ALL' || doc.type === activeTab;
        const searchLower = searchTerm.toLowerCase();
        const matchesSearch = !searchTerm || 
            (doc.refNumber && doc.refNumber.toLowerCase().includes(searchLower)) ||
            (doc.entity && doc.entity.toLowerCase().includes(searchLower)) ||
            (doc.type.toLowerCase().includes(searchLower));
        
        return matchesType && matchesSearch;
    });

    const openDocument = (docUrl?: string, title: string = 'Document') => {
        if (!docUrl) {
            alert("No document available for this item.");
            return;
        }
        try {
            if (docUrl.startsWith('data:')) {
                // Safe way to open base64 PDF
                const arr = docUrl.split(',');
                const mime = arr[0].match(/:(.*?);/)?.[1] || 'application/pdf';
                const bstr = atob(arr[1]);
                let n = bstr.length;
                const u8arr = new Uint8Array(n);
                while (n--) {
                    u8arr[n] = bstr.charCodeAt(n);
                }
                const blob = new Blob([u8arr], { type: mime });
                const blobUrl = URL.createObjectURL(blob);
                setViewingDoc({ url: blobUrl, title, isBlob: true });
            } else {
                // Regular URL
                setViewingDoc({ url: docUrl, title, isBlob: false });
            }
        } catch (e) {
             console.error("Error preparing document", e);
             alert("Could not load document.");
        }
    };

    const closeDocument = () => {
        if (viewingDoc && viewingDoc.isBlob) {
            URL.revokeObjectURL(viewingDoc.url);
        }
        setViewingDoc(null);
    };

    const getIcon = (type: string) => {
        switch(type) {
            case 'PO': return <ShoppingBag size={20} />;
            case 'ESTIMATE': return <Calculator size={20} />;
            case 'PI': return <FileText size={20} />;
            case 'BOOKING': return <Ship size={20} />;
            case 'INVOICE': return <Receipt size={20} />;
            case 'PL': return <ClipboardList size={20} />;
            case 'BL': return <Anchor size={20} />;
            default: return <FileText size={20} />;
        }
    };

    const getColor = (type: string) => {
        switch(type) {
            case 'PO': return 'text-purple-600 bg-purple-50 border-purple-100';
            case 'ESTIMATE': return 'text-amber-600 bg-amber-50 border-amber-100';
            case 'PI': return 'text-indigo-600 bg-indigo-50 border-indigo-100';
            case 'BOOKING': return 'text-cyan-600 bg-cyan-50 border-cyan-100';
            case 'INVOICE': return 'text-emerald-600 bg-emerald-50 border-emerald-100';
            case 'PL': return 'text-orange-600 bg-orange-50 border-orange-100';
            case 'BL': return 'text-blue-600 bg-blue-50 border-blue-100';
            default: return 'text-slate-600 bg-slate-50 border-slate-100';
        }
    };

    const getFullLabel = (type: string) => {
        switch(type) {
            case 'PO': return 'Purchase Order';
            case 'ESTIMATE': return 'Estimate';
            case 'PI': return 'Proforma Invoice';
            case 'BOOKING': return 'Booking Conf.';
            case 'INVOICE': return 'Commercial Invoice';
            case 'PL': return 'Packing List';
            case 'BL': return 'Bill of Lading';
            default: return type;
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <FileText className="text-blue-600"/> Document Viewer
                    </h2>
                    <p className="text-slate-500 text-sm">Centralized repository of all scanned and extracted documents.</p>
                </div>
                <div className="flex gap-2 w-full md:w-auto">
                    <div className="relative flex-1 md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input 
                            type="text" 
                            placeholder="Search documents..." 
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

            {/* Filter Tabs */}
            <div className="flex gap-2 overflow-x-auto pb-2">
                {(['ALL', 'PO', 'ESTIMATE', 'PI', 'BOOKING', 'INVOICE', 'PL', 'BL'] as DocType[]).map(type => (
                    <button
                        key={type}
                        onClick={() => setActiveTab(type)}
                        className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap border transition-all flex items-center gap-2 ${
                            activeTab === type 
                            ? 'bg-slate-800 text-white border-slate-800' 
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                    >
                        {type === 'ALL' && <Filter size={14} />}
                        {type !== 'ALL' && getIcon(type)}
                        {type === 'ALL' ? 'All Documents' : getFullLabel(type)}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="w-full">
                {filteredDocs.length === 0 ? (
                    <div className="p-12 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl bg-slate-50">
                        <FileText size={48} className="mx-auto mb-4 opacity-20" />
                        <p>No documents found matching your criteria.</p>
                    </div>
                ) : viewMode === 'grid' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {filteredDocs.map((doc, idx) => (
                            <div key={`${doc.type}-${doc.id}-${idx}`} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow group relative flex flex-col justify-between h-full">
                                <div>
                                    <div className="flex justify-between items-start mb-3">
                                        <div className={`p-2 rounded-lg ${getColor(doc.type)}`}>
                                            {getIcon(doc.type)}
                                        </div>
                                        <div className="text-right">
                                            <span className="text-[10px] font-bold text-slate-400 uppercase block">{getFullLabel(doc.type)}</span>
                                            <span className="text-xs text-slate-500">{doc.date}</span>
                                        </div>
                                    </div>
                                    <h3 className="font-bold text-slate-800 text-lg mb-1 truncate" title={doc.refNumber}>{doc.refNumber || 'No Ref #'}</h3>
                                    <p className="text-sm text-slate-600 mb-4 line-clamp-2" title={doc.entity}>{doc.entity || 'Unknown Entity'}</p>
                                    
                                    {doc.amount && (
                                        <div className="bg-slate-50 p-2 rounded text-right mb-3">
                                            <p className="text-[10px] text-slate-400 uppercase font-bold">Total Amount</p>
                                            <p className="font-mono font-bold text-slate-700">{doc.currency} {Number(doc.amount).toLocaleString()}</p>
                                        </div>
                                    )}
                                    {doc.extra && (
                                        <p className="text-xs text-slate-500 mb-3 flex items-center gap-1"><Ship size={12}/> {doc.extra}</p>
                                    )}
                                </div>
                                <button 
                                    onClick={() => doc.url && openDocument(doc.url, doc.refNumber)}
                                    disabled={!doc.url}
                                    className={`w-full py-2 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2 ${
                                        doc.url 
                                        ? "bg-blue-50 text-blue-600 hover:bg-blue-100" 
                                        : "bg-slate-100 text-slate-300 cursor-not-allowed"
                                    }`}
                                >
                                    <Eye size={16}/> {doc.url ? "View Document" : "No Document"}
                                </button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-slate-50 border-b border-slate-200">
                                <tr>
                                    <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Type</th>
                                    <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Reference #</th>
                                    <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Entity</th>
                                    <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Date</th>
                                    <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase text-right">Amount</th>
                                    <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredDocs.map((doc, idx) => (
                                    <tr key={`${doc.type}-${doc.id}-${idx}`} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-6 py-4">
                                            <span className={`text-[10px] px-2 py-1 rounded-full font-bold border flex items-center gap-1 w-fit ${getColor(doc.type)}`}>
                                                {getIcon(doc.type)} {doc.type}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-sm font-mono font-medium text-slate-700">{doc.refNumber || '-'}</td>
                                        <td className="px-6 py-4 text-sm text-slate-800">{doc.entity || '-'}</td>
                                        <td className="px-6 py-4 text-sm text-slate-500">{doc.date || '-'}</td>
                                        <td className="px-6 py-4 text-sm text-right font-mono font-bold text-slate-700">
                                            {doc.amount ? `${doc.currency} ${Number(doc.amount).toLocaleString()}` : '-'}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <button 
                                                onClick={() => doc.url && openDocument(doc.url, doc.refNumber)} 
                                                disabled={!doc.url}
                                                className={`p-2 rounded transition-colors ${
                                                    doc.url 
                                                    ? "text-slate-400 hover:text-blue-600 hover:bg-blue-50" 
                                                    : "text-slate-200 cursor-not-allowed"
                                                }`}
                                            >
                                                <Eye size={18} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Internal Document Viewer Modal */}
            {viewingDoc && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col animate-in zoom-in-95">
                        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                             <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                <FileText size={20} className="text-blue-600"/>
                                {viewingDoc.title}
                             </h3>
                             <button onClick={closeDocument} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-200 rounded-full transition-all">
                                <X size={24}/>
                             </button>
                        </div>
                        <div className="flex-1 bg-slate-100 p-2 overflow-hidden relative">
                            <iframe 
                                src={viewingDoc.url} 
                                className="w-full h-full rounded border border-slate-300 bg-white"
                                title="Document Preview"
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DocViewer;
