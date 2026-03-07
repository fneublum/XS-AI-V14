
import React, { useState, useEffect } from 'react';
import { Calculator, DollarSign, Ship, ShieldCheck, Landmark, Truck, Package, RotateCcw, Download, Anchor, Loader2, Save, CheckCircle2, Trash2, History, Pencil, LayoutGrid, List, Plus } from 'lucide-react';
import { getImportCostAnalysis, lookupLocation } from '../services/geminiService';
import { QuantityInput, PriceInput, FormattedInput } from '../components/UnitInputs';
import { SupplierQuote, SupplierOffer, CostCalculation, Company } from '../types';

interface ImportCalculatorProps {
    supplierQuotes?: SupplierQuote[];
    supplierOffers?: SupplierOffer[];
    savedCalculations?: CostCalculation[];
    onSave?: (calculation: CostCalculation) => void;
    onDelete?: (id: string) => void;
    currentCompanyId?: string;
    availableCompanies?: Company[];
    initialCalculationId?: string | null;
    initialViewMode?: 'grid' | 'table';
    initialHistoryOnly?: boolean;
}

const ImportCalculator: React.FC<ImportCalculatorProps> = ({
    supplierQuotes = [],
    supplierOffers = [],
    savedCalculations = [],
    onSave,
    onDelete,
    currentCompanyId,
    availableCompanies,
    initialCalculationId,
    initialViewMode = 'table',
    initialHistoryOnly = false
}) => {
    const [formData, setFormData] = useState({
        productName: '',
        origin: '',
        destination: '',
        fobPrice: 0, // Per Unit (LB)
        quantity: 0, // LBS
        freightCost: 0,
        insuranceCost: 0,
        dutyPercent: 0,
        portClearanceCost: 0,
        deliveryCost: 0,
        deliveryCity: '',
        deliveryZip: '',
        marginPercent: 0, // Defaults to 0 since UI removed, kept for type safety
        companyId: currentCompanyId === 'ALL' && availableCompanies && availableCompanies.length > 0 ? availableCompanies[0].id : currentCompanyId
    });

    const [aiAnalysis, setAiAnalysis] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isLocationLoading, setIsLocationLoading] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
    const [viewMode, setViewMode] = useState<'grid' | 'table'>(initialViewMode);
    const [isHistoryMode, setIsHistoryMode] = useState(initialHistoryOnly);

    // Sync viewMode if prop changes
    useEffect(() => {
        setViewMode(initialViewMode);
    }, [initialViewMode]);

    // Sync history mode if prop changes
    useEffect(() => {
        setIsHistoryMode(initialHistoryOnly);
    }, [initialHistoryOnly]);

    // Selection State for Loading Quote/Offer
    const [selectedSourceId, setSelectedSourceId] = useState('');
    const [selectedItemIndex, setSelectedItemIndex] = useState<number | ''>('');

    // Handle Initial Load from Prop
    useEffect(() => {
        if (initialCalculationId) {
            const calc = savedCalculations.find(c => c.id === initialCalculationId);
            if (calc) {
                handleLoadCalculation(calc);
                setIsHistoryMode(false); // Ensure we show the form when loading specific calc
            }
        }
    }, [initialCalculationId, savedCalculations]);

    // Derived Calculations
    const totalFOB = formData.fobPrice * formData.quantity;
    const insuranceAmount = formData.insuranceCost; // Flat or calc? Let's treat as flat input
    const freightAmount = formData.freightCost; // Flat
    const cifValue = totalFOB + insuranceAmount + freightAmount;

    const dutyAmount = cifValue * (formData.dutyPercent / 100);
    const totalLandedCost = cifValue + dutyAmount + formData.portClearanceCost + formData.deliveryCost;
    const unitLandedCost = formData.quantity > 0 ? totalLandedCost / formData.quantity : 0;

    // Sales Price Calc (Hidden but kept for data integrity if needed)
    const salesPrice = 0;

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: name === 'productName' || name === 'origin' || name === 'destination' || name === 'deliveryCity' || name === 'deliveryZip' || name === 'companyId' ? value : Number(value)
        }));
    };

    const handleCityBlur = async () => {
        if (!formData.deliveryCity || formData.deliveryCity.length < 3) return;
        setIsLocationLoading(true);
        const result = await lookupLocation(formData.deliveryCity, 'city');
        setIsLocationLoading(false);

        if (result && result.zip) {
            setFormData(prev => ({
                ...prev,
                deliveryZip: result.zip,
                deliveryCity: `${result.city}, ${result.state}`
            }));
        }
    };

    const handleZipBlur = async () => {
        if (!formData.deliveryZip || formData.deliveryZip.length < 5) return;
        setIsLocationLoading(true);
        const result = await lookupLocation(formData.deliveryZip, 'zip');
        setIsLocationLoading(false);

        if (result && result.city && result.state) {
            setFormData(prev => ({
                ...prev,
                deliveryCity: `${result.city}, ${result.state}`
            }));
        }
    };

    const handleAiEstimate = async () => {
        if (!formData.productName || !formData.fobPrice) return;
        setIsAnalyzing(true);
        setAiAnalysis('');
        try {
            const result = await getImportCostAnalysis(
                formData.productName,
                formData.fobPrice,
                formData.origin || 'Unknown',
                formData.destination || 'Unknown',
                formData.deliveryCity,
                formData.deliveryZip
            );
            setAiAnalysis(result);
        } catch (e) {
            setAiAnalysis("Could not retrieve AI estimation.");
        } finally {
            setIsAnalyzing(false);
        }
    };

    const resetForm = () => {
        setFormData({
            productName: '', origin: '', destination: '', fobPrice: 0, quantity: 0,
            freightCost: 0, insuranceCost: 0, dutyPercent: 0, portClearanceCost: 0, deliveryCost: 0, marginPercent: 0,
            deliveryCity: '', deliveryZip: '',
            companyId: formData.companyId
        });
        setAiAnalysis('');
        setSelectedSourceId('');
        setSelectedItemIndex('');
        setSaveStatus('idle');
    }

    const handleLoadSource = () => {
        // Find in Quotes OR Offers
        let source: any = supplierQuotes.find(q => q.id === selectedSourceId);
        if (!source) {
            source = supplierOffers.find(o => o.id === selectedSourceId);
        }

        if (!source) return;

        // If index is valid number
        if (typeof selectedItemIndex === 'number') {
            const item = source.items[selectedItemIndex];
            if (item) {
                setFormData(prev => ({
                    ...prev,
                    productName: item.productName,
                    origin: source.originPort || prev.origin,
                    destination: source.destinationPort || prev.destination,
                    fobPrice: item.unitPrice,
                    quantity: item.quantity,
                    // Reset variable costs as they need specific calculation
                    freightCost: 0,
                    insuranceCost: 0,
                    dutyPercent: 0,
                    portClearanceCost: 0,
                    deliveryCost: 0
                }));
            }
        }
    };

    const handleLoadCalculation = (calc: CostCalculation) => {
        setFormData(prev => ({
            ...prev,
            productName: calc.productName,
            origin: calc.origin,
            destination: calc.destination,
            deliveryCity: calc.deliveryCity || '',
            deliveryZip: calc.deliveryZip || '',
            fobPrice: calc.fobPrice,
            quantity: calc.quantity,
            freightCost: calc.freightCost,
            insuranceCost: calc.insuranceCost,
            dutyPercent: calc.dutyPercent,
            portClearanceCost: calc.portClearanceCost,
            deliveryCost: calc.deliveryCost,
            marginPercent: calc.marginPercent,
            companyId: calc.companyId
        }));
        setIsHistoryMode(false); // Switch to calculator view
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDeleteCalculation = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!onDelete) return;
        if (window.confirm('Are you sure you want to delete this saved calculation?')) {
            onDelete(id);
        }
    };

    const handleSaveCalculation = () => {
        if (!formData.productName || !formData.quantity || !onSave) return;

        const newCalculation: CostCalculation = {
            id: `CC${Date.now()}`,
            companyId: formData.companyId || (currentCompanyId !== 'ALL' ? currentCompanyId! : ''),
            calculationNumber: `CALC-${Date.now().toString().slice(-6)}`,
            date: new Date().toISOString(),
            productName: formData.productName,
            origin: formData.origin,
            destination: formData.destination,
            deliveryCity: formData.deliveryCity,
            deliveryZip: formData.deliveryZip,
            fobPrice: formData.fobPrice,
            quantity: formData.quantity,
            freightCost: formData.freightCost,
            insuranceCost: formData.insuranceCost,
            dutyPercent: formData.dutyPercent,
            portClearanceCost: formData.portClearanceCost,
            deliveryCost: formData.deliveryCost,
            marginPercent: formData.marginPercent,
            totalLandedCost: totalLandedCost,
            unitLandedCost: unitLandedCost,
            recommendedSalesPrice: salesPrice
        };

        onSave(newCalculation);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
    };

    // Helper to get selected source object for item rendering
    const getSelectedSource = () => {
        const q = supplierQuotes.find(q => q.id === selectedSourceId);
        if (q) return q;
        return supplierOffers.find(o => o.id === selectedSourceId);
    };

    const selectedSource = getSelectedSource();

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            {/* Header */}
            <div className="mb-6 flex items-start justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-r from-violet-500 to-purple-500 rounded-xl text-white"><Calculator size={24} /></div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">DDP Cost - Imported Goods</h1>
                        <p className="text-slate-500 text-sm mt-1">{isHistoryMode ? 'Saved Calculations' : 'Calculate Landed Cost (DDP)'}</p>
                    </div>
                </div>
                {isHistoryMode ? (
                    <button
                        onClick={() => setIsHistoryMode(false)}
                        className="flex items-center gap-2 px-5 py-2.5 bg-violet-500 text-white rounded-lg hover:bg-violet-600 transition-all shadow-md font-medium"
                    >
                        <Plus size={18} /> New Calculation
                    </button>
                ) : (
                    <button onClick={resetForm} className="flex items-center gap-2 px-4 py-2 text-slate-500 hover:text-violet-600 transition-colors text-sm">
                        <RotateCcw size={16} /> Reset
                    </button>
                )}
            </div>

            {!isHistoryMode && (
                <>
                    {/* Load Data Section */}
                    <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl space-y-4">
                        <div className="flex flex-col md:flex-row gap-4 items-end">
                            <div className="flex-1 w-full">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Load from Quote / Offer</label>
                                <select
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-blue-500"
                                    value={selectedSourceId}
                                    onChange={(e) => { setSelectedSourceId(e.target.value); setSelectedItemIndex(''); }}
                                >
                                    <option value="">-- Select Source --</option>
                                    <optgroup label="Supplier Quotes">
                                        {supplierQuotes.map(q => (
                                            <option key={q.id} value={q.id}>{q.supplierName} - {q.quoteNumber} (Quote)</option>
                                        ))}
                                    </optgroup>
                                    <optgroup label="Supplier Offers">
                                        {supplierOffers.map(o => (
                                            <option key={o.id} value={o.id}>{o.supplierName} - {o.offerNumber} (Offer)</option>
                                        ))}
                                    </optgroup>
                                </select>
                            </div>
                            <div className="flex-1 w-full">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Select Item</label>
                                <select
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 focus:ring-2 focus:ring-blue-500"
                                    value={selectedItemIndex}
                                    onChange={(e) => setSelectedItemIndex(e.target.value === '' ? '' : Number(e.target.value))}
                                    disabled={!selectedSourceId}
                                >
                                    <option value="">-- Select Product Item --</option>
                                    {selectedSource?.items.map((item, idx) => (
                                        <option key={idx} value={idx}>{item.productName} ({item.quantity} units)</option>
                                    ))}
                                </select>
                            </div>
                            <button
                                onClick={handleLoadSource}
                                disabled={!selectedSourceId || selectedItemIndex === ''}
                                className="bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-bold hover:bg-slate-100 disabled:opacity-50 flex items-center gap-2"
                            >
                                <Download size={16} /> Load Data
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Input Column */}
                        <div className="lg:col-span-2 space-y-6">
                            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                                <h3 className="text-sm font-bold text-slate-800 uppercase mb-4 flex items-center gap-2">
                                    <Package size={16} /> Shipment Details
                                </h3>
                                {currentCompanyId === 'ALL' && availableCompanies && (
                                    <div className="mb-4">
                                        <label className="block text-xs font-bold text-blue-800 uppercase mb-1">Company Context</label>
                                        <select
                                            name="companyId"
                                            value={formData.companyId || ''}
                                            onChange={handleInputChange}
                                            className="w-full border border-blue-200 bg-blue-50 text-blue-900 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                                        >
                                            {[...availableCompanies].sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>
                                    </div>
                                )}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="col-span-2">
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Product Name</label>
                                        <input name="productName" value={formData.productName} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" placeholder="e.g. Polyester Staple Fiber" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Origin</label>
                                        <input name="origin" value={formData.origin} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" placeholder="Shanghai, CN" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Destination (Country/State)</label>
                                        <input name="destination" value={formData.destination} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" placeholder="Houston, USA" />
                                    </div>

                                    <div className="col-span-2 md:col-span-1">
                                        <QuantityInput
                                            value={formData.quantity}
                                            onChange={(val) => setFormData(prev => ({ ...prev, quantity: val }))}
                                            label="Quantity"
                                        />
                                    </div>
                                    <div className="col-span-2 md:col-span-1">
                                        <PriceInput
                                            value={formData.fobPrice}
                                            onChange={(val) => setFormData(prev => ({ ...prev, fobPrice: val }))}
                                            label="FOB Unit Price"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-sm font-bold text-slate-800 uppercase flex items-center gap-2">
                                        <DollarSign size={16} /> Logistics & Duty Costs
                                    </h3>
                                    <button
                                        onClick={handleAiEstimate}
                                        disabled={!formData.productName || isAnalyzing}
                                        className="text-xs bg-indigo-50 text-indigo-700 px-3 py-1 rounded border border-indigo-200 hover:bg-indigo-100 transition-colors flex items-center gap-1 disabled:opacity-50"
                                    >
                                        {isAnalyzing ? 'Thinking...' : 'AI Estimate Costs'}
                                    </button>
                                </div>

                                {/* Location Fields for Accurate Delivery Calculation */}
                                <div className="grid grid-cols-2 gap-4 mb-4">
                                    <div className="relative">
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Delivery City</label>
                                        <input name="deliveryCity" value={formData.deliveryCity} onChange={handleInputChange} onBlur={handleCityBlur} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm pr-8" placeholder="e.g. Dallas" />
                                        {isLocationLoading && <Loader2 className="absolute right-2 top-8 text-slate-400 animate-spin" size={14} />}
                                    </div>
                                    <div className="relative">
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Zip Code</label>
                                        <input name="deliveryZip" value={formData.deliveryZip} onChange={handleInputChange} onBlur={handleZipBlur} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm pr-8" placeholder="e.g. 75201" />
                                        {isLocationLoading && <Loader2 className="absolute right-2 top-8 text-slate-400 animate-spin" size={14} />}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><Ship size={12} /> Freight Cost ($)</label>
                                        <FormattedInput
                                            value={formData.freightCost}
                                            onChange={val => setFormData(prev => ({ ...prev, freightCost: val }))}
                                            className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm"
                                            placeholder="0.00"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><ShieldCheck size={12} /> Insurance ($)</label>
                                        <FormattedInput
                                            value={formData.insuranceCost}
                                            onChange={val => setFormData(prev => ({ ...prev, insuranceCost: val }))}
                                            className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm"
                                            placeholder="0.00"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><Landmark size={12} /> Duty Rate (%)</label>
                                        <FormattedInput
                                            value={formData.dutyPercent}
                                            onChange={val => setFormData(prev => ({ ...prev, dutyPercent: val }))}
                                            className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm"
                                            placeholder="6.5"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><Anchor size={12} /> Port/Clearance ($)</label>
                                        <FormattedInput
                                            value={formData.portClearanceCost}
                                            onChange={val => setFormData(prev => ({ ...prev, portClearanceCost: val }))}
                                            className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm"
                                            placeholder="0.00"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><Truck size={12} /> Local Delivery ($)</label>
                                        <FormattedInput
                                            value={formData.deliveryCost}
                                            onChange={val => setFormData(prev => ({ ...prev, deliveryCost: val }))}
                                            className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm"
                                            placeholder="0.00"
                                        />
                                    </div>
                                </div>

                                {aiAnalysis && (
                                    <div className="mt-4 p-4 bg-indigo-50 rounded-lg border border-indigo-100 text-sm text-indigo-900 whitespace-pre-wrap">
                                        {aiAnalysis}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Results Column */}
                        <div className="lg:col-span-1 space-y-6 flex flex-col">
                            <div className="bg-slate-900 text-white p-6 rounded-xl shadow-lg border-t-4 border-amber-500 sticky top-4">
                                <h3 className="text-lg font-bold mb-6 flex items-center gap-2 border-b border-slate-700 pb-2">
                                    <Calculator size={20} className="text-amber-500" /> Cost Breakdown
                                </h3>

                                <div className="space-y-3 mb-6">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-400">Total FOB</span>
                                        <span>${totalFOB.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-400">Freight & Ins.</span>
                                        <span>${(freightAmount + insuranceAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-400">Duty ({formData.dutyPercent}%)</span>
                                        <span>${dutyAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-400">Port & Clearance</span>
                                        <span>${formData.portClearanceCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-slate-400">Local Delivery</span>
                                        <span>${formData.deliveryCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                    </div>
                                </div>

                                <div className="pt-4 border-t border-slate-700">
                                    <div className="flex justify-between items-end mb-4">
                                        <span className="text-slate-400 text-sm uppercase font-bold">Total DDP</span>
                                        <span className="text-3xl font-bold text-emerald-400">${totalLandedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    </div>
                                    <div className="bg-slate-800 p-4 rounded-lg text-center">
                                        <span className="text-slate-400 text-xs font-bold uppercase tracking-wider block mb-1">Unit DDP Cost</span>
                                        <span className="text-2xl font-mono text-emerald-300 font-bold block">${unitLandedCost.toLocaleString(undefined, { minimumFractionDigits: 4 })}</span>
                                    </div>
                                </div>

                                <button
                                    onClick={handleSaveCalculation}
                                    className="w-full mt-6 bg-amber-600 hover:bg-amber-700 text-white py-3 rounded-lg font-bold transition-colors flex items-center justify-center gap-2 shadow-lg"
                                >
                                    {saveStatus === 'saved' ? <CheckCircle2 size={20} /> : <Save size={20} />}
                                    {saveStatus === 'saved' ? 'Calculation Saved!' : 'Save Calculation'}
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* Saved Calculations History */}
            <div className={!isHistoryMode ? "mt-12 pt-8 border-t border-slate-200" : "mt-0"}>
                <div className="flex justify-between items-center mb-4 px-1">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <History size={20} className="text-slate-500" /> Calculation History
                    </h3>
                    <div className="bg-white border border-slate-200 rounded-lg p-1 flex gap-1">
                        <button
                            type="button"
                            onClick={() => setViewMode('grid')}
                            className={`p-1.5 rounded transition-all ${viewMode === 'grid' ? 'bg-slate-100 text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            title="Grid View"
                        >
                            <LayoutGrid size={16} />
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('table')}
                            className={`p-1.5 rounded transition-all ${viewMode === 'table' ? 'bg-slate-100 text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            title="Table View"
                        >
                            <List size={16} />
                        </button>
                    </div>
                </div>

                {savedCalculations.length > 0 ? (
                    <>
                        {viewMode === 'grid' ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {savedCalculations.map(calc => (
                                    <div
                                        key={calc.id}
                                        className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-300 transition-all text-left group relative"
                                    >
                                        <div className="flex justify-between items-start mb-2">
                                            <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded uppercase">{calc.calculationNumber}</span>
                                            <span className="text-xs text-slate-400">{new Date(calc.date).toLocaleDateString()}</span>
                                        </div>
                                        <h4 className="font-bold text-slate-800 uppercase text-sm mb-1">{calc.productName}</h4>
                                        <p className="text-xs text-slate-500 truncate mb-2">{calc.origin} → {calc.destination}</p>
                                        <p className="text-lg font-bold text-emerald-600">${calc.totalLandedCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>

                                        {/* Action Buttons */}
                                        <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white pl-2">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleLoadCalculation(calc); }}
                                                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                                title="Load"
                                            >
                                                <Pencil size={16} />
                                            </button>
                                            <button
                                                onClick={(e) => handleDeleteCalculation(calc.id, e)}
                                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                                title="Delete"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-slate-50 border-b border-slate-200">
                                        <tr>
                                            <th className="px-6 py-3 font-semibold text-slate-600">Date</th>
                                            <th className="px-6 py-3 font-semibold text-slate-600">Calc #</th>
                                            <th className="px-6 py-3 font-semibold text-slate-600">Product</th>
                                            <th className="px-6 py-3 font-semibold text-slate-600 text-right">Total DDP</th>
                                            <th className="px-6 py-3 font-semibold text-slate-600 text-right">Unit Cost</th>
                                            <th className="px-6 py-3 font-semibold text-slate-600 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {savedCalculations.map(calc => (
                                            <tr key={calc.id} className="hover:bg-slate-50 transition-colors">
                                                <td className="px-6 py-3 text-slate-500">{new Date(calc.date).toLocaleDateString()}</td>
                                                <td className="px-6 py-3 font-mono text-xs bg-slate-50 w-fit rounded px-2 py-1">{calc.calculationNumber}</td>
                                                <td className="px-6 py-3 font-medium text-slate-800">{calc.productName}</td>
                                                <td className="px-6 py-3 text-right font-bold text-slate-700">${calc.totalLandedCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                                                <td className="px-6 py-3 text-right font-mono text-emerald-600">${calc.unitLandedCost.toFixed(4)}</td>
                                                <td className="px-6 py-3 text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <button
                                                            onClick={() => handleLoadCalculation(calc)}
                                                            className="text-blue-600 hover:bg-blue-50 px-3 py-1 rounded text-xs font-bold border border-blue-200 transition-colors flex items-center gap-1"
                                                        >
                                                            <Pencil size={12} /> Load
                                                        </button>
                                                        <button
                                                            onClick={(e) => handleDeleteCalculation(calc.id, e)}
                                                            className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition-colors"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="p-8 text-center text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                        <Calculator size={32} className="mx-auto mb-2 opacity-50" />
                        <p>No saved history yet.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ImportCalculator;
