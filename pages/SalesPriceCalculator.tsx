
import React, { useState, useEffect, useRef } from 'react';
import { CostCalculation, Company, Carrier, Product } from '../types';
import { Calculator, DollarSign, Save, Search, ArrowRight, LayoutGrid, List, Plus, Tag, Truck, Percent, CheckCircle2, User, MapPin, Loader2, Wand2, Briefcase, Ship, Filter, X, ChevronDown, Download, Grid, Trash2, Eye } from 'lucide-react';
import { FormattedInput, PriceInput } from '../components/UnitInputs';
import { lookupLocation, getDomesticFreightEstimate } from '../services/geminiService';

interface SalesPriceCalculatorProps {
    calculations: CostCalculation[];
    onUpdate: (calc: CostCalculation) => void;
    onDelete?: (id: string) => void;
    currentCompanyId: string;
    availableCompanies: Company[];
    carriers?: Carrier[]; // Added carriers prop
    products?: Product[]; // Added products prop for lookup
    initialViewMode?: 'grid' | 'table';
    initialHistoryOnly?: boolean;
}

// Helper for Excel-like filtering logic
const getUniqueValues = (data: any[], key: string) => {
    const values = data.map(item => item[key]).filter(v => v !== undefined && v !== null && v !== '');
    return Array.from(new Set(values)).sort();
};

const SalesPriceCalculator: React.FC<SalesPriceCalculatorProps> = ({
    calculations,
    onUpdate,
    onDelete,
    currentCompanyId,
    availableCompanies,
    carriers = [], // Default to empty array
    products = [], // Default to empty array
    initialViewMode = 'grid',
    initialHistoryOnly = false
}) => {
    const [viewMode, setViewMode] = useState<'grid' | 'table'>(initialViewMode);
    const [isHistoryMode, setIsHistoryMode] = useState(initialHistoryOnly);
    const [selectedCalcId, setSelectedCalcId] = useState<string>('');
    const [margin, setMargin] = useState<number>(0);
    const [customerDelivery, setCustomerDelivery] = useState<number>(0);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
    const [searchTerm, setSearchTerm] = useState('');

    // --- Price List Builder State ---
    const [activeFilterColumn, setActiveFilterColumn] = useState<string | null>(null);
    const [filters, setFilters] = useState<Record<string, string[]>>({});
    const [filterSearch, setFilterSearch] = useState('');
    const filterMenuRef = useRef<HTMLDivElement>(null);

    // New Delivery State
    const [deliveryMethod, setDeliveryMethod] = useState<'PICKUP' | 'DELIVERY'>('PICKUP');
    const [customerName, setCustomerName] = useState('');
    const [deliveryCity, setDeliveryCity] = useState('');
    const [deliveryZip, setDeliveryZip] = useState('');
    const [isLocationLoading, setIsLocationLoading] = useState(false);
    const [isEstimatingFreight, setIsEstimatingFreight] = useState(false);
    const [freightExplanation, setFreightExplanation] = useState('');

    // Flexible Freight Input State
    const [salesFreightInputMode, setSalesFreightInputMode] = useState<'TOTAL' | 'UNIT'>('TOTAL');
    const [salesFreightUnitCost, setSalesFreightUnitCost] = useState(0);
    
    // Carrier Selection
    const [selectedCarrierId, setSelectedCarrierId] = useState('');

    // Commission State
    const [commissionValue, setCommissionValue] = useState<number>(0);
    const [commissionType, setCommissionType] = useState<'FLAT' | 'PERCENT'>('FLAT');

    const KG_CONVERSION = 2.20462;

    useEffect(() => {
        setViewMode(initialViewMode);
    }, [initialViewMode]);

    useEffect(() => {
        setIsHistoryMode(initialHistoryOnly);
    }, [initialHistoryOnly]);

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

    // Handle toggle change logic
    useEffect(() => {
        if (deliveryMethod === 'PICKUP') {
            setCustomerDelivery(0);
            setFreightExplanation('');
            setSelectedCarrierId('');
        }
    }, [deliveryMethod]);

    const selectedCalc = calculations.find(c => c.id === selectedCalcId);

    // Sync Effect for Freight Unit Cost
    useEffect(() => {
        if (selectedCalc?.quantity) {
            if (salesFreightInputMode === 'UNIT') {
                setCustomerDelivery(salesFreightUnitCost * selectedCalc.quantity);
            }
        }
    }, [salesFreightUnitCost, selectedCalc?.quantity, salesFreightInputMode]);

    // Filter calculations for the dropdown (only those with valid landed costs)
    const eligibleCalculations = calculations.filter(c => c.unitLandedCost > 0);

    // --- DATA PREPARATION FOR WORKSHEET ---
    // We map the raw calculation data into the shape needed for the grid
    const worksheetData = calculations.map(c => {
        // Calculate dynamic prices based on landed cost
        const price10 = c.unitLandedCost / (1 - 0.10);
        const price20 = c.unitLandedCost / (1 - 0.20);
        const price30 = c.unitLandedCost / (1 - 0.30);

        // Lookup Supplier
        const productRec = products.find(p => p.name === c.productName);
        // Get Supplier First Name (First word of supplier name)
        const fullSupplier = productRec ? productRec.supplier : '';
        const supplierFirst = fullSupplier ? fullSupplier.split(' ')[0] : '';

        return {
            id: c.id,
            code: c.calculationNumber,
            product: c.productName,
            supplier: supplierFirst, // Derived supplier first name
            landed: c.unitLandedCost,
            price10: price10,
            price20: price20,
            price30: price30,
            origin: c.origin, // Extra field for context if needed
            raw: c // Keep raw reference
        };
    });

    // Apply Filters
    const filteredWorksheetData = worksheetData.filter(row => {
        // Global search
        if (searchTerm) {
            const searchLower = searchTerm.toLowerCase();
            const matches = 
                row.code.toLowerCase().includes(searchLower) ||
                row.product.toLowerCase().includes(searchLower) ||
                row.supplier.toLowerCase().includes(searchLower);
            if (!matches) return false;
        }

        // Column specific filters
        for (const [key, selectedValues] of Object.entries(filters)) {
            // Explicitly cast to string[] to handle unknown inference in loop
            const values = selectedValues as string[];
            if (values.length > 0) {
                const cellValue = String(row[key as keyof typeof row]);
                if (!values.includes(cellValue)) return false;
            }
        }
        return true;
    });

    // Calculation Logic for Calculator Form
    const baseUnitCost = selectedCalc ? selectedCalc.unitLandedCost : 0;
    const deliveryPerUnit = (selectedCalc && selectedCalc.quantity > 0) ? customerDelivery / selectedCalc.quantity : 0;
    
    const commissionPerUnit = commissionType === 'FLAT' 
        ? commissionValue 
        : baseUnitCost * (commissionValue / 100);

    const totalUnitCostSold = baseUnitCost + deliveryPerUnit + commissionPerUnit;
    
    const marginDecimal = margin / 100;
    const salesPrice = margin < 100 ? totalUnitCostSold / (1 - marginDecimal) : 0;
    const profitPerUnit = salesPrice - totalUnitCostSold;
    const totalProfit = profitPerUnit * (selectedCalc?.quantity || 0);

    const handleLoad = (id: string) => {
        const calc = calculations.find(c => c.id === id);
        if (calc) {
            setSelectedCalcId(id);
            setMargin(calc.marginPercent || 0);
            setDeliveryMethod(calc.deliveryMethod === 'DELIVERY' ? 'DELIVERY' : 'PICKUP');
            setCustomerName(calc.customerName || '');
            setDeliveryCity(calc.deliveryCity || ''); 
            setDeliveryZip(calc.deliveryZip || '');
            setCustomerDelivery(0); 
            setSalesFreightUnitCost(0);
            setSalesFreightInputMode('TOTAL');
            setSelectedCarrierId(calc.salesCarrierId || '');
            setCommissionValue(calc.salesCommission || 0);
            setCommissionType(calc.salesCommissionType || 'FLAT');
            setIsHistoryMode(false);
        }
    }

    const handleDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (onDelete && window.confirm('Are you sure you want to delete this calculation?')) {
            onDelete(id);
        }
    };

    const handleSave = () => {
        if (!selectedCalc) return;

        const carrierName = carriers.find(c => c.id === selectedCarrierId)?.name;

        const updatedCalc: CostCalculation = {
            ...selectedCalc,
            marginPercent: margin,
            recommendedSalesPrice: salesPrice,
            customerName: customerName,
            deliveryMethod: deliveryMethod,
            deliveryCity: deliveryMethod === 'DELIVERY' ? deliveryCity : selectedCalc.deliveryCity,
            deliveryZip: deliveryMethod === 'DELIVERY' ? deliveryZip : selectedCalc.deliveryZip,
            salesCarrierId: selectedCarrierId,
            salesCarrierName: carrierName
        };

        onUpdate(updatedCalc);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
    };

    const handleCityBlur = async () => {
        if (!deliveryCity || deliveryCity.length < 3) return;
        setIsLocationLoading(true);
        const result = await lookupLocation(deliveryCity, 'city');
        setIsLocationLoading(false);
        if (result && result.zip) {
            setDeliveryZip(result.zip);
            setDeliveryCity(`${result.city}, ${result.state}`);
        }
    };
    
    const handleZipBlur = async () => {
        if (!deliveryZip || deliveryZip.length < 5) return;
        setIsLocationLoading(true);
        const result = await lookupLocation(deliveryZip, 'zip');
        setIsLocationLoading(false);
        if (result && result.city && result.state) {
            setDeliveryCity(`${result.city}, ${result.state}`);
        }
    };

    const handleEstimateFreight = async () => {
        if (!selectedCalc || !deliveryCity) return;
        setIsEstimatingFreight(true);
        setFreightExplanation('');
        const origin = selectedCalc.destination; 
        const destination = `${deliveryCity} ${deliveryZip}`;
        const result = await getDomesticFreightEstimate(origin, destination, selectedCalc.productName, selectedCalc.quantity);
        if (result) {
            setCustomerDelivery(result.estimatedCost);
            setSalesFreightUnitCost(selectedCalc.quantity > 0 ? result.estimatedCost / selectedCalc.quantity : 0);
            setFreightExplanation(result.explanation);
        }
        setIsEstimatingFreight(false);
    };

    // --- FILTER HANDLERS ---
    const toggleFilter = (column: string, value: string) => {
        setFilters(prev => {
            const current = prev[column] || [];
            if (current.includes(value)) {
                const updated = current.filter(v => v !== value);
                return updated.length === 0 
                    ? { ...prev, [column]: [] } // Clear if empty
                    : { ...prev, [column]: updated };
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

    const renderColumnHeader = (id: string, label: string, minWidth: string = "w-32", align: 'left' | 'right' = 'left') => {
        const uniqueValues = getUniqueValues(worksheetData, id);
        const activeValues = filters[id] || [];
        const isFilterActive = activeValues.length > 0;

        return (
            <th className={`px-4 py-3 bg-slate-50 border-b border-r border-slate-200 text-xs font-bold text-slate-600 uppercase tracking-wider relative group ${minWidth} text-${align}`}>
                <div className={`flex items-center gap-2 ${align === 'right' ? 'justify-end' : 'justify-between'}`}>
                    <span>{label}</span>
                    <button 
                        onClick={(e) => { e.stopPropagation(); setActiveFilterColumn(activeFilterColumn === id ? null : id); setFilterSearch(''); }}
                        className={`p-1 rounded hover:bg-slate-200 transition-colors ${isFilterActive ? 'text-blue-600 bg-blue-50' : 'text-slate-400 opacity-0 group-hover:opacity-100'}`}
                    >
                        <Filter size={14} fill={isFilterActive ? "currentColor" : "none"} />
                    </button>
                </div>

                {/* Filter Dropdown */}
                {activeFilterColumn === id && (
                    <div ref={filterMenuRef} className="absolute top-full right-0 mt-1 w-64 bg-white rounded-lg shadow-xl border border-slate-200 z-50 overflow-hidden animate-in fade-in zoom-in-95 text-left font-sans normal-case">
                        <div className="p-2 border-b border-slate-100">
                            <div className="relative">
                                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"/>
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
                                onClick={() => clearColumnFilter(id)}
                                className="w-full text-left px-2 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded flex items-center gap-2"
                            >
                                <X size={12}/> Clear Filter
                            </button>
                            {uniqueValues.filter(v => String(v).toLowerCase().includes(filterSearch.toLowerCase())).map(val => (
                                <button
                                    key={String(val)}
                                    onClick={() => toggleFilter(id, String(val))}
                                    className="w-full text-left px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded flex items-center gap-2"
                                >
                                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${activeValues.includes(String(val)) ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'}`}>
                                        {activeValues.includes(String(val)) && <CheckCircle2 size={10} className="text-white"/>}
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
        <div className="h-[calc(100vh-6rem)] overflow-hidden flex flex-col relative">
            {/* Header */}
            <div className="mb-6 flex items-start justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-r from-violet-500 to-purple-500 rounded-xl text-white">
                        {isHistoryMode ? <Grid size={24} /> : <Tag size={24} />}
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">
                            {isHistoryMode ? 'Price List Builder' : 'Sales Price Calculator'}
                        </h1>
                        <p className="text-slate-500 text-sm mt-1">
                            {isHistoryMode ? 'Master price list worksheet with dynamic margin scenarios.' : 'Calculate margin and profit for specific items.'}
                        </p>
                    </div>
                </div>
                {isHistoryMode ? (
                    <div className="flex gap-3 items-center">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                            <input
                                type="text"
                                placeholder="Global Search..."
                                className="pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 outline-none w-64"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <button
                            onClick={() => {
                                setIsHistoryMode(false);
                                setSelectedCalcId('');
                                setMargin(0);
                                setCustomerDelivery(0);
                                setDeliveryMethod('PICKUP');
                                setCustomerName('');
                                setDeliveryCity('');
                                setDeliveryZip('');
                                setCommissionValue(0);
                                setCommissionType('FLAT');
                                setSalesFreightUnitCost(0);
                                setSelectedCarrierId('');
                            }}
                            className="flex items-center gap-2 px-5 py-2.5 bg-violet-500 text-white rounded-lg hover:bg-violet-600 transition-all shadow-md font-medium"
                        >
                            <Plus size={18} /> New Item Price
                        </button>
                    </div>
                ) : (
                    <button onClick={() => setIsHistoryMode(true)} className="flex items-center gap-2 px-5 py-2.5 bg-violet-500 text-white rounded-lg hover:bg-violet-600 transition-all shadow-md font-medium">
                        <List size={16} /> View Price List
                    </button>
                )}
            </div>

            {!isHistoryMode ? (
                // --- SINGLE CALCULATOR MODE ---
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in slide-in-from-bottom-4 overflow-y-auto pb-12 custom-scrollbar">
                    {/* Input Section */}
                    <div className="lg:col-span-2 space-y-6">
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                            <h3 className="text-sm font-bold text-slate-800 uppercase mb-4 flex items-center gap-2">
                                <Search size={16} /> Select Source Cost
                            </h3>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Saved Cost Calculation</label>
                                <select 
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-700 focus:ring-2 focus:ring-emerald-500 outline-none"
                                    value={selectedCalcId}
                                    onChange={(e) => {
                                        setSelectedCalcId(e.target.value);
                                        const c = calculations.find(x => x.id === e.target.value);
                                        if (c) {
                                            setMargin(c.marginPercent || 0);
                                            setCustomerDelivery(0);
                                            setDeliveryMethod(c.deliveryMethod === 'DELIVERY' ? 'DELIVERY' : 'PICKUP');
                                            setCustomerName(c.customerName || '');
                                            setCommissionValue(c.salesCommission || 0);
                                            setCommissionType(c.salesCommissionType || 'FLAT');
                                            setSelectedCarrierId(c.salesCarrierId || '');
                                        }
                                    }}
                                >
                                    <option value="">-- Select Imported Product --</option>
                                    {eligibleCalculations.map(c => (
                                        <option key={c.id} value={c.id}>
                                            [{new Date(c.date).toLocaleDateString()}] {c.productName} ({c.quantity.toLocaleString()}) | {c.origin} | Base: ${c.fobPrice.toFixed(3)} → Landed: ${c.unitLandedCost.toFixed(3)}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {selectedCalc && (
                                <div className="mt-6 grid grid-cols-3 gap-4 bg-slate-50 p-4 rounded-lg border border-slate-100">
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Total Qty</p>
                                        <p className="font-mono font-bold text-slate-700">{selectedCalc.quantity.toLocaleString()}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Unit Landed Cost</p>
                                        <p className="font-mono font-bold text-slate-700">${selectedCalc.unitLandedCost.toFixed(4)}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Location</p>
                                        <p className="font-mono text-slate-500 text-xs truncate" title={selectedCalc.destination}>{selectedCalc.destination}</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                            <h3 className="text-sm font-bold text-slate-800 uppercase mb-4 flex items-center gap-2">
                                <DollarSign size={16} /> Pricing Factors
                            </h3>
                            
                            {/* Delivery Toggle */}
                            <div className="flex bg-slate-100 p-1 rounded-lg mb-6 w-fit">
                                <button
                                    onClick={() => setDeliveryMethod('PICKUP')}
                                    className={`px-4 py-2 text-xs font-bold rounded-md transition-all ${
                                        deliveryMethod === 'PICKUP' 
                                        ? 'bg-white text-emerald-700 shadow-sm' 
                                        : 'text-slate-500 hover:text-slate-700'
                                    }`}
                                >
                                    CUSTOMER PICK UP
                                </button>
                                <button
                                    onClick={() => setDeliveryMethod('DELIVERY')}
                                    className={`px-4 py-2 text-xs font-bold rounded-md transition-all ${
                                        deliveryMethod === 'DELIVERY' 
                                        ? 'bg-white text-blue-700 shadow-sm' 
                                        : 'text-slate-500 hover:text-slate-700'
                                    }`}
                                >
                                    DELIVERY INCLUDED
                                </button>
                            </div>

                            {/* Delivery Fields */}
                            {deliveryMethod === 'DELIVERY' && (
                                <div className="space-y-4 mb-6 p-4 bg-blue-50/50 rounded-xl border border-blue-100 animate-in slide-in-from-top-2">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-blue-800 uppercase mb-1 flex items-center gap-1">
                                                <User size={12}/> Customer Name
                                            </label>
                                            <input 
                                                type="text"
                                                value={customerName}
                                                onChange={e => setCustomerName(e.target.value)}
                                                className="w-full border border-blue-200 bg-white text-slate-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                                placeholder="Enter Customer Name"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-blue-800 uppercase mb-1 flex items-center gap-1">
                                                <Ship size={12}/> Transportation Company
                                            </label>
                                            <select 
                                                value={selectedCarrierId}
                                                onChange={e => setSelectedCarrierId(e.target.value)}
                                                className="w-full border border-blue-200 bg-white text-slate-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                            >
                                                <option value="">Select Carrier...</option>
                                                {carriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="relative">
                                            <label className="block text-xs font-bold text-blue-800 uppercase mb-1 flex items-center gap-1">
                                                <MapPin size={12}/> City
                                            </label>
                                            <input 
                                                type="text"
                                                value={deliveryCity}
                                                onChange={e => setDeliveryCity(e.target.value)}
                                                onBlur={handleCityBlur}
                                                className="w-full border border-blue-200 bg-white text-slate-700 rounded-lg p-2 text-sm pr-8 focus:ring-2 focus:ring-blue-500 outline-none"
                                                placeholder="e.g. Dalton, GA"
                                            />
                                            {isLocationLoading && <Loader2 className="absolute right-2 top-7 text-blue-400 animate-spin" size={14} />}
                                        </div>
                                        <div className="relative">
                                            <label className="block text-xs font-bold text-blue-800 uppercase mb-1">ZIP Code</label>
                                            <input 
                                                type="text"
                                                value={deliveryZip}
                                                onChange={e => setDeliveryZip(e.target.value)}
                                                onBlur={handleZipBlur}
                                                className="w-full border border-blue-200 bg-white text-slate-700 rounded-lg p-2 text-sm pr-8 focus:ring-2 focus:ring-blue-500 outline-none"
                                                placeholder="e.g. 30720"
                                            />
                                            {isLocationLoading && <Loader2 className="absolute right-2 top-7 text-blue-400 animate-spin" size={14} />}
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-4">
                                    {/* Sales Commission */}
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1">
                                            <Briefcase size={12}/> Sales Commission
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <FormattedInput 
                                                value={commissionValue} 
                                                onChange={setCommissionValue} 
                                                decimals={commissionType === 'PERCENT' ? 2 : 4}
                                                className="w-full border border-slate-600 bg-slate-900 text-white rounded-lg p-2 text-sm"
                                                placeholder="0"
                                            />
                                            <div className="flex bg-slate-100 rounded-lg p-1 border border-slate-200">
                                                <button 
                                                    onClick={() => setCommissionType('FLAT')}
                                                    className={`px-2 py-1 text-xs font-bold rounded ${commissionType === 'FLAT' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400'}`}
                                                >
                                                    $/LB
                                                </button>
                                                <button 
                                                    onClick={() => setCommissionType('PERCENT')}
                                                    className={`px-2 py-1 text-xs font-bold rounded ${commissionType === 'PERCENT' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400'}`}
                                                >
                                                    %
                                                </button>
                                            </div>
                                        </div>
                                        {commissionType === 'PERCENT' && (
                                            <p className="text-[10px] text-slate-400 mt-1">% of DDP Cost</p>
                                        )}
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1">
                                            <Percent size={12}/> Target Margin (%)
                                        </label>
                                        <FormattedInput 
                                            value={margin} 
                                            onChange={setMargin} 
                                            className="w-full border border-slate-600 bg-slate-900 text-white rounded-lg p-2 text-sm"
                                            placeholder="20"
                                        />
                                        <p className="text-[10px] text-slate-400 mt-1">Calculated as (Price - Cost) / Price</p>
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <div>
                                        <div className="flex justify-between items-center mb-1">
                                            <label className="block text-xs font-bold text-slate-500 uppercase flex items-center gap-1">
                                                <Truck size={12}/> Sales Freight Cost
                                            </label>
                                            {deliveryMethod === 'DELIVERY' && (
                                                <div className="flex gap-2">
                                                    <div className="flex bg-slate-100 rounded p-0.5">
                                                        <button 
                                                            onClick={() => { setSalesFreightInputMode('TOTAL'); setCustomerDelivery(salesFreightUnitCost * (selectedCalc?.quantity || 0)); }}
                                                            className={`px-2 py-0.5 text-[10px] font-bold rounded ${salesFreightInputMode === 'TOTAL' ? 'bg-white shadow text-blue-600' : 'text-slate-400'}`}
                                                        >
                                                            TOTAL
                                                        </button>
                                                        <button 
                                                            onClick={() => { setSalesFreightInputMode('UNIT'); setSalesFreightUnitCost(selectedCalc?.quantity && selectedCalc.quantity > 0 ? customerDelivery / selectedCalc.quantity : 0); }}
                                                            className={`px-2 py-0.5 text-[10px] font-bold rounded ${salesFreightInputMode === 'UNIT' ? 'bg-white shadow text-blue-600' : 'text-slate-400'}`}
                                                        >
                                                            $/LB
                                                        </button>
                                                    </div>
                                                    <button 
                                                        onClick={handleEstimateFreight}
                                                        disabled={isEstimatingFreight || !deliveryCity}
                                                        className="text-[10px] text-blue-600 font-bold hover:underline flex items-center gap-1 disabled:opacity-50 ml-1"
                                                    >
                                                        {isEstimatingFreight ? <Loader2 size={10} className="animate-spin"/> : <Wand2 size={10} />}
                                                        AI
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                        
                                        {salesFreightInputMode === 'TOTAL' ? (
                                            <FormattedInput 
                                                value={customerDelivery} 
                                                onChange={(val) => { setCustomerDelivery(val); if(selectedCalc?.quantity) setSalesFreightUnitCost(val/selectedCalc.quantity); }}
                                                disabled={deliveryMethod === 'PICKUP'}
                                                className={`w-full border rounded-lg p-2 text-sm ${
                                                    deliveryMethod === 'PICKUP' 
                                                    ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed' 
                                                    : 'border-slate-600 bg-slate-900 text-white'
                                                }`}
                                                placeholder="0.00"
                                            />
                                        ) : (
                                            <PriceInput 
                                                value={salesFreightUnitCost} 
                                                onChange={setSalesFreightUnitCost}
                                                disabled={deliveryMethod === 'PICKUP'}
                                                label="" 
                                            />
                                        )}

                                        {freightExplanation && deliveryMethod === 'DELIVERY' && (
                                            <p className="text-[10px] text-blue-600 mt-1 italic">{freightExplanation}</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Results Column */}
                    <div className="lg:col-span-1 space-y-6">
                        <div className="bg-emerald-900 text-white p-6 rounded-xl shadow-xl border-t-4 border-emerald-500 sticky top-4">
                            <h3 className="text-lg font-bold mb-6 flex items-center gap-2 border-b border-emerald-700/50 pb-2">
                                <Tag size={20} className="text-emerald-400"/> Price Breakdown
                            </h3>
                            
                            <div className="space-y-3 mb-6 font-mono text-sm">
                                <div className="flex justify-between">
                                    <span className="text-emerald-200">Base Unit Cost</span>
                                    <span>${baseUnitCost.toFixed(4)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-emerald-200">Delivery Cost</span>
                                    <span>${deliveryPerUnit.toFixed(4)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-emerald-200">Commission</span>
                                    <span>${commissionPerUnit.toFixed(4)}</span>
                                </div>
                                <div className="flex justify-between border-t border-emerald-700/50 pt-2 font-bold">
                                    <span className="text-emerald-100">Total Sold Cost</span>
                                    <span>${totalUnitCostSold.toFixed(4)}</span>
                                </div>
                            </div>

                            <div className="bg-emerald-800/50 p-4 rounded-lg space-y-4">
                                <div className="text-center">
                                    <span className="text-emerald-300 text-xs font-bold uppercase tracking-wider block mb-1">Recommended Sales Price</span>
                                    <span className="text-3xl font-bold text-white block">${salesPrice.toLocaleString(undefined, {minimumFractionDigits: 4, maximumFractionDigits: 4})}</span>
                                </div>
                                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-emerald-700/50 text-center text-xs">
                                    <div>
                                        <span className="block text-emerald-400">Unit Profit</span>
                                        <span className="block font-bold">${profitPerUnit.toFixed(4)}</span>
                                    </div>
                                    <div>
                                        <span className="block text-emerald-400">Total Profit</span>
                                        <span className="block font-bold">${totalProfit.toLocaleString(undefined, {maximumFractionDigits: 0})}</span>
                                    </div>
                                </div>
                            </div>

                            <button 
                                onClick={handleSave}
                                disabled={!selectedCalc}
                                className="w-full mt-6 bg-emerald-500 hover:bg-emerald-600 text-white py-3 rounded-lg font-bold transition-colors flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {saveStatus === 'saved' ? <CheckCircle2 size={20}/> : <Save size={20} />}
                                {saveStatus === 'saved' ? 'Price Saved!' : 'Save Sales Price'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                // --- PRICE LIST WORKSHEET MODE ---
                <div className="h-full flex flex-col animate-in fade-in slide-in-from-bottom-2">
                    <div className="flex-1 bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden flex flex-col">
                        
                        {/* Worksheet Header */}
                        <div className="bg-slate-50 border-b border-slate-200 p-2 flex justify-between items-center text-xs">
                            <span className="font-bold text-slate-500 uppercase tracking-wider px-2">Price List Worksheet</span>
                            <div className="flex items-center gap-2">
                                <button 
                                    className="px-3 py-1.5 bg-white border border-slate-300 rounded text-slate-600 hover:bg-slate-100 flex items-center gap-1 shadow-sm"
                                    onClick={() => {/* Placeholder for export logic */}}
                                >
                                    <Download size={14} /> Export CSV
                                </button>
                            </div>
                        </div>

                        {/* Worksheet Table */}
                        <div className="flex-1 overflow-auto custom-scrollbar">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-slate-50 sticky top-0 z-20 shadow-sm">
                                    <tr>
                                        {renderColumnHeader('code', 'Product Code')}
                                        {renderColumnHeader('product', 'Product', 'w-48')}
                                        {/* New Supplier Column */}
                                        {renderColumnHeader('supplier', 'Supplier', 'w-32')}
                                        
                                        {/* Dynamic Margin Columns */}
                                        <th className="px-4 py-3 bg-blue-50 border-b border-r border-blue-100 text-xs font-bold text-blue-800 uppercase tracking-wider text-right w-32">
                                            Price +10%
                                        </th>
                                        <th className="px-4 py-3 bg-indigo-50 border-b border-r border-indigo-100 text-xs font-bold text-indigo-800 uppercase tracking-wider text-right w-32">
                                            Price +20%
                                        </th>
                                        <th className="px-4 py-3 bg-purple-50 border-b border-r border-purple-100 text-xs font-bold text-purple-800 uppercase tracking-wider text-right w-32">
                                            Price +30%
                                        </th>
                                        <th className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider text-right w-32">
                                            Actions
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {filteredWorksheetData.map((row, index) => (
                                        <tr key={row.id} className={`hover:bg-slate-50 transition-colors ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}>
                                            <td className="px-4 py-2 text-xs font-mono text-slate-500 border-r border-slate-100">{row.code}</td>
                                            <td className="px-4 py-2 text-sm font-medium text-slate-800 border-r border-slate-100">{row.product}</td>
                                            <td className="px-4 py-2 text-sm text-slate-600 border-r border-slate-100">{row.supplier}</td>
                                            
                                            {/* +10% Column */}
                                            <td className="px-4 py-2 text-right border-r border-slate-100 bg-blue-50/20 align-top">
                                                <div className="font-mono text-sm text-blue-700 font-bold">${row.price10.toFixed(4)} <span className="text-[10px] font-normal opacity-70">/lb</span></div>
                                                <div className="font-mono text-xs text-blue-400 mt-0.5">${(row.price10 * KG_CONVERSION).toFixed(4)} <span className="text-[10px] font-normal opacity-70">/kg</span></div>
                                            </td>
                                            
                                            {/* +20% Column */}
                                            <td className="px-4 py-2 text-right border-r border-slate-100 bg-indigo-50/20 align-top">
                                                <div className="font-mono text-sm text-indigo-700 font-bold">${row.price20.toFixed(4)} <span className="text-[10px] font-normal opacity-70">/lb</span></div>
                                                <div className="font-mono text-xs text-indigo-400 mt-0.5">${(row.price20 * KG_CONVERSION).toFixed(4)} <span className="text-[10px] font-normal opacity-70">/kg</span></div>
                                            </td>
                                            
                                            {/* +30% Column */}
                                            <td className="px-4 py-2 text-right border-r border-slate-100 bg-purple-50/20 align-top">
                                                <div className="font-mono text-sm text-purple-700 font-extrabold">${row.price30.toFixed(4)} <span className="text-[10px] font-normal opacity-70">/lb</span></div>
                                                <div className="font-mono text-xs text-purple-400 mt-0.5">${(row.price30 * KG_CONVERSION).toFixed(4)} <span className="text-[10px] font-normal opacity-70">/kg</span></div>
                                            </td>

                                            <td className="px-4 py-2 text-right">
                                                <div className="flex justify-end gap-3">
                                                    <button 
                                                        onClick={() => handleLoad(row.id)}
                                                        className="text-xs font-bold text-slate-400 hover:text-blue-600 transition-colors flex items-center gap-1"
                                                    >
                                                        <Eye size={14} /> View
                                                    </button>
                                                    <button 
                                                        onClick={(e) => handleDelete(row.id, e)}
                                                        className="text-xs font-bold text-slate-400 hover:text-red-600 transition-colors flex items-center gap-1"
                                                    >
                                                        <Trash2 size={14} /> Delete
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {filteredWorksheetData.length === 0 && (
                                        <tr>
                                            <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                                                No products found matching filters.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        <div className="bg-slate-50 border-t border-slate-200 p-2 text-xs text-slate-500 flex justify-between">
                            <span>Showing {filteredWorksheetData.length} records</span>
                            <span>Calculated on Landed Cost (DDP)</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SalesPriceCalculator;
