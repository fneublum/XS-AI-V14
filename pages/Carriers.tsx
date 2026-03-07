
import React, { useState, useRef, useEffect } from 'react';
import { Carrier, Company } from '../types';
import { Search, Plus, X, Save, Pencil, Trash2, Ship, Globe, LayoutGrid, List, Phone, Mail, User, Hash, Filter, CheckCircle2, FilePlus } from 'lucide-react';

interface CarriersProps {
    carriers: Carrier[];
    onAdd: (c: Carrier) => void;
    onUpdate: (c: Carrier) => void;
    onDelete: (id: string) => void;
    currentCompanyId: string;
    availableCompanies: Company[];
    initialViewMode?: 'grid' | 'table';
}

// Helper to extract unique values for filtering
const getUniqueValues = (data: any[], key: string) => {
    const values = data.map(item => {
        const val = item[key];
        return val;
    }).filter(v => v !== undefined && v !== null && v !== '');
    return Array.from(new Set(values)).sort();
};

const Carriers: React.FC<CarriersProps> = ({ carriers, onAdd, onUpdate, onDelete, currentCompanyId, availableCompanies, initialViewMode = 'grid' }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'grid' | 'table'>(initialViewMode);

    // Filtering State
    const [activeFilterColumn, setActiveFilterColumn] = useState<string | null>(null);
    const [filters, setFilters] = useState<Record<string, string[]>>({});
    const [filterSearch, setFilterSearch] = useState('');
    const filterMenuRef = useRef<HTMLDivElement>(null);

    const initialFormState: Partial<Carrier> = {
        name: '',
        scac: '',
        code: '',
        country: '',
        contact: '',
        email: '',
        phone: '',
        companyId: 'ALL' // Default to global
    };

    const [formData, setFormData] = useState<Partial<Carrier>>(initialFormState);

    // Handle click outside to close filter menu
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (filterMenuRef.current && !filterMenuRef.current.contains(event.target as Node)) {
                setActiveFilterColumn(null);
                setFilterSearch('');
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const filteredCarriers = carriers.filter(c => {
        const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (c.scac && c.scac.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (c.code && c.code.toLowerCase().includes(searchTerm.toLowerCase()));

        if (!matchesSearch) return false;

        // Apply Column Filters
        for (const [key, selectedValues] of Object.entries(filters)) {
            const values = selectedValues as string[];
            if (values.length > 0) {
                let cellValue = (c as any)[key];
                cellValue = String(cellValue || '');
                if (!values.includes(cellValue)) return false;
            }
        }

        return true;
    });

    const toggleFilter = (column: string, value: string) => {
        setFilters(prev => {
            const current = prev[column] || [];
            if (current.includes(value)) {
                const updated = current.filter(v => v !== value);
                return updated.length === 0 ? { ...prev, [column]: [] } : { ...prev, [column]: updated };
            } else {
                return { ...prev, [column]: [...current, value] };
            }
        });
    };

    const clearColumnFilter = (column: string) => {
        setFilters(prev => {
            const next = { ...prev };
            delete next[column];
            return next;
        });
    };

    const handleAddNew = () => {
        setFormData(initialFormState);
        setEditingId(null);
        setIsAdding(true);
    };

    const handleEdit = (carrier: Carrier) => {
        setFormData(carrier);
        setEditingId(carrier.id);
        setIsAdding(true);
    };

    const handleDelete = (id: string) => {
        if (window.confirm('Delete this carrier?')) {
            onDelete(id);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name) return;

        const targetCompanyId = 'ALL'; // Always save to shared global scope

        if (editingId) {
            onUpdate({ ...formData, id: editingId, companyId: targetCompanyId } as Carrier);
        } else {
            const newCode = `CRR-${Math.floor(1000 + Math.random() * 9000)}`;
            const newCarrier: Carrier = {
                id: `CRR${Date.now()}`,
                code: newCode,
                companyId: targetCompanyId,
                name: formData.name!,
                scac: formData.scac,
                country: formData.country,
                contact: formData.contact,
                email: formData.email,
                phone: formData.phone
            };
            onAdd(newCarrier);
        }
        setIsAdding(false);
    };

    const renderColumnHeader = (id: keyof Carrier, label: string) => {
        const uniqueValues = getUniqueValues(carriers, id as string);
        const activeValues = filters[id as string] || [];
        const isFilterActive = activeValues.length > 0;

        return (
            <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase relative group">
                <div className="flex items-center justify-between">
                    <span>{label}</span>
                    <button
                        onClick={(e) => { e.stopPropagation(); setActiveFilterColumn(activeFilterColumn === id ? null : id as string); setFilterSearch(''); }}
                        className={`p-1 rounded hover:bg-slate-200 transition-colors ${isFilterActive ? 'text-blue-600 bg-blue-50' : 'text-slate-400 opacity-0 group-hover:opacity-100'}`}
                    >
                        <Filter size={14} fill={isFilterActive ? "currentColor" : "none"} />
                    </button>
                </div>

                {activeFilterColumn === id && (
                    <div ref={filterMenuRef} className="absolute top-full right-0 mt-1 w-64 bg-white rounded-lg shadow-xl border border-slate-200 z-50 overflow-hidden animate-in fade-in zoom-in-95 text-left font-sans normal-case">
                        <div className="p-2 border-b border-slate-100">
                            <div className="relative">
                                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    className="w-full pl-8 pr-2 py-1.5 text-xs border border-slate-200 rounded bg-slate-50 outline-none focus:ring-1 focus:ring-blue-500"
                                    placeholder="Search..."
                                    value={filterSearch}
                                    onChange={e => setFilterSearch(e.target.value)}
                                    autoFocus
                                />
                            </div>
                        </div>
                        <div className="max-h-48 overflow-y-auto p-1 custom-scrollbar">
                            <button
                                onClick={() => clearColumnFilter(id as string)}
                                className="w-full text-left px-2 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded flex items-center gap-2"
                            >
                                <X size={12} /> Clear Filter
                            </button>
                            {uniqueValues.filter(v => String(v).toLowerCase().includes(filterSearch.toLowerCase())).map(val => (
                                <button
                                    key={String(val)}
                                    onClick={() => toggleFilter(id as string, String(val))}
                                    className="w-full text-left px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded flex items-center gap-2"
                                >
                                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${activeValues.includes(String(val)) ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'}`}>
                                        {activeValues.includes(String(val)) && <CheckCircle2 size={10} className="text-white" />}
                                    </div>
                                    <span className="truncate">{String(val)}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </th>
        );
    };

    return (
        <div className="space-y-6">
            {/* Header Row */}
            <div className="mb-6 flex items-start justify-between">
                <div className="flex items-center gap-4">
                    <div className="p-2 bg-gradient-to-r from-cyan-500 to-teal-500 rounded-xl text-white">
                        <Ship size={24} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">Carriers</h1>
                        <p className="text-slate-500 text-sm">Manage shipping lines and SCAC codes (Shared Database).</p>
                    </div>
                </div>
                <button onClick={handleAddNew} className="flex items-center gap-2 px-5 py-2.5 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-all shadow-md font-medium">
                    <Plus size={18} />
                    Add Carrier
                </button>
            </div>

            {/* Search & View Toggle Row */}
            <div className="flex items-center gap-2 mb-4">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                        type="text"
                        placeholder="Search carriers..."
                        className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-cyan-500 outline-none"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="bg-white border border-slate-200 rounded-lg p-1 flex gap-1">
                    <button
                        onClick={() => setViewMode('grid')}
                        className={`p-2 rounded transition-all ${viewMode === 'grid' ? 'bg-slate-100 text-cyan-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        title="Grid View"
                    >
                        <LayoutGrid size={18} />
                    </button>
                    <button
                        onClick={() => setViewMode('table')}
                        className={`p-2 rounded transition-all ${viewMode === 'table' ? 'bg-slate-100 text-cyan-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        title="Table View"
                    >
                        <List size={18} />
                    </button>
                </div>
            </div>

            {viewMode === 'grid' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {filteredCarriers.map(carrier => (
                        <div key={carrier.id} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow group relative flex flex-col justify-between">
                            <div>
                                <div className="flex justify-between items-start mb-2">
                                    <div>
                                        <h3 className="font-bold text-slate-800 text-lg">{carrier.name}</h3>
                                        {carrier.code && <span className="text-xs font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded mr-2">{carrier.code}</span>}
                                    </div>
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => handleEdit(carrier)} className="text-slate-400 hover:text-amber-500"><Pencil size={16} /></button>
                                        <button onClick={() => handleDelete(carrier.id)} className="text-slate-400 hover:text-red-500"><Trash2 size={16} /></button>
                                    </div>
                                </div>
                                <div className="space-y-2 mb-3">
                                    {carrier.scac && <span className="text-xs font-mono font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded">SCAC: {carrier.scac}</span>}
                                    {carrier.country && <div className="flex items-center gap-2 text-sm text-slate-500 mt-1"><Globe size={12} /> {carrier.country}</div>}
                                </div>
                            </div>

                            {(carrier.contact || carrier.phone || carrier.email) && (
                                <div className="pt-3 border-t border-slate-100 text-xs text-slate-500 space-y-1">
                                    {carrier.contact && <div className="flex items-center gap-2"><User size={12} className="text-slate-400" /> {carrier.contact}</div>}
                                    {carrier.email && <div className="flex items-center gap-2 truncate"><Mail size={12} className="text-slate-400" /> {carrier.email}</div>}
                                    {carrier.phone && <div className="flex items-center gap-2"><Phone size={12} className="text-slate-400" /> {carrier.phone}</div>}
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
                                {renderColumnHeader('code', 'Code')}
                                {renderColumnHeader('name', 'Carrier Name')}
                                {renderColumnHeader('scac', 'SCAC')}
                                {renderColumnHeader('country', 'Country')}
                                {renderColumnHeader('contact', 'Contact')}
                                <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredCarriers.map(carrier => (
                                <tr key={carrier.id} className="hover:bg-slate-50 transition-colors group">
                                    <td className="px-3 py-2 text-sm font-mono text-slate-500">{carrier.code || '-'}</td>
                                    <td className="px-3 py-2 font-medium text-slate-800">{carrier.name}</td>
                                    <td className="px-3 py-2 text-sm font-mono text-slate-600">{carrier.scac || '-'}</td>
                                    <td className="px-3 py-2 text-sm text-slate-600">{carrier.country || '-'}</td>
                                    <td className="px-3 py-2 text-sm text-slate-600">
                                        <div className="flex flex-col">
                                            {carrier.contact && <span className="font-medium text-slate-700">{carrier.contact}</span>}
                                            {carrier.email && <span className="text-xs text-slate-400">{carrier.email}</span>}
                                        </div>
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <button onClick={() => handleEdit(carrier)} className="text-slate-400 hover:text-amber-500"><Pencil size={16} /></button>
                                            <button onClick={() => handleDelete(carrier.id)} className="text-slate-400 hover:text-red-500"><Trash2 size={16} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {filteredCarriers.length === 0 && !isAdding && (
                <div className="col-span-full py-12 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl">
                    <Ship size={48} className="mx-auto mb-2 opacity-20" />
                    <p>No carriers found.</p>
                </div>
            )}

            {isAdding && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center p-4 border-b border-slate-100">
                            <h3 className="font-bold text-slate-800">{editingId ? 'Edit Carrier' : 'Add Carrier'}</h3>
                            <button onClick={() => setIsAdding(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Carrier Name *</label>
                                <input required className="w-full border border-slate-300 rounded-lg p-2 text-sm" name="name" value={formData.name} onChange={handleInputChange} placeholder="e.g. Maersk" />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><Hash size={12} /> Code (Auto)</label>
                                    <input className="w-full border border-slate-200 bg-slate-50 text-slate-500 rounded-lg p-2 text-sm font-mono" name="code" value={formData.code || 'Auto-generated'} readOnly />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">SCAC Code</label>
                                    <input className="w-full border border-slate-300 rounded-lg p-2 text-sm uppercase font-mono" name="scac" value={formData.scac} onChange={e => setFormData({ ...formData, scac: e.target.value.toUpperCase() })} placeholder="MAEU" />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Country</label>
                                <input className="w-full border border-slate-300 rounded-lg p-2 text-sm" name="country" value={formData.country} onChange={handleInputChange} placeholder="e.g. Denmark" />
                            </div>

                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 space-y-3">
                                <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Contact Information</h4>
                                <div>
                                    <label className="block text-xs font-medium text-slate-700 mb-1">Contact Person</label>
                                    <input className="w-full border border-slate-300 rounded-lg p-2 text-sm" name="contact" value={formData.contact} onChange={handleInputChange} placeholder="Name" />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                                        <input type="email" className="w-full border border-slate-300 rounded-lg p-2 text-sm" name="email" value={formData.email} onChange={handleInputChange} placeholder="email@carrier.com" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
                                        <input className="w-full border border-slate-300 rounded-lg p-2 text-sm" name="phone" value={formData.phone} onChange={handleInputChange} placeholder="+1..." />
                                    </div>
                                </div>
                            </div>

                            <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 rounded-lg hover:bg-blue-700 mt-2">
                                {editingId ? 'Update Carrier' : 'Save Carrier'}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Carriers;
