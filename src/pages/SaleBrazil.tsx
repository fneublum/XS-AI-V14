import React, { useState, useEffect, useMemo } from 'react';
import { Calculator, DollarSign, RefreshCw, FileText, TrendingUp, CheckCircle, AlertCircle, Info, Package, Plus, X, Loader2, Search, Save, FolderOpen, FilePlus, Trash2 } from 'lucide-react';
import { FormattedInput } from '../components/UnitInputs';
import { Product, Port, BrazilSimulation } from '../types';
import { NCM_TAX_DATABASE, getNCMTaxRates, getChapterDescription, searchNCM } from './ncmTaxDatabase';

// Tax Configuration
const TAX_CONFIG = {
    "federal_defaults": {
        "pis_import_rate": 0.021,
        "cofins_import_rate": 0.0965,
        "cofins_additional_1pct": 0.01,
        "afrmm_rate": 0.25
    },
    "states": {
        "AC": { "icms": 0.17, "fcp": 0.02 },
        "AL": { "icms": 0.19, "fcp": 0.01 },
        "AP": { "icms": 0.18, "fcp": 0.00 },
        "AM": { "icms": 0.18, "fcp": 0.02 },
        "BA": { "icms": 0.19, "fcp": 0.015 },
        "CE": { "icms": 0.18, "fcp": 0.02 },
        "DF": { "icms": 0.18, "fcp": 0.02 },
        "ES": { "icms": 0.17, "fcp": 0.00 },
        "GO": { "icms": 0.17, "fcp": 0.02 },
        "MA": { "icms": 0.21, "fcp": 0.02 },
        "MT": { "icms": 0.17, "fcp": 0.00 },
        "MS": { "icms": 0.17, "fcp": 0.00 },
        "MG": { "icms": 0.18, "fcp": 0.00 },
        "PA": { "icms": 0.17, "fcp": 0.02 },
        "PB": { "icms": 0.18, "fcp": 0.02 },
        "PR": { "icms": 0.18, "fcp": 0.015 },
        "PE": { "icms": 0.18, "fcp": 0.025 },
        "PI": { "icms": 0.20, "fcp": 0.025 },
        "RJ": { "icms": 0.20, "fcp": 0.02 },
        "RN": { "icms": 0.18, "fcp": 0.02 },
        "RS": { "icms": 0.17, "fcp": 0.00 },
        "RO": { "icms": 0.175, "fcp": 0.02 },
        "RR": { "icms": 0.18, "fcp": 0.02 },
        "SC": { "icms": 0.17, "fcp": 0.00 },
        "SP": { "icms": 0.18, "fcp": 0.00 },
        "SE": { "icms": 0.19, "fcp": 0.01 },
        "TO": { "icms": 0.18, "fcp": 0.02 }
    },
    "state_programs": {
        "SC_TTD": {
            "state": "SC",
            "type": "ICMS_DEFERMENT_WITH_ANTICIPATION",
            "effective_icms_rate": 0.026,
            "description": "Santa Catarina TTD",
            "requires_local_registration": true
        },
        "PE_PEAP": {
            "state": "PE",
            "type": "REDUCED_ICMS_BASE",
            "effective_icms_rate": 0.014,
            "description": "Pernambuco PEAP",
            "requires_local_registration": true
        },
        "ES_FUNDAP": {
            "state": "ES",
            "type": "ICMS_FINANCING",
            "statutory_icms_rate": 0.17,
            "effective_cash_icms_rate": 0.05,
            "description": "Espírito Santo Fundap",
            "requires_local_registration": true,
            "output_mode": "DUAL"
        },
        "ZFM_MANAUS": {
            "state": "AM",
            "type": "FULL_SUSPENSION",
            "suspend_taxes": ["II", "IPI", "PIS", "COFINS", "ICMS", "AFRMM", "ANTIDUMPING", "CVD", "SAFEGUARD"],
            "description": "Manaus Free Trade Zone"
        },
        "DRAWBACK_ZPE": {
            "type": "FULL_SUSPENSION",
            "suspend_taxes": ["II", "IPI", "PIS", "COFINS", "ICMS", "AFRMM", "ANTIDUMPING", "CVD", "SAFEGUARD"],
            "description": "Drawback or ZPE"
        }
    }
};

interface TaxConfig {
    federal_defaults: {
        pis_import_rate: number;
        cofins_import_rate: number;
        cofins_additional_1pct: number;
        afrmm_rate: number;
    };
    states: Record<string, { icms: number; fcp: number }>;
    state_programs: Record<string, any>;
}

interface CalculationInput {
    productDescription: string;
    ncm: string;
    portName: string;
    clearanceState: string;
    incoterm: 'CFR' | 'CIF';
    priceUsdPerTon: number;
    quantityKg: number;
    exchangeRate: number;
    insuranceUsd: number;
    oceanFreightBrl: number;
    thcCapatazia: number;
    storageWarehousing: number;
    terminalFees: number;
    customsBrokerFee: number;
    siscomexFee: number;
    inlandFreight: number;
    includeInlandInIcms: boolean;
    iiRate: number;
    ipiRate: number;
    pisRate: number;
    cofinsRate: number;
    applyAdditional1PctCofins: boolean;
    antidumpingValue: number;
    antidumpingType: 'PERCENTAGE_CIF' | 'FIXED_BRL';
    cvdValue: number;
    cvdType: 'PERCENTAGE_CIF' | 'FIXED_BRL';
    safeguardValue: number;
    safeguardType: 'PERCENTAGE_CIF' | 'FIXED_BRL';
    selectedProgram: string;
}

interface CalculationResult {
    quantityTons: number;
    cfrTotalUsd: number;
    cifTotalUsd: number;
    cifTotalBrl: number;
    insuranceTotalUsd: number;
    afrmm: number;
    ii: number;
    ipi: number;
    pis: number;
    cofins: number;
    icms: number;
    effectiveIcmsRate: number;
    icmsEffective: number;
    tradeRemediesTotal: number;
    logisticsTotal: number;
    pisCofinsBase: number;
    icmsBase: number;
    statutoryTotalBrl: number;
    effectiveCashTotalBrl: number;
    costPerKg: number;
    costPerTon: number;
    breakdown: { label: string; value: number; type: 'TAX' | 'FEE' | 'COST' }[];
    notes: string[];
}

interface SaleBrazilProps {
    products?: Product[];
    onAddProduct?: (product: any) => Promise<any>;
    currentCompanyId?: string;
    ports?: Port[];
    savedSimulations?: BrazilSimulation[];
    onSaveSimulation?: (sim: any) => Promise<any>;
    onDeleteSimulation?: (id: string) => Promise<any>;
}

const DEFAULT_INPUT: CalculationInput = {
    productDescription: 'Plastic Resin',
    ncm: '3901.10.10',
    portName: 'Santos',
    clearanceState: 'SP',
    incoterm: 'CIF',
    priceUsdPerTon: 1500,
    quantityKg: 20000,
    exchangeRate: 5.50,
    insuranceUsd: 50,
    oceanFreightBrl: 5000,
    thcCapatazia: 1200,
    storageWarehousing: 800,
    terminalFees: 400,
    customsBrokerFee: 1500,
    siscomexFee: 214.50,
    inlandFreight: 2000,
    includeInlandInIcms: true,
    iiRate: 14.0,
    ipiRate: 0.0,
    pisRate: 2.1,
    cofinsRate: 9.65,
    applyAdditional1PctCofins: true,
    antidumpingValue: 0,
    antidumpingType: 'PERCENTAGE_CIF',
    cvdValue: 0,
    cvdType: 'PERCENTAGE_CIF',
    safeguardValue: 0,
    safeguardType: 'PERCENTAGE_CIF',
    selectedProgram: 'NONE'
};

const SaleBrazil: React.FC<SaleBrazilProps> = ({ products = [], onAddProduct, currentCompanyId, ports = [], savedSimulations = [], onSaveSimulation, onDeleteSimulation }) => {
    // --- State ---
    const [isAddProductOpen, setIsAddProductOpen] = useState(false);
    const [newProduct, setNewProduct] = useState({ name: '', ncm: '' });
    const [ncmSuggestions, setNcmSuggestions] = useState<string[]>([]);
    const [showNcmDropdown, setShowNcmDropdown] = useState(false);
    const [taxSource, setTaxSource] = useState<'database' | 'defaults' | 'manual'>('defaults');

    // Header Buttons State
    const [showSaveModal, setShowSaveModal] = useState(false);
    const [showLoadModal, setShowLoadModal] = useState(false);
    const [simulationName, setSimulationName] = useState('');

    const handleNew = () => {
        if (confirm('Start a new simulation? Unsaved progress will be lost.')) {
            setInput(DEFAULT_INPUT);
            setTaxSource('defaults');
        }
    };

    const handleSave = async () => {
        if (!onSaveSimulation || !simulationName.trim()) return;
        try {
            await onSaveSimulation({
                name: simulationName,
                companyId: currentCompanyId,
                ...input,
                totalLandedCostBrl: result?.effectiveCashTotalBrl || 0,
                costPerKgBrl: result?.costPerKg || 0,
                effectiveIcmsRate: result?.effectiveIcmsRate || 0
            });
            setShowSaveModal(false);
            setSimulationName('');
            alert('Simulation saved successfully!');
        } catch (e) {
            console.error(e);
            alert('Error saving simulation');
        }
    };

    const handleLoad = (sim: BrazilSimulation) => {
        if (confirm(`Load simulation "${sim.name}"? Current data will be replaced.`)) {
            setInput(prev => ({
                ...prev,
                ...sim,
                incoterm: sim.incoterm as 'CIF' | 'CFR',
                antidumpingType: sim.antidumpingType as any,
                cvdType: sim.cvdType as any,
                safeguardType: sim.safeguardType as any
            }));
            setShowLoadModal(false);
        }
    };

    const handleSaveProduct = async () => {
        if (!newProduct.name || !onAddProduct) return;

        try {
            const res = await onAddProduct({
                name: newProduct.name,
                hsCode: newProduct.ncm,
                companyId: currentCompanyId,
                category: 'Resin',
                price: 0,
                grade: 'Standard',
                stockStatus: 'Available',
                specs: {}
            });

            if (res) {
                setInput(prev => ({
                    ...prev,
                    productDescription: res.name,
                    ncm: res.hsCode || prev.ncm
                }));
                setIsAddProductOpen(false);
                setNewProduct({ name: '', ncm: '' });
            }
        } catch (err) {
            console.error(err);
            alert('Failed to save product');
        }
    };

    const [input, setInput] = useState<CalculationInput>(DEFAULT_INPUT);

    const config = TAX_CONFIG as unknown as TaxConfig;

    // NCM Input Handler with Autocomplete
    const handleNcmInputChange = (value: string) => {
        handleChange('ncm', value);

        if (value.length >= 2) {
            const matches = searchNCM(value, 10);
            setNcmSuggestions(matches);
            setShowNcmDropdown(matches.length > 0);
        } else {
            setNcmSuggestions([]);
            setShowNcmDropdown(false);
        }
    };

    // Auto-populate tax rates based on NCM code from database
    useEffect(() => {
        const taxData = getNCMTaxRates(input.ncm);

        if (taxData) {
            setInput(prev => ({
                ...prev,
                iiRate: taxData.ii,
                ipiRate: taxData.ipi,
                pisRate: 2.1,
                cofinsRate: 9.65,
                applyAdditional1PctCofins: true
            }));
            setTaxSource('database');
        } else {
            // Fallback defaults based on chapter
            const chapter = input.ncm.substring(0, 2);
            if (chapter === '39') {
                setInput(prev => ({
                    ...prev,
                    iiRate: 14.0,
                    ipiRate: 3.25,
                    pisRate: 2.1,
                    cofinsRate: 9.65,
                    applyAdditional1PctCofins: true
                }));
                setTaxSource('defaults');
            } else if (chapter === '52') {
                setInput(prev => ({
                    ...prev,
                    iiRate: 18.0,
                    ipiRate: 0,
                    pisRate: 2.1,
                    cofinsRate: 9.65,
                    applyAdditional1PctCofins: true
                }));
                setTaxSource('defaults');
            } else if (chapter === '63') {
                setInput(prev => ({
                    ...prev,
                    iiRate: 35.0,
                    ipiRate: 0,
                    pisRate: 2.1,
                    cofinsRate: 9.65,
                    applyAdditional1PctCofins: true
                }));
                setTaxSource('defaults');
            } else {
                setTaxSource('manual');
            }
        }
    }, [input.ncm]);

    // --- Calculation Engine ---
    const result: CalculationResult | null = useMemo(() => {
        try {
            const notes: string[] = [];
            const quantityTons = input.quantityKg / 1000;
            const cfrTotalUsd = input.priceUsdPerTon * quantityTons;

            let cifTotalUsd = cfrTotalUsd;
            let insuranceActualUsd = 0;
            if (input.incoterm === 'CFR') {
                insuranceActualUsd = input.insuranceUsd;
                cifTotalUsd += insuranceActualUsd;
            }

            const cifTotalBrl = cifTotalUsd * input.exchangeRate;

            const program = config.state_programs[input.selectedProgram];
            const isSuspended = (tax: string) => {
                if (!program || !program.suspend_taxes) return false;
                return program.suspend_taxes.includes(tax);
            };

            let afrmm = 0;
            if (!isSuspended('AFRMM')) {
                afrmm = input.oceanFreightBrl * config.federal_defaults.afrmm_rate;
            }

            const calcRemedy = (val: number, type: string, name: string) => {
                if (isSuspended(name)) return 0;
                if (type === 'FIXED_BRL') return val;
                return (val / 100) * cifTotalBrl;
            };

            const ad = calcRemedy(input.antidumpingValue, input.antidumpingType, 'ANTIDUMPING');
            const cvd = calcRemedy(input.cvdValue, input.cvdType, 'CVD');
            const sg = calcRemedy(input.safeguardValue, input.safeguardType, 'SAFEGUARD');
            const tradeRemediesTotal = ad + cvd + sg;

            const ii = isSuspended('II') ? 0 : (cifTotalBrl * (input.iiRate / 100));
            const ipiBase = cifTotalBrl + ii;
            const ipi = isSuspended('IPI') ? 0 : (ipiBase * (input.ipiRate / 100));
            const pisCofinsBase = cifTotalBrl + ii + ipi;
            const pis = isSuspended('PIS') ? 0 : (pisCofinsBase * (input.pisRate / 100));

            let cofinsRateToUse = input.cofinsRate;
            if (input.applyAdditional1PctCofins) {
                cofinsRateToUse += (config.federal_defaults.cofins_additional_1pct * 100);
            }
            const cofins = isSuspended('COFINS') ? 0 : (pisCofinsBase * (cofinsRateToUse / 100));

            const logisticsAndFees = input.thcCapatazia +
                input.storageWarehousing +
                input.terminalFees +
                input.customsBrokerFee +
                input.siscomexFee +
                (input.includeInlandInIcms ? input.inlandFreight : 0);

            const icmsBasePre = cifTotalBrl + ii + ipi + pis + cofins + afrmm + tradeRemediesTotal + logisticsAndFees;

            let icmsRate = 0;
            const stateDef = config.states[input.clearanceState] || { icms: 0.17, fcp: 0.0 };

            if (program && program.effective_icms_rate !== undefined) {
                icmsRate = program.effective_icms_rate;
                notes.push(`Using Effective ICMS Rate: ${(icmsRate * 100).toFixed(2)}% (${program.description})`);
            } else if (program && program.statutory_icms_rate !== undefined) {
                icmsRate = program.statutory_icms_rate;
            } else if (isSuspended('ICMS')) {
                icmsRate = 0;
                notes.push("ICMS Suspended");
            } else {
                icmsRate = stateDef.icms + stateDef.fcp;
            }

            let icmsBase = 0;
            let icms = 0;

            if (icmsRate > 0 && icmsRate < 1) {
                icmsBase = icmsBasePre / (1 - icmsRate);
                icms = icmsBase * icmsRate;
            }

            const feesTotal = input.thcCapatazia + input.storageWarehousing + input.terminalFees + input.customsBrokerFee + input.siscomexFee + input.inlandFreight;
            const statutoryTotalBrl = cifTotalBrl + ii + ipi + pis + cofins + afrmm + tradeRemediesTotal + icms + feesTotal;

            let effectiveCashTotalBrl = statutoryTotalBrl;
            let icmsEffective = icms;

            if (input.selectedProgram === 'ES_FUNDAP') {
                const effRate = 0.05;
                const effBase = icmsBasePre / (1 - effRate);
                icmsEffective = effBase * effRate;
                effectiveCashTotalBrl = cifTotalBrl + ii + ipi + pis + cofins + afrmm + tradeRemediesTotal + icmsEffective + feesTotal;
                notes.push("FUNDAP: Effective cash cost calculated with 5% ICMS burden.");
            }

            // Add NCM database note
            const taxData = getNCMTaxRates(input.ncm);
            if (taxData) {
                notes.push(`NCM ${input.ncm}: ${taxData.description} (II: ${taxData.ii}%, IPI: ${taxData.ipiRaw || '0'}%)`);
            }

            return {
                quantityTons,
                cfrTotalUsd,
                cifTotalUsd,
                cifTotalBrl,
                insuranceTotalUsd: insuranceActualUsd,
                afrmm,
                ii,
                ipi,
                pis,
                cofins,
                icms,
                effectiveIcmsRate: icmsRate,
                icmsEffective,
                tradeRemediesTotal,
                logisticsTotal: feesTotal,
                pisCofinsBase,
                icmsBase,
                statutoryTotalBrl,
                effectiveCashTotalBrl,
                costPerKg: effectiveCashTotalBrl / input.quantityKg,
                costPerTon: effectiveCashTotalBrl / quantityTons,
                notes,
                breakdown: [
                    { label: 'CIF Value', value: cifTotalBrl, type: 'COST' },
                    { label: 'Import Duty (II)', value: ii, type: 'TAX' },
                    { label: 'IPI', value: ipi, type: 'TAX' },
                    { label: 'PIS', value: pis, type: 'TAX' },
                    { label: 'COFINS', value: cofins, type: 'TAX' },
                    { label: 'AFRMM', value: afrmm, type: 'TAX' },
                    { label: 'ICMS', value: icms, type: 'TAX' },
                    { label: 'Trade Remedies', value: tradeRemediesTotal, type: 'TAX' },
                    { label: 'Port & Logistics Fees', value: feesTotal - input.inlandFreight, type: 'FEE' },
                    { label: 'Inland Freight', value: input.inlandFreight, type: 'FEE' },
                ]
            };

        } catch (e) {
            console.error(e);
            return null;
        }
    }, [input]);

    const handleChange = (field: keyof CalculationInput, value: any) => {
        setInput(prev => ({ ...prev, [field]: value }));
    };

    const formatCurrency = (val: number) => val.toLocaleString('en-US', { style: 'currency', currency: 'BRL' });
    const formatUSD = (val: number) => val.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

    // Get current NCM info
    const currentNcmInfo = getNCMTaxRates(input.ncm);
    const chapterDesc = getChapterDescription(input.ncm);

    return (
        <div className="space-y-6 pb-20 p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
                        <TrendingUp className="text-emerald-500" size={24} />
                        Brazil Landed Cost Calculator
                    </h1>
                    <p className="text-slate-500 mt-1">Full "Nacionalização" Cost Analysis (HS Chapters 39, 52, 63)</p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={handleNew} className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors" title="New Simulation">
                        <FilePlus size={20} />
                    </button>
                    <button onClick={() => setShowLoadModal(true)} className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors" title="Open Saved">
                        <FolderOpen size={20} />
                    </button>
                    <button onClick={() => setShowSaveModal(true)} className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors" title="Save Simulation">
                        <Save size={20} />
                    </button>
                    <div className="w-px h-6 bg-slate-300 mx-2"></div>
                    <div className="bg-blue-50 text-blue-700 px-4 py-2 rounded-lg font-mono text-sm border border-blue-100 font-bold">
                        USD/BRL: {input.exchangeRate.toFixed(4)}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* LEFT COLUMN: INPUTS */}
                <div className="lg:col-span-1 space-y-6">

                    {/* General Section */}
                    <section className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                            <FileText size={16} /> General & Commercial
                        </h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">Product Description</label>
                                <div className="flex gap-2">
                                    <div className="relative flex-1">
                                        <select
                                            className="w-full border-2 border-slate-300 rounded-md text-sm p-2 appearance-none bg-white pr-8"
                                            value={products.find(p => p.name === input.productDescription)?.id || (input.productDescription ? 'custom' : '')}
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                if (val === 'ADD_NEW') {
                                                    setIsAddProductOpen(true);
                                                } else if (val === 'custom') {
                                                    // Do nothing
                                                } else {
                                                    const prod = products.find(p => p.id === val);
                                                    if (prod) {
                                                        setInput(prev => ({
                                                            ...prev,
                                                            productDescription: prod.name,
                                                            ncm: prod.hsCode || prev.ncm,
                                                            priceUsdPerTon: prod.price > 0 ? prod.price : prev.priceUsdPerTon
                                                        }));
                                                    }
                                                }
                                            }}
                                        >
                                            <option value="" disabled>Select a product...</option>
                                            {products.map(p => (
                                                <option key={p.id} value={p.id}>{p.name}</option>
                                            ))}
                                            {input.productDescription && !products.find(p => p.name === input.productDescription) && (
                                                <option value="custom">{input.productDescription} (Custom)</option>
                                            )}
                                            <option value="ADD_NEW" className="font-bold text-indigo-600 bg-indigo-50">+ Add New Product...</option>
                                        </select>
                                        <Package size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                    </div>
                                    <button
                                        onClick={() => setIsAddProductOpen(true)}
                                        className="bg-indigo-50 text-indigo-600 p-2 rounded-md hover:bg-indigo-100 border-2 border-indigo-100 transition-colors"
                                        title="Add New Product"
                                    >
                                        <Plus size={20} />
                                    </button>
                                </div>
                            </div>

                            {/* NCM Input with Autocomplete */}
                            <div className="relative">
                                <label className="block text-xs font-medium text-slate-500 mb-1">NCM (8 digits)</label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        className="w-full border-2 border-slate-300 rounded-md text-sm p-2 pr-8"
                                        value={input.ncm}
                                        onChange={e => handleNcmInputChange(e.target.value)}
                                        onFocus={() => input.ncm.length >= 2 && setShowNcmDropdown(ncmSuggestions.length > 0)}
                                        onBlur={() => setTimeout(() => setShowNcmDropdown(false), 200)}
                                        placeholder="e.g. 3901.10.10"
                                    />
                                    <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                </div>

                                {/* NCM Dropdown */}
                                {showNcmDropdown && ncmSuggestions.length > 0 && (
                                    <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-64 overflow-y-auto">
                                        {ncmSuggestions.map(ncm => {
                                            const taxData = NCM_TAX_DATABASE[ncm];
                                            return (
                                                <div
                                                    key={ncm}
                                                    className="px-3 py-2 hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-0"
                                                    onMouseDown={() => {
                                                        handleChange('ncm', ncm);
                                                        setShowNcmDropdown(false);
                                                    }}
                                                >
                                                    <div className="font-mono text-sm text-slate-800 font-medium">{ncm}</div>
                                                    <div className="text-xs text-slate-500 truncate">{taxData?.description}</div>
                                                    <div className="text-xs mt-1">
                                                        <span className="text-red-600 font-medium">II: {taxData?.ii}%</span>
                                                        <span className="mx-2 text-slate-300">|</span>
                                                        <span className="text-orange-600 font-medium">IPI: {taxData?.ipiRaw || '0'}%</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {/* Current NCM Info */}
                                {currentNcmInfo && (
                                    <div className="mt-2 p-2 bg-emerald-50 rounded-md border border-emerald-100">
                                        <div className="text-xs text-emerald-800 font-medium">{currentNcmInfo.description}</div>
                                        <div className="text-xs text-emerald-600 mt-1">
                                            Chapter {input.ncm.substring(0, 2)}: {chapterDesc}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">Clearance UF</label>
                                    <select className="w-full border-2 border-slate-300 rounded-md text-sm p-2"
                                        value={input.clearanceState} onChange={e => handleChange('clearanceState', e.target.value)}>
                                        {config.states && Object.keys(config.states).map(uf => <option key={uf} value={uf}>{uf}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">Port Name</label>
                                    <select
                                        className="w-full border-2 border-slate-300 rounded-md text-sm p-2"
                                        value={input.portName}
                                        onChange={e => handleChange('portName', e.target.value)}
                                    >
                                        <option value="" disabled>Select a port...</option>
                                        {ports.map(port => (
                                            <option key={port.id} value={port.name}>{port.name}</option>
                                        ))}
                                        {!ports.find(p => p.name === input.portName) && input.portName && (
                                            <option value={input.portName}>{input.portName} (Custom/Legacy)</option>
                                        )}
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">Incoterm</label>
                                    <select className="w-full border-2 border-slate-300 rounded-md text-sm p-2"
                                        value={input.incoterm} onChange={e => handleChange('incoterm', e.target.value as any)}>
                                        <option value="CIF">CIF</option>
                                        <option value="CFR">CFR</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">Incentive Program</label>
                                    <select className="w-full border-2 border-slate-300 rounded-md text-sm p-2 font-semibold text-emerald-700 bg-emerald-50"
                                        value={input.selectedProgram} onChange={e => handleChange('selectedProgram', e.target.value)}>
                                        <option value="NONE">None (Standard)</option>
                                        <option value="SC_TTD">Santa Catarina TTD</option>
                                        <option value="PE_PEAP">Pernambuco PEAP</option>
                                        <option value="ES_FUNDAP">Espírito Santo FUNDAP</option>
                                        <option value="ZFM_MANAUS">Manaus ZFM (Suspension)</option>
                                        <option value="DRAWBACK_ZPE">Drawback / ZPE</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Values Section */}
                    <section className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                            <DollarSign size={16} /> Values (USD)
                        </h2>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">Price/Ton (USD)</label>
                                    <FormattedInput className="w-full border-2 border-slate-300 rounded-md text-sm p-2"
                                        value={input.priceUsdPerTon} onChange={val => handleChange('priceUsdPerTon', val)} decimals={2} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">Quantity (Kg)</label>
                                    <FormattedInput className="w-full border-2 border-slate-300 rounded-md text-sm p-2"
                                        value={input.quantityKg} onChange={val => handleChange('quantityKg', val)} decimals={0} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">Exchange (BRL)</label>
                                    <FormattedInput className="w-full border-2 border-slate-300 rounded-md text-sm p-2"
                                        value={input.exchangeRate} onChange={val => handleChange('exchangeRate', val)} decimals={4} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">Insurance (USD)</label>
                                    <FormattedInput className="w-full border-2 border-slate-300 rounded-md text-sm p-2"
                                        value={input.insuranceUsd} onChange={val => handleChange('insuranceUsd', val)}
                                        disabled={input.incoterm === 'CIF'} decimals={2} />
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Tax Rates */}
                    <section className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                            <TrendingUp size={16} /> Tax Rates (%)
                        </h2>

                        {/* Tax Source Indicator */}
                        {taxSource === 'database' && (
                            <div className="flex items-center gap-2 text-xs text-emerald-600 mb-3 bg-emerald-50 p-2 rounded-md">
                                <CheckCircle size={14} />
                                <span>Rates loaded from NCM database</span>
                            </div>
                        )}
                        {taxSource === 'defaults' && input.ncm.length >= 4 && (
                            <div className="flex items-center gap-2 text-xs text-amber-600 mb-3 bg-amber-50 p-2 rounded-md">
                                <AlertCircle size={14} />
                                <span>NCM not found - using chapter defaults</span>
                            </div>
                        )}

                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">II (Import)</label>
                                <FormattedInput className="w-full border-2 border-slate-300 rounded-md text-sm p-2"
                                    value={input.iiRate} onChange={val => { handleChange('iiRate', val); setTaxSource('manual'); }} decimals={2} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">IPI</label>
                                <FormattedInput className="w-full border-2 border-slate-300 rounded-md text-sm p-2"
                                    value={input.ipiRate} onChange={val => { handleChange('ipiRate', val); setTaxSource('manual'); }} decimals={2} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">PIS</label>
                                <FormattedInput className="w-full border-2 border-slate-300 rounded-md text-sm p-2"
                                    value={input.pisRate} onChange={val => handleChange('pisRate', val)} decimals={2} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">COFINS</label>
                                <FormattedInput className="w-full border-2 border-slate-300 rounded-md text-sm p-2"
                                    value={input.cofinsRate} onChange={val => handleChange('cofinsRate', val)} decimals={2} />
                            </div>
                            <div className="col-span-2 flex items-center pt-5">
                                <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                                    <input type="checkbox" checked={input.applyAdditional1PctCofins}
                                        onChange={e => handleChange('applyAdditional1PctCofins', e.target.checked)} />
                                    <span>+1% COFINS-Import</span>
                                </label>
                            </div>
                        </div>
                    </section>
                </div>

                {/* MIDDLE COLUMN: LOGISTICS */}
                <div className="lg:col-span-1 space-y-6">
                    <section className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                            <CheckCircle size={16} /> Logistics & Fees (BRL)
                        </h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">Ocean Freight (for AFRMM)</label>
                                <FormattedInput className="w-full border-2 border-slate-300 rounded-md text-sm p-2"
                                    value={input.oceanFreightBrl} onChange={val => handleChange('oceanFreightBrl', val)} decimals={2} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">THC / Capatazia</label>
                                <FormattedInput className="w-full border-2 border-slate-300 rounded-md text-sm p-2"
                                    value={input.thcCapatazia} onChange={val => handleChange('thcCapatazia', val)} decimals={2} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">Storage / Warehousing</label>
                                <FormattedInput className="w-full border-2 border-slate-300 rounded-md text-sm p-2"
                                    value={input.storageWarehousing} onChange={val => handleChange('storageWarehousing', val)} decimals={2} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">Terminal Service Fees</label>
                                <FormattedInput className="w-full border-2 border-slate-300 rounded-md text-sm p-2"
                                    value={input.terminalFees} onChange={val => handleChange('terminalFees', val)} decimals={2} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">Customs Broker Fee</label>
                                <FormattedInput className="w-full border-2 border-slate-300 rounded-md text-sm p-2"
                                    value={input.customsBrokerFee} onChange={val => handleChange('customsBrokerFee', val)} decimals={2} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">SISCOMEX Fee</label>
                                <FormattedInput className="w-full border-2 border-slate-300 rounded-md text-sm p-2"
                                    value={input.siscomexFee} onChange={val => handleChange('siscomexFee', val)} decimals={2} />
                            </div>
                            <div className="pt-4 border-t border-slate-100">
                                <label className="block text-xs font-medium text-slate-500 mb-1">Inland Freight to Factory</label>
                                <FormattedInput className="w-full border-2 border-slate-300 rounded-md text-sm p-2"
                                    value={input.inlandFreight} onChange={val => handleChange('inlandFreight', val)} decimals={2} />
                                <div className="mt-2">
                                    <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                                        <input type="checkbox" checked={input.includeInlandInIcms}
                                            onChange={e => handleChange('includeInlandInIcms', e.target.checked)} />
                                        <span>Include Inland in ICMS Base</span>
                                    </label>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                            <AlertCircle size={16} /> Trade Remedies
                        </h2>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">Antidumping (%)</label>
                                    <div className="flex">
                                        <FormattedInput className="w-full border-2 border-slate-300 rounded-l-md text-sm p-2"
                                            value={input.antidumpingValue} onChange={val => handleChange('antidumpingValue', val)} decimals={2} />
                                        <span className="bg-slate-100 border border-l-0 border-slate-300 rounded-r-md px-2 flex items-center text-xs text-slate-500">%</span>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">CVD (%)</label>
                                    <div className="flex">
                                        <FormattedInput className="w-full border-2 border-slate-300 rounded-l-md text-sm p-2"
                                            value={input.cvdValue} onChange={val => handleChange('cvdValue', val)} decimals={2} />
                                        <span className="bg-slate-100 border border-l-0 border-slate-300 rounded-r-md px-2 flex items-center text-xs text-slate-500">%</span>
                                    </div>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">Safeguard (%)</label>
                                <div className="flex">
                                    <FormattedInput className="w-full border-2 border-slate-300 rounded-l-md text-sm p-2"
                                        value={input.safeguardValue} onChange={val => handleChange('safeguardValue', val)} decimals={2} />
                                    <span className="bg-slate-100 border border-l-0 border-slate-300 rounded-r-md px-2 flex items-center text-xs text-slate-500">%</span>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>

                {/* RIGHT COLUMN: RESULTS */}
                <div className="lg:col-span-1">
                    {result ? (
                        <div className="bg-slate-900 text-white p-6 rounded-xl shadow-2xl sticky top-24">
                            <div className="mb-6 pb-6 border-b border-slate-700">
                                <p className="text-slate-400 text-sm uppercase tracking-wider font-bold mb-2">Total Landed Cost</p>
                                <div className="text-4xl font-bold text-emerald-400">
                                    {formatCurrency(result.effectiveCashTotalBrl)}
                                </div>
                                {result.statutoryTotalBrl !== result.effectiveCashTotalBrl && (
                                    <div className="text-sm text-slate-400 mt-1">
                                        Statutory: {formatCurrency(result.statutoryTotalBrl)}
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-6 mb-6">
                                <div>
                                    <p className="text-slate-500 text-xs uppercase mb-1">Cost per Kg</p>
                                    <p className="text-xl font-mono">{formatCurrency(result.costPerKg)}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500 text-xs uppercase mb-1">Cost per Ton</p>
                                    <p className="text-xl font-mono">{formatCurrency(result.costPerTon)}</p>
                                </div>
                            </div>

                            <div className="space-y-3 text-sm">
                                <div className="flex justify-between items-center py-2 border-b border-slate-800">
                                    <span className="text-slate-400">CIF (BRL)</span>
                                    <span>{formatCurrency(result.cifTotalBrl)}</span>
                                </div>
                                {result.breakdown.filter(i => i.type === 'TAX').map((item, idx) => (
                                    <div key={idx} className="flex justify-between items-center py-1">
                                        <span className="text-slate-400">{item.label}</span>
                                        <span className="text-red-300 font-mono">+ {formatCurrency(item.value)}</span>
                                    </div>
                                ))}
                                <div className="border-t border-slate-800 my-2"></div>
                                {result.breakdown.filter(i => i.type === 'FEE').map((item, idx) => (
                                    <div key={idx} className="flex justify-between items-center py-1">
                                        <span className="text-slate-400">{item.label}</span>
                                        <span className="text-orange-300 font-mono">+ {formatCurrency(item.value)}</span>
                                    </div>
                                ))}
                            </div>

                            <div className="mt-6 bg-slate-800 p-4 rounded-lg">
                                <p className="text-xs font-bold text-slate-500 uppercase mb-2">Configuration Used</p>
                                <div className="text-xs space-y-1 text-slate-300">
                                    <p>NCM: {input.ncm}</p>
                                    <p>State: {input.clearanceState}</p>
                                    <p>Program: {input.selectedProgram}</p>
                                    <p>ICMS Rate: {(result.effectiveIcmsRate * 100).toFixed(2)}%</p>
                                    <p>Exchange: {input.exchangeRate}</p>
                                </div>
                                {result.notes.length > 0 && (
                                    <div className="mt-3 pt-3 border-t border-slate-700">
                                        {result.notes.map((note, idx) => (
                                            <p key={idx} className="text-[10px] text-yellow-500 flex items-start gap-1 mb-1">
                                                <Info size={12} className="shrink-0 mt-0.5" /> {note}
                                            </p>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="bg-slate-100 p-8 rounded-xl text-center text-slate-400">
                            Calculation Error
                        </div>
                    )}
                </div>
            </div>

            {/* AUDIT TABLE */}
            {result && (
                <div className="mt-8 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
                        <FileText size={16} className="text-slate-500" />
                        <h3 className="font-bold text-slate-700">Detailed Audit Report</h3>
                    </div>
                    <div className="p-6 overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-500 uppercase bg-slate-50">
                                <tr>
                                    <th className="px-4 py-3">Component</th>
                                    <th className="px-4 py-3 text-right">Base Calculation</th>
                                    <th className="px-4 py-3 text-right">Rate</th>
                                    <th className="px-4 py-3 text-right">Value (BRL)</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                <tr>
                                    <td className="px-4 py-3 font-medium">CIF Value</td>
                                    <td className="px-4 py-3 text-right">-</td>
                                    <td className="px-4 py-3 text-right">-</td>
                                    <td className="px-4 py-3 text-right font-bold">{formatCurrency(result.cifTotalBrl)}</td>
                                </tr>
                                <tr>
                                    <td className="px-4 py-3">Import Duty (II)</td>
                                    <td className="px-4 py-3 text-right">{formatCurrency(result.cifTotalBrl)}</td>
                                    <td className="px-4 py-3 text-right">{input.iiRate}%</td>
                                    <td className="px-4 py-3 text-right">{formatCurrency(result.ii)}</td>
                                </tr>
                                <tr>
                                    <td className="px-4 py-3">IPI</td>
                                    <td className="px-4 py-3 text-right">{formatCurrency(result.cifTotalBrl + result.ii)}</td>
                                    <td className="px-4 py-3 text-right">{input.ipiRate}%</td>
                                    <td className="px-4 py-3 text-right">{formatCurrency(result.ipi)}</td>
                                </tr>
                                <tr>
                                    <td className="px-4 py-3">PIS / COFINS</td>
                                    <td className="px-4 py-3 text-right">{formatCurrency(result.pisCofinsBase)}</td>
                                    <td className="px-4 py-3 text-right">{(input.pisRate + input.cofinsRate + (input.applyAdditional1PctCofins ? 1 : 0)).toFixed(2)}%</td>
                                    <td className="px-4 py-3 text-right">{formatCurrency(result.pis + result.cofins)}</td>
                                </tr>
                                <tr>
                                    <td className="px-4 py-3">ICMS (Por Dentro)</td>
                                    <td className="px-4 py-3 text-right">{formatCurrency(result.icmsBase)}</td>
                                    <td className="px-4 py-3 text-right">{(result.effectiveIcmsRate * 100).toFixed(2)}%</td>
                                    <td className="px-4 py-3 text-right font-bold">{formatCurrency(result.icms)}</td>
                                </tr>
                                {input.selectedProgram === 'ES_FUNDAP' && (
                                    <tr className="bg-emerald-50">
                                        <td className="px-4 py-3 font-medium text-emerald-800">ICMS (Effective Cash)</td>
                                        <td className="px-4 py-3 text-right text-emerald-600">-</td>
                                        <td className="px-4 py-3 text-right text-emerald-600">{(config.state_programs.ES_FUNDAP.effective_cash_icms_rate * 100).toFixed(2)}%</td>
                                        <td className="px-4 py-3 text-right font-bold text-emerald-700">{formatCurrency(result.icmsEffective)}</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}


            {/* Add Product Modal */}
            {isAddProductOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm animate-in zoom-in-95 overflow-hidden">
                        <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                <Package size={18} className="text-indigo-600" />
                                Add New Product
                            </h3>
                            <button onClick={() => setIsAddProductOpen(false)} className="text-slate-400 hover:text-slate-600">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Product Name</label>
                                <input
                                    autoFocus
                                    type="text"
                                    className="w-full border-2 border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all"
                                    value={newProduct.name}
                                    onChange={e => setNewProduct(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="e.g. PP Homo Rafia"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">NCM / HS Code</label>
                                <input
                                    type="text"
                                    className="w-full border-2 border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all"
                                    value={newProduct.ncm}
                                    onChange={e => setNewProduct(prev => ({ ...prev, ncm: e.target.value }))}
                                    placeholder="e.g. 3902.10.20"
                                />
                            </div>
                        </div>
                        <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
                            <button
                                onClick={() => setIsAddProductOpen(false)}
                                className="px-4 py-2 text-sm font-bold text-slate-600 hover:text-slate-800"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveProduct}
                                disabled={!newProduct.name}
                                className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-indigo-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Save Product
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Save Modal */}
            {showSaveModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
                    <div className="bg-white rounded-xl shadow-xl p-6 w-[400px]">
                        <h2 className="text-lg font-bold text-slate-800 mb-4">Save Simulation</h2>
                        <input
                            type="text"
                            className="w-full border-2 border-slate-300 rounded-md p-2 mb-4"
                            placeholder="Simulation Name..."
                            value={simulationName}
                            onChange={e => setSimulationName(e.target.value)}
                            autoFocus
                        />
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setShowSaveModal(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-md">Cancel</button>
                            <button onClick={handleSave} disabled={!simulationName.trim()} className="px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50">Save</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Load Modal */}
            {showLoadModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
                    <div className="bg-white rounded-xl shadow-xl p-6 w-[600px] max-h-[80vh] flex flex-col">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-lg font-bold text-slate-800">Load Simulation</h2>
                            <button onClick={() => setShowLoadModal(false)}><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2">
                            {(savedSimulations && savedSimulations.length > 0) ? (
                                savedSimulations.map(sim => (
                                    <div key={sim.id} className="flex items-center justify-between p-3 border border-slate-200 rounded-lg hover:bg-slate-50 group">
                                        <div className="cursor-pointer flex-1" onClick={() => handleLoad(sim)}>
                                            <div className="font-medium text-slate-800">{sim.name}</div>
                                            <div className="text-xs text-slate-500">
                                                {new Date(sim.createdAt).toLocaleDateString()} • {sim.productDescription} • {sim.quantityKg.toLocaleString()} kg
                                            </div>
                                            <div className="text-xs font-mono text-emerald-600 font-bold mt-1">
                                                R$ {sim.totalLandedCostBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                            </div>
                                        </div>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); if (confirm('Delete?')) onDeleteSimulation?.(sim.id); }}
                                            className="p-2 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))
                            ) : (
                                <p className="text-slate-500 text-center py-8">No saved simulations found.</p>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Simple Icon component for the modal button
const SaveIcon = ({ size }: { size: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
        <polyline points="17 21 17 13 7 13 7 21"></polyline>
        <polyline points="7 3 7 8 15 8"></polyline>
    </svg>
);

export default SaleBrazil;
