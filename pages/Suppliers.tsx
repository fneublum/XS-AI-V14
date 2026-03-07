import React, { useState, useRef, useEffect } from 'react';
import { Supplier, Company, SupplierQuote, PurchaseOrder, SavedLocation } from '../types';
import { Search, Plus, X, Save, Pencil, Trash2, Building, Globe, Mail, Phone, Star, Tag, AlertCircle, LayoutGrid, List, MapPin, Filter, CheckCircle2, Hash, Eye, Truck } from 'lucide-react';
import { PAYMENT_TERM_OPTIONS } from '../constants';

interface SuppliersProps {
    suppliers: Supplier[];
    onAdd: (s: Supplier) => void;
    onUpdate: (s: Supplier) => void;
    onDelete: (id: string) => void;
    currentCompanyId: string;
    availableCompanies: Company[];
    dbError?: string | null;
    supplierQuotes?: SupplierQuote[];
    purchaseOrders?: PurchaseOrder[];
    initialViewMode?: 'grid' | 'table';
    locations?: SavedLocation[];
    onAddLocation?: (loc: SavedLocation) => void;
}

const STANDARD_CATEGORIES = ['Resin', 'Fiber Textile', 'Cotton Waste', 'Plastic Scrap', 'Logistics', 'Packaging', 'Machinery'];

// Helper to extract unique values for filtering
const getUniqueValues = (data: any[], key: string) => {
    const values = data.map(item => {
        const val = item[key];
        if (Array.isArray(val)) return val.join(', ');
        return val;
    }).filter(v => v !== undefined && v !== null && v !== '');
    return Array.from(new Set(values)).sort();
};

const Suppliers: React.FC<SuppliersProps> = ({ suppliers, onAdd, onUpdate, onDelete, currentCompanyId, availableCompanies, dbError, supplierQuotes = [], purchaseOrders = [], initialViewMode = 'table', locations = [], onAddLocation }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'grid' | 'table'>(initialViewMode);

    // Filtering State
    const [activeFilterColumn, setActiveFilterColumn] = useState<string | null>(null);
    const [filters, setFilters] = useState<Record<string, string[]>>({});
    const [filterSearch, setFilterSearch] = useState('');
    const filterMenuRef = useRef<HTMLDivElement>(null);

    // Pick Up State
    const [pickupSameAsAddress, setPickupSameAsAddress] = useState(true);

    const isSystemView = currentCompanyId === 'ALL';

    const initialFormState: Partial<Supplier> = {
        name: '',
        taxId: '',
        contactPerson: '',
        email: '',
        phone: '',
        location: '',
        city: '',
        state: '',
        zip: '',
        country: '',
        categories: [],
        rating: 3,
        paymentTerms: 'Net 30',
        pickupLocationId: '',
        companyId: currentCompanyId === 'ALL' && availableCompanies.length > 0 ? availableCompanies[0].id : currentCompanyId
    };

    const [formData, setFormData] = useState<Partial<Supplier>>(initialFormState);
    const [tempCategory, setTempCategory] = useState('');

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

    const filteredSuppliers = suppliers.filter(s => {
        const matchesSearch = s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            s.country.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (s.taxId && s.taxId.toLowerCase().includes(searchTerm.toLowerCase()));

        if (!matchesSearch) return false;

        // Apply Column Filters
        for (const [key, selectedValues] of Object.entries(filters)) {
            const values = selectedValues as string[];
            if (values.length > 0) {
                let cellValue = (s as any)[key];
                if (Array.isArray(cellValue)) cellValue = cellValue.join(', ');
                cellValue = String(cellValue || '');
                if (!values.includes(cellValue)) return false;
            }
        }
        return true;
    }).sort((a, b) => a.name.localeCompare(b.name));

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
            categories: [], // Ensure array is initialized
            companyId: currentCompanyId === 'ALL' && availableCompanies.length > 0 ? availableCompanies[0].id : currentCompanyId
        });
        setEditingId(null);
        setIsAdding(true);
        setTempCategory('');
    };

    const handleEdit = (supplier: Supplier, e: React.MouseEvent) => {
        e.stopPropagation();
        setFormData({
            ...supplier,
            categories: supplier.categories || [] // Ensure array is initialized if null from DB
        });
        setEditingId(supplier.id);
        setIsAdding(true);
        setTempCategory('');
    };

    const handleDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setDeleteError(null);

        const isUsedInQuote = supplierQuotes.some(quote => quote.supplierId === id);
        const isUsedInPO = purchaseOrders.some(po => po.supplierId === id);

        if (isUsedInQuote || isUsedInPO) {
            const reasons = [];
            if (isUsedInQuote) reasons.push('supplier quotes');
            if (isUsedInPO) reasons.push('purchase orders');
            const errorMessage = `Cannot delete supplier. It is currently linked to existing ${reasons.join(' and ')}.`;
            setDeleteError(errorMessage);
            setTimeout(() => setDeleteError(null), 6000);
            return;
        }

        if (window.confirm('Are you sure you want to delete this supplier? This action cannot be undone.')) {
            onDelete(id);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name) {
            alert("Supplier name is required.");
            return;
        }

        const supplierId = editingId || `SUP${Date.now()}`;
        let pickupLocId = formData.pickupLocationId || '';

        // Create pickup location if same as address
        if (pickupSameAsAddress && onAddLocation && formData.location) {
            const newLocation: SavedLocation = {
                id: `LOC${Date.now()}`,
                companyId: formData.companyId || currentCompanyId,
                code: `${formData.name?.substring(0, 3).toUpperCase()}-PU`,
                name: `${formData.name} - Pickup`,
                address: formData.location || '',
                city: formData.city || '',
                state: formData.state || '',
                zip: formData.zip || '',
                country: formData.country || '',
                entityType: 'SUPPLIER',
                entityId: supplierId,
                entityName: formData.name || '',
                contact: formData.contactPerson,
                email: formData.email,
                phone: formData.phone
            };
            await onAddLocation(newLocation);
            pickupLocId = newLocation.id;
        }

        const supplierData = {
            ...formData,
            categories: formData.categories || [],
            pickupLocationId: pickupLocId
        };

        if (editingId) {
            onUpdate({ ...supplierData, id: editingId } as Supplier);
        } else {
            const newSupplier: Supplier = {
                id: supplierId,
                companyId: formData.companyId || (currentCompanyId === 'ALL' ? (availableCompanies[0]?.id || 'ALL') : currentCompanyId),
                name: formData.name!,
                taxId: formData.taxId,
                contactPerson: formData.contactPerson!,
                email: formData.email!,
                phone: formData.phone!,
                location: formData.location,
                city: formData.city,
                state: formData.state,
                zip: formData.zip,
                country: formData.country!,
                categories: formData.categories!,
                rating: Number(formData.rating) || 3,
                paymentTerms: formData.paymentTerms!,
                pickupLocationId: pickupLocId
            };
            onAdd(newSupplier);
        }
        setIsAdding(false);
        setEditingId(null);
        setFormData(initialFormState);
        setPickupSameAsAddress(true);
    };

    const handleAddCategory = () => {
        if (tempCategory && !formData.categories?.includes(tempCategory)) {
            setFormData(prev => ({
                ...prev,
                categories: [...(prev.categories || []), tempCategory]
            }));
        }
    };

    const handleRemoveCategory = (cat: string) => {
        setFormData(prev => ({
            ...prev,
            categories: (prev.categories || []).filter(c => c !== cat)
        }));
    };
    // Get unique countries for stats
    const uniqueCountries = [...new Set(suppliers.map(s => s.country).filter(Boolean))].length;
    const avgRating = suppliers.length > 0 ? (suppliers.reduce((sum, s) => sum + (s.rating || 0), 0) / suppliers.length).toFixed(1) : '0';

    return (
        <div className="h-full bg-slate-100 flex flex-col overflow-hidden">
            {/* Header Row */}
            <div className="bg-white border-b border-slate-200 px-6 py-4 shrink-0">
                <div className="mb-6 flex items-start justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl text-white">
                            <Building size={24} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-800">Suppliers</h1>
                            <p className="text-sm text-slate-500">Vendor Management & Contact Directory</p>
                        </div>
                    </div>
                    <button onClick={handleAddNew} className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-all shadow-md font-medium">
                        <Plus size={18} />
                        Add Supplier
                    </button>
                </div>
                {/* Filter Bar */}
                <div className="flex items-center gap-4">
                    {/* Stats */}
                    <div className="flex gap-6 text-xs mr-4">
                        <div className="text-center">
                            <div className="text-2xl font-bold text-blue-600">{suppliers.length}</div>
                            <div className="text-slate-500">Total</div>
                        </div>
                        <div className="text-center">
                            <div className="text-2xl font-bold text-emerald-600">{uniqueCountries}</div>
                            <div className="text-slate-500">Countries</div>
                        </div>
                        <div className="text-center">
                            <div className="text-2xl font-bold text-amber-500">{avgRating}</div>
                            <div className="text-slate-500">Avg Rating</div>
                        </div>
                    </div>
                    <div className="flex-1" />
                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                            type="text"
                            placeholder="Search..."
                            className="pl-9 pr-4 py-2 w-48 border border-slate-300 bg-white rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    {/* View Toggle */}
                    <div className="bg-slate-100 rounded-lg p-1 flex gap-1">
                        <button
                            onClick={() => setViewMode('grid')}
                            className={`p-2 rounded transition-all ${viewMode === 'grid' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                            <LayoutGrid size={16} />
                        </button>
                        <button
                            onClick={() => setViewMode('table')}
                            className={`p-2 rounded transition-all ${viewMode === 'table' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                            <List size={16} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Error Banner */}
            {(deleteError || dbError) && (
                <div className="mx-4 mt-3 bg-red-50 text-red-600 p-3 rounded-xl flex items-start gap-3 border border-red-100">
                    <AlertCircle size={18} className="mt-0.5 shrink-0" />
                    <div>
                        <p className="font-bold text-sm">{deleteError ? "Action Blocked" : "Database Error"}</p>
                        <p className="text-xs mt-0.5 opacity-90">{deleteError || dbError}</p>
                    </div>
                </div>
            )}

            {/* Main Content */}
            <div className="flex-1 flex overflow-hidden p-4 gap-4">
                {/* Suppliers List Panel */}
                <div className={`${isAdding ? 'w-2/3' : 'w-full'} flex flex-col bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden transition-all`}>
                    <div className="px-4 py-3 bg-blue-50 border-b border-blue-200 flex items-center gap-2">
                        <Building size={18} className="text-blue-600" />
                        <span className="font-bold text-blue-800">SUPPLIER DIRECTORY</span>
                        <span className="ml-auto text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">
                            {filteredSuppliers.length} {filteredSuppliers.length === 1 ? 'supplier' : 'suppliers'}
                        </span>
                    </div>

                    {viewMode === 'grid' ? (
                        <div className="flex-1 overflow-auto p-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {filteredSuppliers.map(s => (
                                    <div key={s.id} className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 hover:shadow-lg hover:border-blue-300 transition-all group relative">
                                        <div className="flex justify-between items-start mb-2">
                                            <h3 className="font-bold text-slate-800 text-lg">{s.name}</h3>
                                            <div className="flex gap-1">
                                                <button onClick={(e) => handleEdit(s, e)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="View Supplier">
                                                    <Eye size={16} />
                                                </button>
                                                {!isSystemView && <button onClick={(e) => handleEdit(s, e)} className="p-1.5 text-slate-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors" title="Edit Supplier"><Pencil size={16} /></button>}
                                                {!isSystemView && <button onClick={(e) => handleDelete(s.id, e)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Delete Supplier"><Trash2 size={16} /></button>}
                                            </div>
                                        </div>
                                        <div className="space-y-1 text-sm text-slate-600 mb-3">
                                            <div className="flex items-center gap-2"><Globe size={14} className="text-slate-400" /> {s.country}</div>
                                            <div className="flex items-center gap-2"><Mail size={14} className="text-slate-400" /> {s.email}</div>
                                            <div className="flex items-center gap-2"><Phone size={14} className="text-slate-400" /> {s.phone}</div>
                                            {s.taxId && <div className="flex items-center gap-2"><Hash size={14} className="text-slate-400" /> {s.taxId}</div>}
                                        </div>
                                        <div className="flex flex-wrap gap-1 mb-3">
                                            {(s.categories || []).map(cat => <span key={cat} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{cat}</span>)}
                                        </div>
                                        <div className="pt-2 border-t border-slate-100 flex justify-between items-center text-xs">
                                            <div className="flex items-center gap-0.5 text-amber-500">
                                                {[...Array(5)].map((_, i) => <Star key={i} size={14} fill={i < s.rating ? 'currentColor' : 'none'} />)}
                                            </div>
                                            <span className="text-slate-500">{s.paymentTerms}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 overflow-auto">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                                    <tr>
                                        <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase relative">
                                            <div className="flex items-center gap-2">
                                                Supplier
                                                <button
                                                    onClick={() => setActiveFilterColumn(activeFilterColumn === 'name' ? null : 'name')}
                                                    className={`p-1 rounded hover:bg-slate-200 transition-colors ${activeFilterColumn === 'name' ? 'bg-blue-100 text-blue-600' : 'text-slate-400'}`}
                                                >
                                                    <Filter size={14} />
                                                </button>
                                                {/* Filter Dropdown */}
                                                {activeFilterColumn === 'name' && (
                                                    <div ref={filterMenuRef} className="absolute top-full left-0 mt-1 w-64 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden animate-in fade-in zoom-in-95">
                                                        <div className="p-2 border-b border-slate-100 bg-slate-50">
                                                            <div className="relative">
                                                                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                                                <input
                                                                    autoFocus
                                                                    className="w-full pl-8 pr-2 py-1.5 text-xs border border-slate-200 rounded-lg outline-none focus:border-blue-500 transition-all"
                                                                    placeholder="Search values..."
                                                                    value={filterSearch}
                                                                    onChange={e => setFilterSearch(e.target.value)}
                                                                />
                                                            </div>
                                                        </div>
                                                        <div className="max-h-60 overflow-y-auto custom-scrollbar p-1">
                                                            {getUniqueValues(suppliers, 'name')
                                                                .filter(val => String(val).toLowerCase().includes(filterSearch.toLowerCase()))
                                                                .map(val => (
                                                                    <label key={val} className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 rounded cursor-pointer text-xs">
                                                                        <input
                                                                            type="checkbox"
                                                                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                                            checked={(filters['name'] || []).includes(String(val))}
                                                                            onChange={() => toggleFilter('name', String(val))}
                                                                        />
                                                                        <span className="text-slate-700 truncate">{val}</span>
                                                                    </label>
                                                                ))}
                                                            {getUniqueValues(suppliers, 'name').filter(val => String(val).toLowerCase().includes(filterSearch.toLowerCase())).length === 0 && (
                                                                <div className="p-2 text-xs text-slate-400 text-center italic">No matches found</div>
                                                            )}
                                                        </div>
                                                        <div className="p-2 border-t border-slate-100 bg-slate-50 flex justify-end">
                                                            <button
                                                                onClick={() => clearColumnFilter('name')}
                                                                className="text-[10px] text-red-500 hover:text-red-700 font-medium px-2 py-1 hover:bg-red-50 rounded"
                                                            >
                                                                Clear Filter
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </th>
                                        <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Contact</th>
                                        <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Email</th>
                                        <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Country</th>
                                        <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Categories</th>
                                        <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase">Rating</th>
                                        <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {filteredSuppliers.map(s => (
                                        <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-3 py-1.5">
                                                <span className="font-medium text-slate-800 text-sm">{s.name}</span>
                                            </td>
                                            <td className="px-3 py-1.5 text-sm text-slate-600">{s.contactPerson}</td>
                                            <td className="px-3 py-1.5 text-sm text-slate-500">{s.email}</td>
                                            <td className="px-3 py-1.5 text-sm text-slate-500">{s.country}</td>
                                            <td className="px-3 py-1.5">
                                                <div className="flex flex-wrap gap-1">
                                                    {(s.categories || []).slice(0, 2).map(cat => <span key={cat} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{cat}</span>)}
                                                    {(s.categories || []).length > 2 && <span className="text-[10px] text-slate-400">+{s.categories.length - 2}</span>}
                                                </div>
                                            </td>
                                            <td className="px-3 py-1.5">
                                                <div className="flex items-center text-amber-500">{[...Array(5)].map((_, i) => <Star key={i} size={12} fill={i < s.rating ? 'currentColor' : 'none'} />)}</div>
                                            </td>
                                            <td className="px-3 py-1.5 text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    <button onClick={(e) => handleEdit(s, e)} className="p-1 text-slate-400 hover:text-blue-600 rounded transition-colors" title="Edit"><Pencil size={14} /></button>
                                                    {!isSystemView && <button onClick={(e) => handleDelete(s.id, e)} className="p-1 text-slate-400 hover:text-red-500 rounded transition-colors" title="Delete"><Trash2 size={14} /></button>}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Modal Popup for Add/Edit */}
                {isAdding && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
                            <div className="sticky top-0 bg-white px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                                <h3 className="font-bold text-lg text-slate-800">{editingId ? 'Edit Supplier' : 'New Supplier'}</h3>
                                <button onClick={() => { setIsAdding(false); setPickupSameAsAddress(true); }} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                                    <X size={20} className="text-slate-400" />
                                </button>
                            </div>
                            <form onSubmit={handleSubmit} className="p-6 space-y-4">
                                {currentCompanyId === 'ALL' && (<div className="p-3 bg-blue-50 rounded-lg border border-blue-100"><label className="block text-xs font-bold text-blue-800 uppercase mb-1">Company</label><select required name="companyId" value={formData.companyId} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white rounded p-2 text-sm"><option value="">Select Company...</option>{[...availableCompanies].sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>)}

                                {/* Basic Info */}
                                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Supplier Name *</label><input required name="name" value={formData.name || ''} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white rounded p-2 text-sm" placeholder="Company name" /></div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tax ID / VAT</label><input name="taxId" value={formData.taxId || ''} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white rounded p-2 text-sm" placeholder="Tax identification" /></div>
                                    <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Contact Person</label><input name="contactPerson" value={formData.contactPerson || ''} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white rounded p-2 text-sm" placeholder="Primary contact" /></div>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email</label><input type="email" name="email" value={formData.email || ''} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white rounded p-2 text-sm" placeholder="email@company.com" /></div>
                                    <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Phone</label><input name="phone" value={formData.phone || ''} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white rounded p-2 text-sm" placeholder="+1 (555) 123-4567" /></div>
                                </div>

                                {/* Address Section */}
                                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                                    <label className="block text-xs font-bold text-slate-600 uppercase mb-2">📍 Address</label>
                                    <div className="space-y-3">
                                        <div><label className="block text-xs text-slate-500 mb-1">Street Address / Location</label><input name="location" value={formData.location || ''} onChange={handleInputChange} className="w-full border border-slate-300 rounded p-2 text-sm" placeholder="123 Main Street, Suite 100" /></div>
                                        <div className="grid grid-cols-3 gap-2">
                                            <div><label className="block text-xs text-slate-500 mb-1">City</label><input name="city" value={formData.city || ''} onChange={handleInputChange} className="w-full border border-slate-300 rounded p-2 text-sm" placeholder="City" /></div>
                                            <div><label className="block text-xs text-slate-500 mb-1">State</label><input name="state" value={formData.state || ''} onChange={handleInputChange} className="w-full border border-slate-300 rounded p-2 text-sm" placeholder="State" /></div>
                                            <div><label className="block text-xs text-slate-500 mb-1">Zip</label><input name="zip" value={formData.zip || ''} onChange={handleInputChange} className="w-full border border-slate-300 rounded p-2 text-sm" placeholder="12345" /></div>
                                        </div>
                                        <div><label className="block text-xs text-slate-500 mb-1">Country</label><input name="country" value={formData.country || ''} onChange={handleInputChange} className="w-full border border-slate-300 rounded p-2 text-sm" placeholder="USA" /></div>
                                    </div>
                                </div>

                                {/* Pick Up */}
                                <div className="bg-amber-50 p-3 rounded-lg border border-amber-200">
                                    <label className="block text-xs font-bold text-amber-700 uppercase mb-2"><Truck size={14} className="inline mr-1" />Pick Up</label>
                                    <div className="space-y-3">
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={pickupSameAsAddress}
                                                onChange={(e) => setPickupSameAsAddress(e.target.checked)}
                                                className="w-4 h-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                                            />
                                            <span className="text-sm text-amber-800">Same as supplier address</span>
                                        </label>

                                        {!pickupSameAsAddress && (
                                            <div>
                                                <label className="block text-xs text-slate-500 mb-1">Select Pick Up</label>
                                                <select
                                                    name="pickupLocationId"
                                                    value={formData.pickupLocationId || ''}
                                                    onChange={handleInputChange}
                                                    className="w-full border border-slate-300 rounded p-2 text-sm bg-white"
                                                >
                                                    <option value="">-- Select or create new --</option>
                                                    {locations.filter(loc => loc.entityType === 'SUPPLIER').map(loc => (
                                                        <option key={loc.id} value={loc.id}>
                                                            {loc.name} - {loc.city}, {loc.country}
                                                        </option>
                                                    ))}
                                                </select>
                                                <p className="text-xs text-slate-400 mt-1">If left empty, a new location will be created from supplier address.</p>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Categories */}
                                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Categories</label>
                                    <div className="flex flex-wrap gap-2 mb-2">
                                        {(formData.categories || []).map(cat => <div key={cat} className="flex items-center gap-1 bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded-full">{cat} <button type="button" onClick={() => handleRemoveCategory(cat)}><X size={12} /></button></div>)}
                                    </div>
                                    <div className="flex gap-2"><input className="w-full border border-slate-300 rounded p-1.5 text-sm" list="std-categories" value={tempCategory} onChange={e => setTempCategory(e.target.value)} placeholder="Add category..." /><button type="button" onClick={handleAddCategory} className="bg-slate-200 text-slate-700 px-3 rounded text-sm hover:bg-slate-300">Add</button></div>
                                    <datalist id="std-categories">{STANDARD_CATEGORIES.map(cat => <option key={cat} value={cat} />)}</datalist>
                                </div>

                                {/* Payment & Rating */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Payment Terms</label><select name="paymentTerms" value={formData.paymentTerms} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white rounded p-2 text-sm">{PAYMENT_TERM_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}</select></div>
                                    <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Rating (1-5)</label><input type="number" name="rating" min="1" max="5" value={formData.rating} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white rounded p-2 text-sm" /></div>
                                </div>

                                <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2.5 rounded-lg hover:bg-blue-700 mt-2 flex items-center justify-center gap-2"><Save size={16} /> {editingId ? 'Update Supplier' : 'Save Supplier'}</button>
                            </form>
                        </div>
                    </div>
                )
                }
            </div >
        </div >
    );
};
export default Suppliers;