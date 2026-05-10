import React, { useState, useEffect, useRef } from 'react';
import { CommissionSalesOrder, CommissionItem, Customer, Supplier, User, Role, SalesOrder, Invoice, Port, Booking, BillOfLading } from '../types';
import { DollarSign, Plus, X, Save, UploadCloud, Loader2, FileText, CheckCircle, Clock, Shield, Truck, Link, Mail, Percent, AlertCircle, Trash2, Eye, Pencil, MapPin, FileCheck, Filter, ArrowUp, ArrowDown, Search, CheckCircle2, Receipt, ClipboardList, Ship, List, FilePlus, ScanEye, Sparkles, FileSpreadsheet, Download, Wallet, Layers, Package } from 'lucide-react';
import { analyzeDocument } from '../services/geminiService';
import { getSupabaseClient } from '../services/supabase';
import { PAYMENT_TERM_OPTIONS } from '../constants';
import * as XLSX from 'xlsx';

const COMMISSION_ORDER_EXTRACTION_PROMPT = `
Analyze the uploaded document, which is a commission sales order or similar confirmation.
Extract the key information into a structured JSON object.

RULES:
1. Return ONLY a valid JSON object. Do not add any commentary.
2. If a field is not found, return null for its value.
3. For line items, parse each product row into an object within the "items" array.
4. Try to identify the unit of measure (LBS or KGS). If not specified, assume LBS.

KEYS for the JSON object:
{
    "orderNumber": "string (The primary document reference number. This could be a Sales Order #, PO #, Proforma #, etc.)",
    "sellerName": "string",
    "customerName": "string",
    "incoterm": "string (e.g., FOB, CIF)",
    "paymentTerms": "string (e.g., 30 days)",
    "pod": "string (Port of Destination)",
    "deliveryDate": "string (YYYY-MM-DD format if possible)",
    "items": [
        {
            "productName": "string",
            "quantity": number,
            "unit": "string ('LBS' or 'KGS')",
            "pricePerUnit": number,
            "total": number
        }
    ]
}
`;

const COMMISSION_INVOICE_EXTRACTION_PROMPT = `
Analyze the uploaded document, which is a commercial INVOICE.
Extract the key information into a structured JSON object to create a commission calculation.

RULES:
1. Return ONLY a valid JSON object. Do not add any commentary.
2. If a field is not found, return null for its value.
3. For line items, parse each product row into an object within the "items" array.
4. Try to identify the unit of measure (LBS or KGS). If not specified, assume LBS.
5. Look for shipping/logistics information like ETD, ETA, vessel, B/L number, booking number, container numbers anywhere in the document.
6. For ports, extract the full port name (e.g., "Port of Miami", "Santos, Brazil").

KEYS for the JSON object:
{
    "orderNumber": "string (The Invoice Number)",
    "sellerName": "string (The Seller/Shipper name)",
    "customerName": "string (The Buyer/Consignee name)",
    "incoterm": "string (e.g., FOB, CIF)",
    "paymentTerms": "string (e.g., 30 days)",
    "pol": "string (Port of Loading / Origin port)",
    "pod": "string (Port of Destination / Discharge port)",
    "deliveryDate": "string (The Invoice Date in YYYY-MM-DD format if possible)",
    "etd": "string (Estimated Time of Departure in YYYY-MM-DD format if found)",
    "eta": "string (Estimated Time of Arrival in YYYY-MM-DD format if found)",
    "bookingNumber": "string (Booking number, B/L number, or shipping reference if found)",
    "vesselVoyage": "string (Vessel name and voyage number if found)",
    "containerNumbers": "string (Comma-separated list of container numbers if found, e.g., 'MSKU1234567, TCLU7654321')",
    "items": [
        {
            "productName": "string",
            "quantity": number,
            "unit": "string ('LBS' or 'KGS')",
            "pricePerUnit": number,
            "total": number
        }
    ]
}
`;

const BOOKING_EXTRACTION_PROMPT = `
Analyze the uploaded document, which is a BILL OF LADING or BOOKING CONFIRMATION from a shipping line or freight forwarder.
Extract the key information into a structured JSON object.

RULES:
1. Return ONLY a valid JSON object. Do not add any commentary.
2. If a field is not found, return null for its value.
3. Extract all container numbers if found.

KEYS for the JSON object:
{
    "bookingNumber": "string (The B/L number, booking confirmation number, or reference number)",
    "etd": "string (Estimated Time of Departure in YYYY-MM-DD format if possible)",
    "eta": "string (Estimated Time of Arrival in YYYY-MM-DD format if possible)",
    "vesselVoyage": "string (Vessel name and voyage number)",
    "pol": "string (Port of Loading)",
    "pod": "string (Port of Discharge)",
    "containerNumbers": "string (Comma-separated list of container numbers if found)"
}
`;

// Helper to extract unique values for filtering
const getUniqueValues = (data: any[], key: string) => {
    const values = data.map(item => item[key]).filter(v => v !== undefined && v !== null && v !== '');
    return Array.from(new Set(values)).sort();
};

// A local, controlled input component to handle number formatting without breaking user input.
const FormattedInput = ({ value, onChange, decimals = 2, ...props }: { value: number; onChange: (val: number) => void; decimals?: number;[key: string]: any; }) => {
    const [displayValue, setDisplayValue] = useState('');
    const [isFocused, setIsFocused] = useState(false);

    useEffect(() => {
        if (!isFocused) {
            if (value === 0 || value === undefined || value === null) {
                setDisplayValue(value === 0 ? (0).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : '');
            } else {
                setDisplayValue((Number(value) || 0).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
            }
        }
    }, [value, isFocused, decimals]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        setDisplayValue(raw);

        const clean = raw.replace(/,/g, '');
        const num = parseFloat(clean);

        onChange(isNaN(num) ? 0 : num);
    };

    const handleBlur = () => {
        setIsFocused(false);
        if (value !== 0 && !value) {
            setDisplayValue('');
        } else {
            setDisplayValue((Number(value) || 0).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
        }
    };

    const handleFocus = () => {
        setIsFocused(true);
        setDisplayValue(value === 0 ? '' : value.toString());
    };

    return (
        <input
            type={isFocused ? "number" : "text"}
            value={displayValue}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            {...props}
        />
    );
};


type CommissionView = 'COMMISSION_ORDERS' | 'COMMISSION_INVOICES';

interface CommissionsProps {
    commissions: CommissionSalesOrder[];
    onAdd: (order: CommissionSalesOrder) => void;
    onUpdate: (order: CommissionSalesOrder) => void;
    onDelete: (id: string) => void;
    customers: Customer[];
    suppliers: Supplier[];
    currentUser: User;
    ports?: Port[];
    currentCompanyId?: string;
    onAddBooking?: (booking: Booking) => void;
    bookings?: Booking[];
    billOfLadings?: BillOfLading[];
    onSaveBL?: (bl: BillOfLading) => void;
}

const Commissions: React.FC<CommissionsProps> = ({ commissions, onAdd, onUpdate, onDelete, customers, suppliers, currentUser, ports = [], currentCompanyId, onAddBooking, bookings = [], billOfLadings = [], onSaveBL }) => {
    const [view, setView] = useState<'LIST' | 'FORM'>('LIST');
    const [commissionView, setCommissionView] = useState<CommissionView>('COMMISSION_ORDERS');
    const [editingOrder, setEditingOrder] = useState<Partial<CommissionSalesOrder> | null>(null);
    const [file, setFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const [viewingDocumentUrl, setViewingDocumentUrl] = useState<string | null>(null);
    const [loadingDoc, setLoadingDoc] = useState<{ id: string, type: 'BL' | 'PL' | 'INVOICE' } | null>(null);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    // New Refs for split upload
    const blFileInputRef = useRef<HTMLInputElement>(null);
    const plFileInputRef = useRef<HTMLInputElement>(null);

    const [formMode, setFormMode] = useState<'ORDER' | 'INVOICE'>('ORDER');

    // --- AutoFilter State ---
    const [activeFilterColumn, setActiveFilterColumn] = useState<string | null>(null);
    const [filters, setFilters] = useState<Record<string, string[]>>({});
    const [filterSearch, setFilterSearch] = useState('');
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
    const filterMenuRef = useRef<HTMLDivElement>(null);

    // Colors Resume Modal State
    const [showColorsModal, setShowColorsModal] = useState(false);
    const [colorsFiles, setColorsFiles] = useState<File[]>([]);
    const [colorsProcessing, setColorsProcessing] = useState(false);
    const [colorsError, setColorsError] = useState<string | null>(null);
    const [colorsDragActive, setColorsDragActive] = useState(false);
    const colorsFileInputRef = useRef<HTMLInputElement>(null);
    const [colorsSummary, setColorsSummary] = useState<{ colors: any[], whites: any[], totals: any, whitesTotals: any } | null>(null);

    // Booking OCR Modal State
    const [bookingOcrOrder, setBookingOcrOrder] = useState<CommissionSalesOrder | null>(null);
    const [bookingOcrProcessing, setBookingOcrProcessing] = useState(false);
    const bookingFileInputRef = useRef<HTMLInputElement>(null);

    // Batch Invoice Upload State
    const [showBatchInvoiceModal, setShowBatchInvoiceModal] = useState(false);
    const [batchInvoiceFiles, setBatchInvoiceFiles] = useState<File[]>([]);
    const [batchInvoiceResults, setBatchInvoiceResults] = useState<Array<{ file: File; data: Partial<CommissionSalesOrder>; status: 'pending' | 'processing' | 'done' | 'error'; error?: string }>>([]);
    const [batchProcessing, setBatchProcessing] = useState(false);
    const [batchBLNumber, setBatchBLNumber] = useState('');
    const [batchDragActive, setBatchDragActive] = useState(false);
    const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
    const batchFileInputRef = useRef<HTMLInputElement>(null);
    // Batch BL Upload State
    const [batchBlFile, setBatchBlFile] = useState<File | null>(null);
    const [batchBlData, setBatchBlData] = useState<{ blNumber?: string; etd?: string; eta?: string; vesselVoyage?: string; pol?: string; containerNumbers?: string; blDocumentUrl?: string } | null>(null);
    const [batchBlProcessing, setBatchBlProcessing] = useState(false);
    const batchBlFileInputRef = useRef<HTMLInputElement>(null);
    // Batch Commission Config
    const [batchCommissionType, setBatchCommissionType] = useState<'PERCENT' | 'PER_LBS' | 'PER_KGS'>('PERCENT');
    const [batchCommissionRate, setBatchCommissionRate] = useState(0);

    // --- Batch BL Upload Handler ---
    const handleBatchBlUpload = async (file: File) => {
        setBatchBlFile(file);
        setBatchBlProcessing(true);
        try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (event) => resolve(event.target?.result as string);
                reader.onerror = () => reject(new Error('Failed to read file'));
                reader.readAsDataURL(file);
            });
            const base64String = dataUrl.split(',')[1];
            const mimeType = dataUrl.includes('application/pdf') ? 'application/pdf' : 'image/jpeg';
            const rawResult = await analyzeDocument(base64String, mimeType, BOOKING_EXTRACTION_PROMPT);
            const cleanedResult = rawResult.replace(/```json\n?/gi, '').replace(/```\n?$/gi, '').trim();
            const parsed = JSON.parse(cleanedResult);
            const blNumber = parsed.bookingNumber || '';
            setBatchBLNumber(blNumber);
            setBatchBlData({
                blNumber,
                etd: parsed.etd || '',
                eta: parsed.eta || '',
                vesselVoyage: parsed.vesselVoyage || '',
                pol: normalizePort(parsed.pol || ''),
                containerNumbers: parsed.containerNumbers || '',
                blDocumentUrl: dataUrl,
            });
        } catch (err) {
            console.error('[Batch] BL OCR error:', err);
            // Still keep the file even if OCR fails
            const dataUrl = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = (event) => resolve(event.target?.result as string);
                reader.readAsDataURL(file);
            });
            setBatchBlData({ blDocumentUrl: dataUrl });
        } finally {
            setBatchBlProcessing(false);
        }
    };

    // --- Batch Invoice Upload Handlers ---
    const handleBatchFilesSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const files = Array.from(e.target.files as FileList).filter((f: File) =>
                f.type === 'application/pdf' || f.type.startsWith('image/')
            );
            if (files.length === 0) return;
            setBatchInvoiceFiles(prev => [...prev, ...files]);
            setBatchInvoiceResults([]);
        }
    };

    const handleBatchDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setBatchDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const files = Array.from(e.dataTransfer.files).filter(f =>
                f.type === 'application/pdf' || f.type.startsWith('image/')
            );
            if (files.length > 0) {
                setBatchInvoiceFiles(prev => [...prev, ...files]);
                setBatchInvoiceResults([]);
            }
        }
    };

    const handleBatchRemoveFile = (index: number) => {
        setBatchInvoiceFiles(prev => prev.filter((_, i) => i !== index));
        setBatchInvoiceResults([]);
    };

    const processBatchInvoices = async () => {
        if (batchInvoiceFiles.length === 0) return;
        setBatchProcessing(true);
        setBatchProgress({ current: 0, total: batchInvoiceFiles.length });

        const results: Array<{ file: File; data: Partial<CommissionSalesOrder>; status: 'pending' | 'processing' | 'done' | 'error'; error?: string }> =
            batchInvoiceFiles.map(f => ({ file: f, data: {}, status: 'pending' as const }));
        setBatchInvoiceResults([...results]);

        for (let i = 0; i < batchInvoiceFiles.length; i++) {
            results[i].status = 'processing';
            setBatchInvoiceResults([...results]);
            setBatchProgress({ current: i + 1, total: batchInvoiceFiles.length });

            try {
                const fileToProcess = batchInvoiceFiles[i];
                const dataUrl = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (event) => resolve(event.target?.result as string);
                    reader.onerror = () => reject(new Error('Failed to read file'));
                    reader.readAsDataURL(fileToProcess);
                });

                const base64String = dataUrl.split(',')[1];
                const rawResult = await analyzeDocument(base64String, fileToProcess.type, COMMISSION_INVOICE_EXTRACTION_PROMPT);

                if (rawResult.startsWith('Error analyzing doc')) throw new Error(rawResult);

                let cleanJson = rawResult.replace(/```json\s*|\s*```/g, '').replace(/```\s*|\s*```/g, '').trim();
                const firstBrace = cleanJson.indexOf('{');
                const lastBrace = cleanJson.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1) cleanJson = cleanJson.substring(firstBrace, lastBrace + 1);

                const parsed = JSON.parse(cleanJson);
                const newItems: CommissionItem[] = (parsed.items || []).map((item: any, idx: number) => ({
                    id: `item-${Date.now()}-${i}-${idx}`,
                    ...item,
                }));
                const total = newItems.reduce((sum, it) => sum + (it.total || 0), 0);
                const paymentTermsValue = (!parsed.paymentTerms || String(parsed.paymentTerms).toLowerCase() === 'n/a') ? '' : parsed.paymentTerms;
                const deliveryDateValue = (!parsed.deliveryDate || String(parsed.deliveryDate).toLowerCase() === 'n/a') ? '' : parsed.deliveryDate;

                results[i].data = {
                    ...initialFormState,
                    orderNumber: parsed.orderNumber || `CSI-${Date.now().toString().slice(-6)}-${i}`,
                    sellerName: parsed.sellerName || '',
                    customerName: parsed.customerName || '',
                    incoterm: parsed.incoterm || '',
                    paymentTerms: paymentTermsValue,
                    pod: normalizePort(parsed.pod || ''),
                    deliveryDate: formatDate(deliveryDateValue),
                    items: newItems,
                    orderTotal: total,
                    originalDocumentUrl: dataUrl,
                };
                results[i].status = 'done';
            } catch (err: any) {
                console.error(`Batch OCR error for file ${i}:`, err);
                results[i].status = 'error';
                results[i].error = err.message || 'OCR failed';
            }
            setBatchInvoiceResults([...results]);
        }
        setBatchProcessing(false);
    };

    const handleBatchRemoveResult = (index: number) => {
        setBatchInvoiceResults(prev => prev.filter((_, i) => i !== index));
    };

    // Calculate batch commission for a single result
    const calcBatchCommission = (data: Partial<CommissionSalesOrder>) => {
        const rate = batchCommissionRate || 0;
        if (rate === 0) return 0;
        if (batchCommissionType === 'PERCENT') {
            return (data.orderTotal || 0) * (rate / 100);
        } else {
            let totalWeight = 0;
            data.items?.forEach(item => {
                if (batchCommissionType === 'PER_LBS') {
                    totalWeight += item.unit === 'LBS' ? item.quantity : item.quantity * 2.20462;
                } else {
                    totalWeight += item.unit === 'KGS' ? item.quantity : item.quantity * 0.453592;
                }
            });
            return totalWeight * rate;
        }
    };

    const handleBatchSaveAll = async () => {
        const successResults = batchInvoiceResults.filter(r => r.status === 'done');
        if (successResults.length === 0) return;

        setBatchProcessing(true);

        // Save a shared B/L record if a BL number was provided
        if (batchBLNumber.trim() && onSaveBL && currentCompanyId) {
            const firstResult = successResults[0];
            const blData: BillOfLading = {
                id: `BL-${Date.now()}`,
                companyId: currentCompanyId,
                blNumber: batchBLNumber.trim(),
                bookingNumber: '',
                shipper: firstResult.data.sellerName || '',
                consignee: firstResult.data.customerName || '',
                vesselVoyage: batchBlData?.vesselVoyage || '',
                portLoading: batchBlData?.pol || '',
                portDischarge: firstResult.data.pod || '',
                shippedDate: firstResult.data.deliveryDate || '',
                eta: batchBlData?.eta || '',
                status: 'ACTIVE',
                originalDocument: batchBlData?.blDocumentUrl || '',
            };
            try {
                await onSaveBL(blData);
                console.log('[Batch] Shared B/L saved:', blData.blNumber);
            } catch (blError) {
                console.warn('[Batch] Failed to save shared B/L:', blError);
            }
        }

        // Save each commission record
        for (const result of successResults) {
            const idPrefix = 'CSI-';
            const commissionAmount = calcBatchCommission(result.data);
            const finalOrder: CommissionSalesOrder = {
                ...initialFormState,
                ...result.data,
                id: `${idPrefix}${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                createdAt: new Date().toISOString(),
                companyId: currentUser.allowed_company_ids?.[0] || 'ALL',
                invoiceNumber: result.data.orderNumber,
                orderNumber: '',
                blNumber: batchBLNumber.trim() || undefined,
                blDocumentUrl: batchBlData?.blDocumentUrl || '',
                etd: batchBlData?.etd || '',
                eta: batchBlData?.eta || '',
                pol: batchBlData?.pol || '',
                vesselVoyage: batchBlData?.vesselVoyage || '',
                containerNumbers: batchBlData?.containerNumbers || '',
                commissionType: batchCommissionType,
                commissionRate: batchCommissionRate,
                commissionAmount,
            } as CommissionSalesOrder;

            try {
                await onAdd(finalOrder);
                console.log('[Batch] Saved commission:', finalOrder.invoiceNumber, 'commission:', commissionAmount);
            } catch (err) {
                console.error('[Batch] Failed to save:', err);
            }
        }

        setBatchProcessing(false);
        resetBatchModal();
    };

    const resetBatchModal = () => {
        setShowBatchInvoiceModal(false);
        setBatchInvoiceFiles([]);
        setBatchInvoiceResults([]);
        setBatchBLNumber('');
        setBatchProcessing(false);
        setBatchProgress({ current: 0, total: 0 });
        setBatchBlFile(null);
        setBatchBlData(null);
        setBatchBlProcessing(false);
        setBatchCommissionType('PERCENT');
        setBatchCommissionRate(0);
        if (batchFileInputRef.current) batchFileInputRef.current.value = '';
        if (batchBlFileInputRef.current) batchBlFileInputRef.current.value = '';
    };

    // Handle click outside to close filter menu
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (filterMenuRef.current && !filterMenuRef.current.contains(event.target as Node)) {
                setActiveFilterColumn(null);
                setFilterSearch('');
                setFilterMenuPos(null);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // --- Document Fetching ---
    const handleFetchDocument = async (id: string, type: 'BL' | 'PL' | 'INVOICE', e: React.MouseEvent) => {
        e.stopPropagation();
        setLoadingDoc({ id, type });

        const client = getSupabaseClient();
        if (!client) {
            alert("Database connection error");
            setLoadingDoc(null);
            return;
        }

        const columnMap = {
            'INVOICE': 'originalDocumentUrl',
            'BL': 'blDocumentUrl',
            'PL': 'plDocumentUrl'
        };
        const columnName = columnMap[type];

        try {
            const { data, error } = await client
                .from('commission_sales_orders')
                .select(columnName)
                .eq('id', id)
                .single();

            if (error) throw error;

            if (data && data[columnName]) {
                setViewingDocumentUrl(data[columnName]);
            } else {
                alert(`No ${type} document found for this record.`);
            }
        } catch (error) {
            console.error("Error fetching document:", error);
            alert("Failed to fetch document. Please try again.");
        } finally {
            setLoadingDoc(null);
        }
    };

    // Filter & Sort Logic
    const getProcessedData = (data: CommissionSalesOrder[]) => {
        let result = [...data];

        // 1. Filter
        result = result.filter(item => {
            for (const [key, selectedValues] of Object.entries(filters)) {
                if ((selectedValues as string[]).length > 0) {
                    let itemValue = (item as any)[key];
                    const strValue = String(itemValue === undefined || itemValue === null ? '' : itemValue);
                    if (!(selectedValues as string[]).includes(strValue)) return false;
                }
            }
            return true;
        });

        // 2. Sort
        if (sortConfig) {
            result.sort((a, b) => {
                const aVal = (a as any)[sortConfig.key];
                const bVal = (b as any)[sortConfig.key];

                if (typeof aVal === 'number' && typeof bVal === 'number') {
                    return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
                }

                const aStr = String(aVal || '').toLowerCase();
                const bStr = String(bVal || '').toLowerCase();

                if (aStr < bStr) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aStr > bStr) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }

        return result;
    };

    // Normalize port: fuzzy match raw POD text to standard port codes
    const normalizePort = (rawInput: string): string => {
        const raw = String(rawInput || '');
        if (!raw) return '';
        if (!ports || ports.length === 0) return raw;

        const cleanRaw = raw.toUpperCase().trim();

        // 1. Exact code match (highest priority)
        const exactCodeMatch = ports.find(p => p.code && p.code.toUpperCase() === cleanRaw);
        if (exactCodeMatch) return exactCodeMatch.code;

        const inputTokens = new Set<string>(cleanRaw.split(/[^A-Z0-9]+/).filter(t => t.length >= 3));
        if (inputTokens.size === 0) return raw;

        let bestMatch: Port | null = null;
        let maxScore = 0;

        for (const port of ports) {
            if (!port.code || !port.name) continue;

            const pName = port.name.toUpperCase().trim();
            const pCode = port.code.toUpperCase().trim();

            let score = 0;

            // Code Match
            if (inputTokens.has(pCode)) {
                score += 200;
            }

            // Name Match (token-based)
            const nameTokens = new Set<string>(pName.split(/[^A-Z0-9]+/).filter(t => t.length >= 3));
            let commonCount = 0;
            for (const token of nameTokens) {
                if (inputTokens.has(token)) {
                    commonCount++;
                }
            }

            if (commonCount > 0) {
                score += commonCount * 50;
                if (commonCount > 0 && commonCount === nameTokens.size) {
                    score += 100; // Bonus for matching all parts of the name
                }
            }

            // Fallback simple includes
            if (score === 0 && cleanRaw.includes(pName) && pName.length > 3) {
                score += 20;
            }

            if (score > maxScore) {
                maxScore = score;
                bestMatch = port;
            }
        }

        // Require a decent score to prevent false positives
        return (bestMatch && maxScore >= 50) ? bestMatch.code : raw;
    };

    // Display POD: "CODE-Name" if found in ports, otherwise raw POD
    const getDisplayPod = (rawPod: string): string => {
        if (!rawPod) return '—';

        // First, try to normalize the raw POD to a port code
        const normalizedCode = normalizePort(rawPod);

        // If we got a normalized code, find the port and display "CODE-Name"
        const port = ports.find(p => p.code === normalizedCode);
        if (port) return port.code;

        // If normalization didn't find a match, return raw POD
        return rawPod;
    };

    // Determine Source Data
    const rawData = commissionView === 'COMMISSION_ORDERS'
        ? commissions.filter(c => c.id.startsWith('CSO-'))
        : commissions.filter(c => c.id.startsWith('CSI-'));

    const processedData = getProcessedData(rawData);

    // Calculate Unpaid Commissions for Invoice View
    const totalUnpaidCommission = commissionView === 'COMMISSION_INVOICES'
        ? processedData
            .filter(i => (i.commissionPaymentStatus || 'UNPAID') !== 'PAID')
            .reduce((sum, i) => sum + (i.commissionAmount || 0), 0)
        : 0;

    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const toggleFilter = (column: string, value: string) => {
        setFilters(prev => {
            const current = prev[column] || [];
            if (current.includes(value)) {
                const updated = current.filter(v => v !== value);
                return updated.length === 0 ? { ...prev, [column]: [] } : { ...prev, [column]: updated };
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

    // Render Column Header with AutoFilter
    const [filterMenuPos, setFilterMenuPos] = useState<{ top: number; left: number } | null>(null);
    const renderColumnHeader = (id: keyof CommissionSalesOrder, label: string, align: 'left' | 'right' = 'left') => {
        const uniqueValues = getUniqueValues(rawData, id as string);
        const activeValues = filters[id as string] || [];
        const isFilterActive = activeValues.length > 0;
        const isSorted = sortConfig?.key === id;

        return (
            <th className={`p-3 text-xs font-semibold text-slate-500 uppercase group ${align === 'right' ? 'text-right' : 'text-left'}`}>
                <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
                    <span className="cursor-pointer hover:text-slate-700" onClick={() => handleSort(id as string)}>
                        {label}
                    </span>
                    {isSorted && (
                        <span className="text-slate-400">
                            {sortConfig?.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                        </span>
                    )}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (activeFilterColumn === id) {
                                setActiveFilterColumn(null);
                                setFilterMenuPos(null);
                            } else {
                                const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                                setFilterMenuPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - 192) });
                                setActiveFilterColumn(id as string);
                            }
                            setFilterSearch('');
                        }}
                        className={`p-1 rounded hover:bg-slate-200 transition-colors ${isFilterActive ? 'text-blue-600 bg-blue-50' : 'text-slate-400 opacity-0 group-hover:opacity-100'}`}
                    >
                        <Filter size={12} fill={isFilterActive ? "currentColor" : "none"} />
                    </button>
                </div>

                {activeFilterColumn === id && filterMenuPos && (
                    <div ref={filterMenuRef} className="fixed w-48 bg-white rounded-lg shadow-xl border border-slate-200 z-[100] overflow-hidden text-left font-normal normal-case" style={{ top: filterMenuPos.top, left: filterMenuPos.left }}>
                        <div className="p-2 border-b border-slate-100">
                            <div className="relative">
                                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    className="w-full pl-7 pr-2 py-1 text-xs border border-slate-200 rounded bg-slate-50 outline-none"
                                    placeholder="Search..."
                                    value={filterSearch}
                                    onChange={e => setFilterSearch(e.target.value)}
                                    autoFocus
                                />
                            </div>
                        </div>
                        <div className="max-h-40 overflow-y-auto p-1 custom-scrollbar">
                            <button onClick={() => clearColumnFilter(id as string)} className="w-full text-left px-2 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded flex items-center gap-2 font-bold">
                                <X size={10} /> Clear Filter
                            </button>
                            {uniqueValues.filter(v => String(v).toLowerCase().includes(filterSearch.toLowerCase())).map(val => (
                                <button key={String(val)} onClick={() => toggleFilter(id as string, String(val))} className="w-full text-left px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded flex items-center gap-2">
                                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${activeValues.includes(String(val)) ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'}`}>
                                        {activeValues.includes(String(val)) && <CheckCircle2 size={10} className="text-white" />}
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

    const initialFormState: Partial<CommissionSalesOrder> = {
        status: 'DRAFT',
        paymentStatus: 'PENDING',
        invoiceStatus: 'UNPAID',
        commissionPaymentStatus: 'UNPAID',
        items: [],
        totalQuantity: 0,
        orderTotal: 0,
        commissionRate: 0,
        commissionType: 'PERCENT',
        commissionAmount: 0,
        originalDocumentUrl: '',
        blDocumentUrl: '',
        plDocumentUrl: '',
        signedDocumentUrl: '',
    };

    const canApprove = currentUser.role === Role.CEO || currentUser.role === Role.MANAGER;

    const formatDate = (dateString?: string) => {
        if (!dateString) return '';
        try {
            // Handles 'YYYY-MM-DD' by replacing dashes, which is safer across browsers
            // and avoids timezone shifts by treating it as a local date.
            const date = new Date(dateString.replace(/-/g, '/'));
            if (isNaN(date.getTime())) return '';

            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const year = date.getFullYear();
            return `${month}/${day}/${year}`;
        } catch (e) {
            return dateString; // Return original if formatting fails for some reason
        }
    };

    const handleViewDocument = (url: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setViewingDocumentUrl(url);
    };

    const handleNewOrder = () => {
        setFormMode('ORDER');
        setEditingOrder({
            ...initialFormState,
            status: 'DRAFT',
            paymentStatus: 'PENDING',
            orderNumber: `CSO-${Date.now().toString().slice(-6)}`
        });
        setFile(null);
        setView('FORM');
    };

    const handleNewInvoice = () => {
        setFormMode('INVOICE');
        setEditingOrder({
            ...initialFormState,
            invoiceStatus: 'UNPAID',
            commissionPaymentStatus: 'UNPAID',
            orderNumber: `CSI-${Date.now().toString().slice(-6)}`
        });
        setFile(null);
        setView('FORM');
    };

    // --- Colors Resume XLSX Processing Handlers ---
    const FIXED_COLORS = new Set([
        "beige cotton", "beige fleece", "bleached cotton", "bleached fleece",
        "bleached milky cotton", "bleached milky fleece", "bleached milky overlock",
        "bleached overlock", "bleached pc", "bleached pc yarn", "chocolate cotton",
        "chocolate fleece", "cocoa cotton", "cocoa fleece", "daisy cotton",
        "daisy fleece", "daisy pc", "electric green cotton", "electric green pc",
        "forest cotton", "forest fleece", "forest pc", "gold cotton", "gold fleece",
        "gold pc", "haze cotton", "haze fleece", "heliconia cotton", "heliconia fleece",
        "heliconia pc", "honey cotton", "irish green cotton", "irish green fleece",
        "irish green pc", "light blue cotton", "light blue fleece", "light blue pc",
        "light pink cotton", "light pink fleece", "light pink pc", "lime cotton",
        "lime pc", "milky overlock", "milky pc", "mustard yellow fleece",
        "natural cotton", "natural fleece", "natural pc", "neon green pc",
        "old gold cotton", "old gold fleece", "orange cotton", "orange fleece",
        "orange pc", "purple cotton", "purple fleece", "purple pc", "red cotton",
        "red fleece", "red pc", "royal cotton", "royal fleece", "royal caribe fleece",
        "royal pc", "safety green fleece", "safety green overlock", "safety green pc",
        "safety orange fleece", "safety orange overlock", "safety orange pc",
        "safety pink fleece", "safety pink overlock", "safety pink pc",
        "sand cotton", "sand fleece", "sand pc", "sapphire cotton", "sapphire fleece",
        "sapphire pc", "unbleached cotton yarn", "unbleached pc yarn", "milky cotton",
        "black cotton", "black pc", "black fleece", "navy cotton", "navy pc", "navy fleece",
        "ash gray cotton", "ash gray pc", "sport gray cotton", "sport gray pc",
        "sport gray 100% polyester", "charcoal cotton", "charcoal pc", "charcoal 100% polyester",
        "black cotton mp- ind", "dk heather fleece", "heather charcoal fleece", "gravel gray fleece",
        "sport gray fleece", "ash gray fleece", "charcoal fleece", "dk royal fleece", "heather navy fleece",
        "heather royal fleece", "heather blue fleece", "antique sapphire fleece"
    ]);

    const TRANSLATION_MAP: Record<string, string> = {
        "beige cotton": "Beige 100%", "beige fleece": "Beige Fleece",
        "bleached cotton": "Optical White 100% Cotton", "bleached fleece": "Optical White Fleece",
        "bleached milky cotton": "Bleached White 100% Cotton", "bleached milky fleece": "Bleached White Fleece",
        "bleached milky overlock": "Bleached White Milky Overlock", "bleached overlock": "Optical White Overlock",
        "bleached pc": "Bleached White PC", "bleached pc yarn": "Bleached White PC Yarn",
        "chocolate cotton": "Brown 100%", "chocolate fleece": "Brown Fleece",
        "cocoa cotton": "Cocoa 100%", "cocoa fleece": "Cocoa Fleece",
        "daisy cotton": "Daisy Yellow 100%", "daisy fleece": "Daisy Yellow Fleece", "daisy pc": "Daisy Yellow PC",
        "electric green cotton": "Electric Green 100%", "electric green pc": "Electric Green PC",
        "forest cotton": "Forest Green 100%", "forest fleece": "Forest Green Fleece", "forest pc": "Forest Green PC",
        "gold cotton": "Gold Yellow 100%", "gold fleece": "Gold Yellow Fleece", "gold pc": "Gold Yellow PC",
        "haze cotton": "Honey 100%", "haze fleece": "Honey Fleece",
        "heliconia cotton": "Heliconia Pink 100%", "heliconia fleece": "Hot Pink Fleece", "heliconia pc": "Heliconia Pink PC",
        "honey cotton": "Honey 100%", "irish green cotton": "Green 100%", "irish green fleece": "Irish Green Fleece", "irish green pc": "Green PC",
        "light blue cotton": "Light Blue 100%", "light blue fleece": "Light Blue Fleece", "light blue pc": "Light Blue PC",
        "light pink cotton": "Pink 100%", "light pink fleece": "Light Pink Fleece", "light pink pc": "Pink 100%",
        "lime cotton": "Lime Green 100%", "lime pc": "Lime Green PC", "milky overlock": "Bleached White Overlock",
        "mustard yellow fleece": "Mustard Yellow Fleece", "natural cotton": "Natural Cotton",
        "natural fleece": "Natural Fleece", "natural pc": "Natural Cotton PC", "neon green pc": "Neon Green PC",
        "old gold cotton": "Mustard Yellow 100%", "old gold fleece": "Dark Yellow Fleece",
        "orange cotton": "Orange 100%", "orange fleece": "Orange Fleece", "orange pc": "Orange PC",
        "purple cotton": "Purple 100%", "purple fleece": "Purple Fleece", "purple pc": "Purple PC",
        "red cotton": "Red 100%", "red fleece": "Red Fleece", "red pc": "Red PC",
        "royal cotton": "Royal Blue 100%", "royal fleece": "Royal Blue Fleece", "royal caribe fleece": "Caribe Royal Blue Fleece", "royal pc": "Royal Blue PC",
        "safety green fleece": "Neon Green Fleece", "safety green overlock": "Neon Green Overlock", "safety green pc": "Neon Green PC",
        "safety orange fleece": "Neon Orange Fleece", "safety orange overlock": "Neon Orange Overlock", "safety orange pc": "Neon Orange PC",
        "safety pink fleece": "Neon Pink Fleece", "safety pink overlock": "Neon Pink Overlock", "safety pink pc": "Neon Pink PC",
        "sand cotton": "Sand 100%", "sand fleece": "Sand Fleece", "sand pc": "Sand PC",
        "sapphire cotton": "Sapphire Blue 100%", "sapphire fleece": "Sapphire Blue Fleece", "sapphire pc": "Sapphire Blue PC",
        "unbleached cotton yarn": "Unbleached Cotton Yarn", "unbleached pc yarn": "Unbleached PC Yarn",
        "milky pc": "Bleached White PC", "milky cotton": "Bleached White 100% Cotton",
        "black cotton": "Black 100%", "black pc": "Black PC", "black fleece": "Black Fleece",
        "navy cotton": "Navy Blue 100%", "navy pc": "Navy Blue PC", "navy fleece": "Navy Blue Fleece",
        "ash gray cotton": "Ash Gray 100%", "ash gray pc": "Ash Gray PC",
        "sport gray cotton": "Sport Gray 100%", "sport gray pc": "Sport Gray PC", "sport gray 100% polyester": "Sport Gray 100% Polyester",
        "charcoal cotton": "Charcoal 100%", "charcoal pc": "Charcoal PC", "charcoal 100% polyester": "Charcoal 100% Polyester",
        "black cotton mp- ind": "Black MP-IND 100%", "dk heather fleece": "Dark Heather Fleece",
        "heather charcoal fleece": "Heather Charcoal Fleece", "gravel gray fleece": "Gravel Gray Fleece",
        "sport gray fleece": "Sport Gray Fleece", "ash gray fleece": "Ash Gray Fleece", "charcoal fleece": "Charcoal Fleece",
        "dk royal fleece": "Dark Royal Fleece", "heather navy fleece": "Heather Navy Fleece",
        "heather royal fleece": "Heather Royal Fleece", "heather blue fleece": "Heather Blue Fleece", "antique sapphire fleece": "Antique Sapphire Fleece"
    };

    const handleColorsFilesSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const files = Array.from(e.target.files as FileList).filter((f: File) =>
                f.name.endsWith('.xlsx') || f.name.endsWith('.xls')
            );
            if (files.length === 0) {
                setColorsError("Please select valid Excel files (.xlsx or .xls)");
                return;
            }
            setColorsFiles(prev => [...prev, ...files]);
            setColorsError(null);
            setColorsSummary(null);
        }
    };

    const handleColorsDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setColorsDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const files = Array.from(e.dataTransfer.files).filter(f =>
                f.name.endsWith('.xlsx') || f.name.endsWith('.xls')
            );
            if (files.length > 0) {
                setColorsFiles(prev => [...prev, ...files]);
                setColorsError(null);
                setColorsSummary(null);
            }
        }
    };

    const processColorsResume = async () => {
        if (colorsFiles.length === 0) return;

        setColorsProcessing(true);
        setColorsError(null);

        try {
            const aggregated: Record<string, { color: string, translated: string, bales: number, weight: number }> = {};

            for (const file of colorsFiles) {
                const data = await file.arrayBuffer();
                const workbook = XLSX.read(data, { type: 'array' });

                for (const sheetName of workbook.SheetNames) {
                    const sheet = workbook.Sheets[sheetName];
                    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

                    // Skip first 4 rows (header)
                    for (let i = 4; i < rows.length; i++) {
                        const row = rows[i];
                        if (!row || row.length < 4) continue;

                        const rawColor = String(row[1] || '').trim().toLowerCase();
                        if (!FIXED_COLORS.has(rawColor)) continue;

                        const bales = parseInt(String(row[2] || '0'), 10);
                        const weight = parseInt(String(row[3] || '0'), 10);
                        if (bales === 0 || isNaN(bales)) continue;

                        if (aggregated[rawColor]) {
                            aggregated[rawColor].bales += bales;
                            aggregated[rawColor].weight += weight;
                        } else {
                            aggregated[rawColor] = {
                                color: String(row[1] || '').trim(),
                                translated: TRANSLATION_MAP[rawColor] || 'Not Translated',
                                bales,
                                weight
                            };
                        }
                    }
                }
            }

            const entries = Object.values(aggregated).filter(r => r.bales > 0).sort((a, b) => a.color.localeCompare(b.color));
            const whiteKeywords = ['white', 'bleached', 'milky', 'natural', 'sand'];

            const colors = entries.filter(r => !whiteKeywords.some(kw => r.color.toLowerCase().includes(kw)));
            const whites = entries.filter(r => whiteKeywords.some(kw => r.color.toLowerCase().includes(kw)));

            const totals = { bales: 0, lbs: 0, kgs: 0 };
            colors.forEach(r => { totals.bales += r.bales; totals.lbs += r.weight; totals.kgs += r.weight * 0.453592; });

            const whitesTotals = { bales: 0, lbs: 0, kgs: 0 };
            whites.forEach(r => { whitesTotals.bales += r.bales; whitesTotals.lbs += r.weight; whitesTotals.kgs += r.weight * 0.453592; });

            if (entries.length === 0) {
                throw new Error("No matching colors found in the uploaded files.");
            }

            setColorsSummary({ colors, whites, totals, whitesTotals });

        } catch (err: any) {
            console.error("Colors Resume processing failed:", err);
            setColorsError(`Processing failed: ${err.message || String(err)}`);
        } finally {
            setColorsProcessing(false);
        }
    };

    const downloadColorsXLSX = () => {
        if (!colorsSummary) return;

        // Prepare Colors data
        const colorsData = [
            ['COLOR', 'TRANSLATED COLOR', 'BALES', 'WEIGHT (lbs)', 'WEIGHT (kgs)'],
            ...colorsSummary.colors.map((r: any) => [
                r.color,
                r.translated,
                r.bales,
                r.weight,
                Math.round(r.weight * 0.453592 * 10) / 10
            ]),
            ['TOTAL', '', colorsSummary.totals.bales, colorsSummary.totals.lbs, Math.round(colorsSummary.totals.kgs * 10) / 10]
        ];

        // Prepare Whites data
        const whitesData = [
            [''],
            ['WHITES'],
            ['COLOR', 'TRANSLATED COLOR', 'BALES', 'WEIGHT (lbs)', 'WEIGHT (kgs)'],
            ...colorsSummary.whites.map((r: any) => [
                r.color,
                r.translated,
                r.bales,
                r.weight,
                Math.round(r.weight * 0.453592 * 10) / 10
            ]),
            ['TOTAL WHITES', '', colorsSummary.whitesTotals.bales, colorsSummary.whitesTotals.lbs, Math.round(colorsSummary.whitesTotals.kgs * 10) / 10]
        ];

        // Combine all data
        const allData = [...colorsData, ...whitesData];

        // Create worksheet and workbook
        const ws = XLSX.utils.aoa_to_sheet(allData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'SGT Summary');

        // Set column widths
        ws['!cols'] = [
            { wch: 30 }, // Color
            { wch: 30 }, // Translated
            { wch: 10 }, // Bales
            { wch: 15 }, // Weight lbs
            { wch: 15 }  // Weight kgs
        ];

        // Generate and download
        XLSX.writeFile(wb, 'SGT_Summary.xlsx');
    };

    const resetColorsModal = () => {
        setShowColorsModal(false);
        setColorsFiles([]);
        setColorsError(null);
        setColorsSummary(null);
        if (colorsFileInputRef.current) colorsFileInputRef.current.value = '';
    };

    const handleEdit = (order: CommissionSalesOrder, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();

        // ID is the source of truth for the type of record.
        const isInvoice = order.id.startsWith('CSI-');
        setFormMode(isInvoice ? 'INVOICE' : 'ORDER');

        const formState = { ...order };
        if (isInvoice) {
            // The form input is bound to `orderNumber`. We need to populate it with the invoice number,
            // which could be in `invoiceNumber` (new/migrated data) or `orderNumber` (old data).
            formState.orderNumber = order.invoiceNumber || order.orderNumber;
        }

        setEditingOrder(formState);
        setFile(null); // Clear temp file state when editing existing
        setView('FORM');
    };

    const handleDeleteClick = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (window.confirm('Are you sure you want to delete this commission order?')) {
            onDelete(id);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            handleOcr(e.target.files[0]);
        }
    };

    const handleBlUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0] && editingOrder) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = async (event) => {
                const dataUrl = event.target?.result as string;
                setEditingOrder(prev => ({ ...prev!, blDocumentUrl: dataUrl }));

                // OCR the Bill of Lading
                try {
                    setIsProcessing(true);
                    setStatusMessage('Analyzing Bill of Lading...');
                    const mimeType = file.type || (dataUrl.includes('application/pdf') ? 'application/pdf' : 'image/jpeg');
                    // Strip data URL prefix for Gemini API
                    const base64String = dataUrl.replace(/^data:[^;]+;base64,/, '');
                    const result = await analyzeDocument(base64String, mimeType, BOOKING_EXTRACTION_PROMPT);
                    const cleanedResult = result.replace(/```json\n?/gi, '').replace(/```\n?$/gi, '').trim();
                    const parsed = JSON.parse(cleanedResult);

                    // Update form with extracted BL data
                    setEditingOrder(prev => ({
                        ...prev!,
                        blDocumentUrl: dataUrl,
                        blNumber: parsed.bookingNumber || parsed.blNumber || prev?.blNumber || '',
                        etd: parsed.etd || prev?.etd || '',
                        eta: parsed.eta || prev?.eta || '',
                        vesselVoyage: parsed.vesselVoyage || prev?.vesselVoyage || '',
                        pol: normalizePort(parsed.pol || '') || prev?.pol || '',
                        containerNumbers: parsed.containerNumbers || prev?.containerNumbers || '',
                    } as any));

                    setStatusMessage('BL data extracted!');
                    setTimeout(() => { setStatusMessage(''); setIsProcessing(false); }, 1500);
                } catch (err) {
                    console.error('BL OCR error:', err);
                    setStatusMessage('BL uploaded (OCR extraction failed)');
                    setTimeout(() => { setStatusMessage(''); setIsProcessing(false); }, 2000);
                }
            };
            reader.readAsDataURL(file);
        }
    };

    const handlePlUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0] && editingOrder) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (event) => {
                const base64 = event.target?.result as string;
                setEditingOrder({ ...editingOrder, plDocumentUrl: base64 });
            };
            reader.readAsDataURL(file);
        }
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            setFile(e.dataTransfer.files[0]);
            handleOcr(e.dataTransfer.files[0]);
            e.dataTransfer.clearData();
        }
    }

    const handleBlDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.files && e.dataTransfer.files[0] && editingOrder) {
            const file = e.dataTransfer.files[0];
            const reader = new FileReader();
            reader.onload = async (event) => {
                const dataUrl = event.target?.result as string;
                setEditingOrder(prev => ({ ...prev!, blDocumentUrl: dataUrl }));

                // OCR the Bill of Lading
                try {
                    setIsProcessing(true);
                    setStatusMessage('Analyzing Bill of Lading...');
                    const mimeType = file.type || (dataUrl.includes('application/pdf') ? 'application/pdf' : 'image/jpeg');
                    // Strip data URL prefix for Gemini API
                    const base64String = dataUrl.replace(/^data:[^;]+;base64,/, '');
                    const result = await analyzeDocument(base64String, mimeType, BOOKING_EXTRACTION_PROMPT);
                    const cleanedResult = result.replace(/```json\n?/gi, '').replace(/```\n?$/gi, '').trim();
                    const parsed = JSON.parse(cleanedResult);

                    setEditingOrder(prev => ({
                        ...prev!,
                        blDocumentUrl: dataUrl,
                        blNumber: parsed.bookingNumber || parsed.blNumber || prev?.blNumber || '',
                        etd: parsed.etd || prev?.etd || '',
                        eta: parsed.eta || prev?.eta || '',
                        vesselVoyage: parsed.vesselVoyage || prev?.vesselVoyage || '',
                        pol: normalizePort(parsed.pol || '') || prev?.pol || '',
                        containerNumbers: parsed.containerNumbers || prev?.containerNumbers || '',
                    } as any));

                    setStatusMessage('BL data extracted!');
                    setTimeout(() => { setStatusMessage(''); setIsProcessing(false); }, 1500);
                } catch (err) {
                    console.error('BL OCR error:', err);
                    setStatusMessage('BL uploaded (OCR extraction failed)');
                    setTimeout(() => { setStatusMessage(''); setIsProcessing(false); }, 2000);
                }
            };
            reader.readAsDataURL(file);
            e.dataTransfer.clearData();
        }
    };

    const handlePlDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.files && e.dataTransfer.files[0] && editingOrder) {
            const file = e.dataTransfer.files[0];
            const reader = new FileReader();
            reader.onload = (event) => {
                const base64 = event.target?.result as string;
                setEditingOrder(prev => ({ ...prev!, plDocumentUrl: base64 }));
            };
            reader.readAsDataURL(file);
            e.dataTransfer.clearData();
        }
    };

    // Handle Booking OCR - extract booking number and ETD from PDF
    const handleBookingOcr = async (fileToProcess: File) => {
        if (!bookingOcrOrder) return;

        setBookingOcrProcessing(true);
        try {
            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const dataUrl = event.target?.result as string;
                    const base64String = dataUrl.split(',')[1];
                    const result = await analyzeDocument(base64String, fileToProcess.type, BOOKING_EXTRACTION_PROMPT);
                    console.log("Booking OCR Result:", result);

                    if (result.startsWith("Error analyzing doc")) {
                        throw new Error(result);
                    }

                    let cleanJson = result;
                    cleanJson = cleanJson.replace(/```json\s*|\s*```/g, '');
                    cleanJson = cleanJson.replace(/```\s*|\s*```/g, '');
                    cleanJson = cleanJson.trim();

                    const firstBrace = cleanJson.indexOf('{');
                    const lastBrace = cleanJson.lastIndexOf('}');
                    if (firstBrace !== -1 && lastBrace !== -1) {
                        cleanJson = cleanJson.substring(firstBrace, lastBrace + 1);
                    }

                    const parsed = JSON.parse(cleanJson);

                    // Update the order with extracted data
                    const updatedOrder: CommissionSalesOrder = {
                        ...bookingOcrOrder,
                        bookingNumber: parsed.bookingNumber || bookingOcrOrder.bookingNumber,
                        etd: parsed.etd || bookingOcrOrder.etd,
                        bookingDocumentUrl: dataUrl,
                        pod: parsed.pod ? normalizePort(parsed.pod) : bookingOcrOrder.pod,
                    };

                    await onUpdate(updatedOrder);

                    // Also save to bookings table for Logistics AI tracking
                    if (onAddBooking && currentCompanyId) {
                        const newBooking: Booking = {
                            id: `BK-${Date.now()}`,
                            companyId: currentCompanyId,
                            bookingNumber: parsed.bookingNumber || '',
                            customer: bookingOcrOrder.customerName || '',
                            vesselVoyage: parsed.vesselVoyage || '',
                            pol: parsed.pol ? normalizePort(parsed.pol) : '',
                            pod: parsed.pod ? normalizePort(parsed.pod) : bookingOcrOrder.pod || '',
                            equipment: '',
                            etd: parsed.etd || '',
                            eta: parsed.eta || '',
                            originalDocument: dataUrl,
                            salesOrderId: bookingOcrOrder.orderNumber, // Link to commission order
                            status: 'ACTIVE',
                        };
                        await onAddBooking(newBooking);
                    }

                    setBookingOcrOrder(null);
                    alert('Booking data extracted and saved to Logistics AI!');
                } catch (e: any) {
                    console.error("Error during booking OCR:", e);
                    alert(`Failed to extract booking data: ${e.message || "Unknown error"}`);
                } finally {
                    setBookingOcrProcessing(false);
                }
            };
            reader.onerror = () => {
                alert("Failed to read the file.");
                setBookingOcrProcessing(false);
            };
            reader.readAsDataURL(fileToProcess);
        } catch (e) {
            console.error("Booking OCR setup error:", e);
            setBookingOcrProcessing(false);
        }
    };

    const handleOcr = async (fileToProcess: File) => {
        setIsProcessing(true);
        setStatusMessage('Analyzing document...');
        try {
            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const dataUrl = event.target?.result as string;
                    const base64String = dataUrl.split(',')[1];
                    const prompt = formMode === 'INVOICE' ? COMMISSION_INVOICE_EXTRACTION_PROMPT : COMMISSION_ORDER_EXTRACTION_PROMPT;
                    const result = await analyzeDocument(base64String, fileToProcess.type, prompt);
                    console.log("OCR Result:", result);

                    if (result.startsWith("Error analyzing doc")) {
                        throw new Error(result);
                    }

                    let cleanJson = result;
                    // Remove markdown code blocks if present
                    cleanJson = cleanJson.replace(/```json\s*|\s*```/g, '');
                    cleanJson = cleanJson.replace(/```\s*|\s*```/g, ''); // Handle generic code blocks
                    cleanJson = cleanJson.trim();

                    // Attempt to find the first '{' and last '}' if there is extra text
                    const firstBrace = cleanJson.indexOf('{');
                    const lastBrace = cleanJson.lastIndexOf('}');
                    if (firstBrace !== -1 && lastBrace !== -1) {
                        cleanJson = cleanJson.substring(firstBrace, lastBrace + 1);
                    }

                    let parsed;
                    try {
                        parsed = JSON.parse(cleanJson);
                    } catch (parseError) {
                        console.error("JSON Parse Error. Raw text:", result);
                        throw new Error("AI returned invalid data format. Please try again.");
                    }

                    const newItems: CommissionItem[] = (parsed.items || []).map((item: any, index: number) => ({
                        id: `item-${Date.now()}-${index}`,
                        productName: item.productName || '',
                        quantity: Number(item.quantity) || 0,
                        unit: item.unit || 'LBS',
                        pricePerUnit: Number(item.pricePerUnit) || 0,
                        total: Number(item.total) || 0,
                    }));

                    const total = newItems.reduce((sum, i) => sum + (i.total || 0), 0);

                    const paymentTermsValue = (!parsed.paymentTerms || String(parsed.paymentTerms).toLowerCase() === 'n/a') ? '' : parsed.paymentTerms;
                    const deliveryDateValue = (!parsed.deliveryDate || String(parsed.deliveryDate).toLowerCase() === 'n/a') ? '' : parsed.deliveryDate;

                    const formattedDate = formatDate(deliveryDateValue);

                    setEditingOrder(prev => ({
                        ...prev,
                        ...initialFormState,
                        orderNumber: parsed.orderNumber || (formMode === 'INVOICE' ? `CSI-${Date.now().toString().slice(-6)}` : `CSO-${Date.now().toString().slice(-6)}`),
                        sellerName: parsed.sellerName || '',
                        customerName: parsed.customerName || '',
                        incoterm: parsed.incoterm || '',
                        paymentTerms: paymentTermsValue,
                        pod: normalizePort(parsed.pod || ''),
                        deliveryDate: formattedDate,
                        items: newItems,
                        orderTotal: total,
                        originalDocumentUrl: dataUrl,
                    }));

                    // Save Bill of Lading data if shipping info was extracted (for Invoice mode)
                    if (formMode === 'INVOICE' && onSaveBL && currentCompanyId) {
                        const invoiceNumber = parsed.orderNumber || `CSI-${Date.now().toString().slice(-6)}`;
                        const blData: BillOfLading = {
                            id: `BL-${Date.now()}`,
                            companyId: currentCompanyId,
                            blNumber: parsed.bookingNumber || invoiceNumber,
                            bookingNumber: parsed.bookingNumber || '',
                            shipper: parsed.sellerName || '',
                            consignee: parsed.customerName || '',
                            vesselVoyage: parsed.vesselVoyage || '',
                            portLoading: normalizePort(parsed.pol || ''),
                            portDischarge: normalizePort(parsed.pod || ''),
                            shippedDate: parsed.etd || formattedDate || '',
                            eta: parsed.eta || '',
                            container: parsed.containerNumbers || '',
                            originalDocument: dataUrl,
                            status: 'ACTIVE',
                        };
                        try {
                            await onSaveBL(blData);
                            console.log('Bill of Lading saved:', blData);
                        } catch (blError) {
                            console.warn('Failed to save Bill of Lading:', blError);
                        }
                    }

                    setStatusMessage('Success! Form populated.');
                    setTimeout(() => {
                        setIsProcessing(false);
                        setStatusMessage('');
                    }, 1500);

                } catch (e: any) {
                    console.error("Error during OCR analysis/parsing:", e);
                    alert(`Failed to extract data: ${e.message || "Unknown error"}`);
                    setStatusMessage('Error during analysis');
                    setIsProcessing(false);
                    setFile(null);
                }
            };
            reader.onerror = (error) => {
                console.error("File reading error:", error);
                alert("Failed to read the uploaded file.");
                setStatusMessage('Error reading file');
                setIsProcessing(false);
                setFile(null);
            };
            reader.readAsDataURL(fileToProcess);
        } catch (e) {
            console.error("OCR setup error:", e);
            alert("An unexpected error occurred while preparing the file.");
            setIsProcessing(false);
            setFile(null);
            setStatusMessage('File handling error');
        }
    };

    const handleSave = () => {
        if (!editingOrder) return;

        const idPrefix = formMode === 'INVOICE' ? 'CSI-' : 'CSO-';
        const finalOrder: CommissionSalesOrder = {
            ...initialFormState,
            ...editingOrder,
            id: editingOrder.id || `${idPrefix}${Date.now()}`,
            createdAt: editingOrder.createdAt || new Date().toISOString(),
            companyId: currentUser.allowed_company_ids?.[0] || 'ALL',
        } as CommissionSalesOrder;

        if (formMode === 'INVOICE') {
            finalOrder.invoiceNumber = editingOrder.orderNumber; // The user input for invoice #
            finalOrder.orderNumber = ''; // Leave sales order number empty per request
        }

        if (editingOrder.id) {
            onUpdate(finalOrder);
        } else {
            onAdd(finalOrder);
        }
        setView('LIST');
        setEditingOrder(null);
        setFile(null);
    };

    const updateItem = (itemId: string, field: keyof CommissionItem, value: any) => {
        if (!editingOrder) return;
        const newItems = editingOrder.items!.map(item => {
            if (item.id === itemId) {
                const updatedItem = { ...item, [field]: value };
                if (field === 'quantity' || field === 'pricePerUnit') {
                    updatedItem.total = (updatedItem.quantity || 0) * (updatedItem.pricePerUnit || 0);
                }
                return updatedItem;
            }
            return item;
        });
        const newTotal = newItems.reduce((sum, i) => sum + i.total, 0);
        setEditingOrder({ ...editingOrder, items: newItems, orderTotal: newTotal });
    };

    const addItem = () => {
        if (!editingOrder) return;
        const newItem: CommissionItem = { id: `item-${Date.now()}`, productName: '', quantity: 0, unit: 'LBS', pricePerUnit: 0, total: 0 };
        setEditingOrder({ ...editingOrder, items: [...(editingOrder.items || []), newItem] });
    };

    const removeItem = (itemId: string) => {
        if (!editingOrder) return;
        const newItems = editingOrder.items!.filter(i => i.id !== itemId);
        const newTotal = newItems.reduce((sum, i) => sum + i.total, 0);
        setEditingOrder({ ...editingOrder, items: newItems, orderTotal: newTotal });
    };

    useEffect(() => {
        if (!editingOrder) return;

        let commission = 0;
        const rate = editingOrder.commissionRate || 0;

        if (editingOrder.commissionType === 'PERCENT') {
            commission = (editingOrder.orderTotal || 0) * (rate / 100);
        } else {
            let totalWeight = 0;
            editingOrder.items?.forEach(item => {
                if (editingOrder.commissionType === 'PER_LBS') {
                    totalWeight += item.unit === 'LBS' ? item.quantity : item.quantity * 2.20462;
                } else { // PER_KGS
                    totalWeight += item.unit === 'KGS' ? item.quantity : item.quantity * 0.453592;
                }
            });
            commission = totalWeight * rate;
        }
        setEditingOrder(prev => ({ ...prev, commissionAmount: commission }));

    }, [editingOrder?.orderTotal, editingOrder?.commissionRate, editingOrder?.commissionType, editingOrder?.items]);

    const handleDocUpload = async (e: React.ChangeEvent<HTMLInputElement>, field: 'signedDocumentUrl') => {
        if (e.target.files && e.target.files[0] && editingOrder) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (event) => {
                const base64 = event.target?.result as string;
                setEditingOrder({ ...editingOrder, [field]: base64 });
            };
            reader.readAsDataURL(file);
        }
    };

    const Stepper = ({ status }: { status: CommissionSalesOrder['status'] }) => {
        const steps = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SHIPPED', 'COMPLETED'];
        const currentIndex = status ? steps.indexOf(status) : -1;

        return (
            <div className="flex items-center justify-between my-4">
                {steps.map((step, index) => (
                    <React.Fragment key={step}>
                        <div className="flex flex-col items-center text-center">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${index <= currentIndex ? 'bg-orange-500 border-orange-500 text-white' : 'bg-slate-100 border-slate-300 text-slate-400'}`}>
                                {index < currentIndex ? <CheckCircle size={16} /> : index + 1}
                            </div>
                            <span className={`text-xs mt-1 ${index <= currentIndex ? 'text-orange-600 font-bold' : 'text-slate-500'}`}>{step.replace('_', ' ')}</span>
                        </div>
                        {index < steps.length - 1 && <div className={`flex-1 h-0.5 ${index < currentIndex ? 'bg-orange-500' : 'bg-slate-300'}`}></div>}
                    </React.Fragment>
                ))}
            </div>
        );
    };

    if (view === 'LIST') {
        return (
            <div className="space-y-4">
                {viewingDocumentUrl && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in" onClick={() => setViewingDocumentUrl(null)}>
                        <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                            <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center shrink-0">
                                <h3 className="font-bold text-slate-800 flex items-center gap-2"><FileText size={18} /> Document Viewer</h3>
                                <button onClick={() => setViewingDocumentUrl(null)} className="p-1.5 rounded-full text-slate-400 hover:bg-slate-200 transition-colors">
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="flex-1 bg-slate-200 p-2">
                                <iframe src={viewingDocumentUrl} className="w-full h-full border-0 bg-white rounded-md" title="Document Preview" />
                            </div>
                        </div>
                    </div>
                )}
                <div className="mb-6 flex items-start justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl text-white">
                            <Wallet size={24} />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-800">Commissions</h1>
                            <p className="text-slate-500 text-sm mt-1">Track and manage commission orders and invoices</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={handleNewOrder} className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-all shadow-md font-medium" title="New Commission Order">
                            <FilePlus size={18} />
                            New Order
                        </button>
                        <button onClick={handleNewInvoice} className="flex items-center gap-2 px-5 py-2.5 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-all shadow-md font-medium" title="New Commission Invoice">
                            <FilePlus size={18} />
                            New Invoice
                        </button>
                        <button onClick={() => setShowBatchInvoiceModal(true)} className="flex items-center gap-2 px-5 py-2.5 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-all shadow-md font-medium" title="Batch Upload Multiple Invoices">
                            <Layers size={18} />
                            Batch Invoices
                        </button>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => { setCommissionView('COMMISSION_ORDERS'); setFilters({}); setSortConfig(null); }} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${commissionView === 'COMMISSION_ORDERS' ? 'bg-orange-500 text-white shadow-md shadow-orange-200' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50 hover:text-slate-700'}`}>
                        <Package size={16} />
                        Orders
                    </button>
                    <button onClick={() => { setCommissionView('COMMISSION_INVOICES'); setFilters({ commissionPaymentStatus: ['UNPAID'] }); setSortConfig(null); }} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${commissionView === 'COMMISSION_INVOICES' ? 'bg-teal-500 text-white shadow-md shadow-teal-200' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50 hover:text-slate-700'}`}>
                        <FileText size={16} />
                        Invoices
                    </button>
                </div>

                {commissionView === 'COMMISSION_ORDERS' && (
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-slate-50 border-b border-slate-200">
                                <tr>
                                    {renderColumnHeader('orderNumber', 'Order #')}
                                    {renderColumnHeader('sellerName', 'Seller')}
                                    {renderColumnHeader('customerName', 'Customer')}
                                    {renderColumnHeader('pod', 'POD')}
                                    {renderColumnHeader('bookingNumber', 'Booking #')}
                                    <th className="p-3 text-xs font-semibold text-slate-500 uppercase cursor-default">ETD</th>
                                    <th className="p-3 text-xs font-semibold text-slate-500 uppercase cursor-default">ETA</th>
                                    {renderColumnHeader('status', 'Status')}
                                    <th className="p-3 text-right text-xs font-semibold text-slate-500 uppercase cursor-default">QTY</th>
                                    {renderColumnHeader('orderTotal', 'GRAND TOTAL', 'right')}
                                    {renderColumnHeader('commissionRate', 'COMM %', 'right')}
                                    {renderColumnHeader('commissionAmount', 'COMMISSION', 'right')}
                                    <th className="p-3 text-right text-xs font-semibold text-slate-500 uppercase">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-sm">
                                {processedData.length === 0 ? (
                                    <tr>
                                        <td colSpan={13} className="py-8 text-center">
                                            <p className="text-slate-400 text-sm mb-2">No matching records found</p>
                                            {Object.keys(filters).length > 0 && (
                                                <button
                                                    onClick={() => setFilters({})}
                                                    className="text-xs text-blue-600 hover:text-blue-800 font-semibold px-3 py-1.5 rounded-full border border-blue-200 hover:bg-blue-50 transition-colors"
                                                >
                                                    Clear All Filters
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ) : processedData.map(order => (
                                    <tr key={order.id} className="hover:bg-slate-50 group">
                                        <td className="py-1.5 px-3 font-mono font-bold text-slate-700">{order.orderNumber}</td>
                                        <td className="py-1.5 px-3" title={order.sellerName}>{order.sellerName?.split(/[\s,]+/)[0] || ''}</td>
                                        <td className="py-1.5 px-3" title={order.customerName}>{order.customerName?.split(/[\s,]+/)[0] || ''}</td>
                                        <td className="py-1.5 px-3 font-bold">{getDisplayPod(order.pod || '')}</td>
                                        <td className="py-1.5 px-3 font-mono text-blue-600">{bookings.find(b => b.salesOrderId === order.orderNumber)?.bookingNumber || order.bookingNumber || '—'}</td>
                                        <td className="py-1.5 px-3 text-slate-500">{bookings.find(b => b.salesOrderId === order.orderNumber)?.etd || '—'}</td>
                                        <td className="py-1.5 px-3 text-slate-500">{bookings.find(b => b.salesOrderId === order.orderNumber)?.eta || '—'}</td>
                                        <td className="py-1.5 px-3"><span className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs font-bold">{order.status}</span></td>
                                        <td className="py-1.5 px-3 text-right font-mono text-slate-600">{(() => {
                                            // Display totalQuantity if set, otherwise try items
                                            if (order.totalQuantity && order.totalQuantity > 0) {
                                                return order.totalQuantity.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
                                            }
                                            try {
                                                const items = typeof order.items === 'string' ? JSON.parse(order.items || '[]') : (order.items || []);
                                                if (!items || items.length === 0) return '—';
                                                const qty = items.reduce((sum: number, item: any) => sum + (item.quantity || 0), 0);
                                                return qty > 0 ? qty.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—';
                                            } catch { return '—'; }
                                        })()}</td>
                                        <td className="py-1.5 px-3 text-right font-mono text-slate-800">${(order.orderTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                        <td className="py-1.5 px-3 text-right font-mono text-slate-500">{order.commissionType === 'PERCENT' ? `${order.commissionRate || 0}%` : order.commissionType === 'PER_LBS' ? `$${order.commissionRate || 0}/lb` : order.commissionType === 'PER_KGS' ? `$${order.commissionRate || 0}/kg` : `${order.commissionRate || 0}%`}</td>
                                        <td className="py-1.5 px-3 text-right font-mono font-bold text-emerald-600">${(order.commissionAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                        <td className="py-1.5 px-3 text-right">
                                            <div className="flex items-center justify-end gap-2 transition-opacity">
                                                <button onClick={(e) => { e.stopPropagation(); setBookingOcrOrder(order); }} className="p-1 text-slate-400 hover:text-purple-600 rounded-lg hover:bg-purple-50" title="OCR Booking">
                                                    <ScanEye size={16} />
                                                </button>
                                                {order.originalDocumentUrl && (
                                                    <button onClick={(e) => handleViewDocument(order.originalDocumentUrl!, e)} className="p-1 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-blue-50" title="View Original Document">
                                                        <Eye size={16} />
                                                    </button>
                                                )}
                                                <button onClick={(e) => handleEdit(order, e)} className="p-1 text-slate-400 hover:text-amber-600 rounded-lg hover:bg-amber-50" title="Edit">
                                                    <Pencil size={16} />
                                                </button>
                                                <button onClick={(e) => handleDeleteClick(order.id, e)} className="p-1 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50" title="Delete">
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            {processedData.length > 0 && (
                                <tfoot className="bg-slate-50 border-t-2 border-slate-300">
                                    <tr>
                                        <td colSpan={9} className="p-3 text-right text-xs font-bold text-slate-500 uppercase">Totals</td>
                                        <td className="p-3 text-right font-mono font-bold text-slate-800">${processedData.reduce((sum, o) => sum + (o.orderTotal || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                        <td className="p-3"></td>
                                        <td className="p-3 text-right font-mono font-bold text-emerald-600">${processedData.reduce((sum, o) => sum + (o.commissionAmount || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                        <td className="p-3"></td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                )
                }

                {
                    commissionView === 'COMMISSION_INVOICES' && (
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-slate-50 border-b border-slate-200">
                                    <tr>
                                        {renderColumnHeader('invoiceNumber', 'Invoice #')}
                                        {renderColumnHeader('sellerName', 'Seller')}
                                        {renderColumnHeader('customerName', 'Customer')}
                                        {renderColumnHeader('pod', 'POD')}
                                        <th className="p-3 text-left text-xs font-semibold text-slate-500 uppercase">BL#</th>
                                        <th className="p-3 text-left text-xs font-semibold text-slate-500 uppercase">ETD</th>
                                        <th className="p-3 text-left text-xs font-semibold text-slate-500 uppercase">ETA</th>
                                        {renderColumnHeader('orderTotal', 'Invoice Total', 'right')}
                                        {renderColumnHeader('invoiceStatus', 'Invoice Status')}
                                        {renderColumnHeader('commissionAmount', 'Commission', 'right')}
                                        {renderColumnHeader('commissionPaymentStatus', 'Commission Status')}
                                        <th className="p-3 text-right text-xs font-semibold text-slate-500 uppercase">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-sm">
                                    {processedData.length === 0 ? (
                                        <tr>
                                            <td colSpan={12} className="py-8 text-center">
                                                <p className="text-slate-400 text-sm mb-2">No matching records found</p>
                                                {Object.keys(filters).length > 0 && (
                                                    <button
                                                        onClick={() => setFilters({})}
                                                        className="text-xs text-blue-600 hover:text-blue-800 font-semibold px-3 py-1.5 rounded-full border border-blue-200 hover:bg-blue-50 transition-colors"
                                                    >
                                                        Clear All Filters
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ) : processedData.map(invoice => (
                                        <tr key={invoice.id} className="hover:bg-slate-50">
                                            <td className="py-1.5 px-3 font-mono font-bold text-slate-700">{invoice.invoiceNumber || invoice.orderNumber}</td>
                                            <td className="py-1.5 px-3" title={invoice.sellerName}>{invoice.sellerName?.split(/[\s,]+/)[0] || ''}</td>
                                            <td className="py-1.5 px-3" title={invoice.customerName}>{invoice.customerName?.split(/[\s,]+/)[0] || ''}</td>
                                            <td className="py-1.5 px-3 font-bold">{getDisplayPod(invoice.pod || '')}</td>
                                            <td className="py-1.5 px-3 font-mono text-blue-600">{(invoice as any).blNumber || billOfLadings.find(bl => bl.blNumber === invoice.invoiceNumber || bl.blNumber === invoice.orderNumber || bl.bookingNumber === invoice.invoiceNumber)?.blNumber || '—'}</td>
                                            <td className="py-1.5 px-3 text-slate-500">{(invoice as any).etd || billOfLadings.find(bl => bl.blNumber === invoice.invoiceNumber || bl.blNumber === invoice.orderNumber || bl.bookingNumber === invoice.invoiceNumber)?.shippedDate || '—'}</td>
                                            <td className="py-1.5 px-3 text-slate-500">{(invoice as any).eta || billOfLadings.find(bl => bl.blNumber === invoice.invoiceNumber || bl.blNumber === invoice.orderNumber || bl.bookingNumber === invoice.invoiceNumber)?.eta || '—'}</td>
                                            <td className="py-1.5 px-3 text-right font-mono text-slate-800">${(invoice.orderTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                            <td className="py-1.5 px-3">
                                                <span className={`px-2 py-1 rounded text-xs font-bold ${invoice.invoiceStatus === 'PAID' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                                                    }`}>{invoice.invoiceStatus || 'UNPAID'}</span>
                                            </td>
                                            <td className="py-1.5 px-3 text-right font-mono font-bold text-emerald-600">${(invoice.commissionAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                            <td className="py-1.5 px-3">
                                                <span className={`px-2 py-1 rounded text-xs font-bold ${invoice.commissionPaymentStatus === 'PAID' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                                                    }`}>{invoice.commissionPaymentStatus || 'UNPAID'}</span>
                                            </td>
                                            <td className="py-1.5 px-3 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button onClick={(e) => handleFetchDocument(invoice.id, 'BL', e)} className="p-1 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50" title="View Bill of Lading">
                                                        {loadingDoc?.id === invoice.id && loadingDoc?.type === 'BL' ? <Loader2 className="animate-spin" size={16} /> : <Ship size={16} />}
                                                    </button>
                                                    <button onClick={(e) => handleFetchDocument(invoice.id, 'PL', e)} className="p-1 text-slate-400 hover:text-teal-600 rounded-lg hover:bg-teal-50" title="View Packing List">
                                                        {loadingDoc?.id === invoice.id && loadingDoc?.type === 'PL' ? <Loader2 className="animate-spin" size={16} /> : <List size={16} />}
                                                    </button>
                                                    <button onClick={(e) => handleFetchDocument(invoice.id, 'INVOICE', e)} className="p-1 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-blue-50" title="View Invoice">
                                                        {loadingDoc?.id === invoice.id && loadingDoc?.type === 'INVOICE' ? <Loader2 className="animate-spin" size={16} /> : <Eye size={16} />}
                                                    </button>
                                                    <button onClick={(e) => handleEdit(invoice, e)} className="p-1 text-slate-400 hover:text-amber-600 rounded-lg hover:bg-amber-50" title="Edit">
                                                        <Pencil size={16} />
                                                    </button>
                                                    <button onClick={(e) => handleDeleteClick(invoice.id, e)} className="p-1 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50" title="Delete">
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="bg-slate-50 border-t-2 border-slate-300">
                                    <tr>
                                        <td colSpan={7} className="p-3 text-right text-xs font-bold text-slate-500 uppercase">Totals</td>
                                        <td className="p-3 text-right font-mono font-bold text-slate-800">${processedData.reduce((sum, i) => sum + (i.orderTotal || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                        <td className="p-3"></td>
                                        <td className="p-3 text-right font-mono font-bold text-emerald-600">${processedData.reduce((sum, i) => sum + (i.commissionAmount || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                        <td colSpan={2}></td>
                                    </tr>
                                    {totalUnpaidCommission > 0 && (
                                        <tr>
                                            <td colSpan={7} className="p-3 text-right text-xs font-bold text-red-500 uppercase">Unpaid Commission</td>
                                            <td className="p-3"></td>
                                            <td className="p-3"></td>
                                            <td className="p-3 text-right font-mono font-bold text-red-600">${totalUnpaidCommission.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                            <td colSpan={2}></td>
                                        </tr>
                                    )}
                                </tfoot>
                            </table>
                        </div>
                    )
                }

                {/* Booking OCR Modal */}
                {
                    bookingOcrOrder && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
                            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md animate-in zoom-in-95">
                                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-purple-50 to-indigo-50">
                                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                        <ScanEye size={20} className="text-purple-600" />
                                        OCR Booking - {bookingOcrOrder.orderNumber}
                                    </h3>
                                    <button onClick={() => setBookingOcrOrder(null)} className="text-slate-400 hover:text-slate-600" disabled={bookingOcrProcessing}>
                                        <X size={24} />
                                    </button>
                                </div>
                                <div className="p-6">
                                    <p className="text-sm text-slate-600 mb-4">
                                        Upload a booking confirmation PDF to automatically extract the booking number, ETD, and save to Logistics AI.
                                    </p>
                                    <input
                                        type="file"
                                        ref={bookingFileInputRef}
                                        accept=".pdf,image/*"
                                        className="hidden"
                                        onChange={(e) => {
                                            const f = e.target.files?.[0];
                                            if (f) handleBookingOcr(f);
                                        }}
                                    />
                                    <div
                                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            const f = e.dataTransfer.files?.[0];
                                            if (f && !bookingOcrProcessing) handleBookingOcr(f);
                                        }}
                                        onClick={() => !bookingOcrProcessing && bookingFileInputRef.current?.click()}
                                        className={`w-full border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${bookingOcrProcessing
                                            ? 'border-slate-200 bg-slate-50 cursor-wait'
                                            : 'border-purple-300 hover:border-purple-500 hover:bg-purple-50'
                                            }`}
                                    >
                                        {bookingOcrProcessing ? (
                                            <div className="flex flex-col items-center gap-3">
                                                <Loader2 size={32} className="animate-spin text-purple-600" />
                                                <span className="text-slate-600 font-medium">Processing booking...</span>
                                            </div>
                                        ) : (
                                            <div className="flex flex-col items-center gap-3">
                                                <UploadCloud size={32} className="text-purple-500" />
                                                <span className="text-slate-600 font-medium">Drop PDF here or click to upload</span>
                                                <span className="text-xs text-slate-400">Supports PDF and image files</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                }

                {/* Batch Invoice Upload Modal */}
                {
                    showBatchInvoiceModal && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
                            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col animate-in zoom-in-95">
                                <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-indigo-50 to-blue-50 shrink-0">
                                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                        <Layers size={20} className="text-indigo-600" />
                                        Batch Invoice Upload
                                    </h3>
                                    <button onClick={resetBatchModal} className="text-slate-400 hover:text-slate-600" disabled={batchProcessing}>
                                        <X size={24} />
                                    </button>
                                </div>
                                <div className="p-5 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
                                    <p className="text-sm text-slate-600">
                                        Upload a B/L first, then drop your invoice files. Set commission rate to save complete records.
                                    </p>

                                    {/* Step 1: B/L Upload */}
                                    <div className="p-4 border border-slate-200 rounded-lg bg-slate-50/50 space-y-3">
                                        <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">Step 1 — Bill of Lading</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            {/* BL Drop Zone */}
                                            <div
                                                onClick={() => !batchProcessing && !batchBlProcessing && batchBlFileInputRef.current?.click()}
                                                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                                onDrop={(e) => {
                                                    e.preventDefault(); e.stopPropagation();
                                                    const f = e.dataTransfer.files?.[0];
                                                    if (f && !batchProcessing && !batchBlProcessing) handleBatchBlUpload(f);
                                                }}
                                                className={`p-4 border-2 border-dashed rounded-xl text-center cursor-pointer transition-all ${batchBlProcessing ? 'border-slate-200 bg-slate-50 cursor-wait'
                                                    : batchBlFile ? 'border-emerald-400 bg-emerald-50'
                                                        : 'border-blue-300 hover:border-blue-500 hover:bg-blue-50'
                                                    }`}
                                            >
                                                <input ref={batchBlFileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden"
                                                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleBatchBlUpload(f); }} />
                                                {batchBlProcessing ? (
                                                    <div className="flex flex-col items-center gap-2">
                                                        <Loader2 size={24} className="animate-spin text-blue-600" />
                                                        <span className="text-xs text-blue-600 font-medium">Analyzing B/L...</span>
                                                    </div>
                                                ) : batchBlFile ? (
                                                    <div className="flex flex-col items-center gap-2">
                                                        <CheckCircle size={24} className="text-emerald-500" />
                                                        <span className="text-xs text-emerald-700 font-medium truncate max-w-full">{batchBlFile.name}</span>
                                                        {batchBlData?.blNumber && <span className="text-xs font-bold text-slate-700">BL#: {batchBlData.blNumber}</span>}
                                                    </div>
                                                ) : (
                                                    <div className="flex flex-col items-center gap-2">
                                                        <Ship size={24} className="text-blue-400" />
                                                        <span className="text-xs text-slate-600 font-medium">Drop B/L here</span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* BL Info / Manual Input */}
                                            <div className="space-y-2">
                                                <div>
                                                    <label className="text-xs font-medium text-slate-500 mb-0.5 block">B/L Number</label>
                                                    <input type="text" value={batchBLNumber} onChange={e => setBatchBLNumber(e.target.value)}
                                                        placeholder="Auto-filled from OCR or type manually" disabled={batchProcessing}
                                                        className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-300 outline-none" />
                                                </div>
                                                {batchBlData && (
                                                    <div className="grid grid-cols-2 gap-1.5 text-xs">
                                                        {batchBlData.etd && <div className="bg-white border border-slate-100 rounded px-2 py-1"><span className="text-slate-400">ETD:</span> <span className="font-medium">{batchBlData.etd}</span></div>}
                                                        {batchBlData.eta && <div className="bg-white border border-slate-100 rounded px-2 py-1"><span className="text-slate-400">ETA:</span> <span className="font-medium">{batchBlData.eta}</span></div>}
                                                        {batchBlData.vesselVoyage && <div className="bg-white border border-slate-100 rounded px-2 py-1 col-span-2"><span className="text-slate-400">Vessel:</span> <span className="font-medium">{batchBlData.vesselVoyage}</span></div>}
                                                        {batchBlData.containerNumbers && <div className="bg-white border border-slate-100 rounded px-2 py-1 col-span-2 truncate"><span className="text-slate-400">Containers:</span> <span className="font-medium">{batchBlData.containerNumbers}</span></div>}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Step 2: Commission Config */}
                                    <div className="p-4 border border-slate-200 rounded-lg bg-slate-50/50 space-y-3">
                                        <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">Step 2 — Commission Rate</h4>
                                        <div className="flex items-center gap-2">
                                            <div className="grid grid-cols-3 gap-1.5 flex-1">
                                                <button type="button" onClick={() => setBatchCommissionType('PERCENT')}
                                                    className={`py-2 text-xs font-bold rounded-lg transition-all border ${batchCommissionType === 'PERCENT'
                                                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'}`}>
                                                    Percentage (%)
                                                </button>
                                                <button type="button" onClick={() => setBatchCommissionType('PER_LBS')}
                                                    className={`py-2 text-xs font-bold rounded-lg transition-all border ${batchCommissionType === 'PER_LBS'
                                                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'}`}>
                                                    $/LBS
                                                </button>
                                                <button type="button" onClick={() => setBatchCommissionType('PER_KGS')}
                                                    className={`py-2 text-xs font-bold rounded-lg transition-all border ${batchCommissionType === 'PER_KGS'
                                                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'}`}>
                                                    $/KGS
                                                </button>
                                            </div>
                                            <div className="relative w-36">
                                                <input type="number" step="0.0001" value={batchCommissionRate || ''}
                                                    onChange={e => setBatchCommissionRate(parseFloat(e.target.value) || 0)}
                                                    placeholder="Rate" disabled={batchProcessing}
                                                    className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm font-bold focus:ring-2 focus:ring-blue-300 outline-none" />
                                                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                                                    {batchCommissionType === 'PERCENT' ? '%' : batchCommissionType === 'PER_LBS' ? '/lb' : '/kg'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Drop Zone */}
                                    <div
                                        onClick={() => !batchProcessing && batchFileInputRef.current?.click()}
                                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setBatchDragActive(true); }}
                                        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setBatchDragActive(false); }}
                                        onDrop={handleBatchDrop}
                                        className={`p-6 border-2 border-dashed rounded-xl text-center cursor-pointer transition-all ${batchProcessing ? 'border-slate-200 bg-slate-50 cursor-wait'
                                            : batchDragActive ? 'border-indigo-500 bg-indigo-50'
                                                : 'border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/50'
                                            }`}
                                    >
                                        <input
                                            ref={batchFileInputRef}
                                            type="file"
                                            accept=".pdf,.png,.jpg,.jpeg"
                                            multiple
                                            onChange={handleBatchFilesSelect}
                                            className="hidden"
                                        />
                                        <UploadCloud size={36} className="mx-auto text-indigo-400 mb-2" />
                                        <p className="text-sm font-medium text-slate-700">Drop invoice files here or click to browse</p>
                                        <p className="text-xs text-slate-400 mt-1">Supports PDF and image files — select multiple</p>
                                    </div>

                                    {/* File List */}
                                    {batchInvoiceFiles.length > 0 && batchInvoiceResults.length === 0 && (
                                        <div className="space-y-1">
                                            <p className="text-xs font-bold text-slate-500 uppercase">{batchInvoiceFiles.length} file(s) queued</p>
                                            {batchInvoiceFiles.map((f, idx) => (
                                                <div key={idx} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 text-sm">
                                                    <span className="flex items-center gap-2 text-slate-700 truncate">
                                                        <FileText size={14} className="text-indigo-500 shrink-0" />
                                                        {f.name}
                                                    </span>
                                                    <button onClick={() => handleBatchRemoveFile(idx)} className="text-slate-400 hover:text-red-500 shrink-0 ml-2" disabled={batchProcessing}>
                                                        <X size={14} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Progress */}
                                    {batchProcessing && (
                                        <div className="flex items-center gap-3 bg-indigo-50 rounded-lg px-4 py-3">
                                            <Loader2 size={18} className="animate-spin text-indigo-600 shrink-0" />
                                            <div className="flex-1">
                                                <p className="text-sm font-medium text-indigo-700">Processing {batchProgress.current} of {batchProgress.total}...</p>
                                                <div className="w-full bg-indigo-200 rounded-full h-1.5 mt-1">
                                                    <div className="bg-indigo-600 h-1.5 rounded-full transition-all" style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }} />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Results Table */}
                                    {batchInvoiceResults.length > 0 && (
                                        <div className="border border-slate-200 rounded-lg overflow-hidden">
                                            <table className="w-full text-sm">
                                                <thead className="bg-slate-50 border-b border-slate-200">
                                                    <tr>
                                                        <th className="p-2.5 text-left text-xs font-semibold text-slate-500 uppercase">File</th>
                                                        <th className="p-2.5 text-left text-xs font-semibold text-slate-500 uppercase">Invoice #</th>
                                                        <th className="p-2.5 text-left text-xs font-semibold text-slate-500 uppercase">Seller</th>
                                                        <th className="p-2.5 text-left text-xs font-semibold text-slate-500 uppercase">Customer</th>
                                                        <th className="p-2.5 text-right text-xs font-semibold text-slate-500 uppercase">Total</th>
                                                        <th className="p-2.5 text-center text-xs font-semibold text-slate-500 uppercase">Status</th>
                                                        <th className="p-2.5 text-center text-xs font-semibold text-slate-500 uppercase w-10"></th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {batchInvoiceResults.map((r, idx) => (
                                                        <tr key={idx} className={r.status === 'error' ? 'bg-red-50/50' : ''}>
                                                            <td className="p-2.5 text-slate-600 truncate max-w-[150px]" title={r.file.name}>{r.file.name}</td>
                                                            <td className="p-2.5 font-mono font-bold text-slate-700">{r.data.orderNumber || '—'}</td>
                                                            <td className="p-2.5 text-slate-600" title={r.data.sellerName}>{r.data.sellerName?.split(/[\s,]+/)[0] || '—'}</td>
                                                            <td className="p-2.5 text-slate-600" title={r.data.customerName}>{r.data.customerName?.split(/[\s,]+/)[0] || '—'}</td>
                                                            <td className="p-2.5 text-right font-mono text-slate-800">{r.data.orderTotal ? `$${r.data.orderTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—'}</td>
                                                            <td className="p-2.5 text-center">
                                                                {r.status === 'pending' && <span className="text-slate-400 text-xs">Pending</span>}
                                                                {r.status === 'processing' && <Loader2 size={14} className="animate-spin text-indigo-500 mx-auto" />}
                                                                {r.status === 'done' && <CheckCircle size={14} className="text-emerald-500 mx-auto" />}
                                                                {r.status === 'error' && <span title={r.error}><AlertCircle size={14} className="text-red-500 mx-auto" /></span>}
                                                            </td>
                                                            <td className="p-2.5 text-center">
                                                                {r.status !== 'processing' && (
                                                                    <button onClick={() => handleBatchRemoveResult(idx)} className="text-slate-400 hover:text-red-500" disabled={batchProcessing}>
                                                                        <X size={14} />
                                                                    </button>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>

                                {/* Footer Actions */}
                                <div className="p-5 border-t border-slate-100 flex gap-3 shrink-0 bg-slate-50">
                                    <button
                                        onClick={resetBatchModal}
                                        className="flex-1 px-4 py-2.5 border border-slate-300 rounded-lg text-slate-600 font-medium hover:bg-slate-100 transition-colors"
                                        disabled={batchProcessing}
                                    >
                                        Cancel
                                    </button>
                                    {batchInvoiceResults.filter(r => r.status === 'done').length > 0 ? (
                                        <button
                                            onClick={handleBatchSaveAll}
                                            disabled={batchProcessing}
                                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-bold transition-all ${batchProcessing
                                                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                                : 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-700 hover:to-teal-700 shadow-md hover:shadow-lg'
                                                }`}
                                        >
                                            {batchProcessing ? (
                                                <><Loader2 size={18} className="animate-spin" /> Saving...</>
                                            ) : (
                                                <><Save size={18} /> Save All ({batchInvoiceResults.filter(r => r.status === 'done').length})</>
                                            )}
                                        </button>
                                    ) : (
                                        <button
                                            onClick={processBatchInvoices}
                                            disabled={batchInvoiceFiles.length === 0 || batchProcessing}
                                            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-bold transition-all ${batchInvoiceFiles.length === 0 || batchProcessing
                                                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                                : 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white hover:from-indigo-700 hover:to-blue-700 shadow-md hover:shadow-lg'
                                                }`}
                                        >
                                            {batchProcessing ? (
                                                <><Loader2 size={18} className="animate-spin" /> Processing...</>
                                            ) : (
                                                <><Sparkles size={18} /> Process All ({batchInvoiceFiles.length})</>
                                            )}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )
                }

                {/* Colors Resume XLSX Modal */}
                {
                    showColorsModal && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
                            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col animate-in zoom-in-95">
                                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-purple-50 to-indigo-50">
                                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                        <FileSpreadsheet size={20} className="text-purple-600" />
                                        Colors Resume - SGT Summary
                                    </h3>
                                    <button onClick={resetColorsModal} className="text-slate-400 hover:text-slate-600">
                                        <X size={24} />
                                    </button>
                                </div>
                                <div className="p-6 space-y-4 overflow-y-auto flex-1">
                                    {/* File Upload Zone */}
                                    <div
                                        onClick={() => colorsFileInputRef.current?.click()}
                                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setColorsDragActive(true); }}
                                        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setColorsDragActive(false); }}
                                        onDrop={handleColorsDrop}
                                        className={`p-6 border-2 border-dashed rounded-xl text-center cursor-pointer transition-all ${colorsDragActive ? 'border-purple-500 bg-purple-50' : 'border-slate-300 hover:border-purple-400 hover:bg-purple-50/50'
                                            }`}
                                    >
                                        <input
                                            ref={colorsFileInputRef}
                                            type="file"
                                            accept=".xlsx,.xls"
                                            multiple
                                            onChange={handleColorsFilesSelect}
                                            className="hidden"
                                        />
                                        <div className="space-y-2">
                                            <FileSpreadsheet size={40} className="mx-auto text-purple-400" />
                                            <p className="text-slate-600 font-medium">
                                                Drag & drop Inventory XLSX files here
                                            </p>
                                            <p className="text-xs text-slate-400">or click to browse (supports multiple files)</p>
                                        </div>
                                    </div>

                                    {/* Uploaded Files List */}
                                    {colorsFiles.length > 0 && (
                                        <div className="space-y-2">
                                            <p className="text-sm font-bold text-slate-600">{colorsFiles.length} file(s) selected:</p>
                                            <div className="flex flex-wrap gap-2">
                                                {colorsFiles.map((f, i) => (
                                                    <div key={i} className="flex items-center gap-2 bg-green-50 text-green-700 px-3 py-1.5 rounded-lg text-sm">
                                                        <CheckCircle2 size={14} />
                                                        {f.name}
                                                        <button onClick={(e) => { e.stopPropagation(); setColorsFiles(prev => prev.filter((_, idx) => idx !== i)); }} className="text-red-500 hover:text-red-700 ml-1">
                                                            <X size={12} />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {colorsError && (
                                        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
                                            <AlertCircle size={18} />
                                            {colorsError}
                                        </div>
                                    )}

                                    {/* Summary Results */}
                                    {colorsSummary && (
                                        <div className="space-y-4">
                                            <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm font-bold flex items-center gap-2">
                                                <CheckCircle2 size={18} />
                                                Summary generated! {colorsSummary.colors.length + colorsSummary.whites.length} colors found.
                                            </div>

                                            {/* Colors Table */}
                                            <div className="border border-slate-200 rounded-lg overflow-hidden">
                                                <div className="bg-slate-100 p-2 font-bold text-sm text-slate-700">Colors ({colorsSummary.colors.length})</div>
                                                <div className="max-h-48 overflow-y-auto">
                                                    <table className="w-full text-xs">
                                                        <thead className="bg-slate-50 sticky top-0">
                                                            <tr>
                                                                <th className="p-2 text-left">Color</th>
                                                                <th className="p-2 text-left">Translated</th>
                                                                <th className="p-2 text-right">Bales</th>
                                                                <th className="p-2 text-right">Weight (lbs)</th>
                                                                <th className="p-2 text-right">Weight (kgs)</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-slate-100">
                                                            {colorsSummary.colors.map((r: any, i: number) => (
                                                                <tr key={i} className="hover:bg-slate-50">
                                                                    <td className="p-2">{r.color}</td>
                                                                    <td className="p-2 text-slate-600">{r.translated}</td>
                                                                    <td className="p-2 text-right font-mono">{r.bales}</td>
                                                                    <td className="p-2 text-right font-mono">{r.weight.toLocaleString()}</td>
                                                                    <td className="p-2 text-right font-mono">{(r.weight * 0.453592).toFixed(1)}</td>
                                                                </tr>
                                                            ))}
                                                            <tr className="bg-slate-100 font-bold">
                                                                <td className="p-2" colSpan={2}>TOTAL</td>
                                                                <td className="p-2 text-right font-mono">{colorsSummary.totals.bales}</td>
                                                                <td className="p-2 text-right font-mono">{colorsSummary.totals.lbs.toLocaleString()}</td>
                                                                <td className="p-2 text-right font-mono">{colorsSummary.totals.kgs.toFixed(1)}</td>
                                                            </tr>
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>

                                            {/* Whites Table */}
                                            {colorsSummary.whites.length > 0 && (
                                                <div className="border border-slate-200 rounded-lg overflow-hidden">
                                                    <div className="bg-blue-50 p-2 font-bold text-sm text-blue-700">Whites ({colorsSummary.whites.length})</div>
                                                    <div className="max-h-48 overflow-y-auto">
                                                        <table className="w-full text-xs">
                                                            <thead className="bg-slate-50 sticky top-0">
                                                                <tr>
                                                                    <th className="p-2 text-left">Color</th>
                                                                    <th className="p-2 text-left">Translated</th>
                                                                    <th className="p-2 text-right">Bales</th>
                                                                    <th className="p-2 text-right">Weight (lbs)</th>
                                                                    <th className="p-2 text-right">Weight (kgs)</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-slate-100">
                                                                {colorsSummary.whites.map((r: any, i: number) => (
                                                                    <tr key={i} className="hover:bg-slate-50">
                                                                        <td className="p-2">{r.color}</td>
                                                                        <td className="p-2 text-slate-600">{r.translated}</td>
                                                                        <td className="p-2 text-right font-mono">{r.bales}</td>
                                                                        <td className="p-2 text-right font-mono">{r.weight.toLocaleString()}</td>
                                                                        <td className="p-2 text-right font-mono">{(r.weight * 0.453592).toFixed(1)}</td>
                                                                    </tr>
                                                                ))}
                                                                <tr className="bg-blue-50 font-bold">
                                                                    <td className="p-2" colSpan={2}>TOTAL WHITES</td>
                                                                    <td className="p-2 text-right font-mono">{colorsSummary.whitesTotals.bales}</td>
                                                                    <td className="p-2 text-right font-mono">{colorsSummary.whitesTotals.lbs.toLocaleString()}</td>
                                                                    <td className="p-2 text-right font-mono">{colorsSummary.whitesTotals.kgs.toFixed(1)}</td>
                                                                </tr>
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Actions */}
                                    <div className="flex gap-3 pt-2">
                                        <button
                                            onClick={resetColorsModal}
                                            className="flex-1 px-4 py-2.5 border border-slate-300 rounded-lg text-slate-600 font-medium hover:bg-slate-50 transition-colors"
                                        >
                                            Cancel
                                        </button>
                                        {!colorsSummary ? (
                                            <button
                                                onClick={processColorsResume}
                                                disabled={colorsFiles.length === 0 || colorsProcessing}
                                                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-bold transition-all ${colorsFiles.length === 0 || colorsProcessing
                                                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                                    : 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700 shadow-md hover:shadow-lg'
                                                    }`}
                                            >
                                                {colorsProcessing ? (
                                                    <>
                                                        <Loader2 size={18} className="animate-spin" />
                                                        Processing...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Sparkles size={18} />
                                                        Generate Summary
                                                    </>
                                                )}
                                            </button>
                                        ) : (
                                            <button
                                                onClick={downloadColorsXLSX}
                                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-bold bg-green-600 text-white hover:bg-green-700 transition-colors shadow-md"
                                            >
                                                <Download size={18} />
                                                Download XLSX
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )
                }
            </div >
        );
    }

    const isInvoiceMode = editingOrder?.id ? editingOrder.id.startsWith('CSI-') : formMode === 'INVOICE';

    return (
        <div className="space-y-4">
            <button onClick={() => setView('LIST')} className="text-sm text-slate-500 hover:text-slate-800">← Back to List</button>
            <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 space-y-6 h-[calc(100vh-14rem)] overflow-y-auto custom-scrollbar">
                <div className="flex justify-between items-center">
                    <h2 className="text-xl font-bold text-slate-800">{editingOrder?.id ? 'Edit' : 'New'} Commission {isInvoiceMode ? 'from Invoice' : 'Order'}</h2>
                    <div className="flex gap-2">
                        <button onClick={handleSave} className="bg-orange-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-orange-600"><Save size={16} /> Save</button>
                        {editingOrder?.id && <button onClick={() => onDelete(editingOrder!.id!)} className="bg-red-50 text-red-600 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-red-100"><Trash2 size={16} /> Delete</button>}
                    </div>
                </div>

                {!isInvoiceMode && <Stepper status={editingOrder?.status || 'DRAFT'} />}

                {/* Split Upload Zones for Invoice Mode */}
                {isInvoiceMode ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* 1. Invoice Upload (Main) */}
                        <div
                            className="border-2 border-dashed border-blue-300 bg-blue-50/50 rounded-xl p-6 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-100/50 transition-colors flex flex-col items-center justify-center min-h-[160px]"
                            onClick={() => fileInputRef.current?.click()}
                            onDrop={handleDrop}
                            onDragOver={(e) => e.preventDefault()}
                        >
                            <div className="bg-blue-100 p-2.5 rounded-full mb-2 text-blue-600">
                                <Receipt size={20} />
                            </div>
                            <h4 className="font-bold text-slate-700 text-sm">Upload Invoice</h4>
                            <p className="text-xs text-slate-500 mb-2">Starts Auto-Fill</p>
                            {editingOrder?.originalDocumentUrl ? (
                                <div className="flex items-center gap-2 text-xs font-medium text-emerald-600 bg-white px-2 py-1 rounded shadow-sm">
                                    <CheckCircle size={12} /> {file ? file.name : "Document Attached"}
                                </div>
                            ) : (
                                <span className="text-xs text-blue-600 font-bold underline">Select File</span>
                            )}
                            <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg" onChange={handleFileChange} className="hidden" />
                        </div>

                        {/* 2. BL Upload */}
                        <div
                            className="border-2 border-dashed border-indigo-300 bg-indigo-50/50 rounded-xl p-6 text-center cursor-pointer hover:border-indigo-500 hover:bg-indigo-100/50 transition-colors flex flex-col items-center justify-center min-h-[160px]"
                            onClick={() => blFileInputRef.current?.click()}
                            onDrop={handleBlDrop}
                            onDragOver={(e) => e.preventDefault()}
                        >
                            <div className="bg-indigo-100 p-2.5 rounded-full mb-2 text-indigo-600">
                                <FileText size={20} />
                            </div>
                            <h4 className="font-bold text-slate-700 text-sm">Drop Bill of Lading</h4>
                            <p className="text-xs text-slate-500 mb-2">Optional</p>
                            {editingOrder?.blDocumentUrl ? (
                                <div className="flex items-center gap-2 text-xs font-medium text-emerald-600 bg-white px-2 py-1 rounded shadow-sm">
                                    <CheckCircle size={12} /> BL Attached
                                </div>
                            ) : (
                                <span className="text-xs text-indigo-600 font-bold underline">Select File</span>
                            )}
                            <input ref={blFileInputRef} type="file" accept=".pdf,.png,.jpg" onChange={handleBlUpload} className="hidden" />
                        </div>

                        {/* 3. PL Upload */}
                        <div
                            className="border-2 border-dashed border-teal-300 bg-teal-50/50 rounded-xl p-6 text-center cursor-pointer hover:border-teal-500 hover:bg-teal-100/50 transition-colors flex flex-col items-center justify-center min-h-[160px]"
                            onClick={() => plFileInputRef.current?.click()}
                            onDrop={handlePlDrop}
                            onDragOver={(e) => e.preventDefault()}
                        >
                            <div className="bg-teal-100 p-2.5 rounded-full mb-2 text-teal-600">
                                <ClipboardList size={20} />
                            </div>
                            <h4 className="font-bold text-slate-700 text-sm">Drop Packing List</h4>
                            <p className="text-xs text-slate-500 mb-2">Optional</p>
                            {editingOrder?.plDocumentUrl ? (
                                <div className="flex items-center gap-2 text-xs font-medium text-emerald-600 bg-white px-2 py-1 rounded shadow-sm">
                                    <CheckCircle size={12} /> PL Attached
                                </div>
                            ) : (
                                <span className="text-xs text-teal-600 font-bold underline">Select File</span>
                            )}
                            <input ref={plFileInputRef} type="file" accept=".pdf,.png,.jpg" onChange={handlePlUpload} className="hidden" />
                        </div>
                    </div>
                ) : (
                    // Regular Commission Order Uploader (Original Single Pane)
                    <div
                        className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center cursor-pointer hover:border-orange-400 hover:bg-orange-50 transition-colors"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <div className="flex flex-col items-center justify-center">
                            <div className="bg-orange-100 p-3 rounded-full mb-3 text-orange-600">
                                <UploadCloud size={24} />
                            </div>
                            <h3 className="font-bold text-slate-700">Start with a Document</h3>
                            <p className="text-sm text-slate-500">Drag & drop a Seller Confirmation PDF here</p>
                            <div className="my-2 text-xs text-slate-400">OR</div>
                            <button type="button" className="text-sm font-bold text-orange-600">Browse File</button>
                            <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg" onChange={handleFileChange} className="hidden" />
                        </div>
                    </div>
                )}

                {isProcessing && (
                    <div className="flex justify-center p-4">
                        <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
                            <Loader2 className="animate-spin" size={16} /> {statusMessage || 'Analyzing...'}
                        </div>
                    </div>
                )}

                {/* Display attached documents list if any */}
                {(editingOrder?.originalDocumentUrl || editingOrder?.blDocumentUrl || editingOrder?.plDocumentUrl) && !isProcessing && (
                    <div className="flex gap-2 flex-wrap">
                        {editingOrder?.originalDocumentUrl && (
                            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2 text-xs min-w-[200px]">
                                <span className="flex items-center gap-2 font-medium text-slate-700"><Receipt size={14} className="text-blue-500" /> Invoice/Order</span>
                                <div className="flex gap-1">
                                    <button onClick={(e) => handleViewDocument(editingOrder.originalDocumentUrl!, e)} className="text-blue-600 hover:underline">View</button>
                                    <button onClick={() => setEditingOrder({ ...editingOrder, originalDocumentUrl: '' })} className="text-red-500 hover:text-red-700"><Trash2 size={12} /></button>
                                </div>
                            </div>
                        )}
                        {editingOrder?.blDocumentUrl && (
                            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2 text-xs min-w-[200px]">
                                <span className="flex items-center gap-2 font-medium text-slate-700"><FileText size={14} className="text-indigo-500" /> Bill of Lading</span>
                                <div className="flex gap-1">
                                    <button onClick={(e) => handleViewDocument(editingOrder.blDocumentUrl!, e)} className="text-blue-600 hover:underline">View</button>
                                    <button onClick={() => setEditingOrder({ ...editingOrder, blDocumentUrl: '' })} className="text-red-500 hover:text-red-700"><Trash2 size={12} /></button>
                                </div>
                            </div>
                        )}
                        {editingOrder?.plDocumentUrl && (
                            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2 text-xs min-w-[200px]">
                                <span className="flex items-center gap-2 font-medium text-slate-700"><ClipboardList size={14} className="text-teal-500" /> Packing List</span>
                                <div className="flex gap-1">
                                    <button onClick={(e) => handleViewDocument(editingOrder.plDocumentUrl!, e)} className="text-blue-600 hover:underline">View</button>
                                    <button onClick={() => setEditingOrder({ ...editingOrder, plDocumentUrl: '' })} className="text-red-500 hover:text-red-700"><Trash2 size={12} /></button>
                                </div>
                            </div>
                        )}
                    </div>
                )}


                {/* Task 1: Order/Invoice Details */}
                <div className="p-4 border border-slate-200 rounded-lg">
                    <h3 className="font-bold text-slate-700 mb-4">{isInvoiceMode ? '1. Invoice Details' : '1. Order Details'}</h3>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{isInvoiceMode ? 'Invoice #' : 'Order #'}</label>
                            <input className="border border-slate-300 p-2 rounded w-full" value={editingOrder?.orderNumber || ''} onChange={e => setEditingOrder({ ...editingOrder, orderNumber: e.target.value })} />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Seller Name</label>
                            <select
                                className="border border-slate-300 p-2 rounded w-full bg-white"
                                value={editingOrder?.sellerName || ''}
                                onChange={e => setEditingOrder({ ...editingOrder, sellerName: e.target.value })}
                            >
                                <option value="">Select Seller...</option>
                                {editingOrder?.sellerName && !suppliers.find(s => s.name === editingOrder.sellerName) && (
                                    <option value={editingOrder.sellerName}>📄 {editingOrder.sellerName} (OCR)</option>
                                )}
                                {suppliers.map(s => (
                                    <option key={s.id} value={s.name}>{s.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="col-span-2">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Customer Name</label>
                            <select
                                className="border border-slate-300 p-2 rounded w-full bg-white"
                                value={editingOrder?.customerName || ''}
                                onChange={e => setEditingOrder({ ...editingOrder, customerName: e.target.value })}
                            >
                                <option value="">Select Customer...</option>
                                {editingOrder?.customerName && !customers.find(c => c.name === editingOrder.customerName) && (
                                    <option value={editingOrder.customerName}>📄 {editingOrder.customerName} (OCR)</option>
                                )}
                                {customers.map(c => (
                                    <option key={c.id} value={c.name}>{c.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Incoterm</label>
                            <select
                                className="border border-slate-300 p-2 rounded w-full bg-white"
                                value={editingOrder?.incoterm || ''}
                                onChange={e => setEditingOrder({ ...editingOrder, incoterm: e.target.value })}
                            >
                                <option value="">Select Incoterm...</option>
                                {editingOrder?.incoterm && !['FOB', 'CIF', 'CFR', 'EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'].includes(editingOrder.incoterm) && (
                                    <option value={editingOrder.incoterm}>📄 {editingOrder.incoterm} (OCR)</option>
                                )}
                                <option value="FOB">FOB - Free On Board</option>
                                <option value="CIF">CIF - Cost + Insurance + Freight</option>
                                <option value="CFR">CFR - Cost & Freight</option>
                                <option value="EXW">EXW - Ex Works</option>
                                <option value="FCA">FCA - Free Carrier</option>
                                <option value="CPT">CPT - Carriage Paid To</option>
                                <option value="CIP">CIP - Carriage & Insurance Paid</option>
                                <option value="DAP">DAP - Delivered At Place</option>
                                <option value="DPU">DPU - Delivered At Place Unloaded</option>
                                <option value="DDP">DDP - Delivered Duty Paid</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Payment Terms</label>
                            <select
                                className="border border-slate-300 p-2 rounded w-full bg-white"
                                value={editingOrder?.paymentTerms || ''}
                                onChange={e => setEditingOrder({ ...editingOrder, paymentTerms: e.target.value })}
                            >
                                <option value="">Select Payment Terms...</option>
                                {editingOrder?.paymentTerms && !['NET 30', 'NET 60', 'NET 90', 'CAD', 'CIA', 'COD', 'LC', 'TT'].includes(editingOrder.paymentTerms.toUpperCase()) && (
                                    <option value={editingOrder.paymentTerms}>📄 {editingOrder.paymentTerms} (OCR)</option>
                                )}
                                <option value="NET 30">NET 30</option>
                                <option value="NET 60">NET 60</option>
                                <option value="NET 90">NET 90</option>
                                <option value="CAD">CAD - Cash Against Documents</option>
                                <option value="CIA">CIA - Cash In Advance</option>
                                <option value="COD">COD - Cash On Delivery</option>
                                <option value="LC">LC - Letter of Credit</option>
                                <option value="TT">TT - Telegraphic Transfer</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Port of Destination (POD)</label>
                            <select
                                className="border border-slate-300 p-2 rounded w-full bg-white"
                                value={editingOrder?.pod || ''}
                                onChange={e => setEditingOrder({ ...editingOrder, pod: e.target.value })}
                            >
                                <option value="">Select Port...</option>
                                {editingOrder?.pod && !ports.find(p => p.portCode === editingOrder.pod || p.name === editingOrder.pod) && (
                                    <option value={editingOrder.pod}>📄 {editingOrder.pod} (OCR)</option>
                                )}
                                {ports.map(p => (
                                    <option key={p.id} value={p.portCode}>{p.portCode} - {p.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Delivery Date</label>
                            <input type="text" className="border border-slate-300 p-2 rounded w-full" placeholder="mm/dd/yyyy" value={editingOrder?.deliveryDate || ''} onChange={e => setEditingOrder({ ...editingOrder, deliveryDate: e.target.value })} />
                        </div>
                    </div>

                    {/* Shipping / Bill of Lading Details */}
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                        <h3 className="text-sm font-bold text-blue-800 mb-3 flex items-center gap-2">
                            <Ship size={16} /> Shipping / Bill of Lading Details
                        </h3>
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">BL / Booking #</label>
                                <input
                                    type="text"
                                    className="border border-slate-300 p-2 rounded w-full"
                                    placeholder="BL Number"
                                    value={(editingOrder as any)?.blNumber || ''}
                                    onChange={e => setEditingOrder({ ...editingOrder, blNumber: e.target.value } as any)}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">ETD (Departure)</label>
                                <input
                                    type="text"
                                    className="border border-slate-300 p-2 rounded w-full"
                                    placeholder="YYYY-MM-DD"
                                    value={(editingOrder as any)?.etd || ''}
                                    onChange={e => setEditingOrder({ ...editingOrder, etd: e.target.value } as any)}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">ETA (Arrival)</label>
                                <input
                                    type="text"
                                    className="border border-slate-300 p-2 rounded w-full"
                                    placeholder="YYYY-MM-DD"
                                    value={(editingOrder as any)?.eta || ''}
                                    onChange={e => setEditingOrder({ ...editingOrder, eta: e.target.value } as any)}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Vessel / Voyage</label>
                                <input
                                    type="text"
                                    className="border border-slate-300 p-2 rounded w-full"
                                    placeholder="Vessel Name"
                                    value={(editingOrder as any)?.vesselVoyage || ''}
                                    onChange={e => setEditingOrder({ ...editingOrder, vesselVoyage: e.target.value } as any)}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Port of Loading (POL)</label>
                                <select
                                    className="border border-slate-300 p-2 rounded w-full bg-white"
                                    value={(editingOrder as any)?.pol || ''}
                                    onChange={e => setEditingOrder({ ...editingOrder, pol: e.target.value } as any)}
                                >
                                    <option value="">Select Port...</option>
                                    {(editingOrder as any)?.pol && !ports.find(p => p.portCode === (editingOrder as any).pol || p.name === (editingOrder as any).pol) && (
                                        <option value={(editingOrder as any).pol}>📄 {(editingOrder as any).pol} (OCR)</option>
                                    )}
                                    {ports.map(p => (
                                        <option key={p.id} value={p.portCode}>{p.portCode} - {p.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Container Numbers</label>
                                <input
                                    type="text"
                                    className="border border-slate-300 p-2 rounded w-full"
                                    placeholder="MSKU1234567, TCLU7654321"
                                    value={(editingOrder as any)?.containerNumbers || ''}
                                    onChange={e => setEditingOrder({ ...editingOrder, containerNumbers: e.target.value } as any)}
                                />
                            </div>
                        </div>
                    </div>
                    <div className="space-y-2 mb-4">
                        {editingOrder?.items?.map(item => (
                            <div key={item.id} className="grid grid-cols-12 gap-x-2 gap-y-1 items-end p-2 border border-slate-100 rounded-lg bg-slate-50/50">
                                <div className="col-span-4">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase">Product</label>
                                    <input className="w-full border border-slate-300 p-1 text-xs rounded" value={item.productName} onChange={e => updateItem(item.id, 'productName', e.target.value)} />
                                </div>
                                <div className="col-span-2">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase">Quantity</label>
                                    <FormattedInput
                                        className="w-full border border-slate-300 p-1 text-xs rounded text-right"
                                        value={item.quantity ?? 0}
                                        onChange={val => updateItem(item.id, 'quantity', val)}
                                        decimals={2}
                                    />
                                </div>
                                <div className="col-span-1">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase">Unit</label>
                                    <select className="w-full border border-slate-300 p-1 text-xs rounded bg-white" value={item.unit} onChange={e => updateItem(item.id, 'unit', e.target.value)}>
                                        <option value="LBS">LBS</option>
                                        <option value="KGS">KGS</option>
                                    </select>
                                </div>
                                <div className="col-span-2">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase">Price/Unit</label>
                                    <FormattedInput
                                        className="w-full border border-slate-300 p-1 text-xs rounded text-right"
                                        value={item.pricePerUnit ?? 0}
                                        onChange={val => updateItem(item.id, 'pricePerUnit', val)}
                                        decimals={4}
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase">Total</label>
                                    <div className="flex items-center justify-end h-full">
                                        <span className="text-sm font-mono font-bold text-emerald-600 px-2">
                                            ${(item.total ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                </div>
                                <div className="col-span-1 flex items-center justify-end h-full">
                                    <button onClick={() => removeItem(item.id)} className="text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
                                </div>
                            </div>
                        ))}
                        <button onClick={addItem} className="text-xs text-blue-600 font-bold mt-2">+ Add Item</button>
                    </div>

                    <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-slate-500">Total QTY (LBS):</span>
                            <input
                                type="number"
                                value={editingOrder?.totalQuantity || ''}
                                onChange={(e) => setEditingOrder(prev => ({ ...prev, totalQuantity: parseFloat(e.target.value) || 0 }))}
                                placeholder="0"
                                className="w-32 px-2 py-1 border border-slate-300 rounded text-right font-mono text-sm"
                            />
                        </div>
                        <div className="flex items-center gap-4 font-bold">
                            <span className="text-sm text-slate-500">Grand Total:</span>
                            <span className="text-xl text-slate-800">
                                ${(editingOrder?.orderTotal || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Task 2: Commission */}
                <div className="p-4 border border-slate-200 rounded-lg">
                    <h3 className="font-bold text-slate-700 mb-2">2. Commission</h3>
                    <div>
                        <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-4">
                            <div>
                                <p className="text-sm font-medium text-slate-700 mb-2">1. Select Commission Type</p>
                                <div className="grid grid-cols-3 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setEditingOrder(prev => ({ ...prev, commissionType: 'PERCENT' }))}
                                        className={`py-3 text-xs font-bold rounded-lg transition-all border ${editingOrder?.commissionType === 'PERCENT'
                                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                            : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                                            }`}
                                    >
                                        Percentage (%)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setEditingOrder(prev => ({ ...prev, commissionType: 'PER_LBS' }))}
                                        className={`py-3 text-xs font-bold rounded-lg transition-all border ${editingOrder?.commissionType === 'PER_LBS'
                                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                            : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                                            }`}
                                    >
                                        Rate per LBS ($/Lbs)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setEditingOrder(prev => ({ ...prev, commissionType: 'PER_KGS' }))}
                                        className={`py-3 text-xs font-bold rounded-lg transition-all border ${editingOrder?.commissionType === 'PER_KGS'
                                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                            : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                                            }`}
                                    >
                                        Rate per KGS ($/Kgs)
                                    </button>
                                </div>
                            </div>

                            {editingOrder?.commissionType && (
                                <div className="animate-in fade-in">
                                    <label className="block text-sm font-medium text-slate-700 mb-2">
                                        2. Enter Rate
                                    </label>
                                    <div className="relative">
                                        <FormattedInput
                                            value={editingOrder.commissionRate || 0}
                                            onChange={val => setEditingOrder(prev => ({ ...prev, commissionRate: val }))}
                                            decimals={4}
                                            className="w-full border border-slate-300 rounded-lg p-3 text-lg font-bold focus:ring-2 focus:ring-blue-500 outline-none"
                                        />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-medium">
                                            {editingOrder.commissionType === 'PERCENT' ? '%' : editingOrder.commissionType === 'PER_LBS' ? 'per LBS' : 'per KGS'}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="text-right mt-4">
                        <span className="text-xs text-slate-500">Calculated Commission</span>
                        <p className="font-bold text-xl text-emerald-600">${(editingOrder?.commissionAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                    </div>
                </div>

                {/* Task 3 & 4: Conditional Status Blocks */}
                {isInvoiceMode ? (
                    <>
                        <div className="p-4 border border-slate-200 rounded-lg">
                            <h3 className="font-bold text-slate-700 mb-2">3. Invoice Status</h3>
                            <div className="flex items-center gap-4">
                                <div className={`text-lg font-bold ${editingOrder?.invoiceStatus === 'PAID' ? 'text-emerald-600' : 'text-amber-600'}`}>
                                    {editingOrder?.invoiceStatus || 'UNPAID'}
                                </div>
                                <div className="flex gap-2 ml-auto">
                                    <button type="button" onClick={() => setEditingOrder({ ...editingOrder, invoiceStatus: 'PAID' })} className="text-sm bg-emerald-50 text-emerald-600 px-3 py-1 rounded">Set to PAID</button>
                                    <button type="button" onClick={() => setEditingOrder({ ...editingOrder, invoiceStatus: 'UNPAID' })} className="text-sm bg-amber-50 text-amber-600 px-3 py-1 rounded">Set to UNPAID</button>
                                </div>
                            </div>
                        </div>
                        <div className="p-4 border border-slate-200 rounded-lg">
                            <h3 className="font-bold text-slate-700 mb-2">4. Commission Status</h3>
                            <div className="flex items-center gap-4">
                                <div className={`text-lg font-bold ${editingOrder?.commissionPaymentStatus === 'PAID' ? 'text-emerald-600' : 'text-amber-600'}`}>
                                    {editingOrder?.commissionPaymentStatus || 'UNPAID'}
                                </div>
                                <div className="flex gap-2 ml-auto">
                                    <button type="button" onClick={() => setEditingOrder({ ...editingOrder, commissionPaymentStatus: 'PAID' })} className="text-sm bg-emerald-50 text-emerald-600 px-3 py-1 rounded">Set to PAID</button>
                                    <button type="button" onClick={() => setEditingOrder({ ...editingOrder, commissionPaymentStatus: 'UNPAID' })} className="text-sm bg-amber-50 text-amber-600 px-3 py-1 rounded">Set to UNPAID</button>
                                </div>
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="p-4 border border-slate-200 rounded-lg">
                            <h3 className="font-bold text-slate-700 mb-2">3. Approval</h3>
                            <div className="flex gap-2">
                                <button
                                    disabled={!canApprove || editingOrder?.status !== 'PENDING_APPROVAL'}
                                    onClick={() => setEditingOrder({ ...editingOrder, status: 'APPROVED' })}
                                    className="text-sm bg-emerald-50 text-emerald-600 px-3 py-1 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={!canApprove ? "Only CEO or Manager can approve" : ""}
                                >
                                    Approve
                                </button>
                                <button
                                    disabled={!canApprove || editingOrder?.status !== 'PENDING_APPROVAL'}
                                    onClick={() => setEditingOrder({ ...editingOrder, status: 'REJECTED' })}
                                    className="text-sm bg-red-50 text-red-600 px-3 py-1 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={!canApprove ? "Only CEO or Manager can approve" : ""}
                                >
                                    Reject
                                </button>
                                <button disabled={editingOrder?.status !== 'DRAFT'} onClick={() => setEditingOrder({ ...editingOrder, status: 'PENDING_APPROVAL' })} className="text-sm bg-blue-50 text-blue-600 px-3 py-1 rounded ml-auto disabled:opacity-50">Request Approval</button>
                            </div>
                        </div>
                        <div className="p-4 border border-slate-200 rounded-lg">
                            <h3 className="font-bold text-slate-700 mb-2">4. Customer Acceptance</h3>
                            <div>
                                <label className="text-xs font-bold text-slate-500">Signed Order Document</label>
                                <input type="file" onChange={e => handleDocUpload(e, 'signedDocumentUrl')} className="text-xs mt-1" />
                                {editingOrder?.signedDocumentUrl && (
                                    <div className="mt-2 flex items-center gap-2">
                                        <a href={editingOrder.signedDocumentUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 text-xs font-bold hover:underline">View Current Document</a>
                                        <button
                                            type="button"
                                            onClick={() => setEditingOrder({ ...editingOrder, signedDocumentUrl: '' })}
                                            className="text-red-500 hover:text-red-700 text-xs" title="Remove Document"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default Commissions;
