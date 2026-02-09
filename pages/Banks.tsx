import React, { useState } from 'react';
import { Plus, Edit2, Trash2, Search, Building2, CreditCard, X } from 'lucide-react';
import { Bank, Company } from '../types';

interface BanksProps {
    banks: Bank[];
    onAdd: (bank: Bank) => void;
    onUpdate: (bank: Bank) => void;
    onDelete: (id: string) => Promise<boolean>;
    currentCompanyId: string;
    availableCompanies: Company[];
}

const Banks: React.FC<BanksProps> = ({
    banks,
    onAdd,
    onUpdate,
    onDelete,
    currentCompanyId,
    availableCompanies
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingBank, setEditingBank] = useState<Bank | null>(null);
    const [isDeleting, setIsDeleting] = useState<string | null>(null);

    const [formData, setFormData] = useState<Partial<Bank>>({
        code: '',
        name: '',
        address_line1: '',
        address_line2: '',
        city: '',
        state: '',
        zip_code: '',
        country: '',
        swift_code: '',
        wire: '',
        routing: '',
        account_number: ''
    });

    const filteredBanks = banks.filter(bank =>
        bank.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        bank.code?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        bank.swift_code?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleOpenModal = (bank?: Bank) => {
        if (bank) {
            setEditingBank(bank);
            setFormData({
                code: bank.code || '',
                name: bank.name || '',
                address_line1: bank.address_line1 || '',
                address_line2: bank.address_line2 || '',
                city: bank.city || '',
                state: bank.state || '',
                zip_code: bank.zip_code || '',
                country: bank.country || '',
                swift_code: bank.swift_code || '',
                wire: bank.wire || '',
                routing: bank.routing || '',
                account_number: bank.account_number || ''
            });
        } else {
            setEditingBank(null);
            setFormData({
                code: '',
                name: '',
                address_line1: '',
                address_line2: '',
                city: '',
                state: '',
                zip_code: '',
                country: '',
                swift_code: '',
                wire: '',
                routing: '',
                account_number: ''
            });
        }
        setShowModal(true);
    };

    const handleSave = () => {
        if (!formData.code || !formData.name) {
            alert('Please enter Bank Code and Name');
            return;
        }

        if (editingBank) {
            // Update existing bank - include all fields
            const bankData: Bank = {
                id: editingBank.id,
                company_id: editingBank.company_id,
                created_at: editingBank.created_at,
                code: formData.code || '',
                name: formData.name || '',
                address_line1: formData.address_line1,
                address_line2: formData.address_line2,
                city: formData.city,
                state: formData.state,
                zip_code: formData.zip_code,
                country: formData.country,
                swift_code: formData.swift_code,
                wire: formData.wire,
                routing: formData.routing,
                account_number: formData.account_number
            };
            onUpdate(bankData);
        } else {
            // New bank - let Supabase generate id and created_at
            const bankData = {
                company_id: currentCompanyId,
                code: formData.code || '',
                name: formData.name || '',
                address_line1: formData.address_line1 || null,
                address_line2: formData.address_line2 || null,
                city: formData.city || null,
                state: formData.state || null,
                zip_code: formData.zip_code || null,
                country: formData.country || null,
                swift_code: formData.swift_code || null,
                wire: formData.wire || null,
                routing: formData.routing || null,
                account_number: formData.account_number || null
            };
            onAdd(bankData as any);
        }

        setShowModal(false);
        setEditingBank(null);
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('Are you sure you want to delete this bank?')) return;
        setIsDeleting(id);
        try {
            await onDelete(id);
        } finally {
            setIsDeleting(null);
        }
    };

    const getCompanyName = (company_id: string) => {
        const company = availableCompanies.find(c => c.id === company_id);
        return company?.name || company_id;
    };

    return (
        <div className="p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-lg">
                        <Building2 className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">Banks</h1>
                        <p className="text-sm text-slate-500">Manage bank accounts for invoicing</p>
                    </div>
                </div>
                <button
                    onClick={() => handleOpenModal()}
                    className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-lg shadow-md hover:shadow-lg transition-all"
                >
                    <Plus className="w-4 h-4" />
                    Add Bank
                </button>
            </div>

            {/* Search */}
            <div className="relative mb-6">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                    type="text"
                    placeholder="Search by name, code, or SWIFT..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
            </div>

            {/* Banks Grid */}
            {filteredBanks.length === 0 ? (
                <div className="text-center py-12 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
                    <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-500">No banks found</p>
                    <button
                        onClick={() => handleOpenModal()}
                        className="mt-4 px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600"
                    >
                        Add Your First Bank
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredBanks.map(bank => (
                        <div
                            key={bank.id}
                            className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all overflow-hidden"
                        >
                            <div className="p-4 border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-teal-50">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <span className="text-xs font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded">
                                            {bank.code}
                                        </span>
                                        <h3 className="text-lg font-semibold text-slate-800 mt-1">{bank.name}</h3>
                                    </div>
                                    <div className="flex gap-1">
                                        <button
                                            onClick={() => handleOpenModal(bank)}
                                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                        >
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(bank.id)}
                                            disabled={isDeleting === bank.id}
                                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div className="p-4 space-y-2 text-sm">
                                {bank.address_line1 && (
                                    <p className="text-slate-600">{bank.address_line1}</p>
                                )}
                                {bank.address_line2 && (
                                    <p className="text-slate-600">{bank.address_line2}</p>
                                )}
                                {(bank.city || bank.state || bank.zip_code) && (
                                    <p className="text-slate-600">
                                        {[bank.city, bank.state, bank.zip_code].filter(Boolean).join(', ')}
                                    </p>
                                )}
                                {bank.country && (
                                    <p className="text-slate-600">{bank.country}</p>
                                )}
                                <div className="pt-2 border-t border-slate-100 space-y-1">
                                    {bank.swift_code && (
                                        <div className="flex justify-between">
                                            <span className="text-slate-400">SWIFT:</span>
                                            <span className="font-mono text-slate-700">{bank.swift_code}</span>
                                        </div>
                                    )}
                                    {bank.wire && (
                                        <div className="flex justify-between">
                                            <span className="text-slate-400">ACH:</span>
                                            <span className="font-mono text-slate-700">{bank.wire}</span>
                                        </div>
                                    )}
                                    {bank.routing && (
                                        <div className="flex justify-between">
                                            <span className="text-slate-400">Routing:</span>
                                            <span className="font-mono text-slate-700">{bank.routing}</span>
                                        </div>
                                    )}
                                    {bank.account_number && (
                                        <div className="flex justify-between">
                                            <span className="text-slate-400">Account:</span>
                                            <span className="font-mono text-slate-700">{bank.account_number}</span>
                                        </div>
                                    )}
                                </div>
                                <div className="pt-2 border-t border-slate-100">
                                    <span className="text-xs text-slate-400">
                                        Company: {getCompanyName(bank.company_id)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Add/Edit Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center">
                                    <CreditCard className="w-5 h-5 text-white" />
                                </div>
                                <h2 className="text-xl font-bold text-slate-800">
                                    {editingBank ? 'Edit Bank' : 'Add New Bank'}
                                </h2>
                            </div>
                            <button
                                onClick={() => setShowModal(false)}
                                className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            {/* Basic Info */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Bank Code *</label>
                                    <input
                                        type="text"
                                        value={formData.code}
                                        onChange={(e) => setFormData(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                                        placeholder="e.g., CHASE, BOA"
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Bank Name *</label>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) => setFormData(p => ({ ...p, name: e.target.value }))}
                                        placeholder="e.g., Chase Bank"
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                                    />
                                </div>
                            </div>

                            {/* Address */}
                            <div className="border-t border-slate-100 pt-4">
                                <h3 className="text-sm font-semibold text-slate-700 mb-3">Address</h3>
                                <div className="space-y-3">
                                    <input
                                        type="text"
                                        value={formData.address_line1}
                                        onChange={(e) => setFormData(p => ({ ...p, address_line1: e.target.value }))}
                                        placeholder="Address Line 1"
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                                    />
                                    <input
                                        type="text"
                                        value={formData.address_line2}
                                        onChange={(e) => setFormData(p => ({ ...p, address_line2: e.target.value }))}
                                        placeholder="Address Line 2"
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                                    />
                                    <div className="grid grid-cols-3 gap-3">
                                        <input
                                            type="text"
                                            value={formData.city}
                                            onChange={(e) => setFormData(p => ({ ...p, city: e.target.value }))}
                                            placeholder="City"
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                                        />
                                        <input
                                            type="text"
                                            value={formData.state}
                                            onChange={(e) => setFormData(p => ({ ...p, state: e.target.value }))}
                                            placeholder="State"
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                                        />
                                        <input
                                            type="text"
                                            value={formData.zip_code}
                                            onChange={(e) => setFormData(p => ({ ...p, zip_code: e.target.value }))}
                                            placeholder="ZIP Code"
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                                        />
                                    </div>
                                    <input
                                        type="text"
                                        value={formData.country}
                                        onChange={(e) => setFormData(p => ({ ...p, country: e.target.value }))}
                                        placeholder="Country"
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                                    />
                                </div>
                            </div>

                            {/* Banking Codes */}
                            <div className="border-t border-slate-100 pt-4">
                                <h3 className="text-sm font-semibold text-slate-700 mb-3">Banking Codes</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">SWIFT Code</label>
                                        <input
                                            type="text"
                                            value={formData.swift_code}
                                            onChange={(e) => setFormData(p => ({ ...p, swift_code: e.target.value.toUpperCase() }))}
                                            placeholder="e.g., CHASUS33"
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 font-mono"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">ACH</label>
                                        <input
                                            type="text"
                                            value={formData.wire}
                                            onChange={(e) => setFormData(p => ({ ...p, wire: e.target.value }))}
                                            placeholder="ACH transfer code"
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 font-mono"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Routing</label>
                                        <input
                                            type="text"
                                            value={formData.routing}
                                            onChange={(e) => setFormData(p => ({ ...p, routing: e.target.value }))}
                                            placeholder="e.g., 021000021"
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 font-mono"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Account Number</label>
                                        <input
                                            type="text"
                                            value={formData.account_number}
                                            onChange={(e) => setFormData(p => ({ ...p, account_number: e.target.value }))}
                                            placeholder="Account number"
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 font-mono"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 border-t border-slate-200 flex justify-end gap-3 sticky bottom-0 bg-white">
                            <button
                                onClick={() => setShowModal(false)}
                                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                className="px-6 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-lg shadow-md hover:shadow-lg"
                            >
                                {editingBank ? 'Update Bank' : 'Add Bank'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Banks;
