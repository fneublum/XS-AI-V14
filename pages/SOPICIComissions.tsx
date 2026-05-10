import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
    Upload, FileText, CheckCircle, Search, X, ChevronRight, File, Settings, Calendar, Calculator, Edit2, Zap, Brain, ArrowRight, Save, Loader2, ArrowLeft, Send, Trash2, Link as LinkIcon, RefreshCw, Eye, Edit3, MessageCircle, MessageSquare, Play, Pause, Square, ExternalLink, MapPin, Truck, Ship, Box, Layers, Building2, UserCircle, HandCoins, Building, Anchor, AlertCircle, TrendingUp, TrendingDown, Minus, Clock, ShieldCheck, Banknote, DollarSign, Activity, Wallet, Percent, Plus, Share2, CornerDownRight, Mail, MoveRight,
    FileCheck, Package, ClipboardList, CheckCircle2, Filter, Download, Edit, Sparkles, FileSpreadsheet
} from 'lucide-react';
import { PackingList, Invoice, Customer, Company, SalesOrder, Booking, BillOfLading, Port, Bank, CompanyImage } from '../types';
import { getSupabaseClient } from '../services/supabase';
import { useSupabase } from '../hooks/useSupabase';
import { analyzeDocument, getGeminiInsight, translateDescriptions, generateProposalLabels } from '../services/geminiService';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import QuickAddModal from '../components/QuickAddModal';
import { FormattedInput } from '../components/UnitInputs';
import PDFPreviewModal from '../components/PDFPreviewModal';
import { sendEmail } from '../services/emailService';
import { resolveRecipients, joinRecipients } from '../v2/services/recipients';
import { PAYMENT_TERM_OPTIONS } from '../constants';

// ============================================================================
// TYPES
// ============================================================================

type WizardStep = 'PROPOSAL' | 'UPLOAD_CONTRACT' | 'CREATE_PROFORMA' | 'UPLOAD_PL' | 'EDIT_PL' | 'CREATE_INVOICE';

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

interface SOPICIComissionsProps {
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
    onAddCommission?: (order: any) => void;
    availablePaymentTerms?: any[];
}

// ============================================================================
// COMPONENT
// ============================================================================

const SOPICIComissions: React.FC<SOPICIComissionsProps> = ({
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
    banks: banksProp = [],
    onAddCommission,
    availablePaymentTerms = []
}) => {
    // ========================================================================
    // WIZARD STATE
    // ========================================================================
    const [currentStep, setCurrentStep] = useState<WizardStep>('PROPOSAL');
    const [searchTerm, setSearchTerm] = useState('');
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

    // Commission Packing Lists State
    const [commissionPLs, setCommissionPLs] = useState<any[]>([]);
    const [commPLDragActive, setCommPLDragActive] = useState(false);
    const [commPLProcessing, setCommPLProcessing] = useState(false);
    const [commPLStatusMessage, setCommPLStatusMessage] = useState('');
    const commPLFileInputRef = useRef<HTMLInputElement>(null);

    // Commission Customer Invoices State
    const [commissionInvoices, setCommissionInvoices] = useState<any[]>([]);
    const [commInvDragActive, setCommInvDragActive] = useState(false);
    const [commInvProcessing, setCommInvProcessing] = useState(false);
    const [commInvStatusMessage, setCommInvStatusMessage] = useState('');
    const commInvFileInputRef = useRef<HTMLInputElement>(null);

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
    const DEFAULT_MEMO = 'NO WOOD PRESENT ON THE CARGO\nManufacturer: Various generators in the USA. Goods collected and consolidated by EC4 ENTERPRISES LLC';
    const [memo, setMemo] = useState(DEFAULT_MEMO);
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
    const [emailDocSelection, setEmailDocSelection] = useState({ invoice: true, pl: true, sli: false, bol: false });
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
    const [pendingProformaEmailDraft, setPendingProformaEmailDraft] = useState<{
        to: string; cc: string; subject: string; htmlBody: string;
        attachments: { name: string; contentBytes: string; contentType: string }[];
        proposalId?: string;
    } | null>(null);
    const [brPriceAdjustment, setBrPriceAdjustment] = useState<'none' | '50' | 'br'>('none');

    // Bookings - use prop as initial value, fallback to fetch
    const [allBookings, setAllBookings] = useState(bookings);

    // ========================================================================
    // PROFORMA STATE (Step 2)
    // ========================================================================
    const [piNumber, setPiNumber] = useState('');
    const [piDate, setPiDate] = useState(new Date().toISOString().split('T')[0]);
    const [piSeller, setPiSeller] = useState('');
    const [piBuyer, setPiBuyer] = useState('');
    const [piIncoterm, setPiIncoterm] = useState('');
    const [piPaymentTerms, setPiPaymentTerms] = useState('');
    const [piPod, setPiPod] = useState('');
    const [piItems, setPiItems] = useState<Array<{ id: string; description: string; translatedDescription?: string; quantity: number; unit: string; unitPrice: number; amount: number }>>([]);
    const [piTotal, setPiTotal] = useState(0);
    const [piSaved, setPiSaved] = useState(false);
    const [contractFile, setContractFile] = useState<File | null>(null);
    const [contractProcessing, setContractProcessing] = useState(false);
    const [contractOcrDone, setContractOcrDone] = useState(false);
    const contractFileInputRef = useRef<HTMLInputElement>(null);
    const [contractDragActive, setContractDragActive] = useState(false);

    // Saved contracts from database
    const [savedContracts, setSavedContracts] = useState<{
        id: string; contractNumber: string; seller: string; buyer: string;
        date: string; total: number; status: string; pod?: string;
        items: { id: string; description: string; quantity: number; unit: string; unitPrice: number; amount: number }[];
        originalDocUrl?: string; originalDocType?: string;
    }[]>([]);
    const [editingContractId, setEditingContractId] = useState<string | null>(null);
    const [editingContractData, setEditingContractData] = useState<any>(null);
    const [contractViewUrl, setContractViewUrl] = useState<string | null>(null);
    const [contractViewTitle, setContractViewTitle] = useState('');

    // Saved Proformas State
    const [savedProformas, setSavedProformas] = useState<{
        id: string; pi_number: string; seller: string; buyer: string;
        pi_date: string; total: number; status: string;
        incoterm?: string; payment_terms?: string; pod?: string;
        items?: any[];
    }[]>([]);
    const [proformaViewMode, setProformaViewMode] = useState<'LIST' | 'EDIT'>('LIST');
    const [editingProformaId, setEditingProformaId] = useState<string | null>(null);
    const [translatingInProgress, setTranslatingInProgress] = useState(false);

    // Proposal Step State
    const [proposalFile, setProposalFile] = useState<File | null>(null);
    const [proposalItems, setProposalItems] = useState<Array<{ id: string; description: string; translatedDescription?: string; quantity: number; unit: string; unitPrice: number; markup: number; amount: number }>>([]);
    const [proposalProcessing, setProposalProcessing] = useState(false);
    const [proposalError, setProposalError] = useState<string | null>(null);
    const [proposalDragActive, setProposalDragActive] = useState(false);
    const proposalFileInputRef = useRef<HTMLInputElement>(null);
    const [proposalSeller, setProposalSeller] = useState('');
    const [proposalBuyer, setProposalBuyer] = useState('');
    const [proposalIncoterm, setProposalIncoterm] = useState('FOB');
    const [proposalPaymentTerms, setProposalPaymentTerms] = useState('NET 30');
    const [proposalNotes, setProposalNotes] = useState('');
    const [proposalDone, setProposalDone] = useState(false);
    const [preparingProposal, setPreparingProposal] = useState<any | null>(null);
    const [proposalMarkupOpen, setProposalMarkupOpen] = useState(false);
    const [proposalMarkupMode, setProposalMarkupMode] = useState<'flat' | 'pct'>('flat');
    const [proposalMarkupValue, setProposalMarkupValue] = useState(0);
    const [savedProposals, setSavedProposals] = useState<any[]>([]);
    const [prepTranslations, setPrepTranslations] = useState<Record<string, string>>({});
    const [prepTranslating, setPrepTranslating] = useState(false);
    const [prepDownloading, setPrepDownloading] = useState(false);
    const [downloadBrAdjustment, setDownloadBrAdjustment] = useState<'none' | '50' | 'br'>('none');
    const [previewGenerating, setPreviewGenerating] = useState(false);
    // Pre-compute last-price lookup for the Prepare Proposal panel
    const lastPriceMap = useMemo(() => {
        const map: Record<string, { price: number; source: string; date: string }> = {};
        if (!preparingProposal) return map;
        const buyer = (preparingProposal.buyer || '').toLowerCase().trim();
        savedProposals
            .filter((p: any) => p.status === 'SENT' && (p.buyer || '').toLowerCase().trim() === buyer)
            .forEach((p: any) => {
                const pDate = p.date || p.created_at || '';
                (p.items || []).forEach((it: any) => {
                    const key = (it.description || '').toLowerCase().trim();
                    if (!key) return;
                    const salePrice = Number(it.unitPrice || 0) + Number(it.markup || 0);
                    const existing = map[key];
                    if (!existing || pDate > existing.date) map[key] = { price: salePrice, source: 'Proposal', date: pDate };
                });
            });
        invoices
            .filter((inv: any) => {
                const invBuyer = (inv.billToName || inv.soldTo || inv.customerName || '').toLowerCase().trim();
                return buyer && (invBuyer.includes(buyer.split(' ')[0]) || buyer.includes((invBuyer || ' ').split(' ')[0]));
            })
            .forEach((inv: any) => {
                const invDate = inv.invoiceDate || inv.created_at || '';
                const invItems = typeof inv.items === 'string' ? (() => { try { return JSON.parse(inv.items); } catch { return []; } })() : (inv.items || []);
                invItems.forEach((it: any) => {
                    const key = (it.description || it.productDescription || '').toLowerCase().trim();
                    if (!key) return;
                    const salePrice = Number(it.unitPrice || it.price || 0);
                    const existing = map[key];
                    if (salePrice > 0 && (!existing || invDate > existing.date)) map[key] = { price: salePrice, source: 'Invoice', date: invDate };
                });
            });
        return map;
    }, [preparingProposal, savedProposals, invoices]);
    const [editingProposalId, setEditingProposalId] = useState<string | null>(null);
    const [editingProposalData, setEditingProposalData] = useState<any>(null);
    const [proposalNumber, setProposalNumber] = useState('');
    const [proposalDate, setProposalDate] = useState(new Date().toISOString().split('T')[0]);
    const [proposalSaving, setProposalSaving] = useState(false);

    // ========================================================================
    // EFFECTS
    // ========================================================================
    // Auto-refresh data when component mounts (fetch latest PLs, invoices, etc.)
    useEffect(() => {
        if (onRefreshData) {
            console.log('[SOPICIComissions] Auto-refreshing data on mount...');
            onRefreshData().then(() => {
                console.log('[SOPICIComissions] Data refresh complete');
            }).catch(err => {
                console.error('[SOPICIComissions] Data refresh failed:', err);
            });
        }
    }, []); // Empty dependency array = run once on mount

    // Sync savedPLs with packingLists prop when it changes
    useEffect(() => {
        console.log('[SOPICIComissions] packingLists PROP received:', packingLists?.length || 0, 'items');
        if (packingLists && packingLists.length > 0) {
            setSavedPLs(packingLists);
            console.log('[SOPICIComissions] Synced savedPLs from prop:', packingLists.length, 'items');
        }
    }, [packingLists]);

    // Auto-translate descriptions whenever a new proposal is opened in Prepare Proposal
    useEffect(() => {
        if (!preparingProposal) {
            setPrepTranslations({}); // clear on close
            return;
        }
        const items = preparingProposal.items || [];
        if (!items.length) return;
        const descs = items.map((it: any) => it.description || '').filter(Boolean);
        if (!descs.length) return;
        const buyerName = (preparingProposal.buyer || '').toLowerCase().trim();
        const matchedCust = (customers as any[] || []).find((c: any) =>
            (c.name || '').toLowerCase().includes(buyerName) ||
            buyerName.includes((c.name || '').toLowerCase().trim())
        ) as any;
        const country = matchedCust?.country || 'Brazil';
        let cancelled = false;
        setPrepTranslating(true);
        translateDescriptions(descs, country)
            .then(translated => {
                if (cancelled) return;
                if (translated.length > 0) {
                    const map: Record<string, string> = {};
                    items.forEach((it: any, i: number) => {
                        if (translated[i]) map[it.description || ''] = translated[i];
                    });
                    setPrepTranslations(map);
                }
            })
            .catch(err => console.error('[PrepProposal AutoTranslate]', err))
            .finally(() => { if (!cancelled) setPrepTranslating(false); });
        return () => { cancelled = true; };
    }, [preparingProposal?.id]); // re-run when a different proposal is opened

    // Sync allBookings with bookings prop when it changes
    useEffect(() => {
        console.log('[SOPICIComissions] bookings PROP received:', bookings?.length || 0, 'items');
        if (bookings && bookings.length > 0) {
            setAllBookings(bookings);
            console.log('[SOPICIComissions] Synced allBookings from prop:', bookings.length, 'items');
        }
    }, [bookings]);

    // Auto-populate invoice items when entering CREATE_INVOICE step with PL data
    useEffect(() => {
        if (currentStep === 'CREATE_INVOICE' && plItems.length > 0 && invoiceItems.length === 0) {
            console.log('[SOPICIComissions] Auto-populating invoice from PL on step entry');
            populateFromPL();
        }
    }, [currentStep]);

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
        console.log('[SOPICIComissions] INVOICES PROP RECEIVED:', invoices.length, 'invoices');
        if (invoices.length > 0) {
            // Log ALL invoices with their bolUrl status
            console.log('[SOPICIComissions] === INVOICES BOL STATUS ===');
            invoices.forEach(inv => {
                const bolUrl = (inv as any).bolUrl || (inv as any).bolurl;
                if (bolUrl) {
                    console.log(`[SOPICIComissions] ${inv.invoiceNumber}: HAS BOL (length: ${bolUrl.length})`);
                }
            });
            console.log('[SOPICIComissions] Sample invoice memo field:', (invoices[0] as any).memo);
            console.log('[SOPICIComissions] Sample invoice bolUrl:', (invoices[0] as any).bolUrl, 'bolurl:', (invoices[0] as any).bolurl);
            // Sync savedInvoices with prop so modal gets fresh data
            setSavedInvoices(invoices);
        }
    }, [invoices]);

    useEffect(() => {
        const fetchLogo = async () => {
            const client = getSupabaseClient();
            if (!client) return;

            const targetId = currentCompanyId === 'ALL' ? 'SYSTEM' : currentCompanyId;
            console.log('[SOPICIComissions] Fetching logo for companyId:', targetId);

            try {
                const { data } = await client
                    .from('imagens')
                    .select('url')
                    .eq('companyId', targetId)
                    .eq('type', 'LOGO')
                    .single();

                if (data && data.url) {
                    console.log('[SOPICIComissions] Logo found, URL length:', data.url.length);
                    setLogoUrl(data.url);
                } else if (targetId !== 'SYSTEM') {
                    // Try system logo if company specific not found
                    console.log('[SOPICIComissions] No company logo, trying SYSTEM logo...');
                    const { data: sysData } = await client
                        .from('imagens')
                        .select('url')
                        .eq('companyId', 'SYSTEM')
                        .eq('type', 'LOGO')
                        .single();
                    if (sysData && sysData.url) {
                        console.log('[SOPICIComissions] System logo found');
                        setLogoUrl(sysData.url);
                    } else {
                        console.log('[SOPICIComissions] No logo found at all');
                        setLogoUrl(null);
                    }
                } else {
                    setLogoUrl(null);
                }
            } catch (e) {
                console.error('[SOPICIComissions] Error fetching logo:', e);
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
                console.warn('[SOPICIComissions] Could not load stamp:', e);
            }
        };
        loadStamp();
    }, [currentCompanyId]);

    useEffect(() => {
        console.log('[SOPICIComissions] Fetching data for company:', currentCompanyId);
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
            console.log('[SOPICIComissions] Fetched packing_lists:', plData?.length || 0, 'items, error:', plError, 'prop has:', packingLists?.length || 0);
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
            // Fetch commission packing lists (exclude large originalDocument for listing)
            const { data: commPLData } = await client.from('commission_packing_lists')
                .select('id, companyId, createdAt, bookingNumber, soNumber, plNumber, supplier, consignee, customerName, containerNumber, sealNumber, grossWeight, netWeight, volumes, items, status')
                .eq('companyId', currentCompanyId)
                .order('createdAt', { ascending: false });
            if (commPLData) setCommissionPLs(commPLData);
            console.log('[SOPICIComissions] Fetched commission_packing_lists:', commPLData?.length || 0);
        } catch (e) { console.error('Error fetching commission_packing_lists:', e); }

        try {
            // Fetch commission customer invoices (exclude large originalDocument for listing)
            const { data: commInvData } = await client.from('commission_customer_invoices')
                .select('id, companyId, createdAt, invoiceNumber, invoiceDate, sellerName, customerName, bookingNumber, soNumber, plNumber, incoterm, paymentTerms, pol, pod, items, totalAmount, currency, status')
                .eq('companyId', currentCompanyId)
                .order('createdAt', { ascending: false });
            if (commInvData) setCommissionInvoices(commInvData);
            console.log('[SOPICIComissions] Fetched commission_customer_invoices:', commInvData?.length || 0);
        } catch (e) { console.error('Error fetching commission_customer_invoices:', e); }

        // Fetch saved commission sales contracts (exclude large originalDocument for listing)
        try {
            const { data: contractsData } = await client.from('commission_sales_contracts')
                .select('id, contractNumber, seller, buyer, date, total, status, items, originalDocType, pod')
                .eq('companyId', currentCompanyId)
                .order('createdAt', { ascending: false });
            if (contractsData && contractsData.length > 0) {
                setSavedContracts(contractsData.map((c: any) => ({
                    id: c.id,
                    contractNumber: c.contractNumber || '',
                    seller: c.seller || '',
                    buyer: c.buyer || '',
                    date: c.date || '',
                    total: Number(c.total) || 0,
                    status: c.status || 'ACTIVE',
                    pod: c.pod || '',
                    items: c.items || [],
                    originalDocUrl: undefined,
                    originalDocType: c.originalDocType || undefined
                })));
            }
        } catch (e) { console.error('Error fetching commission_sales_contracts:', e); }

        // Fetch saved proposals
        try {
            const { data: proposalsData } = await client.from('commission_proposals')
                .select('id, proposalNumber, seller, buyer, date, incoterm, paymentTerms, notes, total, status, items, createdAt')
                .eq('companyId', currentCompanyId)
                .order('createdAt', { ascending: false });
            if (proposalsData && proposalsData.length > 0) {
                setSavedProposals(proposalsData.map((p: any) => ({
                    id: p.id,
                    proposalNumber: p.proposalNumber || '',
                    seller: p.seller || '',
                    buyer: p.buyer || '',
                    date: p.date || '',
                    incoterm: p.incoterm || 'FOB',
                    paymentTerms: p.paymentTerms || '',
                    notes: p.notes || '',
                    total: Number(p.total) || 0,
                    status: p.status || 'DRAFT',
                    items: p.items || [],
                })));
            }
        } catch (e) { console.error('Error fetching commission_proposals:', e); }

        // Fetch saved proformas
        try {
            const { data: proformaData } = await client.from('commissions_proformas')
                .select('id, pi_number, seller, buyer, pi_date, total, status, incoterm, payment_terms, pod, items')
                .eq('company_id', currentCompanyId)
                .order('pi_date', { ascending: false });
            if (proformaData && proformaData.length > 0) {
                setSavedProformas(proformaData);
            }
        } catch (e) { console.error('Error fetching commissions_proformas:', e); }

        try {
            // Fetch ALL bookings (no company filter to ensure dropdown is populated)
            const { data: bookingsData, error: bookingsError } = await client.from('bookings').select('id, bookingNumber, salesOrderId, customer, status, pol, agentName').order('createdAt', { ascending: false });
            console.log('[SOPICIComissions] Fetched bookings:', bookingsData?.length || 0, 'error:', bookingsError);
            if (bookingsData && bookingsData.length > 0) setAllBookings(bookingsData as any);
        } catch (e) { console.error('Error fetching bookings:', e); }
        // Logo is fetched in dedicated useEffect above
    };

    // ========================================================================
    // STEP NAVIGATION
    // ========================================================================
    const canProceedToEditPL = () => plItems.length > 0 || editingPLId;
    const canProceedToInvoice = () => plNumber && plItems.length > 0;

    // Step order for the 4-step wizard
    const STEP_ORDER: WizardStep[] = ['PROPOSAL', 'UPLOAD_CONTRACT', 'CREATE_PROFORMA', 'UPLOAD_PL', 'CREATE_INVOICE'];
    const getVisualStep = (step: WizardStep): WizardStep => step === 'EDIT_PL' ? 'UPLOAD_PL' : step;

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
        if (step === 'EDIT_PL' && !canProceedToEditPL()) return;
        // Allow free navigation to Commission Invoice step

        // Reset PL state when leaving EDIT_PL to go back to UPLOAD_PL
        if (currentStep === 'EDIT_PL' && step === 'UPLOAD_PL') {
            resetPLState();
        }

        // Reset OCR extracted data when going back to Sales Contract
        if (step === 'UPLOAD_CONTRACT') {
            setContractFile(null);
            setPiNumber(`PI-${Date.now().toString().slice(-6)}`);
            setPiDate(new Date().toISOString().split('T')[0]);
            setPiSeller('');
            setPiBuyer('');
            setPiIncoterm('');
            setPiPaymentTerms('');
            setPiPod('');
            setPiItems([]);
            setPiTotal(0);
        }

        if (step === 'CREATE_PROFORMA') {
            setProformaViewMode('LIST');
        }

        setCurrentStep(step);
    };

    // ========================================================================
    // UTILITY FUNCTIONS
    // ========================================================================

    // Save PDF with native file picker dialog (lets user choose folder)
    const saveWithPicker = async (doc: any, defaultFileName: string) => {
        try {
            if ('showSaveFilePicker' in window) {
                const handle = await (window as any).showSaveFilePicker({
                    suggestedName: defaultFileName,
                    types: [{
                        description: 'PDF Document',
                        accept: { 'application/pdf': ['.pdf'] }
                    }]
                });
                const writable = await handle.createWritable();
                const pdfBlob = doc.output('blob');
                await writable.write(pdfBlob);
                await writable.close();
            } else {
                // Fallback for browsers that don't support File System Access API
                doc.save(defaultFileName);
            }
        } catch (err: any) {
            // User cancelled the dialog
            if (err.name !== 'AbortError') {
                console.error('Save error:', err);
                doc.save(defaultFileName);
            }
        }
    };

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
            Analyze this Packing List / Invoice document.
            Task: Extract shipping data into a structured JSON format.
            
            1. Find the "Booking Number" or "Booking Ref".
               - CRITICAL: Check for the text "CUSTOMER TRUCK". If found, the Booking Number is the value immediately BELOW "CUSTOMER TRUCK".
            2. Find the "Sales Order Number" or "SO Number" or "Order No" or "PO Number" that seems to be the sales reference.
            3. Extract line items — ONE ITEM PER PRODUCT/MATERIAL listed in the document.
               - CRITICAL: If the document lists multiple products/materials (even within the same container), each product MUST be a SEPARATE item in the array.
               - For example, if a document has 3 materials (e.g., "Soft P/C Threads", "Soft Poly/Cotton Selvages", "Hard P/C Slasher") in the same container, return 3 separate items, each with the SAME containerNo and sealNo but their OWN weight, volume, and description.
               - For each product/material line, extract:
                  - Container Number (shared if multiple products are in the same container)
                  - Seal Number (shared if multiple products are in the same container)
                  - Gross Weight (LBS and KG) for THIS specific product line, NOT the container total
                  - Net Weight (LBS and KG) for THIS specific product line, NOT the container total
                  - Volume / Quantity (e.g., Bales, Cartons, Pallets) -> field "volumes" for THIS product only
                  - Supplier / Manufacturer Name
                  - Product Description (the material/product name, e.g., "Soft P/C Threads 40%")
                  - Bill of Lading (BL) Number: Locate "Packing List No." or "Packing List Number" or "Invoice No" and use this value as the BL Number.
            
            Logic:
            - If weights are only in KG, convert to LBS (1 KG = 2.20462 LBS).
            - If weights are only in LBS, convert to KG (1 LBS = 0.453592 KG).
            - Ensure numeric values are numbers, not strings.
            - NEVER combine multiple products into a single item. Each distinct product/material row in the document = one item in the JSON array.
            
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
            (item.grossLbs || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            (item.netLbs || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            (item.grossKg || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            (item.netKg || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            item.volumes || 0,
            item.supplier || '',
            item.blNumber || ''
        ]);

        tableBody.push([
            'TOTALS', '', '',
            totals.grossLbs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            totals.netLbs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
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
        setPreviewDownloadFn(() => () => saveWithPicker(doc, fileName));
    };

    const exportContainerPDF = () => {
        const doc = new jsPDF('l', 'mm', 'a4');
        doc.setFontSize(14);
        doc.text(`Resume per Container - PL: ${plNumber || 'Draft'}`, 14, 15);
        const containerBody = containerSummary.map((c: any) => [
            c.containerNo,
            c.sealNo || '',
            (c.grossLbs || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            (c.netLbs || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            (c.grossKg || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            (c.netKg || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            c.volumes || 0
        ]);

        containerBody.push([
            'TOTALS', '',
            totals.grossLbs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            totals.netLbs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
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
        setPreviewDownloadFn(() => () => saveWithPicker(doc, fileName));
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

        // Carry booking number from PL into invoice transport ref
        if (bookingNumber && !transportRef) {
            setTransportRef(bookingNumber);
        }

        console.log('[populateFromPL] PL Items:', plItems.length);
        console.log('[populateFromPL] Products loaded:', products.length);

        // Look up the matched Sales Order for price resolution
        const matchedSO = soNumber ? salesOrders.find(so => so.orderNumber === soNumber) : null;
        if (matchedSO) {
            console.log('[populateFromPL] Matched SO:', matchedSO.orderNumber, '| Customer:', matchedSO.customerName, '| Items:', matchedSO.items?.length);
            // Auto-set customer from SO
            if (matchedSO.customerName && !billToName) {
                setBillToName(matchedSO.customerName);
            }
        }

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

            // 5. SO Price Resolution — match PL product to SO item by description
            let soUnitPrice: number | null = null;
            let soCustomerDesc = '';
            if (matchedSO?.items?.length) {
                const descLower = (productDescription || '').toLowerCase().trim();
                const plNameLower = (plItem.productName || '').toLowerCase().trim();
                const soItem = matchedSO.items.find(si => {
                    const siName = (si.productName || '').toLowerCase().trim();
                    return siName === descLower || siName === plNameLower;
                }) || matchedSO.items.find(si => {
                    const siName = (si.productName || '').toLowerCase().trim();
                    return (descLower && siName.includes(descLower)) || (descLower && descLower.includes(siName)) ||
                        (plNameLower && siName.includes(plNameLower)) || (plNameLower && plNameLower.includes(siName));
                });
                if (soItem) {
                    soUnitPrice = soItem.unitPrice;
                    soCustomerDesc = soItem.customerDescription || '';
                    console.log(`[populateFromPL] SO price match: "${productDescription}" → $${soItem.unitPrice}/unit from SO ${matchedSO.orderNumber}`);
                }
            }

            const finalUnitPrice = soUnitPrice ?? Number(plItem.unitPrice || 0);

            return {
                ...plItem,
                id: `inv_${Date.now()}_${idx}`,
                productId: resolvedProductId,
                description: productDescription,
                customerDescription: soCustomerDesc || plItem.customerDescription || '',
                hsCode: resolvedHsCode,
                quantity: Number(plItem.netLbs || plItem.quantity || 0),
                unit: 'LBS',
                unitPrice: finalUnitPrice,
                unitPriceLbs: finalUnitPrice,
                unitPriceKg: Number(finalUnitPrice / 0.453592),
                amount: Number(plItem.netLbs || plItem.quantity || 0) * finalUnitPrice,
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

            // Also save/update in commission_customer_invoices table
            try {
                const commInvData = {
                    id: invId,
                    companyId: currentCompanyId,
                    createdAt: new Date().toISOString(),
                    invoiceNumber: invoice.invoiceNumber,
                    invoiceDate: invoice.invoiceDate,
                    sellerName: invoice.shipperName || invoice.shipper || '',
                    customerName: invoice.billToName || invoice.soldTo || '',
                    bookingNumber: invoice.bookingNumber || invoice.transportRef || '',
                    soNumber: invoice.soNumber || '',
                    plNumber: invoice.plNumber || '',
                    incoterm: invoice.incoterm || '',
                    paymentTerms: invoice.paymentTerms || '',
                    pol: invoice.poa || '',
                    pod: invoice.pod || '',
                    items: invoice.items || '[]',
                    totalAmount: invoice.totalAmount || 0,
                    currency: invoice.currency || 'USD',
                    status: 'AVAILABLE'
                };
                if (editingInvoiceId) {
                    await client.from('commission_customer_invoices').upsert(commInvData, { onConflict: 'id' });
                } else {
                    await client.from('commission_customer_invoices').upsert(commInvData, { onConflict: 'id' });
                }
                // Refresh commission invoices list
                setCommissionInvoices(prev => {
                    const existing = prev.findIndex(i => i.id === invId);
                    const { originalDocument: _doc, ...listItem } = commInvData as any;
                    if (existing >= 0) {
                        const updated = [...prev];
                        updated[existing] = { ...updated[existing], ...listItem };
                        return updated;
                    }
                    return [listItem, ...prev];
                });
                console.log('[SOPICIComissions] Saved to commission_customer_invoices');
            } catch (commErr) {
                console.error('[SOPICIComissions] Failed to save to commission_customer_invoices:', commErr);
            }

            // Auto-mark linked PL as INVOICED
            if (plNumber) {
                const linkedPL = savedPLs.find(p => p.plNumber === plNumber);
                if (linkedPL && (linkedPL as any).status !== 'INVOICED') {
                    try {
                        await client.from('packing_lists').update({ status: 'INVOICED' }).eq('id', linkedPL.id);
                        setSavedPLs(prev => prev.map(p => p.id === linkedPL.id ? { ...p, status: 'INVOICED' as any } : p));
                        console.log(`[SOPICIComissions] Auto-marked PL ${plNumber} as INVOICED`);
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
                        console.log(`[SOPICIComissions] Auto-marked booking ${bookingNumber} as SHIPPED`);
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
            // Used downstream for the email body greeting.
            const customer = customers.find(c => c.name === (inv.billToName || inv.soldTo));
            let toEmails = '';
            let ccEmail = '';
            if (brMode) {
                // Legacy: BR mode for SOPICI sends to felipe@ only — not
                // the same as PLInvoiceEngine's BR mode. Keep as-is.
                toEmails = 'felipe@ec4.enterprises';
                ccEmail = '';
            } else {
                const recipients = await resolveRecipients({
                    actors: [
                        { customerName: inv.billToName || inv.soldTo || null, role: 'primary' },
                        { customerName: inv.consignee || inv.shipTo || null, role: 'secondary' },
                    ],
                    bookingNumber: (inv as any).bookingNumber || inv.transportRef || null,
                    includeBroker: true,
                    customers,
                });
                const joined = joinRecipients(recipients);
                toEmails = joined.to;
                ccEmail  = joined.cc;
            }

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
                    // BR invoice number: 'EC' + last 2 digits of original invoice number
                    const origNum = inv.invoiceNumber || '';
                    const last2 = origNum.replace(/\D/g, '').slice(-2);
                    const brInvoiceNumber = `EC${last2}`;
                    pdfInv = {
                        ...inv,
                        invoiceNumber: brInvoiceNumber,
                        items: JSON.stringify(adjustedItems),
                        subtotal: newSubtotal,
                        totalAmount: newSubtotal
                    };
                    console.log('[Email][BR] Price-adjusted invoice for', customerName, '- new total:', newSubtotal, '- BR invoice#:', brInvoiceNumber);
                }
            }
            // BR MODE fallback: always override invoice number even if no price adjustment
            if (brMode && pdfInv.invoiceNumber === inv.invoiceNumber) {
                const origNum = inv.invoiceNumber || '';
                const last2 = origNum.replace(/\D/g, '').slice(-2);
                pdfInv = { ...pdfInv, invoiceNumber: `EC${last2}` };
            }

            // 1. Generate Invoice PDF (if selected)
            if (emailDocSelection.invoice) {
                try {
                    const invoiceDoc = await generateInvoicePDF(pdfInv, false);
                    const invoiceBase64 = invoiceDoc.output('datauristring').split(',')[1];
                    attachments.push({
                        name: `Invoice_${pdfInv.invoiceNumber || 'unknown'}.pdf`,
                        contentBytes: invoiceBase64,
                        contentType: 'application/pdf'
                    });
                    console.log('[Email] Invoice PDF generated');
                } catch (e) {
                    console.error('[Email] Failed to generate Invoice PDF:', e);
                }
            }

            // 2. Generate Packing List PDF (if selected)
            if (emailDocSelection.pl) {
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
            }

            // 3. Generate SLI PDF (if selected, skip in BR mode)
            if (emailDocSelection.sli && !brMode) {
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

            // 4. Add BOL if available and selected (skip in BR mode)
            const bolUrl = (inv as any).bolUrl || (inv as any).bolurl;
            if (emailDocSelection.bol && !brMode && bolUrl && bolUrl.startsWith('data:')) {
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

${emailDocSelection.invoice ? `• Commercial Invoice: ${inv.invoiceNumber}` : ''}${emailDocSelection.pl ? `\n• Packing List: ${inv.plNumber || 'N/A'}` : ''}${emailDocSelection.sli ? '\n• Shipper\'s Letter of Instruction (SLI)' : ''}${emailDocSelection.bol && bolUrl ? '\n• Bill of Lading (BOL)' : ''}

Total Amount: $${Number(inv.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}

If you have any questions, please don't hesitate to contact us.

Best regards,
${companyName}`.replace(/\n{3,}/g, '\n\n');

            // Build subject with booking number if available
            const bookingRef = (inv as any).bookingNumber || inv.transportRef || '';
            const subjectParts = [brMode ? `BR Documents - Invoice #${pdfInv.invoiceNumber}` : `Shipping Documents - Invoice #${inv.invoiceNumber}`];
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
            // If BR price adjustment is selected, regenerate the PDF with adjusted prices
            let finalDraft = { ...emailDraft };
            if (brPriceAdjustment !== 'none' && piItems.length > 0) {
                console.log(`[Email PI] Regenerating PDF with BR adjustment: ${brPriceAdjustment}`);
                const adjustedDoc = generateCommissionProformaPDF(brPriceAdjustment);
                const adjustedBlob = adjustedDoc.output('blob');
                const adjustedBuffer = await adjustedBlob.arrayBuffer();
                const adjustedBytes = new Uint8Array(adjustedBuffer);
                let adjustedBinary = '';
                for (let i = 0; i < adjustedBytes.length; i++) {
                    adjustedBinary += String.fromCharCode(adjustedBytes[i]);
                }
                const adjustedBase64 = btoa(adjustedBinary);
                // Calculate adjusted total for email body
                const adjustedItems = piItems.map(item => {
                    const qty = Number(item.quantity) || 0;
                    let adjPrice = item.unitPrice;
                    if (brPriceAdjustment === '50') adjPrice = item.unitPrice * 0.5;
                    else if (brPriceAdjustment === 'br') adjPrice = 0.28;
                    return qty * adjPrice;
                });
                const adjustedTotal = adjustedItems.reduce((s, a) => s + a, 0);
                // Update attachment and total in email body
                finalDraft = {
                    ...finalDraft,
                    htmlBody: finalDraft.htmlBody.replace(
                        /Total: \$[\d,.]+/,
                        `Total: $${adjustedTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                    ),
                    attachments: [{
                        name: finalDraft.attachments[0]?.name || `Proforma_${piNumber}.pdf`,
                        contentBytes: adjustedBase64,
                        contentType: 'application/pdf'
                    }]
                };
            }
            // Convert plain text to HTML
            const htmlBody = brMode
                ? `<div style="font-family: Arial, sans-serif; text-align: left; line-height: 1.6;">${finalDraft.htmlBody.replace(/\n/g, '<br>')}</div>`
                : `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #4F46E5;">${finalDraft.subject}</h2>
                    <div style="white-space: pre-wrap; line-height: 1.6;">${finalDraft.htmlBody}</div>
                </div>
            `;

            // Parse CC field (comma-separated emails)
            const ccList = finalDraft.cc
                ? finalDraft.cc.split(',').map(e => e.trim()).filter(e => e.length > 0)
                : [];

            console.log('[Email] Sending email to', finalDraft.to, 'CC:', ccList, 'with', finalDraft.attachments.length, 'attachments', brPriceAdjustment !== 'none' ? `(BR adjustment: ${brPriceAdjustment})` : '');

            // Parse TO field (semicolon or comma-separated emails)
            const toList = finalDraft.to
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
                    subject: finalDraft.subject,
                    htmlBody: htmlBody,
                    attachments: finalDraft.attachments
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
                // Update proposal status to SENT if this was a proposal email
                if (emailDraft && (emailDraft as any)._proposalId) {
                    const proposalId = (emailDraft as any)._proposalId;
                    try {
                        const client = getSupabaseClient();
                        await client.from('commission_proposals').update({ status: 'SENT' }).eq('id', proposalId);
                        setSavedProposals((prev: any[]) => prev.map((p: any) => p.id === proposalId ? { ...p, status: 'SENT' } : p));
                        console.log('[Email] Updated proposal', proposalId, 'status to SENT');
                    } catch (err) { console.error('[Email] Failed to update proposal status:', err); }
                }
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
        setDocumentsModalOpen(false); // Close documents modal to prevent double backdrop
        const doc = await generateInvoicePDF(inv, false); // Generate without auto-download
        const blob = doc.output('blob');
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setPreviewTitle(`Invoice - ${inv.invoiceNumber}`);
        setPreviewFileName(`Invoice_${inv.invoiceNumber || 'unknown'}.pdf`);
        setPreviewBlob(blob);
        setPreviewDownloadFn(() => () => saveWithPicker(doc, `Invoice_${inv.invoiceNumber || 'unknown'}.pdf`));
    };

    const previewPackingListPDF = (inv: Invoice) => {
        setDocumentsModalOpen(false); // Close documents modal to prevent double backdrop
        const doc = generatePackingListPDF(inv, false); // Generate without auto-download
        const blob = doc.output('blob');
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setPreviewTitle(`Packing List - ${inv.plNumber || inv.invoiceNumber}`);
        setPreviewFileName(`PackingList_${inv.plNumber || inv.invoiceNumber || 'unknown'}.pdf`);
        setPreviewBlob(blob);
        setPreviewDownloadFn(() => () => saveWithPicker(doc, `PackingList_${inv.plNumber || inv.invoiceNumber || 'unknown'}.pdf`));
    };

    const previewSLIPDF = (inv: Invoice) => {
        setDocumentsModalOpen(false); // Close documents modal to prevent double backdrop
        const doc = generateSLIPreview(inv); // Use a preview version
        const blob = doc.output('blob');
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        setPreviewTitle(`Shipper's Letter of Instruction - ${inv.invoiceNumber}`);
        setPreviewFileName(`SLI_${inv.invoiceNumber || 'unknown'}.pdf`);
        setPreviewBlob(blob);
        setPreviewDownloadFn(() => () => saveWithPicker(doc, `SLI_${inv.invoiceNumber || 'unknown'}.pdf`));
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
                doc.text(qtyKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), leftCol + 95, y);
                doc.text(qtyKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), leftCol + 113, y);
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
        doc.text(`${totalNetKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KG`, leftCol + 95, y);
        doc.text(`${totalNetKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KG`, leftCol + 113, y);
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
        const specialNotes = (inv as any).specialNotes || (inv as any).memo || DEFAULT_MEMO;
        doc.text(specialNotes, leftValCol, y);

        // Return doc for preview (don't save)
        return doc;
    };



    // Wrapper for downloading SLI directly
    const generateSLI = (inv: Invoice) => {
        const doc = generateSLIPreview(inv);
        saveWithPicker(doc, `SLI_${inv.invoiceNumber || 'unknown'}.pdf`);
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

        // Look up the consignee's customer record (may differ from bill-to)
        const shipToCustomer = customers.find(c => c.name === shipToName) || customer;
        let shipToAddress = '';
        if (shipToCustomer) {
            const stAddrParts = [shipToCustomer.location, shipToCustomer.city, shipToCustomer.state, shipToCustomer.zip, shipToCustomer.country].filter(Boolean);
            shipToAddress = stAddrParts.join(', ');
        }

        // Ship To Name
        doc.setFont('helvetica', 'bold');
        const shipToNameLines = doc.splitTextToSize(shipToName, 55);
        doc.text(shipToNameLines, 75, shipToY);
        shipToY += shipToNameLines.length * contentLineHeight;

        // Ship To Address (consignee's address)
        doc.setFont('helvetica', 'normal');
        if (shipToAddress) {
            const addrLines = doc.splitTextToSize(shipToAddress, 55);
            doc.text(addrLines, 75, shipToY);
            shipToY += addrLines.length * contentLineHeight;
        }

        // Ship To Email
        if (shipToCustomer?.email) {
            doc.text(shipToCustomer.email, 75, shipToY);
            shipToY += contentLineHeight;
        }

        // Ship To Tax ID
        if (shipToCustomer?.taxId) {
            doc.text(`CNPJ : ${shipToCustomer.taxId}`, 75, shipToY);
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

        // Consolidate items with same HS Code (NCM) and description into single rows
        const consolidatedItems: { description: string; hsCode: string; netLbs: number; netKg: number; amount: number }[] = [];
        const consolidationMap = new Map<string, number>();
        items.forEach((item: any) => {
            let description = (item.customerDescription || '').trim();
            if (!description && item.productId && products.length > 0) {
                const prod = products.find((p: any) => p.id === item.productId);
                if (prod) description = prod.name;
            }
            if (!description) description = `${item.productDescription || item.description || ''}`.trim();
            const hsCode = item.hsCode || '';
            const key = `${hsCode}|||${description}`;
            const netLbs = item.netLbs || item.quantity || 0;
            const netKg = item.netKg || (netLbs * 0.453592);
            const amount = item.amount || 0;
            const existingIdx = consolidationMap.get(key);
            if (existingIdx !== undefined) {
                consolidatedItems[existingIdx].netLbs += netLbs;
                consolidatedItems[existingIdx].netKg += netKg;
                consolidatedItems[existingIdx].amount += amount;
            } else {
                consolidationMap.set(key, consolidatedItems.length);
                consolidatedItems.push({ description, hsCode, netLbs, netKg, amount });
            }
        });

        const tableBody = consolidatedItems.map((ci) => {
            const qtyDisplay = `${ci.netLbs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lbs\n${ci.netKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;
            const unitPriceLbs = ci.netLbs > 0 ? ci.amount / ci.netLbs : 0;
            const unitPriceKgs = unitPriceLbs * 2.20462;
            const priceDisplay = `$${unitPriceLbs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/lb\n$${unitPriceKgs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/kg`;
            const amountDisplay = `$${ci.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            return [ci.description, ci.hsCode || '-', qtyDisplay, priceDisplay, amountDisplay];
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

        // --- TOTALS (Right side) - Show TOTAL above weights ---
        const totalAmount = items.reduce((sum: number, item: any) => sum + (item.amount || 0), 0);

        const labelX = 130;
        const valueX = 195;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text('TOTAL', labelX, finalY);
        doc.text(`$${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, valueX, finalY, { align: 'right' });

        finalY += 10;

        // --- WEIGHT & CONTAINER INFO ---
        // Use stored netKg/grossKg values (same source as Packing List) for consistency
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(darkGray);

        // Net KG: sum from consolidated items using stored netKg (same as Packing List)
        const totalConsolidatedNetKg = consolidatedItems.reduce((sum, ci) => sum + ci.netKg, 0);
        // Gross KG: sum from raw items using stored grossKg (same as Packing List)
        const totalGrossKg = items.reduce((sum: number, item: any) => sum + (item.grossKg || (item.grossLbs || 0) * 0.453592), 0);
        const totalVolumes = items.reduce((sum: number, item: any) => sum + (item.volumes || 0), 0);

        doc.text(`Net weight : ${totalConsolidatedNetKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kgs`, 14, finalY);
        doc.text(`Gross Weight : ${totalGrossKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kgs`, 14, finalY + 5);
        doc.text(`Total volumes : ${totalVolumes}`, 14, finalY + 10);

        // Container details — use saved containers as the authoritative source (matches Packing List)
        const savedContainers = typeof inv.containers === 'string' ? JSON.parse(inv.containers || '[]') : inv.containers || [];
        console.log('[PDF CONTAINERS] savedContainers:', JSON.stringify(savedContainers));
        
        // Build container rows directly from saved containers (same source as Packing List)
        const containerRows: { container: string; seal: string; volumes: number; amount: number }[] = [];
        
        if (savedContainers.length > 0) {
            savedContainers.forEach((cont: any) => {
                const contItems = items.filter((i: any) => i.containerNo === cont.container);
                const contVolumes = contItems.reduce((sum: number, i: any) => sum + (i.volumes || 0), 0);
                const contAmount = contItems.reduce((sum: number, i: any) => sum + (i.amount || 0), 0);
                containerRows.push({
                    container: cont.container || '-',
                    seal: cont.seal || '',
                    volumes: contVolumes,
                    amount: contAmount
                });
            });
            
            // If items have volumes not assigned to any saved container, add them to the total
            const assignedItems = new Set(items.filter((i: any) => savedContainers.some((c: any) => c.container === i.containerNo)).map((i: any) => i));
            if (assignedItems.size === 0 && items.length > 0) {
                // No items matched containers by containerNo — assign all volumes to first container
                containerRows[0].volumes = items.reduce((sum: number, i: any) => sum + (i.volumes || 0), 0);
                containerRows[0].amount = items.reduce((sum: number, i: any) => sum + (i.amount || 0), 0);
            }
        }

        if (containerRows.length > 0) {
            finalY += 18;
            // Check if we need a new page before starting the container section
            if (finalY > 260) {
                doc.addPage();
                finalY = 20;
            }

            const containerStartY = finalY;

            const allVolumes = containerRows.reduce((sum, r) => sum + r.volumes, 0);

            const containerTableHead = [['Container No.', 'Seal No.', 'Volumes']];
            const containerTableBody = containerRows.map((row) => [
                row.container,
                row.seal || '-',
                row.volumes.toString()
            ]);
            // Add TOTAL row
            containerTableBody.push([
                'TOTAL',
                '',
                allVolumes.toString()
            ]);

            autoTable(doc, {
                startY: finalY,
                head: containerTableHead,
                body: containerTableBody,
                theme: 'plain',
                tableWidth: 85,
                margin: { left: 14 },
                styles: {
                    fontSize: 7.5,
                    textColor: darkGray,
                    cellPadding: { top: 1, bottom: 1, left: 1, right: 1 }
                },
                headStyles: {
                    fontStyle: 'bold',
                    textColor: darkGray
                },
                columnStyles: {
                    0: { cellWidth: 35 },
                    1: { cellWidth: 25 },
                    2: { halign: 'center', cellWidth: 20 }
                },
                // Bold the last row (TOTAL)
                didParseCell: (data: any) => {
                    if (data.row.index === containerTableBody.length - 1) {
                        data.cell.styles.fontStyle = 'bold';
                    }
                }
            });

            const containerEndY = (doc as any).lastAutoTable.finalY + 5;

            // --- BANK DETAILS on the RIGHT side of the container table ---
            const invBankName = inv.bankName || '';
            const invBankAddress = inv.bankAddress || '';
            const invAccountNumber = inv.accountNumber || '';
            const invSwiftCode = inv.swiftCode || '';
            const invRoutingNumber = inv.routingNumber || '';
            const hasBank = !!invBankName;

            let bankEndY = containerStartY;
            if (hasBank) {
                const bankColX = 110;
                const bankLabelX = bankColX;
                const bankValueX = bankColX + 28;
                let bankY = containerStartY;

                doc.setFont('helvetica', 'bold');
                doc.setFontSize(10);
                doc.setTextColor(cyanColor);
                doc.text('BANK DETAILS', bankColX, bankY);

                bankY += 6;
                doc.setFontSize(9);
                doc.setTextColor(darkGray);

                doc.setFont('helvetica', 'bold');
                doc.text('Bank Name:', bankLabelX, bankY);
                doc.setFont('helvetica', 'normal');
                doc.text(invBankName, bankValueX, bankY);
                bankY += 5;

                if (invBankAddress) {
                    doc.setFont('helvetica', 'bold');
                    doc.text('Bank Address:', bankLabelX, bankY);
                    doc.setFont('helvetica', 'normal');
                    const addrLines = doc.splitTextToSize(invBankAddress, 55);
                    doc.text(addrLines, bankValueX, bankY);
                    bankY += addrLines.length * 4 + 1;
                }

                if (invSwiftCode) {
                    doc.setFont('helvetica', 'bold');
                    doc.text('SWIFT Code:', bankLabelX, bankY);
                    doc.setFont('helvetica', 'normal');
                    doc.text(invSwiftCode, bankValueX, bankY);
                    bankY += 5;
                }

                if (invRoutingNumber) {
                    doc.setFont('helvetica', 'bold');
                    doc.text('Routing #:', bankLabelX, bankY);
                    doc.setFont('helvetica', 'normal');
                    doc.text(invRoutingNumber, bankValueX, bankY);
                    bankY += 5;
                }

                if (invAccountNumber) {
                    doc.setFont('helvetica', 'bold');
                    doc.text('Account #:', bankLabelX, bankY);
                    doc.setFont('helvetica', 'normal');
                    doc.text(invAccountNumber, bankValueX, bankY);
                    bankY += 5;
                }

                bankEndY = bankY;
            }

            finalY = Math.max(containerEndY, bankEndY) + 5;
        } else {
            // No containers — still render bank details standalone
            const invBankName = inv.bankName || '';
            const invBankAddress = inv.bankAddress || '';
            const invAccountNumber = inv.accountNumber || '';
            const invSwiftCode = inv.swiftCode || '';
            const invRoutingNumber = inv.routingNumber || '';
            const hasBank = !!invBankName;

            if (hasBank) {
                let sectionY = finalY + 10;
                if (sectionY > 270) {
                    doc.addPage();
                    sectionY = 20;
                }
                const bankColX = 110;
                const bankLabelX = bankColX;
                const bankValueX = bankColX + 28;

                doc.setFont('helvetica', 'bold');
                doc.setFontSize(10);
                doc.setTextColor(cyanColor);
                doc.text('BANK DETAILS', bankColX, sectionY);

                let bankY = sectionY + 6;
                doc.setFontSize(9);
                doc.setTextColor(darkGray);

                doc.setFont('helvetica', 'bold');
                doc.text('Bank Name:', bankLabelX, bankY);
                doc.setFont('helvetica', 'normal');
                doc.text(invBankName, bankValueX, bankY);
                bankY += 5;

                if (invBankAddress) {
                    doc.setFont('helvetica', 'bold');
                    doc.text('Bank Address:', bankLabelX, bankY);
                    doc.setFont('helvetica', 'normal');
                    const addrLines = doc.splitTextToSize(invBankAddress, 55);
                    doc.text(addrLines, bankValueX, bankY);
                    bankY += addrLines.length * 4 + 1;
                }

                if (invSwiftCode) {
                    doc.setFont('helvetica', 'bold');
                    doc.text('SWIFT Code:', bankLabelX, bankY);
                    doc.setFont('helvetica', 'normal');
                    doc.text(invSwiftCode, bankValueX, bankY);
                    bankY += 5;
                }

                if (invRoutingNumber) {
                    doc.setFont('helvetica', 'bold');
                    doc.text('Routing #:', bankLabelX, bankY);
                    doc.setFont('helvetica', 'normal');
                    doc.text(invRoutingNumber, bankValueX, bankY);
                    bankY += 5;
                }

                if (invAccountNumber) {
                    doc.setFont('helvetica', 'bold');
                    doc.text('Account #:', bankLabelX, bankY);
                    doc.setFont('helvetica', 'normal');
                    doc.text(invAccountNumber, bankValueX, bankY);
                    bankY += 5;
                }

                finalY = bankY + 5;
            }
        }

        // --- ADDITIONAL INFORMATION (Memo) below ---
        const invoiceMemo = fetchedMemo;
        const hasMemo = invoiceMemo && invoiceMemo.trim();

        if (hasMemo) {
            let memoY = finalY + 5;
            if (memoY > 270) {
                doc.addPage();
                memoY = 20;
            }

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.setTextColor(cyanColor);
            doc.text('ADDITIONAL INFORMATION', 14, memoY);

            memoY += 6;
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(darkGray);
            const memoLines = doc.splitTextToSize(invoiceMemo, 170);
            doc.text(memoLines, 14, memoY);
            finalY = memoY + memoLines.length * 4 + 5;
        }

        // Add EC4 stamp at bottom-right
        if (stampUrl && companyName.toUpperCase().includes('EC4')) {
            try {
                const stampSize = 35;
                const stampX = 196 - stampSize;
                const stampY = Math.min(finalY + 5, 255);
                doc.addImage(stampUrl, 'PNG', stampX, stampY, stampSize, stampSize);
            } catch (e) {
                console.warn('[Invoice PDF] Could not add stamp:', e);
            }
        }

        if (autoDownload) {
            saveWithPicker(doc, `Invoice_${inv.invoiceNumber || 'unknown'}.pdf`);
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

        // Look up the consignee's customer record (may differ from bill-to)
        const shipToCustomer = customers.find(c => c.name === shipToName) || customer;
        let shipToAddress = '';
        if (shipToCustomer) {
            const stAddrParts = [shipToCustomer.location, shipToCustomer.city, shipToCustomer.state, shipToCustomer.zip, shipToCustomer.country].filter(Boolean);
            shipToAddress = stAddrParts.join(', ');
        }

        // Ship To Name
        doc.setFont('helvetica', 'bold');
        const shipToNameLines = doc.splitTextToSize(shipToName, 55);
        doc.text(shipToNameLines, 75, shipToY);
        shipToY += shipToNameLines.length * 4;

        // Ship To Address (consignee's address)
        doc.setFont('helvetica', 'normal');
        if (shipToAddress) {
            const addrLines = doc.splitTextToSize(shipToAddress, 55);
            doc.text(addrLines, 75, shipToY);
            shipToY += addrLines.length * 4;
        }

        // Ship To Email
        if (shipToCustomer?.email) {
            doc.text(shipToCustomer.email, 75, shipToY);
            shipToY += 4;
        }

        // Ship To Tax ID
        if (shipToCustomer?.taxId) {
            doc.text(`CNPJ : ${shipToCustomer.taxId}`, 75, shipToY);
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

        // Consolidate items with same HS Code (NCM) and description into single rows
        const consolidatedPLItems: { description: string; hsCode: string; netLbs: number; netKg: number }[] = [];
        const plConsolidationMap = new Map<string, number>();
        items.forEach((item: any) => {
            let description = (item.customerDescription || '').trim();
            if (!description && item.productId && products.length > 0) {
                const prod = products.find((p: any) => p.id === item.productId);
                if (prod) description = prod.name;
            }
            if (!description) description = `${item.productDescription || item.description || ''}`.trim();
            const hsCode = item.hsCode || '';
            const key = `${hsCode}|||${description}`;
            const netLbs = item.netLbs || item.quantity || 0;
            const netKg = item.netKg || (netLbs * 0.453592);
            const existingIdx = plConsolidationMap.get(key);
            if (existingIdx !== undefined) {
                consolidatedPLItems[existingIdx].netLbs += netLbs;
                consolidatedPLItems[existingIdx].netKg += netKg;
            } else {
                plConsolidationMap.set(key, consolidatedPLItems.length);
                consolidatedPLItems.push({ description, hsCode, netLbs, netKg });
            }
        });

        const tableBody = consolidatedPLItems.map((ci) => {
            const qtyDisplay = `${ci.netLbs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lbs\n${ci.netKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;
            return [ci.description, ci.hsCode || '-', qtyDisplay];
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
                return { container: cont.container || '-', seal: cont.seal || '-', volumes: contVolumes, netKg: contNetKg, grossKg: contGrossKg };
            });

            // If no items matched any container (stale containerNo), distribute totals evenly
            const anyMatched = containerTableBody.some((r: any) => r.volumes > 0 || r.netKg > 0 || r.grossKg > 0);
            if (!anyMatched && items.length > 0) {
                const allVolumes = items.reduce((sum: number, i: any) => sum + (i.volumes || 0), 0);
                const allNetKg = items.reduce((sum: number, i: any) => sum + (i.netKg || (i.netLbs || 0) * 0.453592), 0);
                const allGrossKg = items.reduce((sum: number, i: any) => sum + (i.grossKg || (i.grossLbs || 0) * 0.453592), 0);
                const n = containerTableBody.length;
                containerTableBody.forEach((r: any) => {
                    r.volumes = Math.round(allVolumes / n);
                    r.netKg = allNetKg / n;
                    r.grossKg = allGrossKg / n;
                });
                const assignedVols = containerTableBody.reduce((s: number, r: any) => s + r.volumes, 0);
                if (assignedVols !== allVolumes) containerTableBody[0].volumes += (allVolumes - assignedVols);
            }

            const formattedBody = containerTableBody.map((r: any) => [
                r.container,
                r.seal,
                r.volumes.toString(),
                r.netKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                r.grossKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            ]);

            // Add totals row
            const totalVolumes = items.reduce((sum: number, item: any) => sum + (item.volumes || 0), 0);
            const totalNetKg = items.reduce((sum: number, item: any) => sum + (item.netKg || (item.netLbs || 0) * 0.453592), 0);
            const totalGrossKg = items.reduce((sum: number, item: any) => sum + (item.grossKg || (item.grossLbs || 0) * 0.453592), 0);
            formattedBody.push([
                'TOTAL',
                '',
                totalVolumes.toString(),
                totalNetKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                totalGrossKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            ]);

            autoTable(doc, {
                startY: finalY,
                head: containerTableHead,
                body: formattedBody,
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
                grandTotalNetKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                grandTotalGrossKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
                const stampY = Math.min(lastPageHeight + 5, 255);
                doc.addImage(stampUrl, 'PNG', stampX, stampY, stampSize, stampSize);
            } catch (e) {
                console.warn('[PL PDF] Could not add stamp:', e);
            }
        }

        if (autoDownload) {
            saveWithPicker(doc, `PackingList_${inv.invoiceNumber || 'unknown'}.pdf`);
        }
        return doc;
    };

    // ========================================================================
    // RENDER STEP INDICATOR
    // ========================================================================
    const renderStepIndicator = () => {
        const steps = [
            { step: 'PROPOSAL' as WizardStep, label: '1. Proposal', icon: Sparkles },
            { step: 'UPLOAD_CONTRACT' as WizardStep, label: '2. Sales Contract', icon: Upload },
            { step: 'CREATE_PROFORMA' as WizardStep, label: '3. Proforma', icon: FileCheck },
            { step: 'UPLOAD_PL' as WizardStep, label: '4. Supplier PL', icon: Package },
            { step: 'CREATE_INVOICE' as WizardStep, label: '5. Commission Invoice', icon: FileText }
        ];
        const visualCurrent = getVisualStep(currentStep);
        const currentIdx = STEP_ORDER.indexOf(visualCurrent);

        return (
            <div className="flex items-center justify-center gap-2 mb-8">
                {steps.map((s, idx) => {
                    const isActive = visualCurrent === s.step;
                    const isPast = idx < currentIdx;
                    const Icon = s.icon;

                    return (
                        <React.Fragment key={s.step}>
                            {idx > 0 && (
                                <div className={`w-12 h-0.5 ${isPast || isActive ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                            )}
                            <button
                                onClick={() => goToStep(s.step)}
                                className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all ${isActive
                                    ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg'
                                    : isPast
                                        ? 'bg-emerald-100 text-emerald-700 cursor-pointer hover:bg-emerald-200'
                                        : 'bg-slate-100 text-slate-500 cursor-pointer hover:bg-slate-200'
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
    };

    // ========================================================================
    // STEP 1: UPLOAD CONTRACT (Sales Contract / Supplier Proforma)
    // ========================================================================
    const handleContractUpload = async (file: File) => {
        const client = getSupabaseClient();
        setContractFile(file);
        setContractProcessing(true);
        try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (event) => resolve(event.target?.result as string);
                reader.onerror = () => reject(new Error('Failed to read file'));
                reader.readAsDataURL(file);
            });
            const base64String = dataUrl.split(',')[1];
            const mimeType = file.type || 'application/pdf';

            const contractPrompt = `
Analyze this sales contract, proforma invoice, or supplier quotation document.
Extract the key commercial information into a structured JSON object.

RULES:
1. Return ONLY a valid JSON object. Do not add any commentary.
2. If a field is not found, return null for its value.
3. For line items, parse each product row into the "items" array.
4. For each item, extract the QUANTITY and the TOTAL AMOUNT (line total).
5. Do NOT extract unit price. The app will calculate it as: unitPrice = amount / quantity.
6. If only a total line amount is shown, use that as "amount".

KEYS:
{
    "contractNumber": "string (Sales Order #, Contract #, Proforma #, PO #)",
    "sellerName": "string",
    "buyerName": "string",
    "date": "string (YYYY-MM-DD)",
    "incoterm": "string (Extract the FULL INCOTERM including the location/port, e.g. 'CFR Pecem, Brasil')",
    "paymentTerms": "string (Extract the payment terms and TRANSLATE them to english, e.g. '50% ADVANCE PAYMENT')",
    "items": [
        {
            "description": "string (product name/description)",
            "quantity": number,
            "unit": "string (LBS, KGS, PCS, etc.)",
            "amount": number (total line amount for this item)
        }
    ]
}
`;

            const rawResult = await analyzeDocument(base64String, mimeType, contractPrompt);
            const cleanJson = rawResult.replace(/```json\s*|\s*```/g, '').replace(/```\s*|\s*```/g, '').trim();
            const firstBrace = cleanJson.indexOf('{');
            const lastBrace = cleanJson.lastIndexOf('}');
            const jsonStr = (firstBrace !== -1 && lastBrace !== -1) ? cleanJson.substring(firstBrace, lastBrace + 1) : cleanJson;
            const parsed = JSON.parse(jsonStr);

            // Populate proforma state from OCR (raw values first, fuzzy match overrides below)
            setPiNumber(parsed.contractNumber ? `PI-${parsed.contractNumber}` : `PI-${Date.now().toString().slice(-6)}`);
            setPiSeller(parsed.sellerName || '');
            setPiBuyer(parsed.buyerName || '');
            // Normalize Incoterm: extract the standard 3-letter code from the full string
            const knownIncoterms = ['EXW', 'FCA', 'CPT', 'CIP', 'DAT', 'DAP', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF'];
            const rawIncoterm = (parsed.incoterm || '').toUpperCase().trim();
            const matchedIncoterm = knownIncoterms.find(code => rawIncoterm.startsWith(code));
            setPiIncoterm(matchedIncoterm || parsed.incoterm || '');
            console.log('[OCR Incoterm]', parsed.incoterm, '→ normalized:', matchedIncoterm || parsed.incoterm);

            // Normalize Payment Terms: map common OCR phrases to standard dropdown values
            const knownPaymentTerms = ['NET 30', 'NET 60', 'NET 90', 'CIA', 'CAD', 'LC', 'TT', '50/50', '30/70'];
            const rawPayment = (parsed.paymentTerms || '').toUpperCase().trim();
            let normalizedPayment = parsed.paymentTerms || '';
            // Try direct match first
            const directMatch = knownPaymentTerms.find(t => rawPayment === t);
            if (directMatch) {
                normalizedPayment = directMatch;
            } else if (rawPayment.includes('50%') || rawPayment.includes('50/50')) {
                normalizedPayment = '50/50';
            } else if (rawPayment.includes('30%') && rawPayment.includes('70%') || rawPayment.includes('30/70')) {
                normalizedPayment = '30/70';
            } else if (rawPayment.includes('NET 30') || rawPayment.includes('NET30')) {
                normalizedPayment = 'NET 30';
            } else if (rawPayment.includes('NET 60') || rawPayment.includes('NET60')) {
                normalizedPayment = 'NET 60';
            } else if (rawPayment.includes('NET 90') || rawPayment.includes('NET90')) {
                normalizedPayment = 'NET 90';
            } else if (rawPayment.includes('CASH IN ADVANCE') || rawPayment.includes('CIA') || rawPayment.includes('ANTICIPAD')) {
                normalizedPayment = 'CIA';
            } else if (rawPayment.includes('CASH AGAINST') || rawPayment.includes('CAD') || rawPayment.includes('CONTRA DOCUMENT')) {
                normalizedPayment = 'CAD';
            } else if (rawPayment.includes('LETTER OF CREDIT') || rawPayment.includes('L/C')) {
                normalizedPayment = 'LC';
            } else if (rawPayment.includes('TELEGRAPHIC') || rawPayment.includes('WIRE TRANSFER')) {
                normalizedPayment = 'TT';
            }
            setPiPaymentTerms(normalizedPayment);
            console.log('[OCR Payment Terms]', parsed.paymentTerms, '→ normalized:', normalizedPayment);

            // Fuzzy match seller and buyer (helpers defined below loadMockContract)
            const ocrSellerName = parsed.sellerName || '';
            const matchedSeller = fuzzyMatch(ocrSellerName, suppliers);
            if (matchedSeller) {
                setPiSeller(matchedSeller.name);
                console.log('[OCR Seller Match]', ocrSellerName, '→', matchedSeller.name);
            }

            // Match buyer from OCR to customers table for POD and country
            const ocrBuyerName = parsed.buyerName || '';
            const matchedBuyerCustomer: any = fuzzyMatch(ocrBuyerName, customers);
            if (matchedBuyerCustomer) {
                setPiBuyer(matchedBuyerCustomer.name);
                // Normalize POD against ports table
                const rawPod = matchedBuyerCustomer.pod || '';
                const normalizedPort = ports.find((p: any) => {
                    const podUpper = rawPod.toUpperCase();
                    const nameMatch = podUpper.includes(p.name.toUpperCase());
                    const codeMatch = podUpper.includes(p.code.toUpperCase());
                    const portCodeMatch = p.portCode && podUpper.includes(p.portCode.toUpperCase());
                    return nameMatch || codeMatch || portCodeMatch;
                });
                if (normalizedPort) {
                    setPiPod(normalizedPort.code);
                    console.log('[OCR POD Normalized]', rawPod, '→', normalizedPort.code, `(${normalizedPort.name})`);
                } else {
                    setPiPod(rawPod);
                    console.log('[OCR POD] No port match for:', rawPod);
                }
                console.log('[OCR Buyer Match]', ocrBuyerName, '→', matchedBuyerCustomer.name, '| POD:', rawPod, '| Country:', matchedBuyerCustomer.country);
            }
            // Convert items to KGS and CALCULATE unit price = amount / qty
            const extractedItems = (parsed.items || []).map((item: any, idx: number) => {
                const rawQty = Number(item.quantity || 0);
                const rawUnit = (item.unit || 'LBS').toUpperCase();
                const rawAmount = Number(item.amount || 0);
                // Calculate unit price from total amount / quantity (app-calculated, not OCR'd)
                const rawUnitPrice = rawQty > 0 ? rawAmount / rawQty : 0;
                console.log(`[OCR Item ${idx}] ${item.description}: qty=${rawQty} ${rawUnit}, amount=${rawAmount}, calculated unitPrice=${rawUnitPrice.toFixed(4)}`);
                // Convert to KGS
                const qtyKgs = (rawUnit === 'LBS' || rawUnit === 'POUNDS') ? rawQty / 2.20462 : rawQty;
                const priceKg = qtyKgs > 0 ? rawAmount / qtyKgs : 0;
                return {
                    id: `pi_${Date.now()}_${idx}`,
                    description: item.description || '',
                    translatedDescription: '',
                    quantity: Math.round(qtyKgs),
                    unit: 'KGS',
                    unitPrice: priceKg,
                    amount: rawAmount
                };
            });
            setPiItems(extractedItems);
            const totalAmount = extractedItems.reduce((sum: number, it: any) => sum + it.amount, 0);
            setPiTotal(totalAmount);

            // Auto-translate descriptions to buyer's country language
            const buyerCountry = matchedBuyerCustomer?.country || '';
            console.log('[Translation] Using buyer country:', buyerCountry, 'from matched customer:', matchedBuyerCustomer?.name);
            if (extractedItems.length > 0) {
                const targetCountry = buyerCountry || 'United States';
                try {
                    setTranslatingInProgress(true);
                    const descs = extractedItems.map((it: any) => it.description);
                    const translated = await translateDescriptions(descs, targetCountry);
                    if (translated.length > 0) {
                        setPiItems(prev => prev.map((item, i) => ({
                            ...item,
                            translatedDescription: translated[i] || item.description
                        })));
                        console.log('[Translation] ✅ Translated', translated.length, 'items');
                    }
                } catch (err) { console.error('[Translation] ❌ Error:', err); }
                setTranslatingInProgress(false);
            }
            setContractOcrDone(true);
            setPiSaved(false);

            // Save the contract with the original document to Supabase
            const contractNum = parsed.contractNumber || `SC-${Date.now().toString().slice(-6)}`;

            // Match seller/buyer names against customers table
            const matchCustomer = (ocrName: string): { id: string | null; name: string } => {
                if (!ocrName) return { id: null, name: ocrName };
                const normalizedOcr = ocrName.toLowerCase().trim();
                // 1. Exact match
                let match = customers.find(c => c.name.toLowerCase().trim() === normalizedOcr);
                if (match) return { id: match.id, name: match.name };
                // 2. Name contains OCR name or vice versa
                match = customers.find(c =>
                    c.name.toLowerCase().includes(normalizedOcr) ||
                    normalizedOcr.includes(c.name.toLowerCase())
                );
                if (match) return { id: match.id, name: match.name };
                // 3. Partial word match (first 2+ words)
                const ocrWords = normalizedOcr.split(/\s+/).filter(w => w.length > 2);
                if (ocrWords.length > 0) {
                    match = customers.find(c => {
                        const cName = c.name.toLowerCase();
                        return ocrWords.filter(w => cName.includes(w)).length >= Math.min(2, ocrWords.length);
                    });
                    if (match) return { id: match.id, name: match.name };
                }
                // 4. Check nickname
                match = customers.find(c =>
                    c.nickname && c.nickname.toLowerCase().includes(normalizedOcr)
                );
                if (match) return { id: match.id, name: match.name };
                return { id: null, name: ocrName };
            };

            const sellerMatch = matchCustomer(parsed.sellerName || '');
            const buyerMatch = matchCustomer(parsed.buyerName || '');

            const newContractRow: any = {
                companyId: currentCompanyId,
                contractNumber: contractNum,
                seller: sellerMatch.name || 'Unknown',
                buyer: buyerMatch.name || 'Unknown',
                sellerId: sellerMatch.id,
                buyerId: buyerMatch.id,
                date: parsed.date || new Date().toLocaleDateString(),
                total: totalAmount,
                status: 'ACTIVE',
                incoterm: parsed.incoterm || '',
                paymentTerms: parsed.paymentTerms || '',
                pod: piPod || '',
                items: extractedItems,
                originalDocument: dataUrl,
                originalDocType: mimeType
            };

            const { data: insertedContract, error: insertError } = await client
                .from('commission_sales_contracts')
                .insert(newContractRow)
                .select('id')
                .single();

            const newContract = {
                id: insertedContract?.id || `SC-${Date.now()}`,
                contractNumber: contractNum,
                seller: sellerMatch.name || 'Unknown',
                buyer: buyerMatch.name || 'Unknown',
                date: parsed.date || new Date().toLocaleDateString(),
                total: totalAmount,
                status: 'ACTIVE',
                pod: piPod || '',
                items: extractedItems,
                originalDocUrl: dataUrl,
                originalDocType: mimeType
            };
            setSavedContracts(prev => [newContract, ...prev]);
            if (insertError) console.error('[Contract Save] Error:', insertError);
            else console.log('[Contract Save] Saved to DB with id:', insertedContract?.id, 'seller:', sellerMatch.name, `(${sellerMatch.id})`, 'buyer:', buyerMatch.name, `(${buyerMatch.id})`);

            // Auto-create Commission Order from saved contract
            if (onAddCommission) {
                const commissionItems = extractedItems.map((item: any, idx: number) => ({
                    id: `item-${Date.now()}-${idx}`,
                    productName: item.description || '',
                    quantity: item.quantity || 0,
                    unit: item.unit || 'LBS',
                    pricePerUnit: item.unitPrice || 0,
                    total: item.amount || 0,
                }));

                const commissionOrder = {
                    id: `CSO-${Date.now()}`,
                    companyId: currentCompanyId,
                    orderNumber: contractNum,
                    sellerName: sellerMatch.name || 'Unknown',
                    customerName: buyerMatch.name || 'Unknown',
                    status: 'DRAFT',
                    incoterm: parsed.incoterm || '',
                    paymentTerms: parsed.paymentTerms || '',
                    pod: '',
                    deliveryDate: parsed.date || '',
                    items: commissionItems,
                    orderTotal: totalAmount,
                    commissionRate: 0,
                    commissionType: 'PERCENT',
                    commissionAmount: 0,
                    createdAt: new Date().toISOString(),
                };

                try {
                    onAddCommission(commissionOrder);
                    console.log('[Contract Save] Commission order created:', contractNum);
                } catch (commErr) {
                    console.error('[Contract Save] Failed to create commission order:', commErr);
                }
            }

            // Auto-advance to proforma list step
            setCurrentStep('CREATE_PROFORMA');
            setProformaViewMode('EDIT');
        } catch (err) {
            console.error('[Contract OCR] Error:', err);
            alert('Error analyzing document. Please try again.');
        } finally {
            setContractProcessing(false);
        }
    };

    // --- Fuzzy matching helpers (used by both OCR and saved contract loading) ---
    const normalizeName = (name: string) => name
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents: ã→a, ç→c, etc.
        .toLowerCase()
        .replace(/[.,;:'"()]/g, ' ')  // punctuation to spaces
        .replace(/\b(ltda|ltd|llc|inc|corp|s\.?a\.?|s\.?a\.?s|de c\.?v\.?|cia|gmbh|plc|co|company|group)\b/gi, '') // remove suffixes
        .replace(/\s+/g, ' ').trim();

    const fuzzyMatch = (ocrName: string, candidates: any[]) => {
        const norm = normalizeName(ocrName);
        if (!norm) return null;
        // 1. Exact normalized match
        let match = candidates.find(c => normalizeName(c.name) === norm);
        if (match) return match;
        // 2. One contains the other
        match = candidates.find(c => {
            const cn = normalizeName(c.name);
            return cn.includes(norm) || norm.includes(cn);
        });
        if (match) return match;
        // 3. Word overlap scoring — pick best
        const ocrWords = norm.split(/\s+/).filter(w => w.length > 1);
        let bestScore = 0, bestMatch: any = null;
        for (const c of candidates) {
            const cWords = normalizeName(c.name).split(/\s+/).filter((w: string) => w.length > 1);
            const overlap = ocrWords.filter(w => cWords.some((cw: string) => cw.includes(w) || w.includes(cw))).length;
            const score = overlap / Math.max(ocrWords.length, 1);
            if (score > bestScore && score >= 0.5) {
                bestScore = score;
                bestMatch = c;
            }
        }
        return bestMatch;
    };

    const loadMockContract = async (contract: typeof savedContracts[0]) => {
        // Navigate to proforma step IMMEDIATELY (before async operations)
        setCurrentStep('CREATE_PROFORMA');
        setProformaViewMode('EDIT');
        // Check if a saved proforma already exists for this contract
        const existingPI = savedProformas.find(p => p.pi_number === `PI-${contract.contractNumber}`);
        setEditingProformaId(existingPI?.id || null);

        setPiNumber(`PI-${contract.contractNumber}`);
        setPiIncoterm('FOB');
        setPiPaymentTerms('NET 30');
        // Recalculate unit prices from amount/qty for each item
        const itemsWithCalculatedPrices = contract.items.map(it => {
            const qty = Number(it.quantity || 0);
            const amt = Number(it.amount || 0);
            const calculatedPrice = qty > 0 ? amt / qty : Number(it.unitPrice || 0);
            return { ...it, unitPrice: calculatedPrice, amount: amt };
        });
        setPiItems(itemsWithCalculatedPrices);
        setPiTotal(contract.total);
        setContractOcrDone(true);
        setPiSaved(false);

        // Fuzzy match seller against suppliers table
        const sellerMatch = fuzzyMatch(contract.seller, suppliers);
        setPiSeller(sellerMatch ? sellerMatch.name : contract.seller);
        console.log('[Load Contract Seller]', contract.seller, '→', sellerMatch?.name || 'NO MATCH');

        // Fuzzy match buyer against customers table
        const buyerMatch = fuzzyMatch(contract.buyer, customers);
        setPiBuyer(buyerMatch ? buyerMatch.name : contract.buyer);
        setPiPod(buyerMatch?.pod || '');
        console.log('[Load Contract Buyer]', contract.buyer, '→', buyerMatch?.name || 'NO MATCH', '| POD:', buyerMatch?.pod, '| Country:', buyerMatch?.country);

        // Auto-translate descriptions using buyer's country
        const buyerCountry = buyerMatch?.country || '';
        const items = contract.items;
        const hasExistingTranslations = items.some((it: any) => it.translatedDescription && it.translatedDescription.trim());
        if (items.length > 0 && !hasExistingTranslations) {
            const targetCountry = buyerCountry || 'United States';
            try {
                setTranslatingInProgress(true);
                const descs = items.map((it: any) => it.description);
                const translated = await translateDescriptions(descs, targetCountry);
                if (translated.length > 0) {
                    setPiItems(prev => prev.map((item, i) => ({
                        ...item,
                        translatedDescription: translated[i] || item.description
                    })));
                    console.log('[Load Contract Translation] ✅ Translated', translated.length, 'items to', targetCountry);
                }
            } catch (err) {
                console.error('[Load Contract Translation] ❌ Error:', err);
            }
            setTranslatingInProgress(false);
        } else if (hasExistingTranslations) {
            console.log('[Load Contract Translation] Using existing translations from saved items');
        }
    };


    // ========================================================================
    // PROFORMA ACTIONS: SAVE, PDF, EMAIL
    // ========================================================================

    const handleSaveProforma = async () => {
        const client = getSupabaseClient();
        const proformaId = editingProformaId || `CPI_${Date.now()}`;
        const proformaData = {
            id: proformaId,
            company_id: currentCompanyId,
            pi_number: piNumber,
            pi_date: piDate,
            seller: piSeller,
            buyer: piBuyer,
            incoterm: piIncoterm,
            payment_terms: piPaymentTerms,
            pod: piPod,
            items: piItems,
            total: piTotal,
            contract_id: piNumber.replace('PI-', ''),
            status: 'DRAFT'
        };
        try {
            const { error } = await client.from('commissions_proformas').upsert(proformaData);
            if (error) {
                // Table might not exist — try creating it
                if (error.code === '42P01' || error.message?.includes('commissions_proformas')) {
                    console.warn('[Save PI] Table missing, attempting auto-create...');
                    // Table creation needs to be done via Supabase Dashboard
                    alert('⚠️ Table "commissions_proformas" does not exist yet. Please run the migration in Supabase Dashboard.');
                    return;
                }
                throw error;
            }
            setPiSaved(true);
            setEditingProformaId(proformaId);

            // Also sync POD to the saved contract record
            try {
                const contractNum = piNumber.replace('PI-', '');
                await client.from('commission_sales_contracts')
                    .update({ pod: piPod })
                    .eq('contractNumber', contractNum)
                    .eq('companyId', currentCompanyId);
            } catch (_) { /* ignore if contract not found */ }

            // Sync POD to the Commission Order (CSO-)
            if (piPod) {
                try {
                    const contractNum = piNumber.replace('PI-', '');
                    const { data: csoData } = await client
                        .from('commission_sales_orders')
                        .select('id')
                        .eq('orderNumber', contractNum);

                    if (csoData && csoData.length > 0) {
                        for (const cso of csoData) {
                            await client
                                .from('commission_sales_orders')
                                .update({ pod: piPod, incoterm: piIncoterm })
                                .eq('id', cso.id);
                        }
                        console.log(`[Save PI] Synced POD/Incoterm to ${csoData.length} CSO record(s)`);
                    }
                } catch (err) {
                    console.error('[Save PI] Failed to sync POD to commission order:', err);
                }
            }

            // Refresh saved proformas list
            setSavedProformas(prev => {
                const exists = prev.some(p => p.id === proformaData.id);
                if (exists) return prev.map(p => p.id === proformaData.id ? { ...proformaData } : p);
                return [{ ...proformaData }, ...prev];
            });

            // Upsert commission products into products table
            try {
                for (const item of piItems) {
                    const rawName = (item.description || '').trim();
                    if (!rawName) continue;

                    // Normalize OCR variations: remove " - " → " ", remove parentheses, collapse spaces
                    const productName = rawName
                        .replace(/\s*-\s*/g, ' ')
                        .replace(/[()]/g, '')
                        .replace(/\s+/g, ' ')
                        .trim();

                    // Extract product code (first word, e.g. CTA0004) for stable key
                    const productCode = productName.split(' ')[0] || '';
                    const stableKey = `${currentCompanyId}_comm_${productCode.toLowerCase()}_${productName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')}`;

                    const productRecord: any = {
                        id: stableKey,
                        companyId: currentCompanyId,
                        name: productName,
                        supplierProductName: rawName,
                        supplier: piSeller || '',
                        category: '',
                        grade: '',
                        price: Number(item.unitPrice) || 0,
                        stockStatus: 'Available',
                        specs: {},
                        productType: 'commission'
                    };

                    const { error: prodErr } = await client
                        .from('products')
                        .upsert(productRecord, { onConflict: 'id' });

                    if (prodErr) {
                        console.warn('[Save PI] Could not upsert commission product:', productName, prodErr.message);
                    } else {
                        console.log('[Save PI] Upserted commission product:', productName);
                    }
                }
            } catch (prodErr) {
                console.error('[Save PI] Error upserting commission products:', prodErr);
            }

            alert(`✅ Proforma ${piNumber} saved successfully!`);
            console.log('[Save PI] Saved:', proformaData.id);
        } catch (err: any) {
            console.error('[Save PI] Error:', err);
            alert(`Error saving proforma: ${err.message || 'Unknown error'}`);
        }
    };

    const generateCommissionProformaPDF = (priceAdjustment: 'none' | '50' | 'br' = 'none'): jsPDF => {
        const doc = new jsPDF();
        const accentColor = '#2E7D32';
        const darkGray = '#333333';
        const lightGray = '#888888';
        const company = availableCompanies.find(c => c.id === currentCompanyId);
        const companyName = company?.name || 'EC4 ENTERPRISES';
        const rightX = 130;

        // --- Logo ---
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
                const logoX = 210 - 14 - width;
                doc.addImage(logoUrl, format, logoX, 10, width, height);
            } catch (e) {
                console.error('[Proforma PDF] Logo load failed:', e);
            }
        }

        // --- Title ---
        let yPos = 20;
        doc.setFontSize(16);
        doc.setTextColor(accentColor);
        doc.setFont('helvetica', 'bold');
        doc.text("PROFORMA INVOICE", 14, yPos);

        // --- SHIPPER (Seller) ---
        yPos += 12;
        doc.setFontSize(8);
        doc.setTextColor(lightGray);
        doc.text("SHIPPER", 14, yPos);
        yPos += 5;
        doc.setFontSize(9);
        doc.setTextColor(darkGray);
        doc.setFont('helvetica', 'bold');
        doc.text(piSeller || 'N/A', 14, yPos);
        yPos += 5;
        doc.setFont('helvetica', 'normal');

        // Look up seller from suppliers list
        const sellerSupplier = suppliers.find((s: any) => s.name === piSeller);
        if (sellerSupplier) {
            const addr = sellerSupplier.address || sellerSupplier.location || '';
            if (addr) {
                const addrLines = doc.splitTextToSize(addr, 100);
                doc.text(addrLines, 14, yPos);
                yPos += addrLines.length * 4;
            }
            if (sellerSupplier.taxId) {
                doc.text(`TAX ID: ${sellerSupplier.taxId}`, 14, yPos);
                yPos += 4;
            }
            const cityCountry = [sellerSupplier.city, sellerSupplier.state, sellerSupplier.country].filter(Boolean).join(', ');
            if (cityCountry) { doc.text(cityCountry, 14, yPos); yPos += 4; }
            if (sellerSupplier.email) { doc.text(sellerSupplier.email, 14, yPos); yPos += 4; }
        }

        yPos += 3;

        // --- CONSIGNEE (Buyer) ---
        const consigneeStartY = yPos;
        doc.setFontSize(8);
        doc.setTextColor(lightGray);
        doc.text("CONSIGNEE", 14, yPos);
        yPos += 5;
        doc.setFontSize(9);
        doc.setTextColor(darkGray);
        doc.setFont('helvetica', 'bold');
        doc.text(piBuyer || 'N/A', 14, yPos);
        yPos += 5;
        doc.setFont('helvetica', 'normal');

        const buyerCustomer = customers.find(c => c.name === piBuyer);
        if (buyerCustomer) {
            const addr = buyerCustomer.address || buyerCustomer.location || '';
            if (addr) {
                const addrLines = doc.splitTextToSize(addr, 100);
                doc.text(addrLines, 14, yPos);
                yPos += addrLines.length * 4;
            }
            if (buyerCustomer.taxId) {
                doc.text(`TAX ID: ${buyerCustomer.taxId}`, 14, yPos);
                yPos += 4;
            }
            const cityCountry = [buyerCustomer.city, buyerCustomer.state, buyerCustomer.country].filter(Boolean).join(', ');
            if (cityCountry) { doc.text(cityCountry, 14, yPos); yPos += 4; }
        }

        const consigneeBottomY = yPos + 5;

        // Right: PI Number & Date
        yPos = consigneeStartY;
        doc.setFontSize(8);
        doc.setTextColor(lightGray);
        doc.text("No :", rightX, yPos);
        doc.setFontSize(9);
        doc.setTextColor(darkGray);
        doc.text(piNumber, rightX + 15, yPos);
        yPos += 10;
        doc.setFontSize(8);
        doc.setTextColor(lightGray);
        doc.text("DATE", rightX, yPos);
        doc.setFontSize(9);
        doc.setTextColor(darkGray);
        doc.text(new Date(piDate).toLocaleDateString(), rightX + 15, yPos);

        // --- Terms, Incoterm, POD ---
        let sectionBottomY = Math.max(consigneeBottomY, yPos + 15);
        yPos = sectionBottomY;

        doc.setFontSize(8);
        doc.setTextColor(lightGray);
        doc.text("TERMS", 14, yPos);
        doc.setFontSize(9);
        doc.setTextColor(darkGray);
        // Wrap long payment terms to max width 75
        const termsLines = doc.splitTextToSize(piPaymentTerms || 'Prepaid', 75);
        doc.text(termsLines, 14, yPos + 5);

        doc.setFontSize(8);
        doc.setTextColor(lightGray);
        doc.text("INCOTERM", 95, yPos);
        doc.setFontSize(9);
        doc.setTextColor(darkGray);
        doc.text(`${piIncoterm || ''} ${piPod || ''}`.trim(), 95, yPos + 5);

        if (piPod) {
            doc.setFontSize(8);
            doc.setTextColor(lightGray);
            doc.text("PORT OF DESTINATION", 140, yPos);
            doc.setFontSize(9);
            doc.setTextColor(darkGray);
            doc.text(piPod, 140, yPos + 5);
        }

        // --- Items Table ---
        yPos += 15;
        const tableHead = [['DESCRIPTION', 'TRANSLATED', 'QTY (KGS)', 'US$/KG', 'AMOUNT US$']];
        // Apply price adjustment if selected
        const adjustedItems = piItems.map(item => {
            const qty = Number(item.quantity) || 0;
            let adjPrice = item.unitPrice;
            if (priceAdjustment === '50') {
                adjPrice = item.unitPrice * 0.5;
            } else if (priceAdjustment === 'br') {
                adjPrice = 0.28; // Fixed $0.28/KG for BR
            }
            const adjAmount = Math.round(qty * adjPrice * 100) / 100;
            return { ...item, unitPrice: adjPrice, amount: adjAmount };
        });
        const tableBody = adjustedItems.map(item => [
            item.description,
            item.translatedDescription || '',
            Number(item.quantity).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            item.unitPrice.toFixed(2),
            item.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        ]);
        const adjustedTotal = adjustedItems.reduce((s, i) => s + i.amount, 0);

        autoTable(doc, {
            startY: yPos,
            head: tableHead,
            body: tableBody,
            theme: 'plain',
            styles: { fontSize: 8, textColor: darkGray, cellPadding: 2.5, valign: 'top' },
            headStyles: { fillColor: '#C8E6C9', textColor: accentColor, fontStyle: 'bold', halign: 'left' },
            columnStyles: {
                0: { cellWidth: 45 },
                1: { cellWidth: 45 },
                2: { halign: 'right', cellWidth: 25 },
                3: { halign: 'right', cellWidth: 25 },
                4: { halign: 'right', cellWidth: 30 }
            },
        });

        // --- Totals ---
        let finalY = (doc as any).lastAutoTable.finalY + 5;
        const totalQty = adjustedItems.reduce((s, i) => s + Number(i.quantity), 0);
        const pdfTotal = priceAdjustment !== 'none' ? adjustedTotal : piTotal;
        const avgPrice = totalQty > 0 ? pdfTotal / totalQty : 0;

        doc.setFontSize(8);
        doc.setTextColor(lightGray);
        doc.text(`Total Qty: ${totalQty.toLocaleString(undefined, { minimumFractionDigits: 1 })} KGS`, 14, finalY + 4);
        doc.text(`Avg Price: $${avgPrice.toFixed(4)}/KG`, 14, finalY + 8);

        const labelX = 140;
        const valueX = 195;
        let totalY = finalY + 4;

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(lightGray);
        doc.text("SUBTOTAL", labelX, totalY);
        doc.setFontSize(9);
        doc.setTextColor(darkGray);
        doc.text(pdfTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), valueX, totalY, { align: 'right' });

        totalY += 6;
        doc.setFontSize(8);
        doc.setTextColor(lightGray);
        doc.text("TAX", labelX, totalY);
        doc.setFontSize(9);
        doc.setTextColor(darkGray);
        doc.text("0.00", valueX, totalY, { align: 'right' });

        totalY += 8;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(darkGray);
        doc.text("TOTAL", labelX, totalY);
        doc.text(`$${pdfTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, valueX, totalY, { align: 'right' });

        // --- Signatures ---
        let sigY = finalY + 30;
        if (sigY > 250) { doc.addPage(); sigY = 20; }
        doc.setFontSize(9);
        doc.setTextColor(lightGray);
        doc.setFont('helvetica', 'bold');
        doc.text("Accepted By", 14, sigY);
        doc.setDrawColor(200);
        doc.line(14, sigY + 12, 90, sigY + 12);
        doc.text("Accepted Date", 14, sigY + 20);
        doc.line(14, sigY + 32, 60, sigY + 32);

        // --- Bank Info ---
        const bankY = sigY + 45;
        if (bankY > 260) doc.addPage();
        doc.setFontSize(8);
        doc.setTextColor(lightGray);
        doc.text("PAY TO :", 14, bankY);
        doc.setFontSize(9);
        doc.setTextColor(darkGray);
        doc.setFont('helvetica', 'bold');
        let currentBankY = bankY + 5;

        // Use the supplier's bank data if available
        if (sellerSupplier && sellerSupplier.bankData) {
            doc.setFont('helvetica', 'normal');
            const bankLines = doc.splitTextToSize(sellerSupplier.bankData, 100);
            doc.text(bankLines, 14, currentBankY);
            currentBankY += bankLines.length * 4;
        } else {
            // Fallback to internal company bank account
            const selectedBank = banks.length > 0 ? banks[0] : null;
            if (selectedBank) {
                doc.text(companyName, 14, currentBankY); currentBankY += 5;
                doc.text(selectedBank.bankName || '', 14, currentBankY); currentBankY += 5;
                if (selectedBank.swiftCode) { doc.text(`SWIFT : ${selectedBank.swiftCode}`, 14, currentBankY); currentBankY += 5; }
                if (selectedBank.routingNumber) { doc.text(`ROUTING : ${selectedBank.routingNumber}`, 14, currentBankY); currentBankY += 5; }
                if (selectedBank.accountNumber) { doc.text(`ACCOUNT # : ${selectedBank.accountNumber}`, 14, currentBankY); }
            }
        }

        // --- Footer ---
        const pageHeight = doc.internal.pageSize.height;
        doc.setFontSize(7);
        doc.setTextColor(lightGray);
        doc.setFont('helvetica', 'normal');
        doc.text("1. QUANTITY CAN INCREASE OR DECREASE IN +/- 5%", 14, pageHeight - 10);
        doc.text("Page 1 of 1", 180, pageHeight - 10);

        return doc;
    };

    const handleEmailProforma = async () => {
        if (piItems.length === 0) return;

        // Find buyer's email
        const buyerCustomer = customers.find(c => c.name === piBuyer);
        const recipientEmail = buyerCustomer?.email || '';

        try {
            // Generate PDF
            const doc = generateCommissionProformaPDF();
            const pdfBlob = doc.output('blob');
            const pdfUrl = URL.createObjectURL(pdfBlob);

            // Show PDF preview first so user can view it
            setPreviewUrl(pdfUrl);
            setPreviewBlob(pdfBlob);
            setPreviewTitle(`Proforma Invoice - ${piNumber}`);
            setPreviewFileName(`Proforma_${piNumber}.pdf`);

            // Convert to base64 for email attachment
            const arrayBuffer = await pdfBlob.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            const base64 = btoa(binary);

            // Get company name
            const company = availableCompanies.find(c => c.id === currentCompanyId);
            const companyName = company?.name || 'EC4 Enterprises';

            const emailBody = `Dear ${buyerCustomer?.contactPerson || 'Customer'},

Please find attached the Proforma Invoice for the following order:

PI Number: ${piNumber}
Date: ${piDate}
Seller: ${piSeller}
Incoterm: ${piIncoterm || 'FOB'} ${piPod || ''}
Payment Terms: ${piPaymentTerms || 'Prepaid'}
Total: $${piTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}

Please review and confirm at your earliest convenience.

Best regards,
${companyName}`;

            // Store email draft — user clicks "Email PDF" in preview modal to open it
            setPendingProformaEmailDraft({
                to: recipientEmail,
                cc: '',
                subject: `Proforma Invoice ${piNumber} - ${piBuyer}`,
                htmlBody: emailBody,
                attachments: [{
                    name: `Proforma_${piNumber}.pdf`,
                    contentBytes: base64,
                    contentType: 'application/pdf'
                }]
            });
            console.log('[Email PI] PDF preview opened. Email draft ready — user clicks Email PDF to send. To:', recipientEmail);

        } catch (err: any) {
            console.error('[Email PI] Error:', err);
            alert(`Error preparing proforma email: ${err.message || 'Unknown error'}`);
        }
    };

    // ========================================================================
    // STEP 0: PROPOSAL
    // ========================================================================
    const handleProposalFileSelect = async (file: File) => {
        setProposalFile(file);
        setProposalError(null);
        setProposalProcessing(true);
        try {
            // ── XLSX: parse locally, never send to Gemini ──
            if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
                const data = await file.arrayBuffer();
                const workbook = XLSX.read(data, { type: 'array' });
                let items: typeof proposalItems = [];
                for (const sheetName of workbook.SheetNames) {
                    const sheet = workbook.Sheets[sheetName];
                    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                    let headerRowIndex = -1;
                    for (let i = 0; i < Math.min(10, rows.length); i++) {
                        const row = rows[i];
                        if (!row) continue;
                        const rowStr = row.join(' ').toLowerCase();
                        if (rowStr.includes('product') || rowStr.includes('item') || rowStr.includes('description') || rowStr.includes('color')) {
                            headerRowIndex = i; break;
                        }
                    }
                    const startRow = headerRowIndex >= 0 ? headerRowIndex + 1 : 1;
                    for (let i = startRow; i < rows.length; i++) {
                        const row = rows[i];
                        if (!row || row.length < 2) continue;
                        const desc = String(row[0] || row[1] || '').trim();
                        if (!desc || desc.length < 2) continue;
                        let qty = 0, unitPrice = 0, amount = 0;
                        for (let j = 1; j < row.length; j++) {
                            const val = parseFloat(String(row[j]));
                            if (!isNaN(val) && val > 0) {
                                if (qty === 0) qty = val;
                                else if (unitPrice === 0) unitPrice = val;
                                else if (amount === 0) amount = val;
                            }
                        }
                        // If 3 numbers found treat as qty/unitPrice/amount; otherwise calculate
                        if (amount === 0) amount = qty * unitPrice;
                        if (qty > 0) {
                            items.push({ id: `prop-${Date.now()}-${i}`, description: desc, translatedDescription: '', quantity: qty, unit: 'KGS', unitPrice, markup: 0, amount });
                        }
                    }
                }
                if (items.length === 0) throw new Error('No items found in the Excel file.');
                setProposalItems(items);
                setProposalDone(true);
                setProposalProcessing(false);
                return;
            }

            // ── PDF / Image: use Gemini OCR ──
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (event) => resolve(event.target?.result as string);
                reader.onerror = () => reject(new Error('Failed to read file'));
                reader.readAsDataURL(file);
            });
            const base64String = dataUrl.split(',')[1];
            const mimeType = file.type || 'application/pdf';

            const proposalPrompt = `
Analyze this sales contract, proforma invoice, supplier quotation, or purchase order document.
Extract the key commercial information into a structured JSON object.

RULES:
1. Return ONLY a valid JSON object. Do not add any commentary.
2. If a field is not found, return null for its value.
3. For line items, parse each product row into the "items" array.
4. For each item, extract the QUANTITY and the TOTAL AMOUNT (line total).
5. Do NOT extract unit price. The app will calculate it as: unitPrice = amount / quantity.
6. If only a total line amount is shown, use that as "amount".

KEYS:
{
    "contractNumber": "string (Sales Order #, Contract #, Proforma #, PO #)",
    "sellerName": "string",
    "buyerName": "string",
    "date": "string (YYYY-MM-DD)",
    "incoterm": "string (Extract the FULL INCOTERM including the location/port, e.g. 'CFR Pecem, Brasil')",
    "paymentTerms": "string (Extract the payment terms and TRANSLATE them to english, e.g. '50% ADVANCE PAYMENT')",
    "items": [
        {
            "description": "string (product name/description)",
            "quantity": number,
            "unit": "string (LBS, KGS, PCS, etc.)",
            "amount": number
        }
    ]
}
`;

            const rawResult = await analyzeDocument(base64String, mimeType, proposalPrompt);
            const cleanJson = rawResult.replace(/```json\s*|\s*```/g, '').replace(/```\s*|\s*```/g, '').trim();
            const firstBrace = cleanJson.indexOf('{');
            const lastBrace = cleanJson.lastIndexOf('}');
            const jsonStr = (firstBrace !== -1 && lastBrace !== -1) ? cleanJson.substring(firstBrace, lastBrace + 1) : cleanJson;
            const parsed = JSON.parse(jsonStr);

            // Populate header fields
            // Set proposal number and date from OCR
            if (parsed.contractNumber) setProposalNumber(parsed.contractNumber);
            if (parsed.date) setProposalDate(parsed.date);

            // Normalize Incoterm
            const knownIncoterms = ['EXW', 'FCA', 'CPT', 'CIP', 'DAT', 'DAP', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF'];
            const rawIncoterm = (parsed.incoterm || '').toUpperCase().trim();
            const matchedIncoterm = knownIncoterms.find(code => rawIncoterm.startsWith(code));
            setProposalIncoterm(matchedIncoterm || parsed.incoterm || 'FOB');

            // Normalize Payment Terms
            const knownPaymentTerms = ['NET 30', 'NET 60', 'NET 90', 'CIA', 'CAD', 'LC', 'TT', '50/50', '30/70'];
            const rawPayment = (parsed.paymentTerms || '').toUpperCase().trim();
            let normalizedPayment = parsed.paymentTerms || '';
            const directMatch = knownPaymentTerms.find(t => rawPayment === t);
            if (directMatch) normalizedPayment = directMatch;
            else if (rawPayment.includes('50%') || rawPayment.includes('50/50')) normalizedPayment = '50/50';
            else if ((rawPayment.includes('30%') && rawPayment.includes('70%')) || rawPayment.includes('30/70')) normalizedPayment = '30/70';
            else if (rawPayment.includes('NET 30') || rawPayment.includes('NET30')) normalizedPayment = 'NET 30';
            else if (rawPayment.includes('NET 60') || rawPayment.includes('NET60')) normalizedPayment = 'NET 60';
            else if (rawPayment.includes('NET 90') || rawPayment.includes('NET90')) normalizedPayment = 'NET 90';
            else if (rawPayment.includes('CASH IN ADVANCE') || rawPayment.includes('CIA') || rawPayment.includes('ANTICIPAD')) normalizedPayment = 'CIA';
            else if (rawPayment.includes('CASH AGAINST') || rawPayment.includes('CAD')) normalizedPayment = 'CAD';
            else if (rawPayment.includes('LETTER OF CREDIT') || rawPayment.includes('L/C')) normalizedPayment = 'LC';
            else if (rawPayment.includes('TELEGRAPHIC') || rawPayment.includes('WIRE TRANSFER')) normalizedPayment = 'TT';
            setProposalPaymentTerms(normalizedPayment);

            // Fuzzy match seller → suppliers
            const ocrSellerName = parsed.sellerName || '';
            const matchedSeller = fuzzyMatch(ocrSellerName, suppliers);
            if (matchedSeller) setProposalSeller(matchedSeller.name);
            else if (ocrSellerName) setProposalSeller(ocrSellerName);

            // Fuzzy match buyer → customers
            const ocrBuyerName = parsed.buyerName || '';
            const matchedBuyer = fuzzyMatch(ocrBuyerName, customers);
            if (matchedBuyer) setProposalBuyer(matchedBuyer.name);
            else if (ocrBuyerName) setProposalBuyer(ocrBuyerName);

            // Convert items to KGS, calculate unitPrice = amount / qty
            const extractedItems = (parsed.items || []).map((item: any, idx: number) => {
                const rawQty = Number(item.quantity || 0);
                const rawUnit = (item.unit || 'LBS').toUpperCase();
                const rawAmount = Number(item.amount || 0);
                const qtyKgs = (rawUnit === 'LBS' || rawUnit === 'POUNDS') ? rawQty / 2.20462 : rawQty;
                const priceKg = qtyKgs > 0 ? rawAmount / qtyKgs : 0;
                return {
                    id: `prop-${Date.now()}-${idx}`,
                    description: item.description || '',
                    translatedDescription: '',
                    quantity: Math.round(qtyKgs),
                    unit: 'KGS',
                    unitPrice: priceKg,
                    markup: 0,
                    amount: rawAmount
                };
            });

            if (extractedItems.length === 0) throw new Error('No items extracted from the file.');
            setProposalItems(extractedItems);
            setProposalDone(true);

            // Auto-translate descriptions based on buyer country
            const buyerForTranslation = matchedBuyer as any;
            const buyerCountry = buyerForTranslation?.country || '';
            if (extractedItems.length > 0) {
                try {
                    setTranslatingInProgress(true);
                    const descs = extractedItems.map((it: any) => it.description);
                    const translated = await translateDescriptions(descs, buyerCountry || 'United States');
                    if (translated.length > 0) {
                        setProposalItems(prev => prev.map((item, i) => ({
                            ...item,
                            translatedDescription: translated[i] || item.description
                        })));
                    }
                } catch (err) { console.error('[Proposal Translation] Error:', err); }
                setTranslatingInProgress(false);
            }
        } catch (err: any) {
            setProposalError(err.message || 'Failed to process file');
        } finally {
            setProposalProcessing(false);
        }
    };


    const updateProposalItem = (id: string, field: string, value: any) => {
        setProposalItems(prev => prev.map(item => {
            if (item.id !== id) return item;
            const updated = { ...item, [field]: value };
            if (field === 'description') updated.translatedDescription = '';
            if (['quantity', 'unitPrice', 'markup'].includes(field)) updated.amount = updated.quantity * (updated.unitPrice + (updated.markup || 0));
            return updated;
        }));
    };

    const proposalTotal = proposalItems.reduce((sum, i) => sum + i.amount, 0);

    const saveProposal = async () => {
        if (proposalItems.length === 0) return;
        setProposalSaving(true);
        const client = getSupabaseClient();
        const propNum = proposalNumber || `PROP-${Date.now().toString().slice(-6)}`;
        if (!proposalNumber) setProposalNumber(propNum);
        const row = {
            companyId: currentCompanyId,
            proposalNumber: propNum,
            seller: proposalSeller,
            buyer: proposalBuyer,
            date: proposalDate,
            incoterm: proposalIncoterm,
            paymentTerms: proposalPaymentTerms,
            notes: proposalNotes,
            total: proposalTotal,
            status: 'DRAFT',
            items: proposalItems,
        };
        try {
            if (editingProposalId) {
                await client.from('commission_proposals').update(row).eq('id', editingProposalId);
                setSavedProposals(prev => prev.map(p => p.id === editingProposalId ? { ...p, ...row, id: editingProposalId } : p));
            } else {
                const { data, error } = await client.from('commission_proposals').insert(row).select('id').single();
                if (!error && data) {
                    setSavedProposals(prev => [{ ...row, id: data.id }, ...prev]);
                    setEditingProposalId(data.id);
                }
            }
        } catch (err) { console.error('[saveProposal]', err); }
        setProposalSaving(false);
    };

    const deleteProposal = async (id: string) => {
        if (!window.confirm('Delete this proposal?')) return;
        setSavedProposals(prev => prev.filter(p => p.id !== id));
        if (editingProposalId === id) { setEditingProposalId(null); }
        try {
            const client = getSupabaseClient();
            await client.from('commission_proposals').delete().eq('id', id);
        } catch (err) { console.error('[deleteProposal]', err); }
    };

    const loadProposal = (p: any) => {
        setProposalSeller(p.seller || '');
        setProposalBuyer(p.buyer || '');
        setProposalIncoterm(p.incoterm || 'FOB');
        setProposalPaymentTerms(p.paymentTerms || '');
        setProposalNotes(p.notes || '');
        setProposalNumber(p.proposalNumber || '');
        setProposalDate(p.date || new Date().toISOString().split('T')[0]);
        setProposalItems(p.items || []);
        setProposalDone(true);
        setEditingProposalId(p.id);
    };

    const emailProposal = async (p: any) => {
        const buyerObj = customers.find((c: any) => c.name === p.buyer);
        const toEmail = buyerObj?.email || '';
        if (!toEmail) { alert('No email found for this buyer.'); return; }
        const selectedItems = (p.items || []).filter((it: any) => (p._selectedItemIds || []).includes(it.id || it.description));
        if (!selectedItems.length) { alert('Select at least one product.'); return; }
        // Open modal immediately with generating state
        setPrepDownloading(true);
        setPreviewGenerating(true);
        setPreviewTitle(`Commercial Proposal - ${p.proposalNumber}`);
        setPreviewFileName(`Proposal_${p.proposalNumber || 'Draft'}.html`);
        setPreviewUrl(null);
        setPreviewBlob(null);
        setPreviewDownloadFn(null);
        try {
            const buyerName = (p.buyer || '').toLowerCase().trim();
            const matchedBuyerCust = (customers as any[]).find((c: any) =>
                (c.name || '').toLowerCase().includes(buyerName) ||
                buyerName.includes((c.name || '').toLowerCase().trim())
            ) as any;
            const country = matchedBuyerCust?.country || 'Brazil';
            const countryLocaleMap: Record<string, string> = { 'Brazil': 'pt-BR', 'Portugal': 'pt-PT', 'Mexico': 'es-MX', 'Spain': 'es-ES', 'Colombia': 'es-CO', 'Argentina': 'es-AR', 'Chile': 'es-CL', 'Honduras': 'es-HN', 'Peru': 'es-PE', 'China': 'zh-CN', 'France': 'fr-FR', 'Germany': 'de-DE', 'Italy': 'it-IT', 'Japan': 'ja-JP', 'South Korea': 'ko-KR', 'Turkey': 'tr-TR', 'India': 'hi-IN', 'United States': 'en-US', 'USA': 'en-US', 'Canada': 'en-CA', 'United Kingdom': 'en-GB', 'UK': 'en-GB' };
            const dateLocale = countryLocaleMap[country] || 'pt-BR';
            const labels = await generateProposalLabels(p.seller || '', p.buyer || '', country);
            const L = (key: string, fallback: string) => labels[key] || fallback;
            // Auto-translate descriptions
            let localTranslations = { ...prepTranslations };
            const descs = selectedItems.map((it: any) => it.description || '');
            const needsTranslation = descs.some((d: string) => !localTranslations[d]);
            if (needsTranslation) {
                try {
                    const translated = await translateDescriptions(descs, country);
                    if (translated.length > 0) {
                        selectedItems.forEach((it: any, i: number) => {
                            localTranslations[it.description || ''] = translated[i] || it.description;
                        });
                        setPrepTranslations(localTranslations);
                    }
                } catch (err) { console.error('[Email Proposal translate]', err); }
            }
            const rows = selectedItems.map((it: any, idx: number) => {
                const translatedDesc = localTranslations[it.description || ''] || it.description || '';
                const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
                return `<tr style="background:${bg}"><td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#1e293b">${translatedDesc}</td><td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:12px;color:#374151;white-space:nowrap">${Number(it.quantity || 0).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${it.unit || 'KGS'}</td><td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;text-align:right;font-size:12px;color:#374151">US$ ${Number(it.unitPrice || 0).toFixed(2)}</td><td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;text-align:right;font-size:13px;font-weight:700;color:#065f46">US$ ${Number(it.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>`;
            }).join('');
            const total = selectedItems.reduce((s: number, it: any) => s + Number(it.amount || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
            const totalQty = selectedItems.reduce((s: number, it: any) => s + Number(it.quantity || 0), 0);
            const qtyUnit = selectedItems[0]?.unit || 'KGS';
            const today = new Date().toLocaleDateString(dateLocale, { year: 'numeric', month: 'long', day: 'numeric' });
            const emailPaymentTerms = brPriceAdjustment !== 'none' ? 'CAD - Cash Against Documents' : (p.paymentTerms || '');
            const html = `<!DOCTYPE html><html lang="${country}"><head><meta charset="UTF-8"><title>${p.proposalNumber} — ${L('title', 'COMMERCIAL PROPOSAL')}</title><style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Inter',Arial,sans-serif;background:#ffffff;color:#1e293b;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{max-width:860px;margin:0 auto;background:#fff;padding:0;box-shadow:0 4px 32px rgba(0,0,0,.1)}.header{background:linear-gradient(135deg,#1e3a5f 0%,#0f766e 100%);padding:36px 48px;display:flex;align-items:center;justify-content:space-between}.header-right{text-align:right;color:rgba(255,255,255,.85)}.proposal-badge{background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);border-radius:8px;padding:8px 18px;display:inline-block}.proposal-number{font-size:22px;font-weight:800;color:#fff;letter-spacing:1px}.proposal-title{font-size:10px;text-transform:uppercase;letter-spacing:2px;color:rgba(255,255,255,.7);margin-bottom:4px}.intro-section{background:#f8fafc;padding:20px 48px;font-size:13px;color:#374151;line-height:1.7;font-style:italic}.meta-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:0;border-bottom:2px solid #e2e8f0}.meta-cell{padding:16px 20px;border-right:1px solid #f1f5f9}.meta-cell:last-child{border-right:none}.meta-label{font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#94a3b8;font-weight:600;margin-bottom:4px}.meta-value{font-size:12px;font-weight:700;color:#1e293b}.table-container{padding:0}table{width:100%;border-collapse:collapse}thead tr{background:linear-gradient(90deg,#1e3a5f,#0f766e)}th{padding:12px 14px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,.9);font-weight:600}th:not(:first-child){text-align:center}th:last-child{text-align:right}.total-row{background:linear-gradient(90deg,#ecfdf5,#f0fdf4)}.total-row td{padding:16px 14px;font-size:15px;font-weight:800;color:#065f46;text-align:right;border-top:2px solid #a7f3d0}.validity-bar{padding:12px 20px;background:#fffbeb;border-left:4px solid #f59e0b;font-size:11px;color:#92400e;display:flex;gap:8px;align-items:center}.closing-section{padding:24px 48px;text-align:center}.closing-text{font-size:13px;color:#374151;line-height:1.8;margin-bottom:20px}.signature-area{display:flex;justify-content:space-between;margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0}.sig-block{text-align:center;min-width:180px}.sig-line{border-top:1px solid #94a3b8;margin:0 auto 6px;width:180px}.sig-label{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px}.footer{background:#1e3a5f;padding:12px 48px;text-align:center;font-size:10px;color:rgba(255,255,255,.5)}@media print{body{background:white}.page{box-shadow:none;max-width:100%}@page{margin:0.5cm}}</style></head><body><div class="page"><div class="header"><div><span style="font-size:22px;font-weight:900;color:#fff;letter-spacing:-0.5px">${p.seller || 'Company'}</span></div><div class="header-right"><div class="proposal-badge"><div class="proposal-title">${L('title', 'COMMERCIAL PROPOSAL')}</div><div class="proposal-number">${p.proposalNumber}</div></div><div style="margin-top:10px;font-size:11px;color:rgba(255,255,255,.6)">${today}</div></div></div>${L('intro', '') ? `<div class="intro-section">${L('intro', '')}</div>` : ''}<div class="meta-grid"><div class="meta-cell"><div class="meta-label">${L('labelSeller', 'SELLER')}</div><div class="meta-value">${p.seller || ''}</div></div><div class="meta-cell"><div class="meta-label">${L('labelBuyer', 'BUYER')}</div><div class="meta-value">${p.buyer || ''}</div></div><div class="meta-cell"><div class="meta-label">${L('labelDate', 'DATE')}</div><div class="meta-value">${p.date || ''}</div></div><div class="meta-cell"><div class="meta-label">${L('labelIncoterm', 'INCOTERM')}</div><div class="meta-value">${p.incoterm || ''}</div></div><div class="meta-cell"><div class="meta-label">${L('labelPayment', 'PAYMENT')}</div><div class="meta-value" style="font-size:10px">${emailPaymentTerms}</div></div></div><div class="table-container"><table><thead><tr><th>${L('labelDescription', 'DESCRIPTION')}</th><th style="text-align:center">${L('labelQty', 'QTY / UNIT')}</th><th style="text-align:center">${L('labelUnitPrice', 'UNIT PRICE')}</th><th style="text-align:right">${L('labelAmount', 'AMOUNT')}</th></tr></thead><tbody>${rows}</tbody><tfoot><tr class="total-row"><td style="padding:16px 14px;font-size:13px;color:#065f46;font-weight:600">${L('labelTotal', 'TOTAL')}</td><td style="padding:16px 14px;text-align:center;font-size:14px;font-weight:800;color:#065f46">${totalQty.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${qtyUnit}</td><td></td><td style="padding:16px 14px;font-size:15px;font-weight:800;color:#065f46;text-align:right">US$ ${total}</td></tr></tfoot></table></div><div class="validity-bar">⏱ <strong>${L('labelValidity', 'VALIDITY')}:</strong>&nbsp;${L('validityValue', '30 days from the date of this proposal')}</div><div class="closing-section">${L('closing', '') ? `<div class="closing-text">${L('closing', '')}</div>` : ''}<div class="signature-area"><div class="sig-block"><div class="sig-line"></div><div class="sig-label">${p.seller || 'Seller'}</div></div><div class="sig-block"><div class="sig-line"></div><div class="sig-label">${p.buyer || 'Buyer'}</div></div></div></div><div class="footer">${p.seller || ''} &bull; ${p.proposalNumber} &bull; ${today}</div></div></body></html>`;
            // Show in preview modal
            const htmlBlob = new Blob([html], { type: 'text/html' });
            const blobUrl = URL.createObjectURL(htmlBlob);
            const base64Content = btoa(unescape(encodeURIComponent(html)));
            const fileName = `Proposal_${p.proposalNumber || 'Draft'}.html`;
            setPreviewDownloadFn(() => () => {
                const dlBlob = new Blob([html], { type: 'text/html' });
                const dlUrl = URL.createObjectURL(dlBlob);
                const a = document.createElement('a');
                a.href = dlUrl; a.download = fileName;
                document.body.appendChild(a); a.click();
                setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(dlUrl); }, 200);
            });
            setPreviewUrl(blobUrl);
            // Auto-save proposal as SENT
            let savedId = p.id;
            try {
                const client = getSupabaseClient();
                const total = selectedItems.reduce((s: number, it: any) => s + Number(it.amount || 0), 0);
                const saveData = { companyId: currentCompanyId, proposalNumber: p.proposalNumber, seller: p.seller, buyer: p.buyer, date: p.date, incoterm: p.incoterm, paymentTerms: p.paymentTerms, notes: p.notes, total, status: 'SENT', items: selectedItems };
                if (p.id) {
                    await client.from('commission_proposals').update({ ...saveData }).eq('id', p.id);
                    setSavedProposals((prev: any[]) => prev.map((pr: any) => pr.id === p.id ? { ...pr, ...saveData } : pr));
                } else {
                    const { data } = await client.from('commission_proposals').insert(saveData).select().single();
                    if (data) { savedId = data.id; setSavedProposals((prev: any[]) => [data, ...prev]); }
                }
            } catch (saveErr) { console.error('[Email auto-save]', saveErr); }
            // Set up pending email draft — modal's Email button will open the composer
            setPendingProformaEmailDraft({
                to: toEmail,
                cc: '',
                subject: `${L('title', 'Commercial Proposal')} ${p.proposalNumber} – ${p.seller}`,
                htmlBody: L('intro', '') || `Dear ${p.buyer},\n\nPlease find attached our commercial proposal ${p.proposalNumber}.\n\nBest regards,\n${p.seller}`,
                attachments: [{ name: fileName, contentBytes: base64Content, contentType: 'text/html' }],
                proposalId: savedId || undefined
            });
        } catch (err) {
            console.error('[emailProposal]', err);
        } finally {
            setPrepDownloading(false);
            setPreviewGenerating(false);
        }
    };

    // Auto-translate Proposal Items when Buyer is selected
    useEffect(() => {
        const translateProposal = async () => {
            if (!proposalBuyer || proposalItems.length === 0) return;
            const cust = customers.find(c => c.name === proposalBuyer);
            if (!cust || !cust.country) return;

            const itemsToTranslate = proposalItems.filter(i => i.description && !i.translatedDescription);
            if (itemsToTranslate.length === 0) return;

            setTranslatingInProgress(true);
            try {
                const descs = itemsToTranslate.map(i => i.description);
                const translated = await translateDescriptions(descs, cust.country);

                setProposalItems(prev => prev.map(item => {
                    const idx = itemsToTranslate.findIndex(i => i.id === item.id);
                    if (idx >= 0 && translated[idx]) {
                        return { ...item, translatedDescription: translated[idx] };
                    }
                    return item;
                }));
            } catch (err) {
                console.error("Proposal translation error:", err);
            } finally {
                setTranslatingInProgress(false);
            }
        };

        const timer = setTimeout(translateProposal, 1000); // 1s debounce
        return () => clearTimeout(timer);
    }, [proposalBuyer, proposalItems, customers]);

    const handleProposalToContract = () => {
        // Pre-fill the Sales Contract step with proposal data
        setPiNumber(proposalNumber ? `PI-${proposalNumber}` : `PI-${Date.now().toString().slice(-6)}`);
        setPiDate(new Date().toISOString().slice(0, 10));
        setPiSeller(proposalSeller);
        setPiBuyer(proposalBuyer);
        setPiIncoterm(proposalIncoterm);
        setPiPaymentTerms(proposalPaymentTerms);
        // Transfer POD from buyer's customer record
        const buyerCust = (customers as any[]).find((c: any) => (c.name || '').toLowerCase().trim() === (proposalBuyer || '').toLowerCase().trim());
        setPiPod(buyerCust?.pod || '');
        setPiItems(proposalItems.map(item => ({
            id: item.id,
            description: item.description,
            translatedDescription: item.translatedDescription || '',
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unitPrice,
            amount: item.amount
        })));
        setPiTotal(proposalTotal);
        setContractOcrDone(true);
        setCurrentStep('CREATE_PROFORMA');
        setProformaViewMode('EDIT');
    };

    const renderProposalStep = () => (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 p-4">
            <input
                ref={proposalFileInputRef}
                type="file"
                accept=".pdf,.xlsx,.xls"
                onChange={(e) => { if (e.target.files?.[0]) handleProposalFileSelect(e.target.files[0]); }}
                className="hidden"
            />
            {/* Processing indicator */}
            {proposalProcessing && (
                <div className="flex items-center justify-center gap-3 p-4 bg-amber-50 rounded-xl border border-amber-200 mb-4">
                    <Loader2 size={20} className="text-amber-500 animate-spin" />
                    <span className="text-amber-700 font-medium text-sm">Analyzing Proposal Document...</span>
                </div>
            )}
            {proposalError && (
                <div className="flex items-center justify-center gap-3 p-4 bg-red-50 rounded-xl border border-red-200 mb-4 text-red-700">
                    <AlertCircle size={20} />
                    <span className="font-medium text-sm">{proposalError}</span>
                </div>
            )}

            <div className="flex flex-row-reverse gap-4 flex-1 min-h-0">
                {/* RIGHT COLUMN (rendered first in DOM but visually on right): Extracted Data */}
                <div className="flex flex-col gap-4 min-h-0 w-[65%] shrink-0">
                    {/* OCR Data Preview / Prepare Proposal Panel */}
                    <div className={`flex-1 flex flex-col p-4 border-2 rounded-2xl overflow-hidden min-h-0 transition-all ${preparingProposal ? 'border-emerald-200 bg-gradient-to-br from-white to-emerald-50/30' : 'border-slate-200 bg-gradient-to-br from-white to-amber-50/20 overflow-visible'}`}>

                        {preparingProposal ? (
                            /* ── PREPARE PROPOSAL VIEW ── */
                            <div className="flex flex-col flex-1 min-h-0">
                                {/* Header */}
                                <div className="flex items-center justify-between mb-3 shrink-0">
                                    <div className="flex items-center gap-2">
                                        <div className={`p-1.5 rounded-lg text-white ${preparingProposal._isEditing ? 'bg-amber-500' : 'bg-emerald-500'}`}>
                                            {preparingProposal._isEditing ? <Edit size={14} /> : <FileText size={14} />}
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-slate-800 text-sm">{preparingProposal._isEditing ? 'Edit Proposal' : 'Prepare Proposal'}</h4>
                                            <p className="text-[10px] text-slate-400">{preparingProposal.proposalNumber}</p>
                                        </div>
                                    </div>
                                    <button onClick={() => setPreparingProposal(null)} className="p-1 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-100" title="Close"><X size={14} /></button>
                                </div>

                                {/* Meta grid — all fields editable */}
                                <div className="grid grid-cols-2 gap-2 mb-3 shrink-0">

                                    {/* Proposal # */}
                                    <div className="bg-white rounded-lg p-2 border border-slate-200 shadow-sm">
                                        <label className="block text-[9px] font-bold text-slate-500 uppercase mb-0.5">Proposal #</label>
                                        <input
                                            value={preparingProposal.proposalNumber || ''}
                                            onChange={e => setPreparingProposal((p: any) => ({ ...p, proposalNumber: e.target.value }))}
                                            className="w-full text-xs text-slate-700 font-medium bg-transparent border-0 outline-none"
                                        />
                                    </div>

                                    {/* Date */}
                                    <div className="bg-white rounded-lg p-2 border border-slate-200 shadow-sm">
                                        <label className="block text-[9px] font-bold text-slate-500 uppercase mb-0.5">Date</label>
                                        <input
                                            type="date"
                                            value={preparingProposal.date || ''}
                                            onChange={e => setPreparingProposal((p: any) => ({ ...p, date: e.target.value }))}
                                            className="w-full text-xs text-slate-700 font-medium bg-transparent border-0 outline-none"
                                        />
                                    </div>

                                    {/* Seller */}
                                    <div className="bg-white rounded-lg p-2 border border-slate-200 shadow-sm">
                                        <label className="block text-[9px] font-bold text-slate-500 uppercase mb-0.5">Seller</label>
                                        <select
                                            value={preparingProposal.seller || ''}
                                            onChange={e => setPreparingProposal((p: any) => ({ ...p, seller: e.target.value }))}
                                            className="w-full text-xs text-slate-700 font-medium bg-transparent border-0 outline-none cursor-pointer"
                                        >
                                            <option value="">Select seller...</option>
                                            {[...suppliers].sort((a: any, b: any) => a.name.localeCompare(b.name)).map((s: any) => (
                                                <option key={s.id} value={s.name}>{s.name}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Buyer */}
                                    <div className="bg-white rounded-lg p-2 border border-slate-200 shadow-sm">
                                        <label className="block text-[9px] font-bold text-slate-500 uppercase mb-0.5">Buyer</label>
                                        <select
                                            value={preparingProposal.buyer || ''}
                                            onChange={e => setPreparingProposal((p: any) => ({ ...p, buyer: e.target.value }))}
                                            className="w-full text-xs text-slate-700 font-medium bg-transparent border-0 outline-none cursor-pointer"
                                        >
                                            <option value="">Select buyer...</option>
                                            {customers.map((c: any) => (
                                                <option key={c.id} value={c.name}>{c.name}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Incoterm */}
                                    <div className="bg-white rounded-lg p-2 border border-slate-200 shadow-sm">
                                        <label className="block text-[9px] font-bold text-slate-500 uppercase mb-0.5">Incoterm</label>
                                        <select
                                            value={preparingProposal.incoterm || 'FOB'}
                                            onChange={e => setPreparingProposal((p: any) => ({ ...p, incoterm: e.target.value }))}
                                            className="w-full text-xs text-slate-700 font-medium bg-transparent border-0 outline-none cursor-pointer"
                                        >
                                            {incotermsOptions.map((t: string) => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                    </div>

                                    {/* Payment Terms */}
                                    <div className="bg-white rounded-lg p-2 border border-slate-200 shadow-sm relative z-10">
                                        <label className="block text-[9px] font-bold text-slate-500 uppercase mb-0.5">Payment</label>
                                        <select
                                            value={preparingProposal.paymentTerms || ''}
                                            onChange={e => setPreparingProposal((p: any) => ({ ...p, paymentTerms: e.target.value }))}
                                            className="w-full text-xs text-slate-700 font-medium bg-white border border-slate-200 rounded px-1 py-0.5 outline-none cursor-pointer appearance-auto"
                                        >
                                            <option value="">Select payment terms...</option>
                                            {(() => {
                                                const dbTerms = [...(availablePaymentTerms || [])].filter((t: any) => t.active !== false).sort((a: any, b: any) => (a.code || '').localeCompare(b.code || ''));
                                                const dbDescs = new Set(dbTerms.map((t: any) => t.description));
                                                const fallback = PAYMENT_TERM_OPTIONS.filter(o => !dbDescs.has(o)).map(o => ({ description: o, code: o }));
                                                return [...dbTerms, ...fallback].map((t: any) => (
                                                    <option key={t.code || t.description} value={t.description}>{t.code && t.code !== t.description ? `${t.code} — ${t.description}` : t.description}</option>
                                                ));
                                            })()}
                                        </select>
                                    </div>

                                </div>

                                {/* Unit toggle */}
                                {(() => {
                                    const currentUnit = preparingProposal._unit || (preparingProposal.items?.[0]?.unit) || 'KGS';
                                    const otherUnit = currentUnit === 'KGS' ? 'LBS' : 'KGS';
                                    const FACTOR = 2.20462;
                                    return (
                                        <div className="flex items-center gap-2 mb-2 shrink-0">
                                            <span className="text-[10px] text-slate-500 font-medium">Qty &amp; Price unit:</span>
                                            <div className="flex rounded-lg overflow-hidden border border-slate-200 text-[10px] font-bold">
                                                {['KGS', 'LBS'].map(u => (
                                                    <button
                                                        key={u}
                                                        onClick={() => {
                                                            if (u === currentUnit) return;
                                                            const toKgs = u === 'KGS'; // converting INTO KGS means items were LBS
                                                            setPreparingProposal((p: any) => ({
                                                                ...p,
                                                                _unit: u,
                                                                items: p.items.map((it: any) => {
                                                                    const qty = toKgs
                                                                        ? Number(it.quantity) / FACTOR
                                                                        : Number(it.quantity) * FACTOR;
                                                                    const price = toKgs
                                                                        ? Number(it.unitPrice || 0) * FACTOR
                                                                        : Number(it.unitPrice || 0) / FACTOR;
                                                                    const mkup = toKgs
                                                                        ? Number(it.markup || 0) * FACTOR
                                                                        : Number(it.markup || 0) / FACTOR;
                                                                    return {
                                                                        ...it,
                                                                        unit: u,
                                                                        quantity: Math.round(qty * 100) / 100,
                                                                        unitPrice: Math.round(price * 10000) / 10000,
                                                                        markup: Math.round(mkup * 10000) / 10000,
                                                                        amount: Math.round(qty * (price + mkup) * 100) / 100,
                                                                    };
                                                                })
                                                            }));
                                                        }}
                                                        className={`px-3 py-1 transition-colors ${u === currentUnit ? 'bg-emerald-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                                                    >
                                                        {u}
                                                    </button>
                                                ))}
                                            </div>
                                            <span className="text-[9px] text-slate-400 ml-1">1 KGS = 2.20462 LBS</span>
                                        </div>
                                    );
                                })()}

                                {/* Items table */}
                                <div className="flex-1 overflow-y-auto min-h-0 border border-slate-200 rounded-lg bg-white shadow-sm">
                                    {/* Translate button row */}
                                    <div className="flex items-center justify-end gap-2 px-2 py-1.5 border-b border-slate-100 bg-slate-50">
                                        {prepTranslating && (
                                            <span className="text-[9px] text-indigo-400 flex items-center gap-1">
                                                <Loader2 size={10} className="animate-spin" />
                                                Translating...
                                            </span>
                                        )}
                                        {Object.keys(prepTranslations).length > 0 && !prepTranslating && (
                                            <span className="text-[9px] text-emerald-500">✓ Translated</span>
                                        )}
                                        <button
                                            disabled={prepTranslating}
                                            onClick={async () => {
                                                const items = preparingProposal.items || [];
                                                if (!items.length) return;
                                                // Find buyer country from customers prop
                                                const buyerName = (preparingProposal.buyer || '').toLowerCase().trim();
                                                const matchedCust = (customers || []).find((c: any) =>
                                                    (c.name || '').toLowerCase().includes(buyerName) ||
                                                    buyerName.includes((c.name || '').toLowerCase())
                                                ) as any;
                                                const country = matchedCust?.country || 'Brazil';
                                                try {
                                                    setPrepTranslating(true);
                                                    const descs = items.map((it: any) => it.description || '');
                                                    const translated = await translateDescriptions(descs, country);
                                                    if (translated.length > 0) {
                                                        const map: Record<string, string> = {};
                                                        items.forEach((it: any, i: number) => {
                                                            map[it.description || ''] = translated[i] || it.description;
                                                        });
                                                        setPrepTranslations(map);
                                                    }
                                                } catch (err) {
                                                    console.error('[PrepProposal Translation]', err);
                                                } finally {
                                                    setPrepTranslating(false);
                                                }
                                            }}
                                            className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-indigo-600 border border-indigo-200 rounded bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40 transition-colors"
                                        >
                                            🌐 Translate
                                        </button>
                                    </div>
                                    <table className="w-full text-[10px]">
                                        <thead className="bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-slate-200 sticky top-0 z-10">
                                            <tr>
                                                <th className="p-2 w-6">
                                                    <input
                                                        type="checkbox"
                                                        className="accent-emerald-500"
                                                        checked={(preparingProposal._selectedItemIds || []).length === (preparingProposal.items || []).length}
                                                        onChange={e => setPreparingProposal((p: any) => ({
                                                            ...p,
                                                            _selectedItemIds: e.target.checked
                                                                ? (p.items || []).map((it: any) => it.id || it.description)
                                                                : []
                                                        }))}
                                                    />
                                                </th>
                                                <th className="text-left p-2 text-slate-600 font-bold">Description</th>
                                                <th className="text-left p-2 text-indigo-500 font-bold">Translation</th>
                                                <th className="text-center p-2 text-slate-600 font-bold">Qty / Unit</th>
                                                <th className="text-center p-2 text-slate-600 font-bold">Price $</th>
                                                <th className="text-center p-2 text-slate-600 font-bold">Mkup $</th>
                                                <th className="text-center p-2 text-indigo-600 font-bold">Sale $</th>
                                                <th className="text-center p-2 text-amber-600 font-bold">Last $</th>
                                                <th className="text-right p-2 text-slate-600 font-bold">Total $</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(preparingProposal.items || []).map((item: any, idx: number) => {
                                                const itemKey = item.id || item.description;
                                                const isSelected = (preparingProposal._selectedItemIds || []).includes(itemKey);
                                                return (
                                                    <tr
                                                        key={item.id || idx}
                                                        className={`border-b border-slate-100 cursor-pointer transition-colors ${isSelected ? 'bg-white hover:bg-emerald-50/30' : 'bg-slate-50/60 opacity-50 hover:opacity-70'}`}
                                                        onClick={() => setPreparingProposal((p: any) => ({
                                                            ...p,
                                                            _selectedItemIds: isSelected
                                                                ? (p._selectedItemIds || []).filter((id: string) => id !== itemKey)
                                                                : [...(p._selectedItemIds || []), itemKey]
                                                        }))}
                                                    >
                                                        <td className="p-2" onClick={e => e.stopPropagation()}>
                                                            <input
                                                                type="checkbox"
                                                                className="accent-emerald-500"
                                                                checked={isSelected}
                                                                onChange={() => setPreparingProposal((p: any) => ({
                                                                    ...p,
                                                                    _selectedItemIds: isSelected
                                                                        ? (p._selectedItemIds || []).filter((id: string) => id !== itemKey)
                                                                        : [...(p._selectedItemIds || []), itemKey]
                                                                }))}
                                                            />
                                                        </td>
                                                        <td className="p-2 text-slate-700">{item.description || '—'}</td>
                                                        <td className="p-2 text-indigo-600 text-[9px] max-w-[160px] overflow-hidden whitespace-nowrap">
                                                            {prepTranslating
                                                                ? <Loader2 size={9} className="animate-spin text-indigo-300" />
                                                                : prepTranslations[item.description || '']
                                                                    ? <span className="block truncate">{prepTranslations[item.description || '']}</span>
                                                                    : <span className="text-slate-300">—</span>
                                                            }
                                                        </td>
                                                        <td className="p-2 text-center" onClick={e => e.stopPropagation()}>
                                                            <input
                                                                type="text"
                                                                value={Number(item.quantity).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                                onFocus={e => { e.target.value = String(item.quantity || ''); }}
                                                                onChange={e => {
                                                                    const raw = e.target.value.replace(/,/g, '');
                                                                    const qty = Number(raw) || 0;
                                                                    setPreparingProposal((p: any) => ({
                                                                        ...p,
                                                                        items: p.items.map((it: any, i: number) =>
                                                                            i === idx ? { ...it, quantity: qty, amount: qty * Number(it.unitPrice || 0) + Number(it.markup || 0) } : it
                                                                        )
                                                                    }));
                                                                }}
                                                                onBlur={e => {
                                                                    // reformat on blur — React re-renders with formatted value
                                                                    e.target.value = Number(item.quantity).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                                                }}
                                                                className="w-20 text-center text-xs text-slate-700 font-medium bg-transparent border-0 border-b border-slate-300 outline-none focus:border-emerald-500"
                                                            />
                                                            <span className="text-[9px] text-slate-400 ml-0.5">{item.unit}</span>
                                                        </td>
                                                        <td className="p-2 text-center text-slate-600">${Number(item.unitPrice || 0).toFixed(2)}</td>
                                                        <td className="p-2 text-center text-slate-500">${Number(item.markup || 0).toFixed(2)}</td>
                                                        <td className="p-2 text-center font-semibold text-indigo-600">${(Number(item.unitPrice || 0) + Number(item.markup || 0)).toFixed(2)}</td>
                                                        <td className="p-2 text-center">
                                                            {(() => {
                                                                const key = (item.description || '').toLowerCase().trim();
                                                                const hist = lastPriceMap[key];
                                                                if (!hist || !hist.price) return <span className="text-slate-400 text-[9px] font-medium">NA</span>;
                                                                const current = Number(item.unitPrice || 0) + Number(item.markup || 0);
                                                                const diff = current - hist.price;
                                                                const pct = hist.price ? ((diff / hist.price) * 100).toFixed(1) : null;
                                                                return (
                                                                    <div className="flex flex-col items-center leading-tight">
                                                                        <span className="font-bold text-amber-700">${hist.price.toFixed(2)}</span>
                                                                        {pct !== null && (
                                                                            <span className={`text-[8px] font-semibold ${diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                                                                                {diff > 0 ? '▲' : diff < 0 ? '▼' : '='} {Math.abs(Number(pct))}%
                                                                            </span>
                                                                        )}
                                                                        <span className="text-[7px] text-slate-300">{hist.source}</span>
                                                                    </div>
                                                                );
                                                            })()}
                                                        </td>
                                                        <td className="p-2 text-right font-bold text-emerald-700">${Number(item.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Footer total + actions */}
                                <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-100 shrink-0 gap-2">
                                    {/* Left — back */}
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={() => setPreparingProposal(null)}
                                            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 font-medium transition-colors"
                                        >
                                            <ArrowLeft size={12} /> Back to Upload
                                        </button>
                                        <span className="text-sm font-bold text-emerald-700">
                                            Total: ${(preparingProposal.items || []).filter((it: any) => (preparingProposal._selectedItemIds || []).includes(it.id || it.description)).reduce((s: number, it: any) => s + Number(it.amount || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                    {/* Right — actions */}
                                    <div className="flex items-center gap-1.5">
                                        {(() => {
                                            const p = preparingProposal;
                                            const selectedCount = (p._selectedItemIds || []).length;
                                            const missing: string[] = [];
                                            if (!p.proposalNumber?.trim()) missing.push('Proposal #');
                                            if (!p.date?.trim()) missing.push('Date');
                                            if (!p.seller?.trim() || p.seller === 'Select seller...') missing.push('Seller');
                                            if (!p.buyer?.trim() || p.buyer === 'Select buyer...') missing.push('Buyer');
                                            if (!p.paymentTerms?.trim() || p.paymentTerms === 'Select payment terms...') missing.push('Payment');
                                            if (selectedCount === 0) missing.push('≥1 product');
                                            const canSend = missing.length === 0;
                                            return (<>
                                                {!canSend && (
                                                    <span className="text-[9px] text-red-400 font-medium mr-1 max-w-[160px] leading-tight text-right">
                                                        Fill: {missing.join(', ')}
                                                    </span>
                                                )}
                                                {/* Email */}
                                                <button
                                                    disabled={!canSend}
                                                    onClick={() => emailProposal(preparingProposal)}
                                                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all border disabled:opacity-40 disabled:cursor-not-allowed ${canSend ? 'bg-sky-50 border-sky-200 text-sky-700 hover:bg-sky-100' : 'bg-slate-100 border-slate-200 text-slate-300 cursor-not-allowed opacity-40'}`}
                                                    title={canSend ? 'Email proposal to buyer' : `Fill required: ${missing.join(', ')}`}
                                                >
                                                    <Mail size={11} /> Email
                                                </button>
                                                {/* Download — premium AI sales proposal (opens in-app preview modal) */}
                                                <button
                                                    disabled={!canSend || prepDownloading}
                                                    onClick={async () => {
                                                        const p = preparingProposal;
                                                        const selectedItems = (p.items || []).filter((it: any) => (p._selectedItemIds || []).includes(it.id || it.description));
                                                        if (!selectedItems.length) return;
                                                        setPrepDownloading(true);
                                                        try {
                                                            // Resolve buyer country / language
                                                            const buyerName = (p.buyer || '').toLowerCase().trim();
                                                            const matchedBuyerCust = (customers as any[]).find((c: any) =>
                                                                (c.name || '').toLowerCase().includes(buyerName) ||
                                                                buyerName.includes((c.name || '').toLowerCase().trim())
                                                            ) as any;
                                                            const country = matchedBuyerCust?.country || 'Brazil';
                                                            // Map country to locale for date formatting
                                                            const countryLocaleMap: Record<string, string> = { 'Brazil': 'pt-BR', 'Portugal': 'pt-PT', 'Mexico': 'es-MX', 'Spain': 'es-ES', 'Colombia': 'es-CO', 'Argentina': 'es-AR', 'Chile': 'es-CL', 'Honduras': 'es-HN', 'Peru': 'es-PE', 'China': 'zh-CN', 'France': 'fr-FR', 'Germany': 'de-DE', 'Italy': 'it-IT', 'Japan': 'ja-JP', 'South Korea': 'ko-KR', 'Turkey': 'tr-TR', 'India': 'hi-IN', 'United States': 'en-US', 'USA': 'en-US', 'Canada': 'en-CA', 'United Kingdom': 'en-GB', 'UK': 'en-GB' };
                                                            const dateLocale = countryLocaleMap[country] || 'pt-BR';
                                                            // Get AI-generated labels + sales copy in target language
                                                            const labels = await generateProposalLabels(p.seller || '', p.buyer || '', country);
                                                            const L = (key: string, fallback: string) => labels[key] || fallback;
                                                            // Auto-translate descriptions if not already translated
                                                            let localTranslations = { ...prepTranslations };
                                                            const descs = selectedItems.map((it: any) => it.description || '');
                                                            const needsTranslation = descs.some((d: string) => !localTranslations[d]);
                                                            if (needsTranslation) {
                                                                try {
                                                                    const translated = await translateDescriptions(descs, country);
                                                                    if (translated.length > 0) {
                                                                        selectedItems.forEach((it: any, i: number) => {
                                                                            localTranslations[it.description || ''] = translated[i] || it.description;
                                                                        });
                                                                        setPrepTranslations(localTranslations);
                                                                    }
                                                                } catch (err) {
                                                                    console.error('[Proposal auto-translate]', err);
                                                                }
                                                            }
                                                            // Apply BR price adjustment for download
                                                            const adjustedItems = selectedItems.map((it: any) => {
                                                                if (downloadBrAdjustment === '50') {
                                                                    const adjPrice = Number(it.unitPrice || 0) * 0.5;
                                                                    const adjAmount = adjPrice * Number(it.quantity || 0);
                                                                    return { ...it, unitPrice: adjPrice, amount: adjAmount };
                                                                } else if (downloadBrAdjustment === 'br') {
                                                                    const adjPrice = 0.28;
                                                                    const adjAmount = adjPrice * Number(it.quantity || 0);
                                                                    return { ...it, unitPrice: adjPrice, amount: adjAmount };
                                                                }
                                                                return it;
                                                            });
                                                            const displayPaymentTerms = downloadBrAdjustment !== 'none' ? 'CAD - Cash Against Documents' : (p.paymentTerms || '');
                                                            const totalAmount = adjustedItems.reduce((s: number, it: any) => s + Number(it.amount || 0), 0);
                                                            const totalQty = selectedItems.reduce((s: number, it: any) => s + Number(it.quantity || 0), 0);
                                                            const qtyUnit = selectedItems[0]?.unit || 'KGS';
                                                            const today = new Date().toLocaleDateString(dateLocale, { year: 'numeric', month: 'long', day: 'numeric' });

                                                            // Generate PDF using jsPDF
                                                            const doc = new jsPDF();
                                                            const navy = '#1e3a5f';
                                                            const teal = '#0f766e';
                                                            const darkText = '#1e293b';
                                                            const grayText = '#64748b';

                                                            // Header bar
                                                            doc.setFillColor(30, 58, 95);
                                                            doc.rect(0, 0, 210, 32, 'F');

                                                            // Logo on header bar
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
                                                                    const maxWidth = 28;
                                                                    const maxHeight = 24;
                                                                    let width = imgProps.width;
                                                                    let height = imgProps.height;
                                                                    const ratio = Math.min(maxWidth / width, maxHeight / height);
                                                                    width *= ratio;
                                                                    height *= ratio;
                                                                    doc.addImage(logoUrl, format, 14, 4, width, height);
                                                                } catch (e) {
                                                                    console.error('[Proposal PDF] Logo load failed:', e);
                                                                }
                                                            }

                                                            doc.setFontSize(16);
                                                            doc.setFont('helvetica', 'bold');
                                                            doc.setTextColor(255, 255, 255);
                                                            doc.text(p.seller || 'Company', logoUrl ? 46 : 14, 16);
                                                            doc.setFontSize(9);
                                                            doc.setFont('helvetica', 'normal');
                                                            doc.setTextColor(200, 220, 240);
                                                            doc.text(L('title', 'COMMERCIAL PROPOSAL'), 196, 12, { align: 'right' });
                                                            doc.setFontSize(14);
                                                            doc.setFont('helvetica', 'bold');
                                                            doc.setTextColor(255, 255, 255);
                                                            doc.text(p.proposalNumber || '', 196, 20, { align: 'right' });
                                                            doc.setFontSize(8);
                                                            doc.setFont('helvetica', 'normal');
                                                            doc.setTextColor(180, 200, 220);
                                                            doc.text(today, 196, 28, { align: 'right' });

                                                            // Intro text
                                                            let yPos = 40;
                                                            const introText = L('intro', '');
                                                            if (introText) {
                                                                doc.setFontSize(9);
                                                                doc.setFont('helvetica', 'italic');
                                                                doc.setTextColor(55, 65, 81);
                                                                const introLines = doc.splitTextToSize(introText, 182);
                                                                doc.text(introLines, 14, yPos);
                                                                yPos += introLines.length * 4 + 6;
                                                            }

                                                            // Meta grid
                                                            doc.setDrawColor(226, 232, 240);
                                                            doc.line(14, yPos, 196, yPos);
                                                            yPos += 5;
                                                            const metaFields = [
                                                                { label: L('labelSeller', 'SELLER'), value: p.seller || '' },
                                                                { label: L('labelBuyer', 'BUYER'), value: p.buyer || '' },
                                                                { label: L('labelDate', 'DATE'), value: p.date || '' },
                                                                { label: L('labelIncoterm', 'INCOTERM'), value: p.incoterm || '' },
                                                                { label: L('labelPayment', 'PAYMENT'), value: displayPaymentTerms }
                                                            ];
                                                            const colW = 36;
                                                            metaFields.forEach((f, i) => {
                                                                const x = 14 + i * colW;
                                                                doc.setFontSize(7);
                                                                doc.setFont('helvetica', 'normal');
                                                                doc.setTextColor(148, 163, 184);
                                                                doc.text(f.label, x, yPos);
                                                                doc.setFontSize(9);
                                                                doc.setFont('helvetica', 'bold');
                                                                doc.setTextColor(30, 41, 59);
                                                                const valLines = doc.splitTextToSize(f.value, colW - 4);
                                                                doc.text(valLines, x, yPos + 5);
                                                            });
                                                            yPos += 16;
                                                            doc.line(14, yPos, 196, yPos);
                                                            yPos += 4;

                                                            // Items table
                                                            const tableHead = [[L('labelDescription', 'DESCRIPTION'), L('labelQty', 'QTY / UNIT'), L('labelUnitPrice', 'UNIT PRICE'), L('labelAmount', 'AMOUNT')]];
                                                            const tableBody = adjustedItems.map((it: any) => {
                                                                const translatedDesc = localTranslations[it.description || ''] || it.description || '';
                                                                return [
                                                                    translatedDesc,
                                                                    `${Number(it.quantity || 0).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${it.unit || 'KGS'}`,
                                                                    `US$ ${Number(it.unitPrice || 0).toFixed(2)}`,
                                                                    `US$ ${Number(it.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                                                                ];
                                                            });
                                                            // Total row
                                                            tableBody.push([
                                                                L('labelTotal', 'TOTAL'),
                                                                `${totalQty.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${qtyUnit}`,
                                                                '',
                                                                `US$ ${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                                                            ]);

                                                            autoTable(doc, {
                                                                startY: yPos,
                                                                head: tableHead,
                                                                body: tableBody,
                                                                theme: 'plain',
                                                                styles: { fontSize: 8, textColor: darkText, cellPadding: 3, valign: 'middle' },
                                                                headStyles: { fillColor: navy, textColor: '#ffffff', fontStyle: 'bold', halign: 'left', fontSize: 7 },
                                                                columnStyles: {
                                                                    0: { cellWidth: 75 },
                                                                    1: { halign: 'center', cellWidth: 35 },
                                                                    2: { halign: 'right', cellWidth: 35 },
                                                                    3: { halign: 'right', cellWidth: 37, fontStyle: 'bold' }
                                                                },
                                                                didParseCell: (data: any) => {
                                                                    // Style the total row
                                                                    if (data.section === 'body' && data.row.index === tableBody.length - 1) {
                                                                        data.cell.styles.fontStyle = 'bold';
                                                                        data.cell.styles.fontSize = 10;
                                                                        data.cell.styles.textColor = '#065f46';
                                                                        data.cell.styles.fillColor = '#ecfdf5';
                                                                    }
                                                                }
                                                            });

                                                            let finalY = (doc as any).lastAutoTable?.finalY || yPos + 40;

                                                            // Validity bar
                                                            finalY += 4;
                                                            doc.setFillColor(255, 251, 235);
                                                            doc.rect(14, finalY, 182, 10, 'F');
                                                            doc.setFillColor(245, 158, 11);
                                                            doc.rect(14, finalY, 1.5, 10, 'F');
                                                            doc.setFontSize(8);
                                                            doc.setFont('helvetica', 'bold');
                                                            doc.setTextColor(146, 64, 14);
                                                            doc.text(`${L('labelValidity', 'VALIDITY')}: `, 18, finalY + 6.5);
                                                            doc.setFont('helvetica', 'normal');
                                                            doc.text(L('validityValue', '30 days from the date of this proposal'), 18 + doc.getTextWidth(`${L('labelValidity', 'VALIDITY')}: `), finalY + 6.5);

                                                            // Closing text
                                                            finalY += 16;
                                                            const closingText = L('closing', '');
                                                            if (closingText) {
                                                                doc.setFontSize(9);
                                                                doc.setFont('helvetica', 'normal');
                                                                doc.setTextColor(55, 65, 81);
                                                                const closingLines = doc.splitTextToSize(closingText, 160);
                                                                doc.text(closingLines, 105, finalY, { align: 'center' });
                                                                finalY += closingLines.length * 4 + 8;
                                                            }

                                                            // Signature lines
                                                            finalY += 10;
                                                            doc.setDrawColor(148, 163, 184);
                                                            doc.line(30, finalY, 90, finalY);
                                                            doc.line(120, finalY, 180, finalY);
                                                            doc.setFontSize(8);
                                                            doc.setTextColor(100, 116, 139);
                                                            doc.text(p.seller || 'Seller', 60, finalY + 5, { align: 'center' });
                                                            doc.text(p.buyer || 'Buyer', 150, finalY + 5, { align: 'center' });

                                                            // Footer bar
                                                            const pageH = doc.internal.pageSize.height;
                                                            doc.setFillColor(30, 58, 95);
                                                            doc.rect(0, pageH - 10, 210, 10, 'F');
                                                            doc.setFontSize(7);
                                                            doc.setTextColor(180, 200, 220);
                                                            doc.text(`${p.seller || ''} • ${p.proposalNumber} • ${today}`, 105, pageH - 4, { align: 'center' });

                                                            // Save with picker (lets user choose name and folder)
                                                            await saveWithPicker(doc, `Proposal_${p.proposalNumber || 'Draft'}.pdf`);
                                                            // Auto-save proposal as SENT
                                                            try {
                                                                const client = getSupabaseClient();
                                                                const total = selectedItems.reduce((s: number, it: any) => s + Number(it.amount || 0), 0);
                                                                const saveData = { companyId: currentCompanyId, proposalNumber: p.proposalNumber, seller: p.seller, buyer: p.buyer, date: p.date, incoterm: p.incoterm, paymentTerms: p.paymentTerms, notes: p.notes, total, status: 'SENT', items: selectedItems };
                                                                if (p.id) {
                                                                    await client.from('commission_proposals').update({ ...saveData }).eq('id', p.id);
                                                                    setSavedProposals((prev: any[]) => prev.map((pr: any) => pr.id === p.id ? { ...pr, ...saveData } : pr));
                                                                } else {
                                                                    const { data } = await client.from('commission_proposals').insert(saveData).select().single();
                                                                    if (data) setSavedProposals((prev: any[]) => [data, ...prev]);
                                                                }
                                                            } catch (saveErr) { console.error('[Download auto-save]', saveErr); }
                                                        } catch (err) {
                                                            console.error('[Download Proposal]', err);
                                                        } finally {
                                                            setPrepDownloading(false);
                                                        }
                                                    }}
                                                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all border disabled:opacity-40 ${canSend ? 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100' : 'bg-slate-100 border-slate-200 text-slate-300 cursor-not-allowed'}`}
                                                    title={canSend ? 'Preview professional proposal' : `Fill required: ${missing.join(', ')}`}
                                                >
                                                    {prepDownloading ? <><Loader2 size={11} className="animate-spin" /> Generating...</> : <><Download size={11} /> Download</>}
                                                </button>
                                                {/* BR Price Adjustment for Download */}
                                                <div className="flex items-center gap-2 ml-1">
                                                    <label className="flex items-center gap-1 cursor-pointer" title="50% of original price">
                                                        <input type="checkbox" checked={downloadBrAdjustment === '50'} onChange={(e) => setDownloadBrAdjustment(e.target.checked ? '50' : 'none')} className="w-3 h-3 accent-amber-600 rounded" />
                                                        <span className="text-[10px] font-bold text-amber-700">50%</span>
                                                    </label>
                                                    <label className="flex items-center gap-1 cursor-pointer" title="$0.28/KG fixed">
                                                        <input type="checkbox" checked={downloadBrAdjustment === 'br'} onChange={(e) => setDownloadBrAdjustment(e.target.checked ? 'br' : 'none')} className="w-3 h-3 accent-amber-600 rounded" />
                                                        <span className="text-[10px] font-bold text-amber-700">BR</span>
                                                    </label>
                                                </div>
                                            </>);
                                        })()}
                                        {/* Save / Load into editor */}
                                        {preparingProposal._isEditing ? (
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        const client = getSupabaseClient();
                                                        const total = (preparingProposal.items || []).reduce((s: number, it: any) => s + Number(it.amount || 0), 0);
                                                        const updateData = { seller: preparingProposal.seller, buyer: preparingProposal.buyer, date: preparingProposal.date, incoterm: preparingProposal.incoterm, paymentTerms: preparingProposal.paymentTerms, notes: preparingProposal.notes, total, status: preparingProposal.status || 'DRAFT', items: preparingProposal.items };
                                                        await client.from('commission_proposals').update(updateData).eq('id', preparingProposal.id);
                                                        setSavedProposals((prev: any[]) => prev.map((p: any) => p.id === preparingProposal.id ? { ...p, ...updateData } : p));
                                                        setPreparingProposal(null);
                                                    } catch (err) { console.error(err); }
                                                }}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg text-xs font-bold hover:from-amber-600 hover:to-orange-600 shadow transition-all"
                                            >
                                                <Save size={12} /> Save
                                            </button>
                                        ) : (
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        const client = getSupabaseClient();
                                                        const selectedItems = (preparingProposal.items || []).filter((it: any) => (preparingProposal._selectedItemIds || []).includes(it.id || it.description));
                                                        const total = selectedItems.reduce((s: number, it: any) => s + Number(it.amount || 0), 0);
                                                        const insertData = { companyId: currentCompanyId, proposalNumber: preparingProposal.proposalNumber, seller: preparingProposal.seller, buyer: preparingProposal.buyer, date: preparingProposal.date, incoterm: preparingProposal.incoterm, paymentTerms: preparingProposal.paymentTerms, notes: preparingProposal.notes, total, status: 'DRAFT', items: selectedItems };
                                                        const { data } = await client.from('commission_proposals').insert(insertData).select().single();
                                                        if (data) setSavedProposals((prev: any[]) => [data, ...prev]);
                                                        setPreparingProposal(null);
                                                    } catch (err) { console.error(err); }
                                                }}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-lg text-xs font-bold hover:from-emerald-600 hover:to-teal-600 shadow transition-all"
                                            >
                                                <Save size={12} /> Save
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            /* ── EXTRACTED DATA / FORM VIEW ── */
                            <>
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                        <FileCheck size={16} className="text-amber-600" />
                                        <h4 className="font-bold text-slate-700 text-sm">Extracted Data</h4>
                                    </div>
                                    {!proposalDone && (
                                        <button
                                            onClick={() => {
                                                setProposalItems([{ id: `prop-${Date.now()}`, description: '', quantity: 0, unit: 'KGS', unitPrice: 0, markup: 0, amount: 0 }]);
                                                setProposalDone(true);
                                            }}
                                            className="text-[10px] text-amber-600 hover:text-amber-800 font-medium underline"
                                        >
                                            Or enter items manually →
                                        </button>
                                    )}
                                </div>
                                {proposalDone ? (
                                    <div className="flex-1 flex flex-col min-h-0">
                                        {/* Seller / Buyer / Incoterm / Payment */}
                                        <div className="grid grid-cols-2 gap-2 mb-3">
                                            <div className="bg-white rounded-lg p-2 border border-slate-100 shadow-sm">
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Seller</label>
                                                <select value={proposalSeller} onChange={(e) => setProposalSeller(e.target.value)}
                                                    className="w-full px-2 py-1 bg-transparent border-0 outline-none text-xs text-slate-700">
                                                    <option value="">Select...</option>
                                                    {[...suppliers].sort((a: any, b: any) => a.name.localeCompare(b.name)).map((s: any) => <option key={s.id} value={s.name}>{s.name}</option>)}
                                                </select>
                                            </div>
                                            <div className="bg-white rounded-lg p-2 border border-slate-100 shadow-sm">
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Buyer</label>
                                                <select value={proposalBuyer} onChange={(e) => setProposalBuyer(e.target.value)}
                                                    className="w-full px-2 py-1 bg-transparent border-0 outline-none text-xs text-slate-700">
                                                    <option value="">Select...</option>
                                                    {customers.map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}
                                                </select>
                                            </div>
                                            <div className="bg-white rounded-lg p-2 border border-slate-100 shadow-sm">
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Incoterm</label>
                                                <select value={proposalIncoterm} onChange={(e) => setProposalIncoterm(e.target.value)}
                                                    className="w-full px-2 py-1 bg-transparent border-0 outline-none text-xs text-slate-700">
                                                    <option value="FOB">FOB</option><option value="CIF">CIF</option><option value="CFR">CFR</option>
                                                    <option value="EXW">EXW</option><option value="DDP">DDP</option>
                                                </select>
                                            </div>
                                            <div className="bg-white rounded-lg p-2 border border-slate-100 shadow-sm">
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Payment</label>
                                                <select value={proposalPaymentTerms} onChange={(e) => setProposalPaymentTerms(e.target.value)}
                                                    className="w-full px-2 py-1 bg-transparent border-0 outline-none text-xs text-slate-700">
                                                    <option value="NET 30">NET 30</option><option value="NET 60">NET 60</option>
                                                    <option value="NET 90">NET 90</option><option value="Cash in Advance">Advance</option>
                                                    <option value="Letter of Credit">L/C</option>
                                                </select>
                                            </div>
                                        </div>

                                        {/* Items Table */}
                                        <div className="flex-1 relative border border-slate-200 rounded-lg overflow-y-auto overflow-x-auto bg-white shadow-sm mb-3">
                                            {/* Bulk Markup Popover */}
                                            {proposalMarkupOpen && (
                                                <div className="absolute top-8 right-0 z-50 w-64 bg-white border border-indigo-200 rounded-xl shadow-xl p-3">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="text-xs font-bold text-slate-700">Apply Markup to All Items</span>
                                                        <button onClick={() => setProposalMarkupOpen(false)} className="text-slate-400 hover:text-slate-600 text-xs">✕</button>
                                                    </div>
                                                    <div className="flex gap-1 mb-3">
                                                        <button
                                                            onClick={() => setProposalMarkupMode('flat')}
                                                            className={`flex-1 py-1 rounded text-[10px] font-bold border transition-all ${proposalMarkupMode === 'flat'
                                                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                                                    : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-400'
                                                                }`}
                                                        >
                                                            $/kg Flat
                                                        </button>
                                                        <button
                                                            onClick={() => setProposalMarkupMode('pct')}
                                                            className={`flex-1 py-1 rounded text-[10px] font-bold border transition-all ${proposalMarkupMode === 'pct'
                                                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                                                    : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-400'
                                                                }`}
                                                        >
                                                            % of Price
                                                        </button>
                                                    </div>
                                                    <div className="flex items-center gap-2 mb-3">
                                                        <span className="text-[10px] text-slate-500">{proposalMarkupMode === 'flat' ? '$/kg' : '%'}</span>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            value={proposalMarkupValue}
                                                            onChange={(e) => setProposalMarkupValue(parseFloat(e.target.value) || 0)}
                                                            className="flex-1 px-2 py-1 border border-slate-200 rounded text-xs text-center focus:ring-1 focus:ring-indigo-500"
                                                        />
                                                    </div>
                                                    <button
                                                        onClick={() => {
                                                            setProposalItems(prev => prev.map(item => {
                                                                const mk = proposalMarkupMode === 'flat'
                                                                    ? proposalMarkupValue
                                                                    : item.unitPrice * (proposalMarkupValue / 100);
                                                                return { ...item, markup: mk, amount: item.quantity * (item.unitPrice + mk) };
                                                            }));
                                                            setProposalMarkupOpen(false);
                                                        }}
                                                        className="w-full py-1.5 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-lg text-xs font-bold hover:from-indigo-600 hover:to-purple-600 shadow"
                                                    >
                                                        Apply to All Items
                                                    </button>
                                                </div>
                                            )}
                                            <table className="w-full text-[10px]">
                                                <thead className="bg-gradient-to-r from-amber-50 to-orange-50 border-b border-slate-200 sticky top-0 z-10">
                                                    <tr>
                                                        <th className="text-left p-2 text-slate-600 font-bold w-6">#</th>
                                                        <th className="text-left p-2 text-slate-600 font-bold min-w-[120px]">Description</th>
                                                        <th className="text-left p-2 text-slate-600 font-bold min-w-[120px]">
                                                            <div className="flex items-center gap-1">
                                                                Description Translation
                                                                {translatingInProgress && <Loader2 size={10} className="animate-spin text-amber-500" />}
                                                            </div>
                                                        </th>
                                                        <th className="text-center p-2 text-slate-600 font-bold w-16">Qty Kg</th>
                                                        <th className="text-center p-2 text-slate-600 font-bold w-16">Unit</th>
                                                        <th className="text-center p-2 text-slate-600 font-bold w-16">Price $</th>
                                                        <th className="text-center p-2 text-slate-600 font-bold w-16">
                                                            <button
                                                                onClick={() => setProposalMarkupOpen(v => !v)}
                                                                className="flex items-center gap-1 mx-auto text-indigo-600 hover:text-indigo-800 font-bold underline decoration-dotted"
                                                                title="Click to set bulk markup for all items"
                                                            >
                                                                Mkup $
                                                            </button>
                                                        </th>
                                                        <th className="text-right p-2 text-slate-600 font-bold w-20">Total $</th>
                                                        <th className="p-2 w-6"></th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {proposalItems.map((item, idx) => (
                                                        <tr key={item.id} className="border-b border-slate-100 hover:bg-amber-50/30">
                                                            <td className="p-1 text-slate-400 text-center">{idx + 1}</td>
                                                            <td className="p-1">
                                                                <input type="text" value={item.description}
                                                                    onChange={(e) => updateProposalItem(item.id, 'description', e.target.value)}
                                                                    className="w-full px-1 py-1 border border-slate-200 rounded text-[10px] focus:ring-1 focus:ring-amber-500" />
                                                            </td>
                                                            <td className="p-1">
                                                                <input type="text" value={item.translatedDescription || ''}
                                                                    onChange={(e) => updateProposalItem(item.id, 'translatedDescription', e.target.value)}
                                                                    className="w-full px-1 py-1 border border-slate-200 rounded text-[10px] focus:ring-1 focus:ring-amber-500 bg-amber-50/50" />
                                                            </td>
                                                            <td className="p-1">
                                                                <input type="number" value={item.quantity}
                                                                    onChange={(e) => updateProposalItem(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                                                                    className="w-full px-1 py-1 border border-slate-200 rounded text-[10px] text-center focus:ring-1 focus:ring-amber-500" />
                                                            </td>
                                                            <td className="p-1">
                                                                <select value={item.unit}
                                                                    onChange={(e) => updateProposalItem(item.id, 'unit', e.target.value)}
                                                                    className="w-full px-1 py-1 border border-slate-200 rounded text-[10px] text-center focus:ring-1 focus:ring-amber-500">
                                                                    <option value="KGS">KGS</option><option value="PCS">PCS</option>
                                                                    <option value="SETS">SETS</option><option value="MT">MT</option>
                                                                    <option value="BAGS">BAGS</option><option value="BALES">BALES</option>
                                                                </select>
                                                            </td>
                                                            <td className="p-1">
                                                                <input type="number" step="0.01" value={item.unitPrice}
                                                                    onChange={(e) => updateProposalItem(item.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                                                                    className="w-full px-1 py-1 border border-slate-200 rounded text-[10px] text-center focus:ring-1 focus:ring-amber-500" />
                                                            </td>
                                                            <td className="p-1">
                                                                <input type="number" step="0.01" value={item.markup || 0}
                                                                    onChange={(e) => updateProposalItem(item.id, 'markup', parseFloat(e.target.value) || 0)}
                                                                    className="w-full px-1 py-1 border border-indigo-200 rounded text-[10px] text-center focus:ring-1 focus:ring-indigo-400 bg-indigo-50/50" />
                                                            </td>
                                                            <td className="p-1 text-right font-medium text-slate-700">${item.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                                                            <td className="p-1">
                                                                <button onClick={() => setProposalItems(prev => prev.filter(x => x.id !== item.id))}
                                                                    className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        {/* Footer Action */}
                                        <div className="mt-auto">
                                            {/* Proposal # and Date */}
                                            <div className="grid grid-cols-2 gap-2 mb-2">
                                                <div className="bg-white rounded-lg p-2 border border-slate-100 shadow-sm">
                                                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Proposal #</label>
                                                    <input
                                                        value={proposalNumber}
                                                        onChange={e => setProposalNumber(e.target.value)}
                                                        placeholder="Auto-generated on save"
                                                        className="w-full bg-transparent border-0 outline-none text-xs text-slate-700 placeholder:text-slate-300"
                                                    />
                                                </div>
                                                <div className="bg-white rounded-lg p-2 border border-slate-100 shadow-sm">
                                                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Date</label>
                                                    <input type="date" value={proposalDate} onChange={e => setProposalDate(e.target.value)}
                                                        className="w-full bg-transparent border-0 outline-none text-xs text-slate-700" />
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => setProposalItems(prev => [...prev, { id: `prop-${Date.now()}`, description: '', quantity: 0, unit: 'KGS', unitPrice: 0, markup: 0, amount: 0 }])}
                                                        className="flex items-center gap-1 px-2 py-1.5 bg-emerald-500 text-white rounded text-xs font-medium hover:bg-emerald-600">
                                                        <Plus size={12} /> Add
                                                    </button>
                                                    <button
                                                        onClick={() => { setProposalDone(false); setProposalItems([]); setProposalFile(null); setProposalError(null); setProposalNumber(''); setEditingProposalId(null); }}
                                                        className="flex items-center gap-1 px-2 py-1.5 border border-slate-300 text-slate-600 rounded text-xs hover:bg-slate-50">
                                                        <ArrowLeft size={12} /> Clear
                                                    </button>
                                                    <button
                                                        onClick={() => setCurrentStep('UPLOAD_CONTRACT')}
                                                        className="text-[10px] text-slate-400 hover:text-slate-600 ml-2">
                                                        Skip to Sales Contract
                                                    </button>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-bold text-amber-600">Total: ${proposalTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                    <button
                                                        onClick={saveProposal}
                                                        disabled={proposalItems.length === 0 || proposalSaving}
                                                        className="flex items-center gap-1 px-3 py-1.5 bg-slate-700 text-white rounded-lg text-xs font-bold hover:bg-slate-800 transition-all disabled:opacity-50">
                                                        {proposalSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                                                        {editingProposalId ? 'Update' : 'Save'}
                                                    </button>
                                                    <button
                                                        onClick={handleProposalToContract}
                                                        disabled={proposalItems.length === 0}
                                                        className="flex items-center gap-1 px-3 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg text-xs font-bold hover:from-amber-600 hover:to-orange-600 transition-all shadow-md disabled:opacity-50">
                                                        Create Sales Contract <ArrowRight size={14} />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
                                        <div className="p-3 bg-slate-100 rounded-full mb-2">
                                            <Sparkles size={24} className="text-slate-300" />
                                        </div>
                                        <p className="text-xs text-slate-400">Upload a proposal to see<br />extracted data here</p>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* RIGHT COLUMN: Upload + Saved Proposals */}
                <div className="flex flex-col flex-1 min-w-0 min-h-0 gap-3">
                    {/* Upload Zone (compact horizontal) */}
                    <div
                        className={`flex flex-row items-center gap-3 px-4 py-3 border-2 border-dashed rounded-xl transition-all cursor-pointer shrink-0 ${proposalDragActive
                                ? 'border-amber-500 bg-amber-50'
                                : 'border-slate-300 bg-gradient-to-r from-slate-50 to-amber-50/30 hover:border-amber-400'
                            }`}
                        onClick={() => proposalFileInputRef.current?.click()}
                        onDragOver={(e) => { e.preventDefault(); setProposalDragActive(true); }}
                        onDragLeave={(e) => { e.preventDefault(); setProposalDragActive(false); }}
                        onDrop={(e) => {
                            e.preventDefault();
                            setProposalDragActive(false);
                            if (e.dataTransfer.files?.[0]) handleProposalFileSelect(e.dataTransfer.files[0]);
                        }}
                    >
                        <div className="p-2 bg-gradient-to-r from-amber-500 to-orange-500 rounded-lg text-white shadow shrink-0">
                            <Upload size={16} />
                        </div>
                        <div>
                            <p className="text-xs font-bold text-slate-700">Upload Proposal Document</p>
                            <p className="text-[10px] text-slate-400">Drop or click — PDF, XLSX supported</p>
                        </div>
                    </div>

                    {/* Two equal-height proposal panels */}
                    <div className="flex flex-col flex-1 min-h-0 gap-3">

                        {/* TOP: Scanned Proposals (not yet sent) */}
                        <div className="flex flex-col flex-1 min-h-0 p-3 border-2 border-slate-200 rounded-2xl bg-gradient-to-br from-slate-50 to-white overflow-hidden">
                            <div className="flex items-center gap-2 mb-2 shrink-0">
                                <ClipboardList size={15} className="text-amber-600" />
                                <h4 className="font-bold text-slate-700 text-xs">Scanned Proposals</h4>
                                <span className="ml-auto text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{savedProposals.filter((p: any) => !['SENT', 'APPROVED', 'REJECTED'].includes(p.status)).length}</span>
                            </div>
                            <div className="flex-1 overflow-y-auto space-y-1.5">
                                {savedProposals.filter((p: any) => !['SENT', 'APPROVED', 'REJECTED'].includes(p.status)).length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full text-center py-6">
                                        <ClipboardList size={24} className="text-slate-200 mb-1" />
                                        <p className="text-[10px] text-slate-400">No proposals yet.<br />Upload and scan one to get started.</p>
                                    </div>
                                ) : savedProposals.filter((p: any) => !['SENT', 'APPROVED', 'REJECTED'].includes(p.status)).map((prop: any) => {
                                    const fmtDate = (() => {
                                        if (!prop.date) return '';
                                        const d = new Date(prop.date);
                                        if (isNaN(d.getTime())) return prop.date;
                                        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                                        return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
                                    })();

                                    return (
                                        <div key={prop.id} className={`flex items-center gap-2 px-2 py-1.5 bg-white border rounded-lg hover:border-amber-300 hover:shadow-sm transition-all group cursor-pointer ${editingProposalId === prop.id ? 'border-amber-400' : 'border-slate-200'}`} onClick={() => loadProposal(prop)}>
                                            <span className="font-bold text-[10px] text-slate-800 whitespace-nowrap">{prop.proposalNumber}</span>
                                            <span className="text-[10px] text-slate-500 whitespace-nowrap truncate">{(prop.seller || '').split(/[\s,]/)[0]} → {(prop.buyer || '').split(/[\s,]/)[0]}</span>
                                            {fmtDate && <span className="text-[9px] text-slate-400 whitespace-nowrap">{fmtDate}</span>}
                                            <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-bold whitespace-nowrap ${prop.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : prop.status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{prop.status || 'DRAFT'}</span>
                                            <div className="flex items-center gap-1 shrink-0 ml-auto" onClick={e => e.stopPropagation()}>
                                                <button onClick={() => setPreparingProposal({ ...prop, _isEditing: true, _selectedItemIds: (prop.items || []).map((it: any) => it.id || it.description) })} className="p-1 bg-amber-50 text-amber-600 border border-amber-200 rounded hover:bg-amber-100" title="Edit"><Edit size={11} /></button>
                                                <button onClick={() => setPreparingProposal({ ...prop, _selectedItemIds: (prop.items || []).map((it: any) => it.id || it.description) })} className="p-1 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded hover:bg-emerald-100" title="Prepare Proposal"><FileText size={11} /></button>

                                                <button onClick={() => deleteProposal(prop.id)} className="p-1 bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100" title="Delete"><Trash2 size={11} /></button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* BOTTOM: Sent Proposals */}
                        <div className="flex flex-col flex-1 min-h-0 p-3 border-2 border-blue-100 rounded-2xl bg-gradient-to-br from-blue-50/30 to-white overflow-hidden">
                            <div className="flex items-center gap-2 mb-2 shrink-0">
                                <Mail size={15} className="text-blue-500" />
                                <h4 className="font-bold text-slate-700 text-xs">Sent Proposals</h4>
                                <span className="ml-auto text-[10px] text-slate-400 bg-blue-100 px-2 py-0.5 rounded-full">{savedProposals.filter((p: any) => ['SENT', 'APPROVED', 'REJECTED'].includes(p.status)).length}</span>
                            </div>
                            <div className="flex-1 overflow-y-auto space-y-1.5">
                                {savedProposals.filter((p: any) => ['SENT', 'APPROVED', 'REJECTED'].includes(p.status)).length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full text-center py-6">
                                        <Mail size={24} className="text-slate-200 mb-1" />
                                        <p className="text-[10px] text-slate-400">No sent proposals yet.<br />Email one to see it here.</p>
                                    </div>
                                ) : savedProposals.filter((p: any) => ['SENT', 'APPROVED', 'REJECTED'].includes(p.status)).map((prop: any) => {
                                    const fmtDate = (() => {
                                        if (!prop.date) return '';
                                        const d = new Date(prop.date);
                                        if (isNaN(d.getTime())) return prop.date;
                                        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                                        return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
                                    })();
                                    return (
                                        <div key={prop.id} className="flex items-center gap-2 px-2 py-1.5 bg-white border border-blue-100 rounded-lg hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer" onClick={() => loadProposal(prop)}>
                                            <span className="font-bold text-[10px] text-slate-800 whitespace-nowrap">{prop.proposalNumber}</span>
                                            <span className="text-[10px] text-slate-500 truncate">{(prop.seller || '').split(/[\s,]/)[0]} → {(prop.buyer || '').split(/[\s,]/)[0]}</span>
                                            {fmtDate && <span className="text-[9px] text-slate-400 whitespace-nowrap">{fmtDate}</span>}
                                            <div className="flex items-center gap-1 shrink-0 ml-auto" onClick={e => e.stopPropagation()}>
                                                <button onClick={() => setPreparingProposal({ ...prop, _selectedItemIds: (prop.items || []).map((it: any) => it.id || it.description) })} className="p-1 bg-blue-50 text-blue-600 border border-blue-200 rounded hover:bg-blue-100" title="View Proposal"><Eye size={11} /></button>
                                                <button onClick={async () => { try { const client = getSupabaseClient(); await client.from('commission_proposals').update({ status: 'APPROVED' }).eq('id', prop.id); setSavedProposals((prev: any[]) => prev.map((p: any) => p.id === prop.id ? { ...p, status: 'APPROVED' } : p)); /* Pre-fill Sales Contract from proposal data */ setPiNumber(prop.proposalNumber ? `PI-${prop.proposalNumber}` : `PI-${Date.now().toString().slice(-6)}`); setPiDate(new Date().toISOString().slice(0, 10)); setPiSeller(prop.seller || ''); setPiBuyer(prop.buyer || ''); setPiIncoterm(prop.incoterm || ''); setPiPaymentTerms(prop.paymentTerms || ''); /* Transfer POD from buyer customer record */ const buyerCust = (customers as any[]).find((c: any) => (c.name || '').toLowerCase().trim() === (prop.buyer || '').toLowerCase().trim()); setPiPod(buyerCust?.pod || ''); const scItems = (prop.items || []).map((it: any) => ({ id: it.id, description: it.description, translatedDescription: it.translatedDescription || '', quantity: it.quantity, unit: it.unit, unitPrice: it.unitPrice, amount: it.amount })); setPiItems(scItems); setPiTotal(scItems.reduce((s: number, i: any) => s + Number(i.amount || 0), 0)); setContractOcrDone(true); setCurrentStep('CREATE_PROFORMA'); setProformaViewMode('EDIT'); setPreparingProposal(null); } catch (err) { console.error(err); } }} className="p-1 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded hover:bg-emerald-100" title="Approve & Create Sales Contract"><CheckCircle2 size={11} /></button>
                                                <button onClick={async () => { try { const client = getSupabaseClient(); await client.from('commission_proposals').update({ status: 'REJECTED' }).eq('id', prop.id); setSavedProposals((prev: any[]) => prev.map((p: any) => p.id === prop.id ? { ...p, status: 'REJECTED' } : p)); } catch (err) { console.error(err); } }} className="p-1 bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100" title="Mark Rejected"><X size={11} /></button>
                                                <button onClick={() => deleteProposal(prop.id)} className="p-1 bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100" title="Delete"><Trash2 size={11} /></button>
                                            </div>
                                            <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-bold whitespace-nowrap ${prop.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : prop.status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{prop.status || 'SENT'}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>



                    </div>
                </div>
            </div>
        </div>
    );


    const renderUploadContractStep = () => (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 p-4">
            <input
                ref={contractFileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={(e) => e.target.files?.[0] && handleContractUpload(e.target.files[0])}
                className="hidden"
            />

            {/* Processing indicator */}
            {contractProcessing && (
                <div className="flex items-center justify-center gap-3 p-4 bg-orange-50 rounded-xl border border-orange-200 mb-4">
                    <Loader2 size={20} className="text-orange-500 animate-spin" />
                    <span className="text-orange-700 font-medium text-sm">Analyzing Sales Contract...</span>
                </div>
            )}

            <div className="flex flex-row gap-4 flex-1 min-h-0">
                {/* LEFT COLUMN: Upload + OCR Data */}
                <div className="flex flex-col gap-4 min-h-0 w-[65%] shrink-0">
                    {/* Upload Zone (Top) */}
                    <div
                        className={`flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-2xl transition-all cursor-pointer ${contractDragActive
                            ? 'border-orange-500 bg-orange-50'
                            : 'border-slate-300 bg-gradient-to-br from-slate-50 to-orange-50/30 hover:border-orange-400'
                            }`}
                        onClick={() => contractFileInputRef.current?.click()}
                        onDragOver={(e) => { e.preventDefault(); setContractDragActive(true); }}
                        onDragLeave={() => setContractDragActive(false)}
                        onDrop={(e) => {
                            e.preventDefault();
                            setContractDragActive(false);
                            const file = e.dataTransfer.files[0];
                            if (file && (file.type === 'application/pdf' || file.type.startsWith('image/'))) {
                                handleContractUpload(file);
                            }
                        }}
                    >
                        <div className="p-3 bg-gradient-to-r from-orange-500 to-amber-500 rounded-xl text-white mb-3 shadow-lg">
                            <Upload size={28} />
                        </div>
                        <h3 className="text-base font-bold text-slate-700 mb-1">Upload Sales Contract</h3>
                        <p className="text-xs text-slate-500 text-center">
                            Drop a Sales Contract, Proforma, or PO here<br />
                            <span className="text-[10px] text-slate-400">PDF, PNG, JPG supported</span>
                        </p>
                    </div>

                    {/* OCR Data Preview (Bottom) */}
                    <div className="flex-1 flex flex-col p-4 border-2 border-slate-200 rounded-2xl bg-gradient-to-br from-white to-orange-50/20 overflow-hidden min-h-0">
                        <div className="flex items-center gap-2 mb-3">
                            <FileCheck size={16} className="text-orange-600" />
                            <h4 className="font-bold text-slate-700 text-sm">OCR Extracted Data</h4>
                        </div>
                        {contractOcrDone ? (
                            <div className="flex-1 overflow-y-auto space-y-2">
                                {/* Contract info */}
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="bg-slate-50 rounded-lg p-2">
                                        <span className="text-[10px] text-slate-400 uppercase block">Contract #</span>
                                        <span className="text-xs font-bold text-slate-800">{piNumber.replace('PI-', '')}</span>
                                    </div>
                                    <div className="bg-slate-50 rounded-lg p-2">
                                        <span className="text-[10px] text-slate-400 uppercase block">Date</span>
                                        <span className="text-xs font-bold text-slate-800">{piDate}</span>
                                    </div>
                                    <div className="bg-slate-50 rounded-lg p-2">
                                        <span className="text-[10px] text-slate-400 uppercase block">Seller</span>
                                        <span className="text-xs font-medium text-slate-700 truncate block">{piSeller || '—'}</span>
                                    </div>
                                    <div className="bg-slate-50 rounded-lg p-2">
                                        <span className="text-[10px] text-slate-400 uppercase block">Buyer</span>
                                        <span className="text-xs font-medium text-slate-700 truncate block">{piBuyer || '—'}</span>
                                    </div>
                                    <div className="bg-slate-50 rounded-lg p-2">
                                        <span className="text-[10px] text-slate-400 uppercase block">Incoterm</span>
                                        <span className="text-xs font-medium text-slate-700 truncate block">{piIncoterm || '—'}</span>
                                    </div>
                                    <div className="bg-slate-50 rounded-lg p-2">
                                        <span className="text-[10px] text-slate-400 uppercase block">Payment Terms</span>
                                        <span className="text-xs font-medium text-slate-700 truncate block">{piPaymentTerms || '—'}</span>
                                    </div>
                                </div>
                                {piItems.length > 0 && (
                                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                                        <table className="w-full text-[10px]">
                                            <thead>
                                                <tr className="bg-slate-100 text-slate-500">
                                                    <th className="text-left px-2 py-1">Description</th>
                                                    <th className="text-right px-2 py-1">Qty (LBS)</th>
                                                    <th className="text-right px-2 py-1">Qty (KGS)</th>
                                                    <th className="text-right px-2 py-1">$/LB</th>
                                                    <th className="text-right px-2 py-1">$/KG</th>
                                                    <th className="text-right px-2 py-1">Amount</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {piItems.map((item: any) => {
                                                    const qty = Number(item.quantity) || 0;
                                                    const amount = Number(item.amount) || 0;
                                                    const unit = (item.unit || 'LBS').toUpperCase();
                                                    const qtyLbs = unit === 'KGS' || unit === 'KILOS' || unit === 'KG' ? qty * 2.20462 : qty;
                                                    const qtyKgs = unit === 'KGS' || unit === 'KILOS' || unit === 'KG' ? qty : qty / 2.20462;
                                                    const priceLb = qtyLbs > 0 ? amount / qtyLbs : 0;
                                                    const priceKg = qtyKgs > 0 ? amount / qtyKgs : 0;
                                                    return (
                                                        <tr key={item.id} className="border-t border-slate-100">
                                                            <td className="px-2 py-1 text-slate-700 truncate max-w-[100px]">{item.description}</td>
                                                            <td className="px-2 py-1 text-right text-slate-600">{Math.round(qtyLbs).toLocaleString()}</td>
                                                            <td className="px-2 py-1 text-right text-slate-600">{Math.round(qtyKgs).toLocaleString()}</td>
                                                            <td className="px-2 py-1 text-right text-slate-600">${priceLb.toFixed(2)}</td>
                                                            <td className="px-2 py-1 text-right text-slate-600">${priceKg.toFixed(2)}</td>
                                                            <td className="px-2 py-1 text-right font-medium text-slate-800">${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                            <tfoot>
                                                {(() => {
                                                    const totalLbs = piItems.reduce((sum: number, item: any) => {
                                                        const qty = Number(item.quantity) || 0;
                                                        const unit = (item.unit || 'LBS').toUpperCase();
                                                        return sum + (unit === 'KGS' || unit === 'KILOS' || unit === 'KG' ? qty * 2.20462 : qty);
                                                    }, 0);
                                                    const totalKgs = piItems.reduce((sum: number, item: any) => {
                                                        const qty = Number(item.quantity) || 0;
                                                        const unit = (item.unit || 'LBS').toUpperCase();
                                                        return sum + (unit === 'KGS' || unit === 'KILOS' || unit === 'KG' ? qty : qty / 2.20462);
                                                    }, 0);
                                                    const totalAmount = piItems.reduce((sum: number, item: any) => sum + (Number(item.amount) || 0), 0);
                                                    const avgPriceLb = totalLbs > 0 ? totalAmount / totalLbs : 0;
                                                    const avgPriceKg = totalKgs > 0 ? totalAmount / totalKgs : 0;
                                                    return (
                                                        <tr className="bg-orange-50 border-t-2 border-orange-200 font-bold text-slate-800">
                                                            <td className="px-2 py-1.5">TOTALS</td>
                                                            <td className="px-2 py-1.5 text-right">{Math.round(totalLbs).toLocaleString()} LBS</td>
                                                            <td className="px-2 py-1.5 text-right">{Math.round(totalKgs).toLocaleString()} KGS</td>
                                                            <td className="px-2 py-1.5 text-right">${avgPriceLb.toFixed(2)}</td>
                                                            <td className="px-2 py-1.5 text-right">${avgPriceKg.toFixed(2)}</td>
                                                            <td className="px-2 py-1.5 text-right text-orange-600">${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                                        </tr>
                                                    );
                                                })()}
                                            </tfoot>
                                        </table>
                                    </div>
                                )}

                                {/* Total + Action */}
                                <div className="flex items-center justify-between pt-2">
                                    <span className="text-sm font-bold text-orange-600">Total: ${piTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    <button
                                        onClick={() => {
                                            setCurrentStep('CREATE_PROFORMA');
                                            setProformaViewMode('EDIT');
                                        }}
                                        className="flex items-center gap-1 px-4 py-1.5 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-lg text-xs font-bold hover:from-orange-600 hover:to-amber-600 shadow-md"
                                    >
                                        Create Proforma <ArrowRight size={14} />
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-center">
                                <div className="p-3 bg-slate-100 rounded-full mb-2">
                                    <FileCheck size={24} className="text-slate-300" />
                                </div>
                                <p className="text-xs text-slate-400">Upload a contract to see<br />extracted data here</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* RIGHT COLUMN: All Saved Contracts */}
                <div className="flex flex-col flex-1 min-w-0 p-4 border-2 border-slate-200 rounded-2xl bg-gradient-to-br from-slate-50 to-white overflow-hidden min-h-0">
                    <div className="flex items-center gap-2 mb-3">
                        <ClipboardList size={18} className="text-orange-600" />
                        <h4 className="font-bold text-slate-700 text-sm">Saved Contracts</h4>
                        <span className="ml-auto text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{savedContracts.length}</span>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-2">
                        {savedContracts.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-center py-8">
                                <ClipboardList size={32} className="text-slate-200 mb-2" />
                                <p className="text-xs text-slate-400">No contracts saved yet.<br />Upload one to get started.</p>
                            </div>
                        ) : savedContracts.map(contract => {
                            const sellerFirst = (contract.seller || '').split(/[\s,]/)[0];
                            const buyerFirst = (contract.buyer || '').split(/[\s,]/)[0];
                            const totalLbs = contract.items?.reduce((sum: number, it: any) => {
                                const qty = Number(it.quantity || 0);
                                const unit = (it.unit || 'KGS').toUpperCase();
                                return sum + (unit === 'KGS' || unit === 'KG' ? qty * 2.20462 : qty);
                            }, 0) || 0;
                            const totalKgs = contract.items?.reduce((sum: number, it: any) => {
                                const qty = Number(it.quantity || 0);
                                const unit = (it.unit || 'KGS').toUpperCase();
                                return sum + (unit === 'KGS' || unit === 'KG' ? qty : qty / 2.20462);
                            }, 0) || 0;
                            const fmtDate = (() => {
                                if (!contract.date) return '';
                                const d = new Date(contract.date);
                                if (isNaN(d.getTime())) return contract.date;
                                const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                                return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
                            })();

                            // Inline edit form
                            if (editingContractId === contract.id && editingContractData) {
                                return (
                                    <div key={contract.id} className="bg-white border-2 border-emerald-300 rounded-lg p-4 shadow-md">
                                        <div className="flex items-center justify-between mb-3">
                                            <span className="font-bold text-sm text-slate-800">✏️ Editing: {contract.contractNumber}</span>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={async () => {
                                                        const client = getSupabaseClient();
                                                        const total = editingContractData.items.reduce((s: number, it: any) => s + Number(it.amount || 0), 0);
                                                        const updateData = {
                                                            seller: editingContractData.seller,
                                                            buyer: editingContractData.buyer,
                                                            date: editingContractData.date,
                                                            pod: editingContractData.pod,
                                                            total,
                                                            items: editingContractData.items,
                                                        };
                                                        try {
                                                            await client.from('commission_sales_contracts').update(updateData).eq('id', contract.id);
                                                            setSavedContracts(prev => prev.map(c => c.id === contract.id ? { ...c, ...updateData } : c));
                                                            setEditingContractId(null);
                                                            setEditingContractData(null);
                                                        } catch (err) { console.error('Error saving contract:', err); }
                                                    }}
                                                    className="px-3 py-1 bg-emerald-500 text-white text-xs font-medium rounded hover:bg-emerald-600 flex items-center gap-1"
                                                >
                                                    <Save size={12} /> Save
                                                </button>
                                                <button
                                                    onClick={() => { setEditingContractId(null); setEditingContractData(null); }}
                                                    className="px-3 py-1 bg-slate-100 text-slate-600 text-xs font-medium rounded hover:bg-slate-200"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-4 gap-3 mb-3">
                                            <div>
                                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Seller</label>
                                                <select value={editingContractData.seller} onChange={e => setEditingContractData((d: any) => ({ ...d, seller: e.target.value }))} className="w-full text-xs border border-slate-200 rounded px-2 py-1.5">
                                                    <option value="">Select...</option>
                                                    {editingContractData.seller && !suppliers.some(s => s.name === editingContractData.seller) && <option value={editingContractData.seller}>{editingContractData.seller} (current)</option>}
                                                    {[...suppliers].sort((a, b) => a.name.localeCompare(b.name)).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Buyer</label>
                                                <select value={editingContractData.buyer} onChange={e => setEditingContractData((d: any) => ({ ...d, buyer: e.target.value }))} className="w-full text-xs border border-slate-200 rounded px-2 py-1.5">
                                                    <option value="">Select...</option>
                                                    {editingContractData.buyer && !customers.some(c => c.name === editingContractData.buyer) && <option value={editingContractData.buyer}>{editingContractData.buyer} (current)</option>}
                                                    {[...customers].sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Date</label>
                                                <input type="date" value={editingContractData.date} onChange={e => setEditingContractData((d: any) => ({ ...d, date: e.target.value }))} className="w-full text-xs border border-slate-200 rounded px-2 py-1.5" />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-semibold text-slate-500 uppercase">POD</label>
                                                <select value={editingContractData.pod || ''} onChange={e => setEditingContractData((d: any) => ({ ...d, pod: e.target.value }))} className="w-full text-xs border border-slate-200 rounded px-2 py-1.5">
                                                    <option value="">Select...</option>
                                                    {editingContractData.pod && !ports.some((p: any) => p.code === editingContractData.pod) && <option value={editingContractData.pod}>{editingContractData.pod} (current)</option>}
                                                    {[...ports].sort((a: any, b: any) => a.name.localeCompare(b.name)).map((p: any) => <option key={p.code} value={p.code}>{p.name} ({p.code})</option>)}
                                                </select>
                                            </div>
                                        </div>
                                        <div className="border-t border-slate-100 pt-2">
                                            <div className="grid grid-cols-[1fr_80px_70px_80px_90px_30px] gap-1 mb-1 text-[9px] font-semibold text-slate-400 uppercase px-1">
                                                <span>Description</span><span>Quantity</span><span>Unit</span><span>Price</span><span>Amount</span><span></span>
                                            </div>
                                            {editingContractData.items.map((item: any, idx: number) => (
                                                <div key={item.id || idx} className="grid grid-cols-[1fr_80px_70px_80px_90px_30px] gap-1 items-center mb-1">
                                                    <input value={item.description} onChange={e => { const items = [...editingContractData.items]; items[idx] = { ...items[idx], description: e.target.value }; setEditingContractData((d: any) => ({ ...d, items })); }} className="text-xs border border-slate-200 rounded px-2 py-1" />
                                                    <input type="number" value={item.quantity} onChange={e => { const items = [...editingContractData.items]; const qty = Number(e.target.value); items[idx] = { ...items[idx], quantity: qty, amount: qty * items[idx].unitPrice }; setEditingContractData((d: any) => ({ ...d, items })); }} className="text-xs border border-slate-200 rounded px-2 py-1 text-right" />
                                                    <select value={item.unit} onChange={e => { const items = [...editingContractData.items]; items[idx] = { ...items[idx], unit: e.target.value }; setEditingContractData((d: any) => ({ ...d, items })); }} className="text-xs border border-slate-200 rounded px-1 py-1">
                                                        <option value="KGS">KGS</option><option value="LBS">LBS</option>
                                                    </select>
                                                    <input type="number" step="0.01" value={item.unitPrice} onChange={e => { const items = [...editingContractData.items]; const price = Number(e.target.value); items[idx] = { ...items[idx], unitPrice: price, amount: items[idx].quantity * price }; setEditingContractData((d: any) => ({ ...d, items })); }} className="text-xs border border-slate-200 rounded px-2 py-1 text-right" />
                                                    <span className="text-xs font-medium text-right text-slate-700">${Number(item.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                                    <button onClick={() => { const items = editingContractData.items.filter((_: any, i: number) => i !== idx); setEditingContractData((d: any) => ({ ...d, items })); }} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button>
                                                </div>
                                            ))}
                                            <div className="flex justify-between items-center mt-2 px-1">
                                                <button onClick={() => { const items = [...editingContractData.items, { id: `item-${Date.now()}`, description: '', quantity: 0, unit: 'KGS', unitPrice: 0, amount: 0 }]; setEditingContractData((d: any) => ({ ...d, items })); }} className="text-xs text-emerald-600 hover:text-emerald-700 flex items-center gap-1"><Plus size={12} /> Add Item</button>
                                                <span className="text-xs font-bold text-orange-600">Total: US$ {editingContractData.items.reduce((s: number, it: any) => s + Number(it.amount || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            }

                            return (
                                <div
                                    key={contract.id}
                                    className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg hover:border-orange-300 hover:shadow-sm transition-all group cursor-pointer"
                                    onClick={() => loadMockContract(contract)}
                                >
                                    <span className="font-bold text-xs text-slate-800 whitespace-nowrap">{contract.contractNumber}</span>
                                    <span className="text-[11px] text-slate-500 whitespace-nowrap">{sellerFirst} → {buyerFirst}</span>
                                    {fmtDate && <span className="text-[10px] text-slate-400 whitespace-nowrap">{fmtDate}</span>}
                                    {contract.pod && <span className="text-[10px] text-blue-500 font-medium whitespace-nowrap">{contract.pod}</span>}
                                    {totalLbs > 0 && <span className="text-[10px] text-slate-400 whitespace-nowrap">{Math.round(totalLbs).toLocaleString()}lb · {Math.round(totalKgs).toLocaleString()}kg</span>}
                                    <span className="ml-auto text-xs font-bold text-orange-600 whitespace-nowrap">US$ {contract.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                // Normalize POD to port code
                                                let normalizedPod = contract.pod || '';
                                                if (normalizedPod) {
                                                    const exactPort = ports.find((p: any) => p.code === normalizedPod);
                                                    if (!exactPort) {
                                                        // Try extracting code from display format like "Pecem (BRPEC)"
                                                        const codeMatch = normalizedPod.match(/\(([A-Z]{5})\)/);
                                                        if (codeMatch) normalizedPod = codeMatch[1];
                                                        else {
                                                            const fuzzyPort = ports.find((p: any) => normalizedPod.toUpperCase().includes(p.code.toUpperCase()) || normalizedPod.toUpperCase().includes(p.name.toUpperCase()));
                                                            if (fuzzyPort) normalizedPod = fuzzyPort.code;
                                                        }
                                                    }
                                                }
                                                // Normalize seller/buyer to match dropdown values
                                                const matchedSeller = suppliers.find(s => s.name === contract.seller) || suppliers.find(s => s.name.toUpperCase().includes(contract.seller.split(/[\s,]/)[0].toUpperCase()));
                                                const matchedBuyer = customers.find(c => c.name === contract.buyer) || customers.find(c => c.name.toUpperCase().includes(contract.buyer.split(/[\s,]/)[0].toUpperCase()));
                                                setEditingContractId(contract.id);
                                                setEditingContractData({
                                                    seller: matchedSeller?.name || contract.seller,
                                                    buyer: matchedBuyer?.name || contract.buyer,
                                                    date: contract.date,
                                                    pod: normalizedPod,
                                                    items: contract.items.map(it => ({ ...it }))
                                                });
                                            }}
                                            className="p-1 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded hover:bg-emerald-100"
                                            title="Edit contract"
                                        >
                                            <Edit size={12} />
                                        </button>
                                        {contract.originalDocType && (
                                            <button
                                                onClick={async (e) => {
                                                    e.stopPropagation();
                                                    if (contract.originalDocUrl) {
                                                        setContractViewUrl(contract.originalDocUrl);
                                                        setContractViewTitle(contract.contractNumber);
                                                    } else {
                                                        try {
                                                            const client = getSupabaseClient();
                                                            const { data } = await client.from('commission_sales_contracts')
                                                                .select('originalDocument')
                                                                .eq('id', contract.id)
                                                                .single();
                                                            if (data?.originalDocument) {
                                                                setSavedContracts(prev => prev.map(c => c.id === contract.id ? { ...c, originalDocUrl: data.originalDocument } : c));
                                                                setContractViewUrl(data.originalDocument);
                                                                setContractViewTitle(contract.contractNumber);
                                                            }
                                                        } catch (err) { console.error('Error loading document:', err); }
                                                    }
                                                }}
                                                className="p-1 bg-blue-50 text-blue-600 border border-blue-200 rounded hover:bg-blue-100"
                                                title="View original document"
                                            >
                                                <Eye size={12} />
                                            </button>
                                        )}
                                        <button
                                            onClick={(e) => { e.stopPropagation(); loadMockContract(contract); }}
                                            className="p-1 bg-orange-50 text-orange-600 border border-orange-200 rounded hover:bg-orange-100"
                                            title="Load into proforma"
                                        >
                                            <ArrowRight size={12} />
                                        </button>
                                        <button
                                            onClick={async (e) => {
                                                e.stopPropagation();
                                                if (window.confirm(`Delete contract ${contract.contractNumber}?`)) {
                                                    setSavedContracts(prev => prev.filter(c => c.id !== contract.id));
                                                    try {
                                                        const client = getSupabaseClient();
                                                        await client.from('commission_sales_contracts').delete().eq('id', contract.id);
                                                    } catch (err) { console.error('Error deleting contract:', err); }
                                                }
                                            }}
                                            className="p-1 bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100"
                                            title="Delete contract"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${contract.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{contract.status}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Navigation */}
            <div className="flex justify-end mt-4">
                <button
                    onClick={() => setCurrentStep('UPLOAD_PL')}
                    className="flex items-center gap-2 px-5 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-all font-medium text-sm"
                >
                    Skip to Supplier PL <ArrowRight size={16} />
                </button>
            </div>
        </div>
    );

    // ========================================================================
    // STEP 2: CREATE PROFORMA
    // ========================================================================
    const loadSavedProforma = async (proforma: typeof savedProformas[0]) => {
        setEditingProformaId(proforma.id);
        setPiNumber(proforma.pi_number || '');
        setPiDate(proforma.pi_date || new Date().toISOString().split('T')[0]);
        setPiSeller(proforma.seller || '');
        setPiBuyer(proforma.buyer || '');
        setPiIncoterm(proforma.incoterm || '');
        setPiPaymentTerms(proforma.payment_terms || '');
        setPiPod(proforma.pod || '');
        const items = Array.isArray(proforma.items) ? proforma.items : [];
        const mappedItems = items.map((item: any) => ({
            id: item.id || `pi_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            description: item.description || '',
            translatedDescription: item.translatedDescription || '',
            quantity: item.quantity || 0,
            unit: item.unit || 'KGS',
            unitPrice: item.unitPrice || 0,
            amount: item.amount || 0,
        }));
        setPiItems(mappedItems);
        setPiTotal(proforma.total || 0);
        setPiSaved(true);
        setProformaViewMode('EDIT');
        setContractOcrDone(true);

        // Auto-translate if items have empty translations
        const hasEmptyTranslations = mappedItems.some(it => !it.translatedDescription || !it.translatedDescription.trim());
        if (mappedItems.length > 0 && hasEmptyTranslations) {
            const buyerName = proforma.buyer || '';
            const buyerMatch = customers.find((c: any) => c.name === buyerName);
            const buyerCountry = buyerMatch?.country || '';
            const targetCountry = buyerCountry || 'United States';
            console.log('[Saved Proforma Translation] Translating', mappedItems.length, 'items to', targetCountry);
            try {
                setTranslatingInProgress(true);
                const descs = mappedItems.map(it => it.description);
                const translated = await translateDescriptions(descs, targetCountry);
                if (translated.length > 0) {
                    setPiItems(prev => prev.map((item, i) => ({
                        ...item,
                        translatedDescription: translated[i] || item.description
                    })));
                    console.log('[Saved Proforma Translation] ✅ Translated', translated.length, 'items');
                }
            } catch (err) {
                console.error('[Saved Proforma Translation] ❌ Error:', err);
            }
            setTranslatingInProgress(false);
        }
    };

    const renderCreateProformaStep = () => (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 p-4">
            {/* List View */}
            {proformaViewMode === 'LIST' && (
                <div className="flex-1 flex flex-col overflow-hidden mb-4">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h3 className="text-xl font-bold text-slate-800">Saved Proformas</h3>
                            <p className="text-sm text-slate-500">Manage your generated proforma invoices</p>
                        </div>
                        <button
                            onClick={() => {
                                // Clear form for new PI
                                setPiNumber(`PI-${Date.now()}`);
                                setPiDate(new Date().toISOString().split('T')[0]);
                                setPiSeller('');
                                setPiBuyer('');
                                setPiIncoterm('');
                                setPiPaymentTerms('');
                                setPiPod('');
                                setPiItems([]);
                                setPiTotal(0);
                                setPiSaved(false);
                                setProformaViewMode('EDIT');
                            }}
                            className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl hover:bg-indigo-700 transition flex items-center gap-2 font-medium shadow-sm"
                        >
                            <Plus size={16} /> Create New Proforma
                        </button>
                    </div>

                    {savedProformas.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 border border-slate-200 border-dashed rounded-xl p-8">
                            <FileText size={48} className="text-slate-300 mb-4" />
                            <p className="text-slate-500 font-medium">No saved proformas found</p>
                            <p className="text-sm text-slate-400 mt-1">Process a contract or create a new proforma manually</p>
                        </div>
                    ) : (
                        <div className="flex-1 overflow-y-auto custom-scrollbar border border-slate-200 rounded-xl bg-white shadow-sm">
                            <table className="w-full text-left border-collapse text-sm">
                                <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                                    <tr>
                                        <th className="px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider border-b border-slate-200">Date</th>
                                        <th className="px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider border-b border-slate-200">PI Number</th>
                                        <th className="px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider border-b border-slate-200">Seller</th>
                                        <th className="px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider border-b border-slate-200">Buyer</th>
                                        <th className="px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider border-b border-slate-200">Incoterm</th>
                                        <th className="px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider border-b border-slate-200">POD</th>
                                        <th className="px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider border-b border-slate-200 text-right">Qty (LBS)</th>
                                        <th className="px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider border-b border-slate-200 text-right">Qty (KGS)</th>
                                        <th className="px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider border-b border-slate-200 text-right">Total</th>
                                        <th className="px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider border-b border-slate-200 text-center">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {savedProformas.map((pf) => {
                                        // Calculate total qty in LBS and KGS
                                        const items = Array.isArray(pf.items) ? pf.items : [];
                                        const totalKgs = items.reduce((sum: number, item: any) => {
                                            const qty = Number(item.quantity) || 0;
                                            const unit = (item.unit || 'KGS').toUpperCase();
                                            return sum + (unit === 'LBS' ? qty / 2.20462 : qty);
                                        }, 0);
                                        const totalLbs = items.reduce((sum: number, item: any) => {
                                            const qty = Number(item.quantity) || 0;
                                            const unit = (item.unit || 'KGS').toUpperCase();
                                            return sum + (unit === 'LBS' ? qty : qty * 2.20462);
                                        }, 0);
                                        // Format date as DD-MMM-YY
                                        const formatDateShort = (dateStr: string) => {
                                            if (!dateStr) return '—';
                                            const d = new Date(dateStr + 'T00:00:00');
                                            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                                            const dd = String(d.getDate()).padStart(2, '0');
                                            const mmm = months[d.getMonth()];
                                            const yy = String(d.getFullYear()).slice(-2);
                                            return `${dd}-${mmm}-${yy}`;
                                        };
                                        return (
                                            <tr key={pf.id} className="hover:bg-indigo-50/50 transition-colors cursor-pointer" onClick={() => loadSavedProforma(pf)}>
                                                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatDateShort(pf.pi_date)}</td>
                                                <td className="px-4 py-3 font-medium text-slate-800">{pf.pi_number}</td>
                                                <td className="px-4 py-3 text-slate-600 truncate max-w-[160px]">{pf.seller || '—'}</td>
                                                <td className="px-4 py-3 text-slate-600 truncate max-w-[160px]">{pf.buyer || '—'}</td>
                                                <td className="px-4 py-3 text-slate-600">{pf.incoterm || '—'}</td>
                                                <td className="px-4 py-3 text-slate-600 truncate max-w-[120px]">{(() => { const p = ports.find((pt: any) => pt.code === pf.pod); return p ? `${p.name} (${p.code})` : (pf.pod || '—'); })()}</td>
                                                <td className="px-4 py-3 text-right text-slate-600">{Math.round(totalLbs).toLocaleString()}</td>
                                                <td className="px-4 py-3 text-right text-slate-600">{Math.round(totalKgs).toLocaleString()}</td>
                                                <td className="px-4 py-3 text-right font-medium text-emerald-600">${(pf.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                                <td className="px-4 py-3 text-center">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                // Load proforma data into state, then generate PDF preview
                                                                loadSavedProforma(pf);
                                                                setTimeout(() => {
                                                                    try {
                                                                        const doc = generateCommissionProformaPDF();
                                                                        const pdfBlob = doc.output('blob');
                                                                        const pdfUrl = URL.createObjectURL(pdfBlob);
                                                                        setPreviewUrl(pdfUrl);
                                                                        setPreviewBlob(pdfBlob);
                                                                        setPreviewTitle(`Proforma Invoice - ${pf.pi_number}`);
                                                                        setPreviewFileName(`Proforma_${pf.pi_number}.pdf`);
                                                                    } catch (err) {
                                                                        console.error('[PI Preview] Error generating PDF:', err);
                                                                    }
                                                                }, 400);
                                                            }}
                                                            className="text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 p-1.5 rounded"
                                                            title="Download PDF"
                                                        >
                                                            <Eye size={16} />
                                                        </button>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                // Load this proforma then trigger email
                                                                loadSavedProforma(pf);
                                                                setTimeout(() => handleEmailProforma(), 300);
                                                            }}
                                                            className="text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 p-1.5 rounded"
                                                            title="Email"
                                                        >
                                                            <Mail size={16} />
                                                        </button>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); loadSavedProforma(pf); }}
                                                            className="text-slate-500 hover:text-slate-700 hover:bg-slate-100 p-1.5 rounded"
                                                            title="Edit Proforma"
                                                        >
                                                            <Edit size={16} />
                                                        </button>
                                                        <button
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                if (window.confirm(`Delete proforma ${pf.pi_number}?`)) {
                                                                    setSavedProformas(prev => prev.filter(p => p.id !== pf.id));
                                                                    try {
                                                                        const client = getSupabaseClient();
                                                                        await client.from('commissions_proformas').delete().eq('id', pf.id);
                                                                    } catch (err) { console.error('Error deleting proforma:', err); }
                                                                }
                                                            }}
                                                            className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded"
                                                            title="Delete Proforma"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
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

            {/* Edit View */}
            {proformaViewMode === 'EDIT' && (
                <>
                    <div className="mb-4 flex items-center justify-between">
                        <button
                            onClick={() => setProformaViewMode('LIST')}
                            className="flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors text-sm font-medium"
                        >
                            <ArrowLeft size={16} /> Back to Proformas
                        </button>
                        <div className="text-center flex-1">
                            <h3 className="text-xl font-bold text-slate-800">Proforma Invoice</h3>
                            <p className="text-sm text-slate-500">Review and edit the proforma before sending to the customer</p>
                        </div>
                        <div className="w-32" /> {/* Spacer for centering */}
                    </div>

                    {/* Proforma Form */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                        <div>
                            <label className="text-xs font-semibold text-slate-500 uppercase">PI Number</label>
                            <input value={piNumber} onChange={e => setPiNumber(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500" />
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-slate-500 uppercase">Date</label>
                            <input type="date" value={piDate} onChange={e => setPiDate(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500" />
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-slate-500 uppercase">Seller</label>
                            <select value={piSeller} onChange={e => setPiSeller(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500">
                                <option value="">Select Seller...</option>
                                {piSeller && !suppliers.some((s: any) => s.name === piSeller) && (
                                    <option value={piSeller}>{piSeller} (from contract)</option>
                                )}
                                {[...suppliers].sort((a: any, b: any) => a.name.localeCompare(b.name)).map((s: any) => <option key={s.id} value={s.name}>{s.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-slate-500 uppercase">Buyer</label>
                            <select value={piBuyer} onChange={e => {
                                const selectedName = e.target.value;
                                setPiBuyer(selectedName);
                                // Auto-populate POD from customer data, normalized against ports table
                                const cust = customers.find(c => c.name === selectedName);
                                if (cust && cust.pod) {
                                    const rawPod = cust.pod;
                                    const matchedPort = ports.find((p: any) => {
                                        const podUpper = rawPod.toUpperCase();
                                        return podUpper.includes(p.name.toUpperCase()) || podUpper.includes(p.code.toUpperCase()) || (p.portCode && podUpper.includes(p.portCode.toUpperCase()));
                                    });
                                    setPiPod(matchedPort ? matchedPort.code : rawPod);
                                }
                            }}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500">
                                <option value="">Select Buyer...</option>
                                {piBuyer && !customers.some(c => c.name === piBuyer) && (
                                    <option value={piBuyer}>{piBuyer} (from contract)</option>
                                )}
                                {[...customers].sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-slate-500 uppercase">Incoterm</label>
                            <select value={piIncoterm} onChange={e => setPiIncoterm(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500">
                                <option value="">Select...</option>
                                {piIncoterm && !['EXW', 'FCA', 'CPT', 'CIP', 'DAT', 'DAP', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF'].includes(piIncoterm.toUpperCase()) && (
                                    <option value={piIncoterm}>{piIncoterm} (from contract)</option>
                                )}
                                {['EXW', 'FCA', 'CPT', 'CIP', 'DAT', 'DAP', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF'].map(i => <option key={i} value={i}>{i}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-slate-500 uppercase">Payment Terms</label>
                            <select value={piPaymentTerms} onChange={e => setPiPaymentTerms(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500">
                                <option value="">Select...</option>
                                {piPaymentTerms && !PAYMENT_TERM_OPTIONS.includes(piPaymentTerms) && availablePaymentTerms.length === 0 && (
                                    <option value={piPaymentTerms}>{piPaymentTerms} (from contract)</option>
                                )}
                                {(() => {
                                    const dbTerms = (availablePaymentTerms || []).filter((t: any) => t.active !== false);
                                    const dbDescs = new Set(dbTerms.map((t: any) => t.description));
                                    const fallback = PAYMENT_TERM_OPTIONS.filter(o => !dbDescs.has(o)).map(o => ({ description: o, code: o }));
                                    return [...dbTerms, ...fallback].map((t: any) => (
                                        <option key={t.code || t.description} value={t.description}>{t.description}</option>
                                    ));
                                })()}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-slate-500 uppercase">POD (Port of Destination)</label>
                            <select value={piPod} onChange={e => setPiPod(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500">
                                <option value="">Select Port...</option>
                                {piPod && !ports.some(p => p.code === piPod || p.name === piPod || `${p.name} (${p.code})` === piPod) && (
                                    <option value={piPod}>{piPod} (from contract)</option>
                                )}
                                {[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                                    <option key={p.id} value={p.code}>{p.name} ({p.code})</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Items Table */}
                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex-1 flex flex-col min-h-0">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-gradient-to-r from-orange-50 to-amber-50 border-b border-slate-200">
                                    <th className="p-3 text-left text-xs font-semibold text-slate-600 uppercase">Original Description</th>
                                    <th className="p-3 text-left text-xs font-semibold uppercase">{translatingInProgress ? <span className="text-orange-500 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Translation in progress...</span> : <span className="text-slate-600">Translated Description</span>}</th>
                                    <th className="p-3 text-right text-xs font-semibold text-slate-600 uppercase w-28">Quantity</th>
                                    <th className="p-3 text-center text-xs font-semibold text-slate-600 uppercase w-20">Unit</th>
                                    <th className="p-3 text-right text-xs font-semibold text-slate-600 uppercase w-24">Unit Price</th>
                                    <th className="p-3 text-right text-xs font-semibold text-slate-600 uppercase w-28">Amount</th>
                                    <th className="p-3 w-8"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {piItems.map((item, idx) => (
                                    <tr key={item.id} className="border-b border-slate-100 hover:bg-orange-50/30">
                                        <td className="p-2">
                                            <input value={item.description}
                                                onChange={e => {
                                                    const updated = [...piItems];
                                                    updated[idx] = { ...item, description: e.target.value };
                                                    setPiItems(updated);
                                                }}
                                                className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm" />
                                        </td>
                                        <td className="p-2">
                                            <input value={item.translatedDescription || ''}
                                                onChange={e => {
                                                    const updated = [...piItems];
                                                    updated[idx] = { ...item, translatedDescription: e.target.value };
                                                    setPiItems(updated);
                                                }}
                                                className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm text-slate-600 italic" />
                                        </td>
                                        <td className="p-2">
                                            <input type="text" value={item.quantity ? item.quantity.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : ''}
                                                onChange={e => {
                                                    const raw = e.target.value.replace(/,/g, '');
                                                    const qty = Number(raw) || 0;
                                                    const updated = [...piItems];
                                                    updated[idx] = { ...item, quantity: qty, amount: qty * item.unitPrice };
                                                    setPiItems(updated);
                                                    setPiTotal(updated.reduce((s, i) => s + i.amount, 0));
                                                }}
                                                className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm text-right" />
                                        </td>
                                        <td className="p-2">
                                            <select value={item.unit}
                                                onChange={e => {
                                                    const updated = [...piItems];
                                                    updated[idx] = { ...item, unit: e.target.value };
                                                    setPiItems(updated);
                                                }}
                                                className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm text-center">
                                                <option value="KGS">KGS</option>
                                                <option value="LBS">LBS</option>
                                                <option value="PCS">PCS</option>
                                            </select>
                                        </td>
                                        <td className="p-2">
                                            <input type="number" step="0.01" value={item.unitPrice || ''}
                                                onChange={e => {
                                                    const price = Number(e.target.value) || 0;
                                                    const updated = [...piItems];
                                                    updated[idx] = { ...item, unitPrice: price, amount: item.quantity * price };
                                                    setPiItems(updated);
                                                    setPiTotal(updated.reduce((s, i) => s + i.amount, 0));
                                                }}
                                                className="w-full px-2 py-1.5 border border-slate-200 rounded text-sm text-right" />
                                        </td>
                                        <td className="p-2 text-right font-bold text-slate-700">
                                            ${item.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </td>
                                        <td className="p-2">
                                            <button onClick={() => { setPiItems(piItems.filter((_, i) => i !== idx)); setPiTotal(piItems.filter((_, i) => i !== idx).reduce((s, i) => s + i.amount, 0)); }}
                                                className="p-1 text-red-400 hover:text-red-600 rounded"><Trash2 size={14} /></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                {(() => {
                                    const totalQty = piItems.reduce((s, i) => s + i.quantity, 0);
                                    const avgPrice = totalQty > 0 ? piTotal / totalQty : 0;
                                    return (
                                        <tr className="bg-gradient-to-r from-orange-50 to-amber-50 border-t-2 border-orange-200">
                                            <td colSpan={7} className="p-3">
                                                <div className="flex items-center justify-end gap-6 whitespace-nowrap">
                                                    <span className="font-bold text-slate-700 uppercase text-xs">Totals:</span>
                                                    <span className="font-bold text-sm text-slate-800">{totalQty.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KGS</span>
                                                    <span className="font-medium text-xs text-slate-600">Avg: ${avgPrice.toFixed(4)}/KG</span>
                                                    <span className="font-bold text-lg text-orange-600">${piTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })()}
                            </tfoot>
                        </table>
                    </div>

                    {/* Add Item Button */}
                    <button
                        onClick={() => setPiItems([...piItems, { id: `pi_${Date.now()}`, description: '', translatedDescription: '', quantity: 0, unit: 'KGS', unitPrice: 0, amount: 0 }])}
                        className="flex items-center gap-2 mt-2 px-4 py-2 text-sm text-orange-600 hover:bg-orange-50 rounded-lg transition-colors font-medium"
                    >
                        <Plus size={16} /> Add Item
                    </button>

                    {/* Navigation & Actions */}
                    <div className="flex justify-between items-center pt-4 mt-4 border-t border-slate-200">
                        <button
                            onClick={() => setCurrentStep('UPLOAD_CONTRACT')}
                            className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:text-slate-800 transition-colors"
                        >
                            <ArrowLeft size={16} /> Back to Contract
                        </button>
                        {/* 50% / BR Price Adjustment */}
                        <div className="flex items-center gap-2 ml-2">
                            <label className="flex items-center gap-1 cursor-pointer" title="50% of original price">
                                <input type="checkbox" checked={brPriceAdjustment === '50'} onChange={(e) => setBrPriceAdjustment(e.target.checked ? '50' : 'none')} className="w-3.5 h-3.5 accent-amber-600 rounded" />
                                <span className="text-xs font-bold text-amber-700">50%</span>
                            </label>
                            <label className="flex items-center gap-1 cursor-pointer" title="$0.28/KG fixed">
                                <input type="checkbox" checked={brPriceAdjustment === 'br'} onChange={(e) => setBrPriceAdjustment(e.target.checked ? 'br' : 'none')} className="w-3.5 h-3.5 accent-amber-600 rounded" />
                                <span className="text-xs font-bold text-amber-700">BR</span>
                            </label>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => {
                                    if (piItems.length === 0) return;
                                    handleSaveProforma();
                                    try {
                                        const doc = generateCommissionProformaPDF(brPriceAdjustment);
                                        const pdfBlob = doc.output('blob');
                                        const pdfUrl = URL.createObjectURL(pdfBlob);
                                        const fileName = `Proforma_${piNumber || 'Draft'}.pdf`;
                                        setPreviewUrl(pdfUrl);
                                        setPreviewBlob(pdfBlob);
                                        setPreviewTitle(`Proforma Invoice - ${piNumber || 'Draft'}`);
                                        setPreviewFileName(fileName);
                                        setPreviewDownloadFn(() => () => saveWithPicker(doc, fileName));
                                    } catch (err) {
                                        console.error('[PI Preview] Error generating PDF:', err);
                                    }
                                }}
                                disabled={piItems.length === 0}
                                className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all disabled:opacity-50 font-medium"
                            >
                                <Eye size={16} /> Download
                            </button>
                            <button
                                onClick={() => { handleSaveProforma(); handleEmailProforma(); }}
                                disabled={piItems.length === 0}
                                className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all disabled:opacity-50 font-medium"
                            >
                                <Mail size={16} /> Email
                            </button>
                            <button
                                onClick={handleSaveProforma}
                                disabled={piItems.length === 0}
                                className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all disabled:opacity-50 font-medium"
                            >
                                <Save size={16} /> Save
                            </button>
                            <button
                                onClick={() => setCurrentStep('UPLOAD_PL')}
                                className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-all shadow-lg font-medium"
                            >
                                Continue to Supplier PL <ArrowRight size={16} />
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );

    // ========================================================================
    // COMMISSION PACKING LIST HANDLERS
    // ========================================================================
    const handleCommPLFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        for (let i = 0; i < files.length; i++) {
            await processCommPLFile(files[i]);
        }
        e.target.value = '';
    };

    const handleCommPLDrop = async (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setCommPLDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            for (let i = 0; i < e.dataTransfer.files.length; i++) {
                await processCommPLFile(e.dataTransfer.files[i]);
            }
            e.dataTransfer.clearData();
        }
    };

    const processCommPLFile = async (file: File) => {
        setCommPLProcessing(true);
        setCommPLStatusMessage(`Processing: ${file.name}...`);

        try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (event) => resolve(event.target?.result as string);
                reader.onerror = () => reject(new Error('Failed to read file'));
                reader.readAsDataURL(file);
            });

            const rawBase64 = dataUrl.split(',')[1];
            const mimeType = file.type || 'application/pdf';

            // OCR the packing list using Gemini
            const prompt = `
                Analyze this Packing List document from a commission sale.
                Task: Extract shipping data into a structured JSON format.
                
                1. Find the "Booking Number" or "Booking Ref".
                   - CRITICAL: Check for the text "CUSTOMER TRUCK". If found, the Booking Number is the value immediately BELOW "CUSTOMER TRUCK".
                2. Find the "Sales Order Number" or "SO Number" or "Order No" or "PO Number".
                3. Find the Supplier / Shipper / Manufacturer name.
                4. Find the Consignee / Customer name.
                5. Extract line items — ONE ITEM PER PRODUCT/MATERIAL listed.
                   - For each product/material line, extract:
                      - Container Number
                      - Seal Number
                      - Gross Weight (LBS and KG)
                      - Net Weight (LBS and KG) 
                      - Volume / Quantity (Bales, Cartons, Pallets) -> field "volumes"
                      - Product Description
                
                Logic:
                - If weights are only in KG, convert to LBS (1 KG = 2.20462 LBS).
                - If weights are only in LBS, convert to KG (1 LBS = 0.453592 KG).
                - Ensure numeric values are numbers, not strings.
                
                Return JSON object:
                {
                    "bookingNumber": "string",
                    "soNumber": "string",
                    "supplier": "string",
                    "consignee": "string",
                    "items": [
                        {
                            "containerNo": "string",
                            "sealNo": "string",
                            "grossLbs": number,
                            "netLbs": number,
                            "grossKg": number,
                            "netKg": number,
                            "volumes": number,
                            "description": "string"
                        }
                    ]
                }
            `;

            const result = await analyzeDocument(rawBase64, mimeType, prompt);
            console.log('[CommPL OCR] Raw result:', result);
            const cleanJson = result.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsedData = JSON.parse(cleanJson);

            // Save to commission_packing_lists table
            const client = getSupabaseClient();
            if (!client) throw new Error('No database connection');

            const items = parsedData.items || [];
            const totalGrossLbs = items.reduce((s: number, i: any) => s + (i.grossLbs || 0), 0);
            const totalNetLbs = items.reduce((s: number, i: any) => s + (i.netLbs || 0), 0);
            const totalVolumes = items.reduce((s: number, i: any) => s + (i.volumes || 0), 0);
            const containerNos = [...new Set(items.map((i: any) => i.containerNo).filter(Boolean))].join(', ');
            const sealNos = [...new Set(items.map((i: any) => i.sealNo).filter(Boolean))].join(', ');

            // Generate PL number
            const date = new Date();
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const dd = String(date.getDate()).padStart(2, '0');
            const yy = String(date.getFullYear()).slice(-2);
            const commPlNumber = `CPL-${mm}${dd}${yy}-${Date.now().toString().slice(-4)}`;

            const newCommPL = {
                id: `CPL${Date.now()}`,
                companyId: currentCompanyId,
                createdAt: new Date().toISOString(),
                bookingNumber: parsedData.bookingNumber || '',
                soNumber: parsedData.soNumber || '',
                plNumber: commPlNumber,
                supplier: parsedData.supplier || '',
                consignee: parsedData.consignee || '',
                customerName: parsedData.consignee || '',
                containerNumber: containerNos,
                sealNumber: sealNos,
                grossWeight: totalGrossLbs.toString(),
                netWeight: totalNetLbs.toString(),
                volumes: totalVolumes.toString(),
                items: JSON.stringify(items),
                originalDocument: dataUrl,
                status: 'AVAILABLE'
            };

            const { error } = await client.from('commission_packing_lists').insert(newCommPL);
            if (error) throw error;

            // Refresh list (without originalDocument for performance)
            const { id: _id, originalDocument: _doc, ...listItem } = newCommPL;
            setCommissionPLs(prev => [{ id: newCommPL.id, ...listItem }, ...prev]);

            setCommPLStatusMessage(`✅ Saved: ${commPlNumber}`);
            setTimeout(() => setCommPLStatusMessage(''), 2500);
        } catch (err: any) {
            console.error('[CommPL] Error processing file:', err);
            setCommPLStatusMessage(`❌ Error: ${err.message || 'Processing failed'}`);
            setTimeout(() => setCommPLStatusMessage(''), 3000);
        } finally {
            setCommPLProcessing(false);
        }
    };

    const handleDeleteCommPL = async (pl: any) => {
        if (!window.confirm(`Delete commission PL ${pl.plNumber}?`)) return;
        const client = getSupabaseClient();
        if (!client) return;
        try {
            await client.from('commission_packing_lists').delete().eq('id', pl.id);
            setCommissionPLs(prev => prev.filter(p => p.id !== pl.id));
        } catch (err) {
            console.error('[CommPL] Delete error:', err);
            alert('Failed to delete commission PL');
        }
    };

    const handleViewCommPLDocument = async (pl: any) => {
        const client = getSupabaseClient();
        if (!client) return;
        try {
            const { data } = await client.from('commission_packing_lists').select('originalDocument').eq('id', pl.id).single();
            if (data && data.originalDocument) {
                const blobUrl = data.originalDocument.startsWith('data:') ? data.originalDocument : `data:application/pdf;base64,${data.originalDocument}`;
                setPreviewUrl(blobUrl);
                setPreviewTitle(`Commission PL - ${pl.plNumber}`);
                setPreviewFileName(`${pl.plNumber}.pdf`);
            } else {
                alert('No document found for this PL');
            }
        } catch (err) {
            console.error('[CommPL] View error:', err);
            alert('Failed to load document');
        }
    };

    const handleLoadCommPLToEditor = (pl: any) => {
        // Load commission PL data into the PL editor (same flow as regular PLs)
        resetPLState();
        try {
            const parsedItems = JSON.parse(pl.items || '[]');
            setPlItems(parsedItems.map((item: any, idx: number) => ({
                id: `item_${Date.now()}_${idx}`,
                containerNo: item.containerNo || '',
                sealNo: item.sealNo || '',
                grossLbs: item.grossLbs || 0,
                netLbs: item.netLbs || 0,
                grossKg: item.grossKg || 0,
                netKg: item.netKg || 0,
                volumes: item.volumes || 0,
                supplier: pl.supplier || item.supplier || '',
                description: item.description || '',
                blNumber: pl.bookingNumber || '',
                productId: item.productId || ''
            })));
            setPlNumber(pl.plNumber || '');
            setSoNumber(pl.soNumber || '');
            setBookingNumber(pl.bookingNumber || '');
            setSupplier(pl.supplier || '');
            setConsignee(pl.consignee || pl.customerName || '');
            setContainerNumber(pl.containerNumber || '');
            setSealNumber(pl.sealNumber || '');
            setGrossWeight(pl.grossWeight || '');
            setNetWeight(pl.netWeight || '');
            setUnitCount(pl.volumes || '');
            setCurrentStep('EDIT_PL');
        } catch (e) {
            console.error('[CommPL] Error loading to editor:', e);
            alert('Error loading PL data');
        }
    };

    // ========================================================================
    // STEP 3: UPLOAD (Supplier PL)
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
            // Carry booking number from PL into invoice transport ref
            if (pl.blNumber) setTransportRef(pl.blNumber);

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

            {/* Commission Packing Lists - Upload & Table */}
            <div className="p-4 border-2 border-dashed border-orange-300 rounded-2xl bg-gradient-to-br from-orange-50/50 to-amber-50/30 mb-4">
                <div className="flex items-center gap-2 mb-3">
                    <Package size={20} className="text-orange-600" />
                    <h4 className="font-bold text-orange-800 text-sm">Commission Packing Lists</h4>
                    <span className="ml-auto text-xs bg-orange-200 text-orange-700 px-2 py-0.5 rounded-full font-medium">{commissionPLs.length}</span>
                </div>

                {/* Hidden file input */}
                <input
                    ref={commPLFileInputRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={handleCommPLFileSelect}
                    multiple
                    className="hidden"
                />

                {/* Drop Zone */}
                <div
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setCommPLDragActive(true); }}
                    onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setCommPLDragActive(false); }}
                    onDrop={handleCommPLDrop}
                    onClick={() => commPLFileInputRef.current?.click()}
                    className={`flex items-center justify-center gap-3 p-4 mb-3 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
                        commPLDragActive
                            ? 'border-orange-500 bg-orange-100/70 scale-[1.01]'
                            : 'border-orange-200 bg-white/60 hover:border-orange-400 hover:bg-orange-50/50'
                    }`}
                >
                    {commPLProcessing ? (
                        <>
                            <Loader2 size={22} className="text-orange-500 animate-spin" />
                            <span className="text-sm font-medium text-orange-700">{commPLStatusMessage}</span>
                        </>
                    ) : (
                        <>
                            <Upload size={20} className="text-orange-400" />
                            <span className="text-sm text-orange-600">
                                <span className="font-semibold">Drop or click</span> to upload supplier packing list (PDF / Image)
                            </span>
                        </>
                    )}
                </div>

                {/* Status Message */}
                {commPLStatusMessage && !commPLProcessing && (
                    <p className="text-xs text-orange-600 mb-2 animate-pulse font-medium">{commPLStatusMessage}</p>
                )}

                {/* Saved Commission PLs Table */}
                {commissionPLs.length > 0 && (
                    <div className="overflow-y-auto max-h-48">
                        <table className="w-full text-xs">
                            <thead className="bg-orange-100/60 sticky top-0">
                                <tr>
                                    <th className="text-left px-2 py-1 font-semibold text-orange-700">Date</th>
                                    <th className="text-left px-2 py-1 font-semibold text-orange-700">PL #</th>
                                    <th className="text-left px-2 py-1 font-semibold text-orange-700">Supplier</th>
                                    <th className="text-left px-2 py-1 font-semibold text-orange-700">Booking #</th>
                                    <th className="text-right px-2 py-1 font-semibold text-orange-700">Net LBS</th>
                                    <th className="text-center px-2 py-1 font-semibold text-orange-700">Status</th>
                                    <th className="text-center px-2 py-1 font-semibold text-orange-700">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {commissionPLs.slice(0, 20).map(pl => (
                                    <tr key={pl.id} className="hover:bg-orange-50/50 transition-colors border-b border-orange-100/50">
                                        <td className="px-2 py-1 text-slate-500">
                                            {pl.createdAt ? new Date(pl.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}
                                        </td>
                                        <td className="px-2 py-1 font-medium text-slate-700">{pl.plNumber || '-'}</td>
                                        <td className="px-2 py-1 text-slate-600 truncate max-w-[120px]">
                                            {(pl.supplier || '-').split(' ').slice(0, 2).join(' ')}
                                        </td>
                                        <td className="px-2 py-1 text-blue-600 font-mono">{pl.bookingNumber || '-'}</td>
                                        <td className="px-2 py-1 text-right font-mono text-slate-700">
                                            {Number(pl.netWeight || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                        </td>
                                        <td className="px-2 py-1 text-center">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                                pl.status === 'INVOICED' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                                            }`}>
                                                {pl.status || 'AVAILABLE'}
                                            </span>
                                        </td>
                                        <td className="px-2 py-1 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <button
                                                    onClick={() => handleViewCommPLDocument(pl)}
                                                    title="View Original Document"
                                                    className="p-0.5 rounded hover:bg-orange-100 text-orange-500 transition-colors"
                                                >
                                                    <Eye size={13} />
                                                </button>
                                                <button
                                                    onClick={() => handleLoadCommPLToEditor(pl)}
                                                    title="Edit in PL Editor"
                                                    className="p-0.5 rounded hover:bg-indigo-100 text-indigo-600 transition-colors"
                                                >
                                                    <Edit3 size={13} />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteCommPL(pl)}
                                                    title="Delete"
                                                    className="p-0.5 rounded hover:bg-red-100 text-red-500 transition-colors"
                                                >
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Commission Saved PLs and Commission Saved Invoices - Side by Side */}
            <div className="grid grid-cols-1 lg:grid-cols-10 gap-4 flex-1 min-h-0">
                {/* Commission Saved PLs - 3/10 width (30%) */}
                <div className="lg:col-span-3 p-4 border-2 border-orange-200 rounded-2xl bg-gradient-to-br from-orange-50/30 to-white flex flex-col overflow-hidden">
                    <div className="flex items-center gap-2 mb-2">
                        <Package size={18} className="text-orange-600" />
                        <h4 className="font-bold text-orange-800 text-sm">Commission Saved PLs</h4>
                        <span className="ml-auto text-xs bg-orange-200 text-orange-700 px-2 py-0.5 rounded-full font-medium">{commissionPLs.length}</span>
                    </div>
                    <div className="flex-1 overflow-y-auto min-h-0 max-h-[calc(100vh-22rem)]">
                        {commissionPLs.length === 0 ? (
                            <p className="text-xs text-slate-400 text-center py-4">No commission PLs yet. Upload one above.</p>
                        ) : (
                            <table className="w-full text-xs">
                                <thead className="bg-orange-100/60 sticky top-0">
                                    <tr>
                                        <th className="text-left px-1 py-0.5 font-semibold text-orange-700">Date</th>
                                        <th className="text-left px-1 py-0.5 font-semibold text-orange-700">PL #</th>
                                        <th className="text-left px-1 py-0.5 font-semibold text-orange-700">Supplier</th>
                                        <th className="text-left px-1 py-0.5 font-semibold text-orange-700">Status</th>
                                        <th className="text-center px-1 py-0.5 font-semibold text-orange-700">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {commissionPLs.slice(0, 30).map(pl => (
                                        <tr key={pl.id} className="hover:bg-orange-50/50 transition-colors border-b border-orange-100/50">
                                            <td className="px-1 py-0.5 text-slate-500">{pl.createdAt ? new Date(pl.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}</td>
                                            <td className="px-1 py-0.5 font-medium text-slate-700">{pl.plNumber || '-'}</td>
                                            <td className="px-1 py-0.5 text-slate-600 truncate max-w-[100px]">{(pl.supplier || '-').split(' ').slice(0, 2).join(' ')}</td>
                                            <td className="px-1 py-0.5">
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                                    pl.status === 'INVOICED' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                                                }`}>
                                                    {pl.status || 'AVAILABLE'}
                                                </span>
                                            </td>
                                            <td className="px-1 py-0.5 text-center">
                                                <div className="flex items-center justify-center gap-1">
                                                    <button
                                                        onClick={() => handleViewCommPLDocument(pl)}
                                                        title="View Original Document"
                                                        className="p-0.5 rounded hover:bg-orange-100 text-orange-500 transition-colors"
                                                    >
                                                        <Eye size={13} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleLoadCommPLToEditor(pl)}
                                                        title="Edit in PL Editor"
                                                        className="p-0.5 rounded hover:bg-indigo-100 text-indigo-600 transition-colors"
                                                    >
                                                        <Edit3 size={13} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteCommPL(pl)}
                                                        title="Delete"
                                                        className="p-0.5 rounded hover:bg-red-100 text-red-500 transition-colors"
                                                    >
                                                        <Trash2 size={13} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

                {/* Commission Saved Invoices - 7/10 width (70%) */}
                <div className="lg:col-span-7 p-4 border-2 border-teal-200 rounded-2xl bg-gradient-to-br from-teal-50/30 to-white flex flex-col overflow-hidden">
                    <div className="flex items-center gap-2 mb-2">
                        <FileSpreadsheet size={20} className="text-teal-600" />
                        <h4 className="font-bold text-teal-800">Commission Saved Invoices</h4>
                        <span className="ml-auto text-xs bg-teal-200 text-teal-700 px-2 py-0.5 rounded-full font-medium">{commissionInvoices.length}</span>
                    </div>
                    <div className="flex-1 overflow-y-auto min-h-0 max-h-[calc(100vh-22rem)]">
                        <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-white z-10">
                                <tr className="border-b border-teal-200">
                                    <th className="text-left py-1 font-bold text-teal-700">Date</th>
                                    <th className="text-left py-1 font-bold text-teal-700">Invoice #</th>
                                    <th className="text-left py-1 font-bold text-teal-700">Seller</th>
                                    <th className="text-left py-1 font-bold text-teal-700">Customer</th>
                                    <th className="text-left py-1 font-bold text-teal-700">Booking #</th>
                                    <th className="text-right py-1 font-bold text-teal-700">Total</th>
                                    <th className="text-center py-1 font-bold text-teal-700">Status</th>
                                    <th className="text-center py-1 font-bold text-teal-700">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {commissionInvoices.length === 0 ? (
                                    <tr><td colSpan={8} className="text-center py-4 text-slate-400">No commission invoices yet. Upload one on the Commission Invoice step.</td></tr>
                                ) : commissionInvoices.slice(0, 30).map(inv => (
                                    <tr key={inv.id} className="border-b border-teal-100/50 hover:bg-teal-50/50 transition-colors">
                                        <td className="py-0.5 text-slate-500">
                                            {inv.invoiceDate ? new Date(inv.invoiceDate.replace(/-/g, '/')).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : inv.createdAt ? new Date(inv.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}
                                        </td>
                                        <td className="py-0.5 text-slate-700 font-medium">{inv.invoiceNumber || '-'}</td>
                                        <td className="py-0.5 text-slate-600 truncate max-w-[120px]">{(inv.sellerName || '-').split(' ').slice(0, 2).join(' ')}</td>
                                        <td className="py-0.5 text-slate-600 truncate max-w-[120px]">{(inv.customerName || '-').split(' ').slice(0, 2).join(' ')}</td>
                                        <td className="py-0.5 text-blue-600 font-mono">{inv.bookingNumber || '-'}</td>
                                        <td className="py-0.5 text-emerald-600 font-medium text-right">{inv.currency || '$'} {Number(inv.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                        <td className="py-0.5 text-center">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                                inv.status === 'PAID' ? 'bg-emerald-100 text-emerald-700' : inv.status === 'SENT' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                                            }`}>
                                                {inv.status || 'AVAILABLE'}
                                            </span>
                                        </td>
                                        <td className="py-0.5 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <button
                                                    onClick={() => handleViewCommInvDocument(inv)}
                                                    title="View Original Document"
                                                    className="p-0.5 rounded hover:bg-teal-100 text-teal-500 transition-colors"
                                                >
                                                    <Eye size={13} />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteCommInv(inv)}
                                                    title="Delete"
                                                    className="p-0.5 rounded hover:bg-red-100 text-red-500 transition-colors"
                                                >
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
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
                            {salesOrders.filter(so => so.status !== 'FULFILLED').map(so => {
                                const soDate = so.orderDate ? new Date(so.orderDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
                                const firstName = so.customerName ? so.customerName.split(' ')[0].split(',')[0] : '';
                                const material = so.items?.[0]?.productName || '';
                                const label = [soDate, so.orderNumber, firstName, material].filter(Boolean).join(' | ');
                                return (
                                    <option key={so.id} value={so.orderNumber}>
                                        {label}
                                    </option>
                                );
                            })}
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
                                    {allBookings.filter((b: any) => b.status === 'AVAILABLE').map((b: any) => (
                                        <option key={b.id} value={b.bookingNumber}>{b.bookingNumber}</option>
                                    ))}
                                    {bookingNumber && !allBookings.filter((b: any) => b.status === 'AVAILABLE').find((b: any) => b.bookingNumber === bookingNumber) && (
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
                                        <td className="p-2">
                                            <input
                                                type="number"
                                                step="any"
                                                value={item.grossKg || ''}
                                                onChange={(e) => updateItem(item.id, 'grossKg', e.target.value === '' ? 0 : Number(e.target.value))}
                                                className="w-24 px-2 py-1 border border-slate-200 rounded text-sm text-right font-mono"
                                            />
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
                                        <td className="p-2">
                                            <input
                                                type="number"
                                                step="any"
                                                value={item.netKg || ''}
                                                onChange={(e) => updateItem(item.id, 'netKg', e.target.value === '' ? 0 : Number(e.target.value))}
                                                className="w-24 px-2 py-1 border border-slate-200 rounded text-sm text-right font-mono"
                                            />
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
                                    <td className="p-3 text-right font-mono">{totals.grossLbs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td className="p-3 text-right font-mono text-slate-500">{totals.grossKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td className="p-3 text-right font-mono">{totals.netLbs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
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
                    onClick={() => setCurrentStep('UPLOAD_PL')}
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
                        disabled={!canProceedToInvoice()}
                        className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Create Commission Invoice <ArrowRight size={16} />
                    </button>
                </div>
            </div>
        </div >
    );


    // ========================================================================
    // COMMISSION CUSTOMER INVOICE HANDLERS
    // ========================================================================
    const handleCommInvFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        for (let i = 0; i < files.length; i++) {
            await processCommInvFile(files[i]);
        }
        e.target.value = '';
    };

    const handleCommInvDrop = async (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setCommInvDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            for (let i = 0; i < e.dataTransfer.files.length; i++) {
                await processCommInvFile(e.dataTransfer.files[i]);
            }
            e.dataTransfer.clearData();
        }
    };

    const processCommInvFile = async (file: File) => {
        setCommInvProcessing(true);
        setCommInvStatusMessage(`Processing: ${file.name}...`);

        try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (event) => resolve(event.target?.result as string);
                reader.onerror = () => reject(new Error('Failed to read file'));
                reader.readAsDataURL(file);
            });

            const rawBase64 = dataUrl.split(',')[1];
            const mimeType = file.type || 'application/pdf';

            // OCR the invoice using Gemini
            const prompt = `
                Analyze this commercial INVOICE document from a commission sale.
                Extract the key information into a structured JSON object.

                RULES:
                1. Return ONLY a valid JSON object. No commentary.
                2. If a field is not found, return empty string "".
                3. Parse each product row into the "items" array.
                4. Identify the unit of measure (LBS or KGS). If not specified, assume LBS.
                5. Look for shipping info: booking number, container numbers, vessel.
                6. For ports, extract the full port name.

                Return JSON object:
                {
                    "invoiceNumber": "string",
                    "invoiceDate": "string (YYYY-MM-DD format)",
                    "sellerName": "string (Seller/Shipper)",
                    "customerName": "string (Buyer/Consignee)",
                    "incoterm": "string (e.g. FOB, CIF, CFR)",
                    "paymentTerms": "string",
                    "pol": "string (Port of Loading)",
                    "pod": "string (Port of Discharge)",
                    "bookingNumber": "string",
                    "soNumber": "string (Sales Order / PO reference)",
                    "plNumber": "string (Packing List reference)",
                    "currency": "string (e.g. USD)",
                    "items": [
                        {
                            "productName": "string",
                            "quantity": number,
                            "unit": "string (LBS or KGS)",
                            "pricePerUnit": number,
                            "total": number
                        }
                    ]
                }
            `;

            const result = await analyzeDocument(rawBase64, mimeType, prompt);
            console.log('[CommInv OCR] Raw result:', result);
            const cleanJson = result.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsedData = JSON.parse(cleanJson);

            // Save to commission_customer_invoices table
            const client = getSupabaseClient();
            if (!client) throw new Error('No database connection');

            const items = parsedData.items || [];
            const totalAmount = items.reduce((s: number, i: any) => s + (i.total || 0), 0);

            // Generate invoice number if not extracted
            const invNumber = parsedData.invoiceNumber || `CCI-${Date.now().toString().slice(-6)}`;

            const newCommInv = {
                id: `CCI${Date.now()}`,
                companyId: currentCompanyId,
                createdAt: new Date().toISOString(),
                invoiceNumber: invNumber,
                invoiceDate: parsedData.invoiceDate || new Date().toISOString().split('T')[0],
                sellerName: parsedData.sellerName || '',
                customerName: parsedData.customerName || '',
                bookingNumber: parsedData.bookingNumber || '',
                soNumber: parsedData.soNumber || '',
                plNumber: parsedData.plNumber || '',
                incoterm: parsedData.incoterm || '',
                paymentTerms: parsedData.paymentTerms || '',
                pol: parsedData.pol || '',
                pod: parsedData.pod || '',
                items: JSON.stringify(items),
                totalAmount: totalAmount,
                currency: parsedData.currency || 'USD',
                originalDocument: dataUrl,
                status: 'AVAILABLE'
            };

            const { error } = await client.from('commission_customer_invoices').insert(newCommInv);
            if (error) throw error;

            // Refresh list (without originalDocument for performance)
            const { id: _id, originalDocument: _doc, ...listItem } = newCommInv;
            setCommissionInvoices(prev => [{ id: newCommInv.id, ...listItem }, ...prev]);

            setCommInvStatusMessage(`✅ Saved: ${invNumber}`);
            setTimeout(() => setCommInvStatusMessage(''), 2500);
        } catch (err: any) {
            console.error('[CommInv] Error processing file:', err);
            setCommInvStatusMessage(`❌ Error: ${err.message || 'Processing failed'}`);
            setTimeout(() => setCommInvStatusMessage(''), 3000);
        } finally {
            setCommInvProcessing(false);
        }
    };

    const handleDeleteCommInv = async (inv: any) => {
        if (!window.confirm(`Delete commission invoice ${inv.invoiceNumber}?`)) return;
        const client = getSupabaseClient();
        if (!client) return;
        try {
            await client.from('commission_customer_invoices').delete().eq('id', inv.id);
            setCommissionInvoices(prev => prev.filter(i => i.id !== inv.id));
        } catch (err) {
            console.error('[CommInv] Delete error:', err);
            alert('Failed to delete commission invoice');
        }
    };

    const handleViewCommInvDocument = async (inv: any) => {
        const client = getSupabaseClient();
        if (!client) return;
        try {
            const { data } = await client.from('commission_customer_invoices').select('originalDocument').eq('id', inv.id).single();
            if (data && data.originalDocument) {
                const blobUrl = data.originalDocument.startsWith('data:') ? data.originalDocument : `data:application/pdf;base64,${data.originalDocument}`;
                setPreviewUrl(blobUrl);
                setPreviewTitle(`Commission Invoice - ${inv.invoiceNumber}`);
                setPreviewFileName(`${inv.invoiceNumber}.pdf`);
            } else {
                alert('No document found for this invoice');
            }
        } catch (err) {
            console.error('[CommInv] View error:', err);
            alert('Failed to load document');
        }
    };

    // ========================================================================
    // STEP 3: CREATE INVOICE (Full Implementation)
    // ========================================================================
    const renderCreateInvoiceStep = () => (
        <div className="space-y-6">
            <div className="mb-6">
                <button
                    onClick={() => setCurrentStep('UPLOAD_PL')}
                    className="flex items-center gap-2 text-sm text-slate-500 hover:text-indigo-600 transition-colors mb-4"
                >
                    <ArrowLeft size={16} />
                    <span>Back to Supplier PL</span>
                </button>
                <div className="text-center">
                    <h3 className="text-xl font-bold text-slate-800">Create Commission Invoice</h3>
                    <p className="text-slate-500 text-sm mt-1">Generate commission invoice from packing list or upload directly</p>
                    {statusMessage && (
                        <p className="text-sm text-indigo-600 mt-2 animate-pulse">{statusMessage}</p>
                    )}
                </div>
            </div>

            {/* Commission Customer Invoices - Upload & Table */}
            <div className="p-4 border-2 border-dashed border-teal-300 rounded-2xl bg-gradient-to-br from-teal-50/50 to-emerald-50/30 mb-4">
                <div className="flex items-center gap-2 mb-3">
                    <FileSpreadsheet size={20} className="text-teal-600" />
                    <h4 className="font-bold text-teal-800 text-sm">Commission Customer Invoices</h4>
                    <span className="ml-auto text-xs bg-teal-200 text-teal-700 px-2 py-0.5 rounded-full font-medium">{commissionInvoices.length}</span>
                </div>

                {/* Hidden file input */}
                <input
                    ref={commInvFileInputRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={handleCommInvFileSelect}
                    multiple
                    className="hidden"
                />

                {/* Drop Zone */}
                <div
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setCommInvDragActive(true); }}
                    onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setCommInvDragActive(false); }}
                    onDrop={handleCommInvDrop}
                    onClick={() => commInvFileInputRef.current?.click()}
                    className={`flex items-center justify-center gap-3 p-4 mb-3 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
                        commInvDragActive
                            ? 'border-teal-500 bg-teal-100/70 scale-[1.01]'
                            : 'border-teal-200 bg-white/60 hover:border-teal-400 hover:bg-teal-50/50'
                    }`}
                >
                    {commInvProcessing ? (
                        <>
                            <Loader2 size={22} className="text-teal-500 animate-spin" />
                            <span className="text-sm font-medium text-teal-700">{commInvStatusMessage}</span>
                        </>
                    ) : (
                        <>
                            <Upload size={20} className="text-teal-400" />
                            <span className="text-sm text-teal-600">
                                <span className="font-semibold">Drop or click</span> to upload customer invoice (PDF / Image)
                            </span>
                        </>
                    )}
                </div>

                {/* Status Message */}
                {commInvStatusMessage && !commInvProcessing && (
                    <p className="text-xs text-teal-600 mb-2 animate-pulse font-medium">{commInvStatusMessage}</p>
                )}

                {/* Saved Commission Invoices Table */}
                {commissionInvoices.length > 0 && (
                    <div className="overflow-y-auto max-h-48">
                        <table className="w-full text-xs">
                            <thead className="bg-teal-100/60 sticky top-0">
                                <tr>
                                    <th className="text-left px-2 py-1 font-semibold text-teal-700">Date</th>
                                    <th className="text-left px-2 py-1 font-semibold text-teal-700">Invoice #</th>
                                    <th className="text-left px-2 py-1 font-semibold text-teal-700">Seller</th>
                                    <th className="text-left px-2 py-1 font-semibold text-teal-700">Customer</th>
                                    <th className="text-right px-2 py-1 font-semibold text-teal-700">Total</th>
                                    <th className="text-center px-2 py-1 font-semibold text-teal-700">Status</th>
                                    <th className="text-center px-2 py-1 font-semibold text-teal-700">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {commissionInvoices.slice(0, 20).map(inv => (
                                    <tr key={inv.id} className="hover:bg-teal-50/50 transition-colors border-b border-teal-100/50">
                                        <td className="px-2 py-1 text-slate-500">
                                            {inv.invoiceDate ? new Date(inv.invoiceDate.replace(/-/g, '/')).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : inv.createdAt ? new Date(inv.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}
                                        </td>
                                        <td className="px-2 py-1 font-medium text-slate-700">{inv.invoiceNumber || '-'}</td>
                                        <td className="px-2 py-1 text-slate-600 truncate max-w-[120px]">
                                            {(inv.sellerName || '-').split(' ').slice(0, 2).join(' ')}
                                        </td>
                                        <td className="px-2 py-1 text-slate-600 truncate max-w-[120px]">
                                            {(inv.customerName || '-').split(' ').slice(0, 2).join(' ')}
                                        </td>
                                        <td className="px-2 py-1 text-right font-mono text-slate-700">
                                            {inv.currency || '$'} {Number(inv.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-2 py-1 text-center">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                                inv.status === 'PAID' ? 'bg-emerald-100 text-emerald-700' : inv.status === 'SENT' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                                            }`}>
                                                {inv.status || 'AVAILABLE'}
                                            </span>
                                        </td>
                                        <td className="px-2 py-1 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <button
                                                    onClick={() => handleViewCommInvDocument(inv)}
                                                    title="View Original Document"
                                                    className="p-0.5 rounded hover:bg-teal-100 text-teal-500 transition-colors"
                                                >
                                                    <Eye size={13} />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteCommInv(inv)}
                                                    title="Delete"
                                                    className="p-0.5 rounded hover:bg-red-100 text-red-500 transition-colors"
                                                >
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
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
                            {(transportRef || bookingNumber) && (
                                <option value={transportRef || bookingNumber}>{transportRef || bookingNumber}</option>
                            )}
                            {bookings && bookings.filter((b: any) => b.status === 'AVAILABLE' && b.bookingNumber !== (transportRef || bookingNumber)).map((b: any) => (
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
                                {(() => {
                                    const dbTerms = (availablePaymentTerms || []).filter((t: any) => t.active !== false);
                                    const dbDescs = new Set(dbTerms.map((t: any) => t.description));
                                    const fallback = PAYMENT_TERM_OPTIONS.filter(o => !dbDescs.has(o)).map(o => ({ description: o, code: o }));
                                    return [...dbTerms, ...fallback].map((t: any) => (
                                        <option key={t.code || t.description} value={t.description}>{t.description}</option>
                                    ));
                                })()}
                                {paymentTerms && !PAYMENT_TERM_OPTIONS.includes(paymentTerms) && !(availablePaymentTerms || []).some((t: any) => t.description === paymentTerms) && (
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
                                    <td className="p-2 text-right font-mono text-xs">{invoiceTotals.quantity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} LBS</td>
                                    <td className="p-2 text-right font-mono text-xs">{(invoiceTotals.quantity * 0.453592).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KG</td>
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
                            onClick={() => setCurrentStep('UPLOAD_PL')}
                            className="flex items-center gap-2 px-5 py-2.5 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-all font-medium"
                        >
                            <ArrowLeft size={18} />
                            SC-PI-PL-CI Commissions Engine
                        </button>
                    </div>
                    <button
                        onClick={saveInvoice}
                        disabled={isSaving || invoiceItems.length === 0}
                        className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-lg hover:from-emerald-700 hover:to-teal-700 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                    >
                        {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                        {isSaving ? 'Saving...' : 'Save Commission Invoice'}
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
                        <div className="p-2 bg-gradient-to-r from-orange-500 to-amber-500 rounded-xl text-white">
                            <DollarSign size={24} />
                        </div>
                        SC-PI-PL-CI Commissions Engine
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">Proposal → Sales Contract → Proforma → Packing List → Commission Invoice</p>
                </div>
            </div>

            {/* Step Indicator with connecting lines */}
            <div className="mb-4">
                {renderStepIndicator()}
            </div>

            {/* Search Bar */}
            <div className="mb-4 flex items-center gap-3">
                <div className="relative flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search contracts, packing lists, invoices..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-300 bg-white placeholder-slate-400"
                    />
                    {searchTerm && (
                        <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                            <X size={14} />
                        </button>
                    )}
                </div>
            </div>

            {/* Step Content */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-200 pt-1 px-1 pb-4 shadow-xl w-full flex-1 overflow-visible flex flex-col">
                {currentStep === 'PROPOSAL' && renderProposalStep()}
                {currentStep === 'UPLOAD_CONTRACT' && renderUploadContractStep()}
                {currentStep === 'CREATE_PROFORMA' && renderCreateProformaStep()}
                {currentStep === 'UPLOAD_PL' && renderUploadStep()}
                {currentStep === 'EDIT_PL' && renderEditPLStep()}
                {currentStep === 'CREATE_INVOICE' && renderCreateInvoiceStep()}
            </div>

            {/* Contract Document Viewer Modal */}
            {contractViewUrl && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in">
                    <div className="bg-white rounded-2xl shadow-2xl w-[90vw] max-w-4xl h-[85vh] flex flex-col overflow-hidden">
                        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-t-2xl">
                            <div className="flex items-center gap-3">
                                <Eye size={20} />
                                <div>
                                    <h3 className="text-lg font-bold">Original Contract Document</h3>
                                    <p className="text-xs text-white/80">{contractViewTitle}</p>
                                </div>
                            </div>
                            <button onClick={() => { setContractViewUrl(null); setContractViewTitle(''); }} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-hidden p-2 bg-slate-100">
                            {contractViewUrl.startsWith('data:application/pdf') ? (
                                <iframe src={contractViewUrl} className="w-full h-full rounded-lg border-0" title="Contract Document" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center overflow-auto">
                                    <img src={contractViewUrl} alt="Contract Document" className="max-w-full max-h-full object-contain rounded-lg shadow-lg" />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

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
                            <div className={`flex items-center justify-between p-3 rounded-lg transition-colors ${emailDocSelection.invoice ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'bg-slate-50'}`}>
                                <div className="flex items-center gap-3">
                                    <input type="checkbox" checked={emailDocSelection.invoice} onChange={e => setEmailDocSelection(prev => ({ ...prev, invoice: e.target.checked }))} className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" />
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
                                        saveWithPicker(doc, `Invoice_${selectedDocInvoice.invoiceNumber || 'unknown'}.pdf`);
                                    }} className="p-1.5 hover:bg-indigo-100 rounded text-indigo-600" title="Download Invoice PDF">
                                        <Download size={16} />
                                    </button>
                                </div>
                            </div>

                            {/* Packing List */}
                            <div className={`flex items-center justify-between p-3 rounded-lg transition-colors ${emailDocSelection.pl ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'bg-slate-50'}`}>
                                <div className="flex items-center gap-3">
                                    <input type="checkbox" checked={emailDocSelection.pl} onChange={e => setEmailDocSelection(prev => ({ ...prev, pl: e.target.checked }))} className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" />
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
                                        saveWithPicker(doc, `PackingList_${selectedDocInvoice.plNumber || selectedDocInvoice.invoiceNumber || 'unknown'}.pdf`);
                                    }} className="p-1.5 hover:bg-indigo-100 rounded text-indigo-600" title="Download Packing List PDF">
                                        <Download size={16} />
                                    </button>
                                </div>
                            </div>

                            {/* SLI */}
                            <div className={`flex items-center justify-between p-3 rounded-lg transition-colors ${emailDocSelection.sli ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'bg-slate-50'}`}>
                                <div className="flex items-center gap-3">
                                    <input type="checkbox" checked={emailDocSelection.sli} onChange={e => setEmailDocSelection(prev => ({ ...prev, sli: e.target.checked }))} className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" />
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
                                        saveWithPicker(doc, `SLI_${selectedDocInvoice.invoiceNumber || 'unknown'}.pdf`);
                                    }} className="p-1.5 hover:bg-indigo-100 rounded text-indigo-600" title="Download SLI">
                                        <Download size={16} />
                                    </button>
                                </div>
                            </div>

                            {/* Bill of Lading */}
                            <div className={`flex items-center justify-between p-3 rounded-lg transition-colors ${emailDocSelection.bol ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'bg-slate-50'}`}>
                                <div className="flex items-center gap-3">
                                    <input type="checkbox" checked={emailDocSelection.bol} onChange={e => setEmailDocSelection(prev => ({ ...prev, bol: e.target.checked }))} className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" disabled={!((selectedDocInvoice as any).bolUrl || (selectedDocInvoice as any).bolurl)} />
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
                                                    setDocumentsModalOpen(false); // Close documents modal to prevent double backdrop
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
                                    disabled={sendingEmail || !Object.values(emailDocSelection).some(v => v)}
                                    className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                                >
                                    {sendingEmail ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
                                    Email Selected ({Object.values(emailDocSelection).filter(v => v).length})
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

                            {/* BR Price Adjustment */}
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                                <label className="block text-xs font-bold text-amber-700 uppercase mb-2">BR Price Adjustment</label>
                                <div className="flex items-center gap-6">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={brPriceAdjustment === '50'}
                                            onChange={(e) => setBrPriceAdjustment(e.target.checked ? '50' : 'none')}
                                            className="w-4 h-4 accent-amber-600 rounded"
                                        />
                                        <span className="text-sm font-medium text-slate-700">50%</span>
                                        <span className="text-[10px] text-slate-400">(half of original price)</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={brPriceAdjustment === 'br'}
                                            onChange={(e) => setBrPriceAdjustment(e.target.checked ? 'br' : 'none')}
                                            className="w-4 h-4 accent-amber-600 rounded"
                                        />
                                        <span className="text-sm font-medium text-slate-700">BR</span>
                                        <span className="text-[10px] text-slate-400">($0.28/KG fixed)</span>
                                    </label>
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
                isOpen={!!previewUrl || previewGenerating}
                onClose={() => {
                    handleClosePreview();
                    setPendingProformaEmailDraft(null);
                    setPreviewGenerating(false);
                }}
                pdfUrl={previewUrl}
                pdfBlob={previewBlob}
                title={previewTitle}
                fileName={previewFileName}
                onDownload={previewDownloadFn || undefined}
                isGenerating={previewGenerating}
                loadingMessage="Generating proposal..."
                onEmail={pendingProformaEmailDraft ? () => {
                    setEmailDraft({
                        invoice: null,
                        ...pendingProformaEmailDraft,
                        _proposalId: pendingProformaEmailDraft.proposalId
                    } as any);
                    setEmailPreviewOpen(true);
                    setPendingProformaEmailDraft(null);
                    handleClosePreview();
                } : undefined}
            />
        </div>
    );
};

export default React.memo(SOPICIComissions);

