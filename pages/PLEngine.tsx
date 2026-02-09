
import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, Loader2, Plus, Trash2, FileText, Download, Printer, RefreshCw, AlertCircle, Save, X, List, Package, FileSpreadsheet, CheckCircle2, Clock, Play, FileCheck, ArrowRight, Building2, ClipboardList, Pencil, Archive, FileBarChart, Eye, ScanEye } from 'lucide-react';
import { analyzeDocument } from '../services/geminiService';
import { getSupabaseClient } from '../services/supabase';
import { Customer, PackingList, Invoice, SalesOrder, SalesOrderItem, Booking, Supplier, Company, Product } from '../types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import QuickAddModal from '../components/QuickAddModal';
import { FormattedInput } from '../components/UnitInputs';

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

interface FileQueueItem {
    id: string;
    file: File;
    status: 'idle' | 'processing' | 'completed' | 'error';
    base64?: string; // Store base64 for saving
}

interface PLEngineProps {
    onMakeInvoice?: (pl: PackingList) => void;
}

const PLEngine: React.FC<PLEngineProps> = ({ onMakeInvoice }) => {
    const [activeView, setActiveView] = useState<'PROCESSOR' | 'RESUMES' | 'PL_VIEW'>('PROCESSOR');
    const [plNumber, setPlNumber] = useState('');
    const [isNewPL, setIsNewPL] = useState(true);
    const [bookingNumber, setBookingNumber] = useState('');
    const [soNumber, setSoNumber] = useState('');
    const [shipper, setShipper] = useState('');
    const [consignee, setConsignee] = useState('');
    const [supplier, setSupplier] = useState('');
    const [items, setItems] = useState<PLItem[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');

    // Upload Queue State
    const [pendingFiles, setPendingFiles] = useState<FileQueueItem[]>([]);
    const [isDragging, setIsDragging] = useState(false);

    // Database / Save State
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [companies, setCompanies] = useState<Company[]>([]);
    const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [showInvoiceModal, setShowInvoiceModal] = useState(false);
    const [selectedCustomerId, setSelectedCustomerId] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [sourceSupplierPLId, setSourceSupplierPLId] = useState<string | null>(null);

    // Saved PLs State
    const [savedPLs, setSavedPLs] = useState<PackingList[]>([]);

    // Supplier PLs State (Raw Uploads)
    const [supplierPLs, setSupplierPLs] = useState<any[]>([]);

    // Document Viewer State
    const [viewingDoc, setViewingDoc] = useState<{ url: string; title: string; isBlob: boolean } | null>(null);

    // Quick Add Modal State
    const [quickAddType, setQuickAddType] = useState<'supplier' | 'shipper' | 'consignee' | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleQuickSave = async (data: any) => {
        const client = getSupabaseClient();
        if (!client) return;

        try {
            if (quickAddType === 'supplier') {
                const newRecord: Supplier = {
                    id: `sup_${Date.now()}`,
                    companyId: 'ALL',
                    name: data.name,
                    contactPerson: data.contactPerson || '-',
                    email: data.email || '-',
                    phone: data.phone || '-',
                    country: 'USA',
                    categories: [],
                    rating: 5,
                    paymentTerms: 'Net 30',
                    ...data
                };
                const { error } = await client.from('suppliers').insert(newRecord);
                if (error) throw error;
                setSuppliers(prev => [newRecord, ...prev]);
                setSupplier(newRecord.name); // Auto select
            } else if (quickAddType === 'shipper') {
                const newRecord: Company = {
                    id: `comp_${Date.now()}`,
                    name: data.name,
                    address: data.address || '',
                    city: data.city || '',
                    country: data.country || 'USA',
                    ...data
                };
                const { error } = await client.from('companies').insert(newRecord);
                if (error) throw error;
                setCompanies(prev => [newRecord, ...prev]);
                setShipper(newRecord.name); // Auto select
            } else if (quickAddType === 'consignee') {
                const newRecord: Customer = {
                    id: `cust_${Date.now()}`,
                    companyId: 'ALL',
                    name: data.name,
                    contactPerson: data.contactPerson || '-',
                    email: data.email || '-',
                    status: 'Active',
                    paymentTerms: 'Net 30',
                    creditLimit: 0,
                    totalVolumeLBS: 0,
                    lastOrderDate: new Date().toISOString(),
                    ...data
                };
                const { error } = await client.from('customers').insert(newRecord);
                if (error) throw error;
                setCustomers(prev => [newRecord, ...prev]);
                setConsignee(newRecord.name); // Auto select
            }
            setQuickAddType(null);
        } catch (err: any) {
            console.error("Quick Save Error:", err);
            alert(`Failed to save: ${err.message}`);
        }
    };

    // Fetch Reference Data & Clear Data on Mount
    useEffect(() => {
        const fetchData = async () => {
            const client = getSupabaseClient();
            if (client) {
                try {
                    const { data: custData, error: custError } = await client.from('customers').select('*');
                    if (custError) throw custError;
                    if (custData) setCustomers(custData);

                    const { data: supData, error: supError } = await client.from('suppliers').select('*');
                    if (supError) throw supError;
                    if (supData) setSuppliers(supData);

                    const { data: compData, error: compError } = await client.from('companies').select('*');
                    if (compError) throw compError;
                    if (compData) setCompanies(compData);

                    const { data: soData, error: soError } = await client.from('sales_orders').select('id, orderNumber, customerName, companyId, customerId, status');
                    if (soError) throw soError;
                    if (soData) setSalesOrders(soData);

                    const { data: bkData, error: bkError } = await client.from('bookings').select('id, bookingNumber, salesOrderId, customer, status');
                    if (bkError) throw bkError;
                    if (bkData) setBookings(bkData);

                    const { data: prodData, error: prodError } = await client.from('products').select('id, name, category, grade');
                    if (prodError) throw prodError;
                    if (prodData) setProducts(prodData);
                } catch (err: any) {
                    console.error("Fetch Error:", err);
                    alert(`Data Fetch Error: ${err.message || JSON.stringify(err)}`);
                }
            }
        };
        fetchData();

        // Always clear data on start/mount
        // Initialize New PL with Sequence Check
        const initNewPL = async () => {
            const pls = await fetchSavedPLs();
            setItems([]);
            // Pass 'undefined' for bookingNum to trigger date-based logic, and 'pls' for existing data
            const nextPL = generatePLNumber(undefined, pls);
            setPlNumber(nextPL);
            setIsNewPL(true);
            setBookingNumber('');
        };
        initNewPL();
        setSoNumber('');
        setPendingFiles([]);
        setEditingId(null);
        setShipper('');
        setConsignee('');
        setSupplier('');
    }, []);

    // Fetch Saved PLs when view changes
    useEffect(() => {
        if (activeView === 'RESUMES') {
            fetchSavedPLs();
        } else if (activeView === 'PL_VIEW') {
            fetchSupplierPLs();
        }
    }, [activeView]);

    const fetchSavedPLs = async () => {
        const client = getSupabaseClient();
        if (!client) return [];
        if (!client) return [];
        // Optimize: Exclude originalDocument to reduce payload size
        const { data, error } = await client.from('packing_lists')
            .select('id, companyId, createdAt, plNumber, blNumber, shipper, supplier, consignee, shippingPoint, destination, date, carrier, containerNumber, sealNumber, unitCount, grossWeight, netWeight, freightTerms, poNumber, notes, scheduledShipDate, items, soNumber')
            .order('createdAt', { ascending: false });
        if (data) {
            setSavedPLs(data);
            return data;
        }
        return [];
    };

    const fetchSupplierPLs = async () => {
        const client = getSupabaseClient();
        if (!client) return;
        const { data } = await client.from('packing_lists_suppliers').select('*').order('createdAt', { ascending: false });
        if (data) setSupplierPLs(data);
    };

    // Totals
    const totals = items.reduce((acc, item) => ({
        grossLbs: acc.grossLbs + (item.grossLbs || 0),
        netLbs: acc.netLbs + (item.netLbs || 0),
        grossKg: acc.grossKg + (item.grossKg || 0),
        netKg: acc.netKg + (item.netKg || 0),
        volumes: acc.volumes + (item.volumes || 0),
    }), { grossLbs: 0, netLbs: 0, grossKg: 0, netKg: 0, volumes: 0 });

    // Container Summary Aggregation
    const containerSummary = Object.values(items.reduce((acc, item) => {
        const key = item.containerNo || 'Unknown';
        if (!acc[key]) {
            acc[key] = {
                containerNo: key,
                sealNo: item.sealNo,
                grossLbs: 0,
                netLbs: 0,
                grossKg: 0,
                netKg: 0,
                volumes: 0
            };
        }
        acc[key].grossLbs += item.grossLbs || 0;
        acc[key].netLbs += item.netLbs || 0;
        acc[key].grossKg += item.grossKg || 0;
        acc[key].netKg += item.netKg || 0;
        acc[key].volumes += item.volumes || 0;

        if (!acc[key].sealNo && item.sealNo) acc[key].sealNo = item.sealNo;
        return acc;
    }, {} as Record<string, ContainerSummary>)) as ContainerSummary[];

    const formatContainerNumber = (val: string) => {
        if (!val) return '';
        return val.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const newFiles = Array.from(e.target.files).map(file => ({
                id: Math.random().toString(36).substr(2, 9),
                file,
                status: 'idle' as const
            }));
            setPendingFiles(prev => [...prev, ...newFiles]);
            e.target.value = '';
        }
    };

    const handleRemoveFile = (id: string) => {
        setPendingFiles(prev => prev.filter(item => item.id !== id));
    };

    const onDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const onDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragging(false);
        }
    };

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const newFiles = Array.from(e.dataTransfer.files).map(file => ({
                id: Math.random().toString(36).substr(2, 9),
                file,
                status: 'idle' as const
            }));
            setPendingFiles(prev => [...prev, ...newFiles]);
        }
    };

    const processQueue = async () => {
        const filesToProcess = pendingFiles.filter(f => f.status === 'idle' || f.status === 'error');
        if (filesToProcess.length === 0) return;

        setIsProcessing(true);

        for (let i = 0; i < filesToProcess.length; i++) {
            const item = filesToProcess[i];

            setPendingFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'processing' } : f));
            setStatusMessage(`Processing ${i + 1}/${filesToProcess.length}: ${item.file.name}...`);

            try {
                const base64Data = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (event) => resolve((event.target?.result as string));
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
    };

    const generatePLNumber = (bookingNum?: string, existingPLs?: any[]) => {
        if (bookingNum) {
            // Case 1: Booking Number Logic
            // PL-(numeric part of OCR booking number)
            const numericPart = bookingNum.replace(/\D/g, '');
            if (numericPart) return `PL-${numericPart}`;
        }

        // Case 2: Date + Sequential Letter Logic
        // PL-(MMDDYY)(Sequential Letter)
        const date = new Date();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const yy = String(date.getFullYear()).slice(-2);
        const datePrefix = `PL-${mm}${dd}${yy}`;

        // Find existing PLs with this prefix
        const sourcePLs = existingPLs || savedPLs;
        const existingShort = sourcePLs
            .map(pl => pl.plNumber)
            .filter(num => num && num.startsWith(datePrefix));

        if (existingShort.length === 0) return `${datePrefix}A`;

        // Find next letter
        const usedLetters = existingShort
            .map(num => num.replace(datePrefix, ''))
            .filter(suffix => /^[A-Z]$/.test(suffix))
            .sort();

        if (usedLetters.length === 0) return `${datePrefix}A`;

        const lastLetter = usedLetters[usedLetters.length - 1];
        const nextCharCode = lastLetter.charCodeAt(0) + 1;
        // Check if Z, technically should handle, but A-Z is plenty for one day usually
        return `${datePrefix}${String.fromCharCode(nextCharCode)}`;
    };

    const generateSONumber = (existingPLs: PackingList[]) => {
        // Format: SOA-MMDDYY-X
        const date = new Date();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const yy = String(date.getFullYear()).slice(-2);
        const prefix = `SOA-${mm}${dd}${yy}-`;

        // Find existing SOs with this prefix in saved PLs
        // Note: This relies on PLs holding the generated SO number
        const usedLetters = existingPLs
            .map(pl => pl.soNumber)
            .filter(so => so && so.startsWith(prefix))
            .map(so => so.replace(prefix, ''))
            .filter(suffix => /^[A-Z]$/.test(suffix))
            .sort();

        if (usedLetters.length === 0) return `${prefix}A`;

        const lastLetter = usedLetters[usedLetters.length - 1];
        const nextCharCode = lastLetter.charCodeAt(0) + 1;
        return `${prefix}${String.fromCharCode(nextCharCode)}`;
    };

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
            console.log("Raw Gemini Response:", result); // Debug logging

            const cleanJson = result.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsedData = JSON.parse(cleanJson);

            // Generate PL Number based on OCR Booking or Date
            const newPlNumber = generatePLNumber(parsedData.bookingNumber);
            setPlNumber(newPlNumber);

            setBookingNumber(parsedData.bookingNumber || '');
            setSoNumber(parsedData.soNumber || '');

            // Auto-populate Shipper/Consignee if SO matches
            if (parsedData.soNumber) {
                const matchedSO = salesOrders.find(so => so.orderNumber === parsedData.soNumber);
                if (matchedSO) {
                    const linkedCompany = companies.find(c => c.id === matchedSO.companyId);
                    if (linkedCompany) setShipper(linkedCompany.name);
                    if (matchedSO.customerName) setConsignee(matchedSO.customerName);
                }
            }

            // Default Supplier from first item if exists
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
                originalDoc: undefined // Could store URL if uploaded to storage
            }));

            // Merge with existing items if any
            setItems(prev => [...prev, ...newItems]);

        } catch (error) {
            console.error('Error processing document:', error);
            setStatusMessage('Error analyzing document. Please try again.');
        }
    };








    const openDocument = (docUrl?: string, title: string = 'Document') => {
        if (!docUrl) {
            alert("No document available.");
            return;
        }
        try {
            if (docUrl.startsWith('data:')) {
                const arr = docUrl.split(',');
                const mime = arr[0].match(/:(.*?);/)?.[1] || 'application/pdf';
                const bstr = atob(arr[1]);
                let n = bstr.length;
                const u8arr = new Uint8Array(n);
                while (n--) {
                    u8arr[n] = bstr.charCodeAt(n);
                }
                const blob = new Blob([u8arr], { type: mime });
                const blobUrl = URL.createObjectURL(blob);
                setViewingDoc({ url: blobUrl, title, isBlob: true });
            } else {
                setViewingDoc({ url: docUrl, title, isBlob: false });
            }
        } catch (e) {
            console.error("Error opening document", e);
            alert("Could not load document.");
        }
    };

    const closeDocument = () => {
        if (viewingDoc && viewingDoc.isBlob) {
            URL.revokeObjectURL(viewingDoc.url);
        }
        setViewingDoc(null);
    };

    const handleDownloadDoc = () => {
        if (!viewingDoc) return;

        // Re-generate the PDF and save it directly using doc.save()
        // This avoids issues with blob URLs and browser behavior.
        if (viewingDoc.title.includes('Product')) {
            const doc = new jsPDF('l', 'mm', 'a4');
            doc.setFontSize(14);
            doc.text(`Resume per Product - Booking: ${bookingNumber}`, 14, 15);
            if (soNumber) {
                doc.setFontSize(10);
                doc.text(`SO #: ${soNumber}`, 14, 20);
            }

            const tableBody = items.map(item => [
                item.description, item.containerNo, item.sealNo,
                item.grossLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                item.netLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                item.grossKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                item.netKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                item.volumes, item.supplier, item.blNumber
            ]);
            tableBody.push([
                'TOTALS', '', '',
                totals.grossLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                totals.netLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                totals.grossKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                totals.netKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                totals.volumes.toLocaleString(), '', ''
            ]);
            autoTable(doc, {
                head: [['Product Desc', 'Container No.', 'Seal No.', 'Gross Wt (lbs)', 'Net Wt (lbs)', 'Gross Wt (kg)', 'Net Wt (kg)', 'Volumes', 'Supplier', 'BL Number']],
                body: tableBody,
                startY: 25, theme: 'grid',
                headStyles: { fillColor: [41, 128, 185], fontSize: 8 }, bodyStyles: { fontSize: 8 },
                footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' }
            });
            doc.save(viewingDoc.title);

        } else if (viewingDoc.title.includes('Container')) {
            const doc = new jsPDF('l', 'mm', 'a4');
            doc.setFontSize(14);
            doc.text(`Resume per Container - Booking: ${bookingNumber}`, 14, 15);
            if (soNumber) {
                doc.setFontSize(10);
                doc.text(`SO #: ${soNumber}`, 14, 20);
            }
            const containerBody = containerSummary.map(c => [
                c.containerNo, c.sealNo,
                c.grossLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                c.netLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                c.grossKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                c.netKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                c.volumes
            ]);
            containerBody.push([
                'TOTALS', '',
                totals.grossLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                totals.netLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                totals.grossKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                totals.netKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                totals.volumes.toLocaleString()
            ]);
            autoTable(doc, {
                head: [['Container No.', 'Seal No.', 'Gross Wt (lbs)', 'Net Wt (lbs)', 'Gross Wt (kg)', 'Net Wt (kg)', 'Volumes']],
                body: containerBody,
                startY: 25, theme: 'grid',
                headStyles: { fillColor: [46, 204, 113], fontSize: 8 }, bodyStyles: { fontSize: 8 },
                footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' }
            });
            doc.save(viewingDoc.title);
        }
    };

    const handleBookingChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value;
        setBookingNumber(val);
        // Link to SO if booking has one
        const bk = bookings.find(b => b.bookingNumber === val);
        if (bk && bk.salesOrderId) {
            const linked = salesOrders.find(so => so.id === bk.salesOrderId);
            if (linked) {
                setSoNumber(linked.orderNumber);
                // Auto-populate Shipper/Consignee from linked SO
                const linkedCompany = companies.find(c => c.id === linked.companyId);
                if (linkedCompany) setShipper(linkedCompany.name);
                if (linked.customerName) setConsignee(linked.customerName);
            }
        }
    };

    const handleSoChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value;
        if (val === '__NEW__') {
            const newSO = generateSONumber(savedPLs);
            setSoNumber(newSO);

            // Save the auto-generated Sales Order to database
            const matchedCustomer = customers.find(c =>
                consignee && c.name.toLowerCase().includes(consignee.toLowerCase())
            );
            const companyId = matchedCustomer ? matchedCustomer.companyId : 'ALL';
            await createAutoGeneratedSalesOrder(
                newSO,
                consignee,
                items,
                companyId
            );

            // Refresh sales orders list to include the new SO
            const client = getSupabaseClient();
            if (client) {
                const { data: soData } = await client.from('sales_orders').select('id, orderNumber, customerName, companyId, customerId, status');
                if (soData) setSalesOrders(soData);
            }
            return;
        }

        setSoNumber(val);

        if (!val) return;

        const selectedSO = salesOrders.find(so => so.orderNumber === val);
        if (selectedSO) {
            const linkedBooking = bookings.find(b => b.salesOrderId === selectedSO.id);
            if (linkedBooking) {
                setBookingNumber(linkedBooking.bookingNumber);
            }

            // Auto-populate Shipper (Company) and Consignee (Customer)
            const linkedCompany = companies.find(c => c.id === selectedSO.companyId);
            if (linkedCompany) {
                setShipper(linkedCompany.name);
            }
            if (selectedSO.customerName) {
                setConsignee(selectedSO.customerName);
            }
        }
    };

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
        setItems(prev => [...prev, newItem]);
    };

    const handleDeleteItem = (id: string) => {
        setItems(items.filter(i => i.id !== id));
    };

    const handleViewItemDoc = (docUrl?: string) => {
        openDocument(docUrl, 'Item Original Document');
    };

    const updateItem = (id: string, field: keyof PLItem, value: any) => {
        setItems(items.map(item => {
            if (item.id === id) {
                let finalValue = value;
                if (field === 'containerNo' && typeof value === 'string') {
                    finalValue = formatContainerNumber(value);
                }

                const updated = { ...item, [field]: finalValue };

                // Auto-calc logic if needed, e.g. lbs <-> kg
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

    // Helper function to create and save auto-generated Sales Orders
    const createAutoGeneratedSalesOrder = async (
        soNumber: string,
        consignee: string,
        items: PLItem[],
        companyIdParam: string
    ): Promise<SalesOrder | null> => {
        const client = getSupabaseClient();
        if (!client) return null;

        try {
            // Try to match customer from consignee name
            const matchedCustomer = customers.find(c =>
                consignee && c.name.toLowerCase().includes(consignee.toLowerCase())
            );

            const customerId = matchedCustomer?.id || 'UNKNOWN';
            const customerName = matchedCustomer?.name || consignee || 'TBD';

            // Create minimal SO items from PL items
            const soItems: SalesOrderItem[] = items.map(item => ({
                productId: '',
                productName: item.description || 'Product',
                customerDescription: item.description || '',
                hsCode: '',
                quantity: item.netLbs || 0,
                unitPrice: 0,
                total: 0
            }));

            const salesOrder: SalesOrder = {
                id: `SO_${Date.now()}`,
                companyId: companyIdParam,
                customerId: customerId,
                customerName: customerName,
                orderNumber: soNumber,
                orderDate: new Date().toISOString().split('T')[0],
                orderType: 'SPOT',
                status: 'APPROVED', // Auto-generated SOs are pre-approved
                items: soItems,
                totalAmount: 0,
                currency: 'USD',
                paymentTerms: matchedCustomer?.paymentTerms || 'Net 30',
                incoterm: 'FOB',
                saleType: 'EXPORT',
                createdAt: new Date().toISOString()
            };

            const { error } = await client.from('sales_orders').insert(salesOrder);
            if (error) {
                console.error('Error saving auto-generated SO:', error);
                return null;
            }

            return salesOrder;
        } catch (error) {
            console.error('Failed to create auto-generated SO:', error);
            return null;
        }
    };


    const saveToDatabase = async (customerId?: string, soNumberOverride?: string, plNumberOverride?: string): Promise<PackingList | null> => {
        const client = getSupabaseClient();
        if (!client) {
            alert("Database connection not available.");
            return null;
        }

        setIsSaving(true);
        setStatusMessage('Saving to Database...');

        try {
            const plId = editingId || `PL${Date.now()}`;
            const customer = customers.find(c => c.id === customerId);
            const companyId = customer ? customer.companyId : 'ALL';

            const primaryDoc = pendingFiles.find(f => f.status === 'completed')?.base64 || '';

            const packingList: PackingList = {
                id: plId,
                companyId: companyId,
                createdAt: new Date().toISOString(),
                plNumber: plNumberOverride || plNumber || (bookingNumber ? (bookingNumber.replace(/\D/g, '') ? `PL-${bookingNumber.replace(/\D/g, '')}` : `PL-${Date.now().toString().slice(-6)}`) : `PL-${Date.now().toString().slice(-6)}`),
                date: new Date().toISOString().split('T')[0],
                shipper: shipper || items[0]?.supplier || 'Multiple Suppliers',
                supplier: supplier || '',
                consignee: consignee || (customer ? customer.name : 'TBD'),
                containerNumber: items.map(i => i.containerNo).filter(Boolean).join(', '),
                sealNumber: items.map(i => i.sealNo).filter(Boolean).join(', '),
                grossWeight: totals.grossLbs.toString(),
                netWeight: totals.netLbs.toString(),
                unitCount: totals.volumes.toString(),

                // Strip originalDoc from items before saving to avoid duplication and massive JSON payload
                // Include productName from Products table based on productId
                items: JSON.stringify(items.map(({ originalDoc, ...rest }: any) => {
                    const product = rest.productId ? products.find(p => p.id === rest.productId) : null;
                    // Build productName with grade to match dropdown display: "NAME (Grade)"
                    const productName = product
                        ? (product.grade ? `${product.name} (${product.grade})` : product.name)
                        : '';
                    return {
                        ...rest,
                        productName,
                        productGrade: product ? product.grade : ''
                    };
                })),
                originalDocument: primaryDoc,
                blNumber: bookingNumber,
                soNumber: soNumberOverride || soNumber
            };

            if (editingId) {
                const { error: plError } = await client.from('packing_lists').update(packingList).eq('id', editingId);
                if (plError) throw plError;
            } else {
                const { error: plError } = await client.from('packing_lists').insert(packingList);
                if (plError) throw plError;
            }

            if (customerId) {
                const invId = `INV${Date.now()}`;
                const invoice: Invoice = {
                    id: invId,
                    companyId: companyId,
                    createdAt: new Date().toISOString(),
                    invoiceNumber: `INV-${Date.now().toString().slice(-6)}`,
                    invoiceDate: new Date().toISOString().split('T')[0],
                    soldTo: customer?.name || '',
                    shipperName: items[0]?.supplier || 'Various',
                    totalAmount: 0, // DRAFT, needs pricing
                    currency: 'USD',
                    items: JSON.stringify(items.map(i => {
                        // STRICT PRODUCT DESCRIPTION LOGIC
                        // Priority 1: Live Product Registry (if productId exists)
                        // Priority 2: Standardized Name in State
                        // Priority 3: Raw OCR Description (Fallback)
                        let finalDesc = i.description;

                        if (i.productId) {
                            const product = products.find(p => p.id === i.productId);
                            if (product) {
                                finalDesc = product.grade ? `${product.name} (${product.grade})` : product.name;
                            } else if (i.productName && i.productName !== '') {
                                finalDesc = i.productName;
                            }
                        } else if (i.productName && i.productName !== '') {
                            finalDesc = i.productName;
                        }

                        return {
                            description: finalDesc,
                            quantity: i.netLbs, // Defaulting to Net LBS as qty
                            unit_price: 0,
                            amount: 0
                        };
                    })),
                    grossWeight: totals.grossLbs.toString(),
                    netWeight: totals.netLbs.toString(),
                    totalQuantity: totals.volumes.toString(),
                    transportRef: bookingNumber,
                    customerPo: ''
                };

                const { error: invError } = await client.from('invoices').insert(invoice);
                if (invError) throw invError;
            }

            return packingList;

        } catch (error: any) {
            console.error("Save Error:", error);
            alert(`Failed to save: ${error.message}`);
            return null;
        } finally {
            setIsSaving(false);
            setStatusMessage('');
        }
    };

    const handleSaveAndExit = async () => {
        // Auto-Generate SO Number if missing
        let soOverride = undefined;
        if (!soNumber) {
            soOverride = generateSONumber(savedPLs);

            // Create and save the auto-generated Sales Order
            const customer = customers.find(c => c.id === consignee);
            const companyId = customer ? customer.companyId : 'ALL';
            await createAutoGeneratedSalesOrder(
                soOverride,
                consignee,
                items,
                companyId
            );
        }

        // Ensure PL Prefix
        let plOverride = undefined;
        if (plNumber && !plNumber.startsWith('PL-')) {
            plOverride = `PL-${plNumber}`;
        }

        const savedPL = await saveToDatabase(undefined, soOverride, plOverride);
        if (savedPL) {
            setItems([]);
            setBookingNumber('');
            setSoNumber('');
            setPendingFiles([]);
            setEditingId(null);
            setShipper('');
            setConsignee('');
            setSupplier('');

            // Clean up Supplier PL if one was processed
            if (sourceSupplierPLId) {
                const client = getSupabaseClient();
                if (client) {
                    await client.from('packing_lists_suppliers').delete().eq('id', sourceSupplierPLId);
                    await fetchSupplierPLs(); // Refresh inbox
                }
                setSourceSupplierPLId(null);
            }

            // Refresh Saved PLs and Generate New Number
            const pls = await fetchSavedPLs();
            const nextPL = generatePLNumber(undefined, pls);
            setPlNumber(nextPL);
            setIsNewPL(true);

            alert(editingId ? "Packing List Updated Successfully." : "Packing List Saved Successfully.");
            setActiveView('PROCESSOR');
        }
    };

    const handleMakeInvoice = async () => {
        if (items.length === 0) {
            alert("No items to create invoice from.");
            return;
        }

        // Use the existing plNumber or generate a new one if empty
        const finalPlNumber = plNumber || `PL-${Date.now().toString().slice(-6)}`;

        // Ensure PL Prefix
        const safePlNumber = finalPlNumber.startsWith('PL-') ? finalPlNumber : `PL-${finalPlNumber}`;

        // Auto-Generate SO if missing
        let finalSoNumber = soNumber;
        if (!finalSoNumber) {
            // Need existing PLs to generate unique SO, we can use the local cache 'savedPLs'
            finalSoNumber = generateSONumber(savedPLs);

            // Create and save the auto-generated Sales Order
            const matchedCustomer = customers.find(c =>
                consignee && c.name.toLowerCase().includes(consignee.toLowerCase())
            );
            const companyId = matchedCustomer ? matchedCustomer.companyId : 'ALL';
            await createAutoGeneratedSalesOrder(
                finalSoNumber,
                consignee,
                items,
                companyId
            );
        }

        // Build PackingList object from current state WITHOUT saving to DB
        const plData: PackingList = {
            id: editingId || `PL${Date.now()}`,
            companyId: 'ALL',
            createdAt: new Date().toISOString(),
            plNumber: safePlNumber,
            date: new Date().toISOString().split('T')[0],
            shipper: shipper || items[0]?.supplier || 'Multiple Suppliers',
            consignee: consignee || 'TBD', // Will be selected in Invoice Engine
            containerNumber: items.map(i => i.containerNo).filter(Boolean).join(', '),
            sealNumber: items.map(i => i.sealNo).filter(Boolean).join(', '),
            grossWeight: totals.grossLbs.toString(),
            netWeight: totals.netLbs.toString(),
            unitCount: totals.volumes.toString(),
            items: JSON.stringify(items),
            blNumber: bookingNumber,
            soNumber: finalSoNumber
        };

        // Clear form and pass data directly to Invoice Engine
        setItems([]);
        setBookingNumber('');
        setSoNumber('');
        setPendingFiles([]);
        setEditingId(null);
        setShipper('');
        setConsignee('');
        setSupplier('');

        // Prepare for next PL
        const pls = await fetchSavedPLs();
        const nextPL = generatePLNumber(undefined, pls);
        setPlNumber(nextPL);
        setIsNewPL(true);

        // Trigger callback to auto-switch to Invoice tab with PL data
        if (onMakeInvoice) {
            onMakeInvoice(plData);
        } else {
            alert("Invoice Engine not available.");
            setActiveView('PROCESSOR');
        }
    };

    const handleEditSavedPL = async (pl: PackingList) => {
        try {
            let originalDoc = pl.originalDocument;

            // Check if we need to fetch the original document (e.g. if it was excluded from list view)
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

            // Get container list from PL
            const containerNumbers = pl.containerNumber ? pl.containerNumber.split(',').map(s => s.trim()).filter(Boolean) : [];
            const sealNumbers = pl.sealNumber ? pl.sealNumber.split(',').map(s => s.trim()) : [];

            // Ensure items have containerNo assigned - distribute if missing
            if (containerNumbers.length > 0) {
                parsedItems = parsedItems.map((item: any, idx: number) => {
                    // If item doesn't have a container assigned (or is Unknown), auto-distribute from PL containers
                    let assignedContainer = (item.containerNo && item.containerNo.toLowerCase() !== 'unknown') ? item.containerNo : '';
                    let assignedSeal = item.sealNo || '';

                    if (!assignedContainer && containerNumbers.length > 0) {
                        // Distribute items evenly across containers using round-robin
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

            // Re-inject the original document into the items for the processor view
            if (originalDoc) {
                parsedItems = parsedItems.map((item: any) => ({
                    ...item,
                    originalDoc: item.originalDoc || originalDoc
                }));
            }

            // REFRESH PRODUCT DATA: Ensure items use the current standard description from DB
            // This fixes old PLs that may have saved with raw OCR descriptions
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

            setItems(parsedItems);
            setPlNumber(pl.plNumber || '');
            setIsNewPL(false); // Existing PL, not new
            setBookingNumber(pl.blNumber || '');
            setSoNumber(pl.soNumber || '');
            setEditingId(pl.id);
            setSourceSupplierPLId(null); // Ensure we don't accidentally delete a supplier PL
            setShipper(pl.shipper || '');
            setConsignee(pl.consignee || '');
            setSupplier(pl.supplier || parsedItems[0]?.supplier || '');
            setActiveView('PROCESSOR');
        } catch (e) {
            console.error("Failed to parse items", e);
            alert("Error loading saved items.");
        }
    };

    const handleDeleteSavedPL = async (id: string) => {
        if (!confirm("Are you sure you want to delete this Packing List?")) return;
        const client = getSupabaseClient();
        if (!client) return;
        await client.from('packing_lists').delete().eq('id', id);
        fetchSavedPLs();
    };

    const handleViewOriginal = async (pl: PackingList) => {
        let originalDoc = pl.originalDocument;
        if (!originalDoc) {
            const client = getSupabaseClient();
            if (client) {
                const { data } = await client.from('packing_lists').select('originalDocument').eq('id', pl.id).single();
                if (data) originalDoc = data.originalDocument;
            }
        }

        if (originalDoc) {
            openDocument(originalDoc, `Original PL: ${pl.plNumber}`);
        } else {
            alert("No original document found.");
        }
    };

    const handleViewSupplierOriginal = (record: any) => {
        openDocument(record.originalDocument, `Supplier Upload: ${record.filename}`);
    };

    const handleDeleteSupplierPL = async (id: string) => {
        if (!confirm("Are you sure you want to delete this original packing list?")) return;
        const client = getSupabaseClient();
        if (client) {
            await client.from('packing_lists_suppliers').delete().eq('id', id);
            fetchSupplierPLs();
        }
    };

    const handleEditSupplierPL = (record: any) => {
        try {
            const parsed = typeof record.extractedData === 'string' ? JSON.parse(record.extractedData) : record.extractedData;
            if (parsed) {
                setSourceSupplierPLId(record.id); // Track origin ID for cleanup
                setBookingNumber(parsed.bookingNumber || '');
                setSoNumber(parsed.soNumber || '');
                if (parsed.items && Array.isArray(parsed.items)) {
                    const newItems = parsed.items.map((i: any) => ({
                        id: `item_${Date.now()}_${Math.random()}`,
                        containerNo: i.containerNo ? formatContainerNumber(i.containerNo) : '',
                        sealNo: i.sealNo || '',
                        grossLbs: i.grossLbs || 0,
                        netLbs: i.netLbs || 0,
                        grossKg: i.grossKg || 0,
                        netKg: i.netKg || 0,
                        volumes: i.volumes || 0,
                        supplier: i.supplier || '',
                        description: i.description || '',
                        blNumber: i.blNumber || '',
                        originalDoc: record.originalDocument
                    }));
                    setItems(newItems);
                    setSupplier(newItems[0]?.supplier || '');
                    setActiveView('PROCESSOR');
                } else {
                    alert("No line items found in this document.");
                }
            } else {
                alert("Could not load data structure.");
            }
        } catch (e) {
            console.error(e);
            alert("Could not load data");
        }
    };

    const exportToCSV = (filename: string, headers: string[], rows: (string | number)[][]) => {
        const csvContent = "data:text/csv;charset=utf-8," +
            [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const exportProductCSV = () => {
        const headers = ['Product Desc', 'Container No.', 'Seal No.', 'Gross Wt (lbs)', 'Net Wt (lbs)', 'Gross Wt (kg)', 'Net Wt (kg)', 'Volumes'];
        const rows = items.map(item => [
            item.description, item.containerNo, item.sealNo, item.grossLbs, item.netLbs, item.grossKg, item.netKg, item.volumes
        ]);
        rows.push(['TOTALS', '', '', totals.grossLbs, totals.netLbs, totals.grossKg, totals.netKg, totals.volumes]);
        exportToCSV(`Resume_Product_${bookingNumber || 'Draft'}.csv`, headers, rows);
    };

    const exportContainerCSV = () => {
        const headers = ['Container No.', 'Seal No.', 'Gross Wt (lbs)', 'Net Wt (lbs)', 'Gross Wt (kg)', 'Net Wt (kg)', 'Volumes'];
        const rows = containerSummary.map(c => [
            c.containerNo, c.sealNo, c.grossLbs, c.netLbs, c.grossKg, c.netKg, c.volumes
        ]);
        rows.push(['TOTALS', '', totals.grossLbs, totals.netLbs, totals.grossKg, totals.netKg, totals.volumes]);
        exportToCSV(`Resume_Container_${bookingNumber || 'Draft'}.csv`, headers, rows);
    };

    const exportProductPDF = () => {
        const doc = new jsPDF('l', 'mm', 'a4');
        doc.setFontSize(14);
        doc.text(`Resume per Product - Booking: ${bookingNumber}`, 14, 15);
        if (soNumber) {
            doc.setFontSize(10);
            doc.text(`SO #: ${soNumber}`, 14, 20);
        }

        const tableBody = items.map(item => [
            item.description,
            item.containerNo,
            item.sealNo,
            item.grossLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            item.netLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            item.grossKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            item.netKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            item.volumes
        ]);

        tableBody.push([
            'TOTALS', '', '',
            totals.grossLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            totals.netLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            totals.grossKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            totals.netKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            totals.volumes.toLocaleString()
        ]);

        autoTable(doc, {
            head: [['Product Desc', 'Container No.', 'Seal No.', 'Gross Wt (lbs)', 'Net Wt (lbs)', 'Gross Wt (kg)', 'Net Wt (kg)', 'Volumes']],
            body: tableBody,
            startY: 25,
            theme: 'grid',
            headStyles: { fillColor: [41, 128, 185], fontSize: 8 },
            bodyStyles: { fontSize: 8 },
            footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' }
        });

        // Generate Blob URL and Open Modal for Preview
        const pdfBlob = doc.output('blob');
        const blobUrl = URL.createObjectURL(pdfBlob);
        setViewingDoc({
            url: blobUrl,
            title: `Resume_Product_${bookingNumber || 'Draft'}.pdf`,
            isBlob: true
        });
    };

    const exportContainerPDF = () => {
        const doc = new jsPDF('l', 'mm', 'a4');
        doc.setFontSize(14);
        doc.text(`Resume per Container - Booking: ${bookingNumber}`, 14, 15);
        if (soNumber) {
            doc.setFontSize(10);
            doc.text(`SO #: ${soNumber}`, 14, 20);
        }

        const containerBody = containerSummary.map(c => [
            c.containerNo,
            c.sealNo,
            c.grossLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            c.netLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            c.grossKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            c.netKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            c.volumes
        ]);

        containerBody.push([
            'TOTALS', '',
            totals.grossLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            totals.netLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            totals.grossKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            totals.netKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            totals.volumes.toLocaleString()
        ]);

        autoTable(doc, {
            head: [['Container No.', 'Seal No.', 'Gross Wt (lbs)', 'Net Wt (lbs)', 'Gross Wt (kg)', 'Net Wt (kg)', 'Volumes']],
            body: containerBody,
            startY: 25,
            theme: 'grid',
            headStyles: { fillColor: [46, 204, 113], fontSize: 8 },
            bodyStyles: { fontSize: 8 },
            footStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold' }
        });

        // Generate Blob URL and Open Modal for Preview
        const pdfBlob = doc.output('blob');
        const blobUrl = URL.createObjectURL(pdfBlob);
        setViewingDoc({
            url: blobUrl,
            title: `Resume_Container_${bookingNumber || 'Draft'}.pdf`,
            isBlob: true
        });
    };

    const renderStatusIcon = (status: 'idle' | 'processing' | 'completed' | 'error') => {
        switch (status) {
            case 'processing': return <Loader2 size={16} className="text-blue-500 animate-spin" />;
            case 'completed': return <CheckCircle2 size={16} className="text-emerald-500" />;
            case 'error': return <AlertCircle size={16} className="text-red-500" />;
            default: return <Clock size={16} className="text-slate-400" />;
        }
    };

    const formatDualWeight = (valStr: string | number | undefined) => {
        const strVal = String(valStr || '0');
        const lbs = parseFloat(strVal.replace(/,/g, ''));
        if (isNaN(lbs)) return String(valStr);

        const kgs = lbs * 0.453592;

        return (
            <div className="flex flex-col items-end">
                <span className="font-mono font-bold text-slate-800 text-xs">
                    {lbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} lbs
                </span>
                <span className="font-mono text-[10px] text-slate-400">
                    {kgs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kgs
                </span>
            </div>
        );
    };

    return (
        <div className="h-full flex flex-col p-6 space-y-6 overflow-y-auto custom-scrollbar bg-slate-50 relative">
            {/* Header Navigation */}
            <div className="bg-white border-b border-slate-200 px-6 py-3 shrink-0 z-20 flex justify-end items-center shadow-sm">

                <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
                    <button
                        onClick={() => {
                            setActiveView('PROCESSOR');
                            // Explicitly clear data when user clicks this tab to start fresh
                            setItems([]);
                            setBookingNumber('');
                            setSoNumber('');
                            setPendingFiles([]);
                            setEditingId(null);
                            setShipper('');
                            setConsignee('');
                            setSupplier('');
                        }}
                        className={`px-4 py-1.5 rounded-md text-sm font-bold flex items-center gap-2 transition-all ${activeView === 'PROCESSOR'
                            ? 'bg-slate-800 text-white shadow-md'
                            : 'text-slate-500 hover:text-slate-700'
                            }`}
                    >
                        <ClipboardList size={14} /> PL Processor
                    </button>
                    <button
                        onClick={() => setActiveView('PL_VIEW')}
                        className={`px-4 py-1.5 rounded-md text-sm font-bold flex items-center gap-2 transition-all ${activeView === 'PL_VIEW'
                            ? 'bg-blue-600 text-white shadow-md'
                            : 'text-slate-500 hover:text-slate-700'
                            }`}
                    >
                        <ScanEye size={14} /> PL View
                    </button>
                    <button
                        onClick={() => setActiveView('RESUMES')}
                        className={`px-4 py-1.5 rounded-md text-sm font-bold flex items-center gap-2 transition-all ${activeView === 'RESUMES'
                            ? 'bg-emerald-600 text-white shadow-md'
                            : 'text-slate-500 hover:text-slate-700'
                            }`}
                    >
                        <FileBarChart size={14} /> Saved Resumes
                    </button>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6">

                {activeView === 'PROCESSOR' && (
                    <div className="flex flex-col gap-6 animate-in fade-in">
                        {/* Upload Window (Drop Zone) */}
                        <div className="max-w-4xl mx-auto w-full">
                            <div
                                className={`bg-white border-2 border-dashed rounded-xl p-8 transition-all ${isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 hover:border-indigo-400'}`}
                                onDragOver={onDragOver}
                                onDragLeave={onDragLeave}
                                onDrop={onDrop}
                            >
                                <div className="flex flex-col items-center justify-center text-center">
                                    <div className="text-center">
                                        <h3 className="text-xl font-bold text-slate-600 mb-2">Add loading documents</h3>
                                        <p className="text-sm text-slate-400">
                                            Upload Packing Lists (PDF, Images)
                                        </p>
                                    </div>
                                    <div className="flex gap-3 mt-4">
                                        <button
                                            onClick={() => fileInputRef.current?.click()}
                                            className="bg-white border border-slate-300 text-slate-700 px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-slate-50 transition-colors shadow-sm"
                                        >
                                            Browse Files
                                        </button>
                                        <input
                                            type="file"
                                            ref={fileInputRef}
                                            className="hidden"
                                            accept=".pdf,.png,.jpg,.jpeg,.csv"
                                            onChange={handleFileSelect}
                                            multiple
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Queue List */}
                        {pendingFiles.length > 0 && (
                            <div className="max-w-4xl mx-auto w-full bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                                <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                                    <h3 className="font-bold text-slate-700 text-sm flex items-center gap-2">
                                        <List size={16} /> Processing Queue ({pendingFiles.length})
                                    </h3>
                                    <div className="flex gap-3">
                                        <button onClick={() => setPendingFiles([])} className="text-xs text-red-500 hover:underline" disabled={isProcessing}>Clear All</button>
                                        <button
                                            onClick={processQueue}
                                            disabled={isProcessing || pendingFiles.every(f => f.status === 'completed')}
                                            className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-indigo-700 transition-colors shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isProcessing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                                            Process All
                                        </button>
                                    </div>
                                </div>
                                <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto custom-scrollbar">
                                    {pendingFiles.map((item) => (
                                        <div key={item.id} className="flex justify-between items-center p-3 hover:bg-slate-50 transition-colors">
                                            <div className="flex items-center gap-3 overflow-hidden flex-1">
                                                {/* Status Icon */}
                                                <div className="shrink-0">
                                                    {renderStatusIcon(item.status)}
                                                </div>

                                                {/* File Name */}
                                                <span className={`text-sm font-medium truncate flex-1 ${item.status === 'error' ? 'text-red-600' : 'text-slate-700'}`}>
                                                    {item.file.name}
                                                </span>

                                                {/* Activity Text (Right side of name, before remove button) */}
                                                <span className={`text-[10px] whitespace-nowrap min-w-[60px] text-right mr-2 ${item.status === 'processing' ? 'text-blue-500 animate-pulse' : 'text-slate-400 capitalize'}`}>
                                                    {item.status === 'processing' ? 'Analyzing...' : item.status}
                                                </span>
                                            </div>
                                            <button onClick={() => handleRemoveFile(item.id)} disabled={isProcessing} className="text-slate-400 hover:text-red-500 disabled:opacity-50"><X size={14} /></button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Resume Editor Area */}
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col">
                            {/* Header Input */}
                            <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-wrap items-end gap-4">
                                {/* PL Number Display */}
                                <div className="flex flex-col">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase mb-1">PL #</label>
                                    <div className="flex items-center gap-2 px-3 h-[38px] bg-slate-100 rounded border border-slate-200">
                                        <span className="font-mono text-sm font-bold text-slate-700">
                                            {plNumber || 'N/A'}
                                        </span>
                                        {isNewPL && plNumber && (
                                            <span className="text-[9px] bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded font-bold uppercase">NEW</span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex flex-col flex-1 max-w-xs min-w-[180px]">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase mb-1">SO #</label>
                                    <select
                                        className="border border-slate-300 rounded px-3 h-[38px] text-sm w-full focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                                        value={soNumber}
                                        onChange={handleSoChange}
                                    >
                                        <option value="">-- Select Sales Order --</option>
                                        <option value="__NEW__" className="text-indigo-600 font-bold">+ ADD NEW (Auto-Gen)</option>
                                        {salesOrders.filter(so => so.status !== 'FULFILLED').map(so => (
                                            <option key={so.id} value={so.orderNumber}>
                                                {so.orderNumber} - {so.customerName}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex flex-col flex-1 max-w-xs min-w-[180px]">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase mb-1">Booking #</label>
                                    <select
                                        className="border border-slate-300 rounded px-3 h-[38px] text-sm w-full focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                                        value={bookingNumber}
                                        onChange={handleBookingChange}
                                    >
                                        <option value="">-- Select Booking --</option>
                                        {bookings.filter(b => {
                                            if (b.status === 'AVAILABLE') {
                                                if (!soNumber) return true;
                                                const selectedSO = salesOrders.find(so => so.orderNumber === soNumber);
                                                if (!selectedSO) return true;
                                                // Filter bookings that match the SO's customer name (Partial & Case-Insensitive)
                                                if (!b.customer) return true;
                                                // Normalize strings: remove accents/diacritics and convert to lowercase
                                                const normalizeStr = (str: string) => str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                                                const bookingCustomer = normalizeStr(b.customer);
                                                const soCustomer = normalizeStr(selectedSO.customerName || '');
                                                return bookingCustomer.includes(soCustomer) || soCustomer.includes(bookingCustomer);
                                            }
                                            return false;
                                        }).map(b => (
                                            <option key={b.id} value={b.bookingNumber}>
                                                {b.bookingNumber} {b.customer ? `- ${b.customer}` : ''}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex flex-col flex-1 max-w-xs min-w-[180px]">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase mb-1">Supplier</label>
                                    <select
                                        className="border border-slate-300 rounded px-3 h-[38px] text-sm w-full focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                                        value={supplier}
                                        onChange={e => {
                                            const val = e.target.value;
                                            if (val === '__NEW__') {
                                                setQuickAddType('supplier');
                                                setSupplier(''); // Reset or keep empty to allow 'Select Supplier' to show until created
                                            } else {
                                                setSupplier(val);
                                            }
                                        }}
                                    >
                                        <option value="">-- Select Supplier --</option>
                                        <option value="__NEW__" className="text-indigo-600 font-bold">+ ADD NEW</option>
                                        {suppliers.map(s => (
                                            <option key={s.id} value={s.name}>{s.name}</option>
                                        ))}
                                        {!suppliers.some(s => s.name === supplier) && supplier && (
                                            <option value={supplier}>{supplier}</option>
                                        )}
                                    </select>
                                </div>
                                <div className="flex flex-col flex-1 max-w-xs min-w-[180px]">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase mb-1">Shipper</label>
                                    <select
                                        className="border border-slate-300 rounded px-3 h-[38px] text-sm w-full focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                                        value={shipper}
                                        onChange={e => {
                                            const val = e.target.value;
                                            if (val === '__NEW__') {
                                                setQuickAddType('shipper');
                                                setShipper('');
                                            } else {
                                                setShipper(val);
                                            }
                                        }}
                                    >
                                        <option value="">-- Select Shipper --</option>
                                        <option value="__NEW__" className="text-indigo-600 font-bold">+ ADD NEW</option>
                                        {companies.map(c => (
                                            <option key={c.id} value={c.name}>{c.name}</option>
                                        ))}
                                        {!companies.some(c => c.name === shipper) && shipper && (
                                            <option value={shipper}>{shipper}</option>
                                        )}
                                    </select>
                                </div>
                                <div className="flex flex-col flex-1 max-w-xs min-w-[180px]">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase mb-1">Consignee</label>
                                    <select
                                        className="border border-slate-300 rounded px-3 h-[38px] text-sm w-full focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                                        value={consignee}
                                        onChange={e => {
                                            const val = e.target.value;
                                            if (val === '__NEW__') {
                                                setQuickAddType('consignee');
                                                setConsignee('');
                                            } else {
                                                setConsignee(val);
                                            }
                                        }}
                                    >
                                        <option value="">-- Select Consignee --</option>
                                        <option value="__NEW__" className="text-indigo-600 font-bold">+ ADD NEW</option>
                                        {customers.map(c => (
                                            <option key={c.id} value={c.name}>{c.name}</option>
                                        ))}
                                        {!customers.some(c => c.name === consignee) && consignee && (
                                            <option value={consignee}>{consignee}</option>
                                        )}
                                    </select>
                                </div>
                                {statusMessage && (
                                    <div className="flex items-center gap-2 text-indigo-600 text-sm animate-pulse ml-auto">
                                        <Loader2 size={14} className="animate-spin" /> {statusMessage}
                                    </div>
                                )}
                            </div>

                            {/* Tables Container */}
                            <div className="p-6 space-y-8 overflow-x-auto">

                                {/* 1. Resume per product */}
                                <div>
                                    <div className="flex justify-between items-center mb-3">
                                        <h3 className="font-bold text-slate-700 uppercase text-xs tracking-wider flex items-center gap-2">
                                            <List size={14} /> Resume per product
                                        </h3>
                                        {/* Add Manual Item Button */}
                                        <button
                                            onClick={handleAddItem}
                                            className="text-xs bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-lg border border-indigo-100 hover:bg-indigo-100 font-bold flex items-center gap-1"
                                        >
                                            <Plus size={12} /> Add Line Item
                                        </button>
                                    </div>

                                    <div className="border border-slate-200 rounded-lg overflow-hidden min-w-[1200px]">
                                        <table className="w-full border-collapse text-sm text-left">
                                            <thead className="bg-slate-100 text-xs font-bold text-slate-600 uppercase">
                                                <tr>
                                                    <th className="p-3 border-r border-slate-200 min-w-[280px]">Original Desc</th>
                                                    <th className="p-3 border-r border-slate-200 min-w-[180px]">Product</th>
                                                    <th className="p-3 border-r border-slate-200 min-w-[110px]">Container No.</th>
                                                    <th className="p-3 border-r border-slate-200 min-w-[60px]">Seal No.</th>
                                                    <th className="p-3 border-r border-slate-200 min-w-[100px] text-right">Gross Wt (lbs)</th>
                                                    <th className="p-3 border-r border-slate-200 min-w-[100px] text-right">Net Wt (lbs)</th>
                                                    <th className="p-3 border-r border-slate-200 min-w-[100px] text-right">Gross Wt (kg)</th>
                                                    <th className="p-3 border-r border-slate-200 min-w-[100px] text-right">Net Wt (kg)</th>
                                                    <th className="p-3 border-r border-slate-200 min-w-[80px] text-center">Volumes</th>
                                                    <th className="p-3 w-10 text-center"></th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {items.map((item) => (
                                                    <tr key={item.id} className="hover:bg-blue-50/30 group">
                                                        <td className="p-1 border-r border-slate-100"><input className="w-full bg-transparent px-2 py-1 outline-none" value={item.description} onChange={e => updateItem(item.id, 'description', e.target.value)} /></td>
                                                        <td className="p-1 border-r border-slate-100">
                                                            <select
                                                                value={item.productId || ''}
                                                                onChange={e => {
                                                                    const val = e.target.value;
                                                                    if (val === '__NEW__') {
                                                                        setQuickAddType('supplier'); // Reuse modal for now
                                                                        return;
                                                                    }

                                                                    // Find Product and update all fields
                                                                    const product = products.find(p => p.id === val);
                                                                    setItems(current => current.map(i => {
                                                                        if (i.id === item.id) {
                                                                            return {
                                                                                ...i,
                                                                                productId: val,
                                                                                productName: product ? (product.grade ? `${product.name} (${product.grade})` : product.name) : '',
                                                                                productGrade: product ? product.grade : ''
                                                                            };
                                                                        }
                                                                        return i;
                                                                    }));
                                                                }}
                                                                className="w-full bg-transparent px-2 py-1 outline-none text-sm border border-slate-200 rounded"
                                                            >
                                                                <option value="">Select Product...</option>
                                                                {products.map(p => (
                                                                    <option key={p.id} value={p.id}>{p.name} {p.grade ? `(${p.grade})` : ''}</option>
                                                                ))}
                                                                <option value="__NEW__" className="text-indigo-600 font-bold">+ ADD NEW PRODUCT +</option>
                                                            </select>
                                                        </td>
                                                        <td className="p-1 border-r border-slate-100"><input className="w-full bg-transparent px-2 py-1 outline-none font-mono text-slate-700" value={item.containerNo} onChange={e => updateItem(item.id, 'containerNo', e.target.value)} /></td>
                                                        <td className="p-1 border-r border-slate-100"><input className="w-full bg-transparent px-2 py-1 outline-none font-mono text-slate-700" value={item.sealNo} onChange={e => updateItem(item.id, 'sealNo', e.target.value)} /></td>
                                                        <td className="p-1 border-r border-slate-100">
                                                            <FormattedInput
                                                                className="w-full bg-transparent px-2 py-1 outline-none text-right font-mono"
                                                                value={item.grossLbs}
                                                                onChange={val => updateItem(item.id, 'grossLbs', val)}
                                                                decimals={1}
                                                            />
                                                        </td>
                                                        <td className="p-1 border-r border-slate-100">
                                                            <FormattedInput
                                                                className="w-full bg-transparent px-2 py-1 outline-none text-right font-mono"
                                                                value={item.netLbs}
                                                                onChange={val => updateItem(item.id, 'netLbs', val)}
                                                                decimals={1}
                                                            />
                                                        </td>
                                                        <td className="p-1 border-r border-slate-100">
                                                            <FormattedInput
                                                                className="w-full bg-transparent px-2 py-1 outline-none text-right font-mono"
                                                                value={item.grossKg}
                                                                onChange={val => updateItem(item.id, 'grossKg', val)}
                                                                decimals={1}
                                                            />
                                                        </td>
                                                        <td className="p-1 border-r border-slate-100">
                                                            <FormattedInput
                                                                className="w-full bg-transparent px-2 py-1 outline-none text-right font-mono"
                                                                value={item.netKg}
                                                                onChange={val => updateItem(item.id, 'netKg', val)}
                                                                decimals={1}
                                                            />
                                                        </td>
                                                        <td className="p-1 border-r border-slate-100"><input type="number" className="w-full bg-transparent px-2 py-1 outline-none text-center" value={item.volumes || ''} onChange={e => updateItem(item.id, 'volumes', parseFloat(e.target.value))} /></td>
                                                        <td className="p-1 text-center">
                                                            <div className="flex items-center justify-center gap-1">
                                                                {item.originalDoc && (
                                                                    <button onClick={() => handleViewItemDoc(item.originalDoc)} className="text-slate-300 hover:text-blue-500 transition-colors" title="View Original">
                                                                        <Eye size={14} />
                                                                    </button>
                                                                )}
                                                                <button onClick={() => handleDeleteItem(item.id)} className="text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                                {items.length === 0 && (
                                                    <tr className="bg-slate-50/50 border-t border-slate-200 border-dashed">
                                                        <td colSpan={9} className="h-32 text-center text-slate-400 text-xs italic align-middle">
                                                            No container data available. Add items above.
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                            <tfoot className="bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-800">
                                                <tr>
                                                    <td colSpan={3} className="p-3 border-r border-slate-200">TOTALS</td>
                                                    <td className="p-3 text-right border-r border-slate-200 font-mono">{totals.grossLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                                                    <td className="p-3 text-right border-r border-slate-200 font-mono">{totals.netLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                                                    <td className="p-3 text-right border-r border-slate-200 font-mono">{totals.grossKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                                                    <td className="p-3 text-right border-r border-slate-200 font-mono">{totals.netKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                                                    <td className="p-3 text-center border-r border-slate-200 font-mono">{totals.volumes}</td>
                                                    <td className="p-3 bg-slate-50"></td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                </div>

                                {/* 2. Resume per container */}
                                <div>
                                    <h3 className="font-bold text-slate-700 mb-3 uppercase text-xs tracking-wider flex items-center gap-2">
                                        <Package size={14} /> Resume per container
                                    </h3>
                                    <div className="border border-slate-200 rounded-lg overflow-hidden min-w-[800px]">
                                        <table className="w-full border-collapse text-sm text-left">
                                            <thead className="bg-slate-100 text-xs font-bold text-slate-600 uppercase shadow-sm">
                                                <tr>
                                                    <th className="p-3 border-r border-slate-200 min-w-[150px]">Container No.</th>
                                                    <th className="p-3 border-r border-slate-200 min-w-[100px]">Seal No.</th>
                                                    <th className="p-3 border-r border-slate-200 min-w-[130px] text-right">Gross Wt (lbs)</th>
                                                    <th className="p-3 border-r border-slate-200 min-w-[130px] text-right">Net Wt (lbs)</th>
                                                    <th className="p-3 border-r border-slate-200 min-w-[130px] text-right">Gross Wt (kg)</th>
                                                    <th className="p-3 border-r border-slate-200 min-w-[130px] text-right">Net Wt (kg)</th>
                                                    <th className="p-3 border-r border-slate-200 min-w-[100px] text-center">Volumes</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {containerSummary.map((container, idx) => (
                                                    <tr key={idx} className="hover:bg-green-50/30">
                                                        <td className="p-3 border-r border-slate-100 font-mono text-slate-700 font-medium">{container.containerNo}</td>
                                                        <td className="p-3 border-r border-slate-100 font-mono text-slate-500">{container.sealNo}</td>
                                                        <td className="p-3 border-r border-slate-100 text-right font-mono">{container.grossLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                                                        <td className="p-3 border-r border-slate-100 text-right font-mono">{container.netLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                                                        <td className="p-3 border-r border-slate-100 text-right font-mono">{container.grossKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                                                        <td className="p-3 border-r border-slate-100 text-right font-mono">{container.netKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                                                        <td className="p-3 border-r border-slate-100 text-center font-mono">{container.volumes}</td>
                                                    </tr>
                                                ))}
                                                {containerSummary.length === 0 && (
                                                    <tr className="bg-slate-50/50 border-t border-slate-200 border-dashed">
                                                        <td colSpan={7} className="h-32 text-center text-slate-400 text-xs italic align-middle">
                                                            No container data available.
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                            <tfoot className="bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-800">
                                                <tr>
                                                    <td colSpan={2} className="p-3 border-r border-slate-200">TOTALS</td>
                                                    <td className="p-3 text-right border-r border-slate-200 font-mono">{totals.grossLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                                                    <td className="p-3 text-right border-r border-slate-200 font-mono">{totals.netLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                                                    <td className="p-3 text-right border-r border-slate-200 font-mono">{totals.grossKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                                                    <td className="p-3 text-right border-r border-slate-200 font-mono">{totals.netKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                                                    <td className="p-3 text-center border-r border-slate-200 font-mono">{totals.volumes}</td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                </div>

                                {/* Export Controls Footer */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4 pb-8 border-b border-slate-200">
                                    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col">
                                        <h4 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                                            <List size={18} className="text-blue-600" /> Resume per Product
                                        </h4>
                                        <div className="flex gap-3">
                                            <button
                                                onClick={exportProductPDF}
                                                className="flex-1 bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg font-bold text-sm hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
                                            >
                                                <FileText size={16} /> PDF
                                            </button>
                                            <button
                                                onClick={exportProductCSV}
                                                className="flex-1 bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg font-bold text-sm hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
                                            >
                                                <FileSpreadsheet size={16} /> Excel (.csv)
                                            </button>
                                        </div>
                                    </div>
                                    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col">
                                        <h4 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                                            <Package size={18} className="text-emerald-600" /> Resume per Container
                                        </h4>
                                        <div className="flex gap-3">
                                            <button
                                                onClick={exportContainerPDF}
                                                className="flex-1 bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg font-bold text-sm hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
                                            >
                                                <FileText size={16} /> PDF
                                            </button>
                                            <button
                                                onClick={exportContainerCSV}
                                                className="flex-1 bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg font-bold text-sm hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
                                            >
                                                <FileSpreadsheet size={16} /> Excel (.csv)
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* NEW ACTIONS SECTION */}
                                {/* NEW ACTIONS SECTION */}
                                <div className="mt-8 flex flex-col md:flex-row gap-6 justify-center">
                                    <button
                                        onClick={() => handleSaveAndExit()}
                                        disabled={isSaving || items.length === 0}
                                        className="bg-slate-800 hover:bg-slate-900 text-white px-8 py-4 rounded-xl font-bold text-lg shadow-lg flex items-center gap-3 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed min-w-[200px] justify-center"
                                    >
                                        {isSaving ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
                                        {editingId ? 'UPDATE' : 'SAVE'} AND EXIT
                                    </button>

                                    <button
                                        onClick={handleMakeInvoice}
                                        disabled={isSaving || items.length === 0}
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-4 rounded-xl font-bold text-lg shadow-lg flex items-center gap-3 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed min-w-[200px] justify-center"
                                    >
                                        {isSaving ? <Loader2 size={20} className="animate-spin" /> : <FileCheck size={20} />}
                                        MAKE INVOICE
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeView === 'PL_VIEW' && (
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-full animate-in fade-in slide-in-from-right-4">
                        <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                            <h3 className="font-bold text-slate-700 flex items-center gap-2">
                                <ScanEye size={18} className="text-indigo-600" /> View Original Packing Lists
                            </h3>
                            <button onClick={fetchSupplierPLs} className="text-xs text-slate-500 hover:text-indigo-600 flex items-center gap-1">
                                <RefreshCw size={12} /> Refresh
                            </button>
                        </div>
                        <div className="overflow-auto custom-scrollbar flex-1">
                            <table className="w-full text-left border-collapse text-xs">
                                <thead className="bg-slate-100 font-bold text-slate-600 uppercase sticky top-0 z-10 shadow-sm">
                                    <tr>
                                        <th className="p-3 border-r border-slate-200 min-w-[200px]">Product Desc</th>
                                        <th className="p-3 border-r border-slate-200 min-w-[150px]">Container No.</th>
                                        <th className="p-3 border-r border-slate-200 min-w-[100px]">Seal No.</th>
                                        <th className="p-3 border-r border-slate-200 text-right min-w-[100px]">Gross Wt (lbs)</th>
                                        <th className="p-3 border-r border-slate-200 text-right min-w-[100px]">Net Wt (lbs)</th>
                                        <th className="p-3 border-r border-slate-200 text-right min-w-[100px]">Gross Wt (kg)</th>
                                        <th className="p-3 border-r border-slate-200 text-right min-w-[100px]">Net Wt (kg)</th>
                                        <th className="p-3 border-r border-slate-200 text-center min-w-[80px]">Volumes</th>
                                        <th className="p-3 border-r border-slate-200 min-w-[150px]">Supplier</th>
                                        <th className="p-3 border-r border-slate-200 min-w-[120px]">BL Number</th>
                                        <th className="p-3 border-r border-slate-200 min-w-[120px]">Upload Date</th>
                                        <th className="p-3 text-center w-24 sticky right-0 bg-slate-100 shadow-l">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {supplierPLs.map((pl) => (
                                        <tr key={pl.id} className="hover:bg-slate-50 transition-colors">
                                            <td className="p-2 border-r border-slate-100 font-medium text-slate-700 truncate max-w-[200px]" title={pl.productDescription || ''}>
                                                {pl.productDescription || '-'}
                                            </td>
                                            <td className="p-2 border-r border-slate-100 font-mono text-slate-600 truncate max-w-[150px]" title={pl.containerNumber || ''}>
                                                {pl.containerNumber || '-'}
                                            </td>
                                            <td className="p-2 border-r border-slate-100 font-mono text-slate-600 truncate max-w-[100px]" title={pl.sealNumber || ''}>
                                                {pl.sealNumber || '-'}
                                            </td>
                                            <td className="p-2 border-r border-slate-100 text-right font-mono text-slate-700">
                                                {Number(pl.grossLbs || 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                                            </td>
                                            <td className="p-2 border-r border-slate-100 text-right font-mono text-slate-700">
                                                {Number(pl.netLbs || 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                                            </td>
                                            <td className="p-2 border-r border-slate-100 text-right font-mono text-slate-700">
                                                {Number(pl.grossKg || 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                                            </td>
                                            <td className="p-2 border-r border-slate-100 text-right font-mono text-slate-700">
                                                {Number(pl.netKg || 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                                            </td>
                                            <td className="p-2 border-r border-slate-100 text-center font-mono text-slate-700">
                                                {Number(pl.volumes || 0).toLocaleString()}
                                            </td>
                                            <td className="p-2 border-r border-slate-100 text-slate-600 truncate max-w-[150px]" title={pl.supplier || ''}>
                                                {pl.supplier || '-'}
                                            </td>
                                            <td className="p-2 border-r border-slate-100 font-mono text-slate-600 truncate max-w-[120px]" title={pl.blNumber || ''}>
                                                {pl.blNumber || '-'}
                                            </td>
                                            <td className="p-2 border-r border-slate-100 text-slate-500 text-[10px]">
                                                {new Date(pl.createdAt || '').toLocaleString()}
                                            </td>
                                            <td className="p-2 text-center sticky right-0 bg-white group-hover:bg-slate-50 shadow-l">
                                                <div className="flex justify-center gap-2">
                                                    <button
                                                        onClick={() => handleViewSupplierOriginal(pl)}
                                                        className="text-slate-400 hover:text-blue-600 transition-colors"
                                                        title="View Original"
                                                    >
                                                        <Eye size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleEditSupplierPL(pl)}
                                                        className="text-slate-400 hover:text-emerald-600 transition-colors"
                                                        title="Load to Processor"
                                                    >
                                                        <Pencil size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteSupplierPL(pl.id)}
                                                        className="text-slate-400 hover:text-red-600 transition-colors"
                                                        title="Delete"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {supplierPLs.length === 0 && (
                                        <tr>
                                            <td colSpan={12} className="p-8 text-center text-slate-400 italic">
                                                No uploaded packing lists found.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {activeView === 'RESUMES' && (
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-full animate-in fade-in slide-in-from-right-4">
                        <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                            <h3 className="font-bold text-slate-700 flex items-center gap-2">
                                <FileBarChart size={18} className="text-indigo-600" /> Saved Resumes
                            </h3>
                            <button onClick={fetchSavedPLs} className="text-xs text-slate-500 hover:text-indigo-600 flex items-center gap-1">
                                <RefreshCw size={12} /> Refresh
                            </button>
                        </div>
                        <div className="overflow-auto custom-scrollbar flex-1">
                            <table className="w-full text-left border-collapse text-sm">
                                <thead className="bg-slate-100 text-xs font-bold text-slate-600 uppercase sticky top-0 z-10 shadow-sm">
                                    <tr>
                                        <th className="p-3 border-r border-slate-200">Date Created</th>
                                        <th className="p-3 border-r border-slate-200">PL Number</th>
                                        <th className="p-3 border-r border-slate-200">Booking / Ref</th>
                                        <th className="p-3 border-r border-slate-200">SO #</th>
                                        <th className="p-3 border-r border-slate-200">Supplier</th>
                                        <th className="p-3 border-r border-slate-200">Shipper</th>
                                        <th className="p-3 border-r border-slate-200">Consignee</th>
                                        <th className="p-3 border-r border-slate-200 text-right">Units</th>
                                        <th className="p-3 border-r border-slate-200 text-right">Net Wt</th>
                                        <th className="p-3 border-r border-slate-200 text-right">Gross Wt</th>
                                        <th className="p-3 text-center w-32">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {savedPLs.map((pl) => (
                                        <tr key={pl.id} className="hover:bg-slate-50 transition-colors">
                                            <td className="p-3 border-r border-slate-100 text-slate-500 text-xs">
                                                {new Date(pl.createdAt || '').toLocaleDateString()}
                                            </td>
                                            <td className="p-3 border-r border-slate-100 font-mono font-bold text-slate-700">
                                                {pl.plNumber}
                                            </td>
                                            <td className="p-3 border-r border-slate-100 font-mono text-slate-600 text-xs">
                                                {pl.blNumber || '-'}
                                            </td>
                                            <td className="p-3 border-r border-slate-100 font-mono text-slate-600 text-xs">
                                                {pl.soNumber || '-'}
                                            </td>
                                            <td className="p-3 border-r border-slate-100 truncate max-w-[150px]" title={pl.supplier || '-'}>
                                                {(pl.supplier || '-').split(' ').slice(0, 2).join(' ')}
                                            </td>
                                            <td className="p-3 border-r border-slate-100 truncate max-w-[150px]" title={pl.shipper}>
                                                {pl.shipper.split(' ').slice(0, 2).join(' ')}
                                            </td>
                                            <td className="p-3 border-r border-slate-100 truncate max-w-[150px]" title={pl.consignee}>
                                                {pl.consignee.split(' ').slice(0, 2).join(' ')}
                                            </td>
                                            <td className="p-3 border-r border-slate-100 text-right font-mono">
                                                {pl.unitCount}
                                            </td>
                                            <td className="p-3 border-r border-slate-100 text-right">
                                                {formatDualWeight(pl.netWeight || '0')}
                                            </td>
                                            <td className="p-3 border-r border-slate-100 text-right">
                                                {formatDualWeight(pl.grossWeight || '0')}
                                            </td>
                                            <td className="p-3 text-center">
                                                <div className="flex justify-center gap-2">
                                                    <button
                                                        onClick={() => handleEditSavedPL(pl)}
                                                        className="text-slate-400 hover:text-blue-600 transition-colors"
                                                        title="Edit / View"
                                                    >
                                                        <Pencil size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleViewOriginal(pl)}
                                                        className="text-slate-400 hover:text-emerald-600 transition-colors"
                                                        title="View Original PL"
                                                    >
                                                        <Eye size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteSavedPL(pl.id)}
                                                        className="text-slate-400 hover:text-red-600 transition-colors"
                                                        title="Delete"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {savedPLs.length === 0 && (
                                        <tr>
                                            <td colSpan={10} className="p-8 text-center text-slate-400 italic">
                                                No saved resumes found.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            {/* Customer Selection Modal - REMOVED: Make Invoice now passes data directly to Invoice Engine */}
            {/* View Document Modal */}
            {
                viewingDoc && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in">
                        <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col animate-in zoom-in-95">
                            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                    <FileText size={20} className="text-blue-600" />
                                    {viewingDoc.title}
                                </h3>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleDownloadDoc}
                                        className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-slate-900 transition-colors flex items-center gap-2"
                                    >
                                        <Download size={16} /> Download
                                    </button>
                                    <button onClick={closeDocument} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-200 rounded-full transition-all">
                                        <X size={24} />
                                    </button>
                                </div>
                            </div>
                            <div className="flex-1 bg-slate-100 p-2 overflow-hidden relative">
                                <iframe
                                    src={viewingDoc.url}
                                    className="w-full h-full rounded border border-slate-300 bg-white"
                                    title="Document Preview"
                                />
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Quick Add Modal */}
            <QuickAddModal
                isOpen={!!quickAddType}
                onClose={() => setQuickAddType(null)}
                onSave={handleQuickSave}
                type={quickAddType as 'supplier' | 'shipper' | 'consignee'}
                title={
                    quickAddType === 'supplier' ? 'Add New Supplier' :
                        quickAddType === 'shipper' ? 'Add New Shipper (Company)' :
                            quickAddType === 'consignee' ? 'Add New Consignee (Customer)' : ''
                }
            />
        </div >
    );
};

export default PLEngine;
