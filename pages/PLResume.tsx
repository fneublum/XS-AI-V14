import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, Loader2, Plus, Trash2, FileText, Download, Printer, RefreshCw, AlertCircle, Save, X, List, Package, FileSpreadsheet, CheckCircle2, Clock, Play, FileCheck, ArrowRight, Building2 } from 'lucide-react';
import { analyzeDocument } from '../services/geminiService';
import { getSupabaseClient } from '../services/supabase';
import { Customer, PackingList, Invoice } from '../types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
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

const PLResume: React.FC = () => {
    const [bookingNumber, setBookingNumber] = useState('');
    const [items, setItems] = useState<PLItem[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    
    // Upload Queue State
    const [pendingFiles, setPendingFiles] = useState<FileQueueItem[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    
    // Database / Save State
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [showInvoiceModal, setShowInvoiceModal] = useState(false);
    const [selectedCustomerId, setSelectedCustomerId] = useState('');
    
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Fetch Customers on Mount
    useEffect(() => {
        const fetchCustomers = async () => {
            const client = getSupabaseClient();
            if (client) {
                const { data } = await client.from('customers').select('*');
                if (data) setCustomers(data);
            }
        };
        fetchCustomers();
    }, []);

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
        // Use the first found seal number for the container if not set
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
            // Reset input so same file can be selected again if needed
            e.target.value = '';
        }
    };

    const handleRemoveFile = (id: string) => {
        setPendingFiles(prev => prev.filter(item => item.id !== id));
    };

    // Drag and Drop Handlers
    const onDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const onDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        // Only set false if leaving the main container (not entering a child)
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
            
            // Set status to processing
            setPendingFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'processing' } : f));
            setStatusMessage(`Processing ${i + 1}/${filesToProcess.length}: ${item.file.name}...`);
            
            try {
                const base64Data = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (event) => resolve((event.target?.result as string)); // Keep data: prefix
                    reader.onerror = (error) => reject(error);
                    reader.readAsDataURL(item.file);
                });
                
                const rawBase64 = base64Data.split(',')[1];
                
                // Store base64 in item for later saving
                setPendingFiles(prev => prev.map(f => f.id === item.id ? { ...f, base64: base64Data } : f));

                await processDocument(rawBase64, item.file.type);
                
                // Set status to completed
                setPendingFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'completed' } : f));
            } catch (err) {
                console.error(`Error processing ${item.file.name}`, err);
                // Set status to error
                setPendingFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'error' } : f));
            }
        }
        
        setStatusMessage('');
        setIsProcessing(false);
    };

    const processDocument = async (base64Data: string, mimeType: string) => {
        const prompt = `
            Analyze this Packing List document.
            Task: Extract shipping data into a structured JSON format.
            
            1. Find the "Booking Number" or "Booking Ref".
               - CRITICAL: Check for the text "CUSTOMER TRUCK". If found, the Booking Number is the value immediately BELOW "CUSTOMER TRUCK".
            2. Extract line items representing Containers. For each container, find:
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
            
            // Basic JSON parsing cleanup
            let cleanJson = result;
            if (cleanJson.includes('```json')) {
                cleanJson = cleanJson.split('```json')[1].split('```')[0].trim();
            } else if (cleanJson.includes('```')) {
                cleanJson = cleanJson.split('```')[1].trim();
            }

            const parsed = JSON.parse(cleanJson);
            
            if (parsed.bookingNumber && !bookingNumber) {
                setBookingNumber(parsed.bookingNumber);
            }

            if (parsed.items && Array.isArray(parsed.items)) {
                const newItems: PLItem[] = parsed.items.map((i: any) => ({
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
                    blNumber: i.blNumber || ''
                }));
                setItems(prev => [...prev, ...newItems]);
            }
        } catch (error) {
            console.error(error);
            throw error; // Propagate error for status update
        }
    };

    const handleDeleteItem = (id: string) => {
        setItems(items.filter(i => i.id !== id));
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

    // --- Save & Invoice Functions ---

    const saveToDatabase = async (customerId?: string): Promise<boolean> => {
        const client = getSupabaseClient();
        if (!client) {
            alert("Database connection not available.");
            return false;
        }

        setIsSaving(true);
        setStatusMessage('Saving to Database...');

        try {
            // 1. Prepare Packing List Record
            const plId = `PL${Date.now()}`;
            const customer = customers.find(c => c.id === customerId);
            const companyId = customer ? customer.companyId : 'ALL';
            
            // Get original document (use first one in list)
            const primaryDoc = pendingFiles.find(f => f.status === 'completed')?.base64 || '';

            const packingList: PackingList = {
                id: plId,
                companyId: companyId,
                createdAt: new Date().toISOString(),
                plNumber: bookingNumber || `PL-${Date.now().toString().slice(-6)}`,
                date: new Date().toISOString().split('T')[0],
                shipper: items[0]?.supplier || 'Multiple Suppliers',
                consignee: customer ? customer.name : 'TBD',
                containerNumber: items.map(i => i.containerNo).filter(Boolean).join(', '),
                sealNumber: items.map(i => i.sealNo).filter(Boolean).join(', '),
                grossWeight: totals.grossLbs.toString(),
                netWeight: totals.netLbs.toString(),
                unitCount: totals.volumes.toString(),
                items: JSON.stringify(items),
                originalDocument: primaryDoc,
                blNumber: bookingNumber // Using booking number as reference
            };

            const { error: plError } = await client.from('packing_lists').insert(packingList);
            if (plError) throw plError;

            // 2. If Customer Selected, Create Draft Invoice
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
                    items: JSON.stringify(items.map(i => ({
                        description: i.description,
                        quantity: i.netLbs, // Defaulting to Net LBS as qty
                        unit_price: 0,
                        amount: 0
                    }))),
                    grossWeight: totals.grossLbs.toString(),
                    netWeight: totals.netLbs.toString(),
                    totalQuantity: totals.volumes.toString(),
                    transportRef: bookingNumber,
                    customerPo: ''
                };
                
                const { error: invError } = await client.from('invoices').insert(invoice);
                if (invError) throw invError;
            }

            return true;

        } catch (error: any) {
            console.error("Save Error:", error);
            alert(`Failed to save: ${error.message}`);
            return false;
        } finally {
            setIsSaving(false);
            setStatusMessage('');
        }
    };

    const handleSaveAndExit = async () => {
        const success = await saveToDatabase();
        if (success) {
            // Reset Form
            setItems([]);
            setBookingNumber('');
            setPendingFiles([]);
            alert("Packing List Saved Successfully.");
        }
    };

    const handleMakeInvoice = async () => {
        if (!selectedCustomerId) return;
        const success = await saveToDatabase(selectedCustomerId);
        if (success) {
            setShowInvoiceModal(false);
            // Reset Form
            setItems([]);
            setBookingNumber('');
            setPendingFiles([]);
            setSelectedCustomerId('');
            alert("Invoice and Packing List Created Successfully.");
        }
    };


    // --- Export Functions ---

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
        const headers = ['Product Desc', 'Container No.', 'Seal No.', 'Gross Wt (lbs)', 'Net Wt (lbs)', 'Gross Wt (kg)', 'Net Wt (kg)', 'Volumes', 'Supplier', 'BL Number'];
        const rows = items.map(item => [
            item.description, item.containerNo, item.sealNo, item.grossLbs, item.netLbs, item.grossKg, item.netKg, item.volumes, item.supplier, item.blNumber
        ]);
        rows.push(['TOTALS', '', '', totals.grossLbs, totals.netLbs, totals.grossKg, totals.netKg, totals.volumes, '', '']);
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
        
        const tableBody = items.map(item => [
            item.description,
            item.containerNo,
            item.sealNo,
            item.grossLbs.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}),
            item.netLbs.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}),
            item.grossKg.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}),
            item.netKg.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}),
            item.volumes,
            item.supplier,
            item.blNumber
        ]);

        tableBody.push([
            'TOTALS', '', '',
            totals.grossLbs.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}),
            totals.netLbs.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}),
            totals.grossKg.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}),
            totals.netKg.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}),
            totals.volumes.toLocaleString(),
            '', ''
        ]);

        autoTable(doc, {
            head: [['Product Desc', 'Container No.', 'Seal No.', 'Gross Wt (lbs)', 'Net Wt (lbs)', 'Gross Wt (kg)', 'Net Wt (kg)', 'Volumes', 'Supplier', 'BL Number']],
            body: tableBody,
            startY: 25,
            theme: 'grid',
            headStyles: { fillColor: [41, 128, 185], fontSize: 8 },
            bodyStyles: { fontSize: 8 },
            footStyles: { fillColor: [240, 240, 240], textColor: [0,0,0], fontStyle: 'bold' }
        });

        doc.save(`Resume_Product_${bookingNumber || 'Draft'}.pdf`);
    };

    const exportContainerPDF = () => {
        const doc = new jsPDF('l', 'mm', 'a4');
        doc.setFontSize(14);
        doc.text(`Resume per Container - Booking: ${bookingNumber}`, 14, 15);
        const containerBody = containerSummary.map(c => [
            c.containerNo,
            c.sealNo,
            c.grossLbs.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}),
            c.netLbs.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}),
            c.grossKg.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}),
            c.netKg.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}),
            c.volumes
        ]);
        
        containerBody.push([
            'TOTALS', '',
            totals.grossLbs.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}),
            totals.netLbs.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}),
            totals.grossKg.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}),
            totals.netKg.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}),
            totals.volumes.toLocaleString()
        ]);

        autoTable(doc, {
            head: [['Container No.', 'Seal No.', 'Gross Wt (lbs)', 'Net Wt (lbs)', 'Gross Wt (kg)', 'Net Wt (kg)', 'Volumes']],
            body: containerBody,
            startY: 25,
            theme: 'grid',
            headStyles: { fillColor: [46, 204, 113], fontSize: 8 },
            bodyStyles: { fontSize: 8 },
            footStyles: { fillColor: [240, 240, 240], textColor: [0,0,0], fontStyle: 'bold' }
        });

        doc.save(`Resume_Container_${bookingNumber || 'Draft'}.pdf`);
    };

    const renderStatusIcon = (status: 'idle' | 'processing' | 'completed' | 'error') => {
        switch (status) {
            case 'processing': return <Loader2 size={16} className="text-blue-500 animate-spin" />;
            case 'completed': return <CheckCircle2 size={16} className="text-emerald-500" />;
            case 'error': return <AlertCircle size={16} className="text-red-500" />;
            default: return <Clock size={16} className="text-slate-400" />;
        }
    };

    return (
        <div className="h-full flex flex-col p-6 space-y-6 overflow-y-auto custom-scrollbar bg-slate-50 relative">
            <div className="mb-6 flex items-start justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-r from-rose-500 to-pink-500 rounded-xl text-white"><FileText size={24} /></div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">Add Loading Documents</h1>
                        <p className="text-slate-500 text-sm mt-1">Upload Packing Lists (PDF, Images)</p>
                    </div>
                </div>
            </div>

            {/* Upload Window (Drop Zone) */}
            <div 
                className={`bg-white border-2 border-dashed rounded-xl p-6 transition-all ${isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 hover:border-indigo-400'}`}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
            >
                <div className="flex flex-col items-center justify-center text-center">
                    {pendingFiles.length === 0 ? (
                        <>
                            <div className="bg-indigo-50 p-3 rounded-full mb-3">
                                <UploadCloud className="text-indigo-600" size={24} />
                            </div>
                            <p className="text-sm font-bold text-slate-700">Drag & drop Packing Lists here</p>
                            <p className="text-xs text-slate-500 mb-4">or click to browse files</p>
                            <button 
                                onClick={() => fileInputRef.current?.click()}
                                className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-indigo-700 transition-colors shadow-sm"
                            >
                                Browse Files
                            </button>
                        </>
                    ) : (
                        <div className="w-full">
                            <div className="flex justify-between items-center mb-3">
                                <h3 className="text-sm font-bold text-slate-700 text-left flex items-center gap-2">
                                    <List size={16}/> {pendingFiles.length} File{pendingFiles.length > 1 ? 's' : ''} in Queue
                                </h3>
                                <button 
                                    onClick={() => setPendingFiles([])}
                                    className="text-xs text-red-500 hover:underline"
                                    disabled={isProcessing}
                                >
                                    Clear All
                                </button>
                            </div>
                            <div className="grid grid-cols-1 gap-2 mb-4 max-h-48 overflow-y-auto custom-scrollbar">
                                {pendingFiles.map((item, idx) => (
                                    <div key={item.id} className="flex justify-between items-center p-2 bg-slate-50 border border-slate-100 rounded-lg text-left">
                                        <div className="flex items-center gap-3 overflow-hidden flex-1">
                                            {/* Status Icon */}
                                            <div className="shrink-0">
                                                {renderStatusIcon(item.status)}
                                            </div>
                                            
                                            {/* File Name */}
                                            <span className={`text-xs font-medium truncate flex-1 ${item.status === 'error' ? 'text-red-600' : 'text-slate-700'}`}>
                                                {item.file.name}
                                            </span>

                                            {/* Activity Text (Right side of name, before remove button) */}
                                            <span className={`text-[10px] whitespace-nowrap min-w-[60px] text-right mr-2 ${item.status === 'processing' ? 'text-blue-500 animate-pulse' : 'text-slate-400 capitalize'}`}>
                                                {item.status === 'processing' ? 'Analyzing...' : item.status}
                                            </span>
                                        </div>
                                        <button onClick={() => handleRemoveFile(item.id)} disabled={isProcessing} className="text-slate-400 hover:text-red-500 disabled:opacity-50"><X size={14}/></button>
                                    </div>
                                ))}
                            </div>
                            <div className="flex gap-3 justify-center">
                                <button 
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isProcessing}
                                    className="bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-bold hover:bg-slate-50 transition-colors disabled:opacity-50"
                                >
                                    Add More
                                </button>
                                <button 
                                    onClick={processQueue}
                                    disabled={isProcessing || pendingFiles.every(f => f.status === 'completed')}
                                    className="bg-indigo-600 text-white px-6 py-2 rounded-lg text-sm font-bold hover:bg-indigo-700 transition-colors shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isProcessing ? <Loader2 size={16} className="animate-spin"/> : <RefreshCw size={16}/>}
                                    Process Files
                                </button>
                            </div>
                        </div>
                    )}
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

            {/* Resume Editor Area */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col">
                {/* Header Input */}
                <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex items-center gap-4">
                    <label className="text-sm font-bold text-slate-700 whitespace-nowrap">Booking #</label>
                    <input 
                        className="border border-slate-300 rounded px-3 py-1.5 text-sm w-64 focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                        value={bookingNumber}
                        onChange={(e) => setBookingNumber(e.target.value)}
                        placeholder="Enter Booking Ref..."
                    />
                    {statusMessage && (
                        <div className="flex items-center gap-2 text-indigo-600 text-sm animate-pulse ml-auto">
                            <Loader2 size={14} className="animate-spin"/> {statusMessage}
                        </div>
                    )}
                </div>

                {/* Tables Container */}
                <div className="p-6 space-y-8 overflow-x-auto">
                    
                    {/* 1. Resume per product */}
                    <div>
                        <h3 className="font-bold text-slate-700 mb-3 uppercase text-xs tracking-wider flex items-center gap-2">
                            <List size={14}/> Resume per product
                        </h3>
                        <div className="border border-slate-200 rounded-lg overflow-hidden min-w-[1200px]">
                            <table className="w-full border-collapse text-sm text-left">
                                <thead className="bg-slate-100 text-xs font-bold text-slate-600 uppercase">
                                    <tr>
                                        <th className="p-3 border-r border-slate-200 min-w-[300px]">Product Desc</th>
                                        <th className="p-3 border-r border-slate-200 min-w-[110px]">Container No.</th>
                                        <th className="p-3 border-r border-slate-200 min-w-[60px]">Seal No.</th>
                                        <th className="p-3 border-r border-slate-200 min-w-[100px] text-right">Gross Wt (lbs)</th>
                                        <th className="p-3 border-r border-slate-200 min-w-[100px] text-right">Net Wt (lbs)</th>
                                        <th className="p-3 border-r border-slate-200 min-w-[100px] text-right">Gross Wt (kg)</th>
                                        <th className="p-3 border-r border-slate-200 min-w-[100px] text-right">Net Wt (kg)</th>
                                        <th className="p-3 border-r border-slate-200 min-w-[80px] text-center">Volumes</th>
                                        <th className="p-3 border-r border-slate-200 min-w-[150px]">Supplier</th>
                                        <th className="p-3 border-r border-slate-200 min-w-[100px]">BL Number</th>
                                        <th className="p-3 w-10 text-center"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {items.map((item) => (
                                        <tr key={item.id} className="hover:bg-blue-50/30 group">
                                            <td className="p-1 border-r border-slate-100"><input className="w-full bg-transparent px-2 py-1 outline-none" value={item.description} onChange={e => updateItem(item.id, 'description', e.target.value)} /></td>
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
                                            <td className="p-1 border-r border-slate-100"><input className="w-full bg-transparent px-2 py-1 outline-none" value={item.supplier} onChange={e => updateItem(item.id, 'supplier', e.target.value)} /></td>
                                            <td className="p-1 border-r border-slate-100"><input className="w-full bg-transparent px-2 py-1 outline-none font-mono" value={item.blNumber} onChange={e => updateItem(item.id, 'blNumber', e.target.value)} /></td>
                                            <td className="p-1 text-center"><button onClick={() => handleDeleteItem(item.id)} className="text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={14}/></button></td>
                                        </tr>
                                    ))}
                                    {items.length === 0 && (
                                        <tr className="bg-slate-50/50 border-t border-slate-200 border-dashed">
                                            <td colSpan={11} className="h-32 text-center text-slate-400 text-xs italic align-middle">
                                                No container data available. Add items above.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                                <tfoot className="bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-800">
                                    <tr>
                                        <td colSpan={3} className="p-3 border-r border-slate-200">TOTALS</td>
                                        <td className="p-3 text-right border-r border-slate-200 font-mono">{totals.grossLbs.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})}</td>
                                        <td className="p-3 text-right border-r border-slate-200 font-mono">{totals.netLbs.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})}</td>
                                        <td className="p-3 text-right border-r border-slate-200 font-mono">{totals.grossKg.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})}</td>
                                        <td className="p-3 text-right border-r border-slate-200 font-mono">{totals.netKg.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})}</td>
                                        <td className="p-3 text-center border-r border-slate-200 font-mono">{totals.volumes}</td>
                                        <td colSpan={3} className="p-3 bg-slate-50"></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>

                    {/* 2. Resume per container */}
                    <div>
                        <h3 className="font-bold text-slate-700 mb-3 uppercase text-xs tracking-wider flex items-center gap-2">
                            <Package size={14}/> Resume per container
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
                                            <td className="p-3 border-r border-slate-100 text-right font-mono">{container.grossLbs.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})}</td>
                                            <td className="p-3 border-r border-slate-100 text-right font-mono">{container.netLbs.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})}</td>
                                            <td className="p-3 border-r border-slate-100 text-right font-mono">{container.grossKg.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})}</td>
                                            <td className="p-3 border-r border-slate-100 text-right font-mono">{container.netKg.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})}</td>
                                            <td className="p-3 border-r border-slate-100 text-center font-mono">{container.volumes}</td>
                                        </tr>
                                    ))}
                                    {containerSummary.length === 0 && (
                                        <tr className="bg-slate-50/50 border-t border-slate-200 border-dashed">
                                            <td colSpan={7} className="h-32 text-center text-slate-400 text-xs italic align-middle">
                                                No container data available. Add items above.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                                <tfoot className="bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-800">
                                    <tr>
                                        <td colSpan={2} className="p-3 border-r border-slate-200">TOTALS</td>
                                        <td className="p-3 text-right border-r border-slate-200 font-mono">{totals.grossLbs.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})}</td>
                                        <td className="p-3 text-right border-r border-slate-200 font-mono">{totals.netLbs.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})}</td>
                                        <td className="p-3 text-right border-r border-slate-200 font-mono">{totals.grossKg.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})}</td>
                                        <td className="p-3 text-right border-r border-slate-200 font-mono">{totals.netKg.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1})}</td>
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
                                <List size={18} className="text-blue-600"/> Resume per Product
                            </h4>
                            <div className="flex gap-3">
                                <button 
                                    onClick={exportProductPDF} 
                                    className="flex-1 bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg font-bold text-sm hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
                                >
                                    <FileText size={16}/> PDF
                                </button>
                                <button 
                                    onClick={exportProductCSV} 
                                    className="flex-1 bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg font-bold text-sm hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
                                >
                                    <FileSpreadsheet size={16}/> Excel (.csv)
                                </button>
                            </div>
                        </div>
                        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col">
                            <h4 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                                <Package size={18} className="text-emerald-600"/> Resume per Container
                            </h4>
                            <div className="flex gap-3">
                                <button 
                                    onClick={exportContainerPDF} 
                                    className="flex-1 bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg font-bold text-sm hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
                                >
                                    <FileText size={16}/> PDF
                                </button>
                                <button 
                                    onClick={exportContainerCSV} 
                                    className="flex-1 bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg font-bold text-sm hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
                                >
                                    <FileSpreadsheet size={16}/> Excel (.csv)
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* NEW ACTIONS SECTION */}
                    <div className="mt-8 flex flex-col md:flex-row gap-6 justify-center">
                        <button
                            onClick={() => handleSaveAndExit()}
                            disabled={isSaving || items.length === 0}
                            className="bg-slate-800 hover:bg-slate-900 text-white px-8 py-4 rounded-xl font-bold text-lg shadow-lg flex items-center gap-3 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed min-w-[200px] justify-center"
                        >
                            {isSaving ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
                            SAVE AND EXIT
                        </button>

                        <button
                            onClick={() => setShowInvoiceModal(true)}
                            disabled={isSaving || items.length === 0}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-4 rounded-xl font-bold text-lg shadow-lg flex items-center gap-3 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed min-w-[200px] justify-center"
                        >
                            {isSaving ? <Loader2 size={20} className="animate-spin" /> : <FileCheck size={20} />}
                            MAKE INVOICE
                        </button>
                    </div>

                </div>
            </div>

            {/* Customer Selection Modal */}
            {showInvoiceModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                            <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                                <FileCheck size={20} className="text-emerald-600"/> Create Invoice
                            </h3>
                            <button onClick={() => setShowInvoiceModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">Select Customer</label>
                                <div className="relative">
                                    <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/>
                                    <select 
                                        className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none appearance-none cursor-pointer"
                                        value={selectedCustomerId}
                                        onChange={(e) => setSelectedCustomerId(e.target.value)}
                                    >
                                        <option value="">-- Choose a Customer --</option>
                                        {customers.map(c => (
                                            <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 text-xs text-blue-800">
                                <p className="font-bold mb-1">Invoice Generation</p>
                                <p>This will create a draft Invoice and Packing List record linked to the selected customer. You can edit pricing in the Finance module later.</p>
                            </div>
                            <button 
                                onClick={handleMakeInvoice}
                                disabled={!selectedCustomerId || isSaving}
                                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                            >
                                {isSaving ? <Loader2 size={18} className="animate-spin"/> : <ArrowRight size={18}/>}
                                Confirm & Create
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PLResume;