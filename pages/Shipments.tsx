
import React, { useState } from 'react';
import { Shipment, Product, Company, ShipmentProduct, Port } from '../types';
import { Search, Plus, Container, FileText, Calendar, MapPin, Ship, X, Save, Pencil, Trash2, AlertCircle, Package, Anchor, CheckCircle2, LayoutGrid, List, ArrowRight, FilePlus } from 'lucide-react';
import { QuantityInput } from '../components/UnitInputs';

interface ShipmentsProps {
    shipments: Shipment[];
    onAdd: (s: Shipment) => void;
    onUpdate: (s: Shipment) => void;
    onDelete: (id: string) => void;
    products: Product[];
    currentCompanyId: string;
    availableCompanies: Company[];
    ports: Port[];
    onAddPort: (p: Port) => void;
}

const Shipments: React.FC<ShipmentsProps> = ({ shipments, onAdd, onUpdate, onDelete, products, currentCompanyId, availableCompanies, ports, onAddPort }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'grid' | 'table'>('table');

    // Quick Add Port State
    const [showQuickAddPort, setShowQuickAddPort] = useState(false);
    const [newPortCode, setNewPortCode] = useState('');
    const [newPortName, setNewPortName] = useState('');
    const [newPortCountry, setNewPortCountry] = useState('');
    const [portAddedMessage, setPortAddedMessage] = useState('');
    const [targetPortField, setTargetPortField] = useState<'origin' | 'destination' | null>(null);

    // Form State
    const initialFormState: Partial<Shipment> = {
        containerNumber: '',
        blNumber: '',
        origin: '',
        destination: '',
        status: 'Booking',
        etd: new Date().toISOString().split('T')[0],
        eta: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        carrier: '',
        companyId: currentCompanyId === 'ALL' && availableCompanies.length > 0 ? '' : currentCompanyId,
        products: []
    };

    const [formData, setFormData] = useState<Partial<Shipment>>(initialFormState);
    const [currentProductLine, setCurrentProductLine] = useState<ShipmentProduct>({ productName: '', quantity: 0 });

    const filteredShipments = shipments.filter(s => {
        const sContainer = s.containerNumber || '';
        const sBL = s.blNumber || '';
        const searchLower = searchTerm.toLowerCase();

        return sContainer.toLowerCase().includes(searchLower) ||
            sBL.toLowerCase().includes(searchLower);
    });

    const handleAddNew = () => {
        setFormData({
            ...initialFormState,
            companyId: currentCompanyId === 'ALL' && availableCompanies.length > 0 ? '' : currentCompanyId
        });
        setEditingId(null);
        setIsAdding(true);
    };

    const handleEdit = (shipment: Shipment, e: React.MouseEvent) => {
        e.stopPropagation();
        setFormData(shipment);
        setEditingId(shipment.id);
        setIsAdding(true);
    };

    const handleDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (window.confirm('Delete this shipment record?')) {
            onDelete(id);
            if (editingId === id) {
                setIsAdding(false);
                setEditingId(null);
            }
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleAddProductLine = () => {
        if (!currentProductLine.productName || currentProductLine.quantity <= 0) return;
        setFormData(prev => ({
            ...prev,
            products: [...(prev.products || []), { ...currentProductLine }]
        }));
        setCurrentProductLine({ productName: '', quantity: 0 });
    };

    const handleRemoveProductLine = (index: number) => {
        setFormData(prev => ({
            ...prev,
            products: (prev.products || []).filter((_, i) => i !== index)
        }));
    };

    const handleQuickAddPort = async () => {
        if (!newPortCode || !newPortName) return;

        const companyIdForNewRecord = 'ALL';

        const newPort: Port = {
            id: `PRT${Date.now()}`,
            companyId: companyIdForNewRecord,
            code: newPortCode.toUpperCase(),
            name: newPortName,
            country: newPortCountry
        };

        await onAddPort(newPort);

        if (targetPortField === 'origin') {
            setFormData(prev => ({ ...prev, origin: `${newPort.name} (${newPort.code})` }));
        } else if (targetPortField === 'destination') {
            setFormData(prev => ({ ...prev, destination: `${newPort.name} (${newPort.code})` }));
        }

        setNewPortCode('');
        setNewPortName('');
        setNewPortCountry('');
        setShowQuickAddPort(false);
        setPortAddedMessage('Port added!');
        setTimeout(() => setPortAddedMessage(''), 3000);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.containerNumber) return;

        const companyIdForNewRecord = formData.companyId || (currentCompanyId === 'ALL' ? '' : currentCompanyId);
        if (!companyIdForNewRecord) {
            alert("Please select a company for the shipment.");
            return;
        }

        if (editingId) {
            onUpdate({ ...formData, id: editingId, companyId: companyIdForNewRecord } as Shipment);
        } else {
            const newShipment: Shipment = {
                id: `S${Date.now()}`,
                companyId: companyIdForNewRecord,
                containerNumber: formData.containerNumber || '',
                blNumber: formData.blNumber || '',
                origin: formData.origin || '',
                destination: formData.destination || '',
                status: (formData.status as any) || 'Booking',
                etd: formData.etd || '',
                eta: formData.eta || '',
                carrier: formData.carrier || '',
                products: formData.products || []
            };
            onAdd(newShipment);
        }

        setIsAdding(false);
        setEditingId(null);
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'In Transit': return 'bg-blue-100 text-blue-700';
            case 'Customs Hold': return 'bg-amber-100 text-amber-700';
            case 'Delivered': return 'bg-emerald-100 text-emerald-700';
            case 'Released': return 'bg-purple-100 text-purple-700';
            default: return 'bg-slate-100 text-slate-700';
        }
    };

    return (
        <div className="space-y-6">
            {/* Header Row */}
            <div className="mb-6 flex items-start justify-between">
                <div className="flex items-center gap-4">
                    <div className="p-2 bg-gradient-to-r from-orange-500 to-amber-500 rounded-xl text-white">
                        <Container size={24} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">Cargos in Transit</h1>
                        <p className="text-slate-500 text-sm">Manage container shipments and logistics</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={handleAddNew} className="flex items-center gap-2 px-5 py-2.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-all shadow-md font-medium">
                        <FilePlus size={18} /> Add Cargo
                    </button>
                </div>
            </div>

            {/* Search & View Toggle Row */}
            <div className="flex items-center gap-2 mb-4">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                        type="text"
                        placeholder="Search container or BL..."
                        className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 outline-none"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="bg-white border border-slate-200 rounded-lg p-1 flex gap-1">
                    <button
                        onClick={() => setViewMode('grid')}
                        className={`p-2 rounded transition-all ${viewMode === 'grid' ? 'bg-slate-100 text-orange-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        title="Grid View"
                    >
                        <LayoutGrid size={18} />
                    </button>
                    <button
                        onClick={() => setViewMode('table')}
                        className={`p-2 rounded transition-all ${viewMode === 'table' ? 'bg-slate-100 text-orange-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        title="Table View"
                    >
                        <List size={18} />
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className={`${isAdding ? 'lg:col-span-2' : 'lg:col-span-3'} transition-all duration-300`}>

                    {/* Grid View */}
                    {viewMode === 'grid' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredShipments.map(shipment => (
                                <div key={shipment.id} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow group">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-blue-50 text-blue-600 rounded">
                                                <Container size={20} />
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-slate-800 font-mono">{shipment.containerNumber}</h4>
                                                <p className="text-xs text-slate-500 font-mono">BL: {shipment.blNumber || 'N/A'}</p>
                                            </div>
                                        </div>
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${getStatusColor(shipment.status)}`}>
                                            {shipment.status}
                                        </span>
                                    </div>

                                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 mb-4 flex items-center justify-between text-sm">
                                        <div>
                                            <p className="text-[10px] text-slate-400 font-bold uppercase">Origin</p>
                                            <p className="font-semibold text-slate-700">{shipment.origin}</p>
                                            <p className="text-[10px] text-slate-500">{shipment.etd}</p>
                                        </div>
                                        <ArrowRight size={16} className="text-slate-300" />
                                        <div className="text-right">
                                            <p className="text-[10px] text-slate-400 font-bold uppercase">Dest</p>
                                            <p className="font-semibold text-slate-700">{shipment.destination}</p>
                                            <p className="text-[10px] text-slate-500">{shipment.eta}</p>
                                        </div>
                                    </div>

                                    <div className="flex justify-between items-end">
                                        <div>
                                            <p className="text-xs font-bold text-slate-400 uppercase">Carrier</p>
                                            <p className="text-sm font-medium text-slate-600 flex items-center gap-1"><Ship size={12} /> {shipment.carrier}</p>
                                        </div>
                                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={(e) => handleEdit(shipment, e)} className="text-slate-400 hover:text-amber-500"><Pencil size={16} /></button>
                                            <button onClick={(e) => handleDelete(shipment.id, e)} className="text-slate-400 hover:text-red-500"><Trash2 size={16} /></button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Table View */}
                    {viewMode === 'table' && (
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-200">
                                            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Container / BL</th>
                                            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Route</th>
                                            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Carrier</th>
                                            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Cargo</th>
                                            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Status</th>
                                            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {filteredShipments.map((shipment) => (
                                            <tr key={shipment.id} className="hover:bg-slate-50 transition-colors">
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded bg-blue-50 flex items-center justify-center text-blue-500">
                                                            <Container size={16} />
                                                        </div>
                                                        <div>
                                                            <p className="font-mono font-semibold text-slate-800 text-sm">{shipment.containerNumber}</p>
                                                            {shipment.blNumber && <p className="text-xs text-slate-500 font-mono">BL: {shipment.blNumber}</p>}
                                                            {currentCompanyId === 'ALL' && (
                                                                <p className="text-[10px] text-slate-400 mt-0.5">{availableCompanies.find(c => c.id === shipment.companyId)?.name}</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-sm">
                                                    <div className="flex flex-col">
                                                        <span className="text-slate-600 flex items-center gap-1"><MapPin size={10} /> {shipment.origin}</span>
                                                        <span className="text-slate-400 text-xs pl-3.5">to</span>
                                                        <span className="text-slate-600 flex items-center gap-1"><MapPin size={10} /> {shipment.destination}</span>
                                                        <span className="text-xs text-slate-400 mt-1">ETA: {shipment.eta}</span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-sm text-slate-600">
                                                    <span className="flex items-center gap-1"><Ship size={12} /> {shipment.carrier}</span>
                                                </td>
                                                <td className="px-6 py-4 text-xs">
                                                    {(shipment.products && shipment.products.length > 0) ? (
                                                        <div className="space-y-1">
                                                            {shipment.products.slice(0, 2).map((p, i) => (
                                                                <div key={i} className="flex justify-between gap-2 text-slate-600">
                                                                    <span className="truncate max-w-[100px]" title={p.productName}>{p.productName}</span>
                                                                    <span className="font-mono font-bold">{p.quantity.toLocaleString()}</span>
                                                                </div>
                                                            ))}
                                                            {shipment.products.length > 2 && <span className="text-slate-400 italic">+{shipment.products.length - 2} more</span>}
                                                        </div>
                                                    ) : <span className="text-slate-400 italic">Empty</span>}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(shipment.status)}`}>
                                                        {shipment.status}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <button onClick={(e) => handleEdit(shipment, e)} title="Edit" className="text-slate-400 hover:text-amber-600 transition-colors"><Pencil size={16} /></button>
                                                        <button onClick={(e) => handleDelete(shipment.id, e)} title="Delete" className="text-slate-400 hover:text-red-600 transition-colors"><Trash2 size={16} /></button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {filteredShipments.length === 0 && (
                        <div className="p-8 text-center text-slate-500 flex flex-col items-center">
                            <AlertCircle size={32} className="mb-2 text-slate-300" />
                            <p>No shipments found.</p>
                        </div>
                    )}
                </div>

                {isAdding && (
                    <div className="lg:col-span-1 animate-in slide-in-from-right-10 duration-300 relative">
                        {/* Quick Add Port Modal */}
                        {showQuickAddPort && (
                            <div className="absolute inset-0 bg-white/95 z-20 flex items-center justify-center rounded-xl backdrop-blur-sm animate-in fade-in">
                                <div className="bg-white p-6 rounded-lg shadow-xl border border-slate-200 w-80 space-y-4">
                                    <h4 className="font-bold text-lg flex items-center gap-2"><Anchor size={20} /> Quick Add Port</h4>
                                    <div>
                                        <input
                                            className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm uppercase font-mono mb-2"
                                            placeholder="Code (3-5 Letters)"
                                            maxLength={5}
                                            value={newPortCode}
                                            onChange={e => setNewPortCode(e.target.value.toUpperCase())}
                                        />
                                        <input
                                            className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm mb-2"
                                            placeholder="Port Name"
                                            value={newPortName}
                                            onChange={e => setNewPortName(e.target.value)}
                                        />
                                        <input
                                            className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm"
                                            placeholder="Country"
                                            value={newPortCountry}
                                            onChange={e => setNewPortCountry(e.target.value)}
                                        />
                                    </div>
                                    <div className="flex justify-end gap-2">
                                        <button type="button" onClick={() => setShowQuickAddPort(false)} className="px-3 py-1.5 bg-slate-100 rounded text-sm hover:bg-slate-200">Cancel</button>
                                        <button type="button" onClick={handleQuickAddPort} disabled={!newPortCode || !newPortName} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">Add</button>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="bg-white rounded-xl shadow-lg border border-slate-200 sticky top-6 max-h-[90vh] overflow-y-auto custom-scrollbar">
                            <div className="flex justify-between items-center p-4 border-b border-slate-100">
                                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                    {editingId ? <Pencil size={16} /> : <Plus size={16} />}
                                    {editingId ? 'Edit Shipment' : 'New Shipment'}
                                </h3>
                                <button onClick={() => { setIsAdding(false); setEditingId(null); }} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                            </div>
                            <form onSubmit={handleSubmit} className="p-4 space-y-4">
                                {currentCompanyId === 'ALL' && (
                                    <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                                        <label className="block text-xs font-bold text-blue-800 uppercase mb-1">Assign to Company</label>
                                        <select required name="companyId" value={formData.companyId || ''} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500">
                                            <option value="">Select Company...</option>
                                            {[...availableCompanies].sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>
                                    </div>
                                )}
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Container Number *</label>
                                    <div className="relative">
                                        <Container size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input required name="containerNumber" value={formData.containerNumber || ''} onChange={handleInputChange} className="w-full pl-9 pr-3 py-2 border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm font-mono uppercase" placeholder="ABCD1234567" />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">BL Number</label>
                                    <div className="relative">
                                        <FileText size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input name="blNumber" value={formData.blNumber || ''} onChange={handleInputChange} className="w-full pl-9 pr-3 py-2 border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm font-mono uppercase" placeholder="MAEU..." />
                                    </div>
                                </div>

                                {/* Product Line Items */}
                                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                                    <h4 className="text-xs font-bold text-slate-500 uppercase mb-2 flex items-center gap-1"><Package size={12} /> Cargo Contents</h4>
                                    <div className="space-y-2 mb-3">
                                        {(formData.products || []).map((prod, idx) => (
                                            <div key={idx} className="flex justify-between items-center bg-white p-2 rounded border border-slate-200 text-sm">
                                                <span>{prod.productName}</span>
                                                <div className="flex items-center gap-3">
                                                    <span className="font-mono font-bold">{prod.quantity.toLocaleString()}</span>
                                                    <button type="button" onClick={() => handleRemoveProductLine(idx)} className="text-red-400 hover:text-red-600"><X size={14} /></button>
                                                </div>
                                            </div>
                                        ))}
                                        {(formData.products || []).length === 0 && <p className="text-xs text-slate-400 italic text-center py-2">No products added.</p>}
                                    </div>
                                    <div className="flex gap-2 items-end border-t border-slate-200 pt-2 flex-wrap">
                                        <div className="flex-1 min-w-[200px]">
                                            <label className="block text-[10px] text-slate-500 mb-1">Product</label>
                                            <select
                                                className="w-full border border-slate-600 bg-slate-900 text-white rounded px-2 py-2 text-sm"
                                                value={currentProductLine.productName}
                                                onChange={(e) => setCurrentProductLine({ ...currentProductLine, productName: e.target.value })}
                                            >
                                                <option value="">Select...</option>
                                                {products.filter(p => currentCompanyId === 'ALL' ? (formData.companyId ? p.companyId === formData.companyId : true) : true).map(p => (
                                                    <option key={p.id} value={`${p.name} - ${p.grade}`}>{p.name} ({p.grade})</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="min-w-[200px] flex-1">
                                            <QuantityInput
                                                value={currentProductLine.quantity}
                                                onChange={(val) => setCurrentProductLine({ ...currentProductLine, quantity: val })}
                                                label="Qty"
                                            />
                                        </div>
                                        <button type="button" onClick={handleAddProductLine} className="bg-slate-200 hover:bg-slate-300 text-slate-700 p-2 rounded transition-colors h-[38px] w-[38px] flex items-center justify-center"><Plus size={16} /></button>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Carrier</label>
                                    <div className="relative">
                                        <Ship size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input name="carrier" value={formData.carrier || ''} onChange={handleInputChange} className="w-full pl-9 pr-3 py-2 border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="Maersk, MSC..." />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Origin</label>
                                        <select
                                            className="w-full border border-slate-600 bg-slate-900 text-white rounded-lg px-2 py-2 text-sm"
                                            value={formData.origin || ''}
                                            onChange={(e) => {
                                                if (e.target.value === '_ADD_NEW_') {
                                                    setTargetPortField('origin');
                                                    setShowQuickAddPort(true);
                                                } else {
                                                    setFormData({ ...formData, origin: e.target.value });
                                                }
                                            }}
                                        >
                                            <option value="">Select Port...</option>
                                            <option value="_ADD_NEW_" className="font-bold text-blue-600 bg-blue-50">+ Add Port</option>
                                            {[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={`${p.name} (${p.code})`}>{p.name} ({p.code})</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Destination</label>
                                        <select
                                            className="w-full border border-slate-600 bg-slate-900 text-white rounded-lg px-2 py-2 text-sm"
                                            value={formData.destination || ''}
                                            onChange={(e) => {
                                                if (e.target.value === '_ADD_NEW_') {
                                                    setTargetPortField('destination');
                                                    setShowQuickAddPort(true);
                                                } else {
                                                    setFormData({ ...formData, destination: e.target.value });
                                                }
                                            }}
                                        >
                                            <option value="">Select Port...</option>
                                            <option value="_ADD_NEW_" className="font-bold text-blue-600 bg-blue-50">+ Add Port</option>
                                            {[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={`${p.name} (${p.code})`}>{p.name} ({p.code})</option>)}
                                        </select>
                                    </div>
                                </div>
                                {portAddedMessage && <div className="text-xs text-emerald-600 flex items-center gap-1 -mt-2 mb-2"><CheckCircle2 size={12} /> {portAddedMessage}</div>}

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">ETD</label>
                                        <input type="date" name="etd" value={formData.etd} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white rounded-lg px-3 py-2 text-sm" style={{ colorScheme: 'dark' }} />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">ETA</label>
                                        <input type="date" name="eta" value={formData.eta} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white rounded-lg px-3 py-2 text-sm" style={{ colorScheme: 'dark' }} />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                                    <select name="status" value={formData.status} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white rounded-lg px-3 py-2 text-sm">
                                        <option value="Booking">Booking</option>
                                        <option value="In Transit">In Transit</option>
                                        <option value="Customs Hold">Customs Hold</option>
                                        <option value="Released">Released</option>
                                        <option value="Delivered">Delivered</option>
                                    </select>
                                </div>

                                <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-2 mt-4">
                                    <Save size={18} /> {editingId ? 'Update Shipment' : 'Create Shipment'}
                                </button>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Shipments;
