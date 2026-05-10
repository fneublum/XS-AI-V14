import React, { useState } from 'react';
import { Plus, X, Save, Pencil, Trash2, CreditCard, Eye, CheckCircle2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { getSupabaseClient } from '../services/supabase';

// ── Types ──────────────────────────────────────────────────────────────────────
export interface PaymentInstallment {
    payment_number: number;
    pct: number;
    days: number;
    event: 'ORDER' | 'INVOICE' | 'BL' | 'DELIVERY' | 'SIGHT';
    description: string;
}

export interface PaymentTerm {
    id: string;
    companyId: string;
    code: string;
    description: string;
    type: 'DOMESTIC' | 'IMPORT' | 'EXPORT' | 'ALL';
    method: string;
    num_payments: number;
    installments: PaymentInstallment[];
    notes?: string;
    active: boolean;
    createdAt?: string;
}

const EVENT_OPTIONS = ['ORDER', 'INVOICE', 'BL', 'DELIVERY', 'SIGHT'];
const METHOD_OPTIONS = ['TT', 'LC', 'CAD', 'DA', 'DP', 'ADVANCE', 'NET', 'COD', 'OTHER'];
const TYPE_OPTIONS = ['ALL', 'DOMESTIC', 'IMPORT', 'EXPORT'];

const METHOD_COLORS: Record<string, string> = {
    TT: 'bg-blue-100 text-blue-700',
    LC: 'bg-purple-100 text-purple-700',
    CAD: 'bg-amber-100 text-amber-700',
    DA: 'bg-orange-100 text-orange-700',
    DP: 'bg-cyan-100 text-cyan-700',
    ADVANCE: 'bg-emerald-100 text-emerald-700',
    NET: 'bg-slate-100 text-slate-700',
    COD: 'bg-rose-100 text-rose-700',
    OTHER: 'bg-gray-100 text-gray-700',
};

const TYPE_COLORS: Record<string, string> = {
    ALL: 'bg-slate-100 text-slate-600',
    DOMESTIC: 'bg-green-100 text-green-700',
    IMPORT: 'bg-blue-100 text-blue-700',
    EXPORT: 'bg-amber-100 text-amber-700',
};

interface PaymentTermsProps {
    paymentTerms: PaymentTerm[];
    onAdd: (pt: PaymentTerm) => void;
    onUpdate: (pt: PaymentTerm) => void;
    onDelete: (id: string) => void;
    currentCompanyId: string;
}

const emptyInstallment = (n: number): PaymentInstallment => ({
    payment_number: n,
    pct: 0,
    days: 0,
    event: 'INVOICE',
    description: '',
});

const emptyForm = (companyId: string): Partial<PaymentTerm> => ({
    companyId,
    code: '',
    description: '',
    type: 'ALL',
    method: 'TT',
    num_payments: 1,
    installments: [emptyInstallment(1)],
    notes: '',
    active: true,
});

const PaymentTerms: React.FC<PaymentTermsProps> = ({
    paymentTerms,
    onAdd,
    onUpdate,
    onDelete,
    currentCompanyId,
}) => {
    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<PaymentTerm>>(emptyForm(currentCompanyId));
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [filterType, setFilterType] = useState<string>('ALL');
    const [filterMethod, setFilterMethod] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const totalPct = (formData.installments || []).reduce((s, i) => s + Number(i.pct || 0), 0);
    const pctValid = Math.abs(totalPct - 100) < 0.01;

    const filtered = paymentTerms.filter(pt => {
        if (filterType !== 'ALL' && pt.type !== filterType) return false;
        if (filterMethod && pt.method !== filterMethod) return false;
        return true;
    });

    const openAdd = () => {
        setFormData(emptyForm(currentCompanyId === 'ALL' ? 'ALL' : currentCompanyId));
        setEditingId(null);
        setIsAdding(true);
        setError(null);
    };

    const openEdit = (pt: PaymentTerm) => {
        setFormData({ ...pt, installments: pt.installments.map(i => ({ ...i })) });
        setEditingId(pt.id);
        setIsAdding(true);
        setError(null);
    };

    const handleClose = () => { setIsAdding(false); setEditingId(null); setError(null); };

    const addInstallment = () => {
        const n = (formData.installments?.length || 0) + 1;
        setFormData(prev => ({
            ...prev,
            num_payments: n,
            installments: [...(prev.installments || []), emptyInstallment(n)],
        }));
    };

    const removeInstallment = (idx: number) => {
        const next = (formData.installments || []).filter((_, i) => i !== idx).map((item, i) => ({ ...item, payment_number: i + 1 }));
        setFormData(prev => ({ ...prev, num_payments: next.length, installments: next }));
    };

    const updateInstallment = (idx: number, field: keyof PaymentInstallment, value: any) => {
        const inst = [...(formData.installments || [])];
        inst[idx] = { ...inst[idx], [field]: field === 'pct' || field === 'days' ? Number(value) : value };
        setFormData(prev => ({ ...prev, installments: inst }));
    };

    const handleSubmit = async () => {
        if (!formData.code || !formData.description) { setError('Code and Description are required.'); return; }
        if (!pctValid) { setError(`Installment percentages must sum to 100%. Current: ${totalPct.toFixed(1)}%`); return; }
        setSaving(true);
        try {
            if (editingId) {
                const updated = {
                    id: editingId,
                    companyId: formData.companyId || currentCompanyId,
                    code: formData.code,
                    description: formData.description,
                    type: formData.type || 'ALL',
                    method: formData.method || 'TT',
                    num_payments: formData.installments?.length || 1,
                    installments: formData.installments || [],
                    notes: formData.notes || null,
                    active: formData.active !== false,
                } as any;
                onUpdate(updated);
            } else {
                // Omit id so Supabase auto-generates UUID
                const newPt = {
                    companyId: formData.companyId || currentCompanyId,
                    code: formData.code,
                    description: formData.description,
                    type: formData.type || 'ALL',
                    method: formData.method || 'TT',
                    num_payments: formData.installments?.length || 1,
                    installments: formData.installments || [],
                    notes: formData.notes || null,
                    active: true,
                } as any;
                onAdd(newPt);
            }
            handleClose();
        } finally { setSaving(false); }
    };

    const handleDelete = (id: string) => {
        if (window.confirm('Delete this payment term? This cannot be undone.')) onDelete(id);
    };

    return (
        <div className="h-full bg-slate-100 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 px-6 py-4 shrink-0">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-gradient-to-r from-violet-500 to-purple-600 rounded-xl text-white shadow-md">
                            <CreditCard size={22} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-800">Payment Terms</h1>
                            <p className="text-sm text-slate-500">Define terms · Manage installments · Power cash flow</p>
                        </div>
                    </div>
                    <button onClick={openAdd} className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-all shadow-md font-medium">
                        <Plus size={18} /> Add Term
                    </button>
                </div>
                {/* Stats + Filters */}
                <div className="flex items-center gap-4">
                    <div className="flex gap-5 text-xs mr-4">
                        <div className="text-center"><div className="text-2xl font-bold text-violet-600">{paymentTerms.filter(p => p.active).length}</div><div className="text-slate-500">Active</div></div>
                        <div className="text-center"><div className="text-2xl font-bold text-blue-600">{paymentTerms.filter(p => p.type === 'EXPORT').length}</div><div className="text-slate-500">Export</div></div>
                        <div className="text-center"><div className="text-2xl font-bold text-green-600">{paymentTerms.filter(p => p.type === 'DOMESTIC').length}</div><div className="text-slate-500">Domestic</div></div>
                    </div>
                    <div className="flex gap-2 ml-auto">
                        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none">
                            <option value="ALL">All Types</option>
                            {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <select value={filterMethod} onChange={e => setFilterMethod(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none">
                            <option value="">All Methods</option>
                            {METHOD_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                    </div>
                </div>
            </div>

            {/* Main list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center">
                        <CreditCard size={48} className="text-slate-200 mb-3" />
                        <p className="text-slate-400 font-medium">No payment terms yet</p>
                        <p className="text-slate-400 text-sm">Click "Add Term" to create your first payment term</p>
                    </div>
                ) : filtered.map(pt => (
                    <div key={pt.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden hover:border-violet-200 transition-all">
                        <div className="flex items-center gap-3 px-4 py-3">
                            <button onClick={() => setExpandedId(expandedId === pt.id ? null : pt.id)} className="text-slate-400 hover:text-slate-600">
                                {expandedId === pt.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                            <span className="font-mono font-bold text-sm text-violet-700 bg-violet-50 px-2 py-0.5 rounded border border-violet-100 whitespace-nowrap">{pt.code}</span>
                            <span className="font-medium text-slate-800 text-sm flex-1">{pt.description}</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TYPE_COLORS[pt.type] || TYPE_COLORS.ALL}`}>{pt.type}</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${METHOD_COLORS[pt.method] || METHOD_COLORS.OTHER}`}>{pt.method}</span>
                            <span className="text-xs text-slate-400 whitespace-nowrap">{pt.num_payments} payment{pt.num_payments !== 1 ? 's' : ''}</span>
                            {!pt.active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-medium">Inactive</span>}
                            <div className="flex gap-1 shrink-0">
                                <button onClick={() => setExpandedId(expandedId === pt.id ? null : pt.id)} title="View installments" className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"><Eye size={14} /></button>
                                <button onClick={() => openEdit(pt)} title="Edit" className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors"><Pencil size={14} /></button>
                                <button onClick={() => handleDelete(pt.id)} title="Delete" className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={14} /></button>
                            </div>
                        </div>
                        {/* Expanded installments */}
                        {expandedId === pt.id && (
                            <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
                                <div className="grid grid-cols-[40px_80px_80px_90px_1fr] gap-2 text-[10px] font-bold text-slate-400 uppercase mb-2 px-1">
                                    <span>#</span><span>% Amount</span><span>Days</span><span>Trigger</span><span>Description</span>
                                </div>
                                {pt.installments.map((inst, i) => (
                                    <div key={i} className="grid grid-cols-[40px_80px_80px_90px_1fr] gap-2 items-center py-1.5 border-b border-slate-100 last:border-0 text-xs">
                                        <span className="font-bold text-slate-500 text-center">{inst.payment_number}</span>
                                        <span className="font-bold text-violet-700 text-center">{inst.pct}%</span>
                                        <span className="text-slate-600 text-center">{inst.days === 0 ? 'at' : `+${inst.days}d`}</span>
                                        <span className={`text-center font-medium px-1.5 py-0.5 rounded text-[10px] ${inst.event === 'ORDER' ? 'bg-emerald-100 text-emerald-700' : inst.event === 'BL' ? 'bg-blue-100 text-blue-700' : inst.event === 'SIGHT' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>{inst.event}</span>
                                        <span className="text-slate-500 truncate">{inst.description}</span>
                                    </div>
                                ))}
                                {pt.notes && <p className="text-xs text-slate-400 mt-2 italic">{pt.notes}</p>}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Add/Edit Modal */}
            {isAdding && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
                        <div className="sticky top-0 bg-white px-6 py-4 border-b border-slate-200 flex justify-between items-center rounded-t-2xl">
                            <h3 className="font-bold text-lg text-slate-800">{editingId ? 'Edit Payment Term' : 'New Payment Term'}</h3>
                            <button onClick={handleClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><X size={20} className="text-slate-400" /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            {error && (
                                <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">
                                    <AlertCircle size={16} />{error}
                                </div>
                            )}

                            {/* Code + Description */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Code *</label>
                                    <input value={formData.code || ''} onChange={e => setFormData(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono"
                                        placeholder="e.g. TT30BL" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Type</label>
                                    <select value={formData.type || 'ALL'} onChange={e => setFormData(p => ({ ...p, type: e.target.value as any }))}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                                        {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Description *</label>
                                <input value={formData.description || ''} onChange={e => setFormData(p => ({ ...p, description: e.target.value }))}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                    placeholder="e.g. T/T 30 days after B/L" />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Payment Method</label>
                                <select value={formData.method || 'TT'} onChange={e => setFormData(p => ({ ...p, method: e.target.value }))}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                                    {METHOD_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                                </select>
                            </div>

                            {/* Installments builder */}
                            <div className="bg-violet-50 rounded-xl border border-violet-100 p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <span className="text-xs font-bold text-violet-800 uppercase">Installments</span>
                                    <div className="flex items-center gap-2">
                                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${pctValid ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                                            {totalPct.toFixed(1)}% {pctValid ? '✓' : '≠ 100%'}
                                        </span>
                                        <button type="button" onClick={addInstallment}
                                            className="flex items-center gap-1 text-xs bg-violet-600 text-white px-2 py-1 rounded-lg hover:bg-violet-700">
                                            <Plus size={12} /> Add Payment
                                        </button>
                                    </div>
                                </div>
                                <div className="grid grid-cols-[30px_70px_60px_90px_1fr_24px] gap-1 text-[10px] font-bold text-slate-400 uppercase mb-1 px-1">
                                    <span>#</span><span>%</span><span>Days</span><span>Trigger</span><span>Description</span><span></span>
                                </div>
                                {(formData.installments || []).map((inst, idx) => (
                                    <div key={idx} className="grid grid-cols-[30px_70px_60px_90px_1fr_24px] gap-1 items-center mb-1.5">
                                        <span className="text-center text-xs font-bold text-violet-600">{inst.payment_number}</span>
                                        <input type="number" min={0} max={100} step={1} value={inst.pct}
                                            onChange={e => updateInstallment(idx, 'pct', e.target.value)}
                                            className="border border-slate-200 rounded px-1 py-1 text-xs text-right bg-white" />
                                        <input type="number" min={0} value={inst.days}
                                            onChange={e => updateInstallment(idx, 'days', e.target.value)}
                                            className="border border-slate-200 rounded px-1 py-1 text-xs text-right bg-white" />
                                        <select value={inst.event} onChange={e => updateInstallment(idx, 'event', e.target.value)}
                                            className="border border-slate-200 rounded px-1 py-1 text-xs bg-white">
                                            {EVENT_OPTIONS.map(ev => <option key={ev} value={ev}>{ev}</option>)}
                                        </select>
                                        <input value={inst.description} onChange={e => updateInstallment(idx, 'description', e.target.value)}
                                            placeholder="Description..."
                                            className="border border-slate-200 rounded px-1 py-1 text-xs bg-white" />
                                        <button type="button" onClick={() => removeInstallment(idx)}
                                            className="text-red-400 hover:text-red-600" disabled={(formData.installments?.length || 0) <= 1}>
                                            <X size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            {/* Notes + Active */}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Notes</label>
                                <textarea value={formData.notes || ''} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm resize-none" rows={2}
                                    placeholder="Optional notes..." />
                            </div>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={formData.active !== false} onChange={e => setFormData(p => ({ ...p, active: e.target.checked }))}
                                    className="w-4 h-4 rounded" />
                                <span className="text-sm text-slate-600">Active (shown in dropdowns)</span>
                            </label>

                            <button onClick={handleSubmit} disabled={saving || !pctValid}
                                className="w-full bg-violet-600 text-white font-bold py-2.5 rounded-lg hover:bg-violet-700 mt-2 flex items-center justify-center gap-2 disabled:opacity-50 transition-all">
                                <Save size={16} /> {saving ? 'Saving...' : editingId ? 'Update Term' : 'Save Term'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PaymentTerms;
