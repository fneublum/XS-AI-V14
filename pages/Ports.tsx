
import React, { useState, useRef, useEffect } from 'react';
import { Port, Company } from '../types';
import { Search, Plus, X, Save, Pencil, Trash2, Anchor, MapPin, LayoutGrid, List, Filter, CheckCircle2, FilePlus } from 'lucide-react';

interface PortsProps {
    ports: Port[];
    onAdd: (p: Port) => void;
    onUpdate: (p: Port) => void;
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

const Ports: React.FC<PortsProps> = ({ ports, onAdd, onUpdate, onDelete, currentCompanyId, availableCompanies, initialViewMode = 'grid' }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'grid' | 'table'>(initialViewMode);

    // Filtering State
    const [activeFilterColumn, setActiveFilterColumn] = useState<string | null>(null);
    const [filters, setFilters] = useState<Record<string, string[]>>({});
    const [filterSearch, setFilterSearch] = useState('');
    const filterMenuRef = useRef<HTMLDivElement>(null);

    const initialFormState: Partial<Port> = {
        code: '',
        name: '',
        country: ''
    };

    const [formData, setFormData] = useState<Partial<Port>>(initialFormState);

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

    const filteredPorts = ports.filter(p => {
        const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            p.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
            p.country.toLowerCase().includes(searchTerm.toLowerCase());

        if (!matchesSearch) return false;

        // Apply Column Filters
        for (const [key, selectedValues] of Object.entries(filters)) {
            const values = selectedValues as string[];
            if (values.length > 0) {
                let cellValue = (p as any)[key];
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

    const handleEdit = (port: Port, e: React.MouseEvent) => {
        e.stopPropagation();
        setFormData(port);
        setEditingId(port.id);
        setIsAdding(true);
    };

    const handleDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (window.confirm('Delete this port?')) {
            onDelete(id);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name || !formData.code) return;

        // Force 'ALL' for global use
        const targetCompanyId = 'ALL';

        if (editingId) {
            onUpdate({ ...formData, id: editingId, companyId: targetCompanyId } as Port);
        } else {
            const newPort: Port = {
                id: `PRT${Date.now()}`,
                companyId: targetCompanyId,
                code: formData.code.toUpperCase(),
                name: formData.name,
                country: formData.country || ''
            };
            onAdd(newPort);
        }
        setIsAdding(false);
    };

    const renderColumnHeader = (id: keyof Port, label: string) => {
        const uniqueValues = getUniqueValues(ports, id as string);
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
                        <Anchor className="text-blue-600" /> Port Database
                    </h2>
                    <p className="text-slate-500 text-sm">Manage logistics hubs and port codes (Global)</p>
                </div>
                <div className="flex gap-2 w-full md:w-auto">
                    <div className="relative flex-1 md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            type="text"
                            placeholder="Search ports..."
                            className="w-full pl-10 pr-4 py-2 border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
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
                    <button onClick={handleAddNew} className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm" title="Add Port">
                        <FilePlus size={20} />
                    </button>
                </div>
            </div>

            {viewMode === 'grid' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {filteredPorts.map(port => (
                        <div key={port.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 hover:shadow-md transition-shadow group relative">
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-lg font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">{port.code}</span>
                                </div>
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity absolute top-3 right-3 bg-white pl-2">
                                    <button onClick={(e) => handleEdit(port, e)} className="text-slate-400 hover:text-amber-500"><Pencil size={14} /></button>
                                    <button onClick={(e) => handleDelete(port.id, e)} className="text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
                                </div>
                            </div>
                            <h3 className="font-bold text-slate-800 truncate" title={port.name}>{port.name}</h3>
                            <p className="text-sm text-slate-500 flex items-center gap-1 mt-1"><MapPin size={12} /> {port.country}</p>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                {renderColumnHeader('code', 'Code')}
                                {renderColumnHeader('name', 'Port Name')}
                                {renderColumnHeader('country', 'Country')}
                                <th className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredPorts.map(port => (
                                <tr key={port.id} className="hover:bg-slate-50 transition-colors group">
                                    <td className="px-3 py-2 text-sm font-mono font-bold text-slate-700">{port.code}</td>
                                    <td className="px-3 py-2 text-sm font-medium text-slate-800">{port.name}</td>
                                    <td className="px-3 py-2 text-sm text-slate-600">{port.country}</td>
                                    <td className="px-3 py-2 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <button onClick={(e) => handleEdit(port, e)} className="text-slate-400 hover:text-amber-500"><Pencil size={16} /></button>
                                            <button onClick={(e) => handleDelete(port.id, e)} className="text-slate-400 hover:text-red-500"><Trash2 size={16} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {filteredPorts.length === 0 && !isAdding && (
                <div className="col-span-full py-12 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl">
                    <Anchor size={48} className="mx-auto mb-2 opacity-20" />
                    <p>No ports found.</p>
                </div>
            )}

            {isAdding && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center p-4 border-b border-slate-100">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                {editingId ? <Pencil size={16} /> : <Plus size={16} />}
                                {editingId ? 'Edit Port' : 'Add Port'}
                            </h3>
                            <button onClick={() => setIsAdding(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-4 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Port Code (3-5 Letters)</label>
                                <input
                                    required
                                    maxLength={5}
                                    className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg p-2 text-sm uppercase font-mono"
                                    value={formData.code}
                                    onChange={e => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                                    placeholder="e.g. LAX"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Port Name</label>
                                <input
                                    required
                                    className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg p-2 text-sm"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="e.g. Los Angeles"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Country</label>
                                <input
                                    required
                                    className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg p-2 text-sm"
                                    value={formData.country}
                                    onChange={e => setFormData({ ...formData, country: e.target.value })}
                                    placeholder="e.g. USA"
                                />
                            </div>

                            <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2 mt-2">
                                <Save size={18} /> {editingId ? 'Update Port' : 'Save Port'}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Ports;
