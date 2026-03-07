
import React, { useState, useEffect } from 'react';
import { SupplierOffer, Supplier, Product, Port, SupplierQuoteItem, Company, SavedLocation } from '../types';
import { Plus, X, Save, Trash2, Tag, Calendar, Clock, Pencil, CheckCircle2, MapPin, Anchor, ArrowRight, AlertCircle, FileText, LayoutGrid, List, Building, FilePlus } from 'lucide-react';
import { PAYMENT_TERM_OPTIONS } from '../constants';
import { QuantityInput, PriceInput } from '../components/UnitInputs';

interface SupplierOffersProps {
    offers: SupplierOffer[];
    onAdd: (q: SupplierOffer) => void;
    onUpdate: (q: SupplierOffer) => void;
    onDelete: (id: string) => void;
    suppliers: Supplier[];
    products: Product[];
    onAddProduct: (p: Product) => void;
    onAddSupplier: (s: Supplier) => void;
    ports: Port[];
    onAddPort: (p: Port) => void;
    locations: SavedLocation[];
    onAddLocation: (l: SavedLocation) => void;
    dbError?: string | null;
    currentCompanyId: string;
    availableCompanies: Company[];
    initialEditId?: string | null;
}

const SupplierOffers: React.FC<SupplierOffersProps> = ({ offers, onAdd, onUpdate, onDelete, suppliers, products, onAddProduct, onAddSupplier, ports, onAddPort, locations, onAddLocation, dbError, currentCompanyId, availableCompanies, initialEditId }) => {
    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

    // Quick Add State
    const [showQuickAddSupplier, setShowQuickAddSupplier] = useState(false);
    const [newSupplierName, setNewSupplierName] = useState('');
    const [showQuickAddProduct, setShowQuickAddProduct] = useState(false);
    const [newProductName, setNewProductName] = useState('');
    const [supplierAddedMessage, setSupplierAddedMessage] = useState('');
    const [productAddedMessage, setProductAddedMessage] = useState('');

    // Port Quick Add
    const [showQuickAddPort, setShowQuickAddPort] = useState(false);
    const [newPortCode, setNewPortCode] = useState('');
    const [newPortName, setNewPortName] = useState('');
    const [newPortCountry, setNewPortCountry] = useState('');
    const [portAddedMessage, setPortAddedMessage] = useState('');
    const [targetPortField, setTargetPortField] = useState<'origin' | 'destination' | null>(null);

    // Location Quick Add
    const [showQuickAddLocation, setShowQuickAddLocation] = useState(false);
    const [newLocName, setNewLocName] = useState('');
    const [newLocAddress, setNewLocAddress] = useState('');
    const [newLocCity, setNewLocCity] = useState('');
    const [newLocState, setNewLocState] = useState('');
    const [newLocZip, setNewLocZip] = useState('');
    const [locationAddedMessage, setLocationAddedMessage] = useState('');

    const initialFormState: Partial<SupplierOffer> = {
        supplierId: '',
        supplierName: '',
        items: [],
        totalAmount: 0,
        currency: 'USD',
        incoterm: 'FOB',
        loadingLocation: '',
        originPort: '',
        destinationPort: '',
        validUntil: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        paymentTerms: 'Net 30',
        status: 'Received',
        notes: '',
        companyId: currentCompanyId === 'ALL' ? '' : currentCompanyId
    };
    const [formData, setFormData] = useState<Partial<SupplierOffer>>(initialFormState);
    const [currentItem, setCurrentItem] = useState<Partial<SupplierQuoteItem>>({ productName: '', quantity: 0, unitPrice: 0, moq: 0, leadTime: '' });
    const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);

    // Auto-open edit form when navigated from another page with initialEditId
    useEffect(() => {
        if (initialEditId && offers.length > 0) {
            const offer = offers.find(o => o.id === initialEditId);
            if (offer) {
                const formDataFromOffer: Partial<SupplierOffer> = {
                    id: offer.id,
                    offerNumber: offer.offerNumber || '',
                    companyId: offer.companyId,
                    supplierId: offer.supplierId || '',
                    supplierName: offer.supplierName || '',
                    items: offer.items ? [...offer.items] : [],
                    totalAmount: offer.totalAmount || 0,
                    currency: offer.currency || 'USD',
                    incoterm: offer.incoterm || 'FOB',
                    loadingLocation: offer.loadingLocation || '',
                    originPort: offer.originPort || '',
                    destinationPort: offer.destinationPort || '',
                    validUntil: offer.validUntil || '',
                    paymentTerms: offer.paymentTerms || '',
                    status: offer.status || 'Received',
                    notes: offer.notes || ''
                };
                setFormData(formDataFromOffer);
                setEditingId(offer.id);
                setIsAdding(true);
            }
        }
    }, [initialEditId, offers]);

    const handleAddNew = () => {
        setFormData(initialFormState);
        setEditingId(null);
        setIsAdding(true);
    };

    const handleEdit = (offer: SupplierOffer, e: React.MouseEvent) => {
        e.stopPropagation();
        const formDataFromOffer: Partial<SupplierOffer> = {
            id: offer.id,
            offerNumber: offer.offerNumber || '',
            companyId: offer.companyId,
            supplierId: offer.supplierId || '',
            supplierName: offer.supplierName || '',
            items: offer.items ? [...offer.items] : [],
            totalAmount: offer.totalAmount || 0,
            currency: offer.currency || 'USD',
            incoterm: offer.incoterm || 'FOB',
            loadingLocation: offer.loadingLocation || '',
            originPort: offer.originPort || '',
            destinationPort: offer.destinationPort || '',
            validUntil: offer.validUntil || new Date().toISOString().split('T')[0],
            paymentTerms: offer.paymentTerms || 'Net 30',
            status: offer.status || 'Received',
            notes: offer.notes || ''
        };
        setFormData(formDataFromOffer);
        setEditingId(offer.id);
        setIsAdding(true);
    };

    const handleDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (window.confirm('Delete this offer?')) {
            onDelete(id);
        }
    };

    const handleQuickAddSupplier = async () => {
        if (!newSupplierName.trim()) return;

        const companyIdForNewRecord = formData.companyId || (currentCompanyId === 'ALL' ? '' : currentCompanyId);
        if (!companyIdForNewRecord) {
            alert("Please select a company before adding a supplier.");
            return;
        }

        const newSupplier: Supplier = {
            id: `SUP${Date.now()}`,
            companyId: companyIdForNewRecord,
            name: newSupplierName.trim(),
            contactPerson: 'N/A',
            email: 'tbd@example.com',
            phone: 'N/A',
            country: 'Unknown',
            categories: [],
            rating: 3,
            paymentTerms: 'Net 30'
        };

        await onAddSupplier(newSupplier);

        setFormData(prev => ({
            ...prev,
            supplierId: newSupplier.id,
            supplierName: newSupplier.name
        }));

        setNewSupplierName('');
        setShowQuickAddSupplier(false);
        setSupplierAddedMessage('Supplier added!');
        setTimeout(() => setSupplierAddedMessage(''), 3000);
    };

    const handleQuickAddProduct = async () => {
        if (!newProductName.trim()) return;

        const companyIdForNewRecord = formData.companyId || (currentCompanyId === 'ALL' ? '' : currentCompanyId);
        if (!companyIdForNewRecord) {
            alert("Please select a company before adding a product.");
            return;
        }

        const newProduct: Product = {
            id: `P${Date.now()}`,
            companyId: companyIdForNewRecord,
            name: newProductName.trim(),
            category: 'Resin',
            grade: 'New',
            hsCode: '',
            supplier: formData.supplierName || 'New Supplier',
            price: 0,
            stockStatus: 'Available',
            specs: {
                origin: 'Unknown',
                type: 'N/A',
                color: 'N/A',
                reinforced: 'N/A',
                additives: 'N/A',
                form: 'Pellets'
            }
        };

        await onAddProduct(newProduct);

        setCurrentItem(prev => ({ ...prev, productName: newProduct.name }));

        setNewProductName('');
        setShowQuickAddProduct(false);
        setProductAddedMessage('Product added!');
        setTimeout(() => setProductAddedMessage(''), 3000);
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
            setFormData(prev => ({ ...prev, originPort: `${newPort.name} (${newPort.code})` }));
        } else if (targetPortField === 'destination') {
            setFormData(prev => ({ ...prev, destinationPort: `${newPort.name} (${newPort.code})` }));
        }

        setNewPortCode('');
        setNewPortName('');
        setNewPortCountry('');
        setShowQuickAddPort(false);
        setPortAddedMessage('Port added!');
        setTimeout(() => setPortAddedMessage(''), 3000);
    };

    const handleQuickAddLocation = async () => {
        if (!newLocName) return;
        const companyIdForNewRecord = formData.companyId || (currentCompanyId === 'ALL' ? '' : currentCompanyId);

        const newLocation: SavedLocation = {
            id: `LOC${Date.now()}`,
            companyId: companyIdForNewRecord || 'ALL',
            code: `LOC-${Math.floor(Math.random() * 1000)}`,
            name: newLocName,
            address: newLocAddress,
            city: newLocCity,
            state: newLocState,
            zip: newLocZip,
            country: 'USA',
            entityType: 'WAREHOUSE',
            entityId: '',
            entityName: ''
        };

        await onAddLocation(newLocation);

        const addressString = `${newLocation.address ? newLocation.address + ', ' : ''}${newLocation.city}, ${newLocation.state}`;
        setFormData(prev => ({ ...prev, loadingLocation: addressString }));

        setShowQuickAddLocation(false);
        setNewLocName(''); setNewLocAddress(''); setNewLocCity(''); setNewLocState(''); setNewLocZip('');
        setLocationAddedMessage('Location saved & applied!');
        setTimeout(() => setLocationAddedMessage(''), 3000);
    };

    const handleLocationSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value;
        if (val === '_ADD_NEW_') {
            setShowQuickAddLocation(true);
            return;
        }

        const loc = locations.find(l => l.id === val);
        if (loc) {
            let addr = loc.address || '';
            if (loc.city && loc.state) {
                addr = addr ? `${addr}, ${loc.city}, ${loc.state}` : `${loc.city}, ${loc.state}`;
            }
            // Fallback if empty
            if (!addr) addr = loc.name;

            setFormData(prev => ({ ...prev, loadingLocation: addr }));
        }
    };

    const handleAddItem = () => {
        if (!currentItem.productName || !currentItem.quantity || !currentItem.unitPrice) return;
        const total = currentItem.quantity * currentItem.unitPrice;
        const newItem: SupplierQuoteItem = { ...currentItem, total } as SupplierQuoteItem;

        if (editingItemIndex !== null) {
            // Update existing item in-place
            setFormData(prev => {
                const items = [...(prev.items || [])];
                const oldTotal = items[editingItemIndex]?.total || 0;
                items[editingItemIndex] = newItem;
                return {
                    ...prev,
                    items,
                    totalAmount: (prev.totalAmount || 0) - oldTotal + total
                };
            });
            setEditingItemIndex(null);
        } else {
            // Add new item
            setFormData(prev => ({
                ...prev,
                items: [...(prev.items || []), newItem],
                totalAmount: (prev.totalAmount || 0) + total
            }));
        }
        setCurrentItem({ productName: '', quantity: 0, unitPrice: 0, moq: 0, leadTime: '' });
    };

    const handleRemoveItem = (index: number) => {
        setFormData(prev => {
            const newItems = [...(prev.items || [])];
            const removed = newItems.splice(index, 1)[0];
            return {
                ...prev,
                items: newItems,
                totalAmount: (prev.totalAmount || 0) - removed.total
            };
        });
    };

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        const companyIdForNewRecord = formData.companyId || (currentCompanyId === 'ALL' ? '' : currentCompanyId);
        if (!companyIdForNewRecord) {
            alert("Please select a company for the offer.");
            return;
        }

        let finalSupplierName = formData.supplierName || '';
        if (formData.supplierId) {
            const sup = suppliers.find(s => s.id === formData.supplierId);
            if (sup) finalSupplierName = sup.name;
        }

        const offerData: SupplierOffer = {
            id: editingId || `SO${Date.now()}`,
            offerNumber: formData.offerNumber || `SQ-${Date.now().toString().slice(-6)}`,
            companyId: companyIdForNewRecord,
            supplierId: formData.supplierId || '',
            supplierName: finalSupplierName,
            items: formData.items || [],
            totalAmount: formData.totalAmount || 0,
            currency: formData.currency as any,
            incoterm: formData.incoterm as any,
            loadingLocation: formData.loadingLocation,
            originPort: formData.originPort,
            destinationPort: formData.destinationPort,
            validUntil: formData.validUntil!,
            paymentTerms: formData.paymentTerms || '',
            status: 'Received',
            notes: formData.notes
        };

        if (editingId) {
            onUpdate(offerData);
        } else {
            onAdd(offerData);
        }

        setIsAdding(false);
        setFormData(initialFormState);
    };

    return (
        <div className="space-y-6">
            <div className="mb-6 flex items-start justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl text-white"><Tag size={24} /></div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">Supplier Quotes</h1>
                        <p className="text-slate-500 text-sm mt-1">Log and track incoming estimates from suppliers.</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
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
                    <button onClick={handleAddNew} className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-all shadow-md font-medium">
                        <FilePlus size={18} /> Add Offer
                    </button>
                </div>
            </div>

            {dbError && (
                <div className="bg-red-50 text-red-600 p-4 rounded-xl flex items-start gap-3 border border-red-100 animate-in fade-in">
                    <AlertCircle size={20} className="mt-0.5 shrink-0" />
                    <div>
                        <p className="font-bold text-sm">Database Error</p>
                        <p className="text-xs mt-1 opacity-90">{dbError}</p>
                    </div>
                </div>
            )}

            {/* List/Grid Content */}
            {viewMode === 'grid' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {offers.map(offer => (
                        <div key={offer.id} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow group relative">
                            <div className="flex justify-between items-start mb-2">
                                <div>
                                    <h4 className="font-bold text-slate-800">{offer.supplierName}</h4>
                                    <p className="text-xs font-mono text-slate-400">{offer.offerNumber}</p>
                                </div>
                                <div className="flex gap-2">
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${offer.status === 'Received' ? 'bg-emerald-100 text-emerald-700' :
                                        offer.status === 'Expired' ? 'bg-red-100 text-red-700' :
                                            'bg-slate-100 text-slate-600'
                                        }`}>
                                        {offer.status}
                                    </span>
                                    <span className="text-xs font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{offer.incoterm}</span>
                                </div>
                            </div>
                            <p className="text-sm text-slate-600 mb-4 font-medium">
                                {offer.items.length} {offer.items.length > 1 ? 'Products' : 'Product'}
                            </p>

                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 mb-4 text-xs space-y-1.5">
                                <div className="flex items-center gap-2 text-slate-600" title="Loading Location"><MapPin size={12} className="text-slate-400 shrink-0" /> <span className="truncate">{offer.loadingLocation || 'N/A'}</span></div>
                                <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-1 text-slate-600 w-1/2" title="Port of Origin"><Anchor size={12} className="text-slate-400 shrink-0" /> <span className="truncate">{offer.originPort || 'POA'}</span></div>
                                    <ArrowRight size={10} className="text-slate-300" />
                                    <div className="flex items-center gap-1 text-slate-600 w-1/2 justify-end" title="Port of Destination"><span className="truncate">{offer.destinationPort || 'POD'}</span><Anchor size={12} className="text-slate-400 shrink-0" /></div>
                                </div>
                            </div>

                            <div className="flex items-end justify-between border-t border-slate-100 pt-3">
                                <div>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase">Unit Price</p>
                                    <div className="flex flex-col">
                                        {offer.items.slice(0, 3).map((item, idx) => (
                                            <div key={idx} className="flex gap-2 text-sm font-bold text-teal-600">
                                                <span>${item.unitPrice.toFixed(4)}/lb</span>
                                                <span className="text-slate-400">|</span>
                                                <span>${(item.unitPrice * 2.20462).toFixed(4)}/kg</span>
                                            </div>
                                        ))}
                                        {offer.items.length > 3 && <span className="text-[10px] text-slate-400">...</span>}
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase">Valid Until</p>
                                    <p className="text-sm font-medium text-slate-600">{offer.validUntil || 'N/A'}</p>
                                </div>
                            </div>
                            <div className="mt-3 flex gap-2 text-xs text-slate-500 justify-between items-center">
                                <div className="flex gap-2">
                                    <span className="flex items-center gap-1"><Clock size={12} /> {offer.items.map(i => i.leadTime).filter(Boolean).join(', ') || 'N/A'}</span>
                                </div>
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={(e) => handleEdit(offer, e)} className="text-slate-400 hover:text-amber-500"><Pencil size={14} /></button>
                                    <button onClick={(e) => handleDelete(offer.id, e)} className="text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Offer #</th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Supplier</th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Products</th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Incoterm</th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Origin</th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase text-right">Unit Price (LB)</th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase text-right">Unit Price (KG)</th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Valid Until</th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Status</th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {offers.map(offer => (
                                <tr key={offer.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-6 py-4 text-sm font-mono text-slate-600">{offer.offerNumber}</td>
                                    <td className="px-6 py-4 text-sm font-bold text-slate-800">{offer.supplierName}</td>
                                    <td className="px-6 py-4 text-sm text-slate-600">
                                        <div className="flex flex-col">
                                            <span>{offer.items.length} Item(s)</span>
                                            <span className="text-xs text-slate-400">{offer.items[0]?.productName} {offer.items.length > 1 ? '...' : ''}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-sm"><span className="bg-slate-100 px-2 py-0.5 rounded font-medium text-slate-700">{offer.incoterm}</span></td>
                                    <td className="px-6 py-4 text-sm text-slate-600">{offer.originPort || '-'}</td>
                                    <td className="px-6 py-4 text-right text-sm font-bold text-teal-600">
                                        {offer.items.map((item, i) => (
                                            <div key={i}>${item.unitPrice.toFixed(4)}</div>
                                        ))}
                                    </td>
                                    <td className="px-6 py-4 text-right text-sm font-bold text-blue-600">
                                        {offer.items.map((item, i) => (
                                            <div key={i}>${(item.unitPrice * 2.20462).toFixed(4)}</div>
                                        ))}
                                    </td>
                                    <td className="px-6 py-4 text-sm text-slate-600">{offer.validUntil}</td>
                                    <td className="px-6 py-4">
                                        <span className={`text-xs px-2 py-1 rounded font-bold ${offer.status === 'Received' ? 'bg-emerald-100 text-emerald-700' :
                                            offer.status === 'Expired' ? 'bg-red-100 text-red-700' :
                                                'bg-slate-100 text-slate-600'
                                            }`}>{offer.status}</span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <button onClick={(e) => handleEdit(offer, e)} className="text-slate-400 hover:text-amber-500"><Pencil size={16} /></button>
                                            <button onClick={(e) => handleDelete(offer.id, e)} className="text-slate-400 hover:text-red-500"><Trash2 size={16} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {offers.length === 0 && !isAdding && (
                <div className="col-span-full text-center py-12 text-slate-400 bg-white rounded-xl border border-dashed border-slate-200">
                    <FileText size={48} className="mx-auto mb-4 opacity-20" />
                    <p>No supplier quotes logged yet.</p>
                </div>
            )}

            {isAdding && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div key={editingId || 'new'} className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto custom-scrollbar relative flex flex-col">
                        {/* Quick Add Modals */}
                        {showQuickAddSupplier && (
                            <div className="absolute inset-0 bg-white/90 z-20 flex items-center justify-center rounded-xl backdrop-blur-sm animate-in fade-in">
                                <div className="bg-white p-6 rounded-lg shadow-xl border border-slate-200 w-80 space-y-4">
                                    <h4 className="font-bold text-lg">Quick Add Supplier</h4>
                                    <input
                                        type="text"
                                        value={newSupplierName}
                                        onChange={(e) => setNewSupplierName(e.target.value)}
                                        className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg px-3 py-2"
                                        placeholder="Enter supplier name"
                                        autoFocus
                                    />
                                    <div className="flex justify-end gap-2">
                                        <button type="button" onClick={() => setShowQuickAddSupplier(false)} className="px-3 py-1.5 bg-slate-100 rounded text-sm hover:bg-slate-200">Cancel</button>
                                        <button type="button" onClick={handleQuickAddSupplier} disabled={!newSupplierName.trim()} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">Add</button>
                                    </div>
                                </div>
                            </div>
                        )}
                        {showQuickAddProduct && (
                            <div className="absolute inset-0 bg-white/90 z-20 flex items-center justify-center rounded-xl backdrop-blur-sm animate-in fade-in">
                                <div className="bg-white p-6 rounded-lg shadow-xl border border-slate-200 w-80 space-y-4">
                                    <h4 className="font-bold text-lg">Quick Add Product</h4>
                                    <input
                                        type="text"
                                        value={newProductName}
                                        onChange={(e) => setNewProductName(e.target.value)}
                                        className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg px-3 py-2"
                                        placeholder="Enter product name"
                                        autoFocus
                                    />
                                    {dbError && (
                                        <div className="bg-red-50 text-red-600 p-2 rounded-lg text-xs flex items-center gap-2">
                                            <AlertCircle size={16} /> {dbError}
                                        </div>
                                    )}
                                    <div className="flex justify-end gap-2">
                                        <button type="button" onClick={() => setShowQuickAddProduct(false)} className="px-3 py-1.5 bg-slate-100 rounded text-sm hover:bg-slate-200">Cancel</button>
                                        <button type="button" onClick={handleQuickAddProduct} disabled={!newProductName.trim()} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">Add</button>
                                    </div>
                                </div>
                            </div>
                        )}
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
                        {showQuickAddLocation && (
                            <div className="absolute inset-0 bg-white/95 z-20 flex items-center justify-center backdrop-blur-sm animate-in fade-in rounded-xl">
                                <div className="bg-white p-6 rounded-lg shadow-xl border border-slate-200 w-80 space-y-3">
                                    <h4 className="font-bold text-lg flex items-center gap-2"><Building size={20} /> New Location</h4>
                                    <input className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" placeholder="Location Name / Nickname" value={newLocName} onChange={e => setNewLocName(e.target.value)} />
                                    <input className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" placeholder="Address" value={newLocAddress} onChange={e => setNewLocAddress(e.target.value)} />
                                    <div className="grid grid-cols-2 gap-2">
                                        <input className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" placeholder="City" value={newLocCity} onChange={e => setNewLocCity(e.target.value)} />
                                        <input className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" placeholder="State" value={newLocState} onChange={e => setNewLocState(e.target.value)} />
                                    </div>
                                    <input className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" placeholder="Zip Code" value={newLocZip} onChange={e => setNewLocZip(e.target.value)} />

                                    <div className="flex justify-end gap-2 mt-2">
                                        <button type="button" onClick={() => setShowQuickAddLocation(false)} className="px-3 py-1.5 bg-slate-100 rounded text-sm hover:bg-slate-200">Cancel</button>
                                        <button type="button" onClick={handleQuickAddLocation} disabled={!newLocName} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">Save Location</button>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-white sticky top-0 z-10">
                            <h3 className="font-bold text-slate-800">{editingId ? 'Edit Supplier Quote' : 'Add Supplier Quote'}</h3>
                            <button onClick={() => setIsAdding(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 space-y-4">
                            {currentCompanyId === 'ALL' && (
                                <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                                    <label className="block text-xs font-bold text-blue-800 uppercase mb-1">Assign to Company</label>
                                    <select
                                        required
                                        name="companyId"
                                        value={formData.companyId || ''}
                                        onChange={e => setFormData({ ...formData, companyId: e.target.value })}
                                        className="w-full border border-slate-600 bg-slate-900 text-white rounded p-2 text-sm"
                                    >
                                        <option value="">Select Company...</option>
                                        {availableCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                </div>
                            )}
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Supplier</label>
                                    <select
                                        className="w-full border border-slate-600 bg-slate-900 text-white rounded p-2 text-sm"
                                        value={formData.supplierId || ''}
                                        onChange={e => {
                                            if (e.target.value === '_ADD_NEW_') {
                                                setShowQuickAddSupplier(true);
                                            } else {
                                                const sup = suppliers.find(s => s.id === e.target.value);
                                                setFormData({ ...formData, supplierId: e.target.value, supplierName: sup ? sup.name : '' });
                                            }
                                        }}
                                    >
                                        <option value="">-- Select Supplier --</option>
                                        <option value="_ADD_NEW_" className="font-bold text-blue-600 bg-blue-50">+ Add New Supplier</option>
                                        {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                    {supplierAddedMessage && <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><CheckCircle2 size={10} /> {supplierAddedMessage}</p>}
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Incoterm</label>
                                    <select className="w-full border border-slate-600 bg-slate-900 text-white rounded p-2 text-sm" value={formData.incoterm} onChange={e => setFormData({ ...formData, incoterm: e.target.value as any })}>
                                        <option value="EXW">EXW</option>
                                        <option value="FAS">FAS</option>
                                        <option value="FOB">FOB</option>
                                        <option value="CFR">CFR</option>
                                        <option value="CIF">CIF</option>
                                        <option value="DDP">DDP</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Payment Terms</label>
                                    <select className="w-full border border-slate-600 bg-slate-900 text-white rounded p-2 text-sm" value={formData.paymentTerms} onChange={e => setFormData({ ...formData, paymentTerms: e.target.value as any })}>
                                        {PAYMENT_TERM_OPTIONS.map(term => <option key={term} value={term}>{term}</option>)}
                                    </select>
                                </div>
                            </div>

                            {/* Multi-item form */}
                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 mb-6">
                                <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">Add Items</h4>
                                <div className="grid grid-cols-1 gap-2 mb-2">
                                    <div>
                                        <label className="block text-[10px] text-slate-500 mb-1">Product</label>
                                        <select className="w-full border border-slate-600 bg-slate-900 text-white rounded p-2 text-sm" value={currentItem.productName || ''} onChange={e => { if (e.target.value === '_ADD_NEW_') { setShowQuickAddProduct(true); } else { setCurrentItem({ ...currentItem, productName: e.target.value }); } }}>
                                            <option value="">Select...</option>
                                            <option value="_ADD_NEW_" className="font-bold text-blue-600 bg-blue-50">+ Add Product</option>
                                            {products.map(p => <option key={p.id} value={p.name}>{p.name} ({p.grade})</option>)}
                                        </select>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <QuantityInput
                                            value={currentItem.quantity || 0}
                                            onChange={(val) => setCurrentItem({ ...currentItem, quantity: val })}
                                            label="Quantity"
                                        />
                                        <PriceInput
                                            value={currentItem.unitPrice || 0}
                                            onChange={(val) => setCurrentItem({ ...currentItem, unitPrice: val })}
                                            label="Unit Price"
                                        />
                                    </div>
                                    <div className="flex items-end gap-2">
                                        <button type="button" onClick={handleAddItem} className={`${editingItemIndex !== null ? 'bg-amber-500 hover:bg-amber-600' : 'bg-blue-600 hover:bg-blue-700'} text-white p-2 rounded w-full flex items-center justify-center gap-1 text-xs font-bold`}><Plus size={14} /> {editingItemIndex !== null ? 'Update Item' : 'Add Item'}</button>
                                        {editingItemIndex !== null && <button type="button" onClick={() => { setEditingItemIndex(null); setCurrentItem({ productName: '', quantity: 0, unitPrice: 0, moq: 0, leadTime: '' }); }} className="bg-slate-200 text-slate-600 p-2 rounded hover:bg-slate-300 text-xs font-bold">Cancel</button>}
                                    </div>
                                </div>
                                {productAddedMessage && <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><CheckCircle2 size={10} /> {productAddedMessage}</p>}
                            </div>

                            {/* Items table */}
                            <div className="mb-6">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-slate-50 text-slate-500 text-xs">
                                        <tr>
                                            <th className="p-2">Supplier Product Name</th>
                                            <th className="p-2">System Product Name</th>
                                            <th className="p-2 text-right">Qty (LBS)</th>
                                            <th className="p-2 text-right">Qty (KG)</th>
                                            <th className="p-2 text-right">$/LB</th>
                                            <th className="p-2 text-right">$/KG</th>
                                            <th className="p-2 text-right">Total</th>
                                            <th className="p-2 w-10"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(formData.items || []).map((item, idx) => (
                                            <tr key={idx} className="border-b border-slate-100">
                                                <td className="p-2 font-medium">{item.productName}</td>
                                                <td className="p-2 text-slate-600">
                                                    <select
                                                        className="w-full border border-slate-200 rounded p-1 text-xs bg-white"
                                                        value={item.systemProductName || (() => { const mp = products.find(p => p.supplierProductName === item.productName || p.name === item.productName); return mp?.name || ''; })()}
                                                        onChange={e => {
                                                            setFormData(prev => {
                                                                const items = [...(prev.items || [])];
                                                                items[idx] = { ...items[idx], systemProductName: e.target.value };
                                                                return { ...prev, items };
                                                            });
                                                        }}
                                                    >
                                                        <option value="">— Select —</option>
                                                        {[...new Map<string, typeof products[0]>(products.map(p => [p.name, p])).values()].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                                                    </select>
                                                </td>
                                                <td className="p-2 text-right font-mono">{item.quantity.toLocaleString()}</td>
                                                <td className="p-2 text-right font-mono">{(item.quantity * 0.453592).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                                                <td className="p-2 text-right font-mono">${item.unitPrice.toFixed(4)}</td>
                                                <td className="p-2 text-right font-mono">${(item.unitPrice * 2.20462).toFixed(4)}</td>
                                                <td className="p-2 text-right font-bold font-mono">${item.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                                <td className="p-2 text-center">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <button type="button" onClick={() => { setCurrentItem({ productName: item.productName, quantity: item.quantity, unitPrice: item.unitPrice, moq: item.moq, leadTime: item.leadTime }); setEditingItemIndex(idx); }} className="text-indigo-400 hover:text-indigo-600" title="Edit item"><Pencil size={14} /></button>
                                                        <button type="button" onClick={() => handleRemoveItem(idx)} className="text-red-400 hover:text-red-600" title="Delete item"><Trash2 size={14} /></button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr>
                                            <td colSpan={7} className="p-2 text-right font-bold uppercase text-slate-500">Total Amount</td>
                                            <td className="p-2 text-right font-bold text-lg text-blue-600 font-mono">${formData.totalAmount?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                            <td></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>

                            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                                <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2"><MapPin size={14} /> Logistics Route Details</h4>
                                <div className="space-y-3">
                                    <div className="mb-1">
                                        <div className="flex justify-between items-center mb-1">
                                            <label className="block text-xs font-bold text-slate-500 uppercase">Loading Location (Factory/Address)</label>
                                            {locationAddedMessage && <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle2 size={10} /> Saved</span>}
                                        </div>
                                        <select
                                            className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none mb-1"
                                            onChange={handleLocationSelect}
                                            defaultValue=""
                                        >
                                            <option value="">-- Quick Fill from Database --</option>
                                            <option value="_ADD_NEW_" className="font-bold text-blue-600">+ Add New Location</option>
                                            {locations.map(l => <option key={l.id} value={l.id}>{l.name} - {l.city}</option>)}
                                        </select>
                                        <input className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" value={formData.loadingLocation || ''} onChange={e => setFormData({ ...formData, loadingLocation: e.target.value })} placeholder="e.g. 123 Manufacturing Rd, Shanghai" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1"><Anchor size={12} /> Port of Origin (POA)</label><select className="w-full border border-slate-600 bg-slate-900 text-white rounded p-2 text-sm" value={formData.originPort || ''} onChange={e => { if (e.target.value === '_ADD_NEW_') { setTargetPortField('origin'); setShowQuickAddPort(true); } else { setFormData({ ...formData, originPort: e.target.value }); } }}>
                                            <option value="">Select...</option><option value="_ADD_NEW_" className="font-bold text-blue-600 bg-blue-50">+ Add Port</option>{ports.map(p => <option key={p.id} value={`${p.name} (${p.code})`}>{p.name} ({p.code})</option>)}</select></div>
                                        <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1"><Anchor size={12} /> Port of Destination (POD)</label><select className="w-full border border-slate-600 bg-slate-900 text-white rounded p-2 text-sm" value={formData.destinationPort || ''} onChange={e => { if (e.target.value === '_ADD_NEW_') { setTargetPortField('destination'); setShowQuickAddPort(true); } else { setFormData({ ...formData, destinationPort: e.target.value }); } }}>
                                            <option value="">Select...</option><option value="_ADD_NEW_" className="font-bold text-blue-600 bg-blue-50">+ Add Port</option>{ports.map(p => <option key={p.id} value={`${p.name} (${p.code})`}>{p.name} ({p.code})</option>)}</select></div>
                                    </div>
                                    {portAddedMessage && <div className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle2 size={12} /> {portAddedMessage}</div>}
                                </div>
                            </div>
                            <div className="pt-4 flex justify-end gap-2 border-t border-slate-100 mt-4">
                                <button type="button" onClick={() => setIsAdding(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-300 hover:bg-slate-50">Cancel</button>
                                <button type="submit" name="action" value="save" className="px-4 py-2 text-sm rounded-lg bg-teal-600 text-white hover:bg-teal-700 flex items-center gap-2 shadow-sm"><Save size={16} /> Save Offer</button>
                            </div>
                        </form>
                    </div>
                </div >
            )}
        </div >
    );
};

export default SupplierOffers;
