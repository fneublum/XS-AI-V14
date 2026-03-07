import React, { useState, useEffect } from 'react';
import { Product, Supplier, SupplierOffer, Port, CostCalculation, SupplierQuote, Company, Carrier, FreightQuote, SavedLocation, SalesOrder, PriceList } from '../types';
import {
    Calculator, DollarSign, RefreshCw, Save, TrendingUp,
    Ship, Truck, Globe, Percent, Wand2, FilePlus, FolderOpen,
    Briefcase, Lock, Truck as TruckIcon, ArrowRight, Package, MapPin, Anchor, X, CheckCircle2, Loader2, FileText, Download, Plus, Pencil, Building2, History, Tag, AlertTriangle, LayoutGrid, List, Search, Trash2, Plane, ShoppingBag, Table, ShieldCheck, Landmark, Receipt, ChevronDown
} from 'lucide-react';
import { QuantityInput, PriceInput, FormattedInput } from '../components/UnitInputs';
import { getGeminiInsight, lookupLocation } from '../services/geminiService';
import CalculationSheet from './CalculationSheet';

// Fix: Added 'HISTORY' to CalcMode union
type CalcMode = 'IMPORT' | 'EXPORT' | 'LOCAL' | 'SHEET' | 'PRICE_LIST' | 'HISTORY';
type Incoterm = 'EXW' | 'FAS' | 'FOB' | 'CFR' | 'CIF' | 'CPT' | 'CIP' | 'DAP' | 'DPU' | 'DDP';

interface BigCalculatorProps {
    products: Product[];
    suppliers: Supplier[];
    supplierOffers: SupplierOffer[];
    supplierQuotes?: SupplierQuote[];
    freightQuotes?: FreightQuote[];
    salesOrders?: SalesOrder[];
    ports: Port[];
    savedCalculations: CostCalculation[];
    onSave: (c: CostCalculation) => void;
    onUpdate?: (c: CostCalculation) => void;
    onDelete?: (id: string) => void;
    onAddProduct: (p: Product) => void;
    onAddPort: (p: Port) => void;
    onAddSupplier: (s: Supplier) => void;
    currentCompanyId: string;
    availableCompanies?: Company[];
    carriers?: Carrier[];
    onAddCarrier: (c: Carrier) => void;
    locations: SavedLocation[];
    onAddLocation: (l: SavedLocation) => void;
    initialViewMode?: 'grid' | 'table';
    initialHistoryOnly?: boolean;
    initialMode?: CalcMode;
    onSwitchToCalculator?: (view: CalcMode) => void;
    loadCalculationId?: string | null;
    onLoadCalculation?: (id: string) => void;
    allowMargin?: boolean;
    priceLists?: PriceList[];
    onSavePriceList?: (p: PriceList) => void;
    onUpdatePriceList?: (p: PriceList) => void;
    readOnly?: boolean;
    currentUser?: any;
}

const TapeRow = ({ label, amount, quantity, totalForPercent, icon: Icon, isTotal = false }: { label: string, amount: number, quantity: number, totalForPercent?: number, icon: any, isTotal?: boolean }) => {
    const perLb = quantity > 0 ? amount / quantity : 0;
    const perKg = perLb * 2.20462;
    const percent = (totalForPercent && totalForPercent > 0) ? (amount / totalForPercent) * 100 : 0;

    return (
        <div className={`flex justify-between items-center py-2 px-3 rounded ${isTotal ? 'bg-white/10 font-bold border border-white/20' : 'hover:bg-white/5'}`}>
            <div className="flex items-center gap-3 flex-1">
                <div className={`p-1.5 rounded ${isTotal ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
                    <Icon size={14} />
                </div>
                <span className={`text-xs ${isTotal ? 'text-white tracking-wider' : 'text-slate-300'}`}>{label}</span>
            </div>
            <div className="flex items-center justify-end gap-2 text-right">
                <span className={`w-28 font-mono ${isTotal ? 'text-emerald-400 text-lg' : 'text-white'}`}>
                    ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="w-20 hidden sm:block font-mono text-xs text-slate-400">
                    ${perLb.toFixed(4)}
                </span>
                <span className="w-20 hidden md:block font-mono text-xs text-slate-500">
                    ${perKg.toFixed(4)}
                </span>
                <span className="w-12 text-[10px] text-slate-600">
                    {percent > 0 && !isTotal ? `${percent.toFixed(1)}%` : ''}
                </span>
            </div>
        </div>
    );
};

const BigCalculator: React.FC<BigCalculatorProps> = ({
    products, suppliers, supplierOffers, supplierQuotes = [], freightQuotes = [], salesOrders = [], ports, savedCalculations,
    onSave, onUpdate, onDelete, onAddProduct, onAddPort, onAddSupplier, currentCompanyId, availableCompanies = [],
    carriers = [], onAddCarrier, locations, onAddLocation,
    initialViewMode = 'grid', initialHistoryOnly = false, initialMode = 'IMPORT',
    onSwitchToCalculator, loadCalculationId, onLoadCalculation, allowMargin = true,
    priceLists = [], onSavePriceList, onUpdatePriceList,
    readOnly = false, currentUser
}) => {

    const [isHistoryMode, setIsHistoryMode] = useState(initialHistoryOnly);
    const [viewMode, setViewMode] = useState<'grid' | 'table'>(initialViewMode);
    const [searchTerm, setSearchTerm] = useState('');
    const [mode, setMode] = useState<CalcMode>(initialMode);

    // Incoterms
    const [incoterm, setIncoterm] = useState<Incoterm>('FOB');
    const [saleIncoterm, setSaleIncoterm] = useState<Incoterm>('CIF');

    // Modals & Selection
    const [showLoadOfferModal, setShowLoadOfferModal] = useState(false);
    const [offerSearchTerm, setOfferSearchTerm] = useState('');
    const [selectedFreightQuoteId, setSelectedFreightQuoteId] = useState('');
    const [selectedCalcId, setSelectedCalcId] = useState<string>('');

    // Calculator Fields
    const [productName, setProductName] = useState('');
    const [supplierName, setSupplierName] = useState('');
    const [quoteNumber, setQuoteNumber] = useState('');
    const [quantity, setQuantity] = useState(44000);
    const [basePrice, setBasePrice] = useState(0);
    const [currency, setCurrency] = useState('USD');

    // Logistics
    const [originPort, setOriginPort] = useState('');
    const [destinationPort, setDestinationPort] = useState('');
    const [pickupCity, setPickupCity] = useState('');
    const [pickupZip, setPickupZip] = useState('');
    const [isPickupLocationLoading, setIsPickupLocationLoading] = useState(false);
    const [deliveryCity, setDeliveryCity] = useState('');
    const [deliveryZip, setDeliveryZip] = useState('');
    const [isLocationLoading, setIsLocationLoading] = useState(false);

    // Costs
    const [useAllInFreight, setUseAllInFreight] = useState(false);
    const [allInFreight, setAllInFreight] = useState(0);
    const [freightInputMode, setFreightInputMode] = useState<'TOTAL' | 'UNIT'>('TOTAL');
    const [freightUnitCost, setFreightUnitCost] = useState(0);

    const [costPickup, setCostPickup] = useState(0);
    const [costOcean, setCostOcean] = useState(0);
    const [deliveryCost, setDeliveryCost] = useState(0);

    const [insuranceCost, setInsuranceCost] = useState(0);
    const [dutyPercent, setDutyPercent] = useState(0);
    const [clearanceCost, setClearanceCost] = useState(0);

    // Sales
    const [marginPercent, setMarginPercent] = useState(15);
    const [commissionPercent, setCommissionPercent] = useState(0);
    const [salesDeliveryMethod, setSalesDeliveryMethod] = useState<'PICKUP' | 'DELIVERY'>('PICKUP');
    const [salesFreightCost, setSalesFreightCost] = useState(0);
    const [salesFreightInputMode, setSalesFreightInputMode] = useState<'TOTAL' | 'UNIT'>('TOTAL');
    const [salesFreightUnitCost, setSalesFreightUnitCost] = useState(0);
    const [salesCarrierId, setSalesCarrierId] = useState('');

    // Feedback & AI
    const [aiInsight, setAiInsight] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [actionMessage, setActionMessage] = useState('');
    const [targetCompanyId, setTargetCompanyId] = useState<string>('');

    // Quick Adds
    const [showQuickAddModal, setShowQuickAddModal] = useState(false);
    const [newProdName, setNewProdName] = useState('');
    const [newProdSupplier, setNewProdSupplier] = useState('');
    const [newProdPrice, setNewProdPrice] = useState(0);
    const [showQuickAddSupplier, setShowQuickAddSupplier] = useState(false);
    const [newSupplierName, setNewSupplierName] = useState('');
    const [supplierAddedMessage, setSupplierAddedMessage] = useState('');
    const [showQuickAddPort, setShowQuickAddPort] = useState(false);
    const [newPortCode, setNewPortCode] = useState('');
    const [newPortName, setNewPortName] = useState('');
    const [newPortCountry, setNewPortCountry] = useState('');
    const [portAddedMessage, setPortAddedMessage] = useState('');
    const [targetPortField, setTargetPortField] = useState<'origin' | 'destination' | null>(null);
    const [showQuickAddCarrier, setShowQuickAddCarrier] = useState(false);
    const [newCarrierName, setNewCarrierName] = useState('');
    const [newCarrierScac, setNewCarrierScac] = useState('');
    const [showQuickAddLocation, setShowQuickAddLocation] = useState(false);
    const [newLocName, setNewLocName] = useState('');
    const [newLocAddress, setNewLocAddress] = useState('');
    const [newLocCity, setNewLocCity] = useState('');
    const [newLocState, setNewLocState] = useState('');
    const [newLocZip, setNewLocZip] = useState('');
    const [locationAddedMessage, setLocationAddedMessage] = useState('');
    const [targetLocationField, setTargetLocationField] = useState<'pickup' | 'delivery' | null>(null);

    // Auto Search
    const [autoSearchStatus, setAutoSearchStatus] = useState<'idle' | 'searching' | 'found' | 'none'>('idle');
    const [bestQuoteFound, setBestQuoteFound] = useState<FreightQuote | null>(null);
    const [showFreightModal, setShowFreightModal] = useState(false);
    const [freightSearchTerm, setFreightSearchTerm] = useState('');

    const activeFreightQuote = freightQuotes?.find(q => q.id === selectedFreightQuoteId);

    // --- Handlers ---

    const handleLoadHistory = (calcId: string) => {
        const calc = savedCalculations.find(c => c.id === calcId);
        if (!calc) return;
        setSelectedCalcId(calcId);
        setProductName(calc.productName);
        setSupplierName(calc.supplierName || '');
        setQuoteNumber(calc.quoteNumber || '');

        let loadedMode: CalcMode = 'IMPORT';
        if (calc.origin === 'Local') {
            loadedMode = 'LOCAL';
            setOriginPort('');
            setDestinationPort('');
        } else if ((calc.origin || '').startsWith('Export: ')) {
            loadedMode = 'EXPORT';
            const cleanOrigin = (calc.origin || '').replace('Export: ', '');
            const parts = cleanOrigin.split(' -> ');
            setOriginPort(parts[0] || '');
            setDestinationPort(parts[1] || calc.destination);
            setSaleIncoterm('CIF');
            setIncoterm('EXW');
        } else {
            loadedMode = 'IMPORT';
            const parts = (calc.origin || '').split(' -> ');
            setOriginPort(parts[0] || calc.origin);
            setDestinationPort(parts[1] || calc.destination);
        }
        setMode(loadedMode);
        setQuantity(calc.quantity);
        setBasePrice(calc.fobPrice);
        setUseAllInFreight(true);
        setAllInFreight(calc.freightCost);
        setFreightInputMode('TOTAL');
        setFreightUnitCost(calc.quantity > 0 ? calc.freightCost / calc.quantity : 0);
        setInsuranceCost(calc.insuranceCost);
        setDutyPercent(calc.dutyPercent);
        setClearanceCost(calc.portClearanceCost);
        setMarginPercent(calc.marginPercent);
        setCommissionPercent(calc.salesCommission || 0);
        if (calc.pickupMethod) setIncoterm(calc.pickupMethod as Incoterm);
        if (calc.deliveryMethod) {
            if (calc.deliveryMethod === 'PICKUP' || calc.deliveryMethod === 'DELIVERY') {
                setSalesDeliveryMethod(calc.deliveryMethod as any);
            } else {
                setSaleIncoterm(calc.deliveryMethod as Incoterm);
            }
        } else {
            setSalesDeliveryMethod('PICKUP');
        }
        if (calc.deliveryCity) setDeliveryCity(calc.deliveryCity);
        if (calc.deliveryZip) setDeliveryZip(calc.deliveryZip);
        if (calc.salesCarrierId) setSalesCarrierId(calc.salesCarrierId);

        // Load pickup location if available
        if (calc.pickupLocation) setPickupCity(calc.pickupLocation);

        setIsHistoryMode(false);
        setActionMessage('Calculation Loaded');
        setTimeout(() => setActionMessage(''), 2000);
    };

    // ... effects ...
    useEffect(() => {
        setIsHistoryMode(initialHistoryOnly);
    }, [initialHistoryOnly]);

    useEffect(() => {
        setMode(initialMode);
        if (initialMode === 'IMPORT') setIncoterm('FOB');
        else if (initialMode === 'EXPORT') { setIncoterm('EXW'); setSaleIncoterm('CIF'); }
        else if (initialMode === 'LOCAL') setIncoterm('EXW');
    }, [initialMode]);

    useEffect(() => {
        if (loadCalculationId) handleLoadHistory(loadCalculationId);
    }, [loadCalculationId]);

    useEffect(() => {
        if (currentCompanyId !== 'ALL') setTargetCompanyId(currentCompanyId);
        else if (availableCompanies && availableCompanies.length > 0) setTargetCompanyId(availableCompanies[0].id);
    }, [currentCompanyId, availableCompanies]);

    useEffect(() => {
        if (mode === 'LOCAL') setUseAllInFreight(true);
    }, [mode]);

    useEffect(() => {
        if (freightInputMode === 'UNIT') setAllInFreight(freightUnitCost * quantity);
    }, [freightUnitCost, quantity, freightInputMode]);

    useEffect(() => {
        if (salesFreightInputMode === 'UNIT') setSalesFreightCost(salesFreightUnitCost * quantity);
    }, [salesFreightUnitCost, quantity, salesFreightInputMode]);

    useEffect(() => {
        if (selectedCalcId) {
            const c = savedCalculations.find(x => x.id === selectedCalcId);
            if (c && c.quantity) {
                if (salesFreightInputMode === 'UNIT') {
                    // Recalculate total sales freight when unit cost changes
                }
            }
        }
    }, []);

    const eligibleCalculations = savedCalculations.filter(c => c.unitLandedCost > 0);

    const currentView = isHistoryMode ? 'HISTORY' : mode;

    // Merge marginPercent from priceLists into savedCalculations when in PRICE_LIST mode
    const calculationsWithMargin = React.useMemo(() => {
        if (mode !== 'PRICE_LIST' || !priceLists || priceLists.length === 0) {
            return savedCalculations;
        }

        const priceListMap = new Map(priceLists.map(pl => [pl.id, pl.marginPercent || 0]));

        return savedCalculations.map(calc => {
            const priceListMargin = priceListMap.get(calc.id);
            if (priceListMargin !== undefined) {
                return { ...calc, marginPercent: priceListMargin };
            }
            return calc;
        });
    }, [savedCalculations, priceLists, mode]);

    // Wrap onUpdate to also save/update marginPercent to priceLists
    const handleCalculationUpdate = React.useCallback(async (calc: CostCalculation) => {
        // Always update cost_calculations
        if (onUpdate) {
            onUpdate(calc);
        }

        // Additionally save to price_lists when in PRICE_LIST mode using direct upsert
        if (mode === 'PRICE_LIST') {
            try {
                const { getSupabaseClient } = await import('../services/supabase');
                const client = getSupabaseClient();

                const priceListEntry = {
                    id: calc.id,
                    companyId: calc.companyId,
                    marginPercent: calc.marginPercent
                };

                await client.from('price_lists').upsert(priceListEntry, { onConflict: 'id' });
            } catch (error) {
                console.error('Failed to sync margin to price_lists:', error);
            }
        }
    }, [onUpdate, mode]);

    if (mode === 'SHEET' || mode === 'PRICE_LIST') {
        return (
            <div className="flex flex-col h-full">
                <CalculationSheet
                    calculations={calculationsWithMargin}
                    products={products}
                    supplierOffers={supplierOffers}
                    freightQuotes={freightQuotes}
                    ports={ports}
                    onSave={onSave}
                    onUpdate={handleCalculationUpdate}
                    onDelete={onDelete!}
                    currentCompanyId={currentCompanyId}
                    availableCompanies={availableCompanies!}
                    isPriceList={mode === 'PRICE_LIST'}
                    allowMargin={allowMargin}
                    readOnly={readOnly}
                    currentUser={currentUser}
                />
            </div>
        );
    }

    // ... calculations logic ...
    const totalBase = basePrice * quantity;
    const isExport = mode === 'EXPORT';

    const appliedPickup =
        (mode === 'IMPORT' && incoterm === 'EXW') ? costPickup :
            (isExport && incoterm === 'EXW') ? costPickup : 0;

    const appliedOcean =
        (mode === 'IMPORT' && (incoterm === 'EXW' || incoterm === 'FOB')) ? costOcean :
            (isExport && ['CFR', 'CIF', 'DDP'].includes(saleIncoterm as any)) ? costOcean : 0;

    const appliedDelivery =
        (mode === 'IMPORT' && incoterm !== 'DDP') ? deliveryCost :
            (isExport && (saleIncoterm === 'DDP' || (saleIncoterm as any) === 'DELIVERED')) ? deliveryCost : 0;

    const appliedInsurance =
        (mode === 'IMPORT' && incoterm !== 'CIF') ? insuranceCost :
            (isExport && ['CIF', 'DDP'].includes(saleIncoterm as any)) ? insuranceCost : 0;

    const appliedAllInFreight = (mode === 'LOCAL' && incoterm !== 'EXW') ? 0 : allInFreight;
    const totalLogistics = useAllInFreight ? appliedAllInFreight : (appliedPickup + appliedOcean + appliedDelivery);

    const freightForDuty = useAllInFreight ? allInFreight : (appliedPickup + appliedOcean);
    const cifValue = totalBase + freightForDuty + appliedInsurance;

    const appliedDuty =
        (mode === 'IMPORT' && incoterm !== 'DDP') ? (cifValue * (dutyPercent / 100)) :
            (isExport && (saleIncoterm === 'DDP' || (saleIncoterm as any) === 'DELIVERED')) ? (cifValue * (dutyPercent / 100)) : 0;

    const appliedClearance =
        (mode === 'IMPORT' && incoterm !== 'DDP') ? clearanceCost :
            (isExport && saleIncoterm !== 'EXW') ? clearanceCost : 0;

    const subtotalImportFees = appliedDuty + appliedClearance + appliedInsurance;
    const totalLandedCost = totalBase + totalLogistics + subtotalImportFees;
    const unitLandedCost = quantity > 0 ? totalLandedCost / quantity : 0;

    const commissionAmount = totalLandedCost * (commissionPercent / 100);
    const applySalesFreight =
        (mode === 'EXPORT' && ['CFR', 'CIF', 'DDP'].includes(saleIncoterm as any)) ? true :
            (mode !== 'EXPORT' && salesDeliveryMethod === 'DELIVERY') ? true : false;

    const salesFreight = applySalesFreight ? salesFreightCost : 0;
    const costPlusComm = totalLandedCost + commissionAmount + salesFreight;

    const sellingPriceTotal = marginPercent < 100 ? costPlusComm / (1 - (marginPercent / 100)) : 0;
    const sellingPriceUnit = quantity > 0 ? sellingPriceTotal / quantity : 0;
    const profitTotal = sellingPriceTotal - costPlusComm;

    const filteredCalculations = savedCalculations.filter(c =>
        c.productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.calculationNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.origin || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    const getCalculationData = (id: string): CostCalculation => {
        const destString = deliveryCity ? `${deliveryCity} ${deliveryZip}`.trim() : destinationPort;
        const carrierName = carriers.find(c => c.id === salesCarrierId)?.name;
        const productRec = products.find(p => p.name === productName);

        let calcNumber = `BIG-${Date.now().toString().slice(-4)}`;
        if (id === selectedCalcId) {
            const existing = savedCalculations.find(c => c.id === id);
            if (existing) calcNumber = existing.calculationNumber;
        }
        return {
            id: id,
            companyId: targetCompanyId,
            calculationNumber: calcNumber,
            date: new Date().toISOString(),
            productName: productName || 'Calculator Draft',
            hsCode: productRec?.hsCode || '',
            origin: mode === 'LOCAL' ? 'Local' : `${mode === 'EXPORT' ? 'Export: ' : ''}${originPort} -> ${destinationPort}`,
            destination: destString || 'Calculated',
            pickupLocation: pickupCity, // Include pickup city
            fobPrice: basePrice,
            quantity: quantity,
            freightCost: totalLogistics,
            insuranceCost: appliedInsurance,
            dutyPercent: dutyPercent,
            portClearanceCost: clearanceCost,
            deliveryCost: useAllInFreight ? 0 : appliedDelivery,
            marginPercent: marginPercent,
            totalLandedCost: totalLandedCost,
            unitLandedCost: unitLandedCost,
            recommendedSalesPrice: sellingPriceUnit,
            deliveryCity: deliveryCity,
            deliveryZip: deliveryZip,
            deliveryMethod: mode === 'EXPORT' ? saleIncoterm : salesDeliveryMethod,
            pickupMethod: incoterm,
            salesCommission: commissionPercent,
            salesCommissionType: 'PERCENT',
            salesCarrierId: salesCarrierId,
            salesCarrierName: carrierName,
            supplierName: supplierName,
            quoteNumber: quoteNumber,
            poa: originPort,
            pod: destinationPort
        };
    };

    const handleUpdate = () => {
        if (!selectedCalcId || !onUpdate) return;
        const calc = getCalculationData(selectedCalcId);
        onUpdate(calc);
        setActionMessage("Calculation Updated Successfully!");
        setTimeout(() => setActionMessage(''), 3000);
    };

    const handleNew = () => {
        setIsHistoryMode(false);
        setProductName('');
        setSupplierName('');
        setQuoteNumber('');
        setBasePrice(0);
        setQuantity(44000);
        setSelectedCalcId('');
        setMode('IMPORT');
        setOriginPort('');
        setDestinationPort('');
        setIncoterm('FOB');
        setCostPickup(0);
        setCostOcean(0);
        setDeliveryCost(0);
        setInsuranceCost(0);
        setDutyPercent(0);
        setClearanceCost(0);
        setAllInFreight(0);
        setUseAllInFreight(false);
        setFreightUnitCost(0);
        setCommissionPercent(0);
        setSalesFreightCost(0);
        setAiInsight('');
        setActionMessage('New Calculation Started');
        setTimeout(() => setActionMessage(''), 2000);
    };

    const handleSaveNew = () => {
        const newId = `BC${Date.now()}`;
        const calc = getCalculationData(newId);
        onSave(calc);
        setSelectedCalcId(newId);
        setActionMessage("New Calculation Saved!");
        setTimeout(() => setActionMessage(''), 3000);
    };

    const handleViewChange = (view: CalcMode) => {
        if (onSwitchToCalculator) {
            onSwitchToCalculator(view);
        } else {
            if (view === 'HISTORY') {
                setIsHistoryMode(true);
            } else if (view === 'SHEET') {
                setIsHistoryMode(false);
                setMode('SHEET');
            } else if (view === 'PRICE_LIST') {
                setIsHistoryMode(false);
                setMode('PRICE_LIST');
            } else {
                setIsHistoryMode(false);
                setMode(view);
                if (view === 'IMPORT') setIncoterm('FOB');
                else if (view === 'EXPORT') { setIncoterm('EXW'); setSaleIncoterm('CIF'); }
                else if (view === 'LOCAL') setIncoterm('EXW');
            }
        }
    };

    const handleLoadOffer = (offerId: string, itemIndex: number) => {
        const source = supplierOffers.find(o => o.id === offerId);
        if (!source) return;
        const item = source.items[itemIndex];
        if (!item) return;

        setProductName(item.productName);
        setSupplierName(source.supplierName);
        setQuoteNumber(source.offerNumber || '');
        setQuantity(item.quantity);
        setBasePrice(item.unitPrice || 0);
        setCurrency(source.currency || 'USD');

        if (mode !== 'EXPORT') {
            let detectedMode: CalcMode = 'IMPORT';
            let supplierLocation = '';
            if (source.supplierId) {
                const supplier = suppliers.find(s => s.id === source.supplierId);
                if (supplier) supplierLocation = supplier.country || '';
            }
            if (source.incoterm && ['FOB', 'CFR', 'CIF', 'FAS'].includes(source.incoterm)) detectedMode = 'IMPORT';
            if (source.originPort || source.destinationPort) detectedMode = 'IMPORT';

            setMode(detectedMode);
            if (source.originPort) setOriginPort(source.originPort);
            else if (detectedMode === 'IMPORT' && supplierLocation) setOriginPort(supplierLocation);
            if (source.destinationPort) setDestinationPort(source.destinationPort);

            if (source.incoterm) {
                if (['EXW', 'FOB', 'CFR', 'CIF', 'DDP'].includes(source.incoterm)) setIncoterm(source.incoterm as any);
            } else {
                setIncoterm(detectedMode === 'IMPORT' ? 'FOB' : 'EXW');
            }
        }
        setSelectedCalcId('');
        setActionMessage(`Loaded Offer: ${source.offerNumber}`);
        setTimeout(() => setActionMessage(''), 2500);
        setShowLoadOfferModal(false);
    };

    const normalize = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, '');

    const handleAutoFindRate = () => {
        setAutoSearchStatus('searching');
        setBestQuoteFound(null);
        setTimeout(() => {
            if (!freightQuotes || freightQuotes.length === 0) {
                setAutoSearchStatus('none');
                return;
            }
            const inputOriginNorm = normalize(originPort);
            const inputDestNorm = normalize(destinationPort);
            const matches = freightQuotes.filter(q => {
                const quoteOriginNorm = normalize((q.originPort || '') + (q.originPortCode || ''));
                const quoteDestNorm = normalize((q.destinationPort || '') + (q.destinationPortCode || ''));
                if (!inputOriginNorm || !quoteOriginNorm) return false;
                if (!inputDestNorm || !quoteDestNorm) return false;
                const originMatch = inputOriginNorm.includes(quoteOriginNorm) || quoteOriginNorm.includes(inputOriginNorm);
                const destMatch = inputDestNorm.includes(quoteDestNorm) || quoteDestNorm.includes(inputDestNorm);
                return originMatch && destMatch;
            });
            if (matches.length > 0) {
                const best = matches.reduce((prev, curr) => prev.rate < curr.rate ? prev : curr);
                setBestQuoteFound(best);
                setAutoSearchStatus('found');
            } else {
                setAutoSearchStatus('none');
            }
        }, 800);
    };

    const handleLoadFreightQuote = (id: string, forceAllIn: boolean = false) => {
        setSelectedFreightQuoteId(id);
        const quote = freightQuotes?.find(q => q.id === id);
        if (!quote) return;
        if (quote.originPort) {
            setOriginPort(`${quote.originPort} ${quote.originPortCode ? `(${quote.originPortCode})` : ''}`);
            if (mode !== 'EXPORT') setMode('IMPORT');
        }
        if (quote.destinationPort) setDestinationPort(`${quote.destinationPort} ${quote.destinationPortCode ? `(${quote.destinationPortCode})` : ''}`);
        if (quote.pickupLocation) { setPickupCity(quote.pickupLocation); setPickupZip(quote.pickupZip || ''); }
        if (quote.deliveryLocation) { setDeliveryCity(quote.deliveryLocation); setDeliveryZip(quote.deliveryZip || ''); }

        const shouldUseAllIn = forceAllIn || useAllInFreight;
        if (shouldUseAllIn) {
            setAllInFreight(quote.rate);
            setFreightInputMode('TOTAL');
            setFreightUnitCost(quantity > 0 ? quote.rate / quantity : 0);
            setUseAllInFreight(true);
        } else {
            setCostOcean(quote.rate);
        }
        setShowFreightModal(false);
        setActionMessage('Freight Quote Applied');
        setTimeout(() => setActionMessage(''), 2500);
    };

    const handleQuickAddSubmit = () => {
        if (!newProdName || !newProdSupplier) return;
        const newProduct: Product = {
            id: `P${Date.now()}`, companyId: targetCompanyId, name: newProdName, category: 'Resin', grade: 'Standard', supplier: newProdSupplier, price: newProdPrice, stockStatus: 'Available', specs: { origin: 'Unknown', form: 'Pellets' }
        };
        onAddProduct(newProduct);
        setProductName(newProduct.name);
        setSupplierName(newProduct.supplier);
        setBasePrice(newProduct.price);
        setShowQuickAddModal(false);
        setNewProdName(''); setNewProdSupplier(''); setNewProdPrice(0);
        setActionMessage('Product Created');
        setTimeout(() => setActionMessage(''), 3000);
    };

    const handleQuickAddSupplier = () => {
        if (!newSupplierName.trim()) return;
        const newSupplier: Supplier = {
            id: `SUP${Date.now()}`,
            companyId: targetCompanyId,
            name: newSupplierName.trim(),
            contactPerson: 'TBD',
            email: '',
            phone: '',
            country: 'Unknown',
            categories: [],
            rating: 3,
            paymentTerms: 'Net 30'
        };
        onAddSupplier(newSupplier);
        setSupplierName(newSupplier.name);
        setShowQuickAddSupplier(false);
        setNewSupplierName('');
        setActionMessage('Supplier Added');
        setTimeout(() => setActionMessage(''), 3000);
    };

    const handleQuickAddPort = () => {
        if (!newPortCode || !newPortName) return;
        const newPort: Port = {
            id: `PRT${Date.now()}`,
            companyId: 'ALL',
            code: newPortCode.toUpperCase(),
            name: newPortName,
            country: newPortCountry
        };
        onAddPort(newPort);

        if (targetPortField === 'origin') {
            setOriginPort(`${newPort.name} (${newPort.code})`);
        } else if (targetPortField === 'destination') {
            setDestinationPort(`${newPort.name} (${newPort.code})`);
        }

        setShowQuickAddPort(false);
        setNewPortCode(''); setNewPortName(''); setNewPortCountry('');
        setActionMessage('Port Added');
        setTimeout(() => setActionMessage(''), 3000);
    };

    const handleQuickAddLocation = () => {
        if (!newLocName) return;
        const newLocation: SavedLocation = {
            id: `LOC${Date.now()}`,
            companyId: targetCompanyId,
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
        onAddLocation(newLocation);

        if (targetLocationField === 'delivery') {
            setDeliveryCity(`${newLocCity}, ${newLocState}`);
            setDeliveryZip(newLocZip);
        }

        setShowQuickAddLocation(false);
        setNewLocName(''); setNewLocAddress(''); setNewLocCity(''); setNewLocState(''); setNewLocZip('');
        setActionMessage('Location Added');
        setTimeout(() => setLocationAddedMessage(''), 3000);
    };

    const renderFreightInputs = () => (
        <>
            {autoSearchStatus === 'found' && bestQuoteFound && (
                <div className="mb-4 bg-emerald-50 border border-emerald-100 p-3 rounded-lg flex justify-between items-center animate-in fade-in slide-in-from-top-1">
                    <div className="flex items-center gap-3">
                        <div className="bg-emerald-100 p-1.5 rounded text-emerald-600"><CheckCircle2 size={16} /></div>
                        <div className="text-xs">
                            <span className="font-bold text-emerald-800 block">Best Rate Found: {bestQuoteFound.agentName}</span>
                            <span className="text-emerald-600 font-mono">${bestQuoteFound.rate.toLocaleString()} ({bestQuoteFound.carrier})</span>
                        </div>
                    </div>
                    <button onClick={() => { handleLoadFreightQuote(bestQuoteFound.id, true); setAutoSearchStatus('idle'); }} className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg font-bold shadow-sm transition-colors">Apply Rate</button>
                </div>
            )}
            {autoSearchStatus === 'none' && (
                <div className="mb-4 bg-amber-50 border border-amber-100 p-3 rounded-lg flex items-start gap-3 animate-in fade-in slide-in-from-top-1">
                    <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-800">
                        <span className="font-bold block text-amber-900">No matching freight quote found.</span>
                        <div className="flex gap-2 mt-1">
                            <button onClick={() => setAutoSearchStatus('idle')} className="text-amber-700 underline">Dismiss</button>
                            <button onClick={() => { setAutoSearchStatus('idle'); setShowFreightModal(true); }} className="text-amber-700 underline font-bold">Browse All</button>
                        </div>
                    </div>
                </div>
            )}
            <div className="animate-in fade-in">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Freight Cost</label>
                <div className="flex items-center gap-2">
                    <div className={activeFreightQuote ? "w-[120px] shrink-0" : "flex-1"}>
                        {freightInputMode === 'TOTAL' ? (
                            <FormattedInput value={allInFreight} onChange={(val) => { setAllInFreight(val); setFreightUnitCost(quantity > 0 ? val / quantity : 0); }} className="w-full border border-blue-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-blue-500" placeholder="0.00" />
                        ) : (
                            <PriceInput value={freightUnitCost} onChange={setFreightUnitCost} label="" />
                        )}
                    </div>
                    {activeFreightQuote && (
                        <div className="flex-1 bg-white border border-blue-200 rounded-lg py-2 px-3 shadow-sm flex items-center justify-between h-[42px] min-w-0">
                            <div className="flex items-center gap-2 overflow-hidden mr-2">
                                <span className="text-xs font-bold text-slate-700 truncate" title={activeFreightQuote.agentName}>{activeFreightQuote.agentName}</span>
                                <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-100 uppercase whitespace-nowrap shrink-0">{activeFreightQuote.carrier}</span>
                            </div>
                            <button onClick={() => setSelectedFreightQuoteId('')} className="text-slate-400 hover:text-red-500"><X size={14} /></button>
                        </div>
                    )}
                </div>
            </div>
        </>
    );

    return (
        <div className="h-[calc(100vh-6rem)] overflow-y-auto custom-scrollbar pb-12 relative">
            <div className="max-w-[1600px] mx-auto space-y-6">

                <div className="mb-6 flex items-start justify-between">
                    <div className="flex items-center gap-4">
                        <div className="p-2 bg-gradient-to-r from-violet-500 to-purple-500 rounded-xl text-white">
                            <Calculator size={24} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-800">Cost Calculation</h1>
                            <p className="text-slate-500 text-sm mt-1">Global Logistics & Pricing Engine</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <FolderOpen size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-violet-300 pointer-events-none" />
                            <select
                                className="appearance-none pl-9 pr-8 py-2.5 bg-violet-500 text-white rounded-lg hover:bg-violet-600 transition-all shadow-md font-medium text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-violet-400 min-w-[140px]"
                                value={selectedCalcId}
                                onChange={(e) => handleLoadHistory(e.target.value)}
                            >
                                <option value="" className="text-slate-700 bg-white">Load Saved</option>
                                {eligibleCalculations.map(c => (
                                    <option key={c.id} value={c.id} className="text-slate-700 bg-white text-xs">
                                        [{new Date(c.date).toLocaleDateString()}] {c.productName} — ${c.unitLandedCost.toFixed(3)}/lb
                                    </option>
                                ))}
                            </select>
                            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-violet-300 pointer-events-none" />
                        </div>
                        <button onClick={handleNew} className="flex items-center gap-2 px-5 py-2.5 bg-violet-500 text-white rounded-lg hover:bg-violet-600 transition-all shadow-md font-medium">
                            <FilePlus size={18} />
                            New
                        </button>
                        <button onClick={() => handleViewChange('HISTORY')} className="flex items-center gap-2 px-5 py-2.5 bg-violet-500 text-white rounded-lg hover:bg-violet-600 transition-all shadow-md font-medium">
                            <History size={18} />
                            History
                        </button>
                        {selectedCalcId && onUpdate && (
                            <button onClick={handleUpdate} className="p-2 text-amber-600 hover:bg-amber-50 rounded-md transition-colors" title="Update Current">
                                <RefreshCw size={20} />
                            </button>
                        )}
                        <button onClick={handleSaveNew} disabled={!productName} className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors disabled:opacity-50" title={selectedCalcId ? "Save as Copy" : "Save Calculation"}>
                            <Save size={20} />
                        </button>
                    </div>
                </div>

                {/* --- HISTORY MODE --- */}
                {isHistoryMode ? (
                    // ... existing history view ...
                    <div className="animate-in fade-in slide-in-from-bottom-4">
                        <div className="flex justify-between items-center mb-4">
                            <div className="relative w-64">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                <input type="text" placeholder="Search saved calculations..." className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                            </div>
                            <div className="bg-white border border-slate-200 rounded-lg p-1 flex gap-1">
                                <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded transition-all ${viewMode === 'grid' ? 'bg-slate-100 text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}><LayoutGrid size={16} /></button>
                                <button onClick={() => setViewMode('table')} className={`p-1.5 rounded transition-all ${viewMode === 'table' ? 'bg-slate-100 text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}><List size={16} /></button>
                            </div>
                        </div>
                        {/* ... Existing History Render Logic ... */}
                        {filteredCalculations.length === 0 ? (
                            <div className="text-center py-12 text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                                <Calculator size={48} className="mx-auto mb-2 opacity-50" />
                                <p>No calculations found.</p>
                            </div>
                        ) : viewMode === 'grid' ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {filteredCalculations.map(calc => (
                                    <div key={calc.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow group cursor-pointer relative" onClick={() => handleLoadHistory(calc.id)}>
                                        <div className="flex justify-between items-start mb-2"><span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded uppercase">{calc.calculationNumber}</span><span className="text-xs text-slate-400">{new Date(calc.date).toLocaleDateString()}</span></div>
                                        <h4 className="font-bold text-slate-800 text-lg mb-1 truncate" title={calc.productName}>{calc.productName}</h4>
                                        <p className="text-xs text-slate-500 mb-3 truncate">{calc.origin} → {calc.destination}</p>
                                        <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-100">
                                            <div><p className="text-[10px] font-bold text-slate-400 uppercase">Landed Cost</p><p className="font-mono font-bold text-slate-700">${calc.unitLandedCost.toFixed(4)}</p></div>
                                            <div className="text-right"><p className="text-[10px] font-bold text-emerald-600 uppercase">Rec. Price</p><p className="font-mono font-bold text-emerald-700">${calc.recommendedSalesPrice.toFixed(4)}</p></div>
                                        </div>
                                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-50">
                                            <button type="button" onClick={(e) => { e.stopPropagation(); if (onDelete && window.confirm('Delete?')) onDelete(calc.id); }} className="p-1.5 bg-white text-red-400 hover:text-red-600 hover:bg-red-50 rounded-full shadow-md border border-slate-200 transition-colors"><Trash2 size={14} /></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-slate-50 border-b border-slate-200">
                                        <tr><th className="px-6 py-3 font-semibold text-slate-600">Date</th><th className="px-6 py-3 font-semibold text-slate-600">Product</th><th className="px-6 py-3 font-semibold text-slate-600">Route</th><th className="px-6 py-3 font-semibold text-slate-600 text-right">Landed Cost</th><th className="px-6 py-3 font-semibold text-emerald-700 text-right">Sales Price</th><th className="px-6 py-3"></th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {filteredCalculations.map(calc => (
                                            <tr key={calc.id} className="hover:bg-slate-50 transition-colors">
                                                <td className="px-6 py-3 text-slate-500">{new Date(calc.date).toLocaleDateString()}</td>
                                                <td className="px-6 py-3 font-medium text-slate-800">{calc.productName}</td>
                                                <td className="px-6 py-3 text-slate-500 text-xs">{calc.origin} → {calc.destination}</td>
                                                <td className="px-6 py-3 text-right font-mono text-slate-700">${calc.unitLandedCost.toFixed(4)}</td>
                                                <td className="px-6 py-3 text-right font-mono font-bold text-emerald-600">${calc.recommendedSalesPrice.toFixed(4)}</td>
                                                <td className="px-6 py-3 text-right"><div className="flex justify-end gap-2"><button onClick={() => handleLoadHistory(calc.id)} className="text-blue-600 hover:underline text-xs font-bold">Load</button><button type="button" onClick={(e) => { e.stopPropagation(); if (onDelete && window.confirm('Delete?')) onDelete(calc.id); }} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={14} /></button></div></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                ) : (
                    // --- CALCULATOR INTERFACE ---
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 pb-12">
                        {/* LEFT COLUMN: INPUTS */}
                        <div className="xl:col-span-2 flex flex-col gap-6 h-fit">

                            {/* Panel 1.1: Product & Supplier */}
                            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                                {/* ... content unchanged ... */}
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-sm font-bold text-slate-800 uppercase flex items-center gap-2"><Package size={16} /> Sourcing</h3>
                                    <div className="flex gap-2">
                                        <button onClick={() => setShowLoadOfferModal(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors">
                                            <Download size={14} /> Load Offer
                                        </button>
                                        <button onClick={() => setShowQuickAddModal(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors">
                                            <FilePlus size={14} /> New Product
                                        </button>
                                        <button onClick={() => { setProductName(''); setSupplierName(''); setBasePrice(0); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-500 bg-slate-50 hover:bg-red-50 hover:text-red-500 rounded-lg transition-colors">
                                            <RefreshCw size={14} /> Clear
                                        </button>
                                    </div>
                                </div>
                                {/* Mode Buttons - IMPORT / EXPORT / LOCAL */}
                                <div className="flex items-center gap-2 mb-4">
                                    <button
                                        onClick={() => handleViewChange('IMPORT')}
                                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm transition-all ${mode === 'IMPORT'
                                            ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                                            : 'bg-indigo-100 text-indigo-600 hover:bg-indigo-200'
                                            }`}
                                    >
                                        <Globe size={16} /> Import
                                    </button>
                                    <button
                                        onClick={() => handleViewChange('EXPORT')}
                                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm transition-all ${mode === 'EXPORT'
                                            ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/30'
                                            : 'bg-orange-100 text-orange-600 hover:bg-orange-200'
                                            }`}
                                    >
                                        <Plane size={16} /> Export
                                    </button>
                                    <button
                                        onClick={() => handleViewChange('LOCAL')}
                                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm transition-all ${mode === 'LOCAL'
                                            ? 'bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-lg shadow-teal-500/30'
                                            : 'bg-teal-100 text-teal-600 hover:bg-teal-200'
                                            }`}
                                    >
                                        <Truck size={16} /> Local
                                    </button>
                                </div>
                                <div className="space-y-4">
                                    <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Product</label><input value={productName} onChange={e => setProductName(e.target.value)} className="w-full border-b border-slate-200 bg-transparent py-1 text-sm font-medium focus:border-blue-500 outline-none" placeholder="Product Name" /></div>
                                    <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Supplier</label><select value={supplierName} onChange={e => { if (e.target.value === '_ADD_NEW_') setShowQuickAddSupplier(true); else setSupplierName(e.target.value); }} className="w-full border-b border-slate-200 bg-transparent py-1 text-sm font-medium focus:border-blue-500 outline-none appearance-none"><option value="">Select Supplier...</option><option value="_ADD_NEW_">+ Add New Supplier</option>{[...suppliers].sort((a, b) => a.name.localeCompare(b.name)).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}</select></div>
                                    <div><label className="block text-[10px] font-bold text-slate-500 uppercase mb-2">Purchase Incoterm</label><div className="flex gap-1 flex-wrap">{['EXW', 'FOB', 'CFR', 'CIF', 'DDP'].map(term => (<button key={term} onClick={() => setIncoterm(term as Incoterm)} className={`flex-1 py-1.5 text-xs font-bold rounded border ${incoterm === term ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200'}`}>{term}</button>))}</div></div>
                                    <div className="grid grid-cols-2 gap-4"><QuantityInput value={quantity} onChange={setQuantity} label="Volume" /><PriceInput value={basePrice} onChange={setBasePrice} label={`Base Price (${currency})`} /></div>
                                </div>
                            </div>

                            {/* Panel 1.2: Logistics */}
                            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                                <h3 className="text-sm font-bold text-slate-800 uppercase mb-4 flex items-center gap-2"><MapPin size={16} /> LOGISTICS</h3>
                                <div className="space-y-4">
                                    {mode === 'EXPORT' && (
                                        <div><label className="block text-[10px] font-bold text-purple-800 uppercase mb-2">Sale Incoterm</label><div className="flex gap-1 flex-wrap">{['EXW', 'FOB', 'CFR', 'CIF', 'DDP'].map(term => (<button key={term} onClick={() => setSaleIncoterm(term as Incoterm)} className={`flex-1 py-1.5 text-xs font-bold rounded border ${saleIncoterm === term ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-purple-900/60 border-purple-200'}`}>{term}</button>))}</div></div>
                                    )}
                                    <div className="space-y-2">
                                        {(mode === 'IMPORT' || mode === 'EXPORT') && (
                                            <>
                                                <div><label className="block text-[10px] font-bold text-slate-400 uppercase">Origin Port</label><select className="w-full text-sm border-b border-slate-200 py-1 focus:border-blue-500 outline-none bg-transparent" value={originPort} onChange={e => e.target.value === '_ADD_NEW_' ? (setTargetPortField('origin'), setShowQuickAddPort(true)) : setOriginPort(e.target.value)}><option value="">Select...</option><option value="_ADD_NEW_">+ Add Port</option>{[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={`${p.name} (${p.code})`}>{p.name} ({p.code})</option>)}</select></div>
                                                <div><label className="block text-[10px] font-bold text-slate-400 uppercase">Dest Port</label><select className="w-full text-sm border-b border-slate-200 py-1 focus:border-blue-500 outline-none bg-transparent" value={destinationPort} onChange={e => e.target.value === '_ADD_NEW_' ? (setTargetPortField('destination'), setShowQuickAddPort(true)) : setDestinationPort(e.target.value)}><option value="">Select...</option><option value="_ADD_NEW_">+ Add Port</option>{[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={`${p.name} (${p.code})`}>{p.name} ({p.code})</option>)}</select></div>

                                                {/* CONDITIONAL RENDER: Only show delivery location if NOT Exporting CFR/CIF */}
                                                {(mode === 'IMPORT' || (mode === 'EXPORT' && !['CFR', 'CIF'].includes(saleIncoterm))) && (
                                                    <div className="pt-3 mt-3 border-t border-slate-100">
                                                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-2">Final Delivery Location</label>
                                                        <div className="mb-2"><select className="w-full text-sm border-b border-slate-200 py-1 focus:border-blue-500 outline-none bg-transparent font-medium text-slate-700" onChange={(e) => { if (e.target.value === '_ADD_NEW_') { setTargetLocationField('delivery'); setShowQuickAddLocation(true); } else { const loc = locations.find(l => l.id === e.target.value); if (loc) { setDeliveryCity(`${loc.address}, ${loc.city}, ${loc.state}`); setDeliveryZip(loc.zip); } } }} defaultValue=""><option value="">Select Saved Location...</option><option value="_ADD_NEW_">+ Add New Location</option>{locations.filter(l => l.companyId === currentCompanyId || l.companyId === 'ALL').sort((a, b) => a.name.localeCompare(b.name)).map(l => (<option key={l.id} value={l.id}>{l.name} - {l.city}</option>))}</select></div>
                                                        <div className="flex gap-4">
                                                            <div className="relative flex-grow"><input className="w-full text-sm border-b border-slate-200 py-1 focus:border-blue-500 outline-none bg-transparent placeholder-slate-400 truncate" placeholder="Address, City, State" value={deliveryCity} onChange={e => setDeliveryCity(e.target.value)} title={deliveryCity} /></div>
                                                            <div className="w-24 shrink-0"><input className="w-full text-sm border-b border-slate-200 py-1 focus:border-blue-500 outline-none bg-transparent placeholder-slate-400" placeholder="Zip Code" value={deliveryZip} onChange={e => setDeliveryZip(e.target.value)} /></div>
                                                        </div>
                                                    </div>
                                                )}
                                                {/* Logic for Export CFR/CIF: Clear delivery city on switch */}
                                                {mode === 'EXPORT' && ['CFR', 'CIF'].includes(saleIncoterm) && (
                                                    <div className="pt-3 mt-3 border-t border-slate-100 text-xs text-slate-500 italic">
                                                        Destination is Port of Discharge ({destinationPort || 'POD'}). No final delivery city required.
                                                    </div>
                                                )}
                                            </>
                                        )}
                                        {mode === 'LOCAL' && <div className="text-sm text-slate-500 italic p-2 bg-slate-50 rounded">Local Distribution Mode Active</div>}
                                    </div>
                                </div>
                            </div>

                            {/* ... remaining panels (costs, buttons) ... */}
                            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between">
                                {/* ... unchanged ... */}
                                <div>
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="text-sm font-bold text-slate-800 uppercase flex items-center gap-2"><DollarSign size={16} /> Freight & Port Costs</h3>
                                        <div className="flex gap-2 items-center">
                                            <button onClick={() => setShowFreightModal(true)} className="p-1.5 bg-slate-100 text-slate-600 rounded hover:bg-slate-200 transition-colors" title="Browse Freight Quotes"><List size={16} /></button>
                                            <button onClick={handleAutoFindRate} disabled={autoSearchStatus === 'searching'} className="text-[10px] bg-indigo-50 text-indigo-600 border border-indigo-100 px-2 py-1.5 rounded font-bold flex items-center gap-1 hover:bg-indigo-100 transition-colors">{autoSearchStatus === 'searching' ? <Loader2 className="animate-spin" size={12} /> : <Wand2 size={12} />} AI Find</button>
                                            <div className="flex bg-slate-100 rounded p-0.5"><button onClick={() => { setFreightInputMode('TOTAL'); setAllInFreight(freightUnitCost * quantity); }} className={`px-2 py-0.5 text-[10px] font-bold rounded ${freightInputMode === 'TOTAL' ? 'bg-white shadow text-blue-600' : 'text-slate-400'}`}>TOTAL</button><button onClick={() => { setFreightInputMode('UNIT'); setFreightUnitCost(quantity > 0 ? allInFreight / quantity : 0); }} className={`px-2 py-0.5 text-[10px] font-bold rounded ${freightInputMode === 'UNIT' ? 'bg-white shadow text-blue-600' : 'text-slate-400'}`}>/LB</button></div>
                                        </div>
                                    </div>
                                    <div className="space-y-4">
                                        {renderFreightInputs()}
                                        <div className="grid grid-cols-2 gap-4">
                                            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Duty %</label><FormattedInput value={dutyPercent} onChange={setDutyPercent} className="w-full border border-amber-200 bg-amber-50 text-amber-900 rounded p-2 text-sm" /></div>
                                            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><ShieldCheck size={12} /> Insurance ($)</label><FormattedInput value={insuranceCost} onChange={setInsuranceCost} className="w-full border border-slate-200 bg-slate-50 rounded p-2 text-sm" placeholder="0.00" /></div>
                                        </div>
                                        <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Port Fees / Clearance</label><FormattedInput value={clearanceCost} onChange={setClearanceCost} className="w-full border border-slate-200 bg-slate-50 rounded p-2 text-sm" placeholder="0.00" /></div>
                                    </div>
                                </div>
                                <div className="mt-4 pt-3 border-t border-slate-100">
                                    <div className="flex justify-between items-center text-sm font-bold text-slate-700"><span>Unit Landed Cost</span><span className="font-mono text-lg">${unitLandedCost.toFixed(4)}</span></div>
                                </div>
                            </div>

                            {actionMessage && <div className="text-center text-emerald-600 text-sm font-bold animate-in fade-in slide-in-from-bottom-1 flex items-center justify-center gap-2"><CheckCircle2 size={16} /> {actionMessage}</div>}
                        </div>

                        {/* RIGHT COLUMN: OUTPUTS (Tape) */}
                        <div className="xl:col-span-1 w-full">
                            <div className="sticky top-4 space-y-4">
                                {/* Financial Tape */}
                                <div className="bg-slate-900 rounded-xl border border-slate-800 p-6 text-white font-mono flex flex-col justify-between shadow-2xl">
                                    <div>
                                        <div className="flex justify-between items-center mb-6 pb-2 border-b border-white/10"><span className="font-bold text-white uppercase tracking-widest text-sm">FINANCIAL TAPE</span></div>
                                        <div className="flex justify-between items-center text-xs text-white/60 uppercase font-bold border-b border-white/10 pb-2 mb-2 px-3 -mx-3"><span className="flex-1">Item</span><div className="flex items-center justify-end gap-2 text-right"><span className="w-28">Total ($)</span><span className="w-20 hidden sm:block">$/LB</span><span className="w-20 hidden md:block">$/KG</span><span className="w-12">%</span></div></div>
                                        <div className="flex flex-col gap-1">
                                            <div className="space-y-0.5">
                                                <TapeRow label="Base Product" amount={totalBase} quantity={quantity} totalForPercent={costPlusComm} icon={Package} />
                                                {useAllInFreight ? (
                                                    <TapeRow label="Freight (All-In)" amount={appliedAllInFreight} quantity={quantity} totalForPercent={costPlusComm} icon={Ship} />
                                                ) : (
                                                    <>
                                                        {appliedPickup > 0 && <TapeRow label="Pickup Freight" amount={appliedPickup} quantity={quantity} totalForPercent={costPlusComm} icon={Truck} />}
                                                        {appliedOcean > 0 && <TapeRow label="Ocean Freight" amount={appliedOcean} quantity={quantity} totalForPercent={costPlusComm} icon={Ship} />}
                                                        {appliedDelivery > 0 && <TapeRow label="Delivery Freight" amount={appliedDelivery} quantity={quantity} totalForPercent={costPlusComm} icon={Truck} />}
                                                    </>
                                                )}
                                                {appliedInsurance > 0 && <TapeRow label="Insurance" amount={appliedInsurance} quantity={quantity} totalForPercent={costPlusComm} icon={ShieldCheck} />}
                                                {appliedDuty > 0 && <TapeRow label={`Duty (${dutyPercent}%)`} amount={appliedDuty} quantity={quantity} totalForPercent={costPlusComm} icon={Landmark} />}
                                                {appliedClearance > 0 && <TapeRow label="Clearance/Fees" amount={appliedClearance} quantity={quantity} totalForPercent={costPlusComm} icon={FileText} />}
                                                {commissionAmount > 0 && <TapeRow label="Commission" amount={commissionAmount} quantity={quantity} totalForPercent={costPlusComm} icon={Briefcase} />}
                                                {salesFreight > 0 && <TapeRow label="Sales Freight" amount={salesFreight} quantity={quantity} totalForPercent={costPlusComm} icon={Truck} />}
                                                <TapeRow label="FINAL COST" amount={costPlusComm} quantity={quantity} totalForPercent={costPlusComm} isTotal icon={Anchor} />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* --- Modals --- */}
            {/* Load Offer Modal ... */}
            {showLoadOfferModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">
                        <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2"><Download size={20} /> Load Supplier Offer</h3>
                            <button onClick={() => setShowLoadOfferModal(false)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
                        </div>
                        <div className="p-4 border-b border-slate-100 bg-white">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                <input
                                    className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    placeholder="Search by Supplier, Product or Offer #..."
                                    value={offerSearchTerm}
                                    onChange={(e) => setOfferSearchTerm(e.target.value)}
                                    autoFocus
                                />
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-0 custom-scrollbar">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase sticky top-0 z-10">
                                    <tr>
                                        <th className="px-4 py-3">Offer #</th>
                                        <th className="px-4 py-3">Supplier</th>
                                        <th className="px-4 py-3">Product</th>
                                        <th className="px-4 py-3 text-right">Price</th>
                                        <th className="px-4 py-3 text-right">Incoterm</th>
                                        <th className="px-4 py-3 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-sm">
                                    {supplierOffers.filter(o => {
                                        const term = offerSearchTerm.toLowerCase();
                                        return !term ||
                                            o.supplierName.toLowerCase().includes(term) ||
                                            o.offerNumber.toLowerCase().includes(term) ||
                                            o.items.some(i => i.productName.toLowerCase().includes(term));
                                    }).flatMap(offer =>
                                        offer.items.map((item, idx) => (
                                            <tr key={`${offer.id}-${idx}`} className="hover:bg-slate-50 transition-colors">
                                                <td className="px-4 py-3 font-mono text-slate-600">{offer.offerNumber}</td>
                                                <td className="px-4 py-3 font-medium text-slate-700">{offer.supplierName}</td>
                                                <td className="px-4 py-3 text-slate-800">{item.productName}</td>
                                                <td className="px-4 py-3 text-right font-bold text-emerald-600">
                                                    {offer.currency} {item.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                </td>
                                                <td className="px-4 py-3 text-right text-xs bg-slate-50">
                                                    <span className="bg-slate-200 px-2 py-1 rounded text-slate-600">{offer.incoterm}</span>
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    <button
                                                        onClick={() => handleLoadOffer(offer.id, idx)}
                                                        className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 transition-colors"
                                                    >
                                                        Load
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* Quick Add Supplier Modal */}
            {showQuickAddSupplier && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50"><h3 className="font-bold text-slate-800 flex items-center gap-2"><Building2 size={20} /> Quick Add Supplier</h3><button onClick={() => setShowQuickAddSupplier(false)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button></div>
                        <div className="p-6 space-y-4">
                            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Supplier Name</label><input className="w-full border border-slate-300 rounded-lg p-2 text-sm" placeholder="e.g. Acme Corp" value={newSupplierName} onChange={e => setNewSupplierName(e.target.value)} autoFocus /></div>
                            <button onClick={handleQuickAddSupplier} disabled={!newSupplierName} className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">Add & Select Supplier</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Freight Quotes Modal */}
            {showFreightModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">
                        <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50"><h3 className="font-bold text-slate-800 flex items-center gap-2"><List size={20} /> Browse Freight Quotes</h3><button onClick={() => setShowFreightModal(false)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button></div>
                        <div className="p-4 border-b border-slate-100 bg-white"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} /><input className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Search by Agent, Port Code, City or Zip..." value={freightSearchTerm} onChange={(e) => setFreightSearchTerm(e.target.value)} autoFocus /></div></div>
                        <div className="flex-1 overflow-y-auto p-0 custom-scrollbar">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase sticky top-0 z-10"><tr><th className="px-4 py-3">Agent</th><th className="px-4 py-3">Pick Up</th><th className="px-4 py-3">Route</th><th className="px-4 py-3">Delivery</th><th className="px-4 py-3 text-right">Rate</th><th className="px-4 py-3 text-right">Validity</th><th className="px-4 py-3 text-right">Action</th></tr></thead>
                                <tbody className="divide-y divide-slate-100 text-sm">{freightQuotes?.filter(q => { const term = freightSearchTerm.toLowerCase(); return !term || q.agentName.toLowerCase().includes(term) || q.originPortCode?.toLowerCase().includes(term) || q.destinationPortCode?.toLowerCase().includes(term) || q.carrier.toLowerCase().includes(term); }).map(quote => (
                                    <tr key={quote.id} className="hover:bg-slate-50 transition-colors"><td className="px-4 py-3 font-medium text-slate-700">{quote.agentName}<div className="text-[10px] text-slate-400 font-normal">{quote.carrier}</div></td><td className="px-4 py-3 text-slate-600 text-xs max-w-[150px] truncate" title={quote.pickupLocation || 'Port'}>{quote.pickupLocation ? (<span className="flex items-center gap-1"><MapPin size={10} className="text-amber-500" /> {quote.pickupLocation}</span>) : <span className="text-slate-300">-</span>}</td><td className="px-4 py-3 font-mono text-slate-600 text-xs whitespace-nowrap">{quote.originPortCode || 'POA'} <ArrowRight size={10} className="inline mx-1 text-slate-300" /> {quote.destinationPortCode || 'POD'}</td><td className="px-4 py-3 text-slate-600 text-xs max-w-[150px] truncate" title={quote.deliveryLocation || 'Port'}>{quote.deliveryLocation ? (<span className="flex items-center gap-1"><MapPin size={10} className="text-emerald-500" /> {quote.deliveryLocation}</span>) : <span className="text-slate-300">-</span>}</td><td className="px-4 py-3 text-right font-bold text-emerald-600">${quote.rate.toLocaleString()}</td><td className="px-4 py-3 text-right text-xs text-slate-500">{quote.validUntil}</td><td className="px-4 py-3 text-right"><button onClick={() => handleLoadFreightQuote(quote.id, true)} className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 transition-colors">Select</button></td></tr>
                                ))}</tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* Quick Add Port */}
            {showQuickAddPort && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl max-sm w-full overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50"><h3 className="font-bold text-slate-800 flex items-center gap-2"><Anchor size={20} /> Quick Add Port</h3><button onClick={() => setShowQuickAddPort(false)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button></div>
                        <div className="p-6 space-y-4">
                            <div><input className="w-full border border-slate-600 bg-slate-900 text-white rounded p-2 text-sm uppercase font-mono mb-2" placeholder="Code (3-5 Letters)" maxLength={5} value={newPortCode} onChange={e => setNewPortCode(e.target.value.toUpperCase())} autoFocus /></div>
                            <div><input className="w-full border border-slate-600 bg-slate-900 text-white rounded p-2 text-sm mb-2" placeholder="Port Name" value={newPortName} onChange={e => setNewPortName(e.target.value)} /></div>
                            <div><input className="w-full border border-slate-600 bg-slate-900 text-white rounded p-2 text-sm" placeholder="Country" value={newPortCountry} onChange={e => setNewPortCountry(e.target.value)} /></div>
                            <button onClick={handleQuickAddPort} disabled={!newPortCode || !newPortName} className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">Add & Select Port</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Quick Add Product */}
            {showQuickAddModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50"><h3 className="font-bold text-slate-800 flex items-center gap-2"><Package size={20} /> Quick Add Product</h3><button onClick={() => setShowQuickAddModal(false)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button></div>
                        <div className="p-6 space-y-4">
                            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Product Name</label><input className="w-full border border-slate-300 rounded-lg p-2 text-sm" placeholder="e.g. PP Homopolymer" value={newProdName} onChange={e => setNewProdName(e.target.value)} autoFocus /></div>
                            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Supplier</label><input className="w-full border border-slate-300 rounded-lg p-2 text-sm" placeholder="e.g. Sabic" value={newProdSupplier} onChange={e => setNewProdSupplier(e.target.value)} /></div>
                            <div className="mb-4"><PriceInput label="Base Price" value={newProdPrice} onChange={setNewProdPrice} /></div>
                            <div className="flex justify-end gap-2"><button onClick={handleQuickAddSubmit} disabled={!newProdName || !newProdSupplier} className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">Add & Select</button></div>
                        </div>
                    </div>
                </div>
            )}

            {/* Quick Add Location */}
            {showQuickAddLocation && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white p-6 rounded-lg shadow-xl border border-slate-200 w-80 space-y-3">
                        <h4 className="font-bold text-lg flex items-center gap-2"><MapPin size={20} /> New Location</h4>
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
        </div>
    );
};

export default BigCalculator;