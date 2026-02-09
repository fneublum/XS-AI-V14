import React, { useState } from 'react';
import { X, Save, Loader2 } from 'lucide-react';

interface QuickAddModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: any) => Promise<void>;
    type: 'supplier' | 'shipper' | 'consignee';
    title: string;
}

const QuickAddModal: React.FC<QuickAddModalProps> = ({ isOpen, onClose, onSave, type, title }) => {
    const [isSaving, setIsSaving] = useState(false);
    const [formData, setFormData] = useState<any>({});

    if (!isOpen) return null;

    const handleChange = (field: string, value: string) => {
        setFormData((prev: any) => ({ ...prev, [field]: value }));
    };

    const handleSave = async () => {
        if (!formData.name) {
            alert("Name is required.");
            return;
        }

        setIsSaving(true);
        try {
            await onSave(formData);
            setFormData({}); // Clear form on success
            onClose();
        } catch (error) {
            console.error(error);
            alert("Failed to save record.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md animate-in zoom-in-95 overflow-hidden">
                <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                    <h3 className="font-bold text-slate-800">{title}</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    {/* Common Field: Name */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Name *</label>
                        <input
                            autoFocus
                            type="text"
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            value={formData.name || ''}
                            onChange={(e) => handleChange('name', e.target.value)}
                            placeholder="Enter name..."
                        />
                    </div>

                    {/* Specific Fields based on Type */}
                    {type === 'supplier' && (
                        <>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Contact Person</label>
                                <input
                                    type="text"
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                    value={formData.contactPerson || ''}
                                    onChange={(e) => handleChange('contactPerson', e.target.value)}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email</label>
                                    <input
                                        type="email"
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                        value={formData.email || ''}
                                        onChange={(e) => handleChange('email', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Phone</label>
                                    <input
                                        type="text"
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                        value={formData.phone || ''}
                                        onChange={(e) => handleChange('phone', e.target.value)}
                                    />
                                </div>
                            </div>
                        </>
                    )}

                    {type === 'shipper' && ( // Company
                        <>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Address</label>
                                <input
                                    type="text"
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                    value={formData.address || ''}
                                    onChange={(e) => handleChange('address', e.target.value)}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">City</label>
                                    <input
                                        type="text"
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                        value={formData.city || ''}
                                        onChange={(e) => handleChange('city', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Country</label>
                                    <input
                                        type="text"
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                        value={formData.country || ''}
                                        onChange={(e) => handleChange('country', e.target.value)}
                                    />
                                </div>
                            </div>
                        </>
                    )}

                    {type === 'consignee' && ( // Customer
                        <>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Contact Person</label>
                                <input
                                    type="text"
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                    value={formData.contactPerson || ''}
                                    onChange={(e) => handleChange('contactPerson', e.target.value)}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email</label>
                                    <input
                                        type="email"
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                        value={formData.email || ''}
                                        onChange={(e) => handleChange('email', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Country</label>
                                    <input
                                        type="text"
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                        value={formData.country || ''}
                                        onChange={(e) => handleChange('country', e.target.value)}
                                    />
                                </div>
                            </div>
                        </>
                    )}

                </div>

                <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-bold text-slate-600 hover:text-slate-800"
                        disabled={isSaving}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-indigo-700 transition-colors flex items-center gap-2"
                    >
                        {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        Save Record
                    </button>
                </div>
            </div>
        </div>
    );
};

export default QuickAddModal;
