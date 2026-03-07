import React, { useState, useRef, useEffect } from 'react';
import {
    Upload, Edit3, FileText, ArrowRight, ArrowLeft, FileCheck, Package,
    Search, X, Loader2, CheckCircle2, AlertCircle, Plus, Trash2, Eye,
    Download, Save, FileSpreadsheet, ClipboardList, ChevronRight,
    Ship, Truck, Calendar, Building, Users, DollarSign, CreditCard,
    Printer, Mail, Link2, RefreshCw, MoreVertical, ExternalLink, Filter, Send
} from 'lucide-react';
import { PackingList, Invoice, Customer, Company, SalesOrder, Booking, BillOfLading, Port, Bank, CompanyImage } from '../types';
import { getSupabaseClient } from '../services/supabase';
import { useSupabase } from '../hooks/useSupabase';
import { analyzeDocument } from '../services/geminiService';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import QuickAddModal from '../components/QuickAddModal';
import { FormattedInput } from '../components/UnitInputs';
import PDFPreviewModal from '../components/PDFPreviewModal';
import { sendEmail } from '../services/emailService';

// ============================================================================
// TYPES
// ============================================================================

type WizardStep = 'UPLOAD' | 'EDIT_PL' | 'CREATE_INVOICE';

interface PLItem {
    id: string;
    containerNo: string;
    sealNo: string;
    grossLbs: number;
    netLbs: number;
    grossKg: number;
    netKg: number;
    volumes: number;
    supplier: string;
    description: string;
    blNumber: string;
    originalDoc?: string;
    productId?: string;
    productName?: string;
    productGrade?: string;
    productDescription?: string;
    customerDescription?: string;
    hsCode?: string;
    unitPrice?: number;
    amount?: number;
    quantity?: number;
}

interface InvoiceLineItem {
    id: string;
    description: string;
    customerDescription: string;
    hsCode: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    unitPriceLbs: number;
    unitPriceKg: number;
    amount: number;
    productId?: string;
    containerNo?: string;
    sealNo?: string;
    grossLbs?: number;
    netLbs?: number;
    grossKg?: number;
    netKg?: number;
    volumes?: number;
    productDescription?: string;
}

interface ContainerRow {
    id: string;
    container: string;
    seal: string;
}

interface BankProfile {
    id: string;
    bankName: string;
    bankAddress: string;
    routingNumber: string;
    swiftCode: string;
    accountNumber: string;
}

interface FileQueueItem {
    id: string;
    file: File;
    status: 'idle' | 'processing' | 'completed' | 'error';
    base64?: string;
}

type ContainerSummary = {
    containerNo: string;
    sealNo: string;
    grossLbs: number;
    netLbs: number;
    grossKg: number;
    netKg: number;
    volumes: number;
};

interface PLInvoiceEngineProps {
    packingLists: PackingList[];
    customers: Customer[];
    invoices: Invoice[];
    salesOrders: SalesOrder[];
    bookings?: Booking[];
    billOfLadings?: BillOfLading[];
    ports?: Port[];
    onSaveInvoice: (inv: Invoice) => void;
    onUpdateInvoice: (inv: Invoice) => void;
    onDeleteInvoice: (id: string) => Promise<boolean>;
    currentCompanyId: string;
    availableCompanies: Company[];
    onRefreshData?: () => Promise<void>;
    banks?: Bank[];
}

// ============================================================================
// COMPONENT
// ============================================================================

const PLInvoiceEngine: React.FC<PLInvoiceEngineProps> = ({
    packingLists,
    customers,
    invoices,
    salesOrders,
    bookings = [],
    billOfLadings = [],
    ports = [],
    onSaveInvoice,
    onUpdateInvoice,
    onDeleteInvoice,
    currentCompanyId,
    availableCompanies,
    onRefreshData,
    banks: banksProp = []
}) => {
    // ========================================================================
    // WIZARD STATE
    // ========================================================================
    const [currentStep, setCurrentStep] = useState<WizardStep>('UPLOAD');
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingError, setProcessingError] = useState<string | null>(null);
    const [dragActive, setDragActive] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ========================================================================
    // PL STATE (Step 2)
    // ========================================================================
    const [plNumber, setPlNumber] = useState('');
    const [soNumber, setSoNumber] = useState('');
    const [plDate, setPlDate] = useState(new Date().toISOString().split('T')[0]);
    const [supplier, setSupplier] = useState('');
    const [consignee, setConsignee] = useState('');
    const [containerNumber, setContainerNumber] = useState('');
    const [sealNumber, setSealNumber] = useState('');
    const [grossWeight, setGrossWeight] = useState('');
    const [netWeight, setNetWeight] = useState('');
    const [unitCount, setUnitCount] = useState('');
    const [plItems, setPlItems] = useState<PLItem[]>([]);
    const [editingPLId, setEditingPLId] = useState<string | null>(null);
    const [savedPLs, setSavedPLs] = useState<PackingList[]>(packingLists || []);
    const [supplierPLs, setSupplierPLs] = useState<any[]>([]);
    const [products, setProducts] = useState<any[]>([]);
    const [suppliers, setSuppliers] = useState<any[]>([]);
    const [selectedBookingId, setSelectedBookingId] = useState('');
    const [bookingNumber, setBookingNumber] = useState('');
    const [isAddingNewBooking, setIsAddingNewBooking] = useState(false);
    const [shipper, setShipper] = useState('');
    const [companies, setCompanies] = useState<Company[]>([]);
    const [plFilter, setPlFilter] = useState<'AVAILABLE' | 'INVOICED'>('AVAILABLE');
    const [invoiceFilterNumber, setInvoiceFilterNumber] = useState<string[]>([]);
    const [invoiceFilterCustomer, setInvoiceFilterCustomer] = useState<string[]>([]);
    const [openFilterPopup, setOpenFilterPopup] = useState<'invoice' | 'customer' | null>(null);

    // OCR/File Queue State
    const [pendingFiles, setPendingFiles] = useState<FileQueueItem[]>([]);
    const [statusMessage, setStatusMessage] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    // ========================================================================
    // INVOICE STATE (Step 3)
    // ========================================================================
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
    const [transportRef, setTransportRef] = useState('');
    const [selectedCustomerId, setSelectedCustomerId] = useState('');
    const [billToName, setBillToName] = useState('');
    const [billToAddress, setBillToAddress] = useState('');
    const [pod, setPod] = useState('');
    const [poa, setPoa] = useState('');
    const [incoterm, setIncoterm] = useState('');
    const [paymentTerms, setPaymentTerms] = useState('ADV - 100% ADVANCED');
    const [memo, setMemo] = useState('');
    const [invoiceItems, setInvoiceItems] = useState<InvoiceLineItem[]>([]);
    const [containers, setContainers] = useState<ContainerRow[]>([]);
    const [banks, setBanks] = useState<BankProfile[]>([]);
    const [selectedBankId, setSelectedBankId] = useState('');
    const [bankName, setBankName] = useState('');
    const [bankAddress, setBankAddress] = useState('');
    const [accountNumber, setAccountNumber] = useState('');
    const [swiftCode, setSwiftCode] = useState('');
    const [routingNumber, setRoutingNumber] = useState('');
    const [savedInvoices, setSavedInvoices] = useState<Invoice[]>(invoices);
    const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
    const [currentPL, setCurrentPL] = useState<PackingList | null>(null);
    const [customerPo, setCustomerPo] = useState('');
    const [incotermsOptions] = useState(['EXW', 'FCA', 'CPT', 'CIP', 'DAT', 'DAP', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF']);

    const [documentsModalOpen, setDocumentsModalOpen] = useState(false);
    const [selectedDocInvoice, setSelectedDocInvoice] = useState<Invoice | null>(null);
    const [uploadingBOL, setUploadingBOL] = useState(false);
    const bolInputRef = useRef<HTMLInputElement>(null);

    // Email Documents State
    const [sendingEmail, setSendingEmail] = useState(false);
    const [brMode, setBrMode] = useState(false);
    const [emailStatus, setEmailStatus] = useState<{ show: boolean; success: boolean; message: string }>({ show: false, success: false, message: '' });

    // Email Preview Modal State
    const [emailPreviewOpen, setEmailPreviewOpen] = useState(false);
    const [emailDraft, setEmailDraft] = useState<{
        invoice: Invoice | null;
        to: string;
        cc: string;
        subject: string;
        htmlBody: string;
        attachments: { name: string; contentBytes: string; contentType: string }[];
    }>({ invoice: null, to: '', cc: '', subject: '', htmlBody: '', attachments: [] });

    // Upload PL Modal State
    const [uploadModalOpen, setUploadModalOpen] = useState(false);
    const [modalDragActive, setModalDragActive] = useState(false);

    // Logo (fetched from imagens table in fetchData)
    const [logoUrl, setLogoUrl] = useState<string | null>(null);
    const [stampUrl, setStampUrl] = useState<string | null>(null);

    // PDF Preview Modal State
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewTitle, setPreviewTitle] = useState('');
    const [previewFileName, setPreviewFileName] = useState('');
    const [previewDownloadFn, setPreviewDownloadFn] = useState<(() => void) | null>(null);
    const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);

    // Bookings - use prop as initial value, fallback to fetch
    const [allBookings, setAllBookings] = useState(bookings);


    // ========================================================================
    // EFFECTS
    // ========================================================================
    // Auto-refresh data when component mounts (fetch latest PLs, invoices, etc.)
    useEffect(() => {
        if (onRefreshData) {
            console.log('[PLInvoiceEngine] Auto-refreshing data on mount...');
            onRefreshData().then(() => {
                console.log('[PLInvoiceEngine] Data refresh complete');
            }).catch(err => {
                console.error('[PLInvoiceEngine] Data refresh failed:', err);
            });
        }
    }, []); // Empty dependency array = run once on mount

    // Sync savedPLs with packingLists prop when it changes
    useEffect(() => {
        console.log('[PLInvoiceEngine] packingLists PROP received:', packingLists?.length || 0, 'items');
        if (packingLists && packingLists.length > 0) {
            setSavedPLs(packingLists);
            console.log('[PLInvoiceEngine] Synced savedPLs from prop:', packingLists.length, 'items');
        }
    }, [packingLists]);

    // Sync allBookings with bookings prop when it changes
    useEffect(() => {
        console.log('[PLInvoiceEngine] bookings PROP received:', bookings?.length || 0, 'items');
        if (bookings && bookings.length > 0) {
            setAllBookings(bookings);
            console.log('[PLInvoiceEngine] Synced allBookings from prop:', bookings.length, 'items');
        }
    }, [bookings]);

    // Save a new booking to the bookings table with status AVAILABLE
    const saveNewBooking = async (newBookingNumber: string) => {
        const client = getSupabaseClient();
        if (!client || !newBookingNumber.trim()) return;

        // Check if this booking already exists with AVAILABLE status
        const existingAvailable = allBookings.find((b: any) => b.bookingNumber === newBookingNumber && b.status !== 'SHIPPED');
        if (existingAvailable) {
            console.log('[saveNewBooking] AVAILABLE booking already exists:', newBookingNumber);
            return;
        }

        try {
            const newBooking = {
                id: `BK${Date.now()}`,
                companyId: currentCompanyId,
                bookingNumber: newBookingNumber.trim(),
                customer: consignee || 'TBD',
                vesselVoyage: '',
                pol: '',
                pod: '',
                equipment: '',
                etd: '',
                eta: '',
                status: 'AVAILABLE',
                createdAt: new Date().toISOString()
            };

            const { error } = await client.from('bookings').insert(newBooking);
            if (error) {
                console.error('[saveNewBooking] Error:', error);
                return;
            }

            console.log('[saveNewBooking] Saved new booking:', newBookingNumber);
            setAllBookings((prev: any) => [newBooking, ...prev]);
        } catch (err) {
            console.error('[saveNewBooking] Exception:', err);
        }
    };

    // Fetch Logo (dedicated effect - mimics InvoiceEngine.tsx)
    // DEBUG: Log incoming invoices to verify memo is being passed
    useEffect(() => {
        console.log('[PLInvoiceEngine] INVOICES PROP RECEIVED:', invoices.length, 'invoices');
        if (invoices.length > 0) {
            // Log ALL invoices with their bolUrl status
            console.log('[PLInvoiceEngine] === INVOICES BOL STATUS ===');
            invoices.forEach(inv => {
                const bolUrl = (inv as any).bolUrl || (inv as any).bolurl;
                if (bolUrl) {
                    console.log(`[PLInvoiceEngine] ${inv.invoiceNumber}: HAS BOL (length: ${bolUrl.length})`);
                }
            });
            console.log('[PLInvoiceEngine] Sample invoice memo field:', (invoices[0] as any).memo);
            console.log('[PLInvoiceEngine] Sample invoice bolUrl:', (invoices[0] as any).bolUrl, 'bolurl:', (invoices[0] as any).bolurl);
            // Sync savedInvoices with prop so modal gets fresh data
            setSavedInvoices(invoices);
        }
    }, [invoices]);

    useEffect(() => {
        const fetchLogo = async () => {
            const client = getSupabaseClient();
            if (!client) return;

            const targetId = currentCompanyId === 'ALL' ? 'SYSTEM' : currentCompanyId;
            console.log('[PLInvoiceEngine] Fetching logo for companyId:', targetId);

            try {
                const { data } = await client
                    .from('imagens')
                    .select('url')
                    .eq('companyId', targetId)
                    .eq('type', 'LOGO')
                    .single();

                if (data && data.url) {
                    console.log('[PLInvoiceEngine] Logo found, URL length:', data.url.length);
                    setLogoUrl(data.url);
                } else if (targetId !== 'SYSTEM') {
                    // Try system logo if company specific not found
                    console.log('[PLInvoiceEngine] No company logo, trying SYSTEM logo...');
                    const { data: sysData } = await client
                        .from('imagens')
                        .select('url')
                        .eq('companyId', 'SYSTEM')
                        .eq('type', 'LOGO')
                        .single();
                    if (sysData && sysData.url) {
                        console.log('[PLInvoiceEngine] System logo found');
                        setLogoUrl(sysData.url);
                    } else {
                        console.log('[PLInvoiceEngine] No logo found at all');
                        setLogoUrl(null);
                    }
                } else {
                    setLogoUrl(null);
                }
            } catch (e) {
                console.error('[PLInvoiceEngine] Error fetching logo:', e);
            }
        };
        fetchLogo();

        // Load EC4 stamp image
        const loadStamp = async () => {
            try {
                const resp = await fetch('/ec4_stamp.png');
                if (resp.ok) {
                    const blob = await resp.blob();
                    const reader = new FileReader();
                    reader.onload = () => setStampUrl(reader.result as string);
                    reader.readAsDataURL(blob);
                }
            } catch (e) {
                console.warn('[PLInvoiceEngine] Could not load stamp:', e);
            }
        };
        loadStamp();
    }, [currentCompanyId]);

    useEffect(() => {
        console.log('[PLInvoiceEngine] Fetching data for company:', currentCompanyId);
        fetchData();
    }, [currentCompanyId]);

    const fetchData = async () => {
        const client = getSupabaseClient();
        if (!client) return;

        try {
            // Fetch products
            const { data: productsData } = await client.from('products').select('*');
            if (productsData) setProducts(productsData);
        } catch (e) { console.error('Error fetching products:', e); }

        try {
            // Fetch suppliers
            const { data: suppliersData } = await client.from('suppliers').select('*');
            if (suppliersData) setSuppliers(suppliersData);
        } catch (e) { console.error('Error fetching suppliers:', e); }

        try {
            // Use banks from prop instead of fetching
            if (banksProp && banksProp.length > 0) {
                const mappedBanks: BankProfile[] = banksProp.map((b: any) => ({
                    id: b.id,
                    bankName: b.name || '',
                    bankAddress: [b.address_line1, b.address_line2, b.city, b.state, b.zip_code, b.country].filter(Boolean).join(', '),
                    routingNumber: b.routing || b.wire || '',
                    swiftCode: b.swift_code || '',
                    accountNumber: b.account_number || ''
                }));
                setBanks(mappedBanks);
            }
        } catch (e) { console.error('Error mapping banks:', e); }

        try {
            // Fetch saved PLs - prefer larger dataset (prop vs internal fetch)
            const { data: plData, error: plError } = await client.from('packing_lists').select('*').eq('companyId', currentCompanyId).order('createdAt', { ascending: false });
            console.log('[PLInvoiceEngine] Fetched packing_lists:', plData?.length || 0, 'items, error:', plError, 'prop has:', packingLists?.length || 0);
            // Only use internal fetch if it has MORE data than the prop (prop comes from App.tsx with full select)
            if (plData && plData.length > 0 && plData.length >= (packingLists?.length || 0)) {
                setSavedPLs(plData);
            }
        } catch (e) { console.error('Error fetching packing_lists:', e); }

        try {
            // Fetch supplier inbox PLs
            const { data: supplierPLData } = await client.from('packing_lists_suppliers').select('*').eq('companyId', currentCompanyId).order('createdAt', { ascending: false });
            if (supplierPLData) setSupplierPLs(supplierPLData);
        } catch (e) { console.error('Error fetching packing_lists_suppliers:', e); }

        try {
            // Fetch ALL bookings (no company filter to ensure dropdown is populated)
            const { data: bookingsData, error: bookingsError } = await client.from('bookings').select('id, bookingNumber, salesOrderId, customer, status, pol').order('createdAt', { ascending: false });
            console.log('[PLInvoiceEngine] Fetched bookings:', bookingsData?.length || 0, 'error:', bookingsError);
            if (bookingsData && bookingsData.length > 0) setAllBookings(bookingsData as any);
        } catch (e) { console.error('Error fetching bookings:', e); }
        // Logo is fetched in dedicated useEffect above
    };

    // ========================================================================
    // STEP NAVIGATION
    // ========================================================================
    const canProceedToStep2 = () => plItems.length > 0 || editingPLId;
    const canProceedToStep3 = () => plNumber && plItems.length > 0;

    // Reset all PL state fields
    const resetPLState = () => {
        setPlNumber('');
        setSoNumber('');
        setPlDate(new Date().toISOString().split('T')[0]);
        setSupplier('');
        setConsignee('');
        setContainerNumber('');
        setSealNumber('');
        setGrossWeight('');
        setNetWeight('');
        setUnitCount('');
        setPlItems([]);
        setEditingPLId(null);
        setBookingNumber('');
        setShipper('');
        setIsAddingNewBooking(false);
        setStatusMessage('');
    };

    const goToStep = (step: WizardStep) => {
        if (step === 'EDIT_PL' && !canProceedToStep2()) return;
        if (step === 'CREATE_INVOICE' && !canProceedToStep3()) return;

        // Reset PL state when leaving EDIT_PL to go back to UPLOAD
        if (currentStep === 'EDIT_PL' && step === 'UPLOAD') {
            resetPLState();
        }

        setCurrentStep(step);
    };

    // ========================================================================
    // UTILITY FUNCTIONS
    // ========================================================================
    const formatContainerNumber = (val: string) => {
        if (!val) return '';
        return val.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    };

    const generatePLNumber = (bookingNum?: string, existingPLs?: any[]) => {
        if (bookingNum) {
            const numericPart = bookingNum.replace(/\D/g, '');
            if (numericPart) return `PL-${numericPart}`;
        }
        const date = new Date();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const yy = String(date.getFullYear()).slice(-2);
        const datePrefix = `PL-${mm}${dd}${yy}`;
        const sourcePLs = existingPLs || savedPLs;
        const existingShort = sourcePLs.map(pl => pl.plNumber).filter(num => num && num.startsWith(datePrefix));
        if (existingShort.length === 0) return `${datePrefix}A`;
        const usedLetters = existingShort.map(num => num.replace(datePrefix, '')).filter(suffix => /^[A-Z]$/.test(suffix)).sort();
        if (usedLetters.length === 0) return `${datePrefix}A`;
        const lastLetter = usedLetters[usedLetters.length - 1];
        return `${datePrefix}${String.fromCharCode(lastLetter.charCodeAt(0) + 1)}`;
    };

    // ========================================================================
    // TOTALS & CONTAINER SUMMARY
    // ========================================================================
    const totals = plItems.reduce((acc, item) => ({
        grossLbs: acc.grossLbs + (item.grossLbs || 0),
        netLbs: acc.netLbs + (item.netLbs || 0),
        grossKg: acc.grossKg + (item.grossKg || 0),
        netKg: acc.netKg + (item.netKg || 0),
        volumes: acc.volumes + (item.volumes || 0),
    }), { grossLbs: 0, netLbs: 0, grossKg: 0, netKg: 0, volumes: 0 });

    const containerSummary = Object.values(plItems.reduce((acc, item) => {
        const key = item.containerNo || 'Unknown';
        if (!acc[key]) {
            acc[key] = { containerNo: key, sealNo: item.sealNo, grossLbs: 0, netLbs: 0, grossKg: 0, netKg: 0, volumes: 0 };
        }
        acc[key].grossLbs += item.grossLbs || 0;
        acc[key].netLbs += item.netLbs || 0;
        acc[key].grossKg += item.grossKg || 0;
        acc[key].netKg += item.netKg || 0;
        acc[key].volumes += item.volumes || 0;
        if (!acc[key].sealNo && item.sealNo) acc[key].sealNo = item.sealNo;
        return acc;
    }, {} as Record<string, ContainerSummary>)) as ContainerSummary[];

    // ========================================================================
    // OCR PROCESSING (GEMINI AI)
    // ========================================================================
    const processDocument = async (base64Data: string, mimeType: string, filename: string) => {
        const prompt = `
            Analyze this Packing List document.
            Task: Extract shipping data into a structured JSON format.
            
            1. Find the "Booking Number" or "Booking Ref".
               - CRITICAL: Check for the text "CUSTOMER TRUCK". If found, the Booking Number is the value immediately BELOW "CUSTOMER TRUCK".
            2. Find the "Sales Order Number" or "SO Number" or "Order No" or "PO Number" that seems to be the sales reference.
            3. Extract line items representing Containers. For each container, find:
               - Container Number
               - Seal Number
               - Gross Weight (LBS and KG)
               - Net Weight (LBS and KG)
               - Volume / Quantity (e.g., Bales, Cartons, Pallets) -> field "volumes"
               - Supplier / Manufacturer Name
               - Product Description
               - Bill of Lading (BL) Number: Locate "Packing List No." or "Packing List Number" and use this value as the BL Number.
            
            Logic:
            - If weights are only in KG, convert to LBS (1 KG = 2.20462 LBS).
            - If weights are only in LBS, convert to KG (1 LBS = 0.453592 KG).
            - Ensure numeric values are numbers, not strings.
            
            Return JSON object:
            {
                "bookingNumber": "string",
                "soNumber": "string",
                "items": [
                    {
                        "containerNo": "string",
                        "sealNo": "string",
                        "grossLbs": number,
                        "netLbs": number,
                        "grossKg": number,
                        "netKg": number,
                        "volumes": number,
                        "supplier": "string",
                        "description": "string",
                        "blNumber": "string"
                    }
                ]
            }
        `;

        try {
            const result = await analyzeDocument(base64Data, mimeType, prompt);
            console.log("Raw Gemini Response:", result);
            const cleanJson = result.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsedData = JSON.parse(cleanJson);

            const newPlNumber = generatePLNumber(parsedData.bookingNumber);
            setPlNumber(newPlNumber);
            setBookingNumber(parsedData.bookingNumber || '');
            setSoNumber(parsedData.soNumber || '');

            // Auto-populate from SO match
            if (parsedData.soNumber) {
                const matchedSO = salesOrders.find(so => so.orderNumber === parsedData.soNumber);
                if (matchedSO) {
                    const linkedCompany = availableCompanies.find(c => c.id === matchedSO.companyId);
                    if (linkedCompany) setShipper(linkedCompany.name);
                    if (matchedSO.customerName) setConsignee(matchedSO.customerName);
                }
            }

            if (parsedData.items && parsedData.items.length > 0) {
                const firstSupplier = parsedData.items[0].supplier;
                if (firstSupplier) setSupplier(firstSupplier);
            }

            const newItems: PLItem[] = parsedData.items.map((item: any) => ({
                id: Math.random().toString(36).substr(2, 9),
                containerNo: formatContainerNumber(item.containerNo),
                sealNo: item.sealNo || '',
                grossLbs: item.grossLbs || 0,
                netLbs: item.netLbs || 0,
                grossKg: item.grossKg || 0,
                netKg: item.netKg || 0,
                volumes: item.volumes || 0,
                supplier: item.supplier || '',
                description: item.description || '',
                blNumber: item.blNumber || '',
                originalDoc: undefined
            }));

            setPlItems(prev => [...prev, ...newItems]);
        } catch (error) {
            console.error('Error processing document:', error);
            setStatusMessage('Error analyzing document. Please try again.');
            throw error;
        }
    };

    const processQueue = async () => {
        const filesToProcess = pendingFiles.filter(f => f.status === 'idle' || f.status === 'error');
        if (filesToProcess.length === 0) return;

        // Clear any existing PL data before processing new files
        resetPLState();

        setIsProcessing(true);

        for (let i = 0; i < filesToProcess.length; i++) {
            const item = filesToProcess[i];
            setPendingFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'processing' } : f));
            setStatusMessage(`Processing ${i + 1}/${filesToProcess.length}: ${item.file.name}...`);

            try {
                const base64Data = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (event) => resolve(event.target?.result as string);
                    reader.onerror = (error) => reject(error);
                    reader.readAsDataURL(item.file);
                });

                const rawBase64 = base64Data.split(',')[1];
                setPendingFiles(prev => prev.map(f => f.id === item.id ? { ...f, base64: base64Data } : f));
                await processDocument(rawBase64, item.file.type, item.file.name);
                setPendingFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'completed' } : f));
            } catch (err) {
                console.error(`Error processing ${item.file.name}`, err);
                setPendingFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'error' } : f));
            }
        }

        setStatusMessage('');
        setIsProcessing(false);
        setUploadModalOpen(false); // Auto-close upload modal when processing is complete
        setPendingFiles([]); // Clear pending files
        setCurrentStep('EDIT_PL'); // Auto-advance to Edit step after processing
    };

    // ========================================================================
    // PL ITEM MANIPULATION
    // ========================================================================
    const handleAddItem = () => {
        const newItem: PLItem = {
            id: `item_${Date.now()}_${Math.random()}`,
            containerNo: '',
            sealNo: '',
            grossLbs: 0,
            netLbs: 0,
            grossKg: 0,
            netKg: 0,
            volumes: 0,
            supplier: '',
            description: '',
            blNumber: bookingNumber || '',
            productId: ''
        };
        setPlItems(prev => [...prev, newItem]);
    };

    const handleDeleteItem = (id: string) => {
        setPlItems(plItems.filter(i => i.id !== id));
    };

    const updateItem = (id: string, field: keyof PLItem, value: any) => {
        setPlItems(prev => prev.map(item => {
            if (item.id === id) {
                let finalValue = value;
                if (field === 'containerNo' && typeof value === 'string') {
                    finalValue = formatContainerNumber(value);
                }
                const updated = { ...item, [field]: finalValue };
                // Auto-calc lbs <-> kg
                if (typeof value === 'number') {
                    if (field === 'grossLbs') updated.grossKg = Number((value * 0.453592).toFixed(2));
                    if (field === 'netLbs') updated.netKg = Number((value * 0.453592).toFixed(2));
                    if (field === 'grossKg') updated.grossLbs = Number((value * 2.20462).toFixed(2));
                    if (field === 'netKg') updated.netLbs = Number((value * 2.20462).toFixed(2));
                }
                return updated;
            }
            return item;
        }));
    };

    // ========================================================================
    // SAVE TO DATABASE
    // ========================================================================
    const saveToDatabase = async (): Promise<PackingList | null> => {
        const client = getSupabaseClient();
        if (!client) {
            alert("Database connection not available.");
            return null;
        }

        setIsSaving(true);
        setStatusMessage('Saving to Database...');

        try {
            const plId = editingPLId || `PL${Date.now()}`;
            const customer = customers.find(c => c.id === selectedCustomerId);
            const companyId = customer ? customer.companyId : currentCompanyId;
            const primaryDoc = pendingFiles.find(f => f.status === 'completed')?.base64 || undefined;

            // Close custom booking input mode if open - bookingNumber is already set via state
            if (isAddingNewBooking) setIsAddingNewBooking(false);
            console.log('[saveToDatabase] bookingNumber at save time:', JSON.stringify(bookingNumber));

            const packingList: PackingList = {
                id: plId,
                companyId: companyId,
                createdAt: new Date().toISOString(),
                plNumber: plNumber || generatePLNumber(),
                date: plDate,
                shipper: shipper || plItems[0]?.supplier || 'Multiple Suppliers',
                supplier: supplier || '',
                consignee: consignee || (customer ? customer.name : 'TBD'),
                containerNumber: plItems.map(i => i.containerNo).filter(Boolean).join(', '),
                sealNumber: plItems.map(i => i.sealNo).filter(Boolean).join(', '),
                grossWeight: totals.grossLbs.toString(),
                netWeight: totals.netLbs.toString(),
                unitCount: totals.volumes.toString(),
                items: JSON.stringify(plItems.map(({ originalDoc, ...rest }: any) => {
                    const product = rest.productId ? products.find(p => p.id === rest.productId) : null;
                    const productName = product ? (product.grade ? `${product.name} (${product.grade})` : product.name) : '';
                    return { ...rest, productName, productGrade: product ? product.grade : '' };
                })),
                blNumber: bookingNumber,
                soNumber: soNumber,
                containers: JSON.stringify(containers),
                status: editingPLId ? (savedPLs.find(p => p.id === editingPLId)?.status || 'AVAILABLE') : 'AVAILABLE'
            } as any;

            // Only include originalDocument if we have a new one (avoid overwriting existing with empty)
            if (primaryDoc) {
                (packingList as any).originalDocument = primaryDoc;
            }

            if (editingPLId) {
                // Strip originalDocument from update if we don't have a new one
                const { id: _id, createdAt: _ca, ...updatePayload } = packingList as any;
                if (!primaryDoc) delete updatePayload.originalDocument;
                console.log('[saveToDatabase] UPDATE payload blNumber:', JSON.stringify(updatePayload.blNumber));
                const { data: updatedPL, error } = await client.from('packing_lists').update(updatePayload).eq('id', editingPLId).select('id, plNumber, blNumber').single();
                if (error) throw error;
                console.log('[saveToDatabase] UPDATE result:', JSON.stringify(updatedPL));
            } else {
                const { data: insertedPL, error } = await client.from('packing_lists').insert(packingList).select('id, plNumber, blNumber').single();
                if (error) throw error;
                console.log('[saveToDatabase] INSERT result:', JSON.stringify(insertedPL));
            }

            // Refresh saved PLs list
            const { data: plData } = await client.from('packing_lists').select('*').eq('companyId', currentCompanyId).order('createdAt', { ascending: false });
            if (plData) setSavedPLs(plData);

            setStatusMessage('Saved successfully!');
            setTimeout(() => setStatusMessage(''), 2000);
            return packingList;
        } catch (error: any) {
            console.error("Save Error:", error);
            alert(`Failed to save: ${error.message}`);
            return null;
        } finally {
            setIsSaving(false);
        }
    };

    // Delete PL (only for Available PLs - not invoiced)
    const handleDeletePL = async (pl: any) => {
        console.log('[handleDeletePL] Called for PL:', pl.plNumber, 'id:', pl.id);
        if (!window.confirm(`Delete PL ${pl.plNumber}? This action cannot be undone.`)) {
            console.log('[handleDeletePL] User cancelled');
            return;
        }
        const client = getSupabaseClient();
        if (!client) {
            console.error('[handleDeletePL] No Supabase client!');
            alert('Database connection not available. Please refresh.');
            return;
        }
        try {
            const { error } = await client.from('packing_lists').delete().eq('id', pl.id);
            if (error) throw error;
            console.log('[handleDeletePL] Deleted successfully from DB');
            // Remove the deleted PL from local state directly (don't refetch, to avoid prop/DB mismatch)
            setSavedPLs(prev => prev.filter(p => p.id !== pl.id));
            setStatusMessage('PL deleted successfully!');
            setTimeout(() => setStatusMessage(''), 2000);
            // Also refresh parent data
            if (onRefreshData) await onRefreshData();
        } catch (error: any) {
            console.error('[handleDeletePL] Delete PL Error:', error);
            alert(`Failed to delete PL: ${error.message}`);
        }
    };

    // ========================================================================
    // INVOICE FUNCTIONS (Phase 3)
    // ========================================================================

    // Calculate invoice totals
    const invoiceTotals = invoiceItems.reduce((acc, item) => ({
        quantity: acc.quantity + (item.quantity || 0),
        amount: acc.amount + (item.amount || 0),
        grossLbs: acc.grossLbs + (item.grossLbs || 0),
        netLbs: acc.netLbs + (item.netLbs || 0),
    }), { quantity: 0, amount: 0, grossLbs: 0, netLbs: 0 });

    // Populate invoice items from PL items
    // ========================================================================
    // PL RESUME EXPORT FUNCTIONS (for Edit PL step)
    // ========================================================================
    const exportProductPDF = () => {
        const doc = new jsPDF('l', 'mm', 'a4');
        doc.setFontSize(14);
        doc.text(`Resume per Product - PL: ${plNumber || 'Draft'}`, 14, 15);

        const tableBody = plItems.map(item => [
            item.description || item.productName || '',
            item.containerNo || '',
            item.sealNo || '',
            (item.grossLbs || 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            (item.netLbs || 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            (item.grossKg || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            (item.netKg || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            item.volumes || 0,
            item.supplier || '',
            item.blNumber || ''
        ]);

        tableBody.push([
            'TOTALS', '', '',
            totals.grossLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            totals.netLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            totals.grossKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            totals.netKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            totals.volumes.toLocaleString(),
            '', ''
        ]);

        autoTable(doc, {
            head: [['Product Desc', 'Container No.', 'Seal No.', 'Gross (lbs)', 'Net (lbs)', 'Gross (kg)', 'Net (kg)', 'Volumes', 'Supplier', 'BL#']],
            body: tableBody,
            startY: 25,
            theme: 'grid',
            headStyles: { fillColor: [41, 128, 185], fontSize: 8 },
            bodyStyles: { fontSize: 8 },
            footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' }
        });

        // Open preview modal instead of direct download
        const pdfBlob = doc.output('blob');
        const blobUrl = URL.createObjectURL(pdfBlob);
        const fileName = `Resume_Product_${plNumber || 'Draft'}.pdf`;

        setPreviewUrl(blobUrl);
        setPreviewTitle(`Product Resume - ${plNumber || 'Draft'}`);
        setPreviewFileName(fileName);
        setPreviewBlob(pdfBlob);
        setPreviewDownloadFn(() => () => doc.save(fileName));
    };

    const exportContainerPDF = () => {
        const doc = new jsPDF('l', 'mm', 'a4');
        doc.setFontSize(14);
        doc.text(`Resume per Container - PL: ${plNumber || 'Draft'}`, 14, 15);
        const containerBody = containerSummary.map((c: any) => [
            c.containerNo,
            c.sealNo || '',
            (c.grossLbs || 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            (c.netLbs || 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            (c.grossKg || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            (c.netKg || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            c.volumes || 0
        ]);

        containerBody.push([
            'TOTALS', '',
            totals.grossLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            totals.netLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            totals.grossKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            totals.netKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            totals.volumes.toLocaleString()
        ]);

        autoTable(doc, {
            head: [['Container No.', 'Seal No.', 'Gross (lbs)', 'Net (lbs)', 'Gross (kg)', 'Net (kg)', 'Volumes']],
            body: containerBody,
            startY: 25,
            theme: 'grid',
            headStyles: { fillColor: [46, 204, 113], fontSize: 8 },
            bodyStyles: { fontSize: 8 },
            footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' }
        });

        // Open preview modal instead of direct download
        const pdfBlob = doc.output('blob');
        const blobUrl = URL.createObjectURL(pdfBlob);
        const fileName = `Resume_Container_${plNumber || 'Draft'}.pdf`;

        setPreviewUrl(blobUrl);
        setPreviewTitle(`Container Resume - ${plNumber || 'Draft'}`);
        setPreviewFileName(fileName);
        setPreviewBlob(pdfBlob);
        setPreviewDownloadFn(() => () => doc.save(fileName));
    };

    // Populate invoice items from PL items
    const populateFromPL = () => {
        if (plItems.length === 0) return;

        // Generate invoice number from PL number
        if (!invoiceNumber && plNumber) {
            setInvoiceNumber(plNumber.replace('PL-', 'INV-'));
        }

        // Set bill-to from consignee
        if (!billToName && consignee) {
            setBillToName(consignee);
        }

        console.log('[populateFromPL] PL Items:', plItems.length);
        console.log('[populateFromPL] Products loaded:', products.length);

        // Convert PL items to invoice items with proper resolution
        const newInvoiceItems: InvoiceLineItem[] = plItems.map((plItem, idx) => {
            // STRICT PRODUCT RESOLUTION LOGIC (from InvoiceEngine.tsx)
            let productDescription = '';
            let resolvedProductId = plItem.productId || '';
            let resolvedHsCode = plItem.hsCode || '';

            // 1. Live Lookup by ID (Authoritative)
            if (plItem.productId && products.length > 0) {
                const product = products.find((p: any) => p.id === plItem.productId);
                if (product) {
                    productDescription = product.grade ? `${product.name} (${product.grade})` : product.name;
                    if (product.hsCode && !resolvedHsCode) resolvedHsCode = product.hsCode;
                }
            }

            // 2. Reverse Lookup by productName if no ID (Backwards Compatibility)
            if (!resolvedProductId && plItem.productName && products.length > 0) {
                const product = products.find((p: any) => {
                    const expectedName = p.grade ? `${p.name} (${p.grade})` : p.name;
                    return expectedName === plItem.productName || p.name === plItem.productName;
                });
                if (product) {
                    resolvedProductId = product.id;
                    productDescription = product.grade ? `${product.name} (${product.grade})` : product.name;
                    if (product.hsCode && !resolvedHsCode) resolvedHsCode = product.hsCode;
                }
            }

            // 3. Snapshot Fallback (System Name)
            if (!productDescription && plItem.productName) {
                productDescription = plItem.productName;
            }

            // 4. OCR Fallback (Last Resort)
            if (!productDescription) {
                productDescription = plItem.description || plItem.productDescription || 'Product';
            }

            return {
                ...plItem, // Preserve all original properties
                id: `inv_${Date.now()}_${idx}`,
                productId: resolvedProductId,
                description: productDescription,
                customerDescription: plItem.customerDescription || '',
                hsCode: resolvedHsCode,
                quantity: Number(plItem.netLbs || plItem.quantity || 0),
                unit: 'LBS',
                unitPrice: Number(plItem.unitPrice || 0),
                unitPriceLbs: Number(plItem.unitPrice || 0),
                unitPriceKg: Number((plItem.unitPrice || 0) / 0.453592),
                amount: Number(plItem.amount || 0),
                containerNo: plItem.containerNo || '',
                sealNo: plItem.sealNo || '',
                grossLbs: Number(plItem.grossLbs || 0),
                netLbs: Number(plItem.netLbs || 0),
                // Calculate KG from LBS if not present
                grossKg: Number(plItem.grossKg || (plItem.grossLbs || 0) * 0.453592),
                netKg: Number(plItem.netKg || (plItem.netLbs || 0) * 0.453592),
                volumes: Number(plItem.volumes || 0)
            };
        });

        setInvoiceItems(newInvoiceItems);

        // Set containers from PL
        const uniqueContainers = [...new Set(plItems.map(i => i.containerNo).filter(Boolean))] as string[];
        const containerRows: ContainerRow[] = uniqueContainers.map((c, idx) => {
            const item = plItems.find(i => i.containerNo === c);
            return {
                id: `cont_${idx}`,
                container: c,
                seal: item?.sealNo || ''
            };
        });
        setContainers(containerRows);
    };

    // Invoice item manipulation
    const addInvoiceItem = () => {
        const newItem: InvoiceLineItem = {
            id: `inv_${Date.now()}`,
            description: '',
            customerDescription: '',
            hsCode: '',
            quantity: 0,
            unit: 'LBS',
            unitPrice: 0,
            unitPriceLbs: 0,
            unitPriceKg: 0,
            amount: 0,
            netLbs: 0,
            netKg: 0
        };
        setInvoiceItems(prev => [...prev, newItem]);
    };

    const removeInvoiceItem = (id: string) => {
        setInvoiceItems(invoiceItems.filter(i => i.id !== id));
    };

    const updateInvoiceItem = (id: string, field: keyof InvoiceLineItem, value: any) => {
        setInvoiceItems(prev => prev.map(item => {
            if (item.id === id) {
                const updated = { ...item, [field]: value };

                // Dual-sync for Net LBS <-> Net KG
                if (field === 'netLbs') {
                    updated.netKg = Number((value * 0.453592).toFixed(2));
                    updated.quantity = value; // quantity syncs with netLbs
                }
                if (field === 'netKg') {
                    updated.netLbs = Number((value / 0.453592).toFixed(2));
                    updated.quantity = updated.netLbs; // quantity syncs with netLbs
                }

                // Dual-sync for Unit Price LBS <-> Unit Price KG
                if (field === 'unitPriceLbs') {
                    updated.unitPriceKg = Number((value / 0.453592).toFixed(4));
                    updated.unitPrice = value; // unitPrice syncs with unitPriceLbs
                }
                if (field === 'unitPriceKg') {
                    updated.unitPriceLbs = Number((value * 0.453592).toFixed(4));
                    updated.unitPrice = updated.unitPriceLbs; // unitPrice syncs with unitPriceLbs
                }

                // Legacy support: quantity and unitPrice also trigger recalculation
                if (field === 'quantity') {
                    updated.netLbs = value;
                    updated.netKg = Number((value * 0.453592).toFixed(2));
                }
                if (field === 'unitPrice') {
                    updated.unitPriceLbs = value;
                    updated.unitPriceKg = Number((value / 0.453592).toFixed(4));
                }

                // Auto-calculate amount: netLbs * unitPriceLbs (always use LBS as base)
                updated.amount = Number(((updated.netLbs || updated.quantity || 0) * (updated.unitPriceLbs || updated.unitPrice || 0)).toFixed(2));

                return updated;
            }
            return item;
        }));
    };

    // Save Invoice to database
    const saveInvoice = async () => {
        const client = getSupabaseClient();
        if (!client) {
            alert("Database connection not available.");
            return;
        }

        setIsSaving(true);
        setStatusMessage('Saving Invoice...');

        try {
            const invId = editingInvoiceId || `INV${Date.now()}`;
            const customer = customers.find(c => c.name === billToName || c.id === selectedCustomerId);

            const invoice: Invoice = {
                id: invId,
                companyId: currentCompanyId,
                createdAt: new Date().toISOString(),
                invoiceNumber: invoiceNumber || `INV-${Date.now().toString().slice(-6)}`,
                invoiceDate: invoiceDate,
                date: invoiceDate,
                billToName: billToName,
                soldTo: billToName,
                customerPo: customerPo,
                shipperName: shipper || supplier,
                shipper: shipper,
                supplier: supplier,
                consignee: consignee,
                shipTo: consignee,
                paymentTerms: paymentTerms,
                totalAmount: invoiceTotals.amount,
                currency: 'USD',
                grossWeight: invoiceTotals.grossLbs.toString(),
                netWeight: invoiceTotals.netLbs.toString(),
                totalQuantity: invoiceTotals.quantity.toString(),
                bankName: bankName,
                bankAddress: bankAddress,
                accountNumber: accountNumber,
                swiftCode: swiftCode,
                routingNumber: routingNumber,
                transportRef: bookingNumber,
                bookingNumber: bookingNumber,
                incoterm: incoterm,
                pod: pod,
                poa: poa,
                plNumber: plNumber,
                soNumber: soNumber,
                memo: memo,
                items: JSON.stringify(invoiceItems),
                containers: JSON.stringify(containers)
            };

            if (editingInvoiceId) {
                const { error } = await client.from('invoices').update(invoice).eq('id', editingInvoiceId);
                if (error) throw error;
                onUpdateInvoice(invoice);
            } else {
                const { error } = await client.from('invoices').insert(invoice);
                if (error) throw error;
                onSaveInvoice(invoice);
                // Mark as editing so subsequent saves do UPDATE instead of INSERT
                setEditingInvoiceId(invId);
            }

            // Auto-mark linked PL as INVOICED
            if (plNumber) {
                const linkedPL = savedPLs.find(p => p.plNumber === plNumber);
                if (linkedPL && (linkedPL as any).status !== 'INVOICED') {
                    try {
                        await client.from('packing_lists').update({ status: 'INVOICED' }).eq('id', linkedPL.id);
                        setSavedPLs(prev => prev.map(p => p.id === linkedPL.id ? { ...p, status: 'INVOICED' as any } : p));
                        console.log(`[PLInvoiceEngine] Auto-marked PL ${plNumber} as INVOICED`);
                    } catch (err) { console.error('Failed to update PL status:', err); }
                }
            }

            // Auto-mark linked booking as SHIPPED
            if (bookingNumber) {
                const linkedBooking = allBookings.find((b: any) => b.bookingNumber === bookingNumber && b.status === 'AVAILABLE');
                if (linkedBooking) {
                    try {
                        await client.from('bookings').update({ status: 'SHIPPED' }).eq('id', linkedBooking.id);
                        setAllBookings((prev: any) => prev.map((b: any) => b.id === linkedBooking.id ? { ...b, status: 'SHIPPED' } : b));
                        console.log(`[PLInvoiceEngine] Auto-marked booking ${bookingNumber} as SHIPPED`);
                    } catch (err) { console.error('Failed to update booking status:', err); }
                }
            }

            setStatusMessage('Invoice saved successfully!');
            setTimeout(() => setStatusMessage(''), 2000);
        } catch (error: any) {
            console.error("Save Invoice Error:", error);
            alert(`Failed to save invoice: ${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    // Edit Invoice Handler - Hydrates all state from the invoice object and linked PL
    const handleEditInvoice = async (inv: Invoice) => {
        console.log("=== EDIT INVOICE DEBUG ===");
        console.log("Invoice object:", inv);
        console.log("Invoice memo from prop:", (inv as any).memo);
        console.log("Invoice plNumber:", inv.plNumber);
        console.log("Available packingLists:", packingLists.map(pl => ({ id: pl.id, plNumber: pl.plNumber })));

        // DIRECT DB FETCH for memo (bypass hook caching issues)
        let fetchedMemo = '';
        try {
            const client = getSupabaseClient();
            if (client && inv.id) {
                const { data: freshInvoice, error } = await client
                    .from('invoices')
                    .select('memo')
                    .eq('id', inv.id)
                    .single();

                console.log('[handleEditInvoice] Direct DB fetch for memo:', freshInvoice, error);

                if (freshInvoice && freshInvoice.memo) {
                    fetchedMemo = freshInvoice.memo;
                    console.log('[handleEditInvoice] Memo fetched directly from DB:', fetchedMemo);
                }
            }
        } catch (err) {
            console.error('[handleEditInvoice] Error fetching memo:', err);
        }

        setInvoiceNumber(inv.invoiceNumber || '');
        setInvoiceDate(inv.date || inv.invoiceDate || new Date().toISOString().split('T')[0]);
        setTransportRef(inv.transportRef || '');
        setBillToName(inv.billToName || inv.soldTo || '');
        setBillToAddress(inv.billToAddress || '');
        setPod(inv.pod || '');
        setPoa((inv as any).poa || '');
        setIncoterm(inv.incoterm || '');
        setCustomerPo(inv.customerPo || inv.soNumber || '');
        setPaymentTerms(inv.paymentTerms || 'Net 30');
        setPlNumber(inv.plNumber || '');
        setSoNumber(inv.soNumber || '');

        // Load shipper/supplier/consignee/bookingNumber from saved invoice
        setShipper((inv as any).shipper || '');
        setSupplier((inv as any).supplier || '');
        setConsignee((inv as any).consignee || '');
        setBookingNumber((inv as any).bookingNumber || inv.transportRef || '');

        // Use directly fetched memo first, fall back to inv.memo
        setMemo(fetchedMemo || (inv as any).memo || '');

        // Try to load items from saved invoice FIRST (preserves user edits), then fall back to PL
        let itemsLoaded = false;

        // FIRST: Try loading from saved invoice (preserves user edits like customerDescription)
        if (inv.items) {
            try {
                const savedItems = typeof inv.items === 'string' ? JSON.parse(inv.items) : inv.items;
                if (Array.isArray(savedItems) && savedItems.length > 0) {
                    // Enrich saved items with product hsCode lookup if missing
                    const enrichedItems = savedItems.map((item: any) => {
                        let hsCode = item.hsCode || '';
                        console.log(`[HS Debug] Item ${item.description}: productId=${item.productId}, existing hsCode=${item.hsCode}, products count=${products.length}`);
                        if (!hsCode && item.productId && products.length > 0) {
                            const prod = products.find((p: any) => p.id === item.productId);
                            console.log(`[HS Debug] Found product:`, prod ? { id: prod.id, name: prod.name, hsCode: prod.hsCode } : 'NOT FOUND');
                            if (prod && prod.hsCode) hsCode = prod.hsCode;
                        }
                        return { ...item, hsCode };
                    });
                    setInvoiceItems(enrichedItems);
                    setPlItems(enrichedItems);
                    console.log("[handleEditInvoice] Loaded items from SAVED INVOICE:", enrichedItems);
                    itemsLoaded = true;
                }
            } catch (e) {
                console.error("Error parsing saved invoice items", e);
            }
        }

        // SECOND: If no saved items, try loading from linked PL
        if (!itemsLoaded && inv.plNumber) {
            const linkedPL = packingLists.find(pl => pl.plNumber === inv.plNumber);
            console.log("Found linkedPL:", linkedPL);
            if (linkedPL) {
                try {
                    const plItemsData = typeof linkedPL.items === 'string' ? JSON.parse(linkedPL.items) : linkedPL.items;
                    setPlItems(Array.isArray(plItemsData) ? plItemsData : []);

                    // Convert PL items to invoice items format with hsCode lookup
                    const invoiceItemsFromPL = (Array.isArray(plItemsData) ? plItemsData : []).map((item: any) => {
                        let hsCode = item.hsCode || '';
                        if (!hsCode && item.productId && products.length > 0) {
                            const prod = products.find((p: any) => p.id === item.productId);
                            if (prod && prod.hsCode) hsCode = prod.hsCode;
                        }
                        return {
                            ...item,
                            plItemId: item.id,
                            unitPrice: item.unitPrice || 0,
                            unit: item.unit || 'LBS',
                            unitPriceLbs: item.unitPriceLbs || 0,
                            unitPriceKg: item.unitPriceKg || 0,
                            amount: (item.quantity || 0) * (item.unitPrice || 0),
                            customerDescription: item.customerDescription || item.description || '',
                            hsCode
                        };
                    });
                    setInvoiceItems(invoiceItemsFromPL);
                    console.log("[handleEditInvoice] Loaded items from LINKED PL:", invoiceItemsFromPL);
                    itemsLoaded = true;
                } catch (e) {
                    console.error("Error parsing linked PL items", e);
                }
            }
        }

        // Load linked PL data for other fields (shipper, supplier, consignee, containers)
        if (inv.plNumber) {
            const linkedPL = packingLists.find(pl => pl.plNumber === inv.plNumber);
            if (linkedPL) {
                // Load containers from linked PL
                try {
                    const plAny = linkedPL as any;
                    const containersData = plAny.containers ? (typeof plAny.containers === 'string' ? JSON.parse(plAny.containers) : plAny.containers) : null;
                    if (containersData && Array.isArray(containersData)) {
                        setContainers(containersData);
                    }
                } catch (e) {
                    console.error("Error parsing linked PL containers", e);
                }

                // Load other PL fields if not already set from invoice
                if (!((inv as any).shipper)) setShipper(linkedPL.shipper || '');
                if (!((inv as any).supplier)) setSupplier(linkedPL.supplier || '');
                if (!((inv as any).consignee)) setConsignee(linkedPL.consignee || '');
                if (!((inv as any).bookingNumber)) setBookingNumber(linkedPL.blNumber || inv.transportRef || '');
            }
        }

        // Load containers from saved invoice if not loaded from PL
        if (inv.containers) {
            try {
                const savedContainers = typeof inv.containers === 'string' ? JSON.parse(inv.containers) : inv.containers;
                if (Array.isArray(savedContainers) && savedContainers.length > 0) {
                    setContainers(savedContainers);
                    console.log("Loaded containers from saved invoice:", savedContainers);
                }
            } catch (e) {
                console.error("Error parsing saved invoice containers", e);
            }
        }

        // Bank Details
        setBankName(inv.bankName || '');
        setBankAddress(inv.bankAddress || '');
        setAccountNumber(inv.accountNumber || '');
        setSwiftCode(inv.swiftCode || '');
        setRoutingNumber(inv.routingNumber || '');

        // Look up POD and POA from Bookings table if not saved on invoice
        const effectiveBookingNumber = inv.bookingNumber || inv.transportRef ||
            (inv.plNumber ? packingLists.find(pl => pl.plNumber === inv.plNumber)?.blNumber : null);

        // Open edit form immediately
        setEditingInvoiceId(inv.id);
        setCurrentStep('CREATE_INVOICE');

        // Look up POA/POD in background (non-blocking)
        if (effectiveBookingNumber) {
            console.log("[handleEditInvoice] allBookings count:", allBookings.length);
            let linkedBooking = allBookings.find((b: any) => b.bookingNumber === effectiveBookingNumber);

            if (linkedBooking) {
                if (!inv.pod && linkedBooking.pod) {
                    setPod(linkedBooking.pod);
                }
                const invPoa = (inv as any).poa;
                if ((!invPoa || invPoa === '') && linkedBooking.pol) {
                    setPoa(linkedBooking.pol);
                }
            } else {
                const client = getSupabaseClient();
                if (client) {
                    client
                        .from('bookings')
                        .select('pol, pod')
                        .eq('bookingNumber', effectiveBookingNumber)
                        .maybeSingle()
                        .then(({ data: fetchedBooking, error }) => {
                            if (fetchedBooking && !error) {
                                console.log("[handleEditInvoice] Fetched booking POL/POD:", fetchedBooking.pol, fetchedBooking.pod);
                                if (!inv.pod && fetchedBooking.pod) {
                                    setPod(fetchedBooking.pod);
                                }
                                const invPoa = (inv as any).poa;
                                if ((!invPoa || invPoa === '') && fetchedBooking.pol) {
                                    setPoa(fetchedBooking.pol);
                                }
                            }
                        });
                }
            }
        }
    };

    // ========================================================================
    // DOCUMENT HANDLERS
    // ========================================================================
    const openDocumentsModal = (inv: Invoice) => {
        // Look up from savedInvoices to get the freshest data (including bolUrl)
        const freshInv = savedInvoices.find(i => i.id === inv.id) || inv;
        console.log('[openDocumentsModal] === OPENING MODAL ===');
        console.log('[openDocumentsModal] Clicked invoice id:', inv.id, 'invoiceNumber:', inv.invoiceNumber);
        console.log('[openDocumentsModal] Clicked inv.bolUrl:', (inv as any).bolUrl);
        console.log('[openDocumentsModal] savedInvoices count:', savedInvoices.length);
        console.log('[openDocumentsModal] Found in savedInvoices?:', savedInvoices.find(i => i.id === inv.id) ? 'YES' : 'NO');
        console.log('[openDocumentsModal] freshInv.bolUrl:', (freshInv as any).bolUrl, 'freshInv.bolurl:', (freshInv as any).bolurl);
        console.log('[openDocumentsModal] All saved invoices with BOL:');
        savedInvoices.filter(i => (i as any).bolUrl || (i as any).bolurl).forEach(i => {
            console.log(`  - ${i.invoiceNumber} (id: ${i.id}): bolUrl length = ${((i as any).bolUrl || (i as any).bolurl)?.length}`);
        });
        setSelectedDocInvoice(freshInv);
        setDocumentsModalOpen(true);
    };

    const getLinkedPL = (inv: Invoice): PackingList | undefined => {
        return packingLists.find(pl => pl.plNumber === inv.plNumber);
    };

    const handleBOLUpload = async (file: File, invoiceId: string) => {
        const client = getSupabaseClient();
        if (!client) return;

        setUploadingBOL(true);
        try {
            // Convert file to Base64 data URL for database storage
            const reader = new FileReader();
            reader.onload = async (e) => {
                const bolUrl = e.target?.result as string;

                // Update invoice with BOL data URL
                const { error } = await client.from('invoices').update({
                    bolUrl
                }).eq('id', invoiceId);

                if (error) {
                    console.error('BOL save error:', error);
                    alert('Failed to save BOL. Please try again.');
                    setUploadingBOL(false);
                    return;
                }

                // Update local state
                setSavedInvoices(prev => prev.map(inv =>
                    inv.id === invoiceId ? { ...inv, bolUrl } as Invoice : inv
                ));
                setSelectedDocInvoice(prev => prev ? { ...prev, bolUrl } as Invoice : null);
                console.log('BOL saved successfully');

                // Refresh data from database to sync state
                if (onRefreshData) {
                    await onRefreshData();
                }

                setUploadingBOL(false);
            };
            reader.onerror = () => {
                console.error('Failed to read file');
                alert('Failed to read BOL file.');
                setUploadingBOL(false);
            };
            reader.readAsDataURL(file);
        } catch (error) {
            console.error('BOL upload failed:', error);
            alert('Failed to upload BOL.');
            setUploadingBOL(false);
        }
    };

    // ========================================================================
    // EMAIL DOCUMENTS HANDLER - Opens Preview Modal
    // ========================================================================
    const handlePrepareEmailDraft = async (inv: Invoice) => {
        setSendingEmail(true);
        setEmailStatus({ show: false, success: false, message: '' });

        try {
            // Get customer email
            const customer = customers.find(c => c.name === (inv.billToName || inv.soldTo));
            const toEmails = brMode ? 'felipe@ec4.enterprises' : [customer?.email, customer?.email2].filter(Boolean).join('; ');
            const ccEmail = brMode ? '' : (customer?.brokerEmail || '');

            console.log('[Email] Preparing email draft for', inv.invoiceNumber, brMode ? '(BR MODE)' : '');


            // Build attachments array
            const attachments: { name: string; contentBytes: string; contentType: string }[] = [];

            // BR MODE: Create price-adjusted copy of invoice (never save to DB)
            let pdfInv = inv;
            if (brMode && inv.items) {
                const customerName = (inv.billToName || inv.soldTo || '').toUpperCase();
                let parsedItems: any[] = [];
                try {
                    parsedItems = typeof inv.items === 'string' ? JSON.parse(inv.items) : inv.items;
                } catch { parsedItems = []; }

                const isBeatriz = customerName.includes('BEATRIZ');
                const isPatex = customerName.includes('PATEX') || customerName.includes('PATAMUTE');

                if (isBeatriz || isPatex) {
                    const adjustedItems = parsedItems.map((item: any) => {
                        const adjusted = { ...item };
                        if (isBeatriz) {
                            // Fixed $0.28/kg → convert to $/lb for unitPriceLbs
                            adjusted.unitPriceKg = 0.28;
                            adjusted.unitPriceLbs = Number((0.28 * 0.453592).toFixed(4)); // ~$0.127/lb
                            adjusted.unitPrice = adjusted.unitPriceLbs;
                        } else if (isPatex) {
                            // 50% of original unit price
                            adjusted.unitPrice = Number(((item.unitPrice || 0) * 0.5).toFixed(4));
                            adjusted.unitPriceLbs = Number(((item.unitPriceLbs || item.unitPrice || 0) * 0.5).toFixed(4));
                            adjusted.unitPriceKg = Number(((item.unitPriceKg || 0) * 0.5).toFixed(4));
                        }
                        // Recalculate amount
                        adjusted.amount = Number(((adjusted.netLbs || adjusted.quantity || 0) * (adjusted.unitPriceLbs || adjusted.unitPrice || 0)).toFixed(2));
                        return adjusted;
                    });

                    const newSubtotal = adjustedItems.reduce((sum: number, it: any) => sum + (it.amount || 0), 0);
                    pdfInv = {
                        ...inv,
                        items: JSON.stringify(adjustedItems),
                        subtotal: newSubtotal,
                        totalAmount: newSubtotal
                    };
                    console.log('[Email][BR] Price-adjusted invoice for', customerName, '- new total:', newSubtotal);
                }
            }

            // 1. Generate Invoice PDF
            try {
                const invoiceDoc = await generateInvoicePDF(pdfInv, false);
                const invoiceBase64 = invoiceDoc.output('datauristring').split(',')[1];
                attachments.push({
                    name: `Invoice_${inv.invoiceNumber || 'unknown'}.pdf`,
                    contentBytes: invoiceBase64,
                    contentType: 'application/pdf'
                });
                console.log('[Email] Invoice PDF generated');
            } catch (e) {
                console.error('[Email] Failed to generate Invoice PDF:', e);
            }

            // 2. Generate Packing List PDF
            try {
                const plDoc = generatePackingListPDF(pdfInv, false);
                const plBase64 = plDoc.output('datauristring').split(',')[1];
                attachments.push({
                    name: `PackingList_${inv.plNumber || inv.invoiceNumber || 'unknown'}.pdf`,
                    contentBytes: plBase64,
                    contentType: 'application/pdf'
                });
                console.log('[Email] Packing List PDF generated');
            } catch (e) {
                console.error('[Email] Failed to generate Packing List PDF:', e);
            }

            // 3. Generate SLI PDF (skip in BR mode)
            if (!brMode) {
                try {
                    const sliDoc = generateSLIPreview(inv);
                    const sliBase64 = sliDoc.output('datauristring').split(',')[1];
                    attachments.push({
                        name: `SLI_${inv.invoiceNumber || 'unknown'}.pdf`,
                        contentBytes: sliBase64,
                        contentType: 'application/pdf'
                    });
                    console.log('[Email] SLI PDF generated');
                } catch (e) {
                    console.error('[Email] Failed to generate SLI PDF:', e);
                }
            }

            // 4. Add BOL if available (skip in BR mode)
            const bolUrl = (inv as any).bolUrl || (inv as any).bolurl;
            if (!brMode && bolUrl && bolUrl.startsWith('data:')) {
                try {
                    const bolBase64 = bolUrl.split(',')[1];
                    const mimeMatch = bolUrl.match(/data:([^;]+);/);
                    const mimeType = mimeMatch ? mimeMatch[1] : 'application/pdf';
                    attachments.push({
                        name: `BOL_${inv.invoiceNumber || 'unknown'}.pdf`,
                        contentBytes: bolBase64,
                        contentType: mimeType
                    });
                    console.log('[Email] BOL attached');
                } catch (e) {
                    console.error('[Email] Failed to attach BOL:', e);
                }
            }

            if (attachments.length === 0) {
                setEmailStatus({ show: true, success: false, message: 'No documents could be generated.' });
                setSendingEmail(false);
                return;
            }

            // Get company name for email
            const company = availableCompanies.find(c => c.id === currentCompanyId);
            const companyName = company?.name || 'X-Solution';

            // Build email content
            const emailBody = brMode
                ? `Dear Partner,

Please find attached the documents for order:

• Commercial Invoice: ${inv.invoiceNumber}
• Packing List: ${inv.plNumber || 'N/A'}

Total Amount: $${Number(pdfInv.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}

Best regards,
${companyName}`
                : `Dear ${customer?.name || 'Customer'},

Please find attached the shipping documents for your order:

• Commercial Invoice: ${inv.invoiceNumber}
• Packing List: ${inv.plNumber || 'N/A'}
• Shipper's Letter of Instruction (SLI)${bolUrl ? '\n• Bill of Lading (BOL)' : ''}

Total Amount: $${Number(inv.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}

If you have any questions, please don't hesitate to contact us.

Best regards,
${companyName}`;

            // Build subject with booking number if available
            const bookingRef = (inv as any).bookingNumber || inv.transportRef || '';
            const subjectParts = [brMode ? `BR Documents - Invoice #${inv.invoiceNumber}` : `Shipping Documents - Invoice #${inv.invoiceNumber}`];
            if (bookingRef) subjectParts.push(`Booking #${bookingRef}`);

            // Set draft and open modal
            setEmailDraft({
                invoice: inv,
                to: toEmails,
                cc: ccEmail,
                subject: subjectParts.join(' | '),
                htmlBody: emailBody,
                attachments
            });
            setEmailPreviewOpen(true);
            console.log('[Email] Draft prepared, opening preview modal');

        } catch (error: any) {
            console.error('[Email] Error preparing draft:', error);
            setEmailStatus({ show: true, success: false, message: `Failed to prepare email: ${error.message}` });
        } finally {
            setSendingEmail(false);
        }
    };

    // Send Email from Preview Modal
    const sendEmailFromPreview = async () => {
        if (!emailDraft.to) {
            setEmailStatus({ show: true, success: false, message: 'Please enter a recipient email address.' });
            return;
        }

        setSendingEmail(true);
        try {
            // Convert plain text to HTML
            const htmlBody = brMode
                ? `<div style="font-family: Arial, sans-serif; text-align: left; line-height: 1.6;">${emailDraft.htmlBody.replace(/\n/g, '<br>')}</div>`
                : `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #4F46E5;">${emailDraft.subject}</h2>
                    <div style="white-space: pre-wrap; line-height: 1.6;">${emailDraft.htmlBody}</div>
                </div>
            `;

            // Parse CC field (comma-separated emails)
            const ccList = emailDraft.cc
                ? emailDraft.cc.split(',').map(e => e.trim()).filter(e => e.length > 0)
                : [];

            console.log('[Email] Sending email to', emailDraft.to, 'CC:', ccList, 'with', emailDraft.attachments.length, 'attachments');

            // Parse TO field (semicolon or comma-separated emails)
            const toList = emailDraft.to
                .split(/[;,]/)
                .map(e => e.trim())
                .filter(e => e.length > 0);

            if (toList.length === 0) {
                setEmailStatus({ show: true, success: false, message: 'Please enter a valid recipient email address.' });
                setSendingEmail(false);
                return;
            }

            let result: { success: boolean; provider: string; message: string };
            try {
                result = await sendEmail({
                    to: toList,
                    cc: ccList.length > 0 ? ccList : undefined,
                    subject: emailDraft.subject,
                    htmlBody: htmlBody,
                    attachments: emailDraft.attachments
                });
            } catch (sendError: any) {
                // Catch MSAL redirect or auth errors that could crash the app
                console.error('[Email] sendEmail threw:', sendError);
                setEmailStatus({ show: true, success: false, message: `Email service error: ${sendError?.message || 'Unknown error. Please check your email integration settings.'}` });
                setSendingEmail(false);
                return;
            }

            if (result.success) {
                setEmailStatus({ show: true, success: true, message: `Email sent successfully via ${result.provider}` });
                console.log('[Email] Success:', result.message);
                setEmailPreviewOpen(false);
            } else {
                setEmailStatus({ show: true, success: false, message: result.message });
                console.error('[Email] Failed:', result.message);
            }
        } catch (error: any) {
            console.error('[Email] Error:', error);
            setEmailStatus({ show: true, success: false, message: `Failed to send email: ${error?.message || 'Unknown error'}` });
        } finally {
            setSendingEmail(false);
            setTimeout(() => setEmailStatus(prev => ({ ...prev, show: false })), 5000);
        }
    };

    // ========================================================================
    // PDF PREVIEW HELPERS
    // ========================================================================
    const handleClosePreview = () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
        setPreviewDownloadFn(null);
        setPreviewBlob(null);
    };

    const previewInvoicePDF = async (inv: Invoice) => {
        const doc = await generateInvoicePDF(inv, false); // Generate without auto-download
        const blob = doc.output('blob');
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setPreviewTitle(`Invoice - ${inv.invoiceNumber}`);
        setPreviewFileName(`Invoice_${inv.invoiceNumber || 'unknown'}.pdf`);
        setPreviewBlob(blob);
        setPreviewDownloadFn(() => () => doc.save(`Invoice_${inv.invoiceNumber || 'unknown'}.pdf`));
    };

    const previewPackingListPDF = (inv: Invoice) => {
        const doc = generatePackingListPDF(inv, false); // Generate without auto-download
        const blob = doc.output('blob');
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setPreviewTitle(`Packing List - ${inv.plNumber || inv.invoiceNumber}`);
        setPreviewFileName(`PackingList_${inv.plNumber || inv.invoiceNumber || 'unknown'}.pdf`);
        setPreviewBlob(blob);
        setPreviewDownloadFn(() => () => doc.save(`PackingList_${inv.plNumber || inv.invoiceNumber || 'unknown'}.pdf`));
    };

    const previewSLIPDF = (inv: Invoice) => {
        const doc = generateSLIPreview(inv); // Use a preview version
        const blob = doc.output('blob');
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setPreviewTitle(`Shipper's Letter of Instruction - ${inv.invoiceNumber}`);
        setPreviewFileName(`SLI_${inv.invoiceNumber || 'unknown'}.pdf`);
        setPreviewBlob(blob);
        setPreviewDownloadFn(() => () => doc.save(`SLI_${inv.invoiceNumber || 'unknown'}.pdf`));
    };

    // SLI Preview version (returns doc instead of saving)
    const generateSLIPreview = (inv: Invoice) => {
        const doc = new jsPDF();
        const linkedPL = getLinkedPL(inv);

        // Color scheme matching EC4 Enterprises
        const cyanColor = '#00A0B0';
        const darkGray = '#333333';
        const lightGray = '#666666';
        const sectionBg = '#E8F4F5';

        // Get company info
        const company = availableCompanies.find(c => c.id === currentCompanyId);
        const companyName = company?.name || 'EC4 ENTERPRISES LLC';
        const companyAddress = company?.address || '112 Bartran Oaks Walk #600010';
        const companyCity = `${company?.city || 'St Johns'}, ${company?.state || 'FL'} ${company?.zip || '32260'}`;
        const companyEIN = (company as any)?.ein || '';
        const companyPhone = (company as any)?.phone || '';
        const companyState = company?.state || 'FL';
        const companyCountry = company?.country || 'US';

        // Get customer info for consignee
        const consigneeName = (inv as any).consignee || inv.billToName || '';
        const customer = customers.find(c => c.name === consigneeName || c.name === inv.billToName);
        const customerCountry = customer?.country || '';
        const customerAddress = customer ? [customer.location, customer.city, customer.state, customer.zip, customer.country].filter(Boolean).join(', ') : '';

        // Parse items first (needed for supplier fallback)
        const items = typeof inv.items === 'string' ? JSON.parse(inv.items) : inv.items || [];

        // Get supplier info for freight origin state (Field 4)
        // Try: 1) linkedPL.supplier, 2) linkedPL.shipper, 3) inv.supplier, 4) inv.shipper, 5) first item's supplier
        const plSupplierName = linkedPL?.supplier || linkedPL?.shipper || '';
        const invSupplierName = (inv as any).supplier || (inv as any).shipperName || (inv as any).shipper || '';
        const itemSupplier = items.length > 0 ? (items[0].supplier || '') : '';
        const effectiveSupplier = plSupplierName || invSupplierName || itemSupplier;

        console.log('[SLI] Supplier lookup:', {
            plSupplier: linkedPL?.supplier,
            plShipper: linkedPL?.shipper,
            invSupplier: (inv as any).supplier,
            invShipper: (inv as any).shipper,
            itemSupplier,
            effectiveSupplier,
            suppliersCount: suppliers?.length
        });

        let supplierObj: any = null;
        // Helper to normalize names: strip punctuation, lowercase, collapse whitespace
        const normalizeName = (n: string) => (n || '').toLowerCase().replace(/[.,\-\/\\()]/g, '').replace(/\s+/g, ' ').trim();
        if (effectiveSupplier && suppliers?.length > 0) {
            const normalizedEffective = normalizeName(effectiveSupplier);
            // Exact match first
            supplierObj = suppliers.find((s: any) => s.name === effectiveSupplier);
            // Normalized match (ignoring punctuation)
            if (!supplierObj) {
                supplierObj = suppliers.find((s: any) => normalizeName(s.name) === normalizedEffective);
            }
            // Partial/fuzzy match
            if (!supplierObj) {
                supplierObj = suppliers.find((s: any) =>
                    normalizeName(s.nickname || '') === normalizedEffective ||
                    normalizedEffective.includes(normalizeName(s.name)) ||
                    normalizeName(s.name).includes(normalizedEffective)
                );
            }
        }
        const freightOriginState = supplierObj?.state || (inv as any).originState || companyState;

        console.log('[SLI] Field 4 result:', { supplierObj: supplierObj?.name, supplierState: supplierObj?.state, freightOriginState });

        // Get POD for Field 15 (Port of Export)
        // Try: 1) inv.pod, 2) inv.poa, 3) booking.pol
        let poaValue = (inv as any).pod || inv.pod || (inv as any).poa || inv.poa || '';
        if (!poaValue && inv.bookingNumber) {
            const linkedBooking = allBookings.find((b: any) => b.bookingNumber === inv.bookingNumber);
            if (linkedBooking) {
                poaValue = (linkedBooking as any).pol || '';
                console.log('[SLI] Field 15 from booking:', { bookingNumber: inv.bookingNumber, pol: poaValue });
            }
        }
        // Also try linkedPL's shippingPoint as another fallback
        if (!poaValue && linkedPL?.shippingPoint) {
            poaValue = linkedPL.shippingPoint;
        }
        console.log('[SLI] Field 15 POD:', { invPod: (inv as any).pod, invPoa: (inv as any).poa, poaValue });

        // Calculate totals
        const totalNetLbs = items.reduce((sum: number, item: any) => sum + Number(item.netLbs || item.quantity || 0), 0);
        const totalNetKg = totalNetLbs * 0.453592;
        const totalGrossLbs = items.reduce((sum: number, item: any) => sum + Number(item.grossLbs || 0), 0);
        const totalGrossKg = totalGrossLbs > 0 ? totalGrossLbs * 0.453592 : totalNetKg * 1.02;
        const totalVolumes = items.reduce((sum: number, item: any) => sum + Number(item.volumes || 0), 0);

        // --- HEADER (matching Invoice/PL style) ---
        // Logo on left side
        if (logoUrl) {
            try {
                let format = 'JPEG';
                if (logoUrl.startsWith('data:image/')) {
                    const match = logoUrl.match(/data:image\/(\w+);/);
                    if (match) {
                        format = match[1].toUpperCase();
                        if (format === 'JPG') format = 'JPEG';
                    }
                }
                const imgProps = doc.getImageProperties(logoUrl);
                const maxWidth = 60;
                const maxHeight = 25;
                let width = imgProps.width;
                let height = imgProps.height;
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width *= ratio;
                height *= ratio;
                doc.addImage(logoUrl, format, 14, 10, width, height);
            } catch (e) {
                console.error('[SLI PDF] Logo load failed:', e);
            }
        }

        // Company info on right side
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(darkGray);
        doc.text(companyName, 196, 15, { align: 'right' });

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(companyAddress, 196, 21, { align: 'right' });
        doc.text(companyCity, 196, 26, { align: 'right' });

        let y = 40;

        // --- SHIPPER'S LETTER OF INSTRUCTION TITLE ---
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(cyanColor);
        doc.text("SHIPPER'S LETTER OF INSTRUCTION", 105, y, { align: 'center' });
        y += 10;

        // ============================================================
        // STANDARD SLI/EEI FIELDS
        // ============================================================
        const leftCol = 14;
        const rightCol = 110;
        const fieldLabelWidth = 90;
        const lineHeight = 5;

        const drawFieldLabel = (fieldNum: string, label: string, x: number, yPos: number) => {
            doc.setFontSize(7);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor('#888888');
            doc.text(`${fieldNum}. ${label}`, x, yPos);
        };

        const drawFieldValue = (value: string, x: number, yPos: number, maxWidth = 85) => {
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(darkGray);
            const lines = doc.splitTextToSize(value || '-', maxWidth);
            doc.text(lines, x, yPos);
            return lines.length * 4;
        };

        // ---- ROW 1: USPPI / DATE / TRANSPORT REF ----
        doc.setDrawColor('#cccccc');
        doc.setLineWidth(0.3);

        // Field 1a: USPPI Name & Address
        drawFieldLabel('1a', 'U.S. PRINCIPAL PARTY IN INTEREST (USPPI)', leftCol, y);
        y += 4;
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(darkGray);
        doc.text(companyName, leftCol, y);
        y += 4;
        doc.setFont('helvetica', 'normal');
        doc.text(companyAddress, leftCol, y);
        y += 4;
        doc.text(companyCity, leftCol, y);
        if (companyPhone) {
            y += 4;
            doc.text(`Tel: ${companyPhone}`, leftCol, y);
        }

        // Field 1b: USPPI EIN
        y += 6;
        drawFieldLabel('1b', 'USPPI EIN (IRS) NO.', leftCol, y);
        y += 4;
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(darkGray);
        doc.text(companyEIN ? `EIN: ${companyEIN}` : 'EIN: ______________', leftCol, y);

        // Fields 2 & 3 on the right side (same vertical area)
        let rightY = y - 22;
        drawFieldLabel('2', 'DATE OF EXPORTATION', rightCol, rightY);
        rightY += 4;
        drawFieldValue(new Date(inv.date || inv.invoiceDate || new Date()).toISOString().split('T')[0], rightCol, rightY);
        rightY += 8;

        drawFieldLabel('3', 'TRANSPORTATION REFERENCE NO.', rightCol, rightY);
        rightY += 4;
        drawFieldValue((inv as any).bookingNumber || inv.transportRef || '-', rightCol, rightY);

        y += 8;
        doc.line(leftCol, y, 196, y);
        y += 4;

        // ---- ROW 2: POINT OF ORIGIN / CONSIGNEE ----
        // Field 4: Point (State) of Origin
        drawFieldLabel('4', 'POINT (STATE) OF ORIGIN OR FTZ NO.', leftCol, y);
        y += 4;
        drawFieldValue(freightOriginState, leftCol, y);

        // Field 5 on right: FPPI / Ultimate Consignee
        drawFieldLabel('5', 'ULTIMATE CONSIGNEE', rightCol, y - 4);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(darkGray);
        const consigneeLines = doc.splitTextToSize(consigneeName, 82);
        doc.text(consigneeLines, rightCol, y);
        let consigneeEndY = y + consigneeLines.length * 4;
        if (customerAddress) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            const addrLines = doc.splitTextToSize(customerAddress, 82);
            doc.text(addrLines, rightCol, consigneeEndY);
            consigneeEndY += addrLines.length * 3.5;
        }

        y = Math.max(y + 8, consigneeEndY + 4);
        doc.line(leftCol, y, 196, y);
        y += 4;

        // ---- ROW 3: COUNTRY / PARTIES / MODE / PORT ----
        // Field 7: Country of Ultimate Destination
        drawFieldLabel('7', 'COUNTRY OF ULTIMATE DESTINATION', leftCol, y);
        y += 4;
        drawFieldValue(customerCountry || 'N/A', leftCol, y);

        // Field 8: Parties to Transaction
        drawFieldLabel('8', 'PARTIES TO TRANSACTION', rightCol, y - 4);
        drawFieldValue('Non-Related', rightCol, y);

        y += 8;
        doc.line(leftCol, y, 196, y);
        y += 4;

        // Field 11: Mode of Transport
        drawFieldLabel('11', 'MODE OF TRANSPORT', leftCol, y);
        y += 4;
        drawFieldValue('VESSEL (Ocean)', leftCol, y);

        // Field 15: Port of Export
        drawFieldLabel('15', 'PORT OF EXPORT', rightCol, y - 4);
        let portOfExportDisplay = poaValue;
        if (poaValue && ports.length > 0) {
            const portObj = ports.find((p: any) => p.code === poaValue || p.name === poaValue);
            if (portObj) {
                portOfExportDisplay = `${portObj.name} (${portObj.code})`;
            }
        }
        drawFieldValue(portOfExportDisplay, rightCol, y);

        y += 8;
        doc.line(leftCol, y, 196, y);
        y += 4;

        // ============================================================
        // GOODS TABLE (Fields 18-27)
        // ============================================================
        doc.setFillColor(232, 244, 245);
        doc.rect(leftCol, y - 2, 182, 7, 'F');
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor('#555555');
        // Column headers
        doc.text('18. D/F', leftCol + 1, y + 2);
        doc.text('19. SCHEDULE B DESCRIPTION', leftCol + 14, y + 2);
        doc.text('20. QTY', leftCol + 95, y + 2);
        doc.text('22. SHIP WT (KG)', leftCol + 113, y + 2);
        doc.text('23. ECCN', leftCol + 140, y + 2);
        doc.text('26. VALUE ($)', leftCol + 160, y + 2);
        y += 8;

        // Item rows
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(darkGray);

        if (items.length > 0) {
            items.forEach((item: any, idx: number) => {
                if (y > 260) return; // page overflow guard
                // Use customerDescription first if present
                let desc = (item.customerDescription || '').trim();
                if (!desc && item.productId && products.length > 0) {
                    const prod = products.find((p: any) => p.id === item.productId);
                    if (prod) desc = prod.name;
                }
                if (!desc) desc = item.productDescription || item.description || '';
                const hsCode = item.hsCode || '';
                const descWithHS = hsCode ? `${hsCode} - ${desc}` : desc;
                const qty = Number(item.netLbs || item.quantity || 0);
                const qtyKg = qty * 0.453592;
                const amount = Number(item.amount || 0);

                doc.text('D', leftCol + 4, y);
                const descLines = doc.splitTextToSize(descWithHS.substring(0, 70), 78);
                doc.text(descLines, leftCol + 14, y);
                doc.text(qtyKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), leftCol + 95, y);
                doc.text(qtyKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), leftCol + 113, y);
                doc.text('EAR99', leftCol + 140, y);
                doc.text(`$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, leftCol + 160, y);

                y += Math.max(descLines.length * 4, 5) + 1;
            });
        } else {
            doc.text('No items', leftCol + 14, y);
            y += 6;
        }

        // Totals row
        y += 2;
        doc.setFillColor(240, 240, 240);
        doc.rect(leftCol, y - 3, 182, 7, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text('TOTALS:', leftCol + 14, y);
        doc.text(`${totalNetKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KG`, leftCol + 95, y);
        doc.text(`${totalNetKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KG`, leftCol + 113, y);
        doc.text(`$${Number(inv.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, leftCol + 160, y);
        y += 10;

        doc.line(leftCol, y - 3, 196, y - 3);

        // ============================================================
        // ADDITIONAL FIELDS (25, Containers, etc.)
        // ============================================================
        // Field 25: License Exception Symbol / Authorization
        drawFieldLabel('25', 'LICENSE EXCEPTION / AUTHORIZATION', leftCol, y);
        y += 4;
        drawFieldValue('NLR (No License Required)', leftCol, y);

        // Field 9: Routed Export Transaction
        drawFieldLabel('9', 'ROUTED EXPORT TRANSACTION', rightCol, y - 4);
        drawFieldValue('No', rightCol, y);

        y += 10;

        // --- SHIPPING DETAILS SECTION ---
        doc.setFillColor(232, 244, 245);
        doc.rect(14, y, 182, 7, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(darkGray);
        doc.text('Shipping Details', 16, y + 5);
        y += 12;

        doc.setFontSize(9);
        const leftValCol = 50;
        const rightValCol = 145;

        doc.setFont('helvetica', 'bold');
        doc.text('Carrier:', leftCol, y);
        doc.setFont('helvetica', 'normal');
        doc.text((inv as any).carrier || '', leftValCol, y);

        doc.setFont('helvetica', 'bold');
        doc.text('Booking #:', rightCol, y);
        doc.setFont('helvetica', 'normal');
        doc.text((inv as any).bookingNumber || inv.transportRef || '-', rightValCol, y);
        y += lineHeight + 1;

        doc.setFont('helvetica', 'bold');
        doc.text('Incoterm:', leftCol, y);
        doc.setFont('helvetica', 'normal');
        doc.text((inv as any).incoterm || 'EX-WORKS USA', leftValCol, y);

        doc.setFont('helvetica', 'bold');
        doc.text('Invoice #:', rightCol, y);
        doc.setFont('helvetica', 'normal');
        doc.text(inv.invoiceNumber || '', rightValCol, y);
        y += lineHeight + 1;

        doc.setFont('helvetica', 'bold');
        doc.text('Total Amount:', leftCol, y);
        doc.setFont('helvetica', 'normal');
        doc.text(`$${Number(inv.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, leftValCol, y);

        doc.setFont('helvetica', 'bold');
        doc.text('Currency:', rightCol, y);
        doc.setFont('helvetica', 'normal');
        doc.text((inv as any).currency || 'USD', rightValCol, y);
        y += lineHeight + 1;

        doc.setFont('helvetica', 'bold');
        doc.text('Gross Weight:', leftCol, y);
        doc.setFont('helvetica', 'normal');
        doc.text(`${totalGrossKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KG`, leftValCol, y);

        doc.setFont('helvetica', 'bold');
        doc.text('Net Weight:', rightCol, y);
        doc.setFont('helvetica', 'normal');
        doc.text(`${totalNetKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KG`, rightValCol, y);
        y += lineHeight + 1;

        doc.setFont('helvetica', 'bold');
        doc.text('Packaging:', leftCol, y);
        doc.setFont('helvetica', 'normal');
        doc.text((inv as any).packaging || 'Bales / Fardos', leftValCol, y);

        doc.setFont('helvetica', 'bold');
        doc.text('Number of Bales:', rightCol, y);
        doc.setFont('helvetica', 'normal');
        doc.text(totalVolumes > 0 ? totalVolumes.toString() : '-', rightValCol, y);
        y += lineHeight + 1;

        doc.setFont('helvetica', 'bold');
        doc.text('Country of Origin:', leftCol, y);
        doc.setFont('helvetica', 'normal');
        doc.text('USA', leftValCol, y);
        y += lineHeight + 3;

        // Containers and Seals
        doc.setFont('helvetica', 'bold');
        doc.text('Containers and Seals:', leftCol, y);
        y += 5;

        const containersMap = new Map();
        items.forEach((item: any) => {
            if (item.containerNo && item.containerNo.toLowerCase() !== 'unknown') {
                containersMap.set(item.containerNo, item.sealNo || '');
            }
        });

        doc.setFont('helvetica', 'normal');
        if (containersMap.size > 0) {
            containersMap.forEach((seal, container) => {
                doc.text(`- ${container}${seal ? ` / Seal: ${seal}` : ''}`, leftCol + 2, y);
                y += 4;
            });
        } else {
            doc.text('- N/A', leftCol + 2, y);
            y += 4;
        }
        y += 4;

        // Special Notes
        doc.setFont('helvetica', 'bold');
        doc.text('Special Notes:', leftCol, y);
        doc.setFont('helvetica', 'normal');
        const specialNotes = (inv as any).specialNotes || (inv as any).memo || 'NO WOOD PRESENT IN THE CARGO';
        doc.text(specialNotes, leftValCol, y);

        // Return doc for preview (don't save)
        return doc;
    };



    // Wrapper for downloading SLI directly
    const generateSLI = (inv: Invoice) => {
        const doc = generateSLIPreview(inv);
        doc.save(`SLI_${inv.invoiceNumber || 'unknown'}.pdf`);
    };

    // Generate Invoice PDF matching EC4 Enterprises layout
    const generateInvoicePDF = async (inv: Invoice, autoDownload = true) => {
        console.log('[PDF] ====== generateInvoicePDF called ======', inv?.invoiceNumber);
        console.log('[PDF] Invoice memo from prop:', (inv as any).memo);

        // DIRECT DB FETCH for memo (bypass hook caching issues)
        let fetchedMemo = (inv as any).memo || '';
        try {
            const client = getSupabaseClient();
            if (client && inv.id) {
                const { data: freshInvoice, error } = await client
                    .from('invoices')
                    .select('memo')
                    .eq('id', inv.id)
                    .single();

                console.log('[PDF] Direct DB fetch for memo:', freshInvoice, error);

                if (freshInvoice && freshInvoice.memo) {
                    fetchedMemo = freshInvoice.memo;
                    console.log('[PDF] Memo fetched directly from DB:', fetchedMemo);
                }
            }
        } catch (err) {
            console.error('[PDF] Error fetching memo:', err);
        }

        const doc = new jsPDF();
        const linkedPL = getLinkedPL(inv);

        // Color scheme matching EC4 Enterprises
        const cyanColor = '#00A0B0';
        const darkGray = '#333333';
        const lightGray = '#666666';
        const tableHeaderBg = '#E8F4F5';

        // Get company info
        const company = availableCompanies.find(c => c.id === currentCompanyId);
        const companyName = company?.name || 'EC4 ENTERPRISES LLC';
        const companyAddress = company?.address || '112 Bartran Oaks Walk #600010';
        const companyCity = `${company?.city || 'ST Johns'}, ${company?.state || 'FL'} ${company?.zip || '32260'} US`;
        const companyPhone = '9044399343';
        const companyEmail = 'felipe@ec4.enterprises';
        const companyWeb = 'www.ec4.enterprises';

        // --- HEADER ---
        // Company info on left side (always starts at same position)
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(darkGray);
        doc.text(companyName, 14, 15);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(companyAddress, 14, 21);
        doc.text(companyCity, 14, 26);
        doc.text(companyPhone, 14, 31);
        doc.text(companyEmail, 14, 36);
        doc.text(companyWeb, 14, 41);

        // Logo on right side (top right corner)
        if (logoUrl) {
            try {
                console.log('[Invoice PDF] Found company logo, URL length:', logoUrl.length);

                // Extract format from base64 data URL
                let format = 'JPEG';
                if (logoUrl.startsWith('data:image/')) {
                    const match = logoUrl.match(/data:image\/(\w+);/);
                    if (match) {
                        format = match[1].toUpperCase();
                        if (format === 'JPG') format = 'JPEG';
                    }
                }

                const imgProps = doc.getImageProperties(logoUrl);
                const maxWidth = 60;
                const maxHeight = 30;
                let width = imgProps.width;
                let height = imgProps.height;
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width *= ratio;
                height *= ratio;

                // Position logo at top right (page width is 210mm for A4, minus margin and logo width)
                const logoX = 210 - 14 - width;
                doc.addImage(logoUrl, format, logoX, 10, width, height);
                console.log('[Invoice PDF] Logo added at top right');
            } catch (e) {
                console.error('[Invoice PDF] Logo load failed:', e);
            }
        } else {
            console.log('[Invoice PDF] No company logo available');
        }

        // --- INVOICE TITLE ---
        doc.setFontSize(20);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(cyanColor);
        doc.text('INVOICE', 14, 54);

        // --- BILL TO / SHIP TO / INVOICE INFO ---
        let y = 68;

        // Find customer for full profile
        const billToName = inv.billToName || inv.soldTo || '';
        const customer = customers.find(c => c.name === billToName || c.id === (inv as any).customerId);

        // Build full customer address
        let customerAddress = '';
        if (customer) {
            const addrParts = [customer.location, customer.city, customer.state, customer.zip, customer.country].filter(Boolean);
            customerAddress = addrParts.join(', ');
        }

        // Bill To Header
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(darkGray);
        doc.text('BILL TO', 14, y);

        // Ship To Header
        doc.text('SHIP TO', 75, y);

        // Invoice details (right side) - consistent line spacing of 6pt
        const lineHeight = 6;
        doc.setTextColor(darkGray);
        doc.text('INVOICE #', 140, y);
        doc.setFont('helvetica', 'normal');
        doc.text(inv.invoiceNumber || '', 175, y);

        y += lineHeight;
        doc.setFont('helvetica', 'bold');
        doc.text('DATE', 140, y);
        doc.setFont('helvetica', 'normal');
        doc.text(new Date(inv.date || inv.invoiceDate || '').toLocaleDateString(), 175, y);

        y += lineHeight;
        doc.setFont('helvetica', 'bold');
        doc.text('SO #', 140, y);
        doc.setFont('helvetica', 'normal');
        doc.text((inv as any).salesOrderNumber || (inv as any).soNumber || inv.customerPo || '-', 175, y);

        y += lineHeight;
        doc.setFont('helvetica', 'bold');
        doc.text('BOOKING #', 140, y);
        doc.setFont('helvetica', 'normal');
        doc.text((inv as any).bookingNumber || inv.transportRef || '-', 175, y);

        // --- BILL TO Content (Full Customer Profile) - consistent 4pt line height ---
        const contentLineHeight = 4;
        y = 74;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        let billToY = y;

        // Customer Name
        doc.setFont('helvetica', 'bold');
        const billToNameLines = doc.splitTextToSize(billToName, 55);
        doc.text(billToNameLines, 14, billToY);
        billToY += billToNameLines.length * contentLineHeight;

        // Customer Address
        doc.setFont('helvetica', 'normal');
        if (customerAddress) {
            const addrLines = doc.splitTextToSize(customerAddress, 55);
            doc.text(addrLines, 14, billToY);
            billToY += addrLines.length * contentLineHeight;
        }

        // Customer Email
        if (customer?.email) {
            doc.text(customer.email, 14, billToY);
            billToY += contentLineHeight;
        }

        // Customer Tax ID
        if (customer?.taxId) {
            doc.text(`CNPJ : ${customer.taxId}`, 14, billToY);
        }

        // --- SHIP TO Content (Full Customer Profile) - consistent 5pt line height ---
        let shipToY = y;
        const shipToName = (inv as any).consignee || billToName;

        // Ship To Name
        doc.setFont('helvetica', 'bold');
        const shipToNameLines = doc.splitTextToSize(shipToName, 55);
        doc.text(shipToNameLines, 75, shipToY);
        shipToY += shipToNameLines.length * contentLineHeight;

        // Ship To Address (same customer or consignee address)
        doc.setFont('helvetica', 'normal');
        if (customerAddress) {
            const addrLines = doc.splitTextToSize(customerAddress, 55);
            doc.text(addrLines, 75, shipToY);
            shipToY += addrLines.length * contentLineHeight;
        }

        // Ship To Email
        if (customer?.email) {
            doc.text(customer.email, 75, shipToY);
            shipToY += contentLineHeight;
        }

        // Ship To Tax ID
        if (customer?.taxId) {
            doc.text(`CNPJ : ${customer.taxId}`, 75, shipToY);
        }

        // --- TERMS / INCOTERM / POD ROW (removed POA) ---
        y = 110;
        doc.setDrawColor(200);
        doc.line(14, y, 196, y);

        y += 8;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(darkGray);
        doc.text('TERMS', 14, y);
        doc.text('INCOTERM', 90, y);
        doc.text('POD', 155, y);

        y += 6;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(cyanColor);

        // Payment Terms
        const termsText = inv.paymentTerms || 'ADV / CAD';
        doc.text(termsText.length > 25 ? termsText.substring(0, 25) : termsText, 14, y);

        // Incoterm with name lookup
        const incotermCode = inv.incoterm || 'CFR';
        const incotermNames: { [key: string]: string } = {
            'EXW': 'EX WORKS',
            'FCA': 'FREE CARRIER',
            'CPT': 'CARRIAGE PAID TO',
            'CIP': 'CARRIAGE AND INSURANCE PAID TO',
            'DAT': 'DELIVERED AT TERMINAL',
            'DAP': 'DELIVERED AT PLACE',
            'DDP': 'DELIVERED DUTY PAID',
            'FAS': 'FREE ALONGSIDE SHIP',
            'FOB': 'FREE ON BOARD',
            'CFR': 'COST AND FREIGHT',
            'CIF': 'COST, INSURANCE AND FREIGHT'
        };
        const incotermDisplay = `${incotermCode} - ${incotermNames[incotermCode] || incotermCode}`;
        doc.text(incotermDisplay, 90, y);

        // POD with port name lookup
        const podCode = inv.pod || '';
        const podPort = ports.find((p: any) => p.code === podCode);
        const podDisplay = podPort ? `${podCode} - ${podPort.name}` : podCode || '-';
        doc.text(podDisplay, 155, y);

        // --- ITEMS TABLE ---
        y += 12;
        const items = typeof inv.items === 'string' ? JSON.parse(inv.items) : inv.items || [];

        const tableHead = [['DESCRIPTION', 'HS CODE', 'QTY (LBS/KG)', 'UNIT PRICE ($/LB - $/KG)', 'AMOUNT US$']];
        console.log('[PDF] Items from invoice:', items.map((i: any) => ({ desc: i.customerDescription?.substring(0, 30), hsCode: i.hsCode })));

        const tableBody = items.map((item: any) => {
            // Use customerDescription first if present
            let description = (item.customerDescription || '').trim();
            if (!description && item.productId && products.length > 0) {
                const prod = products.find((p: any) => p.id === item.productId);
                if (prod) description = prod.name;
            }
            if (!description) description = `${item.productDescription || item.description || ''}`.trim();

            // Get HS Code directly from item (stored in invoice items JSON)
            const hsCode = item.hsCode || '';
            console.log('[PDF] Item hsCode:', hsCode, 'for:', description.substring(0, 40));

            // QTY - show both lbs and kgs with units
            const netLbs = item.netLbs || item.quantity || 0;
            const netKgs = netLbs / 2.20462; // Convert lbs to kg
            const qtyDisplay = `${netLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} lbs\n${netKgs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;

            // Unit Price - show both $/lb and $/kg
            const unitPriceLbs = item.unitPriceLbs || item.unitPrice || 0;
            const unitPriceKgs = unitPriceLbs * 2.20462; // Convert $/lb to $/kg
            const priceDisplay = `$${unitPriceLbs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/lb\n$${unitPriceKgs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/kg`;

            // Amount with $ and format
            const amount = item.amount || 0;
            const amountDisplay = `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

            return [
                description,
                hsCode || '-',
                qtyDisplay,
                priceDisplay,
                amountDisplay
            ];
        });

        autoTable(doc, {
            startY: y,
            head: tableHead,
            body: tableBody,
            theme: 'plain',
            styles: {
                fontSize: 9,
                textColor: darkGray,
                cellPadding: 4,
                valign: 'top'
            },
            headStyles: {
                fillColor: tableHeaderBg,
                textColor: cyanColor,
                fontStyle: 'bold',
                halign: 'left'
            },
            columnStyles: {
                0: { cellWidth: 60 },
                1: { cellWidth: 25 },
                2: { halign: 'right', cellWidth: 25 },
                3: { halign: 'right', cellWidth: 25 },
                4: { halign: 'right', cellWidth: 35 }
            }
        });

        let finalY = (doc as any).lastAutoTable.finalY + 10;

        // --- WEIGHT & CONTAINER INFO ---
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(darkGray);

        const totalNetKg = items.reduce((sum: number, item: any) => sum + (item.netKg || (item.netLbs || 0) * 0.453592), 0);
        const totalGrossKg = items.reduce((sum: number, item: any) => sum + (item.grossKg || (item.grossLbs || 0) * 0.453592), 0);
        const totalVolumes = items.reduce((sum: number, item: any) => sum + (item.volumes || 0), 0);

        doc.text(`Net weight : ${totalNetKg.toLocaleString(undefined, { minimumFractionDigits: 1 })} Kgs`, 14, finalY);
        doc.text(`Gross Weight : ${totalGrossKg.toLocaleString(undefined, { minimumFractionDigits: 1 })} Kgs`, 14, finalY + 5);
        doc.text(`Total volumes : ${totalVolumes}`, 14, finalY + 10);

        // Container details
        const containerData = typeof inv.containers === 'string' ? JSON.parse(inv.containers || '[]') : inv.containers || [];
        if (containerData.length > 0) {
            finalY += 18;
            doc.setFont('helvetica', 'bold');
            doc.text('Container No.    Seal No.    Volumes', 14, finalY);
            doc.setFont('helvetica', 'normal');
            containerData.forEach((cont: any, idx: number) => {
                const contItems = items.filter((i: any) => i.containerNo === cont.container);
                const contVolumes = contItems.reduce((sum: number, i: any) => sum + (i.volumes || 0), 0);
                doc.text(`${cont.container || ''}    ${cont.seal || ''}    ${contVolumes}`, 14, finalY + 5 + (idx * 5));
            });
        }

        // --- TOTALS (Right side) - Only show TOTAL ---
        const totalAmount = items.reduce((sum: number, item: any) => sum + (item.amount || 0), 0);

        let totalsY = finalY - 5; // Move TOTAL up, closer to the last product row
        const labelX = 130;
        const valueX = 195;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text('TOTAL', labelX, totalsY);
        doc.text(`$${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, valueX, totalsY, { align: 'right' });

        // --- SIDE BY SIDE: ADDITIONAL INFORMATION (left) and BANK DETAILS (right) ---
        const invoiceMemo = fetchedMemo;
        let sectionY = totalsY + 25; // 5 lines spacing from TOTAL

        // Check if we need a new page
        if (sectionY > 250) {
            doc.addPage();
            sectionY = 20;
        }

        // Get bank details from saved invoice
        const invBankName = inv.bankName || '';
        const invBankAddress = inv.bankAddress || '';
        const invAccountNumber = inv.accountNumber || '';
        const invSwiftCode = inv.swiftCode || '';
        const invRoutingNumber = inv.routingNumber || '';

        const leftColX = 14;
        const rightColX = 110; // Right column starts at X=110
        const hasMemo = invoiceMemo && invoiceMemo.trim();
        const hasBank = !!invBankName;

        // Print both titles on the same row
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(cyanColor);

        if (hasMemo) {
            doc.text('ADDITIONAL INFORMATION', leftColX, sectionY);
        }
        if (hasBank) {
            doc.text('BANK DETAILS', rightColX, sectionY);
        }

        const titleY = sectionY;
        let leftY = sectionY + 6;
        let rightY = sectionY + 6;

        // --- LEFT COLUMN: Additional Information (Memo) ---
        if (hasMemo) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(darkGray);

            // Split memo into lines to handle wrapping (narrower width for left column)
            const memoLines = doc.splitTextToSize(invoiceMemo, 85);
            doc.text(memoLines, leftColX, leftY);
            leftY += memoLines.length * 4;
        }

        // --- RIGHT COLUMN: Bank Details ---
        if (hasBank) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(darkGray);

            const bankLabelX = rightColX;
            const bankValueX = rightColX + 28;

            doc.setFont('helvetica', 'bold');
            doc.text('Bank Name:', bankLabelX, rightY);
            doc.setFont('helvetica', 'normal');
            doc.text(invBankName, bankValueX, rightY);
            rightY += 5;

            if (invBankAddress) {
                doc.setFont('helvetica', 'bold');
                doc.text('Bank Address:', bankLabelX, rightY);
                doc.setFont('helvetica', 'normal');
                const addrLines = doc.splitTextToSize(invBankAddress, 55);
                doc.text(addrLines, bankValueX, rightY);
                rightY += addrLines.length * 4 + 1;
            }

            if (invSwiftCode) {
                doc.setFont('helvetica', 'bold');
                doc.text('SWIFT Code:', bankLabelX, rightY);
                doc.setFont('helvetica', 'normal');
                doc.text(invSwiftCode, bankValueX, rightY);
                rightY += 5;
            }

            if (invRoutingNumber) {
                doc.setFont('helvetica', 'bold');
                doc.text('Routing #:', bankLabelX, rightY);
                doc.setFont('helvetica', 'normal');
                doc.text(invRoutingNumber, bankValueX, rightY);
                rightY += 5;
            }

            if (invAccountNumber) {
                doc.setFont('helvetica', 'bold');
                doc.text('Account #:', bankLabelX, rightY);
                doc.setFont('helvetica', 'normal');
                doc.text(invAccountNumber, bankValueX, rightY);
                rightY += 5;
            }
        }

        // Set finalY to the max of both columns
        finalY = Math.max(leftY, rightY) + 5;

        // Add EC4 stamp at bottom-right
        if (stampUrl && companyName.toUpperCase().includes('EC4')) {
            try {
                const stampSize = 35;
                const stampX = 196 - stampSize;
                const stampY = Math.min(finalY + 5, 260);
                doc.addImage(stampUrl, 'PNG', stampX, stampY, stampSize, stampSize);
            } catch (e) {
                console.warn('[Invoice PDF] Could not add stamp:', e);
            }
        }

        if (autoDownload) {
            doc.save(`Invoice_${inv.invoiceNumber || 'unknown'}.pdf`);
        }
        return doc;
    };

    // Generate Packing List PDF matching EC4 Enterprises layout
    const generatePackingListPDF = (inv: Invoice, autoDownload = true) => {
        const doc = new jsPDF();
        const linkedPL = getLinkedPL(inv);

        // Color scheme matching EC4 Enterprises
        const cyanColor = '#00A0B0';
        const darkGray = '#333333';
        const tableHeaderBg = '#E8F4F5';

        // Get company info
        const company = availableCompanies.find(c => c.id === currentCompanyId);
        const companyName = company?.name || 'EC4 ENTERPRISES LLC';
        const companyAddress = company?.address || '112 Bartran Oaks Walk #600010';
        const companyCity = `${company?.city || 'ST Johns'}, ${company?.state || 'FL'} ${company?.zip || '32260'} US`;
        const companyPhone = '9044399343';
        const companyEmail = 'felipe@ec4.enterprises';
        const companyWeb = 'www.ec4.enterprises';


        // --- HEADER ---
        // Company info on left side (always starts at same position)
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(darkGray);
        doc.text(companyName, 14, 15);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(companyAddress, 14, 21);
        doc.text(companyCity, 14, 26);
        doc.text(companyPhone, 14, 31);
        doc.text(companyEmail, 14, 36);
        doc.text(companyWeb, 14, 41);

        // Logo on right side (top right corner)
        if (logoUrl) {
            try {
                console.log('[Packing List PDF] Found company logo');

                // Extract format from base64 data URL
                let format = 'JPEG';
                if (logoUrl.startsWith('data:image/')) {
                    const match = logoUrl.match(/data:image\/(\w+);/);
                    if (match) {
                        format = match[1].toUpperCase();
                        if (format === 'JPG') format = 'JPEG';
                    }
                }

                const imgProps = doc.getImageProperties(logoUrl);
                const maxWidth = 60;
                const maxHeight = 30;
                let width = imgProps.width;
                let height = imgProps.height;
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width *= ratio;
                height *= ratio;

                // Position logo at top right
                const logoX = 210 - 14 - width;
                doc.addImage(logoUrl, format, logoX, 10, width, height);
                console.log('[Packing List PDF] Logo added at top right');
            } catch (e) {
                console.error('[Packing List PDF] Logo load failed:', e);
            }
        } else {
            console.log('[Packing List PDF] No company logo available');
        }

        // --- PACKING SLIP TITLE ---
        doc.setFontSize(20);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(cyanColor);
        doc.text('Packing Slip', 14, 54);

        // --- BILL TO / SHIP TO / INVOICE INFO ---
        let y = 68;

        // Find customer for full profile
        const billToName = inv.billToName || inv.soldTo || '';
        const customer = customers.find(c => c.name === billToName || c.id === (inv as any).customerId);

        // Build full customer address
        let customerAddress = '';
        if (customer) {
            const addrParts = [customer.location, customer.city, customer.state, customer.zip, customer.country].filter(Boolean);
            customerAddress = addrParts.join(', ');
        }

        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(darkGray);
        doc.text('BILL TO', 14, y);
        doc.text('SHIP TO', 75, y);

        // Invoice # and Date on right
        doc.text('INVOICE #', 140, y);
        doc.setFont('helvetica', 'normal');
        doc.text(inv.invoiceNumber || '', 170, y);

        y += 6;
        doc.setFont('helvetica', 'bold');
        doc.text('DATE', 140, y);
        doc.setFont('helvetica', 'normal');
        doc.text(new Date(inv.date || inv.invoiceDate || '').toLocaleDateString(), 170, y);

        y += 6;
        doc.setFont('helvetica', 'bold');
        doc.text('SO #', 140, y);
        doc.setFont('helvetica', 'normal');
        doc.text((inv as any).soNumber || inv.customerPo || '-', 170, y);

        y += 6;
        doc.setFont('helvetica', 'bold');
        doc.text('BOOKING #', 140, y);
        doc.setFont('helvetica', 'normal');
        doc.text((inv as any).bookingNumber || inv.transportRef || '-', 170, y);

        // --- BILL TO Content (Full Customer Profile) ---
        y = 74;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        let billToY = y;

        // Customer Name
        doc.setFont('helvetica', 'bold');
        const billToNameLines = doc.splitTextToSize(billToName, 55);
        doc.text(billToNameLines, 14, billToY);
        billToY += billToNameLines.length * 4;

        // Customer Address
        doc.setFont('helvetica', 'normal');
        if (customerAddress) {
            const addrLines = doc.splitTextToSize(customerAddress, 55);
            doc.text(addrLines, 14, billToY);
            billToY += addrLines.length * 4;
        }

        // Customer Email
        if (customer?.email) {
            doc.text(customer.email, 14, billToY);
            billToY += 4;
        }

        // Customer Tax ID
        if (customer?.taxId) {
            doc.text(`CNPJ : ${customer.taxId}`, 14, billToY);
        }

        // --- SHIP TO Content (Full Customer Profile) ---
        let shipToY = y;
        const shipToName = (inv as any).consignee || billToName;

        // Ship To Name
        doc.setFont('helvetica', 'bold');
        const shipToNameLines = doc.splitTextToSize(shipToName, 55);
        doc.text(shipToNameLines, 75, shipToY);
        shipToY += shipToNameLines.length * 4;

        // Ship To Address
        doc.setFont('helvetica', 'normal');
        if (customerAddress) {
            const addrLines = doc.splitTextToSize(customerAddress, 55);
            doc.text(addrLines, 75, shipToY);
            shipToY += addrLines.length * 4;
        }

        // Ship To Email
        if (customer?.email) {
            doc.text(customer.email, 75, shipToY);
            shipToY += 4;
        }

        // Ship To Tax ID
        if (customer?.taxId) {
            doc.text(`CNPJ : ${customer.taxId}`, 75, shipToY);
        }

        // --- TERMS / INCOTERM / POD ROW (matching Invoice layout) ---
        y = 110;
        doc.setDrawColor(200);
        doc.line(14, y, 196, y);

        y += 8;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(darkGray);
        doc.text('TERMS', 14, y);
        doc.text('INCOTERM', 90, y);
        doc.text('POD', 155, y);

        y += 6;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(cyanColor);

        // Payment Terms
        const termsTextPL = inv.paymentTerms || 'ADV / CAD';
        doc.text(termsTextPL.length > 25 ? termsTextPL.substring(0, 25) : termsTextPL, 14, y);

        // Incoterm with name lookup (matching Invoice)
        const incotermCode = inv.incoterm || 'CFR';
        const incotermNames: { [key: string]: string } = {
            'EXW': 'EX WORKS',
            'FCA': 'FREE CARRIER',
            'CPT': 'CARRIAGE PAID TO',
            'CIP': 'CARRIAGE AND INSURANCE PAID TO',
            'DAT': 'DELIVERED AT TERMINAL',
            'DAP': 'DELIVERED AT PLACE',
            'DDP': 'DELIVERED DUTY PAID',
            'FAS': 'FREE ALONGSIDE SHIP',
            'FOB': 'FREE ON BOARD',
            'CFR': 'COST AND FREIGHT',
            'CIF': 'COST, INSURANCE AND FREIGHT'
        };
        const incotermDisplay = `${incotermCode} - ${incotermNames[incotermCode] || incotermCode}`;
        doc.text(incotermDisplay, 90, y);

        // POD with port name lookup (matching Invoice)
        const podCode = inv.pod || '';
        const podPort = ports.find((p: any) => p.code === podCode);
        const podDisplay = podPort ? `${podCode} - ${podPort.name}` : podCode || '-';
        doc.text(podDisplay, 155, y);

        // --- ITEMS TABLE (Same as Invoice but without Unit Price and Amount) ---
        y += 12;
        const items = typeof inv.items === 'string' ? JSON.parse(inv.items) : inv.items || [];

        const tableHead = [['DESCRIPTION', 'HS CODE', 'QTY (LBS/KG)']];
        const tableBody = items.map((item: any) => {
            // Use customerDescription first if present
            let description = (item.customerDescription || '').trim();
            if (!description && item.productId && products.length > 0) {
                const prod = products.find((p: any) => p.id === item.productId);
                if (prod) description = prod.name;
            }
            if (!description) description = `${item.productDescription || item.description || ''}`.trim();

            // Get HS Code directly from item
            const hsCode = item.hsCode || '';

            // QTY - show both lbs and kgs with units
            const netLbs = item.netLbs || item.quantity || 0;
            const netKgs = netLbs / 2.20462; // Convert lbs to kg
            const qtyDisplay = `${netLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} lbs\n${netKgs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;

            return [
                description,
                hsCode || '-',
                qtyDisplay
            ];
        });

        autoTable(doc, {
            startY: y,
            head: tableHead,
            body: tableBody,
            theme: 'plain',
            styles: {
                fontSize: 9,
                textColor: darkGray,
                cellPadding: 4,
                valign: 'top'
            },
            headStyles: {
                fillColor: tableHeaderBg,
                textColor: cyanColor,
                fontStyle: 'bold',
                halign: 'left'
            },
            columnStyles: {
                0: { cellWidth: 100 },
                1: { cellWidth: 35 },
                2: { halign: 'right', cellWidth: 35 }
            }
        });

        let finalY = (doc as any).lastAutoTable.finalY + 15;

        // --- RESUME PER CONTAINER TABLE ---
        const containerData = typeof inv.containers === 'string' ? JSON.parse(inv.containers || '[]') : inv.containers || [];

        if (containerData.length > 0) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.setTextColor(darkGray);
            doc.text('SUMMARY BY CONTAINER', 14, finalY);
            finalY += 5;

            const containerTableHead = [['CONTAINER NO.', 'SEAL NO.', 'VOLUMES', 'NET WEIGHT (KG)', 'GROSS WEIGHT (KG)']];
            const containerTableBody = containerData.map((cont: any) => {
                const contItems = items.filter((i: any) => i.containerNo === cont.container);
                const contVolumes = contItems.reduce((sum: number, i: any) => sum + (i.volumes || 0), 0);
                const contNetKg = contItems.reduce((sum: number, i: any) => sum + (i.netKg || (i.netLbs || 0) * 0.453592), 0);
                const contGrossKg = contItems.reduce((sum: number, i: any) => sum + (i.grossKg || (i.grossLbs || 0) * 0.453592), 0);
                return [
                    cont.container || '-',
                    cont.seal || '-',
                    contVolumes.toString(),
                    contNetKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                    contGrossKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
                ];
            });

            // Add totals row
            const totalVolumes = items.reduce((sum: number, item: any) => sum + (item.volumes || 0), 0);
            const totalNetKg = items.reduce((sum: number, item: any) => sum + (item.netKg || (item.netLbs || 0) * 0.453592), 0);
            const totalGrossKg = items.reduce((sum: number, item: any) => sum + (item.grossKg || (item.grossLbs || 0) * 0.453592), 0);
            containerTableBody.push([
                'TOTAL',
                '',
                totalVolumes.toString(),
                totalNetKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                totalGrossKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
            ]);

            autoTable(doc, {
                startY: finalY,
                head: containerTableHead,
                body: containerTableBody,
                theme: 'plain',
                styles: {
                    fontSize: 8,
                    textColor: darkGray,
                    cellPadding: 1
                },
                headStyles: {
                    fillColor: tableHeaderBg,
                    textColor: cyanColor,
                    fontStyle: 'bold'
                },
                columnStyles: {
                    0: { cellWidth: 40 },
                    1: { cellWidth: 35 },
                    2: { halign: 'center', cellWidth: 25 },
                    3: { halign: 'right', cellWidth: 35 },
                    4: { halign: 'right', cellWidth: 35 }
                }
            });

            finalY = (doc as any).lastAutoTable.finalY + 15;
        }

        // --- RESUME PER PRODUCTS TABLE ---
        // Group items by product description
        const productSummary: { [key: string]: { description: string; netLbs: number; netKg: number; grossKg: number; volumes: number } } = {};
        items.forEach((item: any) => {
            // Use customerDescription first if present
            let desc = (item.customerDescription || '').trim();
            if (!desc && item.productId && products.length > 0) {
                const prod = products.find((p: any) => p.id === item.productId);
                if (prod) desc = prod.name;
            }
            if (!desc) desc = (item.productDescription || item.description || '').trim();
            const key = desc || 'Unknown Product';
            if (!productSummary[key]) {
                productSummary[key] = {
                    description: key,
                    netLbs: 0,
                    netKg: 0,
                    grossKg: 0,
                    volumes: 0
                };
            }
            productSummary[key].netLbs += item.netLbs || item.quantity || 0;
            productSummary[key].netKg += item.netKg || (item.netLbs || 0) * 0.453592;
            productSummary[key].grossKg += item.grossKg || (item.grossLbs || 0) * 0.453592;
            productSummary[key].volumes += item.volumes || 0;
        });

        const productRows = Object.values(productSummary);
        if (productRows.length > 0) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.setTextColor(darkGray);
            doc.text('SUMMARY BY PRODUCT', 14, finalY);
            finalY += 5;

            const productTableHead = [['PRODUCT DESCRIPTION', 'VOLUMES', 'NET WEIGHT (KG)', 'GROSS WEIGHT (KG)']];
            const productTableBody = productRows.map(p => [
                p.description.length > 60 ? p.description.substring(0, 60) + '...' : p.description,
                p.volumes.toString(),
                p.netKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                p.grossKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            ]);

            // Add totals row
            const grandTotalVolumes = productRows.reduce((sum, p) => sum + p.volumes, 0);
            const grandTotalNetKg = productRows.reduce((sum, p) => sum + p.netKg, 0);
            const grandTotalGrossKg = productRows.reduce((sum, p) => sum + p.grossKg, 0);
            productTableBody.push([
                'TOTAL',
                grandTotalVolumes.toString(),
                grandTotalNetKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                grandTotalGrossKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
            ]);

            autoTable(doc, {
                startY: finalY,
                head: productTableHead,
                body: productTableBody,
                theme: 'plain',
                styles: {
                    fontSize: 8,
                    textColor: darkGray,
                    cellPadding: 1
                },
                headStyles: {
                    fillColor: tableHeaderBg,
                    textColor: cyanColor,
                    fontStyle: 'bold'
                },
                columnStyles: {
                    0: { cellWidth: 80 },
                    1: { halign: 'center', cellWidth: 25 },
                    2: { halign: 'right', cellWidth: 35 },
                    3: { halign: 'right', cellWidth: 35 }
                }
            });
        }

        // Add EC4 stamp at bottom-right
        if (stampUrl && companyName.toUpperCase().includes('EC4')) {
            try {
                const lastPageHeight = (doc as any).lastAutoTable?.finalY || 200;
                const stampSize = 35;
                const stampX = 196 - stampSize;
                const stampY = Math.min(lastPageHeight + 10, 260);
                doc.addImage(stampUrl, 'PNG', stampX, stampY, stampSize, stampSize);
            } catch (e) {
                console.warn('[PL PDF] Could not add stamp:', e);
            }
        }

        if (autoDownload) {
            doc.save(`PackingList_${inv.invoiceNumber || 'unknown'}.pdf`);
        }
        return doc;
    };

    // ========================================================================
    // RENDER STEP INDICATOR
    // ========================================================================
    const renderStepIndicator = () => (
        <div className="flex items-center justify-center gap-2 mb-8">
            {[
                { step: 'UPLOAD' as WizardStep, label: 'Upload PL', icon: Upload },
                { step: 'EDIT_PL' as WizardStep, label: 'Edit & Verify', icon: Edit3 },
                { step: 'CREATE_INVOICE' as WizardStep, label: 'Create Invoice', icon: FileText }
            ].map((s, idx) => {
                const isActive = currentStep === s.step;
                const isPast = (currentStep === 'EDIT_PL' && s.step === 'UPLOAD') ||
                    (currentStep === 'CREATE_INVOICE' && s.step !== 'CREATE_INVOICE');
                const Icon = s.icon;

                return (
                    <React.Fragment key={s.step}>
                        {idx > 0 && (
                            <div className={`w-12 h-0.5 ${isPast ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                        )}
                        <button
                            onClick={() => goToStep(s.step)}
                            disabled={s.step === 'EDIT_PL' && !canProceedToStep2() || s.step === 'CREATE_INVOICE' && !canProceedToStep3()}
                            className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all ${isActive
                                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg'
                                : isPast
                                    ? 'bg-emerald-100 text-emerald-700 cursor-pointer hover:bg-emerald-200'
                                    : 'bg-slate-100 text-slate-400'
                                } ${!isActive && !isPast ? 'cursor-not-allowed' : ''}`}
                        >
                            <Icon size={18} />
                            <span className="text-sm font-bold">{s.label}</span>
                        </button>
                    </React.Fragment>
                );
            })}
        </div>
    );

    // ========================================================================
    // STEP 1: UPLOAD
    // ========================================================================
    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        setProcessingError(null);

        // Add files to the queue (don't process yet - wait for user to click Process)
        const newFiles: FileQueueItem[] = Array.from(files).map((file: File) => ({
            id: Math.random().toString(36).substr(2, 9),
            file,
            status: 'idle' as const
        }));
        setPendingFiles(prev => [...prev, ...newFiles]);
        e.target.value = '';
    };

    const handleLoadSavedPL = async (pl: PackingList) => {
        // Clear any existing PL data before loading new one
        resetPLState();

        try {
            let originalDoc = pl.originalDocument;

            // Fetch original document if not included in list view
            if (!originalDoc) {
                const client = getSupabaseClient();
                if (client) {
                    const { data } = await client.from('packing_lists').select('originalDocument').eq('id', pl.id).single();
                    if (data && data.originalDocument) {
                        originalDoc = data.originalDocument;
                    }
                }
            }

            let parsedItems = JSON.parse(pl.items || '[]');

            // Distribute containers to items if needed
            const containerNumbers = pl.containerNumber ? pl.containerNumber.split(',').map(s => s.trim()).filter(Boolean) : [];
            const sealNumbers = pl.sealNumber ? pl.sealNumber.split(',').map(s => s.trim()) : [];

            if (containerNumbers.length > 0) {
                parsedItems = parsedItems.map((item: any, idx: number) => {
                    let assignedContainer = (item.containerNo && item.containerNo.toLowerCase() !== 'unknown') ? item.containerNo : '';
                    let assignedSeal = item.sealNo || '';

                    if (!assignedContainer && containerNumbers.length > 0) {
                        const containerIndex = idx % containerNumbers.length;
                        assignedContainer = containerNumbers[containerIndex];
                        assignedSeal = sealNumbers[containerIndex] || '';
                    }

                    return {
                        ...item,
                        containerNo: assignedContainer,
                        sealNo: assignedSeal || item.sealNo || ''
                    };
                });
            }

            // Re-inject original document into items
            if (originalDoc) {
                parsedItems = parsedItems.map((item: any) => ({
                    ...item,
                    originalDoc: item.originalDoc || originalDoc
                }));
            }

            // Refresh product names from DB to ensure current standard descriptions
            if (products.length > 0) {
                parsedItems = parsedItems.map((item: any) => {
                    if (item.productId) {
                        const product = products.find(p => p.id === item.productId);
                        if (product) {
                            const standardName = product.grade
                                ? `${product.name} (${product.grade})`
                                : product.name;
                            return {
                                ...item,
                                productName: standardName,
                                productGrade: product.grade || ''
                            };
                        }
                    }
                    return item;
                });
            }

            setPlItems(parsedItems);
            setEditingPLId(pl.id);
            setPlNumber(pl.plNumber || '');
            setSoNumber(pl.soNumber || '');
            setPlDate(pl.date || new Date().toISOString().split('T')[0]);
            setBookingNumber(pl.blNumber || '');

            // Auto-populate POD/POA from booking
            if (pl.blNumber) {
                const linkedBooking = allBookings.find(b => b.bookingNumber === pl.blNumber);
                if (linkedBooking) {
                    if (linkedBooking.pod) setPod(linkedBooking.pod);
                    if (linkedBooking.pol) setPoa(linkedBooking.pol);
                }
            }

            setShipper(pl.shipper || '');
            setSupplier(pl.supplier || parsedItems[0]?.supplier || '');
            setConsignee(pl.consignee || '');
            setContainerNumber(pl.containerNumber || '');
            setSealNumber(pl.sealNumber || '');
            setGrossWeight(pl.grossWeight || '');
            setNetWeight(pl.netWeight || '');
            setUnitCount(pl.unitCount || '');
            setCurrentPL(pl);
            setCurrentStep('EDIT_PL');
        } catch (e) {
            console.error("Failed to parse items", e);
            alert("Error loading saved items.");
        }
    };

    // Create invoice directly from PL without opening PL editor
    const handleCreateInvoiceFromPL = async (pl: PackingList) => {
        // Clear any existing data
        resetPLState();

        try {
            // Parse PL items
            let parsedItems = JSON.parse(pl.items || '[]');

            // Distribute containers to items if needed
            const containerNumbers = pl.containerNumber ? pl.containerNumber.split(',').map(s => s.trim()).filter(Boolean) : [];
            const sealNumbers = pl.sealNumber ? pl.sealNumber.split(',').map(s => s.trim()) : [];

            if (containerNumbers.length > 0) {
                parsedItems = parsedItems.map((item: any, idx: number) => {
                    let assignedContainer = (item.containerNo && item.containerNo.toLowerCase() !== 'unknown') ? item.containerNo : '';
                    let assignedSeal = item.sealNo || '';

                    if (!assignedContainer && containerNumbers.length > 0) {
                        const containerIndex = idx % containerNumbers.length;
                        assignedContainer = containerNumbers[containerIndex];
                        assignedSeal = sealNumbers[containerIndex] || '';
                    }

                    return {
                        ...item,
                        containerNo: assignedContainer,
                        sealNo: assignedSeal || item.sealNo || ''
                    };
                });
            }

            // Refresh product names from DB
            if (products.length > 0) {
                parsedItems = parsedItems.map((item: any) => {
                    if (item.productId) {
                        const product = products.find(p => p.id === item.productId);
                        if (product) {
                            const standardName = product.grade
                                ? `${product.name} (${product.grade})`
                                : product.name;
                            return { ...item, productName: standardName, productGrade: product.grade || '' };
                        }
                    }
                    return item;
                });
            }

            // Set PL data to state (needed for populateFromPL)
            setPlItems(parsedItems);
            setPlNumber(pl.plNumber || '');
            setSoNumber(pl.soNumber || '');
            setConsignee(pl.consignee || '');
            setSupplier(pl.supplier || parsedItems[0]?.supplier || '');
            setBookingNumber(pl.blNumber || '');

            // Auto-populate POD/POA from booking
            if (pl.blNumber) {
                const linkedBooking = allBookings.find(b => b.bookingNumber === pl.blNumber);
                if (linkedBooking) {
                    if (linkedBooking.pod) setPod(linkedBooking.pod);
                    if (linkedBooking.pol) setPoa(linkedBooking.pol);
                }
            }

            setShipper(pl.shipper || '');
            setCurrentPL(pl);

            // Generate invoice number from PL
            setInvoiceNumber(pl.plNumber ? pl.plNumber.replace('PL-', 'INV-') : `INV-${Date.now().toString().slice(-6)}`);
            setBillToName(pl.consignee || '');

            // Convert PL items to invoice items immediately
            const newInvoiceItems: InvoiceLineItem[] = parsedItems.map((plItem: any, idx: number) => {
                let productDescription = '';
                let resolvedProductId = plItem.productId || '';

                if (plItem.productId && products.length > 0) {
                    const product = products.find((p: any) => p.id === plItem.productId);
                    if (product) {
                        productDescription = product.grade ? `${product.name} (${product.grade})` : product.name;
                    }
                }
                if (!productDescription && plItem.productName) {
                    productDescription = plItem.productName;
                }
                if (!productDescription) {
                    productDescription = plItem.description || 'Product';
                }

                return {
                    ...plItem,
                    id: `inv_${Date.now()}_${idx}`,
                    productId: resolvedProductId,
                    description: productDescription,
                    customerDescription: plItem.customerDescription || '',
                    hsCode: plItem.hsCode || '',
                    quantity: Number(plItem.netLbs || plItem.quantity || 0),
                    unit: 'LBS',
                    unitPrice: Number(plItem.unitPrice || 0),
                    amount: Number(plItem.amount || 0),
                    containerNo: plItem.containerNo || '',
                    sealNo: plItem.sealNo || '',
                    grossLbs: Number(plItem.grossLbs || 0),
                    netLbs: Number(plItem.netLbs || 0),
                    grossKg: Number(plItem.grossKg || (plItem.grossLbs || 0) * 0.453592),
                    netKg: Number(plItem.netKg || (plItem.netLbs || 0) * 0.453592),
                    volumes: Number(plItem.volumes || 0)
                };
            });

            setInvoiceItems(newInvoiceItems);

            // Set containers from PL
            const uniqueContainers = [...new Set(parsedItems.map((i: any) => i.containerNo).filter(Boolean))] as string[];
            const containerRows: ContainerRow[] = uniqueContainers.map((c, idx) => {
                const item = parsedItems.find((i: any) => i.containerNo === c);
                return { id: `cont_${idx}`, container: c, seal: item?.sealNo || '' };
            });
            setContainers(containerRows);

            // Go directly to invoice creation step
            setCurrentStep('CREATE_INVOICE');
        } catch (e) {
            console.error("Failed to create invoice from PL", e);
            alert("Error creating invoice from PL.");
        }
    };

    const handleCreateBlankPL = () => {
        // Create a blank PL and go to edit step
        setPlNumber(`PL-${Date.now().toString().slice(-8)}`);
        setSoNumber('');
        setSupplier('');
        setConsignee('');
        setContainerNumber('');
        setSealNumber('');
        setGrossWeight('');
        setNetWeight('');
        setUnitCount('');
        setPlItems([{
            id: `item_${Date.now()}`,
            containerNo: '',
            sealNo: '',
            grossLbs: 0,
            netLbs: 0,
            grossKg: 0,
            netKg: 0,
            volumes: 0,
            supplier: '',
            description: '',
            blNumber: ''
        }]);
        setCurrentPL(null);
        setCurrentStep('EDIT_PL');
    };

    const handleCreateBlankInvoice = () => {
        // Skip to invoice step with blank form
        setInvoiceNumber(`INV-${Date.now().toString().slice(-6)}`);
        setCustomerPo('');
        setInvoiceItems([{
            id: `item_${Date.now()}`,
            description: '',
            customerDescription: '',
            hsCode: '',
            quantity: 0,
            unit: 'LBS',
            unitPrice: 0,
            unitPriceLbs: 0,
            unitPriceKg: 0,
            amount: 0
        }]);
        setCurrentStep('CREATE_INVOICE');
    };

    const renderUploadStep = () => (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            {/* Hidden file input for Upload button in header */}
            <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={handleFileSelect}
                multiple
                className="hidden"
            />

            {/* Processing indicator */}
            {isProcessing && (
                <div className="flex items-center justify-center gap-3 p-4 bg-indigo-50 rounded-xl border border-indigo-200">
                    <Loader2 size={24} className="text-indigo-500 animate-spin" />
                    <span className="text-indigo-700 font-medium">Processing files...</span>
                </div>
            )}

            {/* Pending files indicator */}
            {pendingFiles.length > 0 && !isProcessing && (
                <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-200">
                    <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-bold text-indigo-700">Files Ready ({pendingFiles.length})</p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setPendingFiles([])}
                                className="text-xs px-3 py-1 text-slate-500 hover:text-slate-700 border border-slate-300 rounded"
                            >
                                Clear
                            </button>
                            <button
                                onClick={processQueue}
                                className="text-xs px-3 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 font-medium"
                            >
                                Process
                            </button>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {pendingFiles.map(f => (
                            <div key={f.id} className="flex items-center gap-1 text-xs bg-white px-2 py-1 rounded border">
                                <FileText size={12} className="text-slate-400" />
                                <span className="truncate max-w-[150px]">{f.file.name}</span>
                                {f.status === 'processing' && <Loader2 size={12} className="animate-spin text-indigo-500" />}
                                {f.status === 'completed' && <CheckCircle2 size={12} className="text-emerald-500" />}
                                {f.status === 'error' && <AlertCircle size={12} className="text-red-500" />}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Saved PLs and Saved Invoices - Side by Side */}
            <div className="grid grid-cols-1 lg:grid-cols-10 gap-4 flex-1 min-h-0">
                {/* Saved PLs - 3/10 width (30%) */}
                <div className="lg:col-span-3 p-4 border-2 border-slate-200 rounded-2xl bg-gradient-to-br from-slate-50 to-white flex flex-col overflow-hidden">
                    <div className="flex items-center gap-2 mb-2">
                        <ClipboardList size={18} className="text-slate-600" />
                        <h4 className="font-bold text-slate-700 text-sm">Saved PLs</h4>
                        <div className="ml-auto flex gap-1">
                            <button
                                onClick={() => setPlFilter('AVAILABLE')}
                                className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${plFilter === 'AVAILABLE' ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}
                            >
                                Available
                            </button>
                            <button
                                onClick={() => setPlFilter('INVOICED')}
                                className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${plFilter === 'INVOICED' ? 'bg-indigo-500 text-white' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}
                            >
                                Invoiced
                            </button>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto min-h-0 max-h-[calc(100vh-22rem)]">
                        {(() => {
                            // Build set of all PL numbers that have been used in invoices
                            const invoicedPLNumbers = new Set(
                                savedInvoices
                                    .map(inv => inv.plNumber)
                                    .filter((pln): pln is string => !!pln && pln.trim() !== '')
                            );
                            console.log('[PL Filter] invoicedPLNumbers:', [...invoicedPLNumbers], 'from', savedInvoices.length, 'invoices');
                            console.log('[PL Filter] savedPLs plNumbers:', savedPLs.map(pl => pl.plNumber));

                            // Filter PLs based on DB status field only (no invoice matching fallback)
                            const filteredPLs = savedPLs.filter(pl => {
                                const plStatus = (pl as any).status || 'AVAILABLE';
                                return plFilter === 'AVAILABLE' ? plStatus !== 'INVOICED' : plStatus === 'INVOICED';
                            });

                            if (filteredPLs.length === 0) {
                                return (
                                    <p className="text-xs text-slate-400 text-center py-4">
                                        {plFilter === 'AVAILABLE' ? 'All PLs have been invoiced' : 'No invoiced PLs yet'}
                                    </p>
                                );
                            }

                            return (
                                <table className="w-full text-xs">
                                    <thead className="bg-slate-100 sticky top-0">
                                        <tr>
                                            <th className="text-left px-1 py-0.5 font-semibold text-slate-500">Date</th>
                                            <th className="text-left px-1 py-0.5 font-semibold text-slate-500">PL #</th>
                                            <th className="text-left px-1 py-0.5 font-semibold text-slate-500">Supplier</th>
                                            <th className="text-left px-1 py-0.5 font-semibold text-slate-500">Status</th>
                                            <th className="text-center px-1 py-0.5 font-semibold text-slate-500">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredPLs.sort((a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime()).slice(0, 24).map(pl => (
                                            <tr
                                                key={pl.id}
                                                className="hover:bg-slate-50 transition-colors border-b border-slate-100"
                                            >
                                                <td className="px-1 py-0.5 text-slate-500">{pl.createdAt ? new Date(pl.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}</td>
                                                <td className="px-1 py-0.5 font-medium text-slate-700">{pl.plNumber || '-'}</td>
                                                <td className="px-1 py-0.5 text-slate-600 truncate max-w-[100px]">{((pl.supplier || '-').split(' ').slice(0, 2).join(' '))}</td>
                                                <td className="px-1 py-0.5">
                                                    <select
                                                        value={(pl as any).status || 'AVAILABLE'}
                                                        onChange={async (e) => {
                                                            const newStatus = e.target.value;
                                                            const client = getSupabaseClient();
                                                            if (!client) return;
                                                            try {
                                                                await client.from('packing_lists').update({ status: newStatus }).eq('id', pl.id);
                                                                setSavedPLs(prev => prev.map(p => p.id === pl.id ? { ...p, status: newStatus as any } : p));
                                                            } catch (err) { console.error('Status update error:', err); }
                                                        }}
                                                        className={`text-[10px] px-1 py-0.5 rounded border border-slate-200 cursor-pointer ${(pl as any).status === 'INVOICED' ? 'text-blue-600 bg-blue-50' : 'text-green-600 bg-green-50'}`}
                                                    >
                                                        <option value="AVAILABLE">Available</option>
                                                        <option value="INVOICED">Invoiced</option>
                                                    </select>
                                                </td>
                                                <td className="px-1 py-0.5 text-center">
                                                    <div className="flex items-center justify-center gap-2">
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleLoadSavedPL(pl); }}
                                                            title="Edit PL"
                                                            className="p-1 rounded hover:bg-indigo-100 text-indigo-600 transition-colors"
                                                        >
                                                            <Edit3 size={14} />
                                                        </button>
                                                        <button
                                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeletePL(pl); }}
                                                            title="Delete PL"
                                                            className="p-1 rounded hover:bg-red-100 text-red-500 transition-colors"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            );
                        })()}
                    </div>
                </div>

                {/* Saved Invoices - 7/10 width (70%) */}
                <div className="lg:col-span-7 p-4 border-2 border-slate-200 rounded-2xl bg-gradient-to-br from-slate-50 to-white flex flex-col overflow-hidden">
                    <div className="flex items-center gap-2 mb-2">
                        <FileText size={20} className="text-slate-600" />
                        <h4 className="font-bold text-slate-700">Saved Invoices</h4>
                        <span className="ml-auto text-xs bg-slate-200 px-2 py-0.5 rounded-full">{invoices.length}</span>
                    </div>
                    <div className="flex-1 overflow-y-auto min-h-0 max-h-[calc(100vh-22rem)]">
                        <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-white z-10">
                                <tr className="border-b border-slate-200">
                                    <th className="text-left py-1 font-bold text-slate-600">Date</th>
                                    <th className="text-left py-1 font-bold text-slate-600">SO #</th>
                                    <th className="text-left py-1 font-bold text-slate-600 relative">
                                        <button
                                            onClick={() => setOpenFilterPopup(openFilterPopup === 'invoice' ? null : 'invoice')}
                                            className={`flex items-center gap-1 hover:text-indigo-600 ${invoiceFilterNumber.length > 0 ? 'text-indigo-600' : ''}`}
                                        >
                                            Invoice # {invoiceFilterNumber.length > 0 && <span className="text-[9px] bg-indigo-500 text-white px-1 rounded-full">{invoiceFilterNumber.length}</span>}
                                            <Filter size={10} />
                                        </button>
                                        {openFilterPopup === 'invoice' && (
                                            <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-50 min-w-[160px] max-h-48 overflow-y-auto">
                                                <div className="p-2 border-b border-slate-100 flex justify-between items-center">
                                                    <span className="text-[10px] text-slate-500">Select invoices</span>
                                                    {invoiceFilterNumber.length > 0 && (
                                                        <button onClick={() => setInvoiceFilterNumber([])} className="text-[9px] text-red-500 hover:text-red-700">Clear</button>
                                                    )}
                                                </div>
                                                {[...new Set(invoices.map(inv => inv.invoiceNumber))].filter(Boolean).sort().map(num => (
                                                    <label key={num} className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 cursor-pointer text-[11px]">
                                                        <input
                                                            type="checkbox"
                                                            checked={invoiceFilterNumber.includes(num)}
                                                            onChange={(e) => {
                                                                if (e.target.checked) {
                                                                    setInvoiceFilterNumber([...invoiceFilterNumber, num]);
                                                                } else {
                                                                    setInvoiceFilterNumber(invoiceFilterNumber.filter(n => n !== num));
                                                                }
                                                            }}
                                                            className="w-3 h-3 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                                        />
                                                        {num}
                                                    </label>
                                                ))}
                                            </div>
                                        )}
                                    </th>
                                    <th className="text-left py-1 font-bold text-slate-600">Booking #</th>
                                    <th className="text-left py-1 font-bold text-slate-600 relative">
                                        <button
                                            onClick={() => setOpenFilterPopup(openFilterPopup === 'customer' ? null : 'customer')}
                                            className={`flex items-center gap-1 hover:text-indigo-600 ${invoiceFilterCustomer.length > 0 ? 'text-indigo-600' : ''}`}
                                        >
                                            Customer {invoiceFilterCustomer.length > 0 && <span className="text-[9px] bg-indigo-500 text-white px-1 rounded-full">{invoiceFilterCustomer.length}</span>}
                                            <Filter size={10} />
                                        </button>
                                        {openFilterPopup === 'customer' && (
                                            <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-50 min-w-[180px] max-h-48 overflow-y-auto">
                                                <div className="p-2 border-b border-slate-100 flex justify-between items-center">
                                                    <span className="text-[10px] text-slate-500">Select customers</span>
                                                    {invoiceFilterCustomer.length > 0 && (
                                                        <button onClick={() => setInvoiceFilterCustomer([])} className="text-[9px] text-red-500 hover:text-red-700">Clear</button>
                                                    )}
                                                </div>
                                                {[...new Set(invoices.map(inv => inv.billToName || inv.soldTo || ''))].filter(Boolean).sort().map((cust: string) => (
                                                    <label key={cust} className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50 cursor-pointer text-[11px]">
                                                        <input
                                                            type="checkbox"
                                                            checked={invoiceFilterCustomer.includes(cust)}
                                                            onChange={(e) => {
                                                                if (e.target.checked) {
                                                                    setInvoiceFilterCustomer([...invoiceFilterCustomer, cust]);
                                                                } else {
                                                                    setInvoiceFilterCustomer(invoiceFilterCustomer.filter(c => c !== cust));
                                                                }
                                                            }}
                                                            className="w-3 h-3 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                                        />
                                                        <span className="truncate max-w-[140px]">{cust}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        )}
                                    </th>
                                    <th className="text-right py-1 font-bold text-slate-600">QTY LBS / KGs</th>
                                    <th className="text-right py-1 font-bold text-slate-600">Total US$</th>
                                    <th className="text-center py-1 font-bold text-slate-600">Actions</th>
                                    <th className="text-center py-1 font-bold text-slate-600">Documents</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(() => {
                                    // Sort by date descending (newest first) and filter
                                    // Use savedInvoices (local state) instead of invoices prop to preserve BOL uploads
                                    const sortedInvoices = [...savedInvoices]
                                        .sort((a, b) => new Date(b.invoiceDate || b.createdAt || 0).getTime() - new Date(a.invoiceDate || a.createdAt || 0).getTime())
                                        .filter(inv => invoiceFilterNumber.length === 0 || invoiceFilterNumber.includes(inv.invoiceNumber))
                                        .filter(inv => invoiceFilterCustomer.length === 0 || invoiceFilterCustomer.includes(inv.billToName || inv.soldTo || ''));

                                    return sortedInvoices.slice(0, 30).map(inv => (
                                        <tr
                                            key={inv.id}
                                            className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                                        >
                                            <td className="py-0.5 text-slate-500">{(inv.invoiceDate || inv.createdAt) ? new Date(inv.invoiceDate || inv.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}</td>
                                            <td className="py-0.5 text-slate-500 truncate">{inv.soNumber || '-'}</td>
                                            <td className="py-0.5 text-slate-700 font-medium truncate">{inv.invoiceNumber}</td>
                                            <td className="py-0.5 text-slate-500 truncate">{(inv as any).bookingNumber || inv.transportRef || '-'}</td>
                                            <td className="py-0.5 text-slate-500 truncate">{((inv.billToName || inv.soldTo || '').split(' ')[0])}</td>
                                            <td className="py-0.5 text-slate-600 text-right">{Number(inv.netWeight || inv.totalQuantity || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} / {(Number(inv.netWeight || inv.totalQuantity || 0) * 0.453592).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                                            <td className="py-0.5 text-emerald-600 font-medium text-right">${Number(inv.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                            <td className="py-0.5 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    <button
                                                        onClick={() => handleEditInvoice(inv)}
                                                        title="Edit Invoice"
                                                        className="p-1 rounded hover:bg-emerald-100 text-emerald-600 transition-colors"
                                                    >
                                                        <Edit3 size={14} />
                                                    </button>
                                                    <button
                                                        onClick={async (e) => {
                                                            e.stopPropagation();
                                                            console.log('[DeleteInvoice] Called for invoice:', inv.invoiceNumber, 'id:', inv.id);
                                                            if (window.confirm(`Delete invoice ${inv.invoiceNumber || inv.id}?`)) {
                                                                try {
                                                                    const result = await onDeleteInvoice(inv.id);
                                                                    console.log('[DeleteInvoice] Result:', result);
                                                                    if (onRefreshData) await onRefreshData();
                                                                } catch (err: any) {
                                                                    console.error('[DeleteInvoice] Error:', err);
                                                                    alert(`Failed to delete invoice: ${err.message}`);
                                                                }
                                                            }
                                                        }}
                                                        title="Delete Invoice"
                                                        className="p-1 rounded hover:bg-red-100 text-red-500 transition-colors"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            </td>
                                            <td className="py-0.5">
                                                <div className="flex items-center justify-center gap-1">
                                                    {/* Documents - View/Download Invoice, PL, SLI */}
                                                    <button
                                                        onClick={() => openDocumentsModal(inv)}
                                                        title="View/Download Documents"
                                                        className="p-1 rounded hover:bg-indigo-100 text-emerald-500 transition-colors"
                                                    >
                                                        <FileText size={14} />
                                                    </button>
                                                    {/* Email Documents */}
                                                    <button
                                                        onClick={() => handlePrepareEmailDraft(inv)}
                                                        disabled={sendingEmail}
                                                        title="Email Documents (Invoice, PL, SLI, BL)"
                                                        className="p-1 rounded hover:bg-blue-100 text-blue-500 transition-colors disabled:opacity-50"
                                                    >
                                                        {sendingEmail ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ));
                                })()}
                                {invoices.length === 0 && (
                                    <tr><td colSpan={9} className="text-center py-2 text-slate-400">No saved invoices</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {
                processingError && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-center gap-3 mt-6">
                        <AlertCircle size={20} />
                        <span>{processingError}</span>
                    </div>
                )
            }
        </div >
    );


    // ========================================================================
    // STEP 2: EDIT PL (Full Implementation)
    // ========================================================================
    const renderEditPLStep = () => (
        <div className="space-y-6">
            <div className="text-center mb-6">
                <h3 className="text-xl font-bold text-slate-800">Edit Packing List</h3>
                <p className="text-slate-500 text-sm mt-1">Verify and edit the packing list details</p>
                {statusMessage && (
                    <p className="text-sm text-indigo-600 mt-2 animate-pulse">{statusMessage}</p>
                )}
            </div>

            {/* PL Header */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">PL Number</label>
                        <input
                            type="text"
                            value={plNumber}
                            onChange={(e) => setPlNumber(e.target.value)}
                            placeholder="PL-000000"
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">SO Number</label>
                        <select
                            value={soNumber}
                            onChange={(e) => setSoNumber(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">-- Select Sales Order --</option>
                            {salesOrders.filter(so => so.status !== 'FULFILLED').map(so => (
                                <option key={so.id} value={so.orderNumber}>
                                    {so.orderNumber} - {so.customerName}
                                </option>
                            ))}
                            {soNumber && !salesOrders.find(so => so.orderNumber === soNumber) && (
                                <option value={soNumber}>{soNumber} (custom)</option>
                            )}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Booking #</label>
                        {isAddingNewBooking ? (
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={bookingNumber}
                                    onChange={(e) => setBookingNumber(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            if (bookingNumber.trim()) {
                                                saveNewBooking(bookingNumber);
                                                setIsAddingNewBooking(false);
                                            }
                                        }
                                    }}
                                    placeholder="Enter booking number"
                                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                                    autoFocus
                                />
                                <button
                                    onClick={() => {
                                        if (bookingNumber.trim()) {
                                            saveNewBooking(bookingNumber);
                                            setIsAddingNewBooking(false);
                                        }
                                    }}
                                    className="px-3 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 text-sm font-medium"
                                    title="Confirm booking number"
                                >
                                    ✓
                                </button>
                                <button
                                    onClick={() => {
                                        setBookingNumber('');
                                        setIsAddingNewBooking(false);
                                    }}
                                    className="px-3 py-2 text-slate-500 hover:text-slate-700 text-sm"
                                >
                                    ✕
                                </button>
                            </div>
                        ) : (
                            <div className="flex gap-2">
                                <select
                                    value={bookingNumber}
                                    onChange={(e) => {
                                        if (e.target.value === '__ADD_NEW__') {
                                            setBookingNumber('');
                                            setIsAddingNewBooking(true);
                                        } else {
                                            setBookingNumber(e.target.value);
                                            // Auto-populate POD and POA from selected booking
                                            const selectedBooking = allBookings.find((b: any) => b.bookingNumber === e.target.value);
                                            if (selectedBooking && selectedBooking.pod) {
                                                setPod(selectedBooking.pod);
                                            }
                                            if (selectedBooking && selectedBooking.pol) {
                                                setPoa(selectedBooking.pol);
                                            }
                                        }
                                    }}
                                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                                >
                                    <option value="">-- Select Booking --</option>
                                    {allBookings.filter((b: any) => b.status !== 'SHIPPED').map((b: any) => (
                                        <option key={b.id} value={b.bookingNumber}>{b.bookingNumber}</option>
                                    ))}
                                    {bookingNumber && !allBookings.filter((b: any) => b.status !== 'SHIPPED').find((b: any) => b.bookingNumber === bookingNumber) && (
                                        <option value={bookingNumber}>{bookingNumber} (custom)</option>
                                    )}
                                    <option value="__ADD_NEW__">+ ADD NEW</option>
                                </select>
                            </div>
                        )}
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Date</label>
                        <input
                            type="date"
                            value={plDate}
                            onChange={(e) => setPlDate(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Shipper</label>
                        <select
                            value={shipper}
                            onChange={(e) => setShipper(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">-- Select Shipper --</option>
                            {availableCompanies.map(c => (
                                <option key={c.id} value={c.name}>{c.name}</option>
                            ))}
                            {shipper && !availableCompanies.find(c => c.name === shipper) && (
                                <option value={shipper}>{shipper} (custom)</option>
                            )}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Supplier</label>
                        <select
                            value={supplier}
                            onChange={(e) => setSupplier(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">-- Select Supplier --</option>
                            {suppliers.map((s: any) => (
                                <option key={s.id} value={s.name}>{s.name}</option>
                            ))}
                            {supplier && !suppliers.find((s: any) => s.name === supplier) && (
                                <option value={supplier}>{supplier} (custom)</option>
                            )}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Consignee</label>
                        <select
                            value={consignee}
                            onChange={(e) => setConsignee(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">-- Select Consignee --</option>
                            {customers.map(c => (
                                <option key={c.id} value={c.name}>{c.name}</option>
                            ))}
                            {consignee && !customers.find(c => c.name === consignee) && (
                                <option value={consignee}>{consignee} (custom)</option>
                            )}
                        </select>
                    </div>
                </div>
            </div>

            {/* Line Items Table */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="p-4 border-b border-slate-200 flex justify-between items-center">
                    <h4 className="font-bold text-slate-700">Line Items ({plItems.length})</h4>
                    <button
                        onClick={handleAddItem}
                        className="text-sm text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
                    >
                        <Plus size={16} /> Add Item
                    </button>
                </div>
                <div className="overflow-x-auto">
                    {plItems.length > 0 ? (
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50">
                                <tr className="border-b border-slate-200">
                                    <th className="text-left p-3 font-bold text-slate-600">Description PL</th>
                                    <th className="text-left p-3 font-bold text-slate-600">Description (System)</th>
                                    <th className="text-left p-3 font-bold text-slate-600">Container</th>
                                    <th className="text-left p-3 font-bold text-slate-600">Seal</th>
                                    <th className="text-right p-3 font-bold text-slate-600">Gross LBS</th>
                                    <th className="text-right p-3 font-bold text-slate-600">Gross KG</th>
                                    <th className="text-right p-3 font-bold text-slate-600">Net LBS</th>
                                    <th className="text-right p-3 font-bold text-slate-600">Net KG</th>
                                    <th className="text-right p-3 font-bold text-slate-600">Volumes</th>
                                    <th className="text-center p-3 font-bold text-slate-600 w-10"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {plItems.map(item => (
                                    <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50">
                                        <td className="p-2">
                                            <input
                                                type="text"
                                                value={item.description || ''}
                                                onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                                                className="w-full px-2 py-1 border border-slate-200 rounded text-sm"
                                                placeholder="PL Description"
                                            />
                                        </td>
                                        <td className="p-2">
                                            <select
                                                value={item.productId || ''}
                                                onChange={(e) => {
                                                    const selectedProductId = e.target.value;
                                                    const prod = products.find(p => p.id === selectedProductId);
                                                    // Batch all updates into single setState to prevent race conditions
                                                    setPlItems(prev => prev.map(i => {
                                                        if (i.id === item.id) {
                                                            return {
                                                                ...i,
                                                                productId: selectedProductId,
                                                                productDescription: prod ? (prod.grade ? `${prod.name} (${prod.grade})` : prod.name) : i.productDescription,
                                                                hsCode: prod?.hsCode || i.hsCode || ''
                                                            };
                                                        }
                                                        return i;
                                                    }));
                                                }}
                                                className="w-full px-2 py-1 border border-indigo-200 rounded text-sm focus:ring-1 focus:ring-indigo-400 bg-indigo-50"
                                            >
                                                <option value="">{item.productDescription || 'Select System Description'}</option>
                                                {[...products].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(p => (
                                                    <option key={p.id} value={p.id}>
                                                        {p.grade ? `${p.name} (${p.grade})` : p.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </td>
                                        <td className="p-2">
                                            <input
                                                type="text"
                                                value={item.containerNo}
                                                onChange={(e) => updateItem(item.id, 'containerNo', e.target.value)}
                                                className="w-full px-2 py-1 border border-slate-200 rounded text-sm font-mono"
                                                placeholder="XXXX0000000"
                                            />
                                        </td>
                                        <td className="p-2">
                                            <input
                                                type="text"
                                                value={item.sealNo}
                                                onChange={(e) => updateItem(item.id, 'sealNo', e.target.value)}
                                                className="w-full px-2 py-1 border border-slate-200 rounded text-sm"
                                            />
                                        </td>
                                        <td className="p-2">
                                            <input
                                                type="number"
                                                step="any"
                                                value={item.grossLbs || ''}
                                                onChange={(e) => updateItem(item.id, 'grossLbs', e.target.value === '' ? 0 : Number(e.target.value))}
                                                className="w-24 px-2 py-1 border border-slate-200 rounded text-sm text-right font-mono"
                                            />
                                        </td>
                                        <td className="p-2 text-right text-slate-500 font-mono text-sm">
                                            {(item.grossKg || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </td>
                                        <td className="p-2">
                                            <input
                                                type="number"
                                                step="any"
                                                value={item.netLbs || ''}
                                                onChange={(e) => updateItem(item.id, 'netLbs', e.target.value === '' ? 0 : Number(e.target.value))}
                                                className="w-24 px-2 py-1 border border-slate-200 rounded text-sm text-right font-mono"
                                            />
                                        </td>
                                        <td className="p-2 text-right text-slate-500 font-mono text-sm">
                                            {(item.netKg || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </td>
                                        <td className="p-2">
                                            <input
                                                type="number"
                                                value={item.volumes || ''}
                                                onChange={(e) => updateItem(item.id, 'volumes', parseInt(e.target.value) || 0)}
                                                className="w-20 px-2 py-1 border border-slate-200 rounded text-sm text-right font-mono"
                                            />
                                        </td>
                                        <td className="p-2 text-center">
                                            <button
                                                onClick={() => handleDeleteItem(item.id)}
                                                className="text-red-500 hover:text-red-700 p-1"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="bg-slate-100 font-bold">
                                <tr>
                                    <td className="p-3" colSpan={4}>TOTALS</td>
                                    <td className="p-3 text-right font-mono">{totals.grossLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                                    <td className="p-3 text-right font-mono text-slate-500">{totals.grossKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td className="p-3 text-right font-mono">{totals.netLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                                    <td className="p-3 text-right font-mono text-slate-500">{totals.netKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td className="p-3 text-right font-mono">{totals.volumes.toLocaleString()}</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    ) : (
                        <div className="p-8 text-center text-slate-400">
                            <Package size={40} className="mx-auto mb-2 opacity-50" />
                            <p>No items added yet</p>
                            <button onClick={handleAddItem} className="mt-2 text-indigo-600 hover:text-indigo-700 text-sm font-medium">
                                + Add your first item
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Container Summary */}
            {
                containerSummary.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                        <h4 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                            <Ship size={18} className="text-slate-500" />
                            Container Summary ({containerSummary.length})
                        </h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {containerSummary.map((c, idx) => (
                                <div key={idx} className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                                    <p className="font-mono font-bold text-slate-800 truncate">{c.containerNo}</p>
                                    <p className="text-xs text-slate-500">Seal: {c.sealNo || 'N/A'}</p>
                                    <p className="text-xs text-slate-600 mt-1">
                                        Net: {c.netLbs.toLocaleString()} lbs | Vol: {c.volumes}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                )
            }

            {/* Navigation & Save */}
            <div className="flex justify-between items-center pt-4">
                <button
                    onClick={() => setCurrentStep('UPLOAD')}
                    className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:text-slate-800 transition-colors"
                >
                    <ArrowLeft size={16} /> Back
                </button>
                <div className="flex items-center gap-3">
                    <button
                        onClick={exportContainerPDF}
                        disabled={plItems.length === 0}
                        title="Download Resume per Container"
                        className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Download size={16} className="text-emerald-600" /> Containers
                    </button>
                    <button
                        onClick={exportProductPDF}
                        disabled={plItems.length === 0}
                        title="Download Resume per Product"
                        className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Download size={16} className="text-blue-600" /> Products
                    </button>
                    <button
                        onClick={saveToDatabase}
                        disabled={isSaving || plItems.length === 0}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        {isSaving ? 'Saving...' : 'Save PL'}
                    </button>
                    <button
                        onClick={() => setCurrentStep('CREATE_INVOICE')}
                        disabled={!canProceedToStep3()}
                        className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Create Invoice <ArrowRight size={16} />
                    </button>
                </div>
            </div>
        </div >
    );


    // ========================================================================
    // STEP 3: CREATE INVOICE (Full Implementation)
    // ========================================================================
    const renderCreateInvoiceStep = () => (
        <div className="space-y-6">
            <div className="mb-6">
                <button
                    onClick={() => setCurrentStep('UPLOAD')}
                    className="flex items-center gap-2 text-sm text-slate-500 hover:text-indigo-600 transition-colors mb-4"
                >
                    <ArrowLeft size={16} />
                    <span>Back to PL-Invoice Engine</span>
                </button>
                <div className="text-center">
                    <h3 className="text-xl font-bold text-slate-800">Create Invoice</h3>
                    <p className="text-slate-500 text-sm mt-1">Generate invoice from packing list</p>
                    {statusMessage && (
                        <p className="text-sm text-indigo-600 mt-2 animate-pulse">{statusMessage}</p>
                    )}
                </div>
            </div>

            {/* Auto-populate from PL */}
            {plItems.length > 0 && invoiceItems.length === 0 && (
                <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-4 flex items-center justify-between">
                    <div>
                        <p className="font-bold text-indigo-800">Packing List Ready</p>
                        <p className="text-sm text-indigo-600">{plItems.length} items from PL #{plNumber}</p>
                    </div>
                    <button
                        onClick={populateFromPL}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2"
                    >
                        <RefreshCw size={16} /> Populate Invoice from PL
                    </button>
                </div>
            )}

            {/* PL Reference Information */}
            {(plNumber || soNumber || bookingNumber) && (
                <div className="bg-gradient-to-r from-slate-50 to-indigo-50 border border-slate-200 rounded-xl p-4 shadow-sm mb-4">
                    <div className="flex items-center gap-2 mb-3">
                        <FileText size={16} className="text-indigo-600" />
                        <span className="text-sm font-bold text-indigo-800 uppercase">PL Reference Information</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                        {plNumber && (
                            <div className="bg-white rounded-lg px-3 py-2 border border-slate-100">
                                <span className="block text-xs text-slate-500 uppercase font-medium">PL #</span>
                                <span className="text-sm font-semibold text-slate-800">{plNumber}</span>
                            </div>
                        )}
                        {soNumber && (
                            <div className="bg-white rounded-lg px-3 py-2 border border-slate-100">
                                <span className="block text-xs text-slate-500 uppercase font-medium">SO #</span>
                                <span className="text-sm font-semibold text-slate-800">{soNumber}</span>
                            </div>
                        )}
                        {bookingNumber && (
                            <div className="bg-white rounded-lg px-3 py-2 border border-slate-100">
                                <span className="block text-xs text-slate-500 uppercase font-medium">Booking #</span>
                                <span className="text-sm font-semibold text-slate-800">{bookingNumber}</span>
                            </div>
                        )}
                        {shipper && (
                            <div className="bg-white rounded-lg px-3 py-2 border border-slate-100">
                                <span className="block text-xs text-slate-500 uppercase font-medium">Buyer</span>
                                <span className="text-sm font-semibold text-slate-800">{(shipper || '').split(' ')[0]}</span>
                            </div>
                        )}
                        {supplier && (
                            <div className="bg-white rounded-lg px-3 py-2 border border-slate-100">
                                <span className="block text-xs text-slate-500 uppercase font-medium">Supplier</span>
                                <span className="text-sm font-semibold text-slate-800">{(supplier || '').split(' ')[0]}</span>
                            </div>
                        )}
                        {consignee && (
                            <div className="bg-white rounded-lg px-3 py-2 border border-slate-100">
                                <span className="block text-xs text-slate-500 uppercase font-medium">Consignee</span>
                                <span className="text-sm font-semibold text-slate-800">{(consignee || '').split(' ')[0]}</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Invoice Header */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Invoice #</label>
                        <input
                            type="text"
                            value={invoiceNumber}
                            onChange={(e) => setInvoiceNumber(e.target.value)}
                            placeholder="INV-000000"
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 font-mono font-bold text-slate-700"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Date</label>
                        <input
                            type="date"
                            value={invoiceDate}
                            onChange={(e) => setInvoiceDate(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Purchase Order #</label>
                        <input
                            type="text"
                            value={customerPo}
                            onChange={(e) => setCustomerPo(e.target.value)}
                            placeholder="Customer PO"
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">POA (Port)</label>
                        <select
                            value={poa}
                            onChange={(e) => setPoa(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">Select Port of Loading</option>
                            {poa && !ports.some(p => p.code === poa || p.name === poa || `${p.name} (${p.code})` === poa) && (
                                <option value={poa}>{poa} (from Booking)</option>
                            )}
                            {[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                                <option key={p.id} value={p.code}>{p.name} ({p.code})</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">POD (Port)</label>
                        <select
                            value={pod}
                            onChange={(e) => setPod(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">Select Port of Discharge</option>
                            {/* Show custom value from booking if it doesn't match any port */}
                            {pod && !ports.some(p => p.code === pod || p.name === pod || `${p.name} (${p.code})` === pod) && (
                                <option value={pod}>{pod} (from Booking)</option>
                            )}
                            {[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                                <option key={p.id} value={p.code}>{p.name} ({p.code})</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-4 border-t border-slate-100">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Shipper</label>
                        <select
                            value={shipper}
                            onChange={(e) => setShipper(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">{shipper || '-- Select Shipper --'}</option>
                            {shipper && !availableCompanies.find(c => c.name === shipper) && (
                                <option value={shipper}>{shipper} (custom)</option>
                            )}
                            {availableCompanies.map(c => (
                                <option key={c.id} value={c.name}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Customer / Sold To</label>
                        <select
                            value={selectedCustomerId}
                            onChange={(e) => {
                                setSelectedCustomerId(e.target.value);
                                const cust = customers.find(c => c.id === e.target.value);
                                if (cust) {
                                    setBillToName(cust.name);
                                    setBillToAddress(cust.address || ''); // Also auto-fill address if available
                                    // Also set consignee if empty
                                    if (!consignee) setConsignee(cust.name);
                                    if (cust.paymentTerms) setPaymentTerms(cust.paymentTerms);
                                }
                            }}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">{billToName || '-- Select Customer --'}</option>
                            {customers.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Bill To</label>
                        <select
                            value={billToName}
                            onChange={(e) => setBillToName(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">{billToName || '-- Select Bill To --'}</option>
                            {/* Option to keep current value if not in list */}
                            {billToName && !customers.find(c => c.name === billToName) && (
                                <option value={billToName}>{billToName} (Custom)</option>
                            )}
                            {customers.map(c => (
                                <option key={c.id} value={c.name}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Booking #</label>
                        <select
                            value={transportRef || bookingNumber}
                            onChange={(e) => { setTransportRef(e.target.value); setBookingNumber(e.target.value); }}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">-- Select Booking --</option>
                            {bookingNumber && (!bookings || !bookings.find(b => b.bookingNumber === bookingNumber)) && (
                                <option value={bookingNumber}>{bookingNumber} (PL Reference)</option>
                            )}
                            {bookings && bookings.map((b: any) => (
                                <option key={b.id} value={b.bookingNumber}>{b.bookingNumber}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-4 border-t border-slate-100 mt-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Payment Terms</label>
                        <div className="relative">
                            <select
                                value={paymentTerms}
                                onChange={(e) => setPaymentTerms(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 appearance-none"
                            >
                                <option value="">-- Select Terms --</option>
                                <option value="ADV - 100% ADVANCED">ADV - 100% ADVANCED</option>
                                <option value="CAD - 100% CASH AGAINST DOCUMENTS">CAD - 100% CASH AGAINST DOCUMENTS</option>
                                <option value="20% ADV / 80% CAD">20% ADV / 80% CAD</option>
                                <option value="30% ADV / 70% CAD">30% ADV / 70% CAD</option>
                                <option value="ADV/CAD - ADVANCED + CASH AGAINST DOCUMENTS">ADV/CAD - ADVANCED + CASH AGAINST DOCUMENTS</option>
                                <option value="LC - LETTER OF CREDIT">LC - LETTER OF CREDIT</option>
                                <option value="Net 30">Net 30</option>
                                <option value="Net 60">Net 60</option>
                                <option value="Net 90">Net 90</option>
                                {paymentTerms && !['ADV - 100% ADVANCED', 'CAD - 100% CASH AGAINST DOCUMENTS', '20% ADV / 80% CAD', '30% ADV / 70% CAD', 'ADV/CAD - ADVANCED + CASH AGAINST DOCUMENTS', 'LC - LETTER OF CREDIT', 'Net 30', 'Net 60', 'Net 90'].includes(paymentTerms) && (
                                    <option value={paymentTerms}>{paymentTerms} (Custom)</option>
                                )}
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-700">
                                <span className="text-xs">▼</span>
                            </div>
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Incoterms</label>
                        <div className="relative">
                            <select
                                value={incoterm}
                                onChange={(e) => setIncoterm(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 appearance-none"
                            >
                                <option value="">-- Select Incoterm --</option>
                                {incotermsOptions.map(term => (
                                    <option key={term} value={term}>{term}</option>
                                ))}
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-700">
                                <span className="text-xs">▼</span>
                            </div>
                        </div>
                    </div>
                    <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                            Bank Details {banks.length === 0 && <span className="text-red-500 font-normal lowercase italic text-[10px] ml-2">(no banks found - please configure banks in settings)</span>}
                        </label>
                        <select
                            value={selectedBankId}
                            onChange={(e) => {
                                const bId = e.target.value;
                                setSelectedBankId(bId);
                                const bank = banks.find(b => b.id === bId);
                                if (bank) {
                                    setBankName(bank.bankName);
                                    setBankAddress(bank.bankAddress);
                                    setAccountNumber(bank.accountNumber);
                                    setSwiftCode(bank.swiftCode);
                                    setRoutingNumber(bank.routingNumber);
                                }
                            }}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">{bankName ? `${bankName} (Current)` : '-- Select Bank Profile --'}</option>
                            {banks.map(b => (
                                <option key={b.id} value={b.id}>{b.bankName} - {b.accountNumber} ({b.swiftCode})</option>
                            ))}
                        </select>
                    </div>
                    <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                            Memo / Additional Notes
                        </label>
                        <textarea
                            value={memo}
                            onChange={(e) => setMemo(e.target.value)}
                            placeholder="Enter any additional notes or special instructions for this invoice..."
                            rows={3}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 resize-none"
                        />
                    </div>
                </div>
            </div>

            {/* Invoice Items Table */}
            < div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm" >
                <div className="p-4 border-b border-slate-200 flex justify-between items-center">
                    <h4 className="font-bold text-slate-700">Invoice Items ({invoiceItems.length})</h4>
                    <button
                        onClick={addInvoiceItem}
                        className="text-sm text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
                    >
                        <Plus size={16} /> Add Item
                    </button>
                </div>
                <div className="overflow-x-auto">
                    {invoiceItems.length > 0 ? (
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50">
                                <tr className="border-b border-slate-200">
                                    <th className="text-left p-2 font-bold text-slate-600 text-xs">Description (PL)</th>
                                    <th className="text-left p-2 font-bold text-slate-600 text-xs">Description (System)</th>
                                    <th className="text-left p-2 font-bold text-slate-600 text-xs">Customer Description</th>
                                    <th className="text-left p-2 font-bold text-slate-600 text-xs">HS Code</th>
                                    <th className="text-right p-2 font-bold text-slate-600 text-xs">Qty (LBS)</th>
                                    <th className="text-right p-2 font-bold text-slate-600 text-xs">Qty (KG)</th>
                                    <th className="text-right p-2 font-bold text-slate-600 text-xs">Price/LB</th>
                                    <th className="text-right p-2 font-bold text-slate-600 text-xs">Price/KG</th>
                                    <th className="text-right p-2 font-bold text-slate-600 text-xs">Amount</th>
                                    <th className="text-center p-2 font-bold text-slate-600 w-10"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {invoiceItems.map(item => (
                                    <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50">
                                        <td className="p-1">
                                            <input
                                                type="text"
                                                value={item.description}
                                                onChange={(e) => updateInvoiceItem(item.id, 'description', e.target.value)}
                                                placeholder="PL Description"
                                                className="w-full px-2 py-1 border border-slate-200 rounded text-xs"
                                            />
                                        </td>
                                        <td className="p-1">
                                            <select
                                                value={item.productId || ''}
                                                onChange={(e) => {
                                                    const selectedProductId = e.target.value;
                                                    const prod = products.find(p => p.id === selectedProductId);
                                                    // Batch all updates into single setState to prevent race conditions
                                                    setInvoiceItems(prev => prev.map(i => {
                                                        if (i.id === item.id) {
                                                            return {
                                                                ...i,
                                                                productId: selectedProductId,
                                                                productDescription: prod ? (prod.grade ? `${prod.name} (${prod.grade})` : prod.name) : i.productDescription,
                                                                hsCode: prod?.hsCode || i.hsCode || ''
                                                            };
                                                        }
                                                        return i;
                                                    }));
                                                }}
                                                className="w-full px-2 py-1 border border-indigo-200 rounded text-xs focus:ring-1 focus:ring-indigo-400 bg-indigo-50"
                                            >
                                                <option value="">{item.productDescription || 'Select System Description'}</option>
                                                {[...products].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(p => (
                                                    <option key={p.id} value={p.id}>
                                                        {p.grade ? `${p.name} (${p.grade})` : p.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </td>
                                        <td className="p-1">
                                            <input
                                                type="text"
                                                value={item.customerDescription || ''}
                                                onChange={(e) => updateInvoiceItem(item.id, 'customerDescription', e.target.value)}
                                                placeholder="Customer Description"
                                                className="w-full px-2 py-1 border border-slate-200 rounded text-xs bg-amber-50"
                                            />
                                        </td>
                                        <td className="p-1">
                                            <input
                                                type="text"
                                                value={item.hsCode || (() => {
                                                    // Auto-populate from product if item doesn't have hsCode yet
                                                    if (item.productId && products.length > 0) {
                                                        const prod = products.find((p: any) => p.id === item.productId);
                                                        if (prod?.hsCode) return prod.hsCode;
                                                    }
                                                    // Fall back to matching by product description
                                                    if ((item.productDescription || item.description) && products.length > 0) {
                                                        const searchName = item.productDescription || item.description;
                                                        const prod = products.find((p: any) => {
                                                            const fullName = p.grade ? `${p.name} (${p.grade})` : p.name;
                                                            return fullName === searchName || p.name === searchName;
                                                        });
                                                        if (prod?.hsCode) return prod.hsCode;
                                                    }
                                                    return '';
                                                })()}
                                                onChange={(e) => updateInvoiceItem(item.id, 'hsCode', e.target.value)}
                                                placeholder="HS Code"
                                                className="w-24 px-2 py-1 border border-slate-200 rounded text-xs font-mono text-center focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                            />
                                        </td>
                                        <td className="p-1">
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                key={`netLbs-${item.id}-${item.netLbs}`}
                                                defaultValue={item.netLbs || item.quantity || 0}
                                                onBlur={(e) => {
                                                    const num = parseFloat(e.target.value);
                                                    updateInvoiceItem(item.id, 'netLbs', isNaN(num) ? 0 : num);
                                                }}
                                                className="w-24 px-2 py-1 border border-slate-200 rounded text-xs text-right font-mono"
                                            />
                                        </td>
                                        <td className="p-1">
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                key={`netKg-${item.id}-${item.netKg}`}
                                                defaultValue={item.netKg || 0}
                                                onBlur={(e) => {
                                                    const num = parseFloat(e.target.value);
                                                    updateInvoiceItem(item.id, 'netKg', isNaN(num) ? 0 : num);
                                                }}
                                                className="w-24 px-2 py-1 border border-slate-200 rounded text-xs text-right font-mono bg-slate-50"
                                            />
                                        </td>
                                        <td className="p-1">
                                            <div className="flex items-center gap-1">
                                                <span className="text-slate-400 text-xs">$</span>
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    key={`priceLbs-${item.id}-${item.unitPriceLbs}`}
                                                    defaultValue={item.unitPriceLbs ?? item.unitPrice ?? 0}
                                                    onBlur={(e) => {
                                                        const num = parseFloat(e.target.value);
                                                        updateInvoiceItem(item.id, 'unitPriceLbs', isNaN(num) ? 0 : num);
                                                    }}
                                                    className="w-24 px-2 py-1 border border-slate-200 rounded text-xs text-right font-mono"
                                                    placeholder="0.00"
                                                />
                                            </div>
                                        </td>
                                        <td className="p-1">
                                            <div className="flex items-center gap-1">
                                                <span className="text-slate-400 text-xs">$</span>
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    key={`priceKg-${item.id}-${item.unitPriceKg}`}
                                                    defaultValue={item.unitPriceKg ?? 0}
                                                    onBlur={(e) => {
                                                        const num = parseFloat(e.target.value);
                                                        updateInvoiceItem(item.id, 'unitPriceKg', isNaN(num) ? 0 : num);
                                                    }}
                                                    className="w-24 px-2 py-1 border border-slate-200 rounded text-xs text-right font-mono bg-slate-50"
                                                    placeholder="0.00"
                                                />
                                            </div>
                                        </td>
                                        <td className="p-1 text-right font-mono font-bold text-emerald-700 text-xs">
                                            ${item.amount?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </td>
                                        <td className="p-1 text-center">
                                            <button
                                                onClick={() => removeInvoiceItem(item.id)}
                                                className="text-red-500 hover:text-red-700 p-1"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="bg-slate-100">
                                <tr className="font-bold">
                                    <td className="p-2 text-xs" colSpan={2}>TOTALS</td>
                                    <td className="p-2 text-right font-mono text-xs">{invoiceTotals.quantity.toLocaleString(undefined, { maximumFractionDigits: 1 })} LBS</td>
                                    <td className="p-2 text-right font-mono text-xs">{(invoiceTotals.quantity * 0.453592).toLocaleString(undefined, { maximumFractionDigits: 1 })} KG</td>
                                    <td className="p-2"></td>
                                    <td className="p-2"></td>
                                    <td className="p-2 text-right font-mono text-sm text-emerald-700">
                                        ${invoiceTotals.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    ) : (
                        <div className="p-8 text-center text-slate-400">
                            <DollarSign size={40} className="mx-auto mb-2 opacity-50" />
                            <p>No invoice items yet</p>
                            {plItems.length > 0 ? (
                                <button onClick={populateFromPL} className="mt-2 text-indigo-600 hover:text-indigo-700 text-sm font-medium">
                                    Populate from Packing List
                                </button>
                            ) : (
                                <button onClick={addInvoiceItem} className="mt-2 text-indigo-600 hover:text-indigo-700 text-sm font-medium">
                                    + Add your first item
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div >

            {/* Containers Summary - Editable */}
            {
                containers.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                        <h4 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                            <Ship size={18} className="text-slate-500" />
                            Containers ({containers.length})
                            <button
                                onClick={() => setContainers(prev => [...prev, { id: `cont_${Date.now()}`, container: '', seal: '' }])}
                                className="ml-auto text-xs px-2 py-1 bg-indigo-50 text-indigo-600 rounded hover:bg-indigo-100 font-medium"
                            >
                                + Add Container
                            </button>
                        </h4>
                        <div className="space-y-2">
                            {containers.map((c, idx) => (
                                <div key={c.id || idx} className="flex items-center gap-2">
                                    <div className="flex-1 flex gap-2">
                                        <div className="flex-1">
                                            <label className="block text-[10px] text-slate-400 uppercase mb-0.5">Container</label>
                                            <input
                                                type="text"
                                                value={c.container}
                                                onChange={(e) => {
                                                    const val = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                                                    setContainers(prev => prev.map((cont, i) => i === idx ? { ...cont, container: val } : cont));
                                                }}
                                                className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                                placeholder="XXXX0000000"
                                            />
                                        </div>
                                        <div className="flex-1">
                                            <label className="block text-[10px] text-slate-400 uppercase mb-0.5">Seal</label>
                                            <input
                                                type="text"
                                                value={c.seal}
                                                onChange={(e) => {
                                                    setContainers(prev => prev.map((cont, i) => i === idx ? { ...cont, seal: e.target.value } : cont));
                                                }}
                                                className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                                placeholder="Seal #"
                                            />
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setContainers(prev => prev.filter((_, i) => i !== idx))}
                                        className="mt-4 p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                                        title="Remove container"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )
            }

            {/* Navigation & Actions */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 mt-4">
                <div className="flex justify-between items-center">
                    <div className="flex gap-4">
                        <button
                            onClick={() => setCurrentStep('EDIT_PL')}
                            className="flex items-center gap-2 px-5 py-2.5 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-all font-medium"
                        >
                            <ArrowLeft size={18} />
                            Back to PL
                        </button>
                        <button
                            onClick={() => setCurrentStep('UPLOAD')}
                            className="flex items-center gap-2 px-5 py-2.5 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-all font-medium"
                        >
                            <ArrowLeft size={18} />
                            PL-Invoice Engine
                        </button>
                    </div>
                    <button
                        onClick={saveInvoice}
                        disabled={isSaving || invoiceItems.length === 0}
                        className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-lg hover:from-emerald-700 hover:to-teal-700 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                    >
                        {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                        {isSaving ? 'Saving...' : 'Save Invoice'}
                    </button>
                </div>
            </div>
        </div >
    );

    // ========================================================================
    // MAIN RENDER
    // ========================================================================
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 p-6 flex flex-col overflow-y-auto">
            {/* Header */}
            <div className="mb-6 flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
                        <div className="p-2 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-xl text-white">
                            <FileText size={24} />
                        </div>
                        PL-Invoice Engine
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">Transform packing lists into invoices</p>
                </div>
                {currentStep === 'UPLOAD' && (
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setUploadModalOpen(true)}
                            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-all shadow-md font-medium"
                        >
                            <Upload size={18} />
                            Upload New PL
                        </button>
                        <button
                            onClick={handleCreateBlankPL}
                            className="flex items-center gap-2 px-5 py-2.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-all shadow-md font-medium"
                        >
                            <FileText size={18} />
                            New PL
                        </button>
                        <button
                            onClick={handleCreateBlankInvoice}
                            className="flex items-center gap-2 px-5 py-2.5 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-all shadow-md font-medium"
                        >
                            <FileText size={18} />
                            New Invoice
                        </button>
                    </div>
                )}
            </div>

            {/* Step Content */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-200 pt-1 px-1 pb-4 shadow-xl w-full flex-1 overflow-visible flex flex-col">
                {currentStep === 'UPLOAD' && renderUploadStep()}
                {currentStep === 'EDIT_PL' && renderEditPLStep()}
                {currentStep === 'CREATE_INVOICE' && renderCreateInvoiceStep()}
            </div>

            {/* Upload PL Modal */}
            {uploadModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 overflow-hidden">
                        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white p-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold flex items-center gap-2">
                                    <Upload size={20} />
                                    Upload Packing Lists
                                </h3>
                                <button onClick={() => { setUploadModalOpen(false); setPendingFiles([]); }} className="p-1 hover:bg-white/20 rounded">
                                    <X size={20} />
                                </button>
                            </div>
                            <p className="text-sm text-white/80 mt-1">Drop files or click to browse</p>
                        </div>
                        <div className="p-6">
                            {/* Drop Zone */}
                            <div
                                onClick={() => fileInputRef.current?.click()}
                                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setModalDragActive(true); }}
                                onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setModalDragActive(false); }}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setModalDragActive(false);
                                    const droppedFiles = e.dataTransfer.files;
                                    if (droppedFiles && droppedFiles.length > 0) {
                                        const input = fileInputRef.current;
                                        if (input) {
                                            const dt = new DataTransfer();
                                            for (let i = 0; i < droppedFiles.length; i++) {
                                                dt.items.add(droppedFiles[i]);
                                            }
                                            input.files = dt.files;
                                            handleFileSelect({ target: input } as any);
                                        }
                                    }
                                }}
                                className={`p-8 border-2 border-dashed rounded-xl text-center cursor-pointer transition-all mb-4 ${modalDragActive
                                    ? 'border-indigo-500 bg-indigo-50 scale-[1.02]'
                                    : 'border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/50'
                                    }`}
                            >
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".pdf,.png,.jpg,.jpeg"
                                    onChange={handleFileSelect}
                                    multiple
                                    className="hidden"
                                />
                                <div className="mx-auto w-fit p-4 bg-indigo-100 rounded-full mb-3">
                                    <Upload size={32} className="text-indigo-600" />
                                </div>
                                <p className="text-slate-700 font-bold">Drop PL files here</p>
                                <p className="text-xs text-slate-400 mt-1">PDF, PNG, JPG accepted</p>
                            </div>

                            {/* Pending Files List */}
                            {pendingFiles.length > 0 && (
                                <div className="bg-slate-50 rounded-xl p-4 mb-4">
                                    <p className="text-sm font-bold text-slate-700 mb-2">Files Ready ({pendingFiles.length})</p>
                                    <div className="space-y-2 max-h-40 overflow-y-auto">
                                        {pendingFiles.map(f => (
                                            <div key={f.id} className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg border transition-all ${f.status === 'completed' ? 'bg-emerald-50 border-emerald-200' : f.status === 'processing' ? 'bg-indigo-50 border-indigo-200' : f.status === 'error' ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
                                                {f.status === 'idle' && <FileText size={16} className="text-slate-400" />}
                                                {f.status === 'processing' && <Loader2 size={16} className="animate-spin text-indigo-500" />}
                                                {f.status === 'completed' && <CheckCircle2 size={16} className="text-emerald-500" />}
                                                {f.status === 'error' && <AlertCircle size={16} className="text-red-500" />}
                                                <span className={`truncate flex-1 ${f.status === 'completed' ? 'text-emerald-700' : f.status === 'processing' ? 'text-indigo-700' : f.status === 'error' ? 'text-red-700' : 'text-slate-700'}`}>{f.file.name}</span>
                                                {f.status === 'completed' && <span className="text-xs text-emerald-600 font-medium">Done</span>}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Processing Indicator */}
                            {isProcessing && (
                                <div className="flex items-center justify-center gap-3 p-4 bg-indigo-50 rounded-xl border border-indigo-200 mb-4">
                                    <Loader2 size={24} className="text-indigo-500 animate-spin" />
                                    <span className="text-indigo-700 font-medium">Processing files...</span>
                                </div>
                            )}

                            {/* Action Buttons */}
                            <div className="flex gap-3">
                                <button
                                    onClick={() => { setUploadModalOpen(false); setPendingFiles([]); }}
                                    className="flex-1 px-4 py-2.5 border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        processQueue();
                                        // Modal will close when processing is done
                                    }}
                                    disabled={pendingFiles.length === 0 || isProcessing}
                                    className={`flex-1 px-4 py-2.5 rounded-lg font-medium flex items-center justify-center gap-2 ${pendingFiles.length > 0 && !isProcessing
                                        ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                                        : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                        }`}
                                >
                                    <FileText size={18} />
                                    Process {pendingFiles.length > 0 ? `(${pendingFiles.length})` : ''}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Documents Modal */}
            {documentsModalOpen && selectedDocInvoice && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
                        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white p-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold">Delivery Documents</h3>
                                <button onClick={() => setDocumentsModalOpen(false)} className="p-1 hover:bg-white/20 rounded">
                                    <X size={20} />
                                </button>
                            </div>
                            <p className="text-sm text-white/80 mt-1">Invoice #{selectedDocInvoice.invoiceNumber}</p>
                        </div>
                        <div className="p-4 space-y-3">
                            {/* Invoice */}
                            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                                <div className="flex items-center gap-3">
                                    <FileText size={20} className="text-indigo-600" />
                                    <div>
                                        <p className="font-medium text-slate-700">Invoice</p>
                                        <p className="text-xs text-slate-500">#{selectedDocInvoice.invoiceNumber}</p>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => previewInvoicePDF(selectedDocInvoice)} className="p-1.5 hover:bg-indigo-100 rounded text-indigo-600" title="Preview Invoice">
                                        <Eye size={16} />
                                    </button>
                                    <button onClick={async () => {
                                        const doc = await generateInvoicePDF(selectedDocInvoice, false);
                                        const blob = doc.output('blob');
                                        const url = URL.createObjectURL(blob);
                                        const link = document.createElement('a');
                                        link.href = url;
                                        link.download = `Invoice_${selectedDocInvoice.invoiceNumber || 'unknown'}.pdf`;
                                        document.body.appendChild(link);
                                        link.click();
                                        document.body.removeChild(link);
                                        URL.revokeObjectURL(url);
                                    }} className="p-1.5 hover:bg-indigo-100 rounded text-indigo-600" title="Download Invoice PDF">
                                        <Download size={16} />
                                    </button>
                                </div>
                            </div>

                            {/* Packing List */}
                            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                                <div className="flex items-center gap-3">
                                    <Package size={20} className="text-indigo-600" />
                                    <div>
                                        <p className="font-medium text-slate-700">Packing List</p>
                                        <p className="text-xs text-slate-500">{selectedDocInvoice.plNumber || 'From invoice data'}</p>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => previewPackingListPDF(selectedDocInvoice)} className="p-1.5 hover:bg-indigo-100 rounded text-indigo-600" title="Preview Packing List">
                                        <Eye size={16} />
                                    </button>
                                    <button onClick={() => {
                                        const doc = generatePackingListPDF(selectedDocInvoice, false);
                                        const blob = doc.output('blob');
                                        const url = URL.createObjectURL(blob);
                                        const link = document.createElement('a');
                                        link.href = url;
                                        link.download = `PackingList_${selectedDocInvoice.plNumber || selectedDocInvoice.invoiceNumber || 'unknown'}.pdf`;
                                        document.body.appendChild(link);
                                        link.click();
                                        document.body.removeChild(link);
                                        URL.revokeObjectURL(url);
                                    }} className="p-1.5 hover:bg-indigo-100 rounded text-indigo-600" title="Download Packing List PDF">
                                        <Download size={16} />
                                    </button>
                                </div>
                            </div>

                            {/* SLI */}
                            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                                <div className="flex items-center gap-3">
                                    <ClipboardList size={20} className="text-indigo-600" />
                                    <div>
                                        <p className="font-medium text-slate-700">Shipper's Letter of Instruction</p>
                                        <p className="text-xs text-slate-500">Auto-generated from invoice</p>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => previewSLIPDF(selectedDocInvoice)} className="p-1.5 hover:bg-indigo-100 rounded text-indigo-600" title="Preview SLI">
                                        <Eye size={16} />
                                    </button>
                                    <button onClick={() => {
                                        const doc = generateSLIPreview(selectedDocInvoice);
                                        const blob = doc.output('blob');
                                        const url = URL.createObjectURL(blob);
                                        const link = document.createElement('a');
                                        link.href = url;
                                        link.download = `SLI_${selectedDocInvoice.invoiceNumber || 'unknown'}.pdf`;
                                        document.body.appendChild(link);
                                        link.click();
                                        document.body.removeChild(link);
                                        URL.revokeObjectURL(url);
                                    }} className="p-1.5 hover:bg-indigo-100 rounded text-indigo-600" title="Download SLI">
                                        <Download size={16} />
                                    </button>
                                </div>
                            </div>

                            {/* Bill of Lading */}
                            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                                <div className="flex items-center gap-3">
                                    <Ship size={20} className={((selectedDocInvoice as any).bolUrl || (selectedDocInvoice as any).bolurl) ? 'text-indigo-600' : 'text-amber-500'} />
                                    <div>
                                        <p className="font-medium text-slate-700">Bill of Lading</p>
                                        <p className="text-xs text-slate-500">{((selectedDocInvoice as any).bolUrl || (selectedDocInvoice as any).bolurl) ? 'Uploaded' : 'Upload required'}</p>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    {((selectedDocInvoice as any).bolUrl || (selectedDocInvoice as any).bolurl) ? (
                                        <>
                                            <button
                                                onClick={() => {
                                                    // Show BOL in in-app preview modal
                                                    const bolData = (selectedDocInvoice as any).bolUrl || (selectedDocInvoice as any).bolurl;
                                                    setPreviewUrl(bolData);
                                                    setPreviewTitle(`Bill of Lading - ${selectedDocInvoice.invoiceNumber}`);
                                                    setPreviewFileName(`BOL_${selectedDocInvoice.invoiceNumber || 'document'}.pdf`);
                                                    setPreviewDownloadFn(() => () => {
                                                        const link = document.createElement('a');
                                                        link.href = bolData;
                                                        link.download = `BOL_${selectedDocInvoice.invoiceNumber || 'document'}.pdf`;
                                                        link.click();
                                                    });
                                                }}
                                                className="p-1.5 hover:bg-indigo-100 rounded text-indigo-600"
                                                title="View BOL"
                                            >
                                                <Eye size={16} />
                                            </button>
                                            <button
                                                onClick={() => {
                                                    // Download the BOL using blob approach
                                                    const bolData = (selectedDocInvoice as any).bolUrl || (selectedDocInvoice as any).bolurl;
                                                    // Convert data URL to blob for safe download
                                                    const byteString = atob(bolData.split(',')[1]);
                                                    const mimeMatch = bolData.match(/data:([^;]+);/);
                                                    const mimeType = mimeMatch ? mimeMatch[1] : 'application/pdf';
                                                    const ab = new ArrayBuffer(byteString.length);
                                                    const ia = new Uint8Array(ab);
                                                    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
                                                    const blob = new Blob([ab], { type: mimeType });
                                                    const url = URL.createObjectURL(blob);
                                                    const link = document.createElement('a');
                                                    link.href = url;
                                                    link.download = `BOL_${selectedDocInvoice.invoiceNumber || 'document'}.pdf`;
                                                    document.body.appendChild(link);
                                                    link.click();
                                                    document.body.removeChild(link);
                                                    URL.revokeObjectURL(url);
                                                }}
                                                className="p-1.5 hover:bg-indigo-100 rounded text-indigo-600"
                                                title="Download BOL"
                                            >
                                                <Download size={16} />
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full">Upload</span>
                                            <input
                                                type="file"
                                                ref={bolInputRef}
                                                accept=".pdf"
                                                className="hidden"
                                                onChange={(e) => {
                                                    const file = e.target.files?.[0];
                                                    if (file) handleBOLUpload(file, selectedDocInvoice.id);
                                                }}
                                            />
                                            <button
                                                onClick={() => bolInputRef.current?.click()}
                                                disabled={uploadingBOL}
                                                className="p-1.5 hover:bg-amber-100 rounded text-amber-600 disabled:opacity-50"
                                                title="Upload BOL"
                                            >
                                                {uploadingBOL ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="border-t p-4 bg-slate-50 flex justify-between items-center">
                            <div className="flex items-center gap-3">
                                <label className="flex items-center gap-1.5 cursor-pointer select-none" title="Brazil Mode">
                                    <input
                                        type="checkbox"
                                        checked={brMode}
                                        onChange={(e) => setBrMode(e.target.checked)}
                                        className="w-4 h-4 rounded border-slate-300 text-green-600 focus:ring-green-500"
                                    />
                                    <span className="text-sm font-bold text-green-700">BR</span>
                                </label>
                                {/* Email Status */}
                                {emailStatus.show && (
                                    <div className={`flex items-center gap-2 text-sm ${emailStatus.success ? 'text-emerald-600' : 'text-red-600'}`}>
                                        {emailStatus.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                                        <span>{emailStatus.message}</span>
                                    </div>
                                )}
                            </div>
                            <div className="flex gap-2 items-center">
                                <button
                                    onClick={() => handlePrepareEmailDraft(selectedDocInvoice)}
                                    disabled={sendingEmail}
                                    className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                                >
                                    {sendingEmail ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
                                    Email All Documents
                                </button>
                                <button
                                    onClick={() => setDocumentsModalOpen(false)}
                                    className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Email Preview Modal */}
            {emailPreviewOpen && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
                        {/* Header */}
                        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <Mail className="text-white" size={24} />
                                <h3 className="text-xl font-bold text-white">Email Preview</h3>
                            </div>
                            <button
                                onClick={() => setEmailPreviewOpen(false)}
                                className="p-1.5 rounded-lg hover:bg-white/20 transition-colors text-white"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-6 space-y-4">
                            {/* To */}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">To</label>
                                <input
                                    type="email"
                                    value={emailDraft.to}
                                    onChange={(e) => setEmailDraft(prev => ({ ...prev, to: e.target.value }))}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="recipient@example.com"
                                />
                            </div>

                            {/* CC */}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">CC <span className="font-normal text-slate-400 normal-case">(comma-separated)</span></label>
                                <input
                                    type="text"
                                    value={emailDraft.cc}
                                    onChange={(e) => setEmailDraft(prev => ({ ...prev, cc: e.target.value }))}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="cc1@example.com, cc2@example.com"
                                />
                            </div>

                            {/* Subject */}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Subject</label>
                                <input
                                    type="text"
                                    value={emailDraft.subject}
                                    onChange={(e) => setEmailDraft(prev => ({ ...prev, subject: e.target.value }))}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>

                            {/* Body */}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Message</label>
                                <textarea
                                    value={emailDraft.htmlBody}
                                    onChange={(e) => setEmailDraft(prev => ({ ...prev, htmlBody: e.target.value }))}
                                    rows={10}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none font-mono"
                                />
                            </div>

                            {/* Attachments */}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                                    Attachments ({emailDraft.attachments.length})
                                </label>
                                <div className="bg-slate-50 rounded-lg border border-slate-200 divide-y divide-slate-100">
                                    {emailDraft.attachments.map((att, idx) => (
                                        <div key={idx} className="flex items-center gap-3 px-3 py-2">
                                            <FileText size={16} className="text-red-500" />
                                            <span className="text-sm text-slate-700">{att.name}</span>
                                            <span className="text-xs text-slate-400 ml-auto">
                                                {Math.round(att.contentBytes.length * 0.75 / 1024)} KB
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Status */}
                            {emailStatus.show && (
                                <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${emailStatus.success
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : 'bg-red-50 text-red-700 border border-red-200'
                                    }`}>
                                    {emailStatus.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                                    {emailStatus.message}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="border-t border-slate-200 px-6 py-4 flex items-center justify-end gap-3 bg-slate-50">
                            <button
                                onClick={() => setEmailPreviewOpen(false)}
                                className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg transition-colors font-medium"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={sendEmailFromPreview}
                                disabled={sendingEmail || !emailDraft.to}
                                className="px-6 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {sendingEmail ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" />
                                        Sending...
                                    </>
                                ) : (
                                    <>
                                        <Send size={16} />
                                        Send Email
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* PDF Preview Modal */}
            <PDFPreviewModal
                isOpen={!!previewUrl}
                onClose={handleClosePreview}
                pdfUrl={previewUrl}
                pdfBlob={previewBlob}
                title={previewTitle}
                fileName={previewFileName}
                onDownload={previewDownloadFn || undefined}
            />
        </div>
    );
};

export default PLInvoiceEngine;

