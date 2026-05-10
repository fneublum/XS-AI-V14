import React, { useState, useMemo, useRef } from 'react';
import {
    Sparkles, ChevronRight, ChevronLeft, Check, Search, ArrowUpDown,
    Zap, Save, FileText, TrendingUp, Package, DollarSign, Loader2,
    CheckCircle2, CircleDot, Circle, AlertTriangle, RefreshCw, Eye, Calculator, X, Pencil,
    Plus, Upload, FilePlus, Trash2, Anchor, MapPin, ShoppingBag, Users,
    Globe, Truck, Calendar, CreditCard, Building, Ship, Send, Filter, ChevronDown, FileQuestion
} from 'lucide-react';
import { SupplierOffer, SupplierQuoteItem, CostCalculation, FreightQuote, Product, Port, Supplier, User, Company, SalesOrder, SalesOrderItem, Customer, Bank, CargoAgent } from '../types';
import { getCostProfitAnalysis, getCostProfitSummary, getCostProfitOfferRanking, analyzeDocument, CostBreakdownEstimate, MarginRecommendation } from '../services/geminiService';
import { PAYMENT_TERM_OPTIONS } from '../constants';
import { QuantityInput, PriceInput } from '../components/UnitInputs';

const ProposalEngine = React.lazy(() => import('./ProposalEngine'));

interface CostProfitAIProps {
    initialStep?: 0 | 1 | 2 | 3 | 4 | 5;
    supplierOffers: SupplierOffer[];
    costCalculations: CostCalculation[];
    freightQuotes: FreightQuote[];
    products: Product[];
    ports: Port[];
    suppliers: Supplier[];
    onSaveCalculation: (c: Omit<CostCalculation, 'id'> | CostCalculation) => Promise<CostCalculation | null>;
    onUpdateCalculation?: (id: string, updates: Partial<CostCalculation>) => Promise<CostCalculation | null>;
    onDeleteCalculation?: (id: string) => Promise<boolean>;
    onNavigate?: (module: string, subModule: string, editId?: string) => void;
    currentCompanyId: string;
    currentUser: User | null;
    onAddOffer?: (o: SupplierOffer) => Promise<SupplierOffer | null>;
    onDeleteOffer?: (id: string) => Promise<boolean>;
    onAddSupplier?: (s: Supplier) => Promise<Supplier | null>;
    onAddProduct?: (p: Product) => Promise<Product | null>;
    onAddPort?: (p: Port) => Promise<Port | null>;
    availableCompanies?: Company[];
    customers?: Customer[];
    onSaveSalesOrder?: (o: SalesOrder) => Promise<SalesOrder | null>;
    onDeleteSalesOrder?: (id: string) => Promise<boolean>;
    onUpdateSalesOrder?: (id: string, updates: Partial<SalesOrder>) => Promise<SalesOrder | null>;
    banks?: Bank[];
    salesOrders?: SalesOrder[];
    cargoAgents?: CargoAgent[];
}

// Per-item calculation state
interface ItemCalculation {
    offerId: string;
    offerNumber: string;
    supplierName: string;
    productName: string;
    systemProductName?: string;
    quantity: number;
    unitPrice: number;
    currency: string;
    incoterm: string;
    originPort: string;
    destinationPort: string;
    loadingLocation: string;
    // Cost breakdown
    containerCount: number;
    pickupCost: number;
    oceanFreight: number;
    deliveryCost: number;
    insuranceCost: number;
    dutyPercent: number;
    clearanceCost: number;
    // Sources
    sources: Record<string, 'db' | 'ai' | 'manual'>;
    // Calculated
    totalBase: number;
    totalLogistics: number;
    totalImportFees: number;
    totalLandedCost: number;
    unitLandedCost: number;
    // AI insight
    aiInsight: string;
    freightAgentName?: string;
    // Step 3
    marginPercent: number;
    salePrice: number;
    profitPerUnit: number;
    marginReasoning: string;
}

const SourceBadge: React.FC<{ source: 'db' | 'ai' | 'manual' }> = ({ source }) => {
    if (source === 'db') return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-700 rounded">DB</span>;
    if (source === 'ai') return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold bg-blue-100 text-blue-700 rounded">AI</span>;
    return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-500 rounded">Manual</span>;
};

const fmt = (n: number, decimals = 2) => n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const fmtCurrency = (n: number) => '$' + fmt(n);

// Extract first name from supplier (e.g. "BISNERO TRADING" → "BISNERO")
const firstName = (name: string) => (name || '').split(/\s+/)[0];

// Convert lbs to kgs (1 lb = 0.453592 kg)
const lbsToKgs = (lbs: number) => lbs * 0.453592;

// Price per lb to price per kg (price_per_kg = price_per_lb / 0.453592)
const pricePerKg = (pricePerLb: number) => pricePerLb / 0.453592;

// Extract 5-char port code from string like "Puerto Quetzal (GTPRQ)" or return as-is if already a code
const portCode = (port: string) => {
    if (!port) return '—';
    const match = port.match(/\(([A-Z0-9]{5})\)/);
    if (match) return match[1];
    // If the string itself looks like a 5-char code already
    const trimmed = port.trim();
    if (/^[A-Z0-9]{5}$/.test(trimmed)) return trimmed;
    return trimmed;
};

const CostProfitAI: React.FC<CostProfitAIProps> = ({
    initialStep,
    supplierOffers, costCalculations, freightQuotes, products, ports, suppliers,
    onSaveCalculation, onUpdateCalculation, onDeleteCalculation, onNavigate, currentCompanyId, currentUser,
    onAddOffer, onAddSupplier, onAddProduct, onAddPort, availableCompanies,
    customers = [], onSaveSalesOrder, onDeleteSalesOrder, onDeleteOffer, onUpdateSalesOrder, banks = [], salesOrders = [], cargoAgents = []
}) => {
    // Wizard step
    const [step, setStep] = useState<0 | 1 | 2 | 3 | 4 | 5>(initialStep ?? 1);
    const [stepMode, setStepMode] = useState<'view' | 'edit'>('edit');
    const [orderSearch, setOrderSearch] = useState('');
    const [orderCustomerFilter, setOrderCustomerFilter] = useState('');
    const [orderStatusFilter, setOrderStatusFilter] = useState('');
    const [viewingOrderId, setViewingOrderId] = useState<string | null>(null);
    const [bookingRequested, setBookingRequested] = useState(false);
    const [bookingNotes, setBookingNotes] = useState('');
    const [showBookingEmailModal, setShowBookingEmailModal] = useState(false);
    const [bookingEmailTo, setBookingEmailTo] = useState('');
    const [bookingEmailSubject, setBookingEmailSubject] = useState('');
    const [bookingEmailBody, setBookingEmailBody] = useState('');
    const [selectedFreightQuoteId, setSelectedFreightQuoteId] = useState('');

    // Step 1 state
    const [selectedOfferIds, setSelectedOfferIds] = useState<Set<string>>(new Set());
    const [selectedItemKeys, setSelectedItemKeys] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [aiRanking, setAiRanking] = useState<{ offerNumber: string; score: number; reasoning: string }[]>([]);

    // Shared logistics costs (applied to all items)
    const [sharedCosts, setSharedCosts] = useState({ pickupCost: 0, oceanFreight: 0, deliveryCost: 0, insuranceCost: 0, dutyPercent: 0, clearanceCost: 0 });
    const [aiRankingSummary, setAiRankingSummary] = useState('');
    const [rankingLoading, setRankingLoading] = useState(false);

    // View Quote modal
    const [viewQuoteOffer, setViewQuoteOffer] = useState<SupplierOffer | null>(null);

    // Step 2 state
    const [calculations, setCalculations] = useState<ItemCalculation[]>([]);
    const [aiLoading, setAiLoading] = useState(false);
    const [aiProgress, setAiProgress] = useState(0);
    const [editingField, setEditingField] = useState<string | null>(null);
    const [editingValue, setEditingValue] = useState('');

    // Step 3 state
    const [marginLoading, setMarginLoading] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [editingCalcId, setEditingCalcId] = useState<string | null>(null);
    const [selectedCalcIds, setSelectedCalcIds] = useState<Set<string>>(new Set());
    const [deletedCalcIds, setDeletedCalcIds] = useState<Set<string>>(new Set());

    // Step 4 state — Sales Order
    const [selectedCustomerId, setSelectedCustomerId] = useState('');
    const [customerSearch, setCustomerSearch] = useState('');
    const [orderType, setOrderType] = useState<'SPOT' | 'CONTRACT'>('SPOT');
    const [orderPaymentTerms, setOrderPaymentTerms] = useState('Net 30');
    const [orderIncoterm, setOrderIncoterm] = useState('FOB');
    const [orderNotes, setOrderNotes] = useState('');
    const [orderSaveStatus, setOrderSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [createdOrderNumber, setCreatedOrderNumber] = useState('');
    const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
    const [orderSaleType, setOrderSaleType] = useState<'LOCAL' | 'EXPORT'>('EXPORT');
    const [orderDeliveryMethod, setOrderDeliveryMethod] = useState('PORT_TO_PORT');
    const [orderDeliveryAddress, setOrderDeliveryAddress] = useState('');
    const [orderDeliveryDate, setOrderDeliveryDate] = useState('');
    const [orderPickupLocation, setOrderPickupLocation] = useState('');
    const [orderBankId, setOrderBankId] = useState('');
    const [orderPoa, setOrderPoa] = useState('');
    const [orderPod, setOrderPod] = useState('');
    const [savedCount, setSavedCount] = useState(0);

    // Add New Offer modal state
    const [showAddModal, setShowAddModal] = useState(false);
    const [addTab, setAddTab] = useState<'ocr' | 'manual'>('ocr');
    const [ocrLoading, setOcrLoading] = useState(false);
    const [ocrFile, setOcrFile] = useState<File | null>(null);
    const [addSaving, setAddSaving] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [offerForm, setOfferForm] = useState<Partial<SupplierOffer>>({
        supplierId: '', supplierName: '', items: [], totalAmount: 0,
        currency: 'USD', incoterm: 'FOB', loadingLocation: '', originPort: '',
        destinationPort: '', validUntil: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
        paymentTerms: 'Net 30', status: 'Received', notes: ''
    });
    const [addItem, setAddItem] = useState<Partial<SupplierQuoteItem>>({ productName: '', quantity: 0, unitPrice: 0, moq: 0, leadTime: '' });
    const [editingOfferItemIndex, setEditingOfferItemIndex] = useState<number | null>(null);
    const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
    const [quickAddSupplier, setQuickAddSupplier] = useState(false);
    const [newSupName, setNewSupName] = useState('');
    const [quickAddProduct, setQuickAddProduct] = useState(false);
    const [newProdName, setNewProdName] = useState('');
    const [quickAddPort, setQuickAddPort] = useState<'origin' | 'destination' | null>(null);
    const [newPortCode, setNewPortCode] = useState('');
    const [newPortName, setNewPortName] = useState('');
    const [newPortCountry, setNewPortCountry] = useState('');

    // OCR-detected new entities – full editable objects + modal visibility
    const [detectedSupplier, setDetectedSupplier] = useState<Partial<Supplier> | null>(null);
    const [showDetectedSupModal, setShowDetectedSupModal] = useState(false);
    const [savingDetectedSup, setSavingDetectedSup] = useState(false);
    const [detectedProducts, setDetectedProducts] = useState<Partial<Product>[]>([]);
    const [editingProductIdx, setEditingProductIdx] = useState<number | null>(null);
    const [savingDetectedProd, setSavingDetectedProd] = useState(false);

    // Reset the add offer form
    const resetAddForm = () => {
        setOfferForm({
            supplierId: '', supplierName: '', items: [], totalAmount: 0,
            currency: 'USD', incoterm: 'FOB', loadingLocation: '', originPort: '',
            destinationPort: '', validUntil: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
            paymentTerms: 'Net 30', status: 'Received', notes: ''
        });
        setAddItem({ productName: '', quantity: 0, unitPrice: 0, moq: 0, leadTime: '' });
        setOcrFile(null);
        setAddTab('ocr');
        setDetectedSupplier(null);
        setDetectedProducts([]);
        setShowDetectedSupModal(false);
        setEditingProductIdx(null);
        setEditingOfferId(null);
    };

    // Open the edit modal with existing offer data
    const handleEditOfferInline = (offer: SupplierOffer) => {
        setOfferForm({
            supplierId: offer.supplierId,
            supplierName: offer.supplierName,
            items: offer.items,
            totalAmount: offer.totalAmount,
            currency: offer.currency,
            incoterm: offer.incoterm,
            loadingLocation: offer.loadingLocation,
            originPort: offer.originPort,
            destinationPort: offer.destinationPort,
            validUntil: offer.validUntil,
            paymentTerms: offer.paymentTerms,
            status: offer.status,
            notes: offer.notes
        });
        setEditingOfferId(offer.id);
        setAddTab('manual');
        setShowAddModal(true);
    };

    // Handle OCR extraction
    const handleOcrExtract = async (file: File) => {
        setOcrLoading(true);
        try {
            const reader = new FileReader();
            const base64 = await new Promise<string>((resolve) => {
                reader.onload = () => {
                    const result = reader.result as string;
                    resolve(result.split(',')[1]);
                };
                reader.readAsDataURL(file);
            });
            const prompt = `Extract supplier offer/quote data from this document. Return ONLY valid JSON (no markdown, no code fences) with this exact structure:
{
  "supplierName": "string",
  "supplierAddress": "full street address or empty",
  "supplierCity": "string or empty",
  "supplierState": "string or empty",
  "supplierCountry": "string or empty",
  "supplierPhone": "string or empty",
  "supplierEmail": "string or empty",
  "supplierContactPerson": "string or empty",
  "supplierTaxId": "tax ID / CNPJ / EIN or empty",
  "incoterm": "FOB|EXW|FAS|CFR|CIF|DDP",
  "currency": "USD|EUR|CNY",
  "paymentTerms": "string",
  "loadingLocation": "string or empty",
  "originPort": "string or empty",
  "destinationPort": "string or empty",
  "validUntil": "YYYY-MM-DD or empty",
  "notes": "string or empty",
  "items": [
    { "productName": "string", "quantity": number_in_lbs, "unitPrice": number_per_lb, "leadTime": "string or empty" }
  ]
}
Extract as much supplier detail as possible from the letterhead, header, footer, or body. Convert all weights to lbs and prices to $/lb if needed. If information is missing, leave the field empty or 0.`;

            const resultRaw = await analyzeDocument(base64, file.type, prompt);
            console.log('[OCR] Raw result:', resultRaw);
            let parsed: any = null;
            // Strategy 1: direct JSON parse
            try { parsed = JSON.parse(resultRaw); } catch { }
            // Strategy 2: strip markdown code fences
            if (!parsed) {
                try {
                    const cleaned = resultRaw.replace(/```(?:json)?\s*\n?/g, '').trim();
                    parsed = JSON.parse(cleaned);
                } catch { }
            }
            // Strategy 3: regex extract first JSON object
            if (!parsed) {
                try {
                    const match = resultRaw.match(/\{[\s\S]*\}/);
                    if (match) parsed = JSON.parse(match[0]);
                } catch { }
            }
            if (!parsed) {
                console.error('[OCR] Failed to parse:', resultRaw);
                alert('Could not parse OCR result. Please try manual entry.');
                setOcrLoading(false);
                return;
            }

            const items: SupplierQuoteItem[] = (parsed.items || []).map((it: any) => ({
                productName: it.productName || it.product_name || it.name || it.product || '',
                quantity: Number(it.quantity || it.qty) || 0,
                unitPrice: Number(it.unitPrice || it.unit_price || it.price) || 0,
                moq: Number(it.moq) || 0,
                leadTime: it.leadTime || it.lead_time || '',
                total: (Number(it.quantity || it.qty) || 0) * (Number(it.unitPrice || it.unit_price || it.price) || 0)
            }));
            const totalAmount = items.reduce((s, i) => s + i.total, 0);

            // Check if supplier exists (fuzzy match: normalize punctuation, spaces, suffixes)
            const normalize = (s: string) => s.toLowerCase().replace(/[.,;:\-_()]/g, '').replace(/\s+/g, ' ').trim();
            const ocrSupName = (parsed.supplierName || parsed.supplier_name || parsed.supplier || parsed.company || '').trim();
            const ocrNorm = normalize(ocrSupName);
            const matchedSupplier = ocrSupName ? suppliers.find(s => {
                const dbNorm = normalize(s.name);
                // Exact normalized match
                if (dbNorm === ocrNorm) return true;
                // One contains the other (handles "FIBERTEX" vs "FIBERTEX, S.A. DE C.V.")
                if (dbNorm.includes(ocrNorm) || ocrNorm.includes(dbNorm)) return true;
                // Also check nickname if available
                if (s.nickname && normalize(s.nickname) === ocrNorm) return true;
                return false;
            }) : null;

            // Check which products are new (also fuzzy)
            const productNames = items.map(i => i.productName).filter(Boolean);
            const newProds = productNames.filter(pn => {
                const pnNorm = normalize(pn);
                return !products.find(p => {
                    const dbNorm = normalize(p.name);
                    return dbNorm === pnNorm || dbNorm.includes(pnNorm) || pnNorm.includes(dbNorm);
                });
            });

            console.log('[OCR] Parsed object keys:', Object.keys(parsed));
            console.log('[OCR] Supplier name extracted:', JSON.stringify(ocrSupName));
            console.log('[OCR] Items extracted:', items.length, items.map(i => i.productName));
            console.log('[OCR] Existing suppliers:', suppliers.map(s => s.name));
            console.log('[OCR] Matched supplier:', matchedSupplier?.name || 'NONE');
            console.log('[OCR] New products:', newProds);
            console.log('[OCR] Existing products:', products.map(p => p.name));

            setOfferForm(prev => ({
                ...prev,
                supplierId: matchedSupplier ? matchedSupplier.id : '',
                supplierName: matchedSupplier ? matchedSupplier.name : ocrSupName,
                incoterm: parsed.incoterm || prev.incoterm,
                currency: parsed.currency || prev.currency,
                paymentTerms: parsed.paymentTerms || parsed.payment_terms || prev.paymentTerms,
                loadingLocation: parsed.loadingLocation || parsed.loading_location || prev.loadingLocation,
                originPort: parsed.originPort || parsed.origin_port || prev.originPort,
                destinationPort: parsed.destinationPort || parsed.destination_port || prev.destinationPort,
                validUntil: parsed.validUntil || parsed.valid_until || prev.validUntil,
                notes: parsed.notes || prev.notes,
                items,
                totalAmount
            }));

            // Build detected entities with full editable objects
            const cid = currentCompanyId === 'ALL' ? '' : currentCompanyId;
            if (ocrSupName && !matchedSupplier) {
                console.log('[OCR] ✅ Setting detectedSupplier:', ocrSupName);
                setDetectedSupplier({
                    id: `SUP${Date.now()}`, companyId: cid, name: ocrSupName,
                    contactPerson: parsed.supplierContactPerson || parsed.contactPerson || '',
                    email: parsed.supplierEmail || parsed.email || '',
                    phone: parsed.supplierPhone || parsed.phone || '',
                    taxId: parsed.supplierTaxId || parsed.taxId || '',
                    country: parsed.supplierCountry || parsed.country || '',
                    city: parsed.supplierCity || parsed.city || '',
                    state: parsed.supplierState || parsed.state || '',
                    location: parsed.supplierAddress || parsed.address || '',
                    categories: [], rating: 3,
                    paymentTerms: parsed.paymentTerms || parsed.payment_terms || 'Net 30'
                });
            } else {
                console.log('[OCR] ❌ No new supplier detected. ocrSupName=', JSON.stringify(ocrSupName), 'matchedSupplier=', matchedSupplier?.name);
                setDetectedSupplier(null);
            }
            if (newProds.length > 0) {
                console.log('[OCR] ✅ Setting detectedProducts:', newProds);
            } else {
                console.log('[OCR] ❌ No new products detected');
            }
            setDetectedProducts(newProds.map((pn, i) => ({
                id: `P${Date.now() + i}`, companyId: cid, name: pn, category: 'Resin', grade: '', hsCode: '', supplier: ocrSupName || '', price: 0, stockStatus: 'Available' as const, specs: { origin: '', type: '', color: '', form: 'Pellets' }
            })));

            setAddTab('manual'); // switch to manual tab to review
        } catch (err) {
            alert('OCR extraction failed: ' + (err as Error).message);
        }
        setOcrLoading(false);
    };

    // Add line item to the offer form
    const handleAddOfferItem = () => {
        if (!addItem.productName || !addItem.quantity || !addItem.unitPrice) return;
        const total = (addItem.quantity || 0) * (addItem.unitPrice || 0);
        const newItem: SupplierQuoteItem = { ...addItem, total } as SupplierQuoteItem;

        if (editingOfferItemIndex !== null) {
            // Update existing item in-place
            setOfferForm(prev => {
                const items = [...(prev.items || [])];
                const oldTotal = items[editingOfferItemIndex]?.total || 0;
                items[editingOfferItemIndex] = newItem;
                return {
                    ...prev,
                    items,
                    totalAmount: (prev.totalAmount || 0) - oldTotal + total
                };
            });
            setEditingOfferItemIndex(null);
        } else {
            // Add new item
            setOfferForm(prev => ({
                ...prev,
                items: [...(prev.items || []), newItem],
                totalAmount: (prev.totalAmount || 0) + total
            }));
        }
        setAddItem({ productName: '', quantity: 0, unitPrice: 0, moq: 0, leadTime: '' });
    };

    // Remove line item from the offer form
    const handleRemoveOfferItem = (index: number) => {
        setOfferForm(prev => {
            const newItems = [...(prev.items || [])];
            const removed = newItems.splice(index, 1)[0];
            return { ...prev, items: newItems, totalAmount: (prev.totalAmount || 0) - removed.total };
        });
    };

    // Save the new offer (or update existing)
    const handleSaveOffer = async () => {
        if (!onAddOffer) return;
        if (!(offerForm.items || []).length) { alert('Add at least one item.'); return; }
        setAddSaving(true);
        // If editing, delete the old offer first
        if (editingOfferId && onDeleteOffer) {
            await onDeleteOffer(editingOfferId);
        }
        const offer: SupplierOffer = {
            id: editingOfferId || `SO${Date.now()} `,
            offerNumber: editingOfferId ? (supplierOffers.find(o => o.id === editingOfferId)?.offerNumber || `OFR - ${Date.now().toString().slice(-6)} `) : `OFR - ${Date.now().toString().slice(-6)} `,
            companyId: currentCompanyId === 'ALL' ? '' : currentCompanyId,
            supplierId: offerForm.supplierId || '',
            supplierName: offerForm.supplierName || '',
            items: offerForm.items as SupplierQuoteItem[],
            totalAmount: offerForm.totalAmount || 0,
            currency: (offerForm.currency || 'USD') as any,
            incoterm: (offerForm.incoterm || 'FOB') as any,
            loadingLocation: offerForm.loadingLocation,
            originPort: offerForm.originPort,
            destinationPort: offerForm.destinationPort,
            validUntil: offerForm.validUntil || '',
            paymentTerms: offerForm.paymentTerms || 'Net 30',
            status: 'Received',
            notes: offerForm.notes
        };
        await onAddOffer(offer);
        setAddSaving(false);
        resetAddForm();
        setShowAddModal(false);
    };

    // Filtered offers
    const filteredOffers = useMemo(() => {
        let list = [...supplierOffers];
        if (statusFilter !== 'all') list = list.filter(o => o.status === statusFilter);
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            list = list.filter(o =>
                o.offerNumber?.toLowerCase().includes(q) ||
                o.supplierName?.toLowerCase().includes(q) ||
                o.items?.some(it => it.productName?.toLowerCase().includes(q))
            );
        }
        return list;
    }, [supplierOffers, statusFilter, searchQuery]);

    const selectedOffers = useMemo(() =>
        supplierOffers.filter(o => selectedOfferIds.has(o.id)),
        [supplierOffers, selectedOfferIds]
    );

    // --- STEP 1: Toggle selection ---
    const toggleOffer = (id: string) => {
        const offer = supplierOffers.find(o => o.id === id);
        const items = offer?.items || [];
        setSelectedOfferIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
        setSelectedItemKeys(prev => {
            const next = new Set(prev);
            const isSelected = prev.has(`${id}:0`) || items.length === 0;
            if (isSelected) {
                // Deselect all items of this offer
                items.forEach((_, idx) => next.delete(`${id}:${idx}`));
            } else {
                // Select all items of this offer
                items.forEach((_, idx) => next.add(`${id}:${idx}`));
            }
            return next;
        });
    };

    const toggleItem = (offerId: string, itemIdx: number) => {
        const offer = supplierOffers.find(o => o.id === offerId);
        const items = offer?.items || [];
        setSelectedItemKeys(prev => {
            const next = new Set(prev);
            const key = `${offerId}:${itemIdx}`;
            if (next.has(key)) next.delete(key); else next.add(key);
            // Sync offer-level: if any item is selected, offer is selected; if none, deselect offer
            const anySelected = items.some((_, idx) => next.has(`${offerId}:${idx}`));
            setSelectedOfferIds(prevOffers => {
                const nextOffers = new Set(prevOffers);
                if (anySelected) nextOffers.add(offerId); else nextOffers.delete(offerId);
                return nextOffers;
            });
            return next;
        });
    };

    const toggleAll = () => {
        if (selectedOfferIds.size === filteredOffers.length) {
            setSelectedOfferIds(new Set());
            setSelectedItemKeys(new Set());
        } else {
            setSelectedOfferIds(new Set(filteredOffers.map(o => o.id)));
            const allKeys = new Set<string>();
            filteredOffers.forEach(o => (o.items || []).forEach((_, idx) => allKeys.add(`${o.id}:${idx}`)));
            setSelectedItemKeys(allKeys);
        }
    };

    // Count selected items across all offers
    const selectedItemCount = selectedItemKeys.size;

    // AI Rank offers
    const handleAiRank = async () => {
        if (filteredOffers.length === 0) return;
        setRankingLoading(true);
        try {
            const result = await getCostProfitOfferRanking(
                filteredOffers.map(o => ({
                    offerNumber: o.offerNumber,
                    supplierName: o.supplierName,
                    items: (o.items || []).map(it => ({ productName: it.productName, unitPrice: it.unitPrice, quantity: it.quantity })),
                    incoterm: o.incoterm,
                    originPort: o.originPort,
                    destinationPort: o.destinationPort
                }))
            );
            setAiRanking(result.ranking || []);
            setAiRankingSummary(result.summary || '');
        } catch { /* ignore */ }
        setRankingLoading(false);
    };

    const getOfferScore = (offerNumber: string) => aiRanking.find(r => r.offerNumber === offerNumber);

    // --- STEP 2: Build calculations from selected items ---
    const buildCalculations = () => {
        const calcs: ItemCalculation[] = [];
        for (const offer of selectedOffers) {
            const sup = suppliers.find(s => s.id === offer.supplierId);
            (offer.items || []).forEach((item, idx) => {
                // Include item if individually selected, or if no item-level filtering (all items selected by default via offer toggle)
                const offerItemKeys = (offer.items || []).map((_, i) => `${offer.id}:${i}`);
                const allSelected = offerItemKeys.every(k => selectedItemKeys.has(k));
                const noneSelected = offerItemKeys.every(k => !selectedItemKeys.has(k));
                if (!allSelected && !noneSelected && !selectedItemKeys.has(`${offer.id}:${idx}`)) return;
                calcs.push({
                    offerId: offer.id,
                    offerNumber: offer.offerNumber,
                    supplierName: offer.supplierName,
                    productName: item.productName,
                    systemProductName: item.systemProductName || (() => { const mp = products.find(p => p.supplierProductName === item.productName || p.name === item.productName); return mp?.name; })(),
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    currency: offer.currency || 'USD',
                    incoterm: offer.incoterm || 'FOB',
                    originPort: offer.originPort || '',
                    destinationPort: offer.destinationPort || '',
                    loadingLocation: sup?.pickupLocation || sup?.location || offer.loadingLocation || '',
                    containerCount: 1,
                    pickupCost: 0,
                    oceanFreight: 0,
                    deliveryCost: 0,
                    insuranceCost: 0,
                    dutyPercent: 0,
                    clearanceCost: 0,
                    sources: {},
                    totalBase: item.unitPrice * item.quantity,
                    totalLogistics: 0,
                    totalImportFees: 0,
                    totalLandedCost: item.unitPrice * item.quantity,
                    unitLandedCost: item.unitPrice,
                    aiInsight: '',
                    marginPercent: 15,
                    salePrice: 0,
                    profitPerUnit: 0,
                    marginReasoning: ''
                });
            });
        }
        setCalculations(calcs);
    };

    const goToStep2 = () => {
        buildCalculations();
        setStepMode('edit');
        setStep(2);
    };

    // Calculate a single offer (all items) directly
    const calculateSingleOffer = (offer: SupplierOffer) => {
        setSelectedOfferIds(new Set([offer.id]));
        const sup = suppliers.find(s => s.id === offer.supplierId);
        const calcs: ItemCalculation[] = [];
        for (const item of (offer.items || [])) {
            calcs.push({
                offerId: offer.id,
                offerNumber: offer.offerNumber,
                supplierName: offer.supplierName,
                productName: item.productName,
                systemProductName: item.systemProductName || (() => { const mp = products.find(p => p.supplierProductName === item.productName || p.name === item.productName); return mp?.name; })(),
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                currency: offer.currency || 'USD',
                incoterm: offer.incoterm || 'FOB',
                originPort: offer.originPort || '',
                destinationPort: offer.destinationPort || '',
                loadingLocation: sup?.pickupLocation || sup?.location || offer.loadingLocation || '',
                containerCount: 1,
                pickupCost: 0, oceanFreight: 0, deliveryCost: 0,
                insuranceCost: 0, dutyPercent: 0, clearanceCost: 0,
                sources: {},
                totalBase: item.unitPrice * item.quantity,
                totalLogistics: 0, totalImportFees: 0,
                totalLandedCost: item.unitPrice * item.quantity,
                unitLandedCost: item.unitPrice,
                aiInsight: '',
                marginPercent: 15, salePrice: 0, profitPerUnit: 0, marginReasoning: ''
            });
        }
        setCalculations(calcs);
        setStep(2);
    };

    // Calculate a single product item from an offer
    const calculateSingleItem = (offer: SupplierOffer, item: SupplierQuoteItem) => {
        setSelectedOfferIds(new Set([offer.id]));
        const sup = suppliers.find(s => s.id === offer.supplierId);
        setCalculations([{
            offerId: offer.id,
            offerNumber: offer.offerNumber,
            supplierName: offer.supplierName,
            productName: item.productName,
            systemProductName: item.systemProductName || (() => { const mp = products.find(p => p.supplierProductName === item.productName || p.name === item.productName); return mp?.name; })(),
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            currency: offer.currency || 'USD',
            incoterm: offer.incoterm || 'FOB',
            originPort: offer.originPort || '',
            destinationPort: offer.destinationPort || '',
            loadingLocation: sup?.pickupLocation || sup?.location || offer.loadingLocation || '',
            containerCount: 1,
            pickupCost: 0, oceanFreight: 0, deliveryCost: 0,
            insuranceCost: 0, dutyPercent: 0, clearanceCost: 0,
            sources: {},
            totalBase: item.unitPrice * item.quantity,
            totalLogistics: 0, totalImportFees: 0,
            totalLandedCost: item.unitPrice * item.quantity,
            unitLandedCost: item.unitPrice,
            aiInsight: '',
            marginPercent: 15, salePrice: 0, profitPerUnit: 0, marginReasoning: ''
        }]);
        setStep(2);
    };

    // Recalculate a single item
    const recalcItem = (item: ItemCalculation): ItemCalculation => {
        const totalBase = item.unitPrice * item.quantity;
        const appliedPickup = (item.incoterm === 'EXW') ? item.pickupCost : 0;
        const appliedOcean = (['EXW', 'FOB', 'FAS'].includes(item.incoterm)) ? item.oceanFreight : 0;
        const appliedDelivery = (item.incoterm !== 'DDP') ? item.deliveryCost : 0;
        const weightKg = lbsToKgs(item.quantity);
        const containers = Math.max(1, Math.ceil(weightKg / 20000));
        const totalLogistics = (appliedPickup + appliedOcean + appliedDelivery) * containers;

        const freightForDuty = appliedOcean;
        const cifValue = totalBase + freightForDuty + item.insuranceCost;
        const dutyAmount = cifValue * (item.dutyPercent / 100);
        const totalImportFees = dutyAmount + item.clearanceCost + item.insuranceCost;
        const totalLandedCost = totalBase + totalLogistics + totalImportFees;
        const unitLandedCost = item.quantity > 0 ? totalLandedCost / item.quantity : 0;

        const marginMult = item.marginPercent < 100 ? 1 / (1 - item.marginPercent / 100) : 1;
        const salePrice = unitLandedCost * marginMult;
        const profitPerUnit = salePrice - unitLandedCost;

        return { ...item, containerCount: containers, totalBase, totalLogistics, totalImportFees, totalLandedCost, unitLandedCost, salePrice, profitPerUnit };
    };

    // AI Auto-fill all items
    const handleAutoFillAll = async () => {
        setAiLoading(true);
        setAiProgress(0);
        const updated = [...calculations];

        for (let i = 0; i < updated.length; i++) {
            setAiProgress(Math.round(((i + 1) / updated.length) * 100));
            try {
                const result = await getCostProfitAnalysis(
                    updated[i].productName,
                    updated[i].quantity,
                    updated[i].unitPrice,
                    updated[i].incoterm,
                    updated[i].originPort,
                    updated[i].destinationPort,
                    updated[i].currency,
                    freightQuotes,
                    costCalculations
                );
                updated[i] = recalcItem({
                    ...updated[i],
                    pickupCost: result.estimate.pickupCost,
                    oceanFreight: result.estimate.oceanFreight,
                    deliveryCost: result.estimate.deliveryCost,
                    insuranceCost: result.estimate.insuranceCost,
                    dutyPercent: result.estimate.dutyPercent,
                    clearanceCost: result.estimate.clearanceCost,
                    sources: result.sources as Record<string, 'db' | 'ai' | 'manual'>,
                    aiInsight: result.estimate.explanation
                });
            } catch {
                updated[i].aiInsight = 'AI estimation failed for this item.';
            }
        }
        setCalculations(updated);
        setAiLoading(false);
    };

    // Update a single cost field
    const updateCalcField = (index: number, field: keyof ItemCalculation, value: number) => {
        setCalculations(prev => {
            const next = [...prev];
            next[index] = recalcItem({ ...next[index], [field]: value, sources: { ...next[index].sources, [field]: 'manual' as const } });
            return next;
        });
    };

    // Update a shared cost field and apply to ALL items
    const updateSharedCost = (field: string, value: number) => {
        setSharedCosts(prev => ({ ...prev, [field]: value }));
        setCalculations(prev => prev.map(c => recalcItem({ ...c, [field]: value, sources: { ...c.sources, [field]: 'manual' as const } })));
    };

    // When user selects a POD, apply to ALL items and look up matching freight quotes
    const handlePodSelect = (_index: number, pod: string) => {
        setCalculations(prev => prev.map(c => {
            const calc = { ...c, destinationPort: pod };
            const match = freightQuotes.find(fq => {
                const fqOrigin = (fq.originPort || '').toLowerCase();
                const fqDest = (fq.destinationPort || '').toLowerCase();
                const calcOrigin = (calc.originPort || '').toLowerCase();
                const calcDest = pod.toLowerCase();
                return (
                    (fqOrigin.includes(calcOrigin) || calcOrigin.includes(fqOrigin)) &&
                    (fqDest.includes(calcDest) || calcDest.includes(fqDest))
                ) && fq.status === 'ACTIVE';
            });
            if (match) {
                const totalOcean = (match.oceanCost || match.rate || 0);
                calc.pickupCost = match.pickupCost || 0;
                calc.oceanFreight = totalOcean;
                calc.deliveryCost = match.deliveryCost || 0;
                calc.sources = { ...calc.sources, pickupCost: 'db', oceanFreight: 'db', deliveryCost: 'db' };
                calc.aiInsight = `Freight quote found: ${match.agentName} / ${match.carrier} (${match.freightType})`;
                calc.freightAgentName = match.agentName || '';
                // Sync shared costs
                setSharedCosts(prev => ({ ...prev, pickupCost: calc.pickupCost, oceanFreight: calc.oceanFreight, deliveryCost: calc.deliveryCost }));
            } else {
                calc.freightAgentName = '';
            }
            return recalcItem(calc);
        }));
    };

    // --- STEP 3: Price ---
    const goToStep3 = () => {
        setStepMode('edit');
        setStep(3);
        // Auto-save calculations when entering Price step
        setTimeout(() => handleSaveAll(), 100);
    };

    const updateMargin = (index: number, margin: number) => {
        setCalculations(prev => {
            const next = [...prev];
            next[index] = recalcItem({ ...next[index], marginPercent: margin });
            return next;
        });
    };

    const updateSalePriceLb = (index: number, newSalePrice: number) => {
        setCalculations(prev => {
            const next = [...prev];
            const c = next[index];
            const margin = (c.unitLandedCost > 0 && newSalePrice > 0) ? (1 - c.unitLandedCost / newSalePrice) * 100 : 0;
            next[index] = { ...c, marginPercent: Math.round(margin * 100) / 100, salePrice: newSalePrice, profitPerUnit: newSalePrice - c.unitLandedCost };
            return next;
        });
    };

    const updateSalePriceKg = (index: number, newSalePriceKg: number) => {
        const newSalePriceLb = newSalePriceKg * 0.453592;
        updateSalePriceLb(index, newSalePriceLb);
    };

    // Save all calculations
    const handleSaveAll = async () => {
        setSaveStatus('saving');
        setSavedCount(0);
        let count = 0;
        const batchTs = Date.now();
        const batchCalcNumber = `CA-${String(batchTs).slice(-7)}`;

        for (const calc of calculations) {
            const record: CostCalculation = {
                id: `CA${batchTs}-${count}`,
                companyId: currentCompanyId,
                calculationNumber: batchCalcNumber,
                date: new Date().toISOString(),
                productName: calc.systemProductName || calc.productName,
                origin: calc.originPort,
                destination: calc.destinationPort,
                fobPrice: calc.unitPrice,
                quantity: calc.quantity,
                freightCost: calc.totalLogistics,
                insuranceCost: calc.insuranceCost,
                dutyPercent: calc.dutyPercent,
                portClearanceCost: calc.clearanceCost,
                deliveryCost: calc.deliveryCost,
                marginPercent: calc.marginPercent,
                totalLandedCost: calc.totalLandedCost,
                unitLandedCost: calc.unitLandedCost,
                recommendedSalesPrice: calc.salePrice,
                supplierName: calc.supplierName,
                quoteNumber: calc.offerNumber,
                poa: calc.originPort,
                pod: calc.destinationPort,
                pickupMethod: calc.incoterm
            };

            if (editingCalcId && onUpdateCalculation) {
                const result = await onUpdateCalculation(editingCalcId, record);
                if (result) count++;
            } else {
                const result = await onSaveCalculation(record as any);
                if (result) count++;
            }
        }

        setSavedCount(count);
        setSaveStatus(count > 0 ? 'saved' : 'error');
        setEditingCalcId(null);
    };

    const handleEditCalculation = (cc: CostCalculation) => {
        setCalculations([{
            offerId: '',
            offerNumber: cc.quoteNumber || '',
            supplierName: cc.supplierName || '',
            productName: cc.productName,
            quantity: cc.quantity || 0,
            unitPrice: cc.fobPrice || 0,
            currency: 'USD',
            incoterm: cc.pickupMethod || 'FOB',
            originPort: cc.origin || '',
            destinationPort: cc.destination || '',
            loadingLocation: cc.pickupLocation || '',
            containerCount: 1,
            pickupCost: 0,
            oceanFreight: 0,
            deliveryCost: cc.deliveryCost || 0,
            insuranceCost: cc.insuranceCost || 0,
            dutyPercent: cc.dutyPercent || 0,
            clearanceCost: cc.portClearanceCost || 0,
            sources: {},
            totalBase: (cc.quantity || 0) * (cc.fobPrice || 0),
            totalLogistics: cc.freightCost || 0,
            totalImportFees: (cc.insuranceCost || 0) + (cc.portClearanceCost || 0) + (((cc.quantity || 0) * (cc.fobPrice || 0)) * (cc.dutyPercent || 0) / 100),
            totalLandedCost: cc.totalLandedCost,
            unitLandedCost: cc.unitLandedCost,
            aiInsight: '',
            marginPercent: cc.marginPercent || 15,
            salePrice: cc.recommendedSalesPrice || 0,
            profitPerUnit: cc.recommendedSalesPrice - cc.unitLandedCost,
            marginReasoning: ''
        }]);
        setEditingCalcId(cc.id);
        setStepMode('edit');
    };

    // --- RENDER ---

    const handleStepClick = (targetStep: 0 | 1 | 2 | 3 | 4 | 5) => {
        if (targetStep === step && stepMode === 'view') return;
        // Free navigation — always allow clicking any step
        // Clicking step buttons shows saved records (view mode)
        setStepMode('view');
        setStep(targetStep);
    };

    const StepIndicator = () => (
        <div className="flex items-center justify-center gap-2 mb-8">
            {[
                { num: 0 as const, label: 'Proposal', icon: FileQuestion },
                { num: 1 as const, label: 'Source', icon: Package },
                { num: 2 as const, label: 'Calculate', icon: Calculator },
                { num: 3 as const, label: 'Price', icon: DollarSign },
                { num: 4 as const, label: 'Order', icon: ShoppingBag },
                { num: 5 as const, label: 'Logistics', icon: Ship }
            ].map((s, idx) => {
                const isActive = step === s.num;
                const isPast = step > s.num;
                // All steps are always clickable
                const canClick = true;
                const Icon = s.icon;

                return (
                    <React.Fragment key={s.num}>
                        {idx > 0 && (
                            <div className={`w-12 h-0.5 ${isPast ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                        )}
                        <button
                            onClick={() => canClick && handleStepClick(s.num)}
                            disabled={!canClick}
                            className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all ${isActive
                                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg'
                                : isPast
                                    ? 'bg-emerald-100 text-emerald-700 cursor-pointer hover:bg-emerald-200'
                                    : canClick
                                        ? 'bg-slate-100 text-slate-500 cursor-pointer hover:bg-slate-200'
                                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                }`}
                        >
                            <Icon size={18} />
                            <span className="text-sm font-bold">{s.label}</span>
                        </button>
                    </React.Fragment>
                );
            })}
        </div>
    );

    return (
        <div className="p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg shadow-rose-200">
                    <Sparkles size={20} className="text-white" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Order-Sale Engine</h1>
                    <p className="text-sm text-slate-500">AI-powered cost analysis from supplier offers to price list</p>
                </div>
            </div>

            <StepIndicator />

            {/* ====================== STEP 0: PROPOSAL ====================== */}
            {step === 0 && (
                <React.Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 size={24} className="animate-spin text-purple-500" /></div>}>
                    <ProposalEngine
                        suppliers={suppliers}
                        customers={customers || []}
                        onAddSupplierOffer={onAddOffer!}
                        currentCompanyId={currentCompanyId}
                        onGoToSource={() => { setStep(1); setStepMode('edit'); }}
                    />
                </React.Suspense>
            )}

            {/* ====================== STEP 1: SOURCE ====================== */}
            {step === 1 && (
                <div className="space-y-4">
                    {/* Controls */}
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="relative flex-1 min-w-[200px]">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Search offers, suppliers, products..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-rose-300 focus:border-rose-400 outline-none"
                            />
                        </div>
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-rose-300 outline-none"
                        >
                            <option value="all">All Status</option>
                            <option value="Received">Received</option>
                            <option value="Accepted">Accepted</option>
                            <option value="Expired">Expired</option>
                            <option value="Rejected">Rejected</option>
                        </select>
                        <button
                            onClick={handleAiRank}
                            disabled={rankingLoading || filteredOffers.length === 0}
                            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-rose-500 to-pink-600 text-white rounded-lg text-sm font-semibold hover:shadow-lg hover:shadow-rose-200 transition-all disabled:opacity-50"
                        >
                            {rankingLoading ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                            AI Rank
                        </button>
                        {onAddOffer && (
                            <button
                                onClick={() => { resetAddForm(); setShowAddModal(true); }}
                                className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-lg text-sm font-semibold hover:shadow-lg hover:shadow-emerald-200 transition-all"
                            >
                                <Plus size={16} /> Add New
                            </button>
                        )}
                    </div>

                    {/* AI Ranking Summary */}
                    {aiRankingSummary && (
                        <div className="bg-gradient-to-r from-rose-50 to-pink-50 border border-rose-200 rounded-xl p-4">
                            <div className="flex items-center gap-2 mb-1">
                                <Sparkles size={16} className="text-rose-500" />
                                <span className="text-sm font-semibold text-rose-700">AI Recommendation</span>
                            </div>
                            <p className="text-sm text-slate-700">{aiRankingSummary}</p>
                        </div>
                    )}

                    {/* Offers Table — flattened: one row per product */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                    <th className="w-10 px-3 py-3">
                                        <input type="checkbox" checked={selectedOfferIds.size === filteredOffers.length && filteredOffers.length > 0} onChange={toggleAll} className="rounded border-slate-300 text-rose-600 focus:ring-rose-500" />
                                    </th>
                                    <th className="px-3 py-3 text-left font-semibold text-slate-600">Offer #</th>
                                    <th className="px-3 py-3 text-left font-semibold text-slate-600">Supplier</th>
                                    <th className="px-3 py-3 text-left font-semibold text-slate-600">Description</th>
                                    <th className="px-3 py-3 text-right font-semibold text-slate-600">lbs</th>
                                    <th className="px-3 py-3 text-right font-semibold text-slate-600">kgs</th>
                                    <th className="px-3 py-3 text-right font-semibold text-slate-600">$/lb</th>
                                    <th className="px-3 py-3 text-right font-semibold text-slate-600">$/kg</th>
                                    <th className="px-3 py-3 text-right font-semibold text-slate-600">Total</th>
                                    <th className="px-3 py-3 text-center font-semibold text-slate-600">Incoterm</th>
                                    <th className="px-3 py-3 text-left font-semibold text-slate-600">POA</th>
                                    <th className="px-3 py-3 text-center font-semibold text-slate-600">Action</th>
                                    {aiRanking.length > 0 && <th className="px-3 py-3 text-center font-semibold text-slate-600">AI Score</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredOffers.length === 0 ? (
                                    <tr><td colSpan={13} className="text-center py-12 text-slate-400">No supplier offers found</td></tr>
                                ) : filteredOffers.map(offer => {
                                    const items = offer.items || [];
                                    const rowCount = items.length || 1;
                                    const score = getOfferScore(offer.offerNumber);
                                    const isSelected = selectedOfferIds.has(offer.id);

                                    if (items.length === 0) {
                                        return (
                                            <tr key={offer.id} className={`border - b border - slate - 200 hover: bg - slate - 50 cursor - pointer transition - colors ${isSelected ? 'bg-rose-50/50' : ''} `} onClick={() => toggleOffer(offer.id)}>
                                                <td className="px-3 py-3"><input type="checkbox" checked={isSelected} onChange={() => toggleOffer(offer.id)} className="rounded border-slate-300 text-rose-600 focus:ring-rose-500" /></td>
                                                <td className="px-3 py-3 font-mono text-xs font-semibold text-slate-800">{offer.offerNumber}</td>
                                                <td className="px-3 py-3 font-medium text-slate-700">{firstName(offer.supplierName)}</td>
                                                <td colSpan={6} className="px-3 py-3 text-slate-400 italic text-xs">No products</td>
                                                <td className="px-3 py-3 text-center"><span className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-xs font-semibold">{offer.incoterm}</span></td>
                                                <td className="px-3 py-3 text-xs text-slate-600 font-mono">{portCode(offer.originPort || '')}</td>
                                                <td className="px-3 py-3">
                                                    <div className="flex items-center justify-center gap-1.5">
                                                        <button onClick={(e) => { e.stopPropagation(); setViewQuoteOffer(offer); }} className="flex items-center gap-1 px-2 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-200 transition-colors" title="View Quote"><Eye size={13} /> View</button>
                                                        <button onClick={(e) => { e.stopPropagation(); handleEditOfferInline(offer); }} className="flex items-center gap-1 px-2 py-1.5 bg-amber-100 text-amber-700 rounded-lg text-xs font-medium hover:bg-amber-200 transition-colors" title="Edit Offer"><Pencil size={13} /> Edit</button>
                                                        <button onClick={(e) => { e.stopPropagation(); if (confirm(`Delete offer ${offer.offerNumber}?`)) onDeleteOffer?.(offer.id); }} className="flex items-center gap-1 px-2 py-1.5 bg-red-100 text-red-700 rounded-lg text-xs font-medium hover:bg-red-200 transition-colors" title="Delete Offer"><Trash2 size={13} /></button>
                                                    </div>
                                                </td>
                                                {aiRanking.length > 0 && <td className="px-3 py-3 text-center text-slate-300">—</td>}
                                            </tr>
                                        );
                                    }

                                    return items.map((it, itemIdx) => (
                                        <tr key={`${offer.id} -${itemIdx} `} className={`${itemIdx < items.length - 1 ? 'border-b border-slate-100' : 'border-b border-slate-300'} hover: bg - slate - 50 cursor - pointer transition - colors ${selectedItemKeys.has(`${offer.id}:${itemIdx}`) ? 'bg-rose-50/50' : ''} `} onClick={(e) => { e.stopPropagation(); toggleItem(offer.id, itemIdx); }}>
                                            {itemIdx === 0 && (
                                                <>
                                                    <td className="px-3 py-2.5 align-top" rowSpan={rowCount}>
                                                        <input type="checkbox" checked={isSelected} onChange={() => toggleOffer(offer.id)} onClick={(e) => e.stopPropagation()} className="rounded border-slate-300 text-rose-600 focus:ring-rose-500" />
                                                    </td>
                                                    <td className="px-3 py-2.5 font-mono text-xs font-semibold text-slate-800 align-top" rowSpan={rowCount}>{offer.offerNumber}</td>
                                                    <td className="px-3 py-2.5 font-medium text-slate-700 align-top" rowSpan={rowCount}>{firstName(offer.supplierName)}</td>
                                                </>
                                            )}
                                            <td className="px-3 py-2 text-slate-700 font-medium text-xs max-w-[200px] truncate">
                                                <div className="flex items-center gap-2">
                                                    <input type="checkbox" checked={selectedItemKeys.has(`${offer.id}:${itemIdx}`)} onChange={() => toggleItem(offer.id, itemIdx)} onClick={(e) => e.stopPropagation()} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                                                    {it.productName}
                                                </div>
                                            </td>
                                            <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-600">{fmt(it.quantity, 0)}</td>
                                            <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-600">{fmt(lbsToKgs(it.quantity), 0)}</td>
                                            <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-600">${fmt(it.unitPrice, 2)}</td>
                                            <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-600">${fmt(pricePerKg(it.unitPrice), 2)}</td>
                                            <td className="px-3 py-2 text-right tabular-nums text-xs font-semibold text-slate-800">{fmtCurrency(it.quantity * it.unitPrice)}</td>
                                            {itemIdx === 0 && (
                                                <>
                                                    <td className="px-3 py-2.5 text-center align-top" rowSpan={rowCount}>
                                                        <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-xs font-semibold">{offer.incoterm}</span>
                                                    </td>
                                                    <td className="px-3 py-2.5 text-xs text-slate-600 font-mono align-top" rowSpan={rowCount}>{portCode(offer.originPort || '')}</td>
                                                </>
                                            )}
                                            <td className="px-3 py-2">
                                                <div className="flex items-center justify-center gap-1">
                                                    <button onClick={(e) => { e.stopPropagation(); setViewQuoteOffer(offer); }} className="flex items-center gap-1 px-2 py-1 bg-slate-100 text-slate-600 rounded-lg text-[11px] font-medium hover:bg-slate-200 transition-colors" title="View Quote"><Eye size={12} /> View</button>
                                                    <button onClick={(e) => { e.stopPropagation(); handleEditOfferInline(offer); }} className="flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-700 rounded-lg text-[11px] font-medium hover:bg-amber-200 transition-colors" title="Edit Offer"><Pencil size={12} /> Edit</button>
                                                    <button onClick={(e) => { e.stopPropagation(); calculateSingleItem(offer, it); }} className="flex items-center gap-1 px-2 py-1 bg-rose-100 text-rose-700 rounded-lg text-[11px] font-medium hover:bg-rose-200 transition-colors" title="Calculate Cost"><Calculator size={12} /> Cost</button>
                                                    <button onClick={(e) => { e.stopPropagation(); if (confirm(`Delete offer ${offer.offerNumber}?`)) onDeleteOffer?.(offer.id); }} className="flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded-lg text-[11px] font-medium hover:bg-red-200 transition-colors" title="Delete Offer"><Trash2 size={12} /></button>
                                                </div>
                                            </td>
                                            {aiRanking.length > 0 && itemIdx === 0 && (
                                                <td className="px-3 py-2.5 text-center align-top" rowSpan={rowCount}>
                                                    {score ? (
                                                        <div className="flex flex-col items-center">
                                                            <span className={`text - lg font - bold ${score.score >= 70 ? 'text-emerald-600' : score.score >= 40 ? 'text-amber-600' : 'text-red-500'} `}>{score.score}</span>
                                                            <span className="text-[10px] text-slate-400 max-w-[120px] truncate">{score.reasoning}</span>
                                                        </div>
                                                    ) : <span className="text-slate-300">—</span>}
                                                </td>
                                            )}
                                        </tr>
                                    ));
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Next Button */}
                    <div className="flex justify-between items-center pt-2">
                        <p className="text-sm text-slate-500">{selectedOfferIds.size} offer(s) selected — {selectedItemCount} item(s) to process</p>
                        <button
                            onClick={goToStep2}
                            disabled={selectedItemCount === 0}
                            className="flex items-center gap-2 px-6 py-3 bg-rose-600 text-white rounded-xl font-semibold hover:bg-rose-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-rose-200"
                        >
                            Next: Calculate <ChevronRight size={18} />
                        </button>
                    </div>
                </div>
            )}

            {/* ====================== STEP 2: CALCULATE ====================== */}
            {step === 2 && stepMode === 'view' && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                            <Calculator size={16} className="text-indigo-500" /> Saved Cost Calculations
                        </h3>
                        <div className="flex items-center gap-2">
                            {selectedCalcIds.size > 0 && onDeleteCalculation && (
                                <button
                                    onClick={async () => {
                                        if (!confirm(`Delete ${selectedCalcIds.size} selected calculation(s)?`)) return;
                                        for (const id of selectedCalcIds) {
                                            const ok = await onDeleteCalculation(id);
                                            if (ok) setDeletedCalcIds(prev => { const n = new Set(prev); n.add(id); return n; });
                                        }
                                        setSelectedCalcIds(new Set());
                                    }}
                                    className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-semibold hover:bg-red-600 transition-all shadow-md"
                                >
                                    <Trash2 size={14} /> Delete ({selectedCalcIds.size})
                                </button>
                            )}
                            <button
                                onClick={() => { if (calculations.length === 0 && selectedOfferIds.size > 0) buildCalculations(); setStepMode('edit'); }}
                                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg text-sm font-semibold hover:from-indigo-700 hover:to-purple-700 transition-all shadow-md"
                            >
                                <Plus size={16} /> New Calculation
                            </button>
                        </div>
                    </div>
                    {costCalculations.filter(cc => !deletedCalcIds.has(cc.id)).length === 0 ? (
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
                            <Calculator size={36} className="mx-auto text-slate-300 mb-3" />
                            <p className="text-slate-400 text-sm">No saved calculations yet</p>
                            <p className="text-slate-300 text-xs mt-1">Use the 'Source' step to select offers, then click 'Next: Calculate' to create new calculations</p>
                        </div>
                    ) : (
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-200">
                                        <th className="px-3 py-3 text-center w-10">
                                            <input
                                                type="checkbox"
                                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                                checked={costCalculations.filter(cc => !deletedCalcIds.has(cc.id)).length > 0 && selectedCalcIds.size === costCalculations.filter(cc => !deletedCalcIds.has(cc.id)).length}
                                                onChange={(e) => {
                                                    if (e.target.checked) setSelectedCalcIds(new Set(costCalculations.filter(cc => !deletedCalcIds.has(cc.id)).map(c => c.id)));
                                                    else setSelectedCalcIds(new Set());
                                                }}
                                            />
                                        </th>
                                        <th className="px-4 py-3 text-left font-semibold text-slate-600">Calc #</th>
                                        <th className="px-4 py-3 text-left font-semibold text-slate-600">Date</th>
                                        <th className="px-4 py-3 text-left font-semibold text-slate-600">System Product Name</th>
                                        <th className="px-4 py-3 text-left font-semibold text-slate-600">Supplier</th>
                                        <th className="px-4 py-3 text-left font-semibold text-slate-600">Route</th>
                                        <th className="px-4 py-3 text-right font-semibold text-slate-600">Qty</th>
                                        <th className="px-4 py-3 text-right font-semibold text-slate-600">FOB</th>
                                        <th className="px-4 py-3 text-right font-semibold text-slate-600">Landed Cost</th>
                                        <th className="px-4 py-3 text-right font-semibold text-slate-600">Sale Price</th>
                                        <th className="px-4 py-3 text-right font-semibold text-slate-600">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {costCalculations.filter(cc => !deletedCalcIds.has(cc.id)).map((cc) => {
                                        const systemName = (cc as any).systemProductName || (() => { const matchedProduct = products.find(p => p.supplierProductName === cc.productName || p.name === cc.productName); return matchedProduct?.name; })() || cc.productName;
                                        return (
                                            <tr key={cc.id} className={`border-b border-slate-100 hover:bg-slate-50/50 ${selectedCalcIds.has(cc.id) ? 'bg-indigo-50/50' : ''}`}>
                                                <td className="px-3 py-2.5 text-center w-10">
                                                    <input
                                                        type="checkbox"
                                                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                                        checked={selectedCalcIds.has(cc.id)}
                                                        onChange={(e) => {
                                                            const next = new Set(selectedCalcIds);
                                                            if (e.target.checked) next.add(cc.id); else next.delete(cc.id);
                                                            setSelectedCalcIds(next);
                                                        }}
                                                    />
                                                </td>
                                                <td className="px-4 py-2.5 font-mono text-xs text-indigo-600 font-bold">{cc.calculationNumber}</td>
                                                <td className="px-4 py-2.5 text-slate-500 text-xs whitespace-nowrap">{cc.date ? (() => { const d = new Date(cc.date); const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`; })() : '—'}</td>
                                                <td className="px-4 py-2.5 font-medium text-slate-800">{systemName}</td>
                                                <td className="px-4 py-2.5 text-slate-600">{firstName(cc.supplierName || '')}</td>
                                                <td className="px-4 py-2.5 text-slate-500 text-xs">{cc.loadingLocation || '—'} → {portCode(cc.origin || '')} → {portCode(cc.destination || '')}</td>
                                                <td className="px-4 py-2.5 text-right">
                                                    <div className="font-medium text-slate-700">{cc.quantity?.toLocaleString()} <span className="text-slate-400 text-[10px]">lbs</span></div>
                                                    <div className="text-xs text-slate-400">{fmt(lbsToKgs(cc.quantity || 0), 0)} kg</div>
                                                </td>
                                                <td className="px-4 py-2.5 text-right">
                                                    <div className="text-slate-600">{fmtCurrency(cc.fobPrice)} <span className="text-slate-400 text-[10px]">lb</span></div>
                                                    <div className="text-xs text-slate-400">{fmtCurrency((cc.fobPrice || 0) * 2.20462)} kg</div>
                                                </td>
                                                <td className="px-4 py-2.5 text-right font-bold text-slate-800">{fmtCurrency(cc.totalLandedCost)}</td>
                                                <td className="px-4 py-2.5 text-right">
                                                    <div className="font-bold text-emerald-600">{cc.recommendedSalesPrice ? fmtCurrency(cc.recommendedSalesPrice) : '—'} {cc.recommendedSalesPrice ? <span className="text-slate-400 text-[10px] font-normal">lb</span> : null}</div>
                                                    {cc.recommendedSalesPrice ? <div className="text-xs text-slate-400">{fmtCurrency(cc.recommendedSalesPrice * 2.20462)} kg</div> : null}
                                                </td>
                                                <td className="px-4 py-2.5 text-right">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleEditCalculation(cc); }}
                                                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded transition-colors"
                                                            title="Edit Calculation"
                                                        >
                                                            <Pencil size={14} />
                                                        </button>
                                                        {onDeleteCalculation && (
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); if (confirm(`Delete cost calculation?`)) onDeleteCalculation(cc.id).then(ok => { if (ok) setDeletedCalcIds(prev => { const n = new Set(prev); n.add(cc.id); return n; }); }); }}
                                                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                                                title="Delete Calculation"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
            {step === 2 && stepMode === 'edit' && (
                <div className="space-y-4">
                    {/* Controls */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <button onClick={() => setStep(1)} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
                                <ChevronLeft size={16} /> Back to Source
                            </button>
                            <span className="text-sm text-slate-400">|</span>
                            <span className="text-sm font-medium text-slate-700">{calculations.length} item(s) from {selectedOfferIds.size} offer(s)</span>
                        </div>
                    </div>

                    {/* ─── Shared Route & Logistics ─── */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="px-5 py-3 bg-gradient-to-r from-indigo-50 to-slate-50 border-b border-slate-200">
                            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                                <Calculator size={16} className="text-indigo-500" />
                                Route, Logistics &amp; Import Costs
                                <span className="text-[10px] font-normal text-slate-400 normal-case tracking-normal ml-1">(applied to all items)</span>
                            </h3>
                        </div>
                        {/* Shared Route Info Strip */}
                        <div className="flex items-center gap-4 px-5 py-2.5 bg-blue-50/50 border-b border-slate-200 text-xs">
                            <div className="flex items-center gap-1.5">
                                <span className="font-bold text-slate-500 uppercase">Pickup:</span>
                                <span className="text-slate-700 font-medium">{calculations[0]?.loadingLocation || '—'}</span>
                            </div>
                            <span className="text-slate-300">|</span>
                            <div className="flex items-center gap-1.5">
                                <span className="font-bold text-slate-500 uppercase">POO:</span>
                                <span className="text-slate-700 font-medium">{calculations[0]?.originPort || '—'}</span>
                            </div>
                            <span className="text-slate-300">→</span>
                            <div className="flex items-center gap-1.5">
                                <span className="font-bold text-slate-500 uppercase">POD:</span>
                                <select value={calculations[0]?.destinationPort || ''} onChange={(e) => handlePodSelect(0, e.target.value)}
                                    className="bg-white border border-slate-300 rounded px-1.5 py-0.5 text-slate-700 font-medium text-xs outline-none focus:border-blue-400">
                                    <option value="">Select Port</option>
                                    {[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={`${p.name} (${p.code})`}>{p.name} ({p.code}) — {p.country}</option>)}
                                </select>
                                {calculations[0]?.freightAgentName && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-[10px] font-bold uppercase tracking-wide">
                                        🚢 {calculations[0].freightAgentName}
                                    </span>
                                )}
                            </div>
                            <span className="text-slate-300">|</span>
                            <div className="flex items-center gap-1.5">
                                <span className="font-bold text-slate-500 uppercase">Containers:</span>
                                <span className="bg-blue-100 text-blue-700 font-bold text-xs px-2 py-0.5 rounded">
                                    {Math.max(1, Math.ceil(lbsToKgs(calculations.reduce((a, c) => a + c.quantity, 0)) / 20000))}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                    ({fmt(lbsToKgs(calculations.reduce((a, c) => a + c.quantity, 0)), 0)} kg ÷ 20,000)
                                </span>
                            </div>
                            <span className="text-slate-300">|</span>
                            <div className="flex items-center gap-1.5">
                                <span className="font-bold text-slate-500 uppercase">Incoterm:</span>
                                <select value={calculations[0]?.incoterm || 'FOB'} onChange={(e) => { const v = e.target.value; setCalculations(prev => prev.map(c => recalcItem({ ...c, incoterm: v }))); }}
                                    className="bg-white border border-slate-300 rounded px-1.5 py-0.5 text-slate-700 font-bold text-xs outline-none focus:border-blue-400">
                                    {['EXW', 'FAS', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP'].map(ic => <option key={ic} value={ic}>{ic}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="p-5">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                {/* Pickup */}
                                <div className="rounded-lg p-3 border border-slate-100">
                                    <label className="text-xs font-semibold text-slate-600 block mb-1">Origin Pickup</label>
                                    <div className="flex items-center gap-1">
                                        <span className="text-slate-400 text-sm">$</span>
                                        <input type="text" inputMode="decimal"
                                            value={editingField === 'shared-pickupCost' ? editingValue : (sharedCosts.pickupCost ? fmt(sharedCosts.pickupCost) : '')}
                                            onFocus={() => { setEditingField('shared-pickupCost'); setEditingValue(sharedCosts.pickupCost ? String(sharedCosts.pickupCost) : ''); }}
                                            onChange={(e) => { const v = e.target.value.replace(/,/g, ''); if (v === '' || /^\d*\.?\d*$/.test(v)) setEditingValue(v); }}
                                            onBlur={() => { updateSharedCost('pickupCost', editingValue === '' ? 0 : parseFloat(editingValue) || 0); setEditingField(null); }}
                                            className="w-full text-lg font-bold text-slate-800 bg-transparent outline-none" placeholder="0.00" />
                                    </div>
                                </div>
                                {/* Ocean Freight */}
                                <div className="rounded-lg p-3 border border-slate-100">
                                    <label className="text-xs font-semibold text-slate-600 block mb-1">Ocean Freight</label>
                                    <div className="flex items-center gap-1">
                                        <span className="text-slate-400 text-sm">$</span>
                                        <input type="text" inputMode="decimal"
                                            value={editingField === 'shared-oceanFreight' ? editingValue : (sharedCosts.oceanFreight ? fmt(sharedCosts.oceanFreight) : '')}
                                            onFocus={() => { setEditingField('shared-oceanFreight'); setEditingValue(sharedCosts.oceanFreight ? String(sharedCosts.oceanFreight) : ''); }}
                                            onChange={(e) => { const v = e.target.value.replace(/,/g, ''); if (v === '' || /^\d*\.?\d*$/.test(v)) setEditingValue(v); }}
                                            onBlur={() => { updateSharedCost('oceanFreight', editingValue === '' ? 0 : parseFloat(editingValue) || 0); setEditingField(null); }}
                                            className="w-full text-lg font-bold text-slate-800 bg-transparent outline-none" placeholder="0.00" />
                                    </div>
                                </div>
                                {/* Delivery */}
                                <div className="rounded-lg p-3 border border-slate-100">
                                    <label className="text-xs font-semibold text-slate-600 block mb-1">Delivery Cost</label>
                                    <div className="flex items-center gap-1">
                                        <span className="text-slate-400 text-sm">$</span>
                                        <input type="text" inputMode="decimal"
                                            value={editingField === 'shared-deliveryCost' ? editingValue : (sharedCosts.deliveryCost ? fmt(sharedCosts.deliveryCost) : '')}
                                            onFocus={() => { setEditingField('shared-deliveryCost'); setEditingValue(sharedCosts.deliveryCost ? String(sharedCosts.deliveryCost) : ''); }}
                                            onChange={(e) => { const v = e.target.value.replace(/,/g, ''); if (v === '' || /^\d*\.?\d*$/.test(v)) setEditingValue(v); }}
                                            onBlur={() => { updateSharedCost('deliveryCost', editingValue === '' ? 0 : parseFloat(editingValue) || 0); setEditingField(null); }}
                                            className="w-full text-lg font-bold text-slate-800 bg-transparent outline-none" placeholder="0.00" />
                                    </div>
                                </div>
                                {/* Insurance */}
                                <div className="rounded-lg p-3 border border-slate-100">
                                    <label className="text-xs font-semibold text-slate-600 block mb-1">Insurance</label>
                                    <div className="flex items-center gap-1">
                                        <span className="text-slate-400 text-sm">$</span>
                                        <input type="text" inputMode="decimal"
                                            value={editingField === 'shared-insuranceCost' ? editingValue : (sharedCosts.insuranceCost ? fmt(sharedCosts.insuranceCost) : '')}
                                            onFocus={() => { setEditingField('shared-insuranceCost'); setEditingValue(sharedCosts.insuranceCost ? String(sharedCosts.insuranceCost) : ''); }}
                                            onChange={(e) => { const v = e.target.value.replace(/,/g, ''); if (v === '' || /^\d*\.?\d*$/.test(v)) setEditingValue(v); }}
                                            onBlur={() => { updateSharedCost('insuranceCost', editingValue === '' ? 0 : parseFloat(editingValue) || 0); setEditingField(null); }}
                                            className="w-full text-lg font-bold text-slate-800 bg-transparent outline-none" placeholder="0.00" />
                                    </div>
                                </div>
                                {/* Import Duty */}
                                <div className="rounded-lg p-3 border border-slate-100">
                                    <label className="text-xs font-semibold text-slate-600 block mb-1">Import Duty</label>
                                    <div className="flex items-center gap-1">
                                        <input type="text" inputMode="decimal"
                                            value={editingField === 'shared-dutyPercent' ? editingValue : (sharedCosts.dutyPercent ? fmt(sharedCosts.dutyPercent) : '')}
                                            onFocus={() => { setEditingField('shared-dutyPercent'); setEditingValue(sharedCosts.dutyPercent ? String(sharedCosts.dutyPercent) : ''); }}
                                            onChange={(e) => { const v = e.target.value.replace(/,/g, ''); if (v === '' || /^\d*\.?\d*$/.test(v)) setEditingValue(v); }}
                                            onBlur={() => { updateSharedCost('dutyPercent', editingValue === '' ? 0 : parseFloat(editingValue) || 0); setEditingField(null); }}
                                            className="w-full text-lg font-bold text-slate-800 bg-transparent outline-none" placeholder="0.00" />
                                        <span className="text-slate-400 text-sm">%</span>
                                    </div>
                                </div>
                                {/* Clearance */}
                                <div className="rounded-lg p-3 border border-slate-100">
                                    <label className="text-xs font-semibold text-slate-600 block mb-1">Clearance Fees</label>
                                    <div className="flex items-center gap-1">
                                        <span className="text-slate-400 text-sm">$</span>
                                        <input type="text" inputMode="decimal"
                                            value={editingField === 'shared-clearanceCost' ? editingValue : (sharedCosts.clearanceCost ? fmt(sharedCosts.clearanceCost) : '')}
                                            onFocus={() => { setEditingField('shared-clearanceCost'); setEditingValue(sharedCosts.clearanceCost ? String(sharedCosts.clearanceCost) : ''); }}
                                            onChange={(e) => { const v = e.target.value.replace(/,/g, ''); if (v === '' || /^\d*\.?\d*$/.test(v)) setEditingValue(v); }}
                                            onBlur={() => { updateSharedCost('clearanceCost', editingValue === '' ? 0 : parseFloat(editingValue) || 0); setEditingField(null); }}
                                            className="w-full text-lg font-bold text-slate-800 bg-transparent outline-none" placeholder="0.00" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Calculation Sheet — Cost Sheet Style */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse table-fixed min-w-[1100px]">
                                <thead className="bg-slate-100 sticky top-0 z-10 shadow-sm text-xs font-bold text-slate-600 uppercase tracking-wider">
                                    <tr>
                                        <th className="px-3 py-3 border-b border-r border-slate-200 text-center" style={{ width: 40 }}>#</th>
                                        <th className="px-3 py-3 border-b border-r border-slate-200" style={{ width: 200 }}>Product & Supplier</th>
                                        <th className="px-3 py-3 border-b border-r border-slate-200 text-right" style={{ width: 100 }}>Qty (LBS)</th>
                                        <th className="px-3 py-3 border-b border-r border-slate-200 text-right bg-blue-50/20 text-blue-700" style={{ width: 90 }}>Total Cost</th>
                                        <th className="px-3 py-3 border-b border-r border-slate-200 text-right bg-emerald-50/50 text-emerald-700" style={{ width: 80 }}>$/LB</th>
                                        <th className="px-3 py-3 border-b border-r border-slate-200 text-right bg-emerald-50/50 text-emerald-700" style={{ width: 80 }}>$/KG</th>
                                        <th className="px-3 py-3 border-b border-r border-slate-200 text-right bg-blue-50/20 text-blue-700" style={{ width: 80 }}>Freight</th>
                                        <th className="px-3 py-3 border-b border-r border-slate-200 text-right bg-cyan-50/50 text-cyan-700" style={{ width: 70 }}>INS+</th>
                                        <th className="px-3 py-3 border-b border-r border-slate-200 text-right bg-amber-50/50 text-amber-700" style={{ width: 80 }}>CLEAR+</th>
                                        <th className="px-3 py-3 border-b border-r border-slate-200 text-right bg-amber-50/50 text-amber-700" style={{ width: 70 }}>Duty</th>
                                        <th className="px-3 py-3 border-b border-slate-200 text-right bg-slate-200/50 text-slate-800" style={{ width: 130 }}>Unit Landed</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-sm">
                                    {calculations.map((calc, idx) => {
                                        const sysName = calc.systemProductName || calc.productName;
                                        return (
                                            <tr key={idx} className="group hover:bg-slate-50 transition-colors">
                                                <td className="px-3 py-0.5 border-r border-slate-100 text-center text-xs text-slate-400">{idx + 1}</td>
                                                <td className="px-3 py-0.5 border-r border-slate-100">
                                                    <span className="text-sm font-medium text-slate-800 block truncate">{sysName}</span>
                                                    <span className="text-[10px] text-slate-400 block truncate">{calc.supplierName}</span>
                                                </td>
                                                <td className="px-3 py-0.5 border-r border-slate-100 text-right">
                                                    <span className="font-mono text-slate-700 block">{calc.quantity.toLocaleString()}</span>
                                                    <span className="text-[10px] text-slate-400 block">{fmt(lbsToKgs(calc.quantity), 0)} kg</span>
                                                </td>
                                                <td className="px-3 py-0.5 border-r border-slate-100 text-right bg-blue-50/20">
                                                    <span className="font-mono text-slate-700 block">{fmtCurrency(calc.totalBase)}</span>
                                                </td>
                                                <td className="px-3 py-0.5 border-r border-slate-100 text-right bg-emerald-50/20">
                                                    <span className="font-mono font-bold text-emerald-700">${fmt(calc.unitPrice, 4)}</span>
                                                </td>
                                                <td className="px-3 py-0.5 border-r border-slate-100 text-right bg-emerald-50/20">
                                                    <span className="font-mono font-bold text-emerald-700">${fmt(pricePerKg(calc.unitPrice), 4)}</span>
                                                </td>
                                                <td className="px-3 py-0.5 border-r border-slate-100 text-right bg-blue-50/20">
                                                    <span className="font-mono text-slate-700">{fmtCurrency(calc.pickupCost + calc.oceanFreight + calc.deliveryCost)}</span>
                                                </td>
                                                <td className="px-3 py-0.5 border-r border-slate-100 text-right bg-cyan-50/20">
                                                    <span className="font-mono text-slate-700">{fmtCurrency(calc.insuranceCost)}</span>
                                                </td>
                                                <td className="px-3 py-0.5 border-r border-slate-100 text-right bg-amber-50/20">
                                                    <span className="font-mono text-slate-700">{fmtCurrency(calc.clearanceCost)}</span>
                                                </td>
                                                <td className="px-3 py-0.5 border-r border-slate-100 text-right bg-amber-50/20">
                                                    <span className="font-mono text-slate-700">{calc.dutyPercent > 0 ? `${fmt(calc.dutyPercent, 2)}%` : '0.00'}</span>
                                                </td>
                                                <td className="px-3 py-0.5 text-right bg-slate-100">
                                                    <span className="font-mono font-bold text-slate-700 block">${fmt(calc.unitLandedCost, 4)}/lb</span>
                                                    <span className="text-[10px] text-slate-400 block">${fmt(pricePerKg(calc.unitLandedCost), 4)}/kg</span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {calculations.length === 0 && (
                                        <tr><td colSpan={11} className="px-6 py-12 text-center text-slate-400 bg-slate-50/50">No items to calculate</td></tr>
                                    )}
                                </tbody>
                                {calculations.length > 1 && (
                                    <tfoot>
                                        <tr className="bg-slate-50 border-t-2 border-slate-300 text-sm font-bold">
                                            <td className="px-3 py-2 border-r border-slate-200"></td>
                                            <td className="px-3 py-2 border-r border-slate-200 text-xs uppercase text-slate-500">Totals</td>
                                            <td className="px-3 py-2 border-r border-slate-200 text-right">
                                                <span className="font-mono text-slate-700 block">{calculations.reduce((s, c) => s + c.quantity, 0).toLocaleString()}</span>
                                                <span className="text-[10px] text-slate-400 block">{fmt(lbsToKgs(calculations.reduce((s, c) => s + c.quantity, 0)), 0)} kg</span>
                                            </td>
                                            <td className="px-3 py-2 border-r border-slate-200 text-right bg-blue-50/20 font-mono text-slate-800">{fmtCurrency(calculations.reduce((s, c) => s + c.totalBase, 0))}</td>
                                            <td className="px-3 py-2 border-r border-slate-200 bg-emerald-50/20"></td>
                                            <td className="px-3 py-2 border-r border-slate-200 bg-emerald-50/20"></td>
                                            <td className="px-3 py-2 border-r border-slate-200 text-right bg-blue-50/20 font-mono text-blue-700">{fmtCurrency(calculations.reduce((s, c) => s + c.pickupCost + c.oceanFreight + c.deliveryCost, 0))}</td>
                                            <td className="px-3 py-2 border-r border-slate-200 text-right bg-cyan-50/20 font-mono text-cyan-700">{fmtCurrency(calculations.reduce((s, c) => s + c.insuranceCost, 0))}</td>
                                            <td className="px-3 py-2 border-r border-slate-200 text-right bg-amber-50/20 font-mono text-amber-700">{fmtCurrency(calculations.reduce((s, c) => s + c.clearanceCost, 0))}</td>
                                            <td className="px-3 py-2 border-r border-slate-200"></td>
                                            <td className="px-3 py-2 text-right bg-slate-100">
                                                <span className="font-mono font-bold text-slate-800 block text-base">{fmtCurrency(calculations.reduce((s, c) => s + c.totalLandedCost, 0))}</span>
                                            </td>
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>
                        <div className="bg-slate-50 border-t border-slate-200 p-2 flex justify-between items-center text-xs text-slate-500">
                            <span>Showing {calculations.length} items</span>
                        </div>
                    </div>

                    {/* Navigation */}
                    <div className="flex justify-between items-center pt-2">
                        <button onClick={() => setStep(1)} className="flex items-center gap-2 px-5 py-3 bg-slate-100 text-slate-700 rounded-xl font-semibold hover:bg-slate-200 transition-colors">
                            <ChevronLeft size={18} /> Back
                        </button>
                        <button
                            onClick={goToStep3}
                            disabled={calculations.every(c => c.totalLandedCost === c.totalBase && c.totalBase === 0)}
                            className="flex items-center gap-2 px-6 py-3 bg-rose-600 text-white rounded-xl font-semibold hover:bg-rose-700 transition-colors shadow-lg shadow-rose-200"
                        >
                            Next: Price & Save <ChevronRight size={18} />
                        </button>
                    </div>
                </div>
            )
            }

            {/* ====================== STEP 3: PRICE ====================== */}
            {step === 3 && stepMode === 'view' && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                            <DollarSign size={16} className="text-emerald-500" /> Saved Price List
                        </h3>
                        <div className="flex items-center gap-2">
                            {selectedCalcIds.size > 0 && onDeleteCalculation && (
                                <button
                                    onClick={async () => {
                                        if (!confirm(`Delete ${selectedCalcIds.size} selected pricing(s)?`)) return;
                                        for (const id of selectedCalcIds) {
                                            const ok = await onDeleteCalculation(id);
                                            if (ok) setDeletedCalcIds(prev => { const n = new Set(prev); n.add(id); return n; });
                                        }
                                        setSelectedCalcIds(new Set());
                                    }}
                                    className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-semibold hover:bg-red-600 transition-all shadow-md"
                                >
                                    <Trash2 size={14} /> Delete ({selectedCalcIds.size})
                                </button>
                            )}
                            <button
                                onClick={() => {
                                    setEditingCalcId(null);
                                    setStepMode('edit');
                                }}
                                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-lg text-sm font-semibold hover:from-emerald-700 hover:to-teal-700 transition-all shadow-md"
                            >
                                <Plus size={16} /> New Pricing
                            </button>
                        </div>
                    </div>
                    {(() => {
                        const pricedCalcs = costCalculations.filter(cc => !deletedCalcIds.has(cc.id));
                        return pricedCalcs.length === 0 ? (
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
                                <DollarSign size={36} className="mx-auto text-slate-300 mb-3" />
                                <p className="text-slate-400 text-sm">No saved pricing records yet</p>
                                <p className="text-slate-300 text-xs mt-1">Complete calculations and pricing to see saved records here</p>
                            </div>
                        ) : (
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-200">
                                            <th className="px-3 py-3 text-center w-10">
                                                <input
                                                    type="checkbox"
                                                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                                    checked={pricedCalcs.length > 0 && pricedCalcs.every(c => selectedCalcIds.has(c.id))}
                                                    onChange={(e) => {
                                                        const next = new Set(selectedCalcIds);
                                                        if (e.target.checked) pricedCalcs.forEach(c => next.add(c.id));
                                                        else pricedCalcs.forEach(c => next.delete(c.id));
                                                        setSelectedCalcIds(next);
                                                    }}
                                                />
                                            </th>
                                            <th className="px-4 py-3 text-left font-semibold text-slate-600">System Product Name</th>
                                            <th className="px-4 py-3 text-left font-semibold text-slate-600">Supplier</th>
                                            <th className="px-4 py-3 text-right font-semibold text-slate-600">Unit Cost</th>
                                            <th className="px-4 py-3 text-right font-semibold text-slate-600">Margin %</th>
                                            <th className="px-4 py-3 text-right font-semibold text-slate-600">Sale $/lb</th>
                                            <th className="px-4 py-3 text-right font-semibold text-slate-600">Sale $/kg</th>
                                            <th className="px-4 py-3 text-right font-semibold text-slate-600">Profit/lb</th>
                                            <th className="px-4 py-3 text-right font-semibold text-slate-600">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {pricedCalcs.map((cc) => {
                                            const profitPerLb = cc.recommendedSalesPrice - cc.unitLandedCost;
                                            const sysName = (cc as any).systemProductName || (() => { const mp = products.find(p => p.supplierProductName === cc.productName || p.name === cc.productName); return mp?.name; })() || cc.productName;
                                            return (
                                                <tr key={cc.id} className={`border-b border-slate-100 hover:bg-slate-50/50 ${selectedCalcIds.has(cc.id) ? 'bg-emerald-50/50' : ''}`}>
                                                    <td className="px-3 py-2.5 text-center w-10">
                                                        <input
                                                            type="checkbox"
                                                            className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                                            checked={selectedCalcIds.has(cc.id)}
                                                            onChange={(e) => {
                                                                const next = new Set(selectedCalcIds);
                                                                if (e.target.checked) next.add(cc.id); else next.delete(cc.id);
                                                                setSelectedCalcIds(next);
                                                            }}
                                                        />
                                                    </td>
                                                    <td className="px-4 py-2.5 font-medium text-slate-800">{sysName}</td>
                                                    <td className="px-4 py-2.5 text-slate-600">{firstName(cc.supplierName || '')}</td>
                                                    <td className="px-4 py-2.5 text-right text-slate-600">{fmtCurrency(cc.unitLandedCost)}</td>
                                                    <td className="px-4 py-2.5 text-right font-bold text-indigo-600">{fmt(cc.marginPercent, 1)}%</td>
                                                    <td className="px-4 py-2.5 text-right font-bold text-slate-800">{fmtCurrency(cc.recommendedSalesPrice)}</td>
                                                    <td className="px-4 py-2.5 text-right text-slate-600">{fmtCurrency(pricePerKg(cc.recommendedSalesPrice))}</td>
                                                    <td className={`px-4 py-2.5 text-right font-bold ${profitPerLb >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmtCurrency(profitPerLb)}</td>
                                                    <td className="px-4 py-2.5 text-right">
                                                        <div className="flex items-center justify-end gap-1">
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleEditCalculation(cc); }}
                                                                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded transition-colors"
                                                                title="Edit Pricing"
                                                            >
                                                                <Pencil size={14} />
                                                            </button>
                                                            {onDeleteCalculation && (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); if (confirm(`Delete cost calculation?`)) onDeleteCalculation(cc.id).then(ok => { if (ok) setDeletedCalcIds(prev => { const n = new Set(prev); n.add(cc.id); return n; }); }); }}
                                                                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                                                    title="Delete Pricing"
                                                                >
                                                                    <Trash2 size={14} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        );
                    })()}
                </div>
            )}
            {
                step === 3 && stepMode === 'edit' && (
                    <div className="space-y-4">
                        {/* Controls */}
                        <div className="flex items-center justify-between">
                            <button onClick={() => setStep(2)} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
                                <ChevronLeft size={16} /> Back to Calculate
                            </button>
                        </div>

                        {/* Summary Table */}
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-200">
                                        <th className="px-4 py-3 text-left font-semibold text-slate-600">System Product Name</th>
                                        <th className="px-4 py-3 text-left font-semibold text-slate-600">Supplier</th>
                                        <th className="px-4 py-3 text-right font-semibold text-slate-600">Qty (lbs)</th>
                                        <th className="px-4 py-3 text-right font-semibold text-slate-600">Qty (kg)</th>
                                        <th className="px-4 py-3 text-right font-semibold text-slate-600">Unit Cost</th>
                                        <th className="px-4 py-3 text-right font-semibold text-slate-600">Total Cost</th>
                                        <th className="px-4 py-3 text-center font-semibold text-slate-600">Margin %</th>
                                        <th className="px-4 py-3 text-right font-semibold text-slate-600">Sale Price/lb</th>
                                        <th className="px-4 py-3 text-right font-semibold text-slate-600">Sale Price/kg</th>
                                        <th className="px-4 py-3 text-right font-semibold text-slate-600">Profit/lb</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {calculations.map((calc, idx) => {
                                        const sysName2 = calc.systemProductName || calc.productName;
                                        return (
                                            <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                                                <td className="px-4 py-3 font-medium text-slate-800">{sysName2}</td>
                                                <td className="px-4 py-3 text-slate-600">{firstName(calc.supplierName || '')}</td>
                                                <td className="px-4 py-3 text-right text-slate-700">{calc.quantity.toLocaleString()}</td>
                                                <td className="px-4 py-3 text-right text-slate-700">{fmt(lbsToKgs(calc.quantity), 0)}</td>
                                                <td className="px-4 py-3 text-right font-semibold text-slate-800">${fmt(calc.unitLandedCost, 4)}</td>
                                                <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmtCurrency(calc.totalLandedCost)}</td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <input
                                                            type="number"
                                                            value={calc.marginPercent}
                                                            onChange={(e) => updateMargin(idx, parseFloat(e.target.value) || 0)}
                                                            className="w-16 text-center py-1 border border-slate-200 rounded text-sm font-semibold focus:ring-2 focus:ring-rose-300 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                        />
                                                        <span className="text-slate-400 text-xs">%</span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <span className="text-slate-400 text-xs">$</span>
                                                        <input
                                                            type="text" inputMode="decimal"
                                                            value={editingField === `${idx}-salePriceLb` ? editingValue : fmt(calc.salePrice, 4)}
                                                            onFocus={() => { setEditingField(`${idx}-salePriceLb`); setEditingValue(calc.salePrice ? String(Math.round(calc.salePrice * 10000) / 10000) : ''); }}
                                                            onChange={(e) => { const v = e.target.value.replace(/,/g, ''); if (v === '' || /^\d*\.?\d*$/.test(v)) setEditingValue(v); }}
                                                            onBlur={() => { updateSalePriceLb(idx, editingValue === '' ? 0 : parseFloat(editingValue) || 0); setEditingField(null); }}
                                                            className="w-20 text-right py-1 border border-slate-200 rounded text-sm font-bold text-emerald-700 focus:ring-2 focus:ring-emerald-300 outline-none"
                                                        />
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <span className="text-slate-400 text-xs">$</span>
                                                        <input
                                                            type="text" inputMode="decimal"
                                                            value={editingField === `${idx}-salePriceKg` ? editingValue : fmt(pricePerKg(calc.salePrice), 4)}
                                                            onFocus={() => { setEditingField(`${idx}-salePriceKg`); setEditingValue(pricePerKg(calc.salePrice) ? String(Math.round(pricePerKg(calc.salePrice) * 10000) / 10000) : ''); }}
                                                            onChange={(e) => { const v = e.target.value.replace(/,/g, ''); if (v === '' || /^\d*\.?\d*$/.test(v)) setEditingValue(v); }}
                                                            onBlur={() => { updateSalePriceKg(idx, editingValue === '' ? 0 : parseFloat(editingValue) || 0); setEditingField(null); }}
                                                            className="w-20 text-right py-1 border border-slate-200 rounded text-sm font-bold text-emerald-700 focus:ring-2 focus:ring-emerald-300 outline-none"
                                                        />
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-right font-bold text-emerald-600">${fmt(calc.profitPerUnit, 4)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot>
                                    <tr className="bg-slate-50 border-t-2 border-slate-200">
                                        <td colSpan={5} className="px-4 py-3 font-bold text-slate-700">Totals</td>
                                        <td className="px-4 py-3 text-right font-bold text-slate-800">{fmtCurrency(calculations.reduce((s, c) => s + c.totalLandedCost, 0))}</td>
                                        <td></td>
                                        <td className="px-4 py-3 text-right font-bold text-emerald-700">{fmtCurrency(calculations.reduce((s, c) => s + (c.salePrice * c.quantity), 0))}</td>
                                        <td></td>
                                        <td className="px-4 py-3 text-right font-bold text-emerald-600">{fmtCurrency(calculations.reduce((s, c) => s + (c.profitPerUnit * c.quantity), 0))}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>

                        {/* Margin Reasoning Cards */}
                        {calculations.some(c => c.marginReasoning) && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {calculations.filter(c => c.marginReasoning).map((calc, idx) => (
                                    <div key={idx} className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                                        <div className="flex items-center gap-2 mb-1">
                                            <Sparkles size={14} className="text-blue-500" />
                                            <span className="text-xs font-semibold text-blue-700">{calc.productName} — {calc.marginPercent}% margin</span>
                                        </div>
                                        <p className="text-xs text-slate-600">{calc.marginReasoning}</p>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Save Actions */}
                        <div className="flex items-center justify-between pt-2">
                            <button onClick={() => setStep(2)} className="flex items-center gap-2 px-5 py-3 bg-slate-100 text-slate-700 rounded-xl font-semibold hover:bg-slate-200 transition-colors">
                                <ChevronLeft size={18} /> Back
                            </button>
                            <div className="flex items-center gap-3">
                                {saveStatus === 'saved' && (
                                    <div className="flex items-center gap-2 text-emerald-600 text-sm font-semibold">
                                        <CheckCircle2 size={18} />
                                        {savedCount} calculation(s) saved!
                                    </div>
                                )}
                                {saveStatus === 'error' && (
                                    <div className="flex items-center gap-2 text-red-500 text-sm font-semibold">
                                        <AlertTriangle size={18} />
                                        Save failed
                                    </div>
                                )}
                                <button
                                    onClick={handleSaveAll}
                                    disabled={saveStatus === 'saving' || calculations.length === 0}
                                    className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-200 disabled:opacity-50"
                                >
                                    {saveStatus === 'saving' ? (
                                        <><Loader2 size={18} className="animate-spin" /> Saving...</>
                                    ) : (
                                        <><Save size={18} /> Save All Calculations</>
                                    )}
                                </button>
                                {saveStatus === 'saved' && onSaveSalesOrder && (
                                    <button
                                        onClick={() => {
                                            // Auto-populate from calculations
                                            if (calculations.length > 0) {
                                                const c = calculations[0];
                                                // Port dropdown options use "Name (CODE)" format.  
                                                // calculations[].originPort / destinationPort are already in that format from Step 2.
                                                // Fallback: match by name or code substring if exact match fails.
                                                const matchPort = (val: string) => {
                                                    if (!val) return '';
                                                    // Check if value already matches an option exactly
                                                    const exact = ports.find(p => `${p.name} (${p.code})` === val);
                                                    if (exact) return `${exact.name} (${exact.code})`;
                                                    // Fuzzy: match by name or code
                                                    const byName = ports.find(p => p.name.toLowerCase() === val.toLowerCase());
                                                    if (byName) return `${byName.name} (${byName.code})`;
                                                    const byCode = ports.find(p => p.code.toLowerCase() === val.toLowerCase());
                                                    if (byCode) return `${byCode.name} (${byCode.code})`;
                                                    // Contains match
                                                    const contains = ports.find(p => val.toLowerCase().includes(p.name.toLowerCase()) || val.toLowerCase().includes(p.code.toLowerCase()));
                                                    if (contains) return `${contains.name} (${contains.code})`;
                                                    return val; // return as-is if no match
                                                };
                                                setOrderPoa(matchPort(c.originPort));
                                                setOrderPod(matchPort(c.destinationPort));
                                                setOrderSaleType(c.incoterm === 'EXW' ? 'LOCAL' : 'EXPORT');
                                                setOrderIncoterm(c.incoterm || 'FOB');
                                                setOrderDeliveryMethod(c.incoterm === 'EXW' ? 'PICKUP' : 'PORT_TO_PORT');
                                                // Auto-fill pickup location from supplier
                                                const supName = c.supplierName || selectedOffers[0]?.supplierName || '';
                                                const sup = supName ? suppliers.find(s => s.name.toLowerCase() === supName.toLowerCase()) : null;
                                                if (sup) {
                                                    if (sup.pickupLocation) {
                                                        setOrderPickupLocation(sup.pickupLocation);
                                                    } else {
                                                        const parts = [sup.location, sup.city, sup.state, sup.country].filter(Boolean);
                                                        if (parts.length > 0) setOrderPickupLocation(parts.join(', '));
                                                    }
                                                } else if (selectedOffers[0]?.loadingLocation) {
                                                    setOrderPickupLocation(selectedOffers[0].loadingLocation);
                                                }
                                            }
                                            setStepMode('edit');
                                            setStep(4);
                                        }}
                                        className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-semibold hover:from-indigo-700 hover:to-purple-700 transition-all shadow-lg shadow-indigo-200"
                                    >
                                        Next: Create Order <ChevronRight size={18} />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )
            }
            {/* ====================== STEP 4: SALES ORDER ====================== */}
            {step === 4 && stepMode === 'view' && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                            <ShoppingBag size={16} className="text-purple-500" /> Saved Orders
                        </h3>
                        <button
                            onClick={() => setStepMode('edit')}
                            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg text-sm font-semibold hover:from-indigo-700 hover:to-purple-700 transition-all shadow-md"
                        >
                            <Plus size={16} /> New Order
                        </button>
                    </div>
                    {/* Search bar */}
                    <div className="flex items-center gap-3 flex-wrap">
                        <div className="relative flex-1 min-w-[200px]">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Search orders..."
                                value={orderSearch}
                                onChange={(e) => setOrderSearch(e.target.value)}
                                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white"
                            />
                        </div>
                    </div>
                    {(() => {
                        const filtered = salesOrders
                            .filter(so => {
                                const q = orderSearch.toLowerCase();
                                if (q && !(
                                    (so.orderNumber || '').toLowerCase().includes(q) ||
                                    (so.customerName || '').toLowerCase().includes(q) ||
                                    (so.incoterm || '').toLowerCase().includes(q) ||
                                    (so.status || '').toLowerCase().includes(q)
                                )) return false;
                                if (orderCustomerFilter && so.customerName !== orderCustomerFilter) return false;
                                if (orderStatusFilter && so.status !== orderStatusFilter) return false;
                                return true;
                            })
                            .sort((a, b) => {
                                const da = a.orderDate || '';
                                const db = b.orderDate || '';
                                return db.localeCompare(da);
                            });
                        return filtered.length === 0 ? (
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
                                <ShoppingBag size={36} className="mx-auto text-slate-300 mb-3" />
                                <p className="text-slate-400 text-sm">{salesOrders.length === 0 ? 'No saved orders yet' : 'No orders match your filters'}</p>
                                <p className="text-slate-300 text-xs mt-1">{salesOrders.length === 0 ? 'Complete pricing and create an order to see saved records here' : 'Try adjusting your search or filters'}</p>
                            </div>
                        ) : (
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-200">
                                            <th className="px-4 py-2 text-left font-semibold text-slate-600 text-xs">Date</th>
                                            <th className="px-4 py-2 text-left font-semibold text-slate-600 text-xs">Order #</th>
                                            <th className="px-4 py-2 text-left font-semibold text-slate-600 text-xs">
                                                <div className="flex items-center gap-1">
                                                    <span>Customer</span>
                                                    <div className="relative">
                                                        <select
                                                            value={orderCustomerFilter}
                                                            onChange={(e) => setOrderCustomerFilter(e.target.value)}
                                                            className={`appearance-none w-5 h-5 cursor-pointer bg-transparent border-none outline-none text-transparent ${orderCustomerFilter ? 'text-indigo-600' : ''}`}
                                                            title="Filter by customer"
                                                            style={{ WebkitAppearance: 'none' }}
                                                        >
                                                            <option value="">All</option>
                                                            {[...new Set(salesOrders.map(so => so.customerName).filter(Boolean))].sort().map(c => (
                                                                <option key={c} value={c}>{c}</option>
                                                            ))}
                                                        </select>
                                                        <Filter size={12} className={`absolute left-0.5 top-0.5 pointer-events-none ${orderCustomerFilter ? 'text-indigo-600' : 'text-slate-400'}`} />
                                                    </div>
                                                </div>
                                            </th>
                                            <th className="px-4 py-2 text-left font-semibold text-slate-600 text-xs">Type</th>
                                            <th className="px-4 py-2 text-left font-semibold text-slate-600 text-xs">
                                                <div className="flex items-center gap-1">
                                                    <span>Status</span>
                                                    <div className="relative">
                                                        <select
                                                            value={orderStatusFilter}
                                                            onChange={(e) => setOrderStatusFilter(e.target.value)}
                                                            className={`appearance-none w-5 h-5 cursor-pointer bg-transparent border-none outline-none text-transparent ${orderStatusFilter ? 'text-indigo-600' : ''}`}
                                                            title="Filter by status"
                                                            style={{ WebkitAppearance: 'none' }}
                                                        >
                                                            <option value="">All</option>
                                                            {[...new Set(salesOrders.map(so => so.status).filter(Boolean))].sort().map(s => (
                                                                <option key={s} value={s}>{s}</option>
                                                            ))}
                                                        </select>
                                                        <Filter size={12} className={`absolute left-0.5 top-0.5 pointer-events-none ${orderStatusFilter ? 'text-indigo-600' : 'text-slate-400'}`} />
                                                    </div>
                                                </div>
                                            </th>
                                            <th className="px-4 py-2 text-left font-semibold text-slate-600 text-xs">Incoterm</th>
                                            <th className="px-4 py-2 text-right font-semibold text-slate-600 text-xs">Items</th>
                                            <th className="px-4 py-2 text-right font-semibold text-slate-600 text-xs">Total</th>
                                            <th className="px-4 py-2 text-center font-semibold text-slate-600 text-xs">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filtered.map((so) => (
                                            <React.Fragment key={so.id}>
                                                <tr className="border-b border-slate-100 hover:bg-slate-50/50">
                                                    <td className="px-4 py-2.5 text-slate-500 text-xs whitespace-nowrap">{so.orderDate}</td>
                                                    <td className="px-4 py-2.5 font-mono text-xs text-indigo-600 font-bold">{so.orderNumber}</td>
                                                    <td className="px-4 py-2.5 font-medium text-slate-800">{firstName(so.customerName)}</td>
                                                    <td className="px-4 py-2.5">
                                                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold ${so.orderType === 'SPOT' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                                                            {so.orderType}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-2.5">
                                                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold ${so.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' :
                                                            so.status === 'FULFILLED' ? 'bg-blue-100 text-blue-700' :
                                                                so.status === 'BOOKED' ? 'bg-cyan-100 text-cyan-700' :
                                                                    so.status === 'REJECTED' ? 'bg-red-100 text-red-700' :
                                                                        'bg-slate-100 text-slate-600'
                                                            }`}>
                                                            {so.status}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-2.5 text-slate-500">{so.incoterm}</td>
                                                    <td className="px-4 py-2.5 text-right text-slate-600">{(so.items || []).length}</td>
                                                    <td className="px-4 py-2.5 text-right font-bold text-slate-800">{fmtCurrency(so.totalAmount)}</td>
                                                    <td className="px-4 py-2.5 text-center">
                                                        <div className="flex items-center justify-center gap-1">
                                                            <button title="View" onClick={() => setViewingOrderId(viewingOrderId === so.id ? null : so.id)} className={`p-1.5 rounded-md hover:bg-indigo-50 transition-colors ${viewingOrderId === so.id ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400 hover:text-indigo-600'}`}>
                                                                <Eye size={14} />
                                                            </button>
                                                            <button title="Book to Logistics" onClick={async () => {
                                                                if (onUpdateSalesOrder && so.status !== 'BOOKED') {
                                                                    await onUpdateSalesOrder(so.id, { status: 'BOOKED' });
                                                                }
                                                                // Populate calculations from order items for the Logistics step
                                                                setCreatedOrderNumber(so.orderNumber || '');
                                                                setOrderIncoterm(so.incoterm || 'FOB');
                                                                setOrderDeliveryMethod(so.deliveryMethod || 'PORT_TO_PORT');
                                                                setOrderPoa(so.poa || '');
                                                                setOrderPod(so.pod || '');
                                                                setSelectedCustomerId(so.customerId || '');
                                                                const calcs: ItemCalculation[] = (so.items || []).map(item => {
                                                                    const pn = (item.productName || '').toLowerCase();
                                                                    const matchedProd = products.find(p => {
                                                                        const nm = p.name.toLowerCase();
                                                                        const sk = (p.sku || '').toLowerCase();
                                                                        return (sk && pn.includes(sk)) || pn.includes(nm) || nm.includes(pn);
                                                                    });
                                                                    return {
                                                                        offerId: '', offerNumber: '',
                                                                        supplierName: matchedProd?.supplier || '',
                                                                        productName: item.productName || '',
                                                                        quantity: item.quantity || 0,
                                                                        unitPrice: item.unitPrice || 0,
                                                                        currency: so.currency || 'USD',
                                                                        incoterm: so.incoterm || 'FOB',
                                                                        originPort: so.poa || '',
                                                                        destinationPort: so.pod || '',
                                                                        loadingLocation: (() => {
                                                                            const sup = matchedProd?.supplier ? suppliers.find(s => s.name === matchedProd.supplier) : null;
                                                                            return sup?.pickupLocation || sup?.location || so.pickupLocation || '';
                                                                        })(),
                                                                        containerCount: 0,
                                                                        pickupCost: 0, oceanFreight: 0, deliveryCost: 0,
                                                                        insuranceCost: 0, dutyPercent: 0, clearanceCost: 0,
                                                                        sources: {},
                                                                        totalBase: (item.unitPrice || 0) * (item.quantity || 0),
                                                                        totalLogistics: 0, totalImportFees: 0,
                                                                        totalLandedCost: (item.unitPrice || 0) * (item.quantity || 0),
                                                                        unitLandedCost: item.unitPrice || 0,
                                                                        aiInsight: '',
                                                                        marginPercent: 0,
                                                                        salePrice: item.unitPrice || 0,
                                                                        profitPerUnit: 0,
                                                                        marginReasoning: ''
                                                                    };
                                                                });
                                                                setCalculations(calcs);
                                                                setStep(5);
                                                            }} className={`p-1.5 rounded-md transition-colors ${so.status === 'BOOKED' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'}`}>
                                                                <Ship size={14} />
                                                            </button>
                                                            <button title="Edit" onClick={() => {
                                                                // Load the saved order into the edit form
                                                                setSelectedCustomerId(so.customerId || '');
                                                                setOrderType(so.orderType || 'SPOT');
                                                                setOrderDate(so.orderDate || new Date().toISOString().split('T')[0]);
                                                                setOrderSaleType(so.saleType || 'EXPORT');
                                                                setOrderIncoterm(so.incoterm || 'FOB');
                                                                setOrderDeliveryMethod(so.deliveryMethod || 'PORT_TO_PORT');
                                                                setOrderPaymentTerms(so.paymentTerms || 'NET 30');
                                                                setOrderBankId(so.bankId || '');
                                                                setOrderDeliveryDate(so.deliveryDate || '');
                                                                setOrderDeliveryAddress(so.deliveryAddress || '');
                                                                setOrderPod(so.pod || '');
                                                                setOrderPoa(so.poa || '');
                                                                setOrderPickupLocation(so.pickupLocation || '');
                                                                setOrderNotes(so.notes || '');
                                                                setOrderSaveStatus('idle');
                                                                setCreatedOrderNumber(so.orderNumber || '');
                                                                // Populate calculations from order items
                                                                const calcs: ItemCalculation[] = (so.items || []).map(item => {
                                                                    const pn = (item.productName || '').toLowerCase();
                                                                    const matchedProd = products.find(p => {
                                                                        const nm = p.name.toLowerCase();
                                                                        const sk = (p.sku || '').toLowerCase();
                                                                        return (sk && pn.includes(sk)) || pn.includes(nm) || nm.includes(pn);
                                                                    });
                                                                    const sup = matchedProd?.supplier ? suppliers.find(s => s.name === matchedProd.supplier) : null;
                                                                    return {
                                                                        offerId: '', offerNumber: '',
                                                                        supplierName: matchedProd?.supplier || '',
                                                                        productName: item.productName || '',
                                                                        quantity: item.quantity || 0,
                                                                        unitPrice: item.unitPrice || 0,
                                                                        currency: so.currency || 'USD',
                                                                        incoterm: so.incoterm || 'FOB',
                                                                        originPort: so.poa || '',
                                                                        destinationPort: so.pod || '',
                                                                        loadingLocation: sup?.pickupLocation || sup?.location || so.pickupLocation || '',
                                                                        containerCount: 0,
                                                                        pickupCost: 0, oceanFreight: 0, deliveryCost: 0,
                                                                        insuranceCost: 0, dutyPercent: 0, clearanceCost: 0,
                                                                        sources: {},
                                                                        totalBase: item.unitPrice * item.quantity,
                                                                        totalLogistics: 0, totalImportFees: 0,
                                                                        totalLandedCost: item.unitPrice * item.quantity,
                                                                        unitLandedCost: item.unitPrice,
                                                                        aiInsight: '',
                                                                        marginPercent: 0,
                                                                        salePrice: item.unitPrice || 0,
                                                                        profitPerUnit: 0,
                                                                        marginReasoning: ''
                                                                    };
                                                                });
                                                                setCalculations(calcs);
                                                                setStep(4);
                                                                setStepMode('edit');
                                                            }} className="p-1.5 rounded-md hover:bg-amber-50 text-slate-400 hover:text-amber-600 transition-colors">
                                                                <Pencil size={14} />
                                                            </button>
                                                            <button title="Delete" onClick={async () => {
                                                                if (!onDeleteSalesOrder) return;
                                                                if (!window.confirm(`Delete order ${so.orderNumber}? This cannot be undone.`)) return;
                                                                await onDeleteSalesOrder(so.id);
                                                            }} className="p-1.5 rounded-md hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                                {viewingOrderId === so.id && (
                                                    <tr className="bg-indigo-50/40">
                                                        <td colSpan={9} className="px-6 py-4">
                                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                                                                <div>
                                                                    <span className="font-bold text-slate-500 uppercase text-[10px]">Sale Type</span>
                                                                    <p className="text-slate-800 font-semibold">{so.saleType || '—'}</p>
                                                                </div>
                                                                <div>
                                                                    <span className="font-bold text-slate-500 uppercase text-[10px]">Delivery</span>
                                                                    <p className="text-slate-800 font-semibold">{(so.deliveryMethod || '—').replace(/_/g, ' ')}</p>
                                                                </div>
                                                                <div>
                                                                    <span className="font-bold text-slate-500 uppercase text-[10px]">Payment</span>
                                                                    <p className="text-slate-800 font-semibold">{so.paymentTerms || '—'}</p>
                                                                </div>
                                                                <div>
                                                                    <span className="font-bold text-slate-500 uppercase text-[10px]">Currency</span>
                                                                    <p className="text-slate-800 font-semibold">{so.currency || 'USD'}</p>
                                                                </div>
                                                                {so.poa && <div><span className="font-bold text-slate-500 uppercase text-[10px]">POA</span><p className="text-slate-800 font-semibold">{so.poa}</p></div>}
                                                                {so.pod && <div><span className="font-bold text-slate-500 uppercase text-[10px]">POD</span><p className="text-slate-800 font-semibold">{so.pod}</p></div>}
                                                                {so.deliveryDate && <div><span className="font-bold text-slate-500 uppercase text-[10px]">Delivery Date</span><p className="text-slate-800 font-semibold">{so.deliveryDate}</p></div>}
                                                                {so.notes && <div className="col-span-2"><span className="font-bold text-slate-500 uppercase text-[10px]">Notes</span><p className="text-slate-700">{so.notes}</p></div>}
                                                            </div>
                                                            {(so.items || []).length > 0 && (
                                                                <div className="mt-3 border-t border-indigo-100 pt-3">
                                                                    <span className="font-bold text-slate-500 uppercase text-[10px] mb-1 block">Line Items</span>
                                                                    <table className="w-full text-xs">
                                                                        <thead>
                                                                            <tr className="text-slate-500">
                                                                                <th className="text-left py-1 font-semibold">Product</th>
                                                                                <th className="text-left py-1 font-semibold">System Description</th>
                                                                                <th className="text-right py-1 font-semibold">Qty (lbs)</th>
                                                                                <th className="text-right py-1 font-semibold">Qty (kg)</th>
                                                                                <th className="text-right py-1 font-semibold">Unit Price /lb</th>
                                                                                <th className="text-right py-1 font-semibold">Unit Price /kg</th>
                                                                                <th className="text-right py-1 font-semibold">Total</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {so.items.map((item, idx) => {
                                                                                const matchedProduct = products.find(p => p.id === item.productId);
                                                                                const qtyKg = item.quantity ? item.quantity / 2.20462 : 0;
                                                                                const unitPriceKg = item.unitPrice ? item.unitPrice * 2.20462 : 0;
                                                                                return (
                                                                                    <tr key={idx} className="border-t border-indigo-50">
                                                                                        <td className="py-1 text-slate-800 font-medium">{item.productName}</td>
                                                                                        <td className="py-1 text-slate-500 text-[11px]">{matchedProduct?.description || '—'}</td>
                                                                                        <td className="py-1 text-right text-slate-600">{item.quantity?.toLocaleString()}</td>
                                                                                        <td className="py-1 text-right text-slate-600">{qtyKg.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                                                                                        <td className="py-1 text-right text-slate-600">{fmtCurrency(item.unitPrice)}</td>
                                                                                        <td className="py-1 text-right text-slate-600">{fmtCurrency(unitPriceKg)}</td>
                                                                                        <td className="py-1 text-right font-bold text-slate-800">{fmtCurrency(item.total)}</td>
                                                                                    </tr>
                                                                                );
                                                                            })}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            )}
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        );
                    })()}
                </div>
            )
            }
            {
                step === 4 && stepMode === 'edit' && (
                    <div className="space-y-6">
                        {/* Controls */}
                        <div className="flex items-center justify-between">
                            <button onClick={() => setStep(3)} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
                                <ChevronLeft size={16} /> Back to Price
                            </button>
                        </div>

                        {/* ─── Row 1: Customer + Order Type + Date ─── */}
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                                <Users size={16} className="text-indigo-500" /> Order Details
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {/* Customer */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Customer</label>
                                    <select
                                        value={selectedCustomerId}
                                        onChange={(e) => setSelectedCustomerId(e.target.value)}
                                        className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-300 outline-none"
                                    >
                                        <option value="">Select Customer...</option>
                                        {customers.map(c => (
                                            <option key={c.id} value={c.id}>{c.name}{c.city ? ` — ${c.city}` : ''}</option>
                                        ))}
                                    </select>
                                </div>
                                {/* Order Type */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Order Type</label>
                                    <div className="flex bg-slate-100 rounded-lg p-1 border border-slate-200">
                                        <button onClick={() => setOrderType('SPOT')} className={`flex-1 py-2 text-xs font-bold rounded ${orderType === 'SPOT' ? 'bg-white shadow text-blue-600' : 'text-slate-500'}`}>Spot</button>
                                        <button onClick={() => setOrderType('CONTRACT')} className={`flex-1 py-2 text-xs font-bold rounded ${orderType === 'CONTRACT' ? 'bg-white shadow text-purple-600' : 'text-slate-500'}`}>Contract</button>
                                    </div>
                                </div>
                                {/* Date */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Order Date</label>
                                    <input type="date" className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-300 outline-none" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
                                </div>
                            </div>
                        </div>

                        {/* ─── Row 2: Sale Scope & Delivery ─── */}
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
                            <div className="flex items-center gap-4 border-b border-slate-200 pb-4">
                                <h4 className="text-xs font-bold text-slate-600 uppercase flex items-center gap-2"><Globe size={14} /> Sale Scope</h4>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => { setOrderSaleType('LOCAL'); setOrderDeliveryMethod('PICKUP'); setOrderIncoterm('EXW'); }}
                                        className={`px-4 py-1.5 rounded-full text-xs font-bold border transition-colors ${orderSaleType === 'LOCAL' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-white text-slate-500 border-slate-200'}`}
                                    >Local Sale</button>
                                    <button
                                        onClick={() => { setOrderSaleType('EXPORT'); setOrderDeliveryMethod('PORT_TO_PORT'); setOrderIncoterm('FOB'); }}
                                        className={`px-4 py-1.5 rounded-full text-xs font-bold border transition-colors ${orderSaleType === 'EXPORT' ? 'bg-purple-100 text-purple-700 border-purple-200' : 'bg-white text-slate-500 border-slate-200'}`}
                                    >Export Sale</button>
                                </div>
                            </div>

                            {orderSaleType === 'LOCAL' ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Delivery Method</label>
                                        <div className="flex gap-2">
                                            <button onClick={() => { setOrderDeliveryMethod('PICKUP'); setOrderIncoterm('EXW'); }} className={`flex-1 py-2 text-sm font-bold rounded-lg border flex items-center justify-center gap-2 ${orderDeliveryMethod === 'PICKUP' ? 'bg-white border-blue-500 text-blue-700 shadow-sm ring-1 ring-blue-500' : 'bg-slate-100 border-slate-200 text-slate-500'}`}>
                                                <Package size={16} /> Customer Pickup
                                            </button>
                                            <button onClick={() => { setOrderDeliveryMethod('DELIVERY'); setOrderIncoterm('DDP'); }} className={`flex-1 py-2 text-sm font-bold rounded-lg border flex items-center justify-center gap-2 ${orderDeliveryMethod === 'DELIVERY' ? 'bg-white border-blue-500 text-blue-700 shadow-sm ring-1 ring-blue-500' : 'bg-slate-100 border-slate-200 text-slate-500'}`}>
                                                <Truck size={16} /> We Deliver
                                            </button>
                                        </div>
                                    </div>
                                    {orderDeliveryMethod === 'DELIVERY' && (
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Delivery Address</label>
                                            <textarea className="w-full border border-slate-200 rounded-lg p-2.5 text-sm h-20 resize-none focus:ring-2 focus:ring-indigo-300 outline-none" placeholder="Delivery address..." value={orderDeliveryAddress} onChange={(e) => setOrderDeliveryAddress(e.target.value)} />
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Delivery Method</label>
                                        <select className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-300 outline-none" value={orderDeliveryMethod} onChange={(e) => setOrderDeliveryMethod(e.target.value)}>
                                            <option value="PORT_TO_PORT">Port to Port</option>
                                            <option value="DOOR_TO_PORT">Door to Port</option>
                                            <option value="DOOR_TO_DOOR">Door to Door</option>
                                            <option value="PORT_TO_DOOR">Port to Door</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Incoterm</label>
                                        <select className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-300 outline-none" value={orderIncoterm} onChange={(e) => setOrderIncoterm(e.target.value)}>
                                            {['EXW', 'FAS', 'FOB', 'CFR', 'CIF', 'DDP'].map(t => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><Anchor size={12} /> Port of Destination (POD)</label>
                                        <select className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-300 outline-none" value={orderPod} onChange={(e) => setOrderPod(e.target.value)}>
                                            <option value="">Select Port...</option>
                                            {[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={`${p.name} (${p.code})`}>{p.name} ({p.code})</option>)}
                                        </select>
                                        {orderPod && <p className="text-xs text-emerald-600 mt-1">Pre-filled from calculation</p>}
                                    </div>
                                </div>
                            )}

                            {/* Origin / POA row for exports */}
                            {orderSaleType === 'EXPORT' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-100">
                                    <div>
                                        {(orderDeliveryMethod === 'PORT_TO_PORT' || orderDeliveryMethod === 'PORT_TO_DOOR') && (
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><Anchor size={12} /> Port of Loading (POA)</label>
                                                <select className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-300 outline-none" value={orderPoa} onChange={(e) => setOrderPoa(e.target.value)}>
                                                    <option value="">Select Origin Port...</option>
                                                    {[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={`${p.name} (${p.code})`}>{p.name} ({p.code})</option>)}
                                                </select>
                                                {orderPoa && <p className="text-xs text-emerald-600 mt-1">Pre-filled from calculation</p>}
                                            </div>
                                        )}
                                        {(orderDeliveryMethod === 'DOOR_TO_PORT' || orderDeliveryMethod === 'DOOR_TO_DOOR') && (
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><MapPin size={12} /> Pick Up Location</label>
                                                <input type="text" className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-300 outline-none" placeholder="Enter pickup address..." value={orderPickupLocation} onChange={(e) => setOrderPickupLocation(e.target.value)} />
                                            </div>
                                        )}
                                    </div>
                                    <div />
                                </div>
                            )}

                            {/* Payment / Bank / Delivery Date */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 border-t border-slate-200 pt-4 mt-2">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><CreditCard size={12} /> Payment Terms</label>
                                    <select className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-300 outline-none" value={orderPaymentTerms} onChange={(e) => setOrderPaymentTerms(e.target.value)}>
                                        {PAYMENT_TERM_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><Building size={12} /> Bank</label>
                                    <select className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-300 outline-none" value={orderBankId} onChange={(e) => setOrderBankId(e.target.value)}>
                                        <option value="">Select Bank...</option>
                                        {[...banks].sort((a, b) => a.name.localeCompare(b.name)).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                    </select>
                                    {banks.length === 0 && <p className="text-xs text-amber-600 mt-1">No banks configured. Add banks in Data → Banks.</p>}
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><Calendar size={12} /> {orderType === 'CONTRACT' ? 'Delivery Period' : 'Delivery Date / Term'}</label>
                                    {orderType === 'CONTRACT' ? (
                                        <select className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-300 outline-none" value={orderDeliveryDate} onChange={(e) => setOrderDeliveryDate(e.target.value)}>
                                            <option value="">Select Period...</option>
                                            <option value="WEEKLY">Weekly</option>
                                            <option value="MONTHLY">Monthly</option>
                                            <option value="QUARTERLY">Quarterly</option>
                                            <option value="ONCE AVAILABLE">Once Available</option>
                                        </select>
                                    ) : (
                                        <input type="text" className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-300 outline-none" placeholder="e.g. Prompt, Dec 15th, ASAP" value={orderDeliveryDate} onChange={(e) => setOrderDeliveryDate(e.target.value)} />
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* ─── Line Items Preview ─── */}
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                                    <Package size={16} className="text-indigo-500" /> Order Line Items
                                </h3>
                            </div>
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50/50 border-b border-slate-100">
                                        <th className="px-4 py-2.5 text-left font-semibold text-slate-600">Product</th>
                                        <th className="px-4 py-2.5 text-left font-semibold text-slate-600">Supplier</th>
                                        <th className="px-4 py-2.5 text-right font-semibold text-slate-600">Qty (LBS / KG)</th>
                                        <th className="px-4 py-2.5 text-right font-semibold text-slate-600">Price ($/LB / $/KG)</th>
                                        <th className="px-4 py-2.5 text-right font-semibold text-slate-600">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {calculations.map((calc, idx) => (
                                        <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                                            <td className="px-4 py-2.5 font-medium text-slate-800">{calc.productName}</td>
                                            <td className="px-4 py-2.5 text-slate-600">{calc.supplierName}</td>
                                            <td className="px-4 py-2.5 text-right">
                                                <div className="flex flex-col items-end">
                                                    <span className="font-medium text-slate-800">{calc.quantity.toLocaleString()} lbs</span>
                                                    <span className="text-xs text-slate-400">{lbsToKgs(calc.quantity).toLocaleString(undefined, { maximumFractionDigits: 0 })} kg</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-2.5 text-right">
                                                <div className="flex flex-col items-end">
                                                    <span className="font-medium text-emerald-700">${fmt(calc.salePrice, 4)}/lb</span>
                                                    <span className="text-xs text-slate-400">${fmt(pricePerKg(calc.salePrice), 4)}/kg</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-2.5 text-right font-bold text-slate-800">{fmtCurrency(calc.salePrice * calc.quantity)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="bg-slate-50 border-t-2 border-slate-200">
                                        <td colSpan={2} className="px-4 py-3 font-bold text-slate-700">Totals</td>
                                        <td className="px-4 py-3 text-right font-bold text-slate-700">
                                            <div className="flex flex-col items-end">
                                                <span>{calculations.reduce((s, c) => s + c.quantity, 0).toLocaleString()} lbs</span>
                                                <span className="text-xs text-slate-400">{lbsToKgs(calculations.reduce((s, c) => s + c.quantity, 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })} kg</span>
                                            </div>
                                        </td>
                                        <td></td>
                                        <td className="px-4 py-3 text-right font-bold text-lg text-indigo-700">
                                            {fmtCurrency(calculations.reduce((s, c) => s + (c.salePrice * c.quantity), 0))}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>

                        {/* ─── Notes ─── */}
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Notes (optional)</label>
                            <textarea
                                value={orderNotes}
                                onChange={(e) => setOrderNotes(e.target.value)}
                                placeholder="Add any notes for this sales order..."
                                className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-300 outline-none resize-none h-20"
                            />
                        </div>

                        {/* ─── Actions ─── */}
                        <div className="flex items-center justify-between pt-2">
                            <button onClick={() => setStep(3)} className="flex items-center gap-2 px-5 py-3 bg-slate-100 text-slate-700 rounded-xl font-semibold hover:bg-slate-200 transition-colors">
                                <ChevronLeft size={18} /> Back
                            </button>
                            <div className="flex items-center gap-3">
                                {orderSaveStatus === 'saved' && (
                                    <div className="flex items-center gap-2 text-emerald-600 text-sm font-semibold">
                                        <CheckCircle2 size={18} />
                                        Sales Order {createdOrderNumber} created!
                                    </div>
                                )}
                                {orderSaveStatus === 'error' && (
                                    <div className="flex items-center gap-2 text-red-500 text-sm font-semibold">
                                        <AlertTriangle size={18} />
                                        Failed to create order
                                    </div>
                                )}
                                <button
                                    onClick={async () => {
                                        if (!onSaveSalesOrder || !selectedCustomerId) return;
                                        setOrderSaveStatus('saving');

                                        const customer = customers.find(c => c.id === selectedCustomerId);
                                        const orderNum = `SO-CPA-${Date.now().toString().slice(-6)}`;

                                        const items: SalesOrderItem[] = calculations.map(calc => ({
                                            productId: products.find(p => p.name === calc.productName)?.id || '',
                                            productName: calc.productName,
                                            customerDescription: '',
                                            hsCode: '',
                                            quantity: calc.quantity,
                                            unitPrice: calc.salePrice,
                                            total: calc.salePrice * calc.quantity
                                        }));

                                        const salesOrder: SalesOrder = {
                                            id: `SO-CPA-${Date.now()}`,
                                            companyId: currentCompanyId,
                                            customerId: selectedCustomerId,
                                            customerName: customer?.name || '',
                                            orderNumber: orderNum,
                                            orderDate: orderDate || new Date().toISOString(),
                                            orderType: orderType,
                                            status: 'PENDING',
                                            items: items,
                                            totalAmount: items.reduce((s, i) => s + i.total, 0),
                                            currency: 'USD',
                                            paymentTerms: orderPaymentTerms,
                                            incoterm: orderIncoterm,
                                            notes: orderNotes || undefined,
                                            createdBy: currentUser?.name || '',
                                            saleType: orderSaleType,
                                            deliveryMethod: orderDeliveryMethod,
                                            deliveryAddress: orderDeliveryAddress || undefined,
                                            deliveryDate: orderDeliveryDate || undefined,
                                            pod: orderPod || undefined,
                                            poa: orderPoa || undefined,
                                            pickupLocation: orderPickupLocation || undefined,
                                            bankId: orderBankId || undefined,
                                            supplierName: selectedOffers[0]?.supplierName || calculations[0]?.supplierName || undefined,
                                            supplierLoadingLocation: selectedOffers[0]?.loadingLocation || (calculations[0] as any)?.loadingLocation || undefined
                                        };

                                        const result = await onSaveSalesOrder(salesOrder);
                                        if (result) {
                                            setOrderSaveStatus('saved');
                                            setCreatedOrderNumber(orderNum);
                                        } else {
                                            setOrderSaveStatus('error');
                                        }
                                    }}
                                    disabled={orderSaveStatus === 'saving' || !selectedCustomerId || orderSaveStatus === 'saved'}
                                    className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-semibold hover:from-indigo-700 hover:to-purple-700 transition-all shadow-lg shadow-indigo-200 disabled:opacity-50"
                                >
                                    {orderSaveStatus === 'saving' ? (
                                        <><Loader2 size={18} className="animate-spin" /> Creating...</>
                                    ) : orderSaveStatus === 'saved' ? (
                                        <><CheckCircle2 size={18} /> Order Created</>
                                    ) : (
                                        <><ShoppingBag size={18} /> Create Sales Order</>
                                    )}
                                </button>
                                {orderSaveStatus === 'saved' && (
                                    <button onClick={() => setStep(5)} className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-xl font-semibold hover:from-blue-700 hover:to-cyan-700 transition-all shadow-lg shadow-blue-200">
                                        Next: Logistics <ChevronRight size={18} />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )
            }
            {/* ====================== STEP 5: LOGISTICS ====================== */}
            {
                step === 5 && (() => {
                    // Build logistics products from calculations or fallback to the active sales order items
                    const activeOrder = salesOrders.find(so => so.orderNumber === createdOrderNumber);
                    // Derive supplier info for saved orders that lack supplierName/supplierLoadingLocation
                    const derivedSupplierName = (() => {
                        if (activeOrder?.supplierName) return activeOrder.supplierName;
                        if (calculations[0]?.supplierName) return calculations[0].supplierName;
                        if (selectedOffers[0]?.supplierName) return selectedOffers[0].supplierName;
                        // Try to find from costCalculations matching this order's customer
                        const orderCustomer = activeOrder?.customerName || '';
                        if (orderCustomer) {
                            const matchCalc = costCalculations.find(cc => cc.customerName === orderCustomer);
                            if (matchCalc?.supplierName) return matchCalc.supplierName;
                        }
                        // Try to find from products in items
                        const firstItem = activeOrder?.items?.[0];
                        if (firstItem?.productName) {
                            const pn = firstItem.productName.toLowerCase();
                            const mp = products.find(p => pn.includes(p.name.toLowerCase()) || pn.includes((p.sku || '').toLowerCase()));
                            if (mp?.supplier) {
                                const sup = suppliers.find(s => s.name === mp.supplier || s.id === mp.supplier);
                                return sup?.name || mp.supplier;
                            }
                        }
                        return '';
                    })();
                    const derivedPickupLocation = (() => {
                        if (activeOrder?.pickupLocation) return activeOrder.pickupLocation;
                        if (orderPickupLocation) return orderPickupLocation;
                        if (activeOrder?.supplierLoadingLocation) return activeOrder.supplierLoadingLocation;
                        if (calculations[0]?.loadingLocation) return (calculations[0] as any).loadingLocation;
                        if (selectedOffers[0]?.loadingLocation) return selectedOffers[0].loadingLocation;
                        // Try to look up from suppliers using fuzzy matching
                        if (derivedSupplierName) {
                            const normName = derivedSupplierName.replace(/\s+/g, ' ').trim().toLowerCase();
                            // First try exact match, then contains match, then first-word match
                            let sup = suppliers.find(s => s.name.replace(/\s+/g, ' ').trim().toLowerCase() === normName);
                            if (!sup) {
                                sup = suppliers.find(s => {
                                    const sn = s.name.replace(/\s+/g, ' ').trim().toLowerCase();
                                    return sn.includes(normName) || normName.includes(sn);
                                });
                            }
                            if (!sup) {
                                // Try matching by first significant word (e.g., "FIBERTEX")
                                const firstWord = normName.split(/[\s,]+/).filter(w => w.length > 2)[0];
                                if (firstWord) {
                                    sup = suppliers.find(s => s.name.toLowerCase().includes(firstWord));
                                }
                            }
                            if (sup) {
                                console.log('[FQ_DEBUG] Matched supplier for pickup:', sup.name, 'pickupLocation:', sup.pickupLocation, 'location:', sup.location, 'city:', sup.city, 'state:', sup.state, 'country:', sup.country);
                                // Check supplier's pickupLocation first, then build from location/city/state
                                if (sup.pickupLocation) return sup.pickupLocation;
                                const parts = [sup.location, sup.city, sup.state, sup.country].filter(Boolean);
                                if (parts.length > 0) return parts.join(', ');
                            }
                        }
                        return '';
                    })();
                    const logisticsProducts: { productName: string; supplierName: string; quantityLbs: number; }[] =
                        calculations.length > 0
                            ? calculations.map(c => ({ productName: c.productName, supplierName: c.supplierName, quantityLbs: c.quantity }))
                            : (activeOrder?.items || []).map(item => {
                                const pn = (item.productName || '').toLowerCase();
                                const mp = products.find(p => {
                                    const nm = p.name.toLowerCase();
                                    const sk = (p.sku || '').toLowerCase();
                                    return (sk && pn.includes(sk)) || pn.includes(nm) || nm.includes(pn);
                                });
                                return { productName: item.productName, supplierName: mp?.supplier || '', quantityLbs: item.quantity };
                            });
                    const totalWeightLbs = logisticsProducts.reduce((a, p) => a + p.quantityLbs, 0);
                    const totalWeightKg = lbsToKgs(totalWeightLbs);
                    const containers = Math.max(1, Math.ceil(totalWeightKg / 26000));

                    // Helper to extract port code from strings like "Acajutla (SVAQJ)" -> "SVAQJ"
                    const extractCode = (str: string): string => {
                        if (!str) return '';
                        const parenMatch = str.match(/\(([A-Z0-9]{2,6})\)/);
                        if (parenMatch) return parenMatch[1].toUpperCase();
                        const trimmed = str.trim().toUpperCase();
                        if (/^[A-Z0-9]{2,6}$/.test(trimmed)) return trimmed;
                        return trimmed;
                    };
                    const routeOriginRaw = calculations[0]?.originPort || activeOrder?.poa || orderPoa || '';
                    const routeDestRaw = calculations[0]?.destinationPort || activeOrder?.pod || orderPod || '';
                    const routeOriginCode = extractCode(routeOriginRaw);
                    const routeDestCode = extractCode(routeDestRaw);
                    console.log('[FQ DEBUG] routeOriginCode:', routeOriginCode, 'routeDestCode:', routeDestCode, 'total FQs:', freightQuotes.length, 'derivedPickup:', derivedPickupLocation, 'derivedSupplier:', derivedSupplierName);
                    if (freightQuotes.length > 0) {
                        const sample = freightQuotes[0] as any;
                        console.log('[FQ DEBUG] sample FQ keys:', Object.keys(sample).join(', '));
                        console.log('[FQ DEBUG] sample FQ status:', sample.status, 'originPortCode:', sample.originPortCode, 'origin_port_code:', sample.origin_port_code, 'originPort:', sample.originPort, 'origin_port:', sample.origin_port);
                    }
                    const matchingQuotes = freightQuotes
                        .filter(fq => {
                            const f = fq as any;
                            const fqStatus = f.status || '';
                            if (fqStatus !== 'ACTIVE') return false;
                            if (!routeOriginCode || !routeDestCode) return false;
                            // Access port codes with snake_case fallback (Supabase returns snake_case)
                            const fqOriginCode = (f.originPortCode || f.origin_port_code || extractCode(f.originPort || f.origin_port || '')).toUpperCase();
                            const fqDestCode = (f.destinationPortCode || f.destination_port_code || extractCode(f.destinationPort || f.destination_port || '')).toUpperCase();
                            if (fqOriginCode !== routeOriginCode || fqDestCode !== routeDestCode) return false;
                            // Optional pickup location match for EXW
                            const incoterm = (calculations[0] as any)?.incoterm || selectedOffers[0]?.incoterm || activeOrder?.incoterm || '';
                            const isExw = incoterm.toUpperCase() === 'EXW' || incoterm.toUpperCase() === 'EX WORKS';
                            if (isExw) {
                                const fqPickup = (f.pickupLocation || f.pickup_location || '').toLowerCase();
                                const offerLoadingLoc = (derivedPickupLocation || '').toLowerCase();
                                if (fqPickup && offerLoadingLoc && !fqPickup.includes(offerLoadingLoc) && !offerLoadingLoc.includes(fqPickup)) return false;
                            }
                            return true;
                        })
                        .sort((a, b) => a.rate - b.rate);
                    const selectedFQ = freightQuotes.find(fq => fq.id === selectedFreightQuoteId) || matchingQuotes[0];
                    // Auto-select best rate on first render
                    if (!selectedFreightQuoteId && matchingQuotes.length > 0) {
                        setTimeout(() => setSelectedFreightQuoteId(matchingQuotes[0].id), 0);
                    }
                    return (
                        <div className="space-y-6">
                            {/* Controls */}
                            <div className="flex items-center justify-between">
                                <button onClick={() => setStep(4)} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
                                    <ChevronLeft size={16} /> Back to Order
                                </button>
                                {bookingRequested && (
                                    <div className="flex items-center gap-2 text-emerald-600 text-sm font-semibold">
                                        <CheckCircle2 size={18} /> Booking Requested!
                                    </div>
                                )}
                            </div>

                            {/* Shipment Summary */}
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                                    <Ship size={16} className="text-blue-500" /> Shipment Details
                                </h3>
                                <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                                    <div className="bg-slate-50 rounded-lg p-3">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Order #</label>
                                        <p className="text-sm font-bold text-slate-800">{createdOrderNumber || '—'}</p>
                                    </div>
                                    <div className="bg-slate-50 rounded-lg p-3">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Shipper</label>
                                        <p className="text-sm font-bold text-slate-800">{availableCompanies?.find(c => c.id === currentCompanyId)?.name || '—'}</p>
                                    </div>
                                    <div className="bg-slate-50 rounded-lg p-3">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Supplier</label>
                                        <p className="text-sm font-bold text-slate-800">{derivedSupplierName || logisticsProducts[0]?.supplierName || '—'}</p>
                                    </div>
                                    <div className="bg-slate-50 rounded-lg p-3">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Customer</label>
                                        <p className="text-sm font-bold text-slate-800">{activeOrder?.customerName || customers.find(c => c.id === selectedCustomerId)?.name || '—'}</p>
                                    </div>
                                    <div className="bg-slate-50 rounded-lg p-3">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Incoterm</label>
                                        <p className="text-sm font-bold text-slate-800">{activeOrder?.incoterm || orderIncoterm}</p>
                                    </div>
                                    <div className="bg-slate-50 rounded-lg p-3">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Delivery</label>
                                        <p className="text-sm font-bold text-slate-800">{(activeOrder?.deliveryMethod || orderDeliveryMethod)?.replace(/_/g, ' ') || '—'}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Route & Cargo */}
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                                    <Anchor size={16} className="text-indigo-500" /> Route & Cargo
                                </h3>
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                                    <div className="bg-blue-50/50 rounded-lg p-3 border border-blue-100">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Origin (POA)</label>
                                        <p className="text-sm font-bold text-slate-800">{calculations[0]?.originPort || activeOrder?.poa || orderPoa || '—'}</p>
                                    </div>
                                    <div className="bg-blue-50/50 rounded-lg p-3 border border-blue-100">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Destination (POD)</label>
                                        <p className="text-sm font-bold text-slate-800">{calculations[0]?.destinationPort || activeOrder?.pod || orderPod || '—'}</p>
                                    </div>
                                    <div className="bg-emerald-50/50 rounded-lg p-3 border border-emerald-100">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Total Weight</label>
                                        <p className="text-sm font-bold text-slate-800">{fmt(totalWeightKg, 0)} kg</p>
                                        <p className="text-[10px] text-slate-400">{totalWeightLbs.toLocaleString()} lbs</p>
                                    </div>
                                    <div className="bg-amber-50/50 rounded-lg p-3 border border-amber-100">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Containers</label>
                                        <p className="text-sm font-bold text-slate-800">{containers} x 40ft HC</p>
                                    </div>
                                    <div className="bg-orange-50/50 rounded-lg p-3 border border-orange-100">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1"><MapPin size={10} /> Pickup Location</label>
                                        <p className="text-sm font-bold text-slate-800">{(() => {
                                            if (derivedPickupLocation) return derivedPickupLocation;
                                            // Fallback: look up supplier and build address
                                            const supName = calculations[0]?.supplierName || selectedOffers[0]?.supplierName || logisticsProducts[0]?.supplierName || '';
                                            if (supName) {
                                                const sn = supName.toLowerCase();
                                                let sup = suppliers.find(s => s.name.toLowerCase() === sn);
                                                if (!sup) sup = suppliers.find(s => s.name.toLowerCase().includes(sn) || sn.includes(s.name.toLowerCase()));
                                                if (!sup) { const fw = sn.split(/[\s,]+/).filter(w => w.length > 2)[0]; if (fw) sup = suppliers.find(s => s.name.toLowerCase().includes(fw)); }
                                                if (sup) {
                                                    if (sup.pickupLocation) return sup.pickupLocation;
                                                    const parts = [sup.location, sup.city, sup.state, sup.country].filter(Boolean);
                                                    if (parts.length > 0) return parts.join(', ');
                                                }
                                            }
                                            return '—';
                                        })()}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Best Freight Quotes */}
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-4 flex items-center gap-2">
                                    <Ship size={16} className="text-purple-500" /> Best Freight Quotes for This Route
                                    <span className="text-[10px] font-normal text-slate-400 ml-1">({matchingQuotes.length} found)</span>
                                </h3>
                                {matchingQuotes.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        {matchingQuotes.slice(0, 3).map((fq, i) => {
                                            const isSelected = selectedFreightQuoteId === fq.id;
                                            const agentDisplay = fq.agentName || fq.carrier || 'Agent';
                                            const freightTypeLabel: Record<string, string> = {
                                                'PORT_PORT': 'Port → Port',
                                                'PORT_DOOR': 'Port → Door',
                                                'DOOR_PORT': 'Door → Port',
                                                'DOOR_DOOR': 'Door → Door',
                                            };
                                            return (
                                                <div
                                                    key={fq.id}
                                                    onClick={() => setSelectedFreightQuoteId(fq.id)}
                                                    className={`relative rounded-xl p-4 cursor-pointer transition-all duration-200 border-2 ${isSelected
                                                        ? 'border-indigo-500 bg-indigo-50/50 shadow-md ring-2 ring-indigo-200'
                                                        : 'border-slate-200 bg-slate-50/50 hover:border-indigo-300 hover:shadow-sm'
                                                        }`}
                                                >
                                                    {/* Badge */}
                                                    <div className="flex items-center justify-between mb-3">
                                                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${i === 0 ? 'bg-emerald-100 text-emerald-700' :
                                                            i === 1 ? 'bg-blue-100 text-blue-700' :
                                                                'bg-amber-100 text-amber-700'
                                                            }`}>
                                                            {i === 0 ? '★ Best Rate' : i === 1 ? '#2 Option' : '#3 Option'}
                                                        </span>
                                                        {isSelected && (
                                                            <CheckCircle2 size={18} className="text-indigo-500" />
                                                        )}
                                                    </div>
                                                    {/* Cargo Agent */}
                                                    <div className="mb-3">
                                                        <p className="text-[10px] text-slate-400 uppercase font-bold">Cargo Agent</p>
                                                        <p className="text-sm font-bold text-slate-800">{fq.agentName || '—'}</p>
                                                        {fq.carrier && (
                                                            <p className="text-[11px] text-slate-500">Carrier: {fq.carrier}</p>
                                                        )}
                                                    </div>
                                                    {/* Rate */}
                                                    <div className="bg-white/80 rounded-lg p-2.5 mb-3 border border-slate-100">
                                                        <p className="text-[10px] text-slate-400 uppercase font-bold">Rate per Container</p>
                                                        <p className="text-lg font-extrabold text-indigo-600">${fq.rate.toLocaleString()}</p>
                                                        <p className="text-[10px] text-slate-400">{fq.currency || 'USD'} · {freightTypeLabel[fq.freightType] || fq.freightType}</p>
                                                    </div>
                                                    {/* Details grid */}
                                                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                                                        <div>
                                                            <span className="text-slate-400 block">Transit</span>
                                                            <span className="font-bold text-slate-700">{fq.transitTime ? `${fq.transitTime} days` : '—'}</span>
                                                        </div>
                                                        <div>
                                                            <span className="text-slate-400 block">Free Time</span>
                                                            <span className="font-bold text-slate-700">{fq.freeTime ? `${fq.freeTime} days` : '—'}</span>
                                                        </div>
                                                        {fq.pickupLocation && (
                                                            <div className="col-span-2">
                                                                <span className="text-slate-400 block">Pickup Location</span>
                                                                <span className="font-bold text-slate-700">{fq.pickupLocation}</span>
                                                            </div>
                                                        )}
                                                        <div>
                                                            <span className="text-slate-400 block">POA</span>
                                                            <span className="font-bold text-slate-700">{fq.originPort || fq.originPortCode || '—'}</span>
                                                        </div>
                                                        <div>
                                                            <span className="text-slate-400 block">POD</span>
                                                            <span className="font-bold text-slate-700">{fq.destinationPort || fq.destinationPortCode || '—'}</span>
                                                        </div>
                                                    </div>
                                                    {/* Valid until */}
                                                    <p className="text-[10px] text-slate-400 mt-2">Valid until: {fq.validUntil ? new Date(fq.validUntil).toLocaleDateString() : '—'}</p>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-center py-8 text-slate-400">
                                        <Ship size={32} className="mx-auto mb-2 opacity-30" />
                                        <p className="text-sm">No freight quotes found for route <strong>{routeOriginCode}</strong> → <strong>{routeDestCode}</strong></p>
                                        <p className="text-xs mt-1">Add quotes in the Freight Quotes module to see options here.</p>
                                    </div>
                                )}
                            </div>



                            {/* Booking Notes */}
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Booking Instructions / Notes</label>
                                <textarea
                                    value={bookingNotes}
                                    onChange={(e) => setBookingNotes(e.target.value)}
                                    placeholder="Add any special instructions for the booking (e.g., temperature requirements, stacking restrictions, required ETD/ETA)..."
                                    className="w-full border border-slate-200 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-300 outline-none resize-none h-24"
                                />
                            </div>

                            {/* Actions */}
                            <div className="flex items-center justify-between pt-2">
                                <button onClick={() => setStep(4)} className="flex items-center gap-2 px-5 py-3 bg-slate-100 text-slate-700 rounded-xl font-semibold hover:bg-slate-200 transition-colors">
                                    <ChevronLeft size={18} /> Back
                                </button>
                                <div className="flex items-center gap-3">
                                    {bookingRequested && (
                                        <div className="flex items-center gap-2 text-emerald-600 text-sm font-semibold">
                                            <CheckCircle2 size={18} /> Booking request sent
                                        </div>
                                    )}
                                    <button
                                        onClick={() => {
                                            // Compose email content from shipment data
                                            const customerName = activeOrder?.customerName || customers.find(c => c.id === selectedCustomerId)?.name || 'N/A';
                                            const supplierName = calculations[0]?.supplierName || logisticsProducts[0]?.supplierName || 'N/A';
                                            const orderNum = createdOrderNumber || 'N/A';
                                            const incoterm = activeOrder?.incoterm || orderIncoterm;
                                            const delivery = (activeOrder?.deliveryMethod || orderDeliveryMethod)?.replace(/_/g, ' ') || 'N/A';
                                            const origin = calculations[0]?.originPort || activeOrder?.poa || orderPoa || 'N/A';
                                            const destination = calculations[0]?.destinationPort || activeOrder?.pod || orderPod || 'N/A';
                                            const dm = activeOrder?.deliveryMethod || orderDeliveryMethod;
                                            const pickup = (dm === 'DOOR_TO_PORT' || dm === 'DOOR_TO_DOOR') ? (activeOrder?.pickupLocation || orderPickupLocation || '') : '';

                                            const productLines = logisticsProducts.map(p =>
                                                `  - ${p.productName}: ${fmt(p.quantityLbs, 0)} lbs / ${fmt(lbsToKgs(p.quantityLbs), 0)} kg`
                                            ).join('\n');

                                            setBookingEmailTo('');
                                            setBookingEmailSubject(`Booking Request - Order ${orderNum} - ${customerName}`);
                                            setBookingEmailBody(
                                                `Dear Freight Agent,

We would like to request a booking for the following shipment:

ORDER DETAILS
Order #: ${orderNum}
Supplier: ${supplierName}
Customer: ${customerName}
Incoterm: ${incoterm}
Delivery Method: ${delivery}

ROUTE & CARGO
Origin (POA): ${origin}
Destination (POD): ${destination}${pickup ? `\nPickup Location: ${pickup}` : ''}
Total Weight: ${fmt(totalWeightKg, 0)} kg / ${totalWeightLbs.toLocaleString()} lbs
Containers: ${containers} x 40ft HC

PRODUCTS
${productLines}

${bookingNotes ? `SPECIAL INSTRUCTIONS\n${bookingNotes}\n` : ''}Please confirm availability and provide booking details at your earliest convenience.

Best regards`
                                            );
                                            setShowBookingEmailModal(true);
                                        }}
                                        disabled={bookingRequested}
                                        className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-xl font-semibold hover:from-blue-700 hover:to-cyan-700 transition-all shadow-lg shadow-blue-200 disabled:opacity-50"
                                    >
                                        {bookingRequested ? (
                                            <><CheckCircle2 size={18} /> Booking Requested</>
                                        ) : (
                                            <><Send size={18} /> Request Booking</>
                                        )}
                                    </button>
                                </div>
                            </div>

                            {/* Email Preview Modal */}
                            {showBookingEmailModal && (
                                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col overflow-hidden">
                                        {/* Modal Header */}
                                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-blue-50 to-cyan-50">
                                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                                <Send size={18} className="text-blue-600" /> Booking Email Preview
                                            </h3>
                                            <button onClick={() => setShowBookingEmailModal(false)} className="p-1.5 rounded-lg hover:bg-white/60 text-slate-400 hover:text-slate-600 transition-colors">
                                                <X size={18} />
                                            </button>
                                        </div>

                                        {/* Modal Body */}
                                        <div className="flex-1 overflow-y-auto p-6 space-y-4">
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">To</label>
                                                <input
                                                    type="email"
                                                    value={bookingEmailTo}
                                                    onChange={(e) => setBookingEmailTo(e.target.value)}
                                                    placeholder="freight-agent@example.com"
                                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Subject</label>
                                                <input
                                                    type="text"
                                                    value={bookingEmailSubject}
                                                    onChange={(e) => setBookingEmailSubject(e.target.value)}
                                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Body</label>
                                                <textarea
                                                    value={bookingEmailBody}
                                                    onChange={(e) => setBookingEmailBody(e.target.value)}
                                                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-300 outline-none resize-none font-mono leading-relaxed"
                                                    rows={18}
                                                />
                                            </div>
                                        </div>

                                        {/* Modal Footer */}
                                        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
                                            <button
                                                onClick={() => setShowBookingEmailModal(false)}
                                                className="px-5 py-2.5 text-sm font-semibold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setBookingRequested(true);
                                                    setShowBookingEmailModal(false);
                                                }}
                                                className="flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl hover:from-blue-700 hover:to-cyan-700 transition-all shadow-lg shadow-blue-200"
                                            >
                                                <Send size={16} /> Send Booking Request
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })()
            }

            {/* ====================== VIEW QUOTE MODAL ====================== */}
            {
                viewQuoteOffer && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setViewQuoteOffer(null)}>
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
                            {/* Modal Header */}
                            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
                                <div>
                                    <h2 className="text-lg font-bold text-slate-900">Supplier Quote — {viewQuoteOffer.offerNumber}</h2>
                                    <p className="text-sm text-slate-500">{viewQuoteOffer.supplierName}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={`px - 2.5 py - 1 rounded - lg text - xs font - semibold ${viewQuoteOffer.status === 'Accepted' ? 'bg-emerald-100 text-emerald-700' : viewQuoteOffer.status === 'Received' ? 'bg-blue-100 text-blue-700' : viewQuoteOffer.status === 'Expired' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'} `}>
                                        {viewQuoteOffer.status}
                                    </span>
                                    <button onClick={() => setViewQuoteOffer(null)} className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors">
                                        <X size={18} className="text-slate-500" />
                                    </button>
                                </div>
                            </div>

                            {/* Modal Body */}
                            <div className="p-6 overflow-y-auto max-h-[calc(85vh-140px)]">
                                {/* Quote Info Grid */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                                    <div>
                                        <span className="text-[10px] uppercase text-slate-400 font-semibold">Incoterm</span>
                                        <p className="text-sm font-bold text-slate-800">{viewQuoteOffer.incoterm}</p>
                                    </div>
                                    <div>
                                        <span className="text-[10px] uppercase text-slate-400 font-semibold">Currency</span>
                                        <p className="text-sm font-bold text-slate-800">{viewQuoteOffer.currency}</p>
                                    </div>
                                    <div>
                                        <span className="text-[10px] uppercase text-slate-400 font-semibold">Origin</span>
                                        <p className="text-sm font-bold text-slate-800">{viewQuoteOffer.originPort || '—'}</p>
                                    </div>
                                    <div>
                                        <span className="text-[10px] uppercase text-slate-400 font-semibold">Destination</span>
                                        <p className="text-sm font-bold text-slate-800">{viewQuoteOffer.destinationPort || '—'}</p>
                                    </div>
                                    <div>
                                        <span className="text-[10px] uppercase text-slate-400 font-semibold">Payment Terms</span>
                                        <p className="text-sm font-bold text-slate-800">{viewQuoteOffer.paymentTerms || '—'}</p>
                                    </div>
                                    <div>
                                        <span className="text-[10px] uppercase text-slate-400 font-semibold">Valid Until</span>
                                        <p className="text-sm font-bold text-slate-800">{viewQuoteOffer.validUntil ? new Date(viewQuoteOffer.validUntil).toLocaleDateString() : '—'}</p>
                                    </div>
                                    <div>
                                        <span className="text-[10px] uppercase text-slate-400 font-semibold">Total Amount</span>
                                        <p className="text-sm font-bold text-emerald-700">{fmtCurrency(viewQuoteOffer.totalAmount || 0)}</p>
                                    </div>
                                    <div>
                                        <span className="text-[10px] uppercase text-slate-400 font-semibold">Items</span>
                                        <p className="text-sm font-bold text-slate-800">{(viewQuoteOffer.items || []).length} product(s)</p>
                                    </div>
                                </div>

                                {/* Items Table */}
                                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-slate-50 border-b border-slate-200">
                                                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Description</th>
                                                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">lbs</th>
                                                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">kgs</th>
                                                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">$/lb</th>
                                                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">$/kg</th>
                                                <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Total</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(viewQuoteOffer.items || []).map((it, i) => (
                                                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                                                    <td className="px-4 py-2.5 font-medium text-slate-800">{it.productName}</td>
                                                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{fmt(it.quantity, 0)}</td>
                                                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{fmt(lbsToKgs(it.quantity), 0)}</td>
                                                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">${fmt(it.unitPrice, 2)}</td>
                                                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">${fmt(pricePerKg(it.unitPrice), 2)}</td>
                                                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-800">{fmtCurrency(it.quantity * it.unitPrice)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot>
                                            <tr className="bg-slate-50 border-t-2 border-slate-200">
                                                <td colSpan={5} className="px-4 py-2.5 font-bold text-slate-700">Total</td>
                                                <td className="px-4 py-2.5 text-right font-bold text-emerald-700">{fmtCurrency(viewQuoteOffer.totalAmount || 0)}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>

                                {/* Notes */}
                                {viewQuoteOffer.notes && (
                                    <div className="mt-4 p-3 bg-amber-50 rounded-lg border border-amber-100">
                                        <span className="text-xs font-semibold text-amber-700">Notes</span>
                                        <p className="text-sm text-slate-700 mt-1">{viewQuoteOffer.notes}</p>
                                    </div>
                                )}
                            </div>

                            {/* Modal Footer */}
                            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
                                <button onClick={() => setViewQuoteOffer(null)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">
                                    Close
                                </button>
                                <button
                                    onClick={() => { calculateSingleOffer(viewQuoteOffer); setViewQuoteOffer(null); }}
                                    className="flex items-center gap-2 px-4 py-2 bg-rose-600 text-white rounded-lg text-sm font-semibold hover:bg-rose-700 transition-colors"
                                >
                                    <Calculator size={15} /> Calculate Cost
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* ====================== ADD NEW OFFER MODAL ====================== */}
            {
                showAddModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowAddModal(false)}>
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
                            {/* Modal Header */}
                            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-emerald-50 to-teal-50">
                                <div>
                                    <h2 className="text-lg font-bold text-slate-900">Add New Supplier Offer</h2>
                                    <p className="text-sm text-slate-500">OCR a PDF or enter manually</p>
                                </div>
                                <button onClick={() => setShowAddModal(false)} className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors">
                                    <X size={18} className="text-slate-500" />
                                </button>
                            </div>

                            {/* Tab Selector */}
                            <div className="flex justify-end gap-1 border-b border-slate-200 px-6">
                                <button
                                    onClick={() => setAddTab('ocr')}
                                    className={`py-2.5 px-5 text-sm font-semibold flex items-center gap-2 rounded-t-lg transition-colors ${addTab === 'ocr' ? 'text-white bg-gradient-to-r from-emerald-600 to-teal-600 shadow-sm' : 'text-slate-500 hover:text-emerald-700 hover:bg-emerald-50'}`}
                                >
                                    <Upload size={15} /> OCR PDF / Image
                                </button>
                                <button
                                    onClick={() => setAddTab('manual')}
                                    className={`py-2.5 px-5 text-sm font-semibold flex items-center gap-2 rounded-t-lg transition-colors ${addTab === 'manual' ? 'text-white bg-gradient-to-r from-amber-500 to-orange-500 shadow-sm' : 'text-slate-500 hover:text-amber-700 hover:bg-amber-50'}`}
                                >
                                    <Pencil size={15} /> Manual Entry
                                </button>
                            </div>

                            {/* Modal Body */}
                            <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
                                {/* OCR Tab */}
                                {addTab === 'ocr' && (
                                    <div className="flex flex-col items-center justify-center py-8">
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept=".pdf,image/*"
                                            className="hidden"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (file) { setOcrFile(file); handleOcrExtract(file); }
                                            }}
                                        />
                                        {ocrLoading ? (
                                            <div className="flex flex-col items-center gap-4">
                                                <Loader2 size={48} className="animate-spin text-emerald-500" />
                                                <p className="text-sm font-semibold text-slate-600">AI is extracting offer data from <span className="text-emerald-700">{ocrFile?.name}</span>...</p>
                                                <p className="text-xs text-slate-400">This may take a few seconds</p>
                                            </div>
                                        ) : (
                                            <div
                                                className="w-full border-2 border-dashed border-slate-300 rounded-2xl p-12 flex flex-col items-center gap-4 hover:border-emerald-400 hover:bg-emerald-50/30 transition-all cursor-pointer"
                                                onClick={() => fileInputRef.current?.click()}
                                                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                                onDrop={(e) => {
                                                    e.preventDefault(); e.stopPropagation();
                                                    const file = e.dataTransfer.files[0];
                                                    if (file) { setOcrFile(file); handleOcrExtract(file); }
                                                }}
                                            >
                                                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center">
                                                    <FilePlus size={36} className="text-emerald-600" />
                                                </div>
                                                <div className="text-center">
                                                    <p className="text-base font-semibold text-slate-700">Drop offer PDF or image here</p>
                                                    <p className="text-sm text-slate-400 mt-1">or click to browse — AI will auto-fill the form</p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Manual Tab */}
                                {addTab === 'manual' && (
                                    <div className="space-y-4 relative">
                                        {/* Detected New Entities Notification */}
                                        {(detectedSupplier || detectedProducts.length > 0) && (
                                            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                                                <div className="flex items-center gap-2">
                                                    <AlertTriangle size={16} className="text-amber-600" />
                                                    <h4 className="text-sm font-bold text-amber-800">New entities detected — not in your database</h4>
                                                </div>
                                                <p className="text-xs text-amber-700">Review and save each entity below. You can edit all fields before saving.</p>
                                                <div className="flex flex-wrap gap-2">
                                                    {detectedSupplier && (
                                                        <button onClick={() => setShowDetectedSupModal(true)} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-amber-200 rounded-lg text-sm hover:bg-amber-100 transition-colors">
                                                            <AlertTriangle size={14} className="text-amber-500" />
                                                            <span className="text-[10px] font-bold uppercase text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">Supplier</span>
                                                            <span className="font-semibold text-slate-800">{detectedSupplier.name}</span>
                                                            <span className="text-xs text-amber-600">→ Review & Save</span>
                                                        </button>
                                                    )}
                                                    {detectedProducts.map((dp, idx) => (
                                                        <button key={dp.name} onClick={() => setEditingProductIdx(idx)} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-blue-200 rounded-lg text-sm hover:bg-blue-50 transition-colors">
                                                            <AlertTriangle size={14} className="text-blue-500" />
                                                            <span className="text-[10px] font-bold uppercase text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">Product</span>
                                                            <span className="font-semibold text-slate-800">{dp.name}</span>
                                                            <span className="text-xs text-blue-600">→ Review & Save</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* ── Detected Supplier Modal ── */}
                                        {showDetectedSupModal && detectedSupplier && (
                                            <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4" onClick={() => setShowDetectedSupModal(false)}>
                                                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                                                    <div className="p-6 border-b border-slate-100">
                                                        <div className="flex items-center justify-between">
                                                            <div>
                                                                <h3 className="text-lg font-bold text-slate-900">New Supplier Detected</h3>
                                                                <p className="text-xs text-slate-500 mt-1">Review and edit the details, then save to your database.</p>
                                                            </div>
                                                            <button onClick={() => setShowDetectedSupModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                                                        </div>
                                                    </div>
                                                    <div className="p-6 space-y-4">
                                                        <div className="grid grid-cols-2 gap-4">
                                                            <div className="col-span-2">
                                                                <label className="text-xs font-semibold text-slate-600 mb-1 block">Company Name *</label>
                                                                <input type="text" value={detectedSupplier.name || ''} onChange={e => setDetectedSupplier(p => p ? { ...p, name: e.target.value } : p)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
                                                            </div>
                                                            <div>
                                                                <label className="text-xs font-semibold text-slate-600 mb-1 block">Customer Nickname</label>
                                                                <input type="text" value={detectedSupplier.nickname || ''} onChange={e => setDetectedSupplier(p => p ? { ...p, nickname: e.target.value } : p)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="Short name / alias" />
                                                            </div>
                                                            <div>
                                                                <label className="text-xs font-semibold text-slate-600 mb-1 block">POA (Port of Origin)</label>
                                                                <select value={detectedSupplier.poa || ''} onChange={e => setDetectedSupplier(p => p ? { ...p, poa: e.target.value } : p)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500">
                                                                    <option value="">— Select Port —</option>
                                                                    {[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={`${p.name} (${p.code})`}>{p.name} ({p.code}) — {p.country}</option>)}
                                                                </select>
                                                            </div>
                                                            <div>
                                                                <label className="text-xs font-semibold text-slate-600 mb-1 block">Contact Person</label>
                                                                <input type="text" value={detectedSupplier.contactPerson || ''} onChange={e => setDetectedSupplier(p => p ? { ...p, contactPerson: e.target.value } : p)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                                                            </div>
                                                            <div>
                                                                <label className="text-xs font-semibold text-slate-600 mb-1 block">Email</label>
                                                                <input type="email" value={detectedSupplier.email || ''} onChange={e => setDetectedSupplier(p => p ? { ...p, email: e.target.value } : p)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                                                            </div>
                                                            <div>
                                                                <label className="text-xs font-semibold text-slate-600 mb-1 block">Phone</label>
                                                                <input type="text" value={detectedSupplier.phone || ''} onChange={e => setDetectedSupplier(p => p ? { ...p, phone: e.target.value } : p)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                                                            </div>
                                                            <div>
                                                                <label className="text-xs font-semibold text-slate-600 mb-1 block">Tax ID</label>
                                                                <input type="text" value={detectedSupplier.taxId || ''} onChange={e => setDetectedSupplier(p => p ? { ...p, taxId: e.target.value } : p)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                                                            </div>
                                                            <div>
                                                                <label className="text-xs font-semibold text-slate-600 mb-1 block">Country</label>
                                                                <input type="text" value={detectedSupplier.country || ''} onChange={e => setDetectedSupplier(p => p ? { ...p, country: e.target.value } : p)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                                                            </div>
                                                            <div>
                                                                <label className="text-xs font-semibold text-slate-600 mb-1 block">City</label>
                                                                <input type="text" value={detectedSupplier.city || ''} onChange={e => setDetectedSupplier(p => p ? { ...p, city: e.target.value } : p)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                                                            </div>
                                                            <div>
                                                                <label className="text-xs font-semibold text-slate-600 mb-1 block">State</label>
                                                                <input type="text" value={detectedSupplier.state || ''} onChange={e => setDetectedSupplier(p => p ? { ...p, state: e.target.value } : p)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                                                            </div>
                                                            <div>
                                                                <label className="text-xs font-semibold text-slate-600 mb-1 block">Location / Address</label>
                                                                <input type="text" value={detectedSupplier.location || ''} onChange={e => setDetectedSupplier(p => p ? { ...p, location: e.target.value } : p)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                                                            </div>
                                                            <div className="col-span-2">
                                                                <label className="text-xs font-semibold text-slate-600 mb-1 block">Pickup Location</label>
                                                                <input type="text" value={detectedSupplier.pickupLocation || ''} onChange={e => setDetectedSupplier(p => p ? { ...p, pickupLocation: e.target.value } : p)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="If different from company address" />
                                                            </div>
                                                            <div>
                                                                <label className="text-xs font-semibold text-slate-600 mb-1 block">Payment Terms</label>
                                                                <input type="text" value={detectedSupplier.paymentTerms || ''} onChange={e => setDetectedSupplier(p => p ? { ...p, paymentTerms: e.target.value } : p)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                                                            </div>
                                                            <div>
                                                                <label className="text-xs font-semibold text-slate-600 mb-1 block">Rating (1-5)</label>
                                                                <input type="number" min={1} max={5} value={detectedSupplier.rating || 3} onChange={e => setDetectedSupplier(p => p ? { ...p, rating: Number(e.target.value) } : p)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="p-6 border-t border-slate-100 flex justify-end gap-3">
                                                        <button onClick={() => { setDetectedSupplier(null); setShowDetectedSupModal(false); }} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-200">Skip</button>
                                                        <button disabled={savingDetectedSup || !onAddSupplier || !detectedSupplier.name?.trim()} onClick={async () => {
                                                            if (!onAddSupplier || !detectedSupplier.name?.trim()) return;
                                                            setSavingDetectedSup(true);
                                                            const s: Supplier = { id: detectedSupplier.id || `SUP${Date.now()}`, companyId: detectedSupplier.companyId || '', name: detectedSupplier.name, contactPerson: detectedSupplier.contactPerson || '', email: detectedSupplier.email || '', phone: detectedSupplier.phone || '', country: detectedSupplier.country || '', categories: detectedSupplier.categories || [], rating: detectedSupplier.rating || 3, paymentTerms: detectedSupplier.paymentTerms || 'Net 30', taxId: detectedSupplier.taxId, location: detectedSupplier.location, city: detectedSupplier.city, state: detectedSupplier.state };
                                                            await onAddSupplier(s);
                                                            setOfferForm(prev => ({ ...prev, supplierId: s.id, supplierName: s.name }));
                                                            setDetectedSupplier(null);
                                                            setShowDetectedSupModal(false);
                                                            setSavingDetectedSup(false);
                                                        }} className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                                                            {savingDetectedSup ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                                            Save Supplier
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* ── Detected Product Modal ── */}
                                        {editingProductIdx !== null && detectedProducts[editingProductIdx] && (() => {
                                            const dp = detectedProducts[editingProductIdx];
                                            const updateProd = (patch: Partial<Product>) => setDetectedProducts(prev => prev.map((p, i) => i === editingProductIdx ? { ...p, ...patch } : p));
                                            const updateSpec = (key: string, val: string) => setDetectedProducts(prev => prev.map((p, i) => i === editingProductIdx ? { ...p, specs: { ...p.specs, [key]: val } } : p));
                                            return (
                                                <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4" onClick={() => setEditingProductIdx(null)}>
                                                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                                                        <div className="p-6 border-b border-slate-100">
                                                            <div className="flex items-center justify-between">
                                                                <div>
                                                                    <h3 className="text-lg font-bold text-slate-900">New Product Detected</h3>
                                                                    <p className="text-xs text-slate-500 mt-1">Review and edit the details, then save to your database.</p>
                                                                </div>
                                                                <button onClick={() => setEditingProductIdx(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                                                            </div>
                                                        </div>
                                                        <div className="p-6 space-y-4">
                                                            <div className="grid grid-cols-2 gap-4">
                                                                <div className="col-span-2">
                                                                    <label className="text-xs font-semibold text-slate-600 mb-1 block">System Product Name *</label>
                                                                    <select value={dp.description || ''} onChange={e => updateProd({ description: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500">
                                                                        <option value="">— Select System Product Name —</option>
                                                                        {Array.from(new Set(products.map(p => p.name).filter(Boolean))).sort().map(name => <option key={name} value={name}>{name}</option>)}
                                                                    </select>
                                                                </div>
                                                                <div className="col-span-2">
                                                                    <label className="text-xs font-semibold text-slate-600 mb-1 block">Supplier Product Name</label>
                                                                    <input type="text" value={dp.name || ''} onChange={e => updateProd({ name: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                                                                </div>
                                                                <div>
                                                                    <label className="text-xs font-semibold text-slate-600 mb-1 block">Category</label>
                                                                    <select value={dp.category || 'Resin'} onChange={e => updateProd({ category: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500">
                                                                        <option value="Resin">Resin</option>
                                                                        <option value="Fiber Textile">Fiber Textile</option>
                                                                        <option value="Recycled">Recycled</option>
                                                                        <option value="Waste">Waste</option>
                                                                        <option value="Other">Other</option>
                                                                    </select>
                                                                </div>
                                                                <div>
                                                                    <label className="text-xs font-semibold text-slate-600 mb-1 block">Grade</label>
                                                                    <input type="text" value={dp.grade || ''} onChange={e => updateProd({ grade: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                                                                </div>
                                                                <div>
                                                                    <label className="text-xs font-semibold text-slate-600 mb-1 block">HS Code</label>
                                                                    <input type="text" value={dp.hsCode || ''} onChange={e => updateProd({ hsCode: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                                                                </div>
                                                                <div>
                                                                    <label className="text-xs font-semibold text-slate-600 mb-1 block">Supplier</label>
                                                                    <input type="text" value={dp.supplier || ''} onChange={e => updateProd({ supplier: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                                                                </div>
                                                                <div>
                                                                    <label className="text-xs font-semibold text-slate-600 mb-1 block">SKU</label>
                                                                    <input type="text" value={dp.sku || ''} onChange={e => updateProd({ sku: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                                                                </div>
                                                                <div>
                                                                    <label className="text-xs font-semibold text-slate-600 mb-1 block">Price ($/lb)</label>
                                                                    <input type="number" step="0.01" value={dp.price || 0} onChange={e => updateProd({ price: Number(e.target.value) })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                                                                </div>
                                                                <div>
                                                                    <label className="text-xs font-semibold text-slate-600 mb-1 block">Stock Status</label>
                                                                    <select value={dp.stockStatus || 'Available'} onChange={e => updateProd({ stockStatus: e.target.value as any })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500">
                                                                        <option value="Available">Available</option>
                                                                        <option value="Low Stock">Low Stock</option>
                                                                        <option value="Backorder">Backorder</option>
                                                                    </select>
                                                                </div>
                                                            </div>
                                                            <div className="border-t border-slate-100 pt-4">
                                                                <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">Specifications</h4>
                                                                <div className="grid grid-cols-2 gap-4">
                                                                    <div>
                                                                        <label className="text-xs font-semibold text-slate-600 mb-1 block">Origin</label>
                                                                        <input type="text" value={(dp.specs as any)?.origin || ''} onChange={e => updateSpec('origin', e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                                                                    </div>
                                                                    <div>
                                                                        <label className="text-xs font-semibold text-slate-600 mb-1 block">Type</label>
                                                                        <input type="text" value={(dp.specs as any)?.type || ''} onChange={e => updateSpec('type', e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                                                                    </div>
                                                                    <div>
                                                                        <label className="text-xs font-semibold text-slate-600 mb-1 block">Color</label>
                                                                        <input type="text" value={(dp.specs as any)?.color || ''} onChange={e => updateSpec('color', e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                                                                    </div>
                                                                    <div>
                                                                        <label className="text-xs font-semibold text-slate-600 mb-1 block">Form</label>
                                                                        <select value={(dp.specs as any)?.form || ''} onChange={e => updateSpec('form', e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500">
                                                                            <option value="">— Select —</option>
                                                                            <option value="Pellets">Pellets</option>
                                                                            <option value="Powder">Powder</option>
                                                                            <option value="Flakes">Flakes</option>
                                                                            <option value="Granules">Granules</option>
                                                                            <option value="Fiber">Fiber</option>
                                                                            <option value="Film">Film</option>
                                                                            <option value="Sheet">Sheet</option>
                                                                            <option value="Liquid">Liquid</option>
                                                                            <option value="Bales">Bales</option>
                                                                            <option value="Other">Other</option>
                                                                        </select>
                                                                    </div>
                                                                    {['reinforced', 'additives', 'rv', 'process', 'mfr'].map(key => (
                                                                        <div key={key}>
                                                                            <label className="text-xs font-semibold text-slate-600 mb-1 block capitalize">{key === 'mfr' ? 'MFR' : key === 'rv' ? 'RV' : key}</label>
                                                                            <input type="text" value={(dp.specs as any)?.[key] || ''} onChange={e => updateSpec(key, e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="p-6 border-t border-slate-100 flex items-center justify-between">
                                                            <span className="text-xs text-slate-400">Product {editingProductIdx + 1} of {detectedProducts.length}</span>
                                                            <div className="flex gap-3">
                                                                <button onClick={() => { setDetectedProducts(prev => prev.filter((_, i) => i !== editingProductIdx)); setEditingProductIdx(null); }} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-200">Skip</button>
                                                                <button disabled={savingDetectedProd || !onAddProduct || !dp.name?.trim()} onClick={async () => {
                                                                    if (!onAddProduct || !dp.name?.trim()) return;
                                                                    setSavingDetectedProd(true);
                                                                    const systemName = dp.description || dp.name?.trim() || '';
                                                                    const prod: Product = { id: dp.id || `P${Date.now()}`, companyId: dp.companyId || '', name: systemName, supplierProductName: dp.name || '', category: dp.category || 'Resin', grade: dp.grade || '', hsCode: dp.hsCode || '', supplier: dp.supplier || '', sku: dp.sku, price: dp.price || 0, stockStatus: (dp.stockStatus || 'Available') as any, specs: dp.specs || {} };
                                                                    await onAddProduct(prod);
                                                                    setDetectedProducts(prev => prev.filter((_, i) => i !== editingProductIdx));
                                                                    setEditingProductIdx(null);
                                                                    setSavingDetectedProd(false);
                                                                }} className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
                                                                    {savingDetectedProd ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                                                    Save Product
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        {/* Quick Add Supplier Overlay */}
                                        {quickAddSupplier && (
                                            <div className="absolute inset-0 bg-white/90 z-10 flex items-center justify-center rounded-xl backdrop-blur-sm">
                                                <div className="bg-white p-6 rounded-lg shadow-xl border border-slate-200 w-80 space-y-4">
                                                    <h4 className="font-bold text-lg">Quick Add Supplier</h4>
                                                    <input type="text" value={newSupName} onChange={(e) => setNewSupName(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="Supplier name" autoFocus />
                                                    <div className="flex justify-end gap-2">
                                                        <button type="button" onClick={() => setQuickAddSupplier(false)} className="px-3 py-1.5 bg-slate-100 rounded text-sm">Cancel</button>
                                                        <button type="button" disabled={!newSupName.trim()} onClick={async () => {
                                                            if (!onAddSupplier || !newSupName.trim()) return;
                                                            const cid = currentCompanyId === 'ALL' ? '' : currentCompanyId;
                                                            const s: Supplier = { id: `SUP${Date.now()} `, companyId: cid, name: newSupName.trim(), contactPerson: 'N/A', email: 'tbd@example.com', phone: 'N/A', country: 'Unknown', categories: [], rating: 3, paymentTerms: 'Net 30' };
                                                            await onAddSupplier(s);
                                                            setOfferForm(prev => ({ ...prev, supplierId: s.id, supplierName: s.name }));
                                                            setNewSupName(''); setQuickAddSupplier(false);
                                                        }} className="px-3 py-1.5 bg-emerald-600 text-white rounded text-sm disabled:opacity-50">Add</button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        {/* Quick Add Product Overlay */}
                                        {quickAddProduct && (
                                            <div className="absolute inset-0 bg-white/90 z-10 flex items-center justify-center rounded-xl backdrop-blur-sm">
                                                <div className="bg-white p-6 rounded-lg shadow-xl border border-slate-200 w-80 space-y-4">
                                                    <h4 className="font-bold text-lg">Quick Add Product</h4>
                                                    <input type="text" value={newProdName} onChange={(e) => setNewProdName(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="Product name" autoFocus />
                                                    <div className="flex justify-end gap-2">
                                                        <button type="button" onClick={() => setQuickAddProduct(false)} className="px-3 py-1.5 bg-slate-100 rounded text-sm">Cancel</button>
                                                        <button type="button" disabled={!newProdName.trim()} onClick={async () => {
                                                            if (!onAddProduct || !newProdName.trim()) return;
                                                            const cid = currentCompanyId === 'ALL' ? '' : currentCompanyId;
                                                            const p: Product = { id: `P${Date.now()} `, companyId: cid, name: newProdName.trim(), category: 'Resin', grade: 'New', hsCode: '', supplier: offerForm.supplierName || '', price: 0, stockStatus: 'Available', specs: { origin: 'Unknown', type: 'N/A', color: 'N/A', reinforced: 'N/A', additives: 'N/A', form: 'Pellets' } };
                                                            await onAddProduct(p);
                                                            setAddItem(prev => ({ ...prev, productName: p.name }));
                                                            setNewProdName(''); setQuickAddProduct(false);
                                                        }} className="px-3 py-1.5 bg-emerald-600 text-white rounded text-sm disabled:opacity-50">Add</button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        {/* Quick Add Port Overlay */}
                                        {quickAddPort && (
                                            <div className="absolute inset-0 bg-white/95 z-20 flex items-center justify-center rounded-xl backdrop-blur-sm">
                                                <div className="bg-white p-6 rounded-lg shadow-xl border border-slate-200 w-80 space-y-4">
                                                    <h4 className="font-bold text-lg flex items-center gap-2"><Anchor size={20} /> Quick Add Port</h4>
                                                    <input className="w-full border border-slate-300 rounded p-2 text-sm uppercase font-mono" placeholder="Code (3-5 Letters)" maxLength={5} value={newPortCode} onChange={e => setNewPortCode(e.target.value.toUpperCase())} />
                                                    <input className="w-full border border-slate-300 rounded p-2 text-sm" placeholder="Port Name" value={newPortName} onChange={e => setNewPortName(e.target.value)} />
                                                    <input className="w-full border border-slate-300 rounded p-2 text-sm" placeholder="Country" value={newPortCountry} onChange={e => setNewPortCountry(e.target.value)} />
                                                    <div className="flex justify-end gap-2">
                                                        <button type="button" onClick={() => setQuickAddPort(null)} className="px-3 py-1.5 bg-slate-100 rounded text-sm">Cancel</button>
                                                        <button type="button" disabled={!newPortCode || !newPortName} onClick={async () => {
                                                            if (!onAddPort) return;
                                                            const pt: Port = { id: `PRT${Date.now()} `, companyId: 'ALL', code: newPortCode, name: newPortName, country: newPortCountry };
                                                            await onAddPort(pt);
                                                            const portStr = `${pt.name} (${pt.code})`;
                                                            if (quickAddPort === 'origin') setOfferForm(prev => ({ ...prev, originPort: portStr }));
                                                            else setOfferForm(prev => ({ ...prev, destinationPort: portStr }));
                                                            setNewPortCode(''); setNewPortName(''); setNewPortCountry(''); setQuickAddPort(null);
                                                        }} className="px-3 py-1.5 bg-emerald-600 text-white rounded text-sm disabled:opacity-50">Add</button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Supplier / Incoterm / Payment Terms */}
                                        <div className="grid grid-cols-3 gap-4">
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Supplier</label>
                                                <select
                                                    className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                                                    value={offerForm.supplierId || ''}
                                                    onChange={e => {
                                                        if (e.target.value === '_ADD_NEW_') { setQuickAddSupplier(true); return; }
                                                        const sup = suppliers.find(s => s.id === e.target.value);
                                                        setOfferForm(prev => ({
                                                            ...prev,
                                                            supplierId: e.target.value,
                                                            supplierName: sup ? sup.name : '',
                                                            // Auto-populate Port of Origin from supplier's POA
                                                            originPort: sup?.poa || prev.originPort
                                                        }));
                                                    }}
                                                >
                                                    <option value="">-- Select --</option>
                                                    {onAddSupplier && <option value="_ADD_NEW_" className="font-bold text-emerald-600">+ Add New Supplier</option>}
                                                    {[...suppliers].sort((a, b) => a.name.localeCompare(b.name)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                                </select>
                                                {!offerForm.supplierId && offerForm.supplierName && (
                                                    <p className="text-xs text-amber-600 mt-1">OCR detected: {offerForm.supplierName}</p>
                                                )}
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Incoterm</label>
                                                <select className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white" value={offerForm.incoterm} onChange={e => setOfferForm(prev => ({ ...prev, incoterm: e.target.value as any }))}>
                                                    <option value="EXW">EXW — Ex Works</option>
                                                    <option value="FCA">FCA — Free Carrier</option>
                                                    <option value="FAS">FAS — Free Alongside Ship</option>
                                                    <option value="FOB">FOB — Free on Board</option>
                                                    <option value="CPT">CPT — Carriage Paid To</option>
                                                    <option value="CFR">CFR — Cost and Freight</option>
                                                    <option value="CIF">CIF — Cost + Insurance + Freight</option>
                                                    <option value="CIP">CIP — Carriage & Insurance Paid</option>
                                                    <option value="DAP">DAP — Delivered at Place</option>
                                                    <option value="DPU">DPU — Delivered at Place Unloaded</option>
                                                    <option value="DDP">DDP — Delivered Duty Paid</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Payment Terms</label>
                                                <select className="w-full border border-slate-300 rounded-lg p-2 text-sm" value={offerForm.paymentTerms} onChange={e => setOfferForm(prev => ({ ...prev, paymentTerms: e.target.value }))}>
                                                    {PAYMENT_TERM_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                                                </select>
                                            </div>
                                        </div>

                                        {/* Currency / Valid Until */}
                                        <div className="grid grid-cols-3 gap-4">
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Currency</label>
                                                <select className="w-full border border-slate-300 rounded-lg p-2 text-sm" value={offerForm.currency} onChange={e => setOfferForm(prev => ({ ...prev, currency: e.target.value as any }))}>
                                                    <option value="USD">USD</option><option value="EUR">EUR</option><option value="CNY">CNY</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Valid Until</label>
                                                <input type="date" className="w-full border border-slate-300 rounded-lg p-2 text-sm" value={offerForm.validUntil || ''} onChange={e => setOfferForm(prev => ({ ...prev, validUntil: e.target.value }))} />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Loading Location</label>
                                                <input className="w-full border border-slate-300 rounded-lg p-2 text-sm" placeholder="Factory address" value={offerForm.loadingLocation || ''} onChange={e => setOfferForm(prev => ({ ...prev, loadingLocation: e.target.value }))} />
                                            </div>
                                        </div>

                                        {/* Ports */}
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1"><Anchor size={12} className="inline" /> Port of Origin</label>
                                                <select className="w-full border border-slate-300 rounded-lg p-2 text-sm" value={offerForm.originPort || ''} onChange={e => {
                                                    if (e.target.value === '_ADD_NEW_') { setQuickAddPort('origin'); return; }
                                                    setOfferForm(prev => ({ ...prev, originPort: e.target.value }));
                                                }}>
                                                    <option value="">Select...</option>
                                                    {onAddPort && <option value="_ADD_NEW_" className="font-bold text-emerald-600">+ Add Port</option>}
                                                    {[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={`${p.name} (${p.code})`}>{p.name} ({p.code})</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1"><Anchor size={12} className="inline" /> Port of Destination</label>
                                                <select className="w-full border border-slate-300 rounded-lg p-2 text-sm" value={offerForm.destinationPort || ''} onChange={e => {
                                                    if (e.target.value === '_ADD_NEW_') { setQuickAddPort('destination'); return; }
                                                    setOfferForm(prev => ({ ...prev, destinationPort: e.target.value }));
                                                }}>
                                                    <option value="">Select...</option>
                                                    {onAddPort && <option value="_ADD_NEW_" className="font-bold text-emerald-600">+ Add Port</option>}
                                                    {[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={`${p.name} (${p.code})`}>{p.name} ({p.code})</option>)}
                                                </select>
                                            </div>
                                        </div>

                                        {/* Add Items */}
                                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
                                            <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">Add Items</h4>
                                            <div className="space-y-2">
                                                <div>
                                                    <label className="block text-[10px] text-slate-500 mb-1">Product</label>
                                                    <select className="w-full border border-slate-300 rounded-lg p-2 text-sm" value={addItem.productName || ''} onChange={e => {
                                                        if (e.target.value === '_ADD_NEW_') { setQuickAddProduct(true); return; }
                                                        setAddItem(prev => ({ ...prev, productName: e.target.value }));
                                                    }}>
                                                        <option value="">Select...</option>
                                                        {onAddProduct && <option value="_ADD_NEW_" className="font-bold text-emerald-600">+ Add Product</option>}
                                                        {[...products].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.name}>{p.name} ({p.grade})</option>)}
                                                    </select>
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <QuantityInput value={addItem.quantity || 0} onChange={val => setAddItem(prev => ({ ...prev, quantity: val }))} label="Quantity" />
                                                    <PriceInput value={addItem.unitPrice || 0} onChange={val => setAddItem(prev => ({ ...prev, unitPrice: val }))} label="Unit Price" />
                                                </div>
                                                <div className="flex items-end gap-2">
                                                    <button type="button" onClick={handleAddOfferItem} className={`${editingOfferItemIndex !== null ? 'bg-amber-500 hover:bg-amber-600' : 'bg-emerald-600 hover:bg-emerald-700'} text-white p-2 rounded-lg w-full flex items-center justify-center gap-1 text-xs font-bold`}><Plus size={14} /> {editingOfferItemIndex !== null ? 'Update Item' : 'Add Item'}</button>
                                                    {editingOfferItemIndex !== null && <button type="button" onClick={() => { setEditingOfferItemIndex(null); setAddItem({ productName: '', quantity: 0, unitPrice: 0, moq: 0, leadTime: '' }); }} className="bg-slate-200 text-slate-600 p-2 rounded-lg hover:bg-slate-300 text-xs font-bold">Cancel</button>}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Items Table */}
                                        {(offerForm.items || []).length > 0 && (
                                            <div>
                                                <table className="w-full text-left text-sm">
                                                    <thead className="bg-slate-50 text-slate-500 text-xs">
                                                        <tr>
                                                            <th className="p-2">Supplier Product Name</th>
                                                            <th className="p-2">System Product Name</th>
                                                            <th className="p-2 text-right">Qty (lbs / kg)</th>
                                                            <th className="p-2 text-right">$/lb / $/kg</th>
                                                            <th className="p-2 text-right">Total</th>
                                                            <th className="p-2 w-10"></th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {(offerForm.items || []).map((item, idx) => (
                                                            <tr key={idx} className="border-b border-slate-100">
                                                                <td className="p-2 font-medium">{item.productName}</td>
                                                                <td className="p-2 text-slate-600">
                                                                    <select
                                                                        className="w-full border border-slate-200 rounded p-1 text-xs bg-white"
                                                                        value={item.systemProductName || (() => { const mp = products.find(p => p.supplierProductName === item.productName || p.name === item.productName); return mp?.name || ''; })()}
                                                                        onChange={e => {
                                                                            setOfferForm(prev => {
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
                                                                <td className="p-2 text-right tabular-nums">
                                                                    <div className="flex flex-col items-end">
                                                                        <span>{item.quantity.toLocaleString()} lbs</span>
                                                                        <span className="text-xs text-slate-400">{lbsToKgs(item.quantity).toLocaleString(undefined, { maximumFractionDigits: 0 })} kg</span>
                                                                    </div>
                                                                </td>
                                                                <td className="p-2 text-right tabular-nums">
                                                                    <div className="flex flex-col items-end">
                                                                        <span>${item.unitPrice.toFixed(4)}/lb</span>
                                                                        <span className="text-xs text-slate-400">${pricePerKg(item.unitPrice).toFixed(4)}/kg</span>
                                                                    </div>
                                                                </td>

                                                                <td className="p-2 text-right font-bold tabular-nums">${item.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                                                <td className="p-2 text-center">
                                                                    <div className="flex items-center justify-center gap-1">
                                                                        <button type="button" onClick={() => { setAddItem({ productName: item.productName, quantity: item.quantity, unitPrice: item.unitPrice, moq: item.moq, leadTime: item.leadTime }); setEditingOfferItemIndex(idx); }} className="text-indigo-400 hover:text-indigo-600" title="Edit item"><Pencil size={14} /></button>
                                                                        <button type="button" onClick={() => handleRemoveOfferItem(idx)} className="text-red-400 hover:text-red-600" title="Delete item"><Trash2 size={14} /></button>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                    <tfoot>
                                                        <tr>
                                                            <td colSpan={5} className="p-2 text-right font-bold uppercase text-slate-500">Total Amount</td>
                                                            <td className="p-2 text-right font-bold text-lg text-emerald-600 tabular-nums">${offerForm.totalAmount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                                            <td></td>
                                                        </tr>
                                                    </tfoot>
                                                </table>
                                            </div>
                                        )}

                                        {/* Notes */}
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Notes</label>
                                            <textarea className="w-full border border-slate-300 rounded-lg p-2 text-sm" rows={2} value={offerForm.notes || ''} onChange={e => setOfferForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="Additional notes..." />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Modal Footer */}
                            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
                                <button onClick={() => setShowAddModal(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
                                <button
                                    onClick={handleSaveOffer}
                                    disabled={addSaving || !(offerForm.items || []).length}
                                    className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50"
                                >
                                    {addSaving ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : <><Save size={16} /> Save Offer</>}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default CostProfitAI;
