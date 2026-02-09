
import React, { useState, useRef, useEffect } from 'react';
import { SavedLocation, Supplier, Customer, Company } from '../types';
import { Search, Plus, X, Save, Pencil, Trash2, MapPin, Building, Building2, LayoutGrid, List, Warehouse, Loader2, Wand2, CheckCircle2, User, Mail, Phone, Filter, Hash, AlertCircle, FilePlus } from 'lucide-react';
import { lookupLocation } from '../services/geminiService';

interface LocationsProps {
    locations: SavedLocation[];
    onAdd: (l: SavedLocation) => void;
    onUpdate: (l: SavedLocation) => void;
    onDelete: (id: string) => void;
    suppliers: Supplier[];
    customers: Customer[];
    onAddSupplier: (s: Supplier) => void;
    onAddCustomer: (c: Customer) => void;
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

const Locations: React.FC<LocationsProps> = ({
    locations, onAdd, onUpdate, onDelete,
    suppliers, customers, onAddSupplier, onAddCustomer,
    currentCompanyId, availableCompanies,
    initialViewMode = 'grid'
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [typeFilter, setTypeFilter] = useState<'ALL' | 'SUPPLIER' | 'CUSTOMER' | 'WAREHOUSE'>('ALL');
    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'grid' | 'table'>(initialViewMode);

    // AI Lookup State
    const [isLocationLoading, setIsLocationLoading] = useState(false);

    // Filtering State
    const [activeFilterColumn, setActiveFilterColumn] = useState<string | null>(null);
    const [filters, setFilters] = useState<Record<string, string[]>>({});
    const [filterSearch, setFilterSearch] = useState('');
    const filterMenuRef = useRef<HTMLDivElement>(null);

    // Quick Add State
    const [showQuickAddEntity, setShowQuickAddEntity] = useState(false);
    const [newEntityName, setNewEntityName] = useState('');
    const [entityAddedMessage, setEntityAddedMessage] = useState('');

    const initialFormState: Partial<SavedLocation> = {
        name: '',
        code: '',
        address: '',
        city: '',
        state: '',
        zip: '',
        country: '',
        entityType: 'SUPPLIER',
        entityId: '',
        entityName: '',
        contact: '',
        email: '',
        phone: '',
        companyId: currentCompanyId === 'ALL' && availableCompanies.length > 0 ? availableCompanies[0].id : currentCompanyId
    };

    const [formData, setFormData] = useState<Partial<SavedLocation>>(initialFormState);

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

    // Calculate counts for filter badges
    const counts = {
        ALL: locations.length,
        SUPPLIER: locations.filter(l => l.entityType === 'SUPPLIER').length,
        CUSTOMER: locations.filter(l => l.entityType === 'CUSTOMER').length,
        WAREHOUSE: locations.filter(l => l.entityType === 'WAREHOUSE').length
    };

    const filteredLocations = locations.filter(l => {
        // Safe access to properties with fallbacks
        const name = l.name || '';
        const entityName = l.entityName || '';
        const code = l.code || '';
        const city = l.city || '';

        const matchesSearch = name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            entityName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            code.toLowerCase().includes(searchTerm.toLowerCase()) ||
            city.toLowerCase().includes(searchTerm.toLowerCase());

        const matchesType = typeFilter === 'ALL' || l.entityType === typeFilter;

        if (!matchesSearch || !matchesType) return false;

        // Apply Column Filters
        for (const [key, selectedValues] of Object.entries(filters)) {
            const values = selectedValues as string[];
            if (values.length > 0) {
                let cellValue = (l as any)[key];
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
        setFormData({
            ...initialFormState,
            companyId: currentCompanyId === 'ALL' && availableCompanies.length > 0 ? availableCompanies[0].id : currentCompanyId
        });
        setEditingId(null);
        setIsAdding(true);
    };

    const handleEdit = (loc: SavedLocation) => {
        setFormData(loc);
        setEditingId(loc.id);
        setIsAdding(true);
    };

    const handleDelete = (id: string) => {
        if (window.confirm('Delete this location?')) {
            onDelete(id);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleEntityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const entityId = e.target.value;
        if (entityId === '_ADD_NEW_') {
            setShowQuickAddEntity(true);
            return;
        }

        if (!entityId) return;

        let entityName = '';
        if (formData.entityType === 'SUPPLIER') {
            const sup = suppliers.find(s => s.id === entityId);
            entityName = sup ? sup.name : '';
        } else if (formData.entityType === 'CUSTOMER') {
            const cust = customers.find(c => c.id === entityId);
            entityName = cust ? cust.name : '';
        } else if (formData.entityType === 'WAREHOUSE') {
            const comp = availableCompanies.find(c => c.id === entityId);
            entityName = comp ? comp.name : '';
        }

        setFormData(prev => ({
            ...prev,
            entityId,
            entityName
        }));
    };

    const handleZipBlur = async () => {
        if (!formData.zip || formData.zip.length < 5) return;
        setIsLocationLoading(true);
        try {
            const result = await lookupLocation(formData.zip, 'zip');
            if (result) {
                setFormData(prev => ({
                    ...prev,
                    city: result.city,
                    state: result.state,
                    country: 'USA' // Default assumption if result found via US Zip logic
                }));
            }
        } catch (e) {
            console.error("Lookup failed", e);
        } finally {
            setIsLocationLoading(false);
        }
    };

    const handleQuickAddEntity = async () => {
        if (!newEntityName.trim()) return;

        const companyIdForNewRecord = formData.companyId || (currentCompanyId !== 'ALL' ? currentCompanyId : availableCompanies[0]?.id);

        if (formData.entityType === 'SUPPLIER') {
            const newSupplier: Supplier = {
                id: `SUP${Date.now()}`,
                companyId: companyIdForNewRecord!,
                name: newEntityName,
                contactPerson: 'TBD',
                email: 'tbd@example.com',
                phone: '',
                country: 'Unknown',
                categories: [],
                rating: 3,
                paymentTerms: 'Net 30'
            };
            await onAddSupplier(newSupplier);
            setFormData(prev => ({ ...prev, entityId: newSupplier.id, entityName: newSupplier.name }));
        } else if (formData.entityType === 'CUSTOMER') {
            const newCustomer: Customer = {
                id: `C${Date.now()}`,
                companyId: companyIdForNewRecord!,
                name: newEntityName,
                nickname: '',
                contactPerson: 'TBD',
                email: 'tbd@example.com',
                phone: '',
                creditLimit: 0,
                paymentTerms: 'Net 30',
                status: 'Active',
                lastOrderDate: new Date().toISOString().split('T')[0],
                totalVolumeLBS: 0
            };
            await onAddCustomer(newCustomer);
            setFormData(prev => ({ ...prev, entityId: newCustomer.id, entityName: newCustomer.name }));
        }

        setNewEntityName('');
        setShowQuickAddEntity(false);
        setEntityAddedMessage(`${formData.entityType} Added!`);
        setTimeout(() => setEntityAddedMessage(''), 3000);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name || !formData.entityId) return;

        const targetCompanyId = formData.companyId || (currentCompanyId !== 'ALL' ? currentCompanyId : 'ALL');

        if (editingId) {
            onUpdate({ ...formData, id: editingId, companyId: targetCompanyId } as SavedLocation);
        } else {
            const newCode = `LOC-${Math.floor(1000 + Math.random() * 9000)}`;
            const newLocation: SavedLocation = {
                id: `LOC${Date.now()}`,
                code: newCode,
                companyId: targetCompanyId,
                name: formData.name!,
                address: formData.address || '',
                city: formData.city || '',
                state: formData.state || '',
                zip: formData.zip || '',
                country: formData.country || '',
                entityType: formData.entityType as 'SUPPLIER' | 'CUSTOMER' | 'WAREHOUSE',
                entityId: formData.entityId!,
                entityName: formData.entityName || '',
                contact: formData.contact,
                email: formData.email,
                phone: formData.phone
            };
            onAdd(newLocation);
        }
        setIsAdding(false);
    };

    const renderColumnHeader = (id: keyof SavedLocation, label: string) => {
        const uniqueValues = getUniqueValues(locations, id as string);
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
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <MapPin className="text-blue-600" /> Locations
                    </h2>
                    <p className="text-slate-500 text-sm">Manage pick-up and delivery addresses.</p>
                </div>
                <div className="flex gap-2 w-full md:w-auto">
                    <div className="relative flex-1 md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            type="text"
                            placeholder="Search locations..."
                            className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="bg-white border border-slate-200 rounded-lg p-1 flex gap-1">
                        <button
                            onClick={() => setViewMode('grid')}
                            className={`p-2 rounded transition-all ${viewMode === 'grid' ? 'bg-slate-100 text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            title="Grid View"
                        >
                            <LayoutGrid size={18} />
                        </button>
                        <button
                            onClick={() => setViewMode('table')}
                            className={`p-2 rounded transition-all ${viewMode === 'table' ? 'bg-slate-100 text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            title="Table View"
                        >
                            <List size={18} />
                        </button>
                    </div>
                    <button onClick={handleAddNew} className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm" title="Add Location">
                        <FilePlus size={20} />
                    </button>
                </div>
            </div>

            {/* Filter Buttons */}
            <div className="flex flex-wrap gap-2 pb-2">
                <button
                    onClick={() => setTypeFilter('ALL')}
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-all border flex items-center gap-2 ${typeFilter === 'ALL' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                >
                    All <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${typeFilter === 'ALL' ? 'bg-slate-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{counts.ALL}</span>
                </button>
                <button
                    onClick={() => setTypeFilter('SUPPLIER')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all border ${typeFilter === 'SUPPLIER' ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                >
                    <Building size={16} /> Suppliers
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${typeFilter === 'SUPPLIER' ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-500'}`}>{counts.SUPPLIER}</span>
                </button>
                <button
                    onClick={() => setTypeFilter('CUSTOMER')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all border ${typeFilter === 'CUSTOMER' ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                >
                    <Building2 size={16} /> Customers
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${typeFilter === 'CUSTOMER' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}>{counts.CUSTOMER}</span>
                </button>
                <button
                    onClick={() => setTypeFilter('WAREHOUSE')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all border ${typeFilter === 'WAREHOUSE' ? 'bg-amber-500 text-white border-amber-500 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                >
                    <Warehouse size={16} /> Warehouses
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${typeFilter === 'WAREHOUSE' ? 'bg-amber-400 text-white' : 'bg-slate-100 text-slate-500'}`}>{counts.WAREHOUSE}</span>
                </button>
            </div>

            {viewMode === 'grid' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredLocations.map(loc => (
                        <div key={loc.id} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow group relative flex flex-col justify-between">
                            <div>
                                <div className="flex justify-between items-start mb-2">
                                    <div>
                                        <h3 className="font-bold text-slate-800 text-lg">{loc.name}</h3>
                                        {loc.code && <span className="text-xs font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{loc.code}</span>}
                                    </div>
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => handleEdit(loc)} className="text-slate-400 hover:text-amber-500"><Pencil size={16} /></button>
                                        <button onClick={() => handleDelete(loc.id)} className="text-slate-400 hover:text-red-500"><Trash2 size={16} /></button>
                                    </div>
                                </div>
                                <div className="space-y-1 mb-3">
                                    <p className="text-sm text-slate-500">{loc.address}</p>
                                    <p className="text-sm text-slate-500">{loc.city}, {loc.state} {loc.zip}</p>
                                    <p className="text-sm text-slate-500 font-medium">{loc.country}</p>
                                </div>
                                {(loc.contact || loc.phone || loc.email) && (
                                    <div className="mb-3 pt-2 border-t border-slate-100 text-xs text-slate-500 space-y-1">
                                        {loc.contact && <div className="flex items-center gap-2"><User size={12} className="text-slate-400" /> {loc.contact}</div>}
                                        {loc.email && <div className="flex items-center gap-2 truncate"><Mail size={12} className="text-slate-400" /> {loc.email}</div>}
                                        {loc.phone && <div className="flex items-center gap-2"><Phone size={12} className="text-slate-400" /> {loc.phone}</div>}
                                    </div>
                                )}
                            </div>
                            <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
                                {loc.entityType === 'SUPPLIER' ? <Building size={14} className="text-indigo-400" /> :
                                    loc.entityType === 'CUSTOMER' ? <Building2 size={14} className="text-emerald-400" /> :
                                        <Warehouse size={14} className="text-amber-400" />}
                                <span className="text-xs font-bold text-slate-600">{loc.entityName}</span>
                                <span className={`text-[10px] px-2 py-0.5 rounded ml-auto ${loc.entityType === 'SUPPLIER' ? 'bg-indigo-50 text-indigo-700' :
                                    loc.entityType === 'CUSTOMER' ? 'bg-emerald-50 text-emerald-700' :
                                        'bg-amber-50 text-amber-700'
                                    }`}>
                                    {loc.entityType}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                {renderColumnHeader('code', 'Code')}
                                {renderColumnHeader('name', 'Name')}
                                <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Address</th>
                                {renderColumnHeader('entityName', 'Entity')}
                                {renderColumnHeader('contact', 'Contact')}
                                <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredLocations.map(loc => (
                                <tr key={loc.id} className="hover:bg-slate-50 transition-colors group">
                                    <td className="px-3 py-2 text-sm font-mono text-slate-500">{loc.code || '-'}</td>
                                    <td className="px-3 py-2 font-medium text-slate-800">{loc.name}</td>
                                    <td className="px-3 py-2 text-sm text-slate-600">
                                        {loc.address}, {loc.city}, {loc.country}
                                    </td>
                                    <td className="px-3 py-2 text-sm font-medium text-slate-700">
                                        {loc.entityName} <span className="text-[10px] text-slate-400">({loc.entityType})</span>
                                    </td>
                                    <td className="px-3 py-2 text-sm text-slate-600">
                                        <div className="flex flex-col">
                                            {loc.contact && <span className="font-medium text-slate-700">{loc.contact}</span>}
                                            {loc.email && <span className="text-xs text-slate-400">{loc.email}</span>}
                                        </div>
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <button onClick={() => handleEdit(loc)} className="text-slate-400 hover:text-amber-500"><Pencil size={16} /></button>
                                            <button onClick={() => handleDelete(loc.id)} className="text-slate-400 hover:text-red-500"><Trash2 size={16} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {filteredLocations.length === 0 && !isAdding && (
                <div className="col-span-full py-12 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl">
                    <MapPin size={48} className="mx-auto mb-2 opacity-20" />
                    <p>No locations found.</p>
                </div>
            )}

            {isAdding && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    {/* Quick Add Modal */}
                    {showQuickAddEntity && (
                        <div className="absolute inset-0 bg-white/90 z-20 flex items-center justify-center backdrop-blur-sm animate-in fade-in rounded-xl">
                            <div className="bg-white p-6 rounded-lg shadow-xl border border-slate-200 w-80 space-y-4">
                                <h4 className="font-bold text-lg flex items-center gap-2"><Plus size={20} /> New {formData.entityType}</h4>
                                <input
                                    type="text"
                                    value={newEntityName}
                                    onChange={(e) => setNewEntityName(e.target.value)}
                                    className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg px-3 py-2"
                                    placeholder="Enter Name"
                                    autoFocus
                                />
                                <div className="flex justify-end gap-2">
                                    <button type="button" onClick={() => setShowQuickAddEntity(false)} className="px-3 py-1.5 bg-slate-100 rounded text-sm hover:bg-slate-200">Cancel</button>
                                    <button type="button" onClick={handleQuickAddEntity} disabled={!newEntityName.trim()} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">Add</button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center p-6 border-b border-slate-100">
                            <h3 className="font-bold text-slate-800">{editingId ? 'Edit Location' : 'Add Location'}</h3>
                            <button onClick={() => setIsAdding(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 space-y-4">
                            {currentCompanyId === 'ALL' && (
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Company</label>
                                    <select
                                        className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                                        value={formData.companyId}
                                        onChange={handleInputChange}
                                        name="companyId"
                                    >
                                        {availableCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Location Name / Nickname</label>
                                    <input
                                        className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                                        value={formData.name}
                                        onChange={handleInputChange}
                                        name="name"
                                        placeholder="e.g. Houston Warehouse"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><Hash size={12} /> Code (Auto-generated)</label>
                                    <input
                                        className="w-full border border-slate-200 bg-slate-50 text-slate-500 rounded-lg p-2 text-sm font-mono"
                                        value={formData.code || 'Will be generated'}
                                        readOnly
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3 rounded-lg border border-slate-100">
                                <div className="col-span-2">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Linked Entity Type</label>
                                    <div className="flex bg-white rounded-lg p-1 border border-slate-200">
                                        <button
                                            type="button"
                                            onClick={() => setFormData(prev => ({ ...prev, entityType: 'SUPPLIER', entityId: '', entityName: '' }))}
                                            className={`flex-1 py-1.5 text-xs font-bold rounded ${formData.entityType === 'SUPPLIER' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                        >
                                            Supplier
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setFormData(prev => ({ ...prev, entityType: 'CUSTOMER', entityId: '', entityName: '' }))}
                                            className={`flex-1 py-1.5 text-xs font-bold rounded ${formData.entityType === 'CUSTOMER' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                        >
                                            Customer
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setFormData(prev => ({ ...prev, entityType: 'WAREHOUSE', entityId: '', entityName: '' }))}
                                            className={`flex-1 py-1.5 text-xs font-bold rounded ${formData.entityType === 'WAREHOUSE' ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                        >
                                            Warehouse
                                        </button>
                                    </div>
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Select {formData.entityType === 'SUPPLIER' ? 'Supplier' : formData.entityType === 'CUSTOMER' ? 'Customer' : 'Company'}</label>
                                    <select
                                        className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                                        value={formData.entityId}
                                        onChange={handleEntityChange}
                                        required
                                    >
                                        <option value="">-- Select Entity --</option>
                                        {formData.entityType !== 'WAREHOUSE' && <option value="_ADD_NEW_" className="font-bold text-blue-600">+ Add New {formData.entityType === 'SUPPLIER' ? 'Supplier' : 'Customer'}</option>}
                                        {formData.entityType === 'SUPPLIER'
                                            ? suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)
                                            : formData.entityType === 'CUSTOMER'
                                                ? customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)
                                                : availableCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)
                                        }
                                    </select>
                                    {entityAddedMessage && <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><CheckCircle2 size={10} /> {entityAddedMessage}</p>}
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Address</label>
                                <input
                                    className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                                    value={formData.address}
                                    onChange={handleInputChange}
                                    name="address"
                                    placeholder="123 Industrial Blvd"
                                />
                            </div>

                            {/* Zip First for AI Lookup */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="relative">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1">Zip/Postal <Wand2 size={10} className="text-amber-500" /></label>
                                    <div className="relative">
                                        <input
                                            className="w-full border border-slate-300 rounded-lg p-2 text-sm pr-8"
                                            value={formData.zip}
                                            onChange={handleInputChange}
                                            onBlur={handleZipBlur}
                                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleZipBlur())}
                                            name="zip"
                                            placeholder="Enter Zip..."
                                        />
                                        <button
                                            type="button"
                                            onClick={handleZipBlur}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-600"
                                            disabled={isLocationLoading}
                                        >
                                            {isLocationLoading ? <Loader2 className="animate-spin" size={14} /> : <Search size={14} />}
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Country</label>
                                    <input className="w-full border border-slate-300 rounded-lg p-2 text-sm" value={formData.country} onChange={handleInputChange} name="country" />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">City</label>
                                    <input className="w-full border border-slate-300 rounded-lg p-2 text-sm" value={formData.city} onChange={handleInputChange} name="city" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">State/Prov</label>
                                    <input className="w-full border border-slate-300 rounded-lg p-2 text-sm" value={formData.state} onChange={handleInputChange} name="state" />
                                </div>
                            </div>

                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 space-y-3">
                                <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Local Contact Info</h4>
                                <div>
                                    <label className="block text-xs font-medium text-slate-700 mb-1">Contact Person</label>
                                    <input className="w-full border border-slate-300 rounded-lg p-2 text-sm" name="contact" value={formData.contact} onChange={handleInputChange} placeholder="Name" />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                                        <input type="email" className="w-full border border-slate-300 rounded-lg p-2 text-sm" name="email" value={formData.email} onChange={handleInputChange} placeholder="email@location.com" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
                                        <input className="w-full border border-slate-300 rounded-lg p-2 text-sm" name="phone" value={formData.phone} onChange={handleInputChange} placeholder="+1..." />
                                    </div>
                                </div>
                            </div>

                            <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 rounded-lg hover:bg-blue-700 mt-2">
                                {editingId ? 'Update Location' : 'Save Location'}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Locations;
