
import React, { useState, useRef, useEffect } from 'react';
import { Customer, Company, Port, User } from '../types';
import { Search, Plus, Building2, Phone, Mail, CreditCard, X, Save, AlertCircle, Pencil, Trash2, Eye, Calendar, TrendingUp, LayoutGrid, List, MapPin, Filter, CheckCircle2, Hash, Anchor, FilePlus } from 'lucide-react';
import { PAYMENT_TERM_OPTIONS } from '../constants';
import { FormattedInput } from '../components/UnitInputs';

interface CustomersProps {
    customers: Customer[];
    onAdd: (c: Customer) => void;
    onUpdate: (c: Customer) => void;
    onDelete: (id: string) => void;
    currentCompanyId: string;
    availableCompanies: Company[];
    initialViewMode?: 'grid' | 'table';
    ports: Port[];
    onAddPort: (p: Port) => void;
    users?: User[];
    currentUser?: User;
}

// Helper to extract unique values for filtering
const getUniqueValues = (data: any[], key: string) => {
    const values = data.map(item => {
        const val = item[key];
        return val;
    }).filter(v => v !== undefined && v !== null && v !== '');
    return Array.from(new Set(values)).sort();
};

const Customers: React.FC<CustomersProps> = ({ customers, onAdd, onUpdate, onDelete, currentCompanyId, availableCompanies, initialViewMode = 'table', ports, onAddPort, users = [], currentUser }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [viewingCustomer, setViewingCustomer] = useState<Customer | null>(null);
    const [viewMode, setViewMode] = useState<'grid' | 'table'>(initialViewMode);

    // Filtering State
    const [activeFilterColumn, setActiveFilterColumn] = useState<string | null>(null);
    const [filters, setFilters] = useState<Record<string, string[]>>({});
    const [filterSearch, setFilterSearch] = useState('');
    const filterMenuRef = useRef<HTMLDivElement>(null);

    // Quick Add Port State
    const [showQuickAddPort, setShowQuickAddPort] = useState(false);
    const [newPortCode, setNewPortCode] = useState('');
    const [newPortName, setNewPortName] = useState('');
    const [newPortCountry, setNewPortCountry] = useState('');
    const [portAddedMessage, setPortAddedMessage] = useState('');

    const isSystemView = currentCompanyId === 'ALL';

    const initialFormState: Partial<Customer> = {
        name: '',
        nickname: '',
        taxId: '',
        contactPerson: '',
        email: '',
        email2: '',
        phone: '',
        location: '',
        city: '',
        state: '',
        zip: '',
        country: '',
        pod: '',
        creditLimit: 0,
        paymentTerms: 'Net 30',
        status: 'Active',
        totalVolumeLBS: 0,
        lastOrderDate: new Date().toISOString().split('T')[0],
        companyId: currentCompanyId === 'ALL' && availableCompanies.length > 0 ? availableCompanies[0].id : currentCompanyId
    };

    const [formData, setFormData] = useState<Partial<Customer>>(initialFormState);

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

    const filteredCustomers = customers.filter(c => {
        // Safe access with fallback to empty string
        const cName = c.name || '';
        const cNickname = c.nickname || '';
        const cContact = c.contactPerson || '';
        const cEmail = c.email || '';
        const cTax = c.taxId || '';
        const cPod = c.pod || '';

        const matchesSearch = cName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            cNickname.toLowerCase().includes(searchTerm.toLowerCase()) ||
            cContact.toLowerCase().includes(searchTerm.toLowerCase()) ||
            cEmail.toLowerCase().includes(searchTerm.toLowerCase()) ||
            cTax.toLowerCase().includes(searchTerm.toLowerCase()) ||
            cPod.toLowerCase().includes(searchTerm.toLowerCase());

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

    // Helper to format full address for display
    const formatAddress = (c: Customer) => {
        const parts = [c.location, c.city, c.state, c.zip, c.country].filter(Boolean);
        return parts.join(', ');
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: name === 'creditLimit' ? Number(value) : value
        }));
    };

    const handleAddNew = () => {
        setFormData({
            ...initialFormState,
            companyId: currentCompanyId === 'ALL' && availableCompanies.length > 0 ? availableCompanies[0].id : currentCompanyId,
            ...(currentUser && currentUser.role === 'Sales' ? { sales_person_id: currentUser.id, sales_person_name: currentUser.name } : {})
        });
        setEditingId(null);
        setIsAdding(true);
    };

    const handleEdit = (customer: Customer, e: React.MouseEvent) => {
        e.stopPropagation();
        setFormData(customer);
        setEditingId(customer.id);
        setIsAdding(true);
    };

    const handleDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        onDelete(id);
        if (editingId === id) {
            setIsAdding(false);
            setEditingId(null);
        }
    };

    const handleQuickAddPort = async () => {
        if (!newPortCode || !newPortName) return;

        // Ports are typically global ('ALL') or system wide
        const companyIdForNewRecord = 'ALL';

        const newPort = {
            id: `P${Date.now()}`,
            companyId: companyIdForNewRecord,
            code: newPortCode.toUpperCase(),
            name: newPortName,
            country: newPortCountry
        };

        await onAddPort(newPort as any);

        setFormData(prev => ({ ...prev, pod: `${newPort.name} (${newPort.code})` }));

        setNewPortCode('');
        setNewPortName('');
        setNewPortCountry('');
        setShowQuickAddPort(false);
        setPortAddedMessage('Port added!');
        setTimeout(() => setPortAddedMessage(''), 3000);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name || !formData.email) return;

        if (editingId) {
            onUpdate({ ...formData, id: editingId } as Customer);
        } else {
            const customerToAdd = {
                id: `C${Date.now()}`,
                companyId: formData.companyId || currentCompanyId,
                name: formData.name || '',
                nickname: formData.nickname || '',
                taxId: formData.taxId,
                contactPerson: formData.contactPerson || '',
                email: formData.email || '',
                email2: formData.email2 || '',
                phone: formData.phone || '',
                location: formData.location || '',
                city: formData.city || '',
                state: formData.state || '',
                zip: formData.zip || '',
                country: formData.country || '',
                pod: formData.pod || '',
                creditLimit: formData.creditLimit || 0,
                paymentTerms: formData.paymentTerms || 'Net 30',
                status: (formData.status as 'Active' | 'Inactive' | 'At Risk') || 'Active',
                lastOrderDate: formData.lastOrderDate || new Date().toISOString().split('T')[0],
                totalVolumeLBS: 0,
                brokerName: formData.brokerName || '',
                brokerEmail: formData.brokerEmail || '',
                sales_person_id: formData.sales_person_id || '',
                sales_person_name: formData.sales_person_name || ''
            };
            onAdd(customerToAdd);
        }

        setIsAdding(false);
        setEditingId(null);
    };

    const renderColumnHeader = (id: keyof Customer, label: string) => {
        const uniqueValues = getUniqueValues(customers, id as string);
        const activeValues = filters[id as string] || [];
        const isFilterActive = activeValues.length > 0;

        return (
            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase relative group">
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

    const totalCustomers = customers.length;
    const activeCustomers = customers.filter(c => c.status === 'Active').length;
    const totalVolume = customers.reduce((sum, c) => sum + (c.totalVolumeLBS || 0), 0);
    const avgCreditLimit = totalCustomers > 0 ? customers.reduce((sum, c) => sum + (c.creditLimit || 0), 0) / totalCustomers : 0;

    return (
        <div className="h-full bg-slate-100 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 px-6 py-4 shrink-0">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
                            <div className="p-2 bg-gradient-to-r from-emerald-500 to-teal-600 rounded-xl text-white">
                                <Building2 size={24} />
                            </div>
                            CUSTOMERS
                        </h1>
                        <p className="text-slate-500 text-sm mt-1">Client Management • Profiles</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={handleAddNew} className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-all shadow-md font-medium">
                            <Plus size={18} /> Add Customer
                        </button>
                    </div>
                </div>
                {/* Filter Bar: Stats, Search, View Toggle */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-6 text-xs">
                        <div className="flex items-center gap-2 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100">
                            <span className="text-blue-600 font-bold text-lg">{totalCustomers}</span>
                            <span className="text-slate-500">Total</span>
                        </div>
                        <div className="flex items-center gap-2 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-100">
                            <span className="text-emerald-600 font-bold text-lg">{activeCustomers}</span>
                            <span className="text-slate-500">Active</span>
                        </div>
                        <div className="flex items-center gap-2 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-100">
                            <span className="text-amber-500 font-bold text-lg">{(totalVolume / 1000).toFixed(0)}k</span>
                            <span className="text-slate-500">Vol LBS</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {/* Search */}
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                            <input
                                type="text"
                                placeholder="Search..."
                                className="pl-9 pr-4 py-2 w-48 border border-slate-300 bg-white rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        {/* View Toggle */}
                        <div className="bg-slate-100 rounded-lg p-1 flex gap-1">
                            <button
                                onClick={() => setViewMode('grid')}
                                className={`p-2 rounded transition-all ${viewMode === 'grid' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                <LayoutGrid size={16} />
                            </button>
                            <button
                                onClick={() => setViewMode('table')}
                                className={`p-2 rounded transition-all ${viewMode === 'table' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                <List size={16} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex overflow-hidden p-4 gap-4">
                <div className="w-full flex flex-col bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden transition-all">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                        <Building2 size={16} className="text-slate-500" />
                        <span className="font-bold text-slate-700 text-sm">CUSTOMER DIRECTORY</span>
                        <span className="ml-auto text-xs text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">
                            {filteredCustomers.length} records
                        </span>
                    </div>

                    {viewMode === 'grid' ? (
                        <div className="flex-1 overflow-auto p-4 custom-scrollbar">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {filteredCustomers.map(customer => (
                                    <div key={customer.id} onClick={() => setViewingCustomer(customer)} className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-all cursor-pointer group hover:border-blue-300">
                                        <div className="flex justify-between items-start mb-3">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600 font-bold text-sm border border-emerald-100">
                                                    {customer.name.substring(0, 2).toUpperCase()}
                                                </div>
                                                <div>
                                                    <h3 className="font-bold text-slate-800 text-sm" title={customer.name}>{customer.name}</h3>
                                                    <p className="text-xs text-slate-500">{customer.contactPerson}</p>
                                                </div>
                                            </div>
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${customer.status === 'Active' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                                                customer.status === 'At Risk' ? 'bg-red-50 text-red-700 border-red-100' : 'bg-slate-50 text-slate-600 border-slate-100'
                                                }`}>{customer.status}</span>
                                        </div>

                                        <div className="space-y-1.5 mb-3">
                                            {(customer.location || customer.city) && (
                                                <p className="text-xs text-slate-500 flex items-center gap-1.5 truncate">
                                                    <MapPin size={12} className="text-slate-400 shrink-0" />
                                                    <span className="truncate">{formatAddress(customer)}</span>
                                                </p>
                                            )}
                                            {customer.pod && <p className="text-xs text-blue-600 flex items-center gap-1.5 bg-blue-50 px-2 py-1 rounded w-fit"><Anchor size={12} /> {customer.pod}</p>}
                                        </div>

                                        <div className="grid grid-cols-2 gap-2 text-xs mb-3 pt-2 border-t border-slate-50">
                                            <div>
                                                <p className="text-slate-400 text-[10px] uppercase">Limit</p>
                                                <p className="font-bold text-slate-700">${customer.creditLimit.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-slate-400 text-[10px] uppercase">Volume</p>
                                                <p className="font-bold text-slate-700">{customer.totalVolumeLBS.toLocaleString()}</p>
                                            </div>
                                        </div>

                                        <div className="flex justify-between items-center text-xs text-slate-400 pt-2 border-t border-slate-100">
                                            <span className="font-medium bg-slate-100 px-2 py-0.5 rounded text-slate-600">{customer.paymentTerms}</span>
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button onClick={(e) => handleEdit(customer, e)} className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-amber-500"><Pencil size={14} /></button>
                                                <button onClick={(e) => handleDelete(customer.id, e)} className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 overflow-auto custom-scrollbar">
                            <table className="w-full text-left border-collapse text-xs">
                                <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                                    <tr>
                                        {renderColumnHeader('name', 'Customer')}
                                        {renderColumnHeader('contactPerson', 'Contact')}
                                        <th className="px-2 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">Phone</th>
                                        <th className="px-2 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">Email</th>
                                        <th className="px-2 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">Location</th>
                                        <th className="px-2 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">POD</th>
                                        <th className="px-2 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">Broker</th>
                                        <th className="px-2 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">Terms</th>
                                        {renderColumnHeader('status', 'Status')}
                                        <th className="px-2 py-1.5 text-[10px] font-semibold text-slate-500 uppercase text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {[...filteredCustomers].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map((customer) => (
                                        <tr key={customer.id} className="hover:bg-slate-50 transition-colors group border-l-2 border-l-transparent hover:border-l-blue-500">
                                            <td className="px-2 py-1">
                                                <div className="flex items-center gap-1">
                                                    <span className="font-bold text-slate-800" title={customer.name}>{customer.name}</span>
                                                    {customer.nickname && <span className="text-[9px] bg-slate-100 text-slate-500 px-1 py-0 rounded">{customer.nickname}</span>}
                                                </div>
                                            </td>
                                            <td className="px-2 py-1 text-slate-700 truncate max-w-[100px]">{customer.contactPerson}</td>
                                            <td className="px-2 py-1 text-slate-500 text-xs">{customer.phone || '-'}</td>
                                            <td className="px-2 py-1 text-slate-500 truncate max-w-[140px]">{customer.email}</td>
                                            <td className="px-2 py-1 text-slate-500 truncate max-w-[100px]" title={formatAddress(customer)}>{customer.city}{customer.country ? `, ${customer.country}` : ''}</td>
                                            <td className="px-2 py-1 text-blue-600 truncate max-w-[100px]">{customer.pod || '-'}</td>
                                            <td className="px-2 py-1 text-slate-600 truncate max-w-[80px]">{customer.brokerName ? customer.brokerName.split(' ')[0] : '-'}</td>
                                            <td className="px-2 py-1 text-slate-500">{customer.paymentTerms}</td>
                                            <td className="px-2 py-1">
                                                <span className={`inline-flex items-center px-1.5 py-0 rounded text-[9px] font-bold uppercase ${customer.status === 'Active' ? 'bg-emerald-50 text-emerald-700' :
                                                    customer.status === 'At Risk' ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-600'
                                                    }`}>{customer.status}</span>
                                            </td>
                                            <td className="px-2 py-1 text-right">
                                                <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                                                    <button type="button" onClick={(e) => { e.stopPropagation(); setViewingCustomer(customer); }} title="View Details" className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"><Eye size={14} /></button>
                                                    <button type="button" onClick={(e) => handleEdit(customer, e)} title="Edit" className="p-1 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"><Pencil size={14} /></button>
                                                    <button type="button" onClick={(e) => handleDelete(customer.id, e)} title="Delete" className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 size={14} /></button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
                {filteredCustomers.length === 0 && (
                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-slate-400 flex flex-col items-center pointer-events-none">
                        <Building2 size={48} className="mb-3 text-slate-200" />
                        <p className="font-medium">No customers found</p>
                    </div>
                )}
            </div>

            {/* Add/Edit Modal */}
            {isAdding && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    {showQuickAddPort && (
                        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                            <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full overflow-hidden animate-in zoom-in-95 duration-200">
                                <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50">
                                    <h3 className="font-bold text-slate-800 flex items-center gap-2"><Anchor size={20} /> Quick Add Port</h3>
                                    <button type="button" onClick={() => setShowQuickAddPort(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                                </div>
                                <div className="p-6 space-y-4">
                                    <div>
                                        <input
                                            className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm uppercase font-mono mb-2"
                                            placeholder="Code (3-5 Letters)"
                                            maxLength={5}
                                            value={newPortCode}
                                            onChange={e => setNewPortCode(e.target.value.toUpperCase())}
                                            autoFocus
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
                                        <button type="button" onClick={handleQuickAddPort} disabled={!newPortCode || !newPortName} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">Add & Select</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center p-6 border-b border-slate-100">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                {editingId ? <Pencil size={16} /> : <Plus size={16} />}
                                {editingId ? 'Edit Customer' : 'Add New Customer'}
                            </h3>
                            <button onClick={() => { setIsAdding(false); setEditingId(null); }} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 space-y-4">
                            {currentCompanyId === 'ALL' && (
                                <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                                    <label className="block text-xs font-bold text-blue-800 uppercase mb-1">Assign to Company</label>
                                    <select required name="companyId" value={formData.companyId} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500">
                                        {[...availableCompanies].sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                </div>
                            )}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Company Name *</label>
                                    <input required name="name" value={formData.name || ''} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="e.g. Polymer Solutions Inc." />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tax ID / EIN</label>
                                    <input name="taxId" value={formData.taxId || ''} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="12-3456789" />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nickname</label>
                                    <input name="nickname" value={formData.nickname || ''} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="e.g. PSI" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Status</label>
                                    <select name="status" value={formData.status || 'Active'} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg px-3 py-2 text-sm">
                                        <option value="Active">Active</option>
                                        <option value="Inactive">Inactive</option>
                                        <option value="At Risk">At Risk</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Contact Person *</label>
                                    <input required name="contactPerson" value={formData.contactPerson || ''} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Phone</label>
                                    <input name="phone" value={formData.phone || ''} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="+1 (555) 000-0000" />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email *</label>
                                    <div className="relative">
                                        <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input required type="email" name="email" value={formData.email || ''} onChange={handleInputChange} className="w-full pl-9 pr-3 py-2 border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="contact@company.com" />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email 2</label>
                                    <div className="relative">
                                        <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input type="email" name="email2" value={formData.email2 || ''} onChange={handleInputChange} className="w-full pl-9 pr-3 py-2 border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="secondary@company.com" />
                                    </div>
                                </div>
                            </div>

                            <div className="p-4 bg-slate-50 rounded-lg border border-slate-100 space-y-3">
                                <h4 className="text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><MapPin size={12} /> Address Details</h4>
                                <div>
                                    <label className="block text-xs font-medium text-slate-700 mb-1">Street Address</label>
                                    <input name="location" className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg p-2 text-sm" value={formData.location || ''} onChange={handleInputChange} placeholder="123 Commerce Way" />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-medium text-slate-700 mb-1">City</label>
                                        <input name="city" className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg p-2 text-sm" value={formData.city || ''} onChange={handleInputChange} />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-700 mb-1">State/Prov</label>
                                        <input name="state" className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg p-2 text-sm" value={formData.state || ''} onChange={handleInputChange} />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-medium text-slate-700 mb-1">Zip/Postal Code</label>
                                        <input name="zip" className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg p-2 text-sm" value={formData.zip || ''} onChange={handleInputChange} />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-700 mb-1">Country</label>
                                        <input name="country" className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg p-2 text-sm" value={formData.country || ''} onChange={handleInputChange} />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-700 mb-1">Preferred POD (Port of Destination)</label>
                                    <div className="relative">
                                        <Anchor size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <select
                                            name="pod"
                                            className="w-full pl-9 pr-3 py-2 border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg text-sm appearance-none focus:ring-2 focus:ring-blue-500 outline-none"
                                            value={formData.pod || ''}
                                            onChange={(e) => {
                                                if (e.target.value === '_ADD_NEW_') {
                                                    setShowQuickAddPort(true);
                                                } else {
                                                    handleInputChange(e);
                                                }
                                            }}
                                        >
                                            <option value="">Select Port...</option>
                                            <option value="_ADD_NEW_" className="font-bold text-blue-400 bg-slate-800">+ Add New Port</option>
                                            {[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={`${p.name} (${p.code})`}>{p.name} ({p.code})</option>)}
                                        </select>
                                    </div>
                                    {portAddedMessage && <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><CheckCircle2 size={10} /> {portAddedMessage}</p>}
                                </div>
                            </div>

                            <div className="p-4 bg-slate-50 rounded-lg border border-slate-100 space-y-3">
                                <h4 className="text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><Building2 size={12} /> Broker Details</h4>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-medium text-slate-700 mb-1">Broker Name</label>
                                        <input name="brokerName" className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg p-2 text-sm" value={formData.brokerName || ''} onChange={handleInputChange} placeholder="Broker company name" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-700 mb-1">Broker Email</label>
                                        <input type="email" name="brokerEmail" className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg p-2 text-sm" value={formData.brokerEmail || ''} onChange={handleInputChange} placeholder="broker@company.com" />
                                    </div>
                                </div>
                            </div>

                            <div className="p-4 bg-rose-50 rounded-lg border border-rose-100 space-y-3">
                                <h4 className="text-xs font-bold text-rose-700 uppercase mb-1 flex items-center gap-1"><Building2 size={12} /> Sales Person</h4>
                                {currentUser && currentUser.role === 'Sales' ? (
                                    <div className="w-full border border-slate-600 bg-slate-900 text-white rounded-lg px-3 py-2 text-sm font-medium">{currentUser.name}</div>
                                ) : (
                                    <select
                                        name="sales_person_id"
                                        className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg px-3 py-2 text-sm"
                                        value={formData.sales_person_id || ''}
                                        onChange={(e) => {
                                            const selectedUser = users.find(u => u.id === e.target.value);
                                            setFormData(prev => ({
                                                ...prev,
                                                sales_person_id: e.target.value,
                                                sales_person_name: selectedUser?.name || ''
                                            }));
                                        }}
                                    >
                                        <option value="">No sales person assigned</option>
                                        {(users || [])
                                            .filter(u => {
                                                const r = String(u.role).toLowerCase();
                                                return ['sales', 'manager', 'ceo', 'admin'].includes(r);
                                            })
                                            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                                            .map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)
                                        }
                                    </select>
                                )}
                                <p className="text-[10px] text-rose-600">Assign a sales representative to this customer. Sales users only see customers assigned to them.</p>
                            </div>

                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                                <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2"><CreditCard size={14} /> Financials</h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-slate-700 mb-1">Credit Limit ($)</label>
                                        <FormattedInput
                                            value={formData.creditLimit || 0}
                                            onChange={(val) => setFormData(prev => ({ ...prev, creditLimit: val }))}
                                            className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg px-2 py-1.5 text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-700 mb-1">Payment Terms</label>
                                        <select name="paymentTerms" value={formData.paymentTerms || 'Net 30'} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg px-2 py-1.5 text-sm">
                                            {PAYMENT_TERM_OPTIONS.map(term => <option key={term} value={term}>{term}</option>)}
                                        </select>
                                    </div>
                                </div>
                            </div>
                            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 mt-4 shadow-sm">
                                <Save size={18} /> {editingId ? 'Update Customer' : 'Save Customer'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* View Modal */}
            {viewingCustomer && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full overflow-hidden animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-slate-50">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600">
                                    <Building2 size={24} />
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-slate-800">{viewingCustomer.name}</h3>
                                    {viewingCustomer.nickname && <p className="text-sm text-blue-600 font-medium">({viewingCustomer.nickname})</p>}
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${viewingCustomer.status === 'Active' ? 'bg-emerald-100 text-emerald-800' : viewingCustomer.status === 'At Risk' ? 'bg-red-100 text-red-800' : 'bg-slate-200 text-slate-700'}`}>{viewingCustomer.status}</span>
                                        <span className="text-xs text-slate-400">ID: {viewingCustomer.id}</span>
                                        {viewingCustomer.taxId && <span className="text-xs text-slate-500 border-l border-slate-300 pl-2 ml-1 font-mono">Tax ID: {viewingCustomer.taxId}</span>}
                                    </div>
                                </div>
                            </div>
                            <button onClick={() => setViewingCustomer(null)} className="text-slate-400 hover:text-slate-600 hover:bg-slate-200 p-2 rounded-full transition-all"><X size={20} /></button>
                        </div>
                        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-4">
                                <h4 className="text-sm font-bold text-slate-700 uppercase flex items-center gap-2 border-b border-slate-100 pb-2"><Phone size={16} className="text-blue-500" /> Contact Details</h4>
                                <div className="space-y-3">
                                    <div><p className="text-xs text-slate-500 mb-0.5">Primary Contact</p><p className="font-medium text-slate-800">{viewingCustomer.contactPerson}</p></div>
                                    <div><p className="text-xs text-slate-500 mb-0.5">Email Address</p><p className="font-medium text-slate-800 flex items-center gap-2"><Mail size={14} className="text-slate-400" />{viewingCustomer.email}</p></div>
                                    {viewingCustomer.email2 && <div><p className="text-xs text-slate-500 mb-0.5">Email 2</p><p className="font-medium text-slate-800 flex items-center gap-2"><Mail size={14} className="text-slate-400" />{viewingCustomer.email2}</p></div>}
                                    <div><p className="text-xs text-slate-500 mb-0.5">Phone Number</p><p className="font-medium text-slate-800 flex items-center gap-2"><Phone size={14} className="text-slate-400" />{viewingCustomer.phone}</p></div>
                                    <div>
                                        <p className="text-xs text-slate-500 mb-0.5">Address</p>
                                        <p className="font-medium text-slate-800 flex items-start gap-2">
                                            <MapPin size={14} className="text-slate-400 mt-0.5 shrink-0" />
                                            <span>{formatAddress(viewingCustomer) || 'No address on file'}</span>
                                        </p>
                                    </div>
                                    {viewingCustomer.pod && (
                                        <div>
                                            <p className="text-xs text-slate-500 mb-0.5">Preferred POD</p>
                                            <p className="font-medium text-slate-800 flex items-center gap-2"><Anchor size={14} className="text-blue-400" />{viewingCustomer.pod}</p>
                                        </div>
                                    )}
                                    {(viewingCustomer.brokerName || viewingCustomer.brokerEmail) && (
                                        <div className="pt-2 border-t border-slate-100">
                                            <p className="text-xs text-slate-500 mb-0.5">Broker</p>
                                            {viewingCustomer.brokerName && <p className="font-medium text-slate-800">{viewingCustomer.brokerName}</p>}
                                            {viewingCustomer.brokerEmail && <p className="text-sm text-slate-600 flex items-center gap-1"><Mail size={12} className="text-slate-400" />{viewingCustomer.brokerEmail}</p>}
                                        </div>
                                    )}
                                    {viewingCustomer.sales_person_name && (
                                        <div className="pt-2 border-t border-slate-100">
                                            <p className="text-xs text-slate-500 mb-0.5">Sales Person</p>
                                            <p className="font-medium text-rose-700">{viewingCustomer.sales_person_name}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="space-y-4">
                                <h4 className="text-sm font-bold text-slate-700 uppercase flex items-center gap-2 border-b border-slate-100 pb-2"><CreditCard size={16} className="text-emerald-500" /> Financial Overview</h4>
                                <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-100">
                                    <div className="flex justify-between items-center mb-2"><span className="text-sm text-emerald-800 font-medium">Credit Limit</span><span className="text-lg font-bold text-emerald-700">${viewingCustomer.creditLimit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                                    <div className="w-full bg-emerald-200 h-1.5 rounded-full mb-2"><div className="bg-emerald-500 h-1.5 rounded-full w-[40%]"></div></div>
                                    <p className="text-xs text-emerald-600">40% utilized currently</p>
                                </div>
                                <div><p className="text-xs text-slate-500 mb-0.5">Payment Terms</p><span className="inline-block bg-slate-100 text-slate-700 px-3 py-1 rounded text-sm font-medium border border-slate-200">{viewingCustomer.paymentTerms}</span></div>
                                {viewingCustomer.taxId && <div><p className="text-xs text-slate-500 mb-0.5">Tax ID / EIN</p><p className="font-mono text-slate-700">{viewingCustomer.taxId}</p></div>}
                            </div>
                        </div>
                        <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
                            <button onClick={(e) => { setViewingCustomer(null); handleEdit(viewingCustomer, { stopPropagation: () => { } } as React.MouseEvent); }} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium shadow-sm flex items-center gap-2"><Pencil size={14} /> Edit Profile</button>
                            <button onClick={() => setViewingCustomer(null)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium shadow-sm">Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Customers;
