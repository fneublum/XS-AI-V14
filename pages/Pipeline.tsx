
import React, { useState, useEffect, useRef } from 'react';
import { DealStage, Opportunity, Customer, Product, Company, OpportunityItem, Document } from '../types';
import { Plus, X, Save, DollarSign, Calendar, BarChart3, Building2, Package, Pencil, Trash2, Eye, TrendingUp, User, MessageSquare, Building, FileCheck, FileText, Upload, Download, CheckCircle2 } from 'lucide-react';
import { QuantityInput, PriceInput } from '../components/UnitInputs';

interface PipelineProps {
    opportunities: Opportunity[];
    onAdd: (o: Opportunity) => void;
    onUpdate: (o: Opportunity) => void;
    onDelete: (id: string) => void;
    customers: Customer[];
    products: Product[];
    currentCompanyId: string;
    availableCompanies: Company[];
    initialStage?: DealStage | null;
    documents?: Document[];
    onAddDocument?: (d: Document) => void;
    onDeleteDocument?: (id: string) => void;
    addProduct: (p: Product) => void;
    addCustomer: (c: Customer) => void;
}

const Pipeline: React.FC<PipelineProps> = ({
    opportunities, onAdd, onUpdate, onDelete,
    customers, products, currentCompanyId, availableCompanies, initialStage,
    documents = [], onAddDocument, onDeleteDocument, addProduct, addCustomer
}) => {
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draftId, setDraftId] = useState<string>(''); // Store ID for new items to link docs before save
    const [viewingOpportunity, setViewingOpportunity] = useState<Opportunity | null>(null);
    const [uploadStatus, setUploadStatus] = useState<'idle' | 'success'>('idle');
    const [productAddedMessage, setProductAddedMessage] = useState('');
    const [showQuickAddCustomer, setShowQuickAddCustomer] = useState(false);
    const [newCustomerName, setNewCustomerName] = useState('');
    const [customerAddedMessage, setCustomerAddedMessage] = useState('');
    const [showQuickAddProductModal, setShowQuickAddProductModal] = useState(false);

    // Ref to store column elements for scrolling
    const stageColumnRefs = useRef<{ [key in DealStage]?: HTMLDivElement | null }>({});

    // Scroll to initial stage on mount or change
    useEffect(() => {
        if (initialStage && stageColumnRefs.current[initialStage]) {
            stageColumnRefs.current[initialStage]?.scrollIntoView({
                behavior: 'smooth',
                inline: 'center',
                block: 'nearest'
            });

            // Add a temporary highlight effect
            const el = stageColumnRefs.current[initialStage];
            if (el) {
                el.classList.add('ring-2', 'ring-blue-500', 'ring-offset-2');
                setTimeout(() => {
                    el.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-2');
                }, 2000);
            }
        }
    }, [initialStage]);

    // Initial state for useState initialization only
    const getInitialState = () => ({
        customerId: '',
        customerName: '',
        productName: '', // Summary field
        volumeLBS: 0,    // Summary field
        value: 0,        // Summary field
        stage: DealStage.LEAD,
        probability: 10,
        expectedCloseDate: new Date().toISOString().split('T')[0],
        assignedTo: 'Me',
        comments: '',
        companyId: currentCompanyId === 'ALL' && availableCompanies.length > 0 ? availableCompanies[0].id : currentCompanyId,
        poNumber: '',
        items: []
    });

    const [formData, setFormData] = useState<Partial<Opportunity>>(getInitialState());

    // New Item State for Form - 'price' is Unit Price ($/LB)
    const [currentItem, setCurrentItem] = useState<{ product: string, volume: number, price: number }>({ product: '', volume: 0, price: 0 });
    const [newProductName, setNewProductName] = useState('');

    const columns = [DealStage.LEAD, DealStage.FIRST_CONTACT, DealStage.REQUIREMENTS, DealStage.QUOTE_SENT, DealStage.NEGOTIATION, DealStage.PO_EXPECTED, DealStage.PO_RECEIVED, DealStage.PO_DELIVERED];

    const getStageColor = (stage: DealStage) => {
        switch (stage) {
            case DealStage.LEAD: return 'bg-slate-500';
            case DealStage.FIRST_CONTACT: return 'bg-cyan-500';
            case DealStage.REQUIREMENTS: return 'bg-blue-500';
            case DealStage.QUOTE_SENT: return 'bg-indigo-500';
            case DealStage.NEGOTIATION: return 'bg-amber-500';
            case DealStage.PO_EXPECTED: return 'bg-emerald-500';
            case DealStage.PO_RECEIVED: return 'bg-teal-600';
            case DealStage.PO_DELIVERED: return 'bg-blue-700';
            default: return 'bg-slate-400';
        }
    };

    const handleAddNew = (e?: React.MouseEvent, targetStage?: DealStage) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        // Generate ID immediately so documents can be linked before saving
        const newId = `O${Date.now()}`;
        setDraftId(newId);

        setFormData({
            ...getInitialState(), // Ensure fresh state
            id: newId,
            stage: targetStage || DealStage.LEAD,
            companyId: currentCompanyId === 'ALL' && availableCompanies.length > 0 ? availableCompanies[0].id : currentCompanyId
        });
        setEditingId(null);
        setUploadStatus('idle');
        setShowForm(true);
    };

    const handleEdit = (deal: Opportunity, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const formDataFromDeal: Partial<Opportunity> = {
            id: deal.id,
            companyId: deal.companyId,
            customerId: deal.customerId || '',
            customerName: deal.customerName || '',
            productName: deal.productName || '',
            volumeLBS: deal.volumeLBS || 0,
            value: deal.value || 0,
            items: deal.items ? [...deal.items] : [],
            stage: deal.stage || DealStage.LEAD,
            probability: deal.probability || 0,
            expectedCloseDate: deal.expectedCloseDate || new Date().toISOString().split('T')[0],
            assignedTo: deal.assignedTo || 'Me',
            comments: deal.comments || '',
            poNumber: deal.poNumber || ''
        };

        setFormData(formDataFromDeal);
        setEditingId(deal.id);
        setDraftId('');
        setUploadStatus('idle');
        setShowForm(true);
    };

    const handleDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        onDelete(id);
        if (editingId === id) {
            setShowForm(false);
            setEditingId(null);
        }
    };

    const handleView = (deal: Opportunity, e: React.MouseEvent) => {
        e.stopPropagation();
        setViewingOpportunity(deal);
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        if (name === 'customerId') {
            if (value === '_ADD_NEW_') {
                setShowQuickAddCustomer(true);
                setFormData(prev => ({ ...prev, customerId: '' }));
                return;
            }
            const selectedCustomer = customers.find(c => c.id === value);
            setFormData(prev => ({
                ...prev,
                customerId: value,
                customerName: selectedCustomer ? selectedCustomer.name : ''
            }));
        } else {
            setFormData(prev => ({
                ...prev,
                [name]: (name === 'probability') ? Number(value) : value
            }));
        }
    };

    const handleQuickAddProduct = async () => {
        if (!newProductName.trim()) return;

        const newId = `P${Date.now()}`;
        const companyId = formData.companyId || (currentCompanyId === 'ALL' && availableCompanies.length > 0 ? availableCompanies[0].id : currentCompanyId);

        const newProduct: Product = {
            id: newId,
            companyId: companyId,
            name: newProductName.trim(),
            category: 'Resin', // Default
            grade: 'New', // Default
            hsCode: '',
            specs: {
                origin: 'Unknown',
                type: 'N/A',
                color: 'N/A',
                reinforced: 'N/A',
                additives: 'N/A',
                form: 'Pellets'
            },
            supplier: 'New Supplier', // Default
            price: 0,
            stockStatus: 'Available',
        };

        await addProduct(newProduct);

        // UX: auto-select the new product
        setCurrentItem(prev => ({
            ...prev,
            product: `${newProduct.name} - ${newProduct.grade}`
        }));

        setNewProductName('');
        setShowQuickAddProductModal(false);
        setProductAddedMessage('Product added!');
        setTimeout(() => setProductAddedMessage(''), 3000);
    };

    const handleQuickAddCustomer = async () => {
        if (!newCustomerName.trim()) return;

        const companyId = formData.companyId || (currentCompanyId === 'ALL' && availableCompanies.length > 0 ? availableCompanies[0].id : currentCompanyId);

        const newCustomer: Customer = {
            id: `C${Date.now()}`,
            companyId: companyId,
            name: newCustomerName.trim(),
            nickname: '',
            contactPerson: 'N/A',
            email: 'tbd@example.com',
            phone: 'N/A',
            creditLimit: 0,
            paymentTerms: 'Net 30',
            status: 'Active',
            lastOrderDate: new Date().toISOString().split('T')[0],
            totalVolumeLBS: 0
        };

        await addCustomer(newCustomer);

        // Auto-select the new customer
        setFormData(prev => ({
            ...prev,
            customerId: newCustomer.id,
            customerName: newCustomer.name,
        }));

        setNewCustomerName('');
        setShowQuickAddCustomer(false);
        setCustomerAddedMessage('Customer added!');
        setTimeout(() => setCustomerAddedMessage(''), 3000);
    };

    const handleAddItem = () => {
        if (!currentItem.product || currentItem.volume <= 0) return;

        // Calculate Total Value = Volume * Unit Price
        const calculatedValue = currentItem.volume * currentItem.price;

        const newItem: OpportunityItem = {
            productId: 'TEMP', // In real app, match to product ID
            productName: currentItem.product,
            volumeLBS: currentItem.volume,
            value: calculatedValue
        };

        setFormData(prev => {
            const newItems = [...(prev.items || []), newItem];
            const totalVol = newItems.reduce((sum, i) => sum + i.volumeLBS, 0);
            const totalVal = newItems.reduce((sum, i) => sum + i.value, 0);

            return {
                ...prev,
                items: newItems,
                volumeLBS: totalVol,
                value: totalVal,
                productName: newItems.length === 1 ? newItems[0].productName : `${newItems.length} Products`
            }
        });
        setCurrentItem({ product: '', volume: 0, price: 0 });
    };

    const handleRemoveItem = (index: number) => {
        setFormData(prev => {
            const newItems = [...(prev.items || [])];
            newItems.splice(index, 1);
            const totalVol = newItems.reduce((sum, i) => sum + i.volumeLBS, 0);
            const totalVal = newItems.reduce((sum, i) => sum + i.value, 0);

            return {
                ...prev,
                items: newItems,
                volumeLBS: totalVol,
                value: totalVal,
                productName: newItems.length === 0 ? '' : (newItems.length === 1 ? newItems[0].productName : `${newItems.length} Products`)
            }
        });
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, docType: 'PO' | 'BL' | 'INVOICE' | 'OTHER' = 'OTHER') => {
        if (e.target.files && e.target.files[0] && onAddDocument) {
            const file = e.target.files[0];
            const reader = new FileReader();

            // Use editingId if editing, or draftId if creating new
            const targetEntityId = editingId || draftId;

            reader.onload = (event) => {
                const base64String = event.target?.result as string;
                const newDoc: Document = {
                    id: `DOC${Date.now()}`,
                    companyId: formData.companyId || currentCompanyId,
                    entityId: targetEntityId,
                    entityType: 'OPPORTUNITY',
                    type: docType,
                    name: file.name,
                    url: base64String,
                    uploadDate: new Date().toISOString().split('T')[0],
                    size: file.size
                };
                onAddDocument(newDoc);
                setUploadStatus('success');
                setTimeout(() => setUploadStatus('idle'), 3000);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        const dealData = {
            ...formData,
            productName: formData.productName || 'General Product',
            volumeLBS: formData.volumeLBS || 0,
            value: formData.value || 0
        };

        if (editingId) {
            onUpdate({ ...dealData, id: editingId } as Opportunity);
        } else {
            const newDeal: Opportunity = {
                id: draftId, // Use the draft ID that documents are linked to
                companyId: formData.companyId || currentCompanyId,
                customerId: formData.customerId || 'UNKNOWN',
                customerName: formData.customerName || 'Unknown Customer',
                productName: dealData.productName || 'General Product',
                volumeLBS: dealData.volumeLBS || 0,
                value: dealData.value || 0,
                items: dealData.items || [],
                stage: formData.stage as DealStage,
                probability: formData.probability || 10,
                expectedCloseDate: formData.expectedCloseDate || '',
                assignedTo: formData.assignedTo || 'Me',
                comments: formData.comments || '',
                poNumber: formData.poNumber || ''
            };
            onAdd(newDeal);
        }

        setShowForm(false);
        setEditingId(null);
        setDraftId('');
    };

    // Filter docs for current form (using editingId or draftId)
    const currentEntityId = editingId || draftId;
    const dealDocuments = currentEntityId ? documents.filter(d => d.entityId === currentEntityId) : [];

    const openDocument = (docUrl: string) => {
        try {
            fetch(docUrl)
                .then(res => res.blob())
                .then(blob => {
                    const url = URL.createObjectURL(blob);
                    window.open(url, '_blank');
                });
        } catch (e) {
            window.open(docUrl, '_blank');
        }
    };

    return (
        <div className="h-[calc(100vh-8rem)] flex flex-col relative">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-slate-800">Opportunity Pipeline</h2>
                <button
                    type="button"
                    onClick={(e) => handleAddNew(e)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                >
                    <Plus size={18} /><span>New Deal</span>
                </button>
            </div>

            <div className="flex-1 overflow-x-auto pb-4 custom-scrollbar">
                <div className="flex gap-4 min-w-max h-full px-1">
                    {columns.map((stage) => {
                        const stageDeals = opportunities.filter(op => op.stage === stage);
                        const stageValue = stageDeals.reduce((sum, op) => sum + op.value, 0);

                        return (
                            <div
                                key={stage}
                                ref={(el) => { stageColumnRefs.current[stage] = el; }}
                                className="w-80 flex flex-col bg-slate-100 rounded-xl p-3 h-full border border-slate-200 transition-shadow duration-300"
                            >
                                <div className="flex justify-between items-center mb-3 px-1">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-3 h-3 rounded-full ${getStageColor(stage)}`}></div>
                                        <span className="font-semibold text-slate-700 text-sm">{stage}</span>
                                        <span className="text-xs text-slate-400 bg-slate-200 px-2 py-0.5 rounded-full">{stageDeals.length}</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={(e) => handleAddNew(e, stage)}
                                        className="text-slate-400 hover:text-blue-600 p-1 rounded-full hover:bg-slate-200 transition-colors"
                                        title={`Add new ${stage} deal`}
                                    >
                                        <Plus size={16} />
                                    </button>
                                </div>
                                <div className="flex-1 overflow-y-auto space-y-3 pr-1 custom-scrollbar">
                                    {stageDeals.map((deal) => {
                                        const hasPo = documents.find(d => d.entityId === deal.id && d.type === 'PO');
                                        return (
                                            <div key={deal.id} onClick={(e) => handleView(deal, e)} className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 hover:shadow-md transition-shadow cursor-pointer group relative">
                                                {hasPo && (
                                                    <div className="absolute top-3 right-3 text-emerald-600 bg-white shadow-sm p-1 rounded-full border border-emerald-100 z-10" title="PO Uploaded">
                                                        <FileCheck size={14} />
                                                    </div>
                                                )}
                                                <div className="flex justify-between items-start mb-2">
                                                    <span className="text-xs font-medium text-slate-500 uppercase tracking-wider truncate max-w-[140px]" title={deal.productName}>
                                                        {(deal.items && deal.items.length > 1) ? `${deal.items.length} Products` : deal.productName}
                                                    </span>
                                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded px-1 -mr-2 z-20">
                                                        <button onClick={(e) => handleView(deal, e)} className="text-slate-400 hover:text-blue-500 p-1 rounded hover:bg-slate-50" title="View Details"><Eye size={14} /></button>
                                                        <button onClick={(e) => handleEdit(deal, e)} className="text-slate-400 hover:text-amber-500 p-1 rounded hover:bg-slate-50" title="Edit Deal"><Pencil size={14} /></button>
                                                        <button onClick={(e) => handleDelete(deal.id, e)} className="text-slate-400 hover:text-red-500 p-1 rounded hover:bg-slate-50" title="Delete Deal"><Trash2 size={14} /></button>
                                                    </div>
                                                </div>
                                                <h4 className="font-bold text-slate-800 mb-1 truncate" title={deal.customerName}>{deal.customerName}</h4>
                                                {deal.poNumber && (
                                                    <div className="text-[10px] text-slate-500 font-mono bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100 w-fit mb-1 flex items-center gap-1">
                                                        <FileCheck size={10} className="text-blue-500" /> {deal.poNumber}
                                                    </div>
                                                )}
                                                {currentCompanyId === 'ALL' && <div className="flex items-center gap-1 mb-2"><Building size={10} className="text-slate-400" /><span className="text-[10px] text-slate-500 bg-slate-50 border border-slate-100 px-1 rounded">{availableCompanies.find(c => c.id === deal.companyId)?.name || deal.companyId}</span></div>}
                                                <div className="flex justify-between items-end mt-3">
                                                    <div><p className="text-sm font-semibold text-slate-900">${deal.value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p><p className="text-xs text-slate-500">{deal.volumeLBS.toLocaleString()} LBS</p></div>
                                                    <div className="flex flex-col items-end"><span className={`text-[10px] px-2 py-1 rounded border ${deal.probability > 60 ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-amber-50 text-amber-600 border-amber-100'}`}>{deal.probability}% Prob.</span></div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                    {stageDeals.length === 0 && <div className="h-24 border-2 border-dashed border-slate-300 rounded-lg flex items-center justify-center text-slate-400 text-sm">No Deals</div>}
                                </div>
                                <div className="mt-3 pt-3 border-t border-slate-200 px-1"><div className="flex justify-between items-center text-sm"><span className="text-slate-500">Total Value</span><span className="font-bold text-slate-800">${stageValue.toLocaleString()}</span></div></div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {showForm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={(e) => { if (e.target === e.currentTarget) { setShowForm(false); setEditingId(null); setDraftId(''); } }}>
                    <div
                        key={editingId || draftId}
                        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden animate-in zoom-in-95 duration-200"
                    >
                        <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-white sticky top-0 z-20">
                            <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">{editingId ? <Pencil size={20} className="text-blue-600" /> : <Plus size={20} className="text-blue-600" />} {editingId ? 'Edit Opportunity' : 'New Opportunity'}</h3>
                            <button type="button" onClick={() => { setShowForm(false); setEditingId(null); setDraftId(''); }} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition-colors"><X size={24} /></button>
                        </div>

                        <div className="p-6">
                            <form onSubmit={handleSubmit} className="space-y-5">
                                {showQuickAddCustomer && (
                                    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center animate-in fade-in duration-200" onClick={(e) => e.stopPropagation()}>
                                        <div className="bg-white p-6 rounded-lg shadow-xl space-y-4 w-96">
                                            <h4 className="font-bold text-lg">Quick Add Customer</h4>
                                            <div>
                                                <label className="block text-sm font-medium text-slate-700 mb-1">Customer Name</label>
                                                <input
                                                    type="text"
                                                    value={newCustomerName}
                                                    onChange={(e) => setNewCustomerName(e.target.value)}
                                                    className="w-full border border-slate-600 rounded-lg px-3 py-2 bg-slate-900 text-white placeholder-slate-400"
                                                    placeholder="Enter new customer's company name"
                                                    autoFocus
                                                />
                                            </div>
                                            <div className="flex justify-end gap-2 pt-2">
                                                <button type="button" onClick={() => setShowQuickAddCustomer(false)} className="px-4 py-2 bg-slate-100 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors">Cancel</button>
                                                <button type="button" onClick={handleQuickAddCustomer} disabled={!newCustomerName.trim()} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50">Add Customer</button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                {showQuickAddProductModal && (
                                    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center animate-in fade-in duration-200" onClick={(e) => e.stopPropagation()}>
                                        <div className="bg-white p-6 rounded-lg shadow-xl space-y-4 w-96">
                                            <h4 className="font-bold text-lg">Quick Add Product</h4>
                                            <div>
                                                <label className="block text-sm font-medium text-slate-700 mb-1">Product Name</label>
                                                <input
                                                    type="text"
                                                    value={newProductName}
                                                    onChange={(e) => setNewProductName(e.target.value)}
                                                    className="w-full border border-slate-600 rounded-lg px-3 py-2 bg-slate-900 text-white placeholder-slate-400"
                                                    placeholder="Enter new product name"
                                                    autoFocus
                                                />
                                            </div>
                                            <div className="flex justify-end gap-2 pt-2">
                                                <button type="button" onClick={() => setShowQuickAddProductModal(false)} className="px-4 py-2 bg-slate-100 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors">Cancel</button>
                                                <button type="button" onClick={handleQuickAddProduct} disabled={!newProductName.trim()} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50">Add Product</button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                {currentCompanyId === 'ALL' && (
                                    <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                                        <label className="block text-xs font-bold text-blue-800 uppercase mb-1">Assign to Company</label>
                                        <select required name="companyId" value={formData.companyId} onChange={handleInputChange} className="w-full border border-slate-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 bg-slate-900 text-white">
                                            {[...availableCompanies].sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>
                                    </div>
                                )}
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Customer Name *</label>
                                    <div className="relative"><Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <select required name="customerId" value={formData.customerId || ''} onChange={handleInputChange} className="w-full pl-9 pr-3 py-2 border border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm appearance-none bg-slate-900 text-white">
                                            <option value="">Select a Customer...</option>
                                            <option value="_ADD_NEW_" className="font-bold text-blue-600 bg-blue-50">+ Add New Customer...</option>
                                            {customers.filter(c => currentCompanyId === 'ALL' ? (formData.companyId ? c.companyId === formData.companyId : true) : true).sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={c.id} value={c.id}>{c.name} {c.nickname ? `(${c.nickname})` : ''}</option>)}
                                        </select>
                                    </div>
                                    {customerAddedMessage && (
                                        <div className="text-emerald-600 text-xs font-medium mt-1 flex items-center gap-1 animate-in fade-in">
                                            <CheckCircle2 size={12} /> {customerAddedMessage}
                                        </div>
                                    )}
                                </div>

                                {/* Multi-Product Section */}
                                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                                    <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2"><Package size={14} /> Products & Volumes</h4>

                                    {/* Add Item Row */}
                                    <div className="grid grid-cols-1 gap-2 mb-3">
                                        <div>
                                            <label className="block text-[10px] text-slate-500 mb-1">Product</label>
                                            <select
                                                className="w-full text-xs border border-slate-600 rounded p-1.5 bg-slate-900 text-white"
                                                value={currentItem.product}
                                                onChange={e => {
                                                    if (e.target.value === '_ADD_NEW_') {
                                                        setShowQuickAddProductModal(true);
                                                        setCurrentItem({ ...currentItem, product: '' });
                                                    } else {
                                                        setCurrentItem({ ...currentItem, product: e.target.value });
                                                    }
                                                }}
                                            >
                                                <option value="">Select...</option>
                                                <option value="_ADD_NEW_" className="font-bold text-blue-600 bg-blue-50">+ Add New Product...</option>
                                                {[...products].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={`${p.name} - ${p.grade}`}>{p.name} ({p.grade})</option>)}
                                            </select>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <QuantityInput
                                                label="Volume"
                                                value={currentItem.volume || 0}
                                                onChange={(val) => setCurrentItem({ ...currentItem, volume: val })}
                                            />
                                            <PriceInput
                                                label="Price"
                                                value={currentItem.price || 0}
                                                onChange={(val) => setCurrentItem({ ...currentItem, price: val })}
                                            />
                                        </div>
                                        <div className="flex justify-end mt-2">
                                            <button type="button" onClick={handleAddItem} disabled={!currentItem.product} className="bg-blue-600 text-white px-4 py-1.5 rounded hover:bg-blue-700 text-xs font-bold flex items-center gap-1"><Plus size={12} /> Add Line Item</button>
                                        </div>
                                    </div>

                                    {productAddedMessage && (
                                        <div className="text-emerald-600 text-xs font-medium -mt-2 mb-3 flex items-center gap-1 animate-in fade-in">
                                            <CheckCircle2 size={12} />
                                            {productAddedMessage}
                                        </div>
                                    )}

                                    {/* Items List */}
                                    <div className="space-y-2">
                                        {(formData.items || []).map((item, idx) => {
                                            // Calculate unit price from total value / volume
                                            const unitPrice = item.volumeLBS > 0 ? item.value / item.volumeLBS : 0;
                                            return (
                                                <div key={idx} className="flex justify-between items-center bg-white p-2 rounded border border-slate-200 text-sm">
                                                    <div className="truncate flex-1 pr-2">
                                                        <span className="font-medium text-slate-800">{item.productName}</span>
                                                    </div>
                                                    <div className="text-right text-xs text-slate-500 flex gap-3 items-center">
                                                        <span className="hidden sm:inline bg-slate-50 px-1 rounded">{item.volumeLBS.toLocaleString()} LBS x ${unitPrice.toFixed(4)}/lb =</span>
                                                        <span className="font-mono text-slate-700 font-bold">${item.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                    </div>
                                                    <button type="button" onClick={() => handleRemoveItem(idx)} className="ml-2 text-slate-400 hover:text-red-500"><X size={14} /></button>
                                                </div>
                                            )
                                        })}
                                        {(formData.items || []).length === 0 && <p className="text-xs text-slate-400 italic text-center">No products added.</p>}
                                    </div>

                                    {/* Totals */}
                                    {(formData.items || []).length > 0 && (
                                        <div className="mt-3 pt-2 border-t border-slate-200 flex justify-between text-xs font-bold text-slate-700">
                                            <span>Total</span>
                                            <div className="flex gap-3">
                                                <span>{formData.volumeLBS?.toLocaleString()} LBS</span>
                                                <span>${formData.value?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-4">
                                    <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2"><BarChart3 size={14} /> Pipeline Settings</h4>
                                    <div><label className="block text-sm font-medium text-slate-700 mb-1">Stage</label><select name="stage" value={formData.stage} onChange={handleInputChange} className="w-full border border-slate-600 rounded-lg px-3 py-2 text-sm bg-slate-900 text-white">{Object.values(DealStage).map(stage => <option key={stage} value={stage}>{stage}</option>)}</select></div>

                                    {/* PO Number Input - Only shows when stage requires it */}
                                    {(formData.stage === DealStage.PO_RECEIVED || formData.stage === DealStage.PO_DELIVERED || formData.stage === DealStage.PO_EXPECTED) && (
                                        <div className="animate-in fade-in slide-in-from-top-2 p-3 bg-blue-50/50 rounded-lg border border-blue-100">
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Purchase Order (PO)</label>
                                            <div className="flex gap-2 items-center">
                                                <div className="relative flex-1">
                                                    <FileCheck size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                                    <input type="text" name="poNumber" value={formData.poNumber || ''} onChange={handleInputChange} className="w-full pl-8 pr-3 py-2 border border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-slate-900 text-white placeholder-slate-400" placeholder="PO Number" />
                                                </div>
                                                <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 shadow-sm whitespace-nowrap min-w-fit">
                                                    {uploadStatus === 'success' ? <CheckCircle2 size={16} className="text-white animate-in zoom-in" /> : <Upload size={16} />}
                                                    <span>{uploadStatus === 'success' ? 'Uploaded!' : 'Upload PO'}</span>
                                                    <input type="file" accept=".pdf" className="hidden" onChange={(e) => handleFileUpload(e, 'PO')} />
                                                </label>
                                            </div>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-2 gap-4">
                                        <div><label className="block text-sm font-medium text-slate-700 mb-1">Probability (%)</label><input type="number" min="0" max="100" name="probability" value={formData.probability} onChange={handleInputChange} className="w-full border border-slate-600 rounded-lg px-3 py-2 text-sm bg-slate-900 text-white" /></div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Target Close</label>
                                            <div className="relative">
                                                <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                                <input type="date" name="expectedCloseDate" value={formData.expectedCloseDate || ''} onChange={handleInputChange} className="w-full pl-8 pr-3 py-2 border border-slate-600 rounded-lg text-sm bg-slate-900 text-white" style={{ colorScheme: 'dark' }} />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Documents Section */}
                                {/* Always show this section for new deals too, using draftId */}
                                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                                    <div className="flex justify-between items-center mb-3">
                                        <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2"><FileText size={14} /> Documents</h4>
                                        <label className="cursor-pointer bg-white border border-slate-300 text-slate-600 px-2 py-1 rounded text-xs hover:bg-slate-50 flex items-center gap-1">
                                            <Upload size={12} /> Upload Other
                                            <input type="file" accept=".pdf" className="hidden" onChange={(e) => handleFileUpload(e, 'OTHER')} />
                                        </label>
                                    </div>
                                    <div className="space-y-2">
                                        {dealDocuments.map(doc => (
                                            <div key={doc.id} className="flex justify-between items-center bg-white p-2 rounded border border-slate-200 text-sm group">
                                                <div className="flex items-center gap-2 overflow-hidden">
                                                    <FileText size={14} className={doc.type === 'PO' ? 'text-emerald-500' : 'text-slate-400 shrink-0'} />
                                                    <div className="flex flex-col overflow-hidden">
                                                        <span className="truncate max-w-[180px] font-medium" title={doc.name}>{doc.name}</span>
                                                        <span className="text-[10px] text-slate-400 uppercase">{doc.type}</span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <button type="button" onClick={() => openDocument(doc.url)} className="text-slate-400 hover:text-blue-500"><Eye size={14} /></button>
                                                    <button type="button" onClick={() => onDeleteDocument && onDeleteDocument(doc.id)} className="text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
                                                </div>
                                            </div>
                                        ))}
                                        {dealDocuments.length === 0 && <p className="text-xs text-slate-400 italic text-center py-2">No documents uploaded.</p>}
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Comments <span className="text-slate-400 font-normal text-xs ml-1">(Max 500 chars)</span></label>
                                    <textarea name="comments" maxLength={500} rows={4} value={formData.comments || ''} onChange={handleInputChange} className="w-full border border-slate-600 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-none bg-slate-900 text-white placeholder-slate-400" placeholder="Add details about negotiations, next steps, or customer requirements..." />
                                    <p className="text-xs text-slate-400 text-right mt-1">{(formData.comments || '').length}/500</p>
                                </div>

                                <div className="pt-4 border-t border-slate-100 flex justify-end gap-3 mt-6">
                                    <button type="button" onClick={() => { setShowForm(false); setEditingId(null); setDraftId(''); }} className="px-4 py-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 font-medium transition-colors">Cancel</button>
                                    <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm"><Save size={18} /> {editingId ? 'Update Opportunity' : 'Create Opportunity'}</button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            {/* View Details Modal */}
            {viewingOpportunity && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-slate-50">
                            <div><h3 className="text-xl font-bold text-slate-800 flex items-center gap-2"><TrendingUp size={20} className="text-blue-600" /> Deal Details</h3><p className="text-slate-500 text-xs mt-1">ID: {viewingOpportunity.id}</p></div>
                            <button onClick={() => setViewingOpportunity(null)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-200 transition-colors"><X size={20} /></button>
                        </div>
                        <div className="p-6 space-y-6">
                            {/* View Original PO Button - PROMINENT */}
                            {documents.find(d => d.entityId === viewingOpportunity.id && d.type === 'PO') ? (
                                <div className="mb-2">
                                    <button
                                        onClick={() => openDocument(documents.find(d => d.entityId === viewingOpportunity.id && d.type === 'PO')!.url)}
                                        className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white py-3 rounded-lg font-bold hover:bg-emerald-700 transition-colors shadow-md"
                                    >
                                        <FileCheck size={20} /> View Original PO
                                    </button>
                                </div>
                            ) : viewingOpportunity.poNumber && (
                                <div className="mb-2 p-3 bg-slate-100 text-slate-500 rounded-lg text-center text-sm italic">
                                    PO Number recorded ({viewingOpportunity.poNumber}), but no file attached.
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1"><p className="text-xs font-bold text-slate-400 uppercase">Customer</p><p className="font-semibold text-slate-800 flex items-center gap-2"><Building2 size={14} className="text-slate-400" /> {viewingOpportunity.customerName}</p></div>
                                <div className="space-y-1"><p className="text-xs font-bold text-slate-400 uppercase">Assigned To</p><p className="font-semibold text-slate-800 flex items-center gap-2"><User size={14} className="text-slate-400" /> {viewingOpportunity.assignedTo}</p></div>
                            </div>

                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 space-y-3">
                                <div className="border-b border-slate-200 pb-2 mb-2">
                                    <p className="text-xs font-bold text-slate-500 uppercase mb-2">Products Breakdown</p>
                                    {(viewingOpportunity.items && viewingOpportunity.items.length > 0) ? (
                                        viewingOpportunity.items.map((item, i) => {
                                            const unitPrice = item.volumeLBS > 0 ? item.value / item.volumeLBS : 0;
                                            return (
                                                <div key={i} className="flex justify-between text-sm text-slate-700 mb-2 pb-2 border-b border-slate-100 last:border-0 last:pb-0">
                                                    <div>
                                                        <span className="block font-medium">{item.productName}</span>
                                                        <span className="text-xs text-slate-500 font-mono">{item.volumeLBS.toLocaleString()} lbs × ${unitPrice.toFixed(4)}/lb</span>
                                                    </div>
                                                    <span className="font-mono font-bold text-slate-800">${item.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                </div>
                                            )
                                        })
                                    ) : (
                                        <div className="flex justify-between items-center"><span className="text-sm text-slate-600">{viewingOpportunity.productName}</span></div>
                                    )}
                                </div>
                                <div className="flex justify-between items-center border-b border-slate-200 pb-2"><span className="text-sm text-slate-600">Total Volume</span><span className="font-semibold text-slate-800">{viewingOpportunity.volumeLBS.toLocaleString()} LBS</span></div>

                                {/* Explicit Total Value Display */}
                                <div className="flex justify-between items-center pt-2">
                                    <span className="text-sm font-bold text-slate-700">TOTAL DEAL VALUE</span>
                                    <span className="font-extrabold text-emerald-600 text-xl tracking-tight">${viewingOpportunity.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                            </div>

                            {viewingOpportunity.poNumber && (
                                <div className="p-3 bg-emerald-50 rounded border border-emerald-100 flex items-center gap-2">
                                    <FileCheck size={16} className="text-emerald-600" />
                                    <span className="text-sm font-bold text-emerald-800">PO #: {viewingOpportunity.poNumber}</span>
                                </div>
                            )}

                            {/* View Documents */}
                            {documents.filter(d => d.entityId === viewingOpportunity.id).length > 0 && (
                                <div>
                                    <p className="text-xs font-bold text-slate-400 uppercase mb-2">All Documents</p>
                                    <div className="space-y-1">
                                        {documents.filter(d => d.entityId === viewingOpportunity.id).map(doc => (
                                            <button key={doc.id} onClick={() => openDocument(doc.url)} className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                                                <FileText size={14} className={doc.type === 'PO' ? 'text-emerald-500' : 'text-slate-400'} />
                                                {doc.name}
                                                <span className="text-[10px] text-slate-400 border border-slate-200 px-1 rounded">{doc.type}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-3 bg-blue-50 rounded border border-blue-100"><p className="text-xs text-blue-500 mb-1">Stage</p><p className="font-semibold text-blue-800 text-sm">{viewingOpportunity.stage}</p></div>
                                <div className={`p-3 rounded border ${viewingOpportunity.probability > 50 ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100'}`}><p className={`text-xs mb-1 ${viewingOpportunity.probability > 50 ? 'text-emerald-500' : 'text-amber-500'}`}>Probability</p><p className={`font-semibold text-sm ${viewingOpportunity.probability > 50 ? 'text-emerald-800' : 'text-amber-800'}`}>{viewingOpportunity.probability}%</p></div>
                            </div>
                        </div>
                        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
                            <button onClick={(e) => { setViewingOpportunity(null); handleEdit(viewingOpportunity, e); }} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium shadow-sm flex items-center gap-2"><Pencil size={14} /> Edit</button>
                            <button onClick={() => setViewingOpportunity(null)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium shadow-sm">Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Pipeline;
