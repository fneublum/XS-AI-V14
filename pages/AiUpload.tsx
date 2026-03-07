import React, { useState, useRef, useEffect, useCallback } from 'react';
import { UploadCloud, FileText, X, Send, Sparkles, Loader2, AlertCircle, Image as ImageIcon, Trash2, Maximize2, CheckCircle2, AlertTriangle, Table, ScanEye, Tag, Anchor, ShieldCheck, MapPin, Ship, Package, Calendar, Save, FileCheck, ClipboardList, Receipt, ScrollText, Calculator, Clock, CreditCard, PenTool, ShoppingBag, FileCode, DollarSign, Bot, LogIn, Mail, Layers, Link2, RefreshCw, Eye, ChevronDown, ChevronUp } from 'lucide-react';
import { analyzeDocument } from '../services/geminiService';
import { BillOfLading, Booking, Estimate, ProformaInvoice, PurchaseOrderExtract, Invoice, PackingList, SupplierInvoice, Port } from '../types';
import { getSupabaseClient } from '../services/supabase';
import { loginFor, getAccountFor, loginRequest, initializeMsal } from "../services/smailAuth";
import { documentPipelineService, BatchFile, PipelineStats } from '../services/documentPipelineService';

const IDENTIFICATION_PROMPT = `Analyze the uploaded document image and classify it into exactly one of these categories:
- BILL OF LADING
- BOOKING
- ESTIMATE
- PROFORMA INVOICE
- PURCHASE ORDER
- INVOICE
- PACKING LIST
- OTHER

Classification Rules:
1. If the document title contains "Straight Bill of Lading" or "Short Form Straight Bill of Lading", classify it strictly as "PACKING LIST".
2. If the document is a standard "Bill of Lading" (negotiable, ocean, or multimodal) WITHOUT the word "Straight", classify it as "BILL OF LADING".
3. A distinct "Packing List" document is also classified as "PACKING LIST".

Return ONLY the category name. Do not add any explanation or punctuation.`;

// Prompt Map
const EXTRACTION_PROMPTS = {
    'BILL OF LADING': `Extract the following fields specifically for a BILL OF LADING document.
    Return a valid JSON object with the exact keys listed below. If a field is not found, return null.
    
    KEYS: DOC_NUMBER (B/L Number), SHIPPER, CONSIGNEE, NOTIFY, NUMBER_OF_ORIGINALS, PRODUCT_DESCRIPTION, MARKS_NUMBERS, CONTAINER, SEAL, PACKAGES, GROSS_WEIGHT, MEASUREMENT, VESSEL_VOYAGE, PORT_LOADING, PORT_DISCHARGE, PLACE_OF_ISSUE, PLACE_OF_RECEIPT, PLACE_OF_DELIVERY, SHIPPED_DATE, FREIGHT_PAYABLE, TERMS.`,

    'BOOKING': `Extract the following fields specifically for a SHIPPING BOOKING CONFIRMATION document.
    Return a valid JSON object with the exact keys listed below. If a field is not found, return null.
    
    KEYS:
    DOC_NUMBER: The Booking Number.
    CUSTOMER: Customer / Contact name.
    CARGO_AGENT: The Cargo Agent, Freight Forwarder, or Shipping Line name that issued this booking (e.g., MSC, OOCL, Maersk, APL, CMA CGM, Evergreen, etc.).
    VESSEL_VOYAGE: Vessel Name and Voyage Number.
    POL: Origin / Port of Loading.
    POD: Destination / Port of Discharge.
    EQUIPMENT: Equipment Type and Quantity (e.g., 1 x 40 HC).
    ETD: Estimated Time of Departure.
    ETA: Estimated Time of Arrival.
    CARGO_CUT_OFF: Cargo or Terminal Cut-Off date/time.
    VGM_CUT_OFF: VGM Cut-Off date/time.
    DRAFT_CUT_OFF: Documentation or SI Cut-Off date/time.
    FREE_TIME: Free Time / Detention / Demurrage terms (e.g. 14 Days Free).
    TERMINAL: Terminal Information / Pickup Location.`,

    'ESTIMATE': `Extract the following fields specifically for a PROFORMA INVOICE or ESTIMATE.
    Return a valid JSON object with the exact keys listed below. If a field is not found, return null.
    
    KEYS:
    DOC_NUMBER: The Proforma Invoice or Estimate Number.
    DATE: Date created or issued.
    SELLER_NAME: Seller / Issuer Name (e.g. EC4 ENTERPRISES).
    BUYER_NAME: Address / Recipient Name (e.g. Recircular...).
    SHIP_TO: Ship To address.
    PAY_TO: Bank Details / Payment Instructions (Bank Name, Swift, Account).
    PAYMENT_TERMS: Payment conditions (e.g. 10% to order).
    INCOTERM: Trade term (e.g. CFR MANAUS).
    ITEMS: Array of objects with { activity (description), qty (amount), rate (unit price), amount (total) }.
    SUBTOTAL: Sum of line items.
    TAX: Tax amount (0.00 if none).
    TOTAL_AMOUNT: Final Total.
    CURRENCY: Currency code (USD, EUR).
    ACCEPTED_BY: Name/Signature if signed.
    ACCEPTED_DATE: Date if signed.`,

    'PROFORMA INVOICE': `Extract the following fields specifically for a PROFORMA INVOICE or ESTIMATE.
    Return a valid JSON object with the exact keys listed below. If a field is not found, return null.
    
    KEYS:
    DOC_NUMBER: The Proforma Invoice or Estimate Number.
    DATE: Date created or issued.
    SELLER_NAME: Seller / Issuer Name (e.g. EC4 ENTERPRISES).
    BUYER_NAME: Address / Recipient Name (e.g. Recircular...).
    SHIP_TO: Ship To address.
    PAY_TO: Bank Details / Payment Instructions (Bank Name, Swift, Account).
    PAYMENT_TERMS: Payment conditions (e.g. 10% to order).
    INCOTERM: Trade term (e.g. CFR MANAUS).
    ITEMS: Array of objects with { activity (description), qty (amount), rate (unit price), amount (total) }.
    SUBTOTAL: Sum of line items.
    TAX: Tax amount (0.00 if none).
    TOTAL_AMOUNT: Final Total.
    CURRENCY: Currency code (USD, EUR).
    ACCEPTED_BY: Name/Signature if signed.
    ACCEPTED_DATE: Date if signed.`,

    'PURCHASE ORDER': `Extract the following fields specifically for a PURCHASE ORDER.
    Return a valid JSON object.
    
    KEYS:
    DOC_NUMBER: Purchase Order N° / PO Number.
    DATE: Date of issue.
    BUYER_NAME: Buyer Company Name.
    SELLER_NAME: Seller / Supplier Company Name.
    VENDOR_REF: Your References / Seller Reference.
    FOLDER_NUMBER: Folder Nbr / Internal Reference.
    PRODUCT_DESCRIPTION: Description of goods.
    QUANTITY: Total quantity.
    UNIT_OF_MEASURE: Unit (e.g. T, kg).
    UNIT_PRICE: Unit Price.
    LINE_TOTAL: Total USD for the line item.
    TOTAL_AMOUNT: Total Amount (e.g. Total CFR).
    CURRENCY: Currency code.
    INCOTERM: Terms and conditions / Incoterm.
    PAYMENT_TERMS: Payment terms.
    PORT_DISCHARGE: Port of Discharge / Final Destination.
    PACKING_INSTRUCTIONS: Packing details.
    SHIPMENT_INSTRUCTIONS: Shipment details.
    MARKINGS: Markings instructions.
    INSPECTION: Inspection details.
    ITEMS: JSON Array of objects { description, quantity, unit, unit_price, total }.`,

    'INVOICE': `Extract the following fields specifically for a COMMERCIAL INVOICE from a Supplier.
    Return a valid JSON object with the exact keys listed below. If a field is not found, return null.
    
    KEYS:
    INVOICE_NUMBER: The Invoice Number.
    INVOICE_DATE: The date of the invoice.
    SELLER_NAME: Shipper / Seller Name.
    SELLER_ADDRESS: Shipper / Seller Address.
    BUYER_NAME_ADDRESS: Sold To / Bill To Name and Address.
    SHIP_TO_ADDRESS: Ship To Address.
    PAYMENT_TERMS: Payment Terms (e.g. Net 30).
    INCOTERMS: Incoterms (e.g. CFR HCM Port).
    DATE_SHIPPED: Date of Order or Date Shipped.
    PO_NUMBER: Customer PO Number.
    CARRIER: Carrier or Shipped Via.
    TRANSPORT_ID: Car No / Container / BL Number.
    FREIGHT_TERMS: Freight Terms (e.g. Collect).
    ITEMS: Array of items { description, hs_code, quantity, unit_price, amount }.
    WEIGHT_GROSS: Gross Weight.
    WEIGHT_NET: Net Weight.
    WEIGHT_TARE: Tare Weight.
    TOTAL_QUANTITY: Total count (Bales/Cases).
    SUBTOTAL: Subtotal amount.
    TOTAL_AMOUNT: Total Due / Invoice Total.
    CURRENCY: Currency (e.g. USD).
    REMIT_TO_NAME: Remit To / Beneficiary Name.
    BANK_NAME: Intermediary/Beneficiary Bank Name.
    SWIFT_CODE: SWIFT/BIC Code.
    ROUTING_NUMBER: Routing Number (ABA).
    ACCOUNT_NUMBER: Account Number.`,

    'PACKING LIST': `Extract the following fields specifically for a PACKING LIST / STRAIGHT BILL OF LADING.
    Return a valid JSON object.
    
    KEYS:
    BL_NUMBER: Bill of Lading Number / Shipper's No.
    PL_NUMBER: Packing List Number.
    SHIPPER: Shipper / Seller Name and Address.
    CONSIGNEE: Consignee Name and Address.
    SHIPPING_POINT: Shipping Point or Location.
    DESTINATION: Destination / Delivery Address.
    DATE: Date issued or shipped.
    CARRIER: Carrier Name.
    CONTAINER_NUMBER: Container / Trailer / Car Number.
    SEAL_NUMBER: Seal Number.
    VESSEL_VOYAGE: Vessel Name and Voyage Number.
    PRODUCT_DESCRIPTION: Description of Goods.
    UNIT_COUNT: Units / Cases / Pallets / Bales count.
    UNIT_NUMBERS: Pallet / Bale Numbers.
    GROSS_WEIGHT: Gross Weight.
    NET_WEIGHT: Net Weight.
    FREIGHT_TERMS: Freight Terms.
    PO_NUMBER: Customer Order / P.O. Number.
    NOTES: Special Instructions / Lot Number / Mfg Week.
    SCH_SHIP_DATE: Scheduled Ship Date.`
};

interface ExtractedData {
    mergedData: any;
    completenessScore: number;
    validationResults: any;
}

interface AiUploadProps {
    onSaveBL?: (data: BillOfLading) => Promise<void> | void;
    onSaveBooking?: (data: Booking) => Promise<void> | void;
    onSaveEstimate?: (data: Estimate) => Promise<void> | void;
    onSaveProforma?: (data: ProformaInvoice) => Promise<void> | void;
    onSavePO?: (data: PurchaseOrderExtract) => Promise<void> | void;
    onSaveInvoice?: (data: Invoice) => Promise<void> | void;
    onSaveSupplierInvoice?: (data: SupplierInvoice) => Promise<void> | void;
    onSavePackingList?: (data: PackingList) => Promise<void> | void;
    currentCompanyId?: string;
    ports?: Port[];
}

const AiUpload: React.FC<AiUploadProps> = ({
    onSaveBL, onSaveBooking, onSaveEstimate, onSaveProforma, onSavePO, onSaveInvoice, onSaveSupplierInvoice, onSavePackingList,
    currentCompanyId, ports = []
}) => {
    const [file, setFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [analysis, setAnalysis] = useState<string>('');
    const [extractionResult, setExtractionResult] = useState<ExtractedData | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [customPrompt, setCustomPrompt] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [dragActive, setDragActive] = useState(false);
    const [savedSuccess, setSavedSuccess] = useState(false);

    // Doc Type Identification
    const [identifiedDocType, setIdentifiedDocType] = useState<string | null>(null);
    const [isIdentifying, setIsIdentifying] = useState(false);

    // Email Connection State
    const [isEmailConnected, setIsEmailConnected] = useState(true);
    const [showConnectModal, setShowConnectModal] = useState(false);

    // Batch Mode
    const [batchMode, setBatchMode] = useState(false);
    const [batchFiles, setBatchFiles] = useState<BatchFile[]>([]);
    const [batchStats, setBatchStats] = useState<PipelineStats>({ total: 0, completed: 0, failed: 0, duplicates: 0, needsReview: 0, processing: 0 });
    const [showBatchPanel, setShowBatchPanel] = useState(true);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const batchInputRef = useRef<HTMLInputElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const quickActions = [
        { label: "Summarize", prompt: "Summarize this document in 3-5 bullet points. Highlight key entities, dates, and amounts." },
        { label: "Identify Risks", prompt: "Analyze this document for potential risks, legal clauses, or unfavorable terms." },
        { label: "Translate to English", prompt: "Translate the key content of this document into English." }
    ];

    const processExtractionLogic = useCallback((jsonText: string) => {
        try {
            let cleanText = jsonText;
            if (cleanText.startsWith('"') && cleanText.includes('\\"')) {
                cleanText = cleanText.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '').replace(/\\\\/g, '\\').trim();
            }
            const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("No JSON found");
            const extractedData = JSON.parse(jsonMatch[0]);

            // Enhance with document type if missing
            if (!extractedData.DOC_TYPE && identifiedDocType) {
                extractedData.DOC_TYPE = identifiedDocType || 'UNKNOWN';
            }

            return { mergedData: extractedData, completenessScore: 5, validationResults: {} };
        } catch (error: any) {
            const errMsg = error?.message || String(error);
            console.error("Extraction Parsing Error", errMsg);
            return null;
        }
    }, [identifiedDocType]);

    const identifyDocumentType = useCallback(async (base64Data: string, mimeType: string) => {
        setIsIdentifying(true);
        try {
            const resultRaw = await analyzeDocument(base64Data, mimeType, IDENTIFICATION_PROMPT);
            const resultStr = String(resultRaw);
            const type = resultStr.replace(/[\*\"]/g, '').trim().toUpperCase();
            setIdentifiedDocType(type);
        } catch (error: any) {
            console.error("Failed to identify document type", error?.message || String(error));
            setIdentifiedDocType("UNKNOWN");
        } finally {
            setIsIdentifying(false);
        }
    }, []);

    const runAnalysis = useCallback(async (promptText: string) => {
        if (!file || !previewUrl) return;

        setIsProcessing(true);
        setError(null);
        setSavedSuccess(false);

        const isExtractionRequest = promptText.includes("Extract the following");
        if (isExtractionRequest) {
            setExtractionResult(null);
            setAnalysis('');
        }

        try {
            const base64Data = previewUrl.split(',')[1];
            if (!base64Data) throw new Error("Invalid base64 data");

            const fType = file ? file.type : 'application/pdf';
            const rawResult = await analyzeDocument(base64Data, fType, promptText);
            // FIX: Argument of type 'unknown' is not assignable to parameter of type 'string'.
            const analysisResult = String(rawResult ?? '');

            if (isExtractionRequest) {
                const processed = processExtractionLogic(analysisResult);

                if (processed) {
                    setExtractionResult(processed);
                    setAnalysis('');
                } else {
                    setAnalysis(`Failed to parse extraction. Raw output:\n${analysisResult}`);
                }
            } else {
                setAnalysis(prev => prev ? `${prev}\n\n---\n\n**Q:** ${promptText}\n**A:** ${analysisResult}` : `**A:** ${analysisResult}`);
            }
        } catch (err: any) {
            setError("Failed to process document.");
            console.error(err);
        } finally {
            setIsProcessing(false);
            setCustomPrompt('');
        }
    }, [file, previewUrl, processExtractionLogic]);

    useEffect(() => {
        const init = async () => {
            await initializeMsal();
            checkEmailConnection();
        };
        init();
    }, []);

    // Auto-scroll to bottom of analysis
    useEffect(() => {
        if ((analysis || extractionResult) && messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [analysis, extractionResult]);

    // Automatic Extraction Trigger
    useEffect(() => {
        if (identifiedDocType && !extractionResult && !isProcessing && file) {
            // Find matching prompt
            const prompt = EXTRACTION_PROMPTS[identifiedDocType as keyof typeof EXTRACTION_PROMPTS];
            if (prompt) {
                runAnalysis(prompt);
            }
        }
    }, [identifiedDocType, file, extractionResult, isProcessing, runAnalysis]);

    // Automatic Save Trigger
    useEffect(() => {
        if (extractionResult && !savedSuccess && !isProcessing) {
            handleAutoSave();
        }
    }, [extractionResult, isProcessing]);

    // Subscribe to batch pipeline updates
    useEffect(() => {
        const unsubscribe = documentPipelineService.subscribe((files, stats) => {
            setBatchFiles(files);
            setBatchStats(stats);
        });
        return unsubscribe;
    }, []);

    const handleBatchFiles = useCallback(async (files: FileList | File[]) => {
        const fileArray = Array.from(files);
        if (fileArray.length > 1 || batchMode) {
            setBatchMode(true);
            setShowBatchPanel(true);
            await documentPipelineService.addFiles(fileArray);
        } else if (fileArray.length === 1) {
            handleFile(fileArray[0]);
        }
    }, [batchMode]);

    const handleBatchSave = useCallback(async (type: string, data: any, previewUrl: string) => {
        const companyId = currentCompanyId || 'ALL';
        const created = new Date().toISOString();
        // Reuse existing save callbacks
        if (type === 'BILL OF LADING' && onSaveBL) {
            await onSaveBL({ id: `BL${Date.now()}`, companyId, createdAt: created, blNumber: String(data.DOC_NUMBER || ''), shipper: String(data.SHIPPER || ''), consignee: String(data.CONSIGNEE || ''), notifyParty: String(data.NOTIFY || ''), vesselVoyage: String(data.VESSEL_VOYAGE || ''), portLoading: String(data.PORT_LOADING || ''), portDischarge: String(data.PORT_DISCHARGE || ''), placeReceipt: String(data.PLACE_OF_RECEIPT || ''), placeDelivery: String(data.PLACE_OF_DELIVERY || ''), shippedDate: String(data.SHIPPED_DATE || ''), originals: String(data.NUMBER_OF_ORIGINALS || ''), container: String(data.CONTAINER || ''), seal: String(data.SEAL || ''), description: String(data.PRODUCT_DESCRIPTION || ''), grossWeight: String(data.GROSS_WEIGHT || ''), measurement: String(data.MEASUREMENT || ''), packages: String(data.PACKAGES || ''), freightPayable: String(data.FREIGHT_PAYABLE || ''), remarks: String(data.TERMS || ''), originalDocument: previewUrl, status: 'AVAILABLE' });
        } else if (type === 'BOOKING' && onSaveBooking) {
            await onSaveBooking({ id: `BK${Date.now()}`, companyId, createdAt: created, bookingNumber: String(data.DOC_NUMBER || ''), customer: String(data.CUSTOMER || ''), agentName: String(data.CARGO_AGENT || ''), vesselVoyage: String(data.VESSEL_VOYAGE || ''), pol: String(data.POL || ''), pod: String(data.POD || ''), equipment: String(data.EQUIPMENT || ''), etd: String(data.ETD || ''), eta: String(data.ETA || ''), cargoCutOff: String(data.CARGO_CUT_OFF || ''), vgmCutOff: String(data.VGM_CUT_OFF || ''), draftCutOff: String(data.DRAFT_CUT_OFF || ''), freeTime: String(data.FREE_TIME || ''), terminal: String(data.TERMINAL || ''), originalDocument: previewUrl, status: 'AVAILABLE' });
        } else if ((type === 'ESTIMATE') && onSaveEstimate) {
            await onSaveEstimate({ id: `EST${Date.now()}`, companyId, createdAt: created, estimateNumber: String(data.DOC_NUMBER || ''), supplier: String(data.SELLER_NAME || ''), buyer: String(data.BUYER_NAME || ''), shipTo: String(data.SHIP_TO || ''), payTo: String(data.PAY_TO || ''), date: String(data.DATE || ''), terms: String(data.PAYMENT_TERMS || ''), incoterm: String(data.INCOTERM || ''), subtotal: Number(data.SUBTOTAL || 0), tax: Number(data.TAX || 0), totalAmount: Number(data.TOTAL_AMOUNT || 0), currency: String(data.CURRENCY || 'USD'), items: JSON.stringify(data.ITEMS || []), acceptedBy: String(data.ACCEPTED_BY || ''), acceptedDate: String(data.ACCEPTED_DATE || ''), originalDocument: previewUrl });
        } else if (type === 'PROFORMA INVOICE' && onSaveProforma) {
            await onSaveProforma({ id: `PI${Date.now()}`, companyId, createdAt: created, piNumber: String(data.DOC_NUMBER || ''), supplier: String(data.SELLER_NAME || ''), buyer: String(data.BUYER_NAME || ''), shipTo: String(data.SHIP_TO || ''), payTo: String(data.PAY_TO || ''), date: String(data.DATE || ''), terms: String(data.PAYMENT_TERMS || ''), incoterm: String(data.INCOTERM || ''), subtotal: Number(data.SUBTOTAL || 0), tax: Number(data.TAX || 0), totalAmount: Number(data.TOTAL_AMOUNT || 0), currency: String(data.CURRENCY || 'USD'), items: JSON.stringify(data.ITEMS || []), acceptedBy: String(data.ACCEPTED_BY || ''), acceptedDate: String(data.ACCEPTED_DATE || ''), originalDocument: previewUrl });
        } else if (type === 'PURCHASE ORDER' && onSavePO) {
            await onSavePO({ id: `PO${Date.now()}`, companyId, createdAt: created, poNumber: String(data.DOC_NUMBER || ''), vendor: String(data.SELLER_NAME || data.VENDOR_NAME || ''), date: String(data.DATE || ''), totalAmount: String(data.TOTAL_AMOUNT || ''), currency: String(data.CURRENCY || ''), items: JSON.stringify(data.ITEMS || []), originalDocument: previewUrl });
        } else if (type === 'INVOICE' && onSaveSupplierInvoice) {
            await onSaveSupplierInvoice({ id: `INV${Date.now()}`, companyId, createdAt: created, invoiceNumber: String(data.INVOICE_NUMBER || ''), invoiceDate: String(data.INVOICE_DATE || ''), shipperName: String(data.SELLER_NAME || ''), shipperAddress: String(data.SELLER_ADDRESS || ''), soldTo: String(data.BUYER_NAME_ADDRESS || ''), shipTo: String(data.SHIP_TO_ADDRESS || ''), paymentTerms: String(data.PAYMENT_TERMS || ''), incoterm: String(data.INCOTERMS || ''), dateOrder: String(data.DATE_SHIPPED || ''), customerPo: String(data.PO_NUMBER || ''), carrier: String(data.CARRIER || ''), transportRef: String(data.TRANSPORT_ID || ''), freightTerms: String(data.FREIGHT_TERMS || ''), items: JSON.stringify(data.ITEMS || []), grossWeight: String(data.WEIGHT_GROSS || ''), netWeight: String(data.WEIGHT_NET || ''), tareWeight: String(data.WEIGHT_TARE || ''), totalQuantity: String(data.TOTAL_QUANTITY || ''), subtotal: Number(data.SUBTOTAL || 0), totalAmount: Number(data.TOTAL_AMOUNT || 0), currency: String(data.CURRENCY || 'USD'), remitTo: String(data.REMIT_TO_NAME || ''), bankName: String(data.BANK_NAME || ''), swiftCode: String(data.SWIFT_CODE || ''), routingNumber: String(data.ROUTING_NUMBER || ''), accountNumber: String(data.ACCOUNT_NUMBER || ''), originalDocument: previewUrl });
        } else if (type === 'PACKING LIST' && onSavePackingList) {
            await onSavePackingList({ id: `PL${Date.now()}`, companyId, createdAt: created, plNumber: String(data.PL_NUMBER || ''), blNumber: String(data.BL_NUMBER || ''), shipper: String(data.SHIPPER || ''), consignee: String(data.CONSIGNEE || ''), shippingPoint: String(data.SHIPPING_POINT || ''), destination: String(data.DESTINATION || ''), date: String(data.DATE || ''), carrier: String(data.CARRIER || ''), containerNumber: String(data.CONTAINER_NUMBER || ''), sealNumber: String(data.SEAL_NUMBER || ''), vesselVoyage: String(data.VESSEL_VOYAGE || ''), productDescription: String(data.PRODUCT_DESCRIPTION || ''), unitCount: String(data.UNIT_COUNT || ''), unitNumbers: String(data.UNIT_NUMBERS || ''), grossWeight: String(data.GROSS_WEIGHT || ''), netWeight: String(data.NET_WEIGHT || ''), freightTerms: String(data.FREIGHT_TERMS || ''), poNumber: String(data.PO_NUMBER || ''), notes: String(data.NOTES || ''), scheduledShipDate: String(data.SCH_SHIP_DATE || ''), items: JSON.stringify(data.ITEMS || []), originalDocument: previewUrl });
        }
    }, [currentCompanyId, onSaveBL, onSaveBooking, onSaveEstimate, onSaveProforma, onSavePO, onSaveSupplierInvoice, onSavePackingList]);

    const checkEmailConnection = () => {
        const msalAccount = getAccountFor('automation');
        setIsEmailConnected(!!msalAccount);
    };

    const handleConnectOutlook = async () => {
        try {
            await loginFor('automation', loginRequest.scopes);
            checkEmailConnection();
        } catch (e: any) {
            console.error("Login failed", e);
        }
    };

    const handleFile = (selectedFile: File) => {
        const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain'];
        if (!validTypes.includes(selectedFile.type)) {
            setError("Unsupported file type. Please upload PDF, JPEG, PNG, or Text.");
            return;
        }
        if (selectedFile.size > 10 * 1024 * 1024) {
            setError("File size exceeds 10MB limit.");
            return;
        }

        setFile(selectedFile);
        setError(null);
        setAnalysis('');
        setExtractionResult(null);
        setCustomPrompt('');
        setIdentifiedDocType(null);
        setSavedSuccess(false);

        const reader = new FileReader();
        reader.onload = (e) => {
            const result = e.target?.result as string;
            if (result) {
                setPreviewUrl(result);
                const parts = result.split(',');
                if (parts.length > 1) {
                    const base64Data = parts[1];
                    identifyDocumentType(base64Data, selectedFile.type);
                }
            }
        };
        reader.readAsDataURL(selectedFile);
    };

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
        else if (e.type === "dragleave") setDragActive(false);
    };
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation(); setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 1) {
            handleBatchFiles(e.dataTransfer.files);
        } else if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            if (batchMode) {
                handleBatchFiles(e.dataTransfer.files);
            } else {
                handleFile(e.dataTransfer.files[0]);
            }
        }
    };
    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 1) {
            handleBatchFiles(e.target.files);
        } else if (e.target.files && e.target.files.length > 0) {
            if (batchMode) {
                handleBatchFiles(e.target.files);
            } else {
                handleFile(e.target.files[0]);
            }
        }
    };
    const handleRemoveFile = () => {
        setFile(null); setPreviewUrl(null); setAnalysis(''); setExtractionResult(null); setIdentifiedDocType(null); setError(null); setSavedSuccess(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const normalizePort = useCallback((rawInput: any): string => {
        const raw = String(rawInput || '');
        if (!raw) return '';
        if (!ports || ports.length === 0) return raw;

        const cleanRaw = raw.toUpperCase().trim();

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

            // 1. Code Match
            if (inputTokens.has(pCode)) {
                score += 200; // High confidence
            }

            // 2. Name Match (token-based)
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
    }, [ports]);

    const handleAutoSave = useCallback(async () => {
        if (!extractionResult || savedSuccess) return;
        const data = extractionResult.mergedData as any;
        const type = identifiedDocType;
        const companyId = currentCompanyId || 'ALL';
        const created = new Date().toISOString();
        const client = getSupabaseClient();

        try {
            if (type === 'BILL OF LADING' && onSaveBL) {
                const pol = normalizePort(String(data.PORT_LOADING || ''));
                const pod = normalizePort(String(data.PORT_DISCHARGE || ''));

                const blData: BillOfLading = {
                    id: `BL${Date.now()}`, companyId, createdAt: created,
                    blNumber: String(data.DOC_NUMBER || ''),
                    shipper: String(data.SHIPPER || ''),
                    consignee: String(data.CONSIGNEE || ''),
                    notifyParty: String(data.NOTIFY || ''),
                    vesselVoyage: String(data.VESSEL_VOYAGE || ''),
                    portLoading: pol,
                    portDischarge: pod,
                    placeReceipt: String(data.PLACE_OF_RECEIPT || ''),
                    placeDelivery: String(data.PLACE_OF_DELIVERY || ''),
                    shippedDate: String(data.SHIPPED_DATE || ''),
                    originals: String(data.NUMBER_OF_ORIGINALS || ''),
                    container: String(data.CONTAINER || ''),
                    seal: String(data.SEAL || ''),
                    description: String(data.PRODUCT_DESCRIPTION || ''),
                    grossWeight: String(data.GROSS_WEIGHT || ''),
                    measurement: String(data.MEASUREMENT || ''),
                    packages: String(data.PACKAGES || ''),
                    freightPayable: String(data.FREIGHT_PAYABLE || ''),
                    remarks: String(data.TERMS || ''),
                    originalDocument: previewUrl || '',
                    status: 'AVAILABLE'
                };

                await onSaveBL(blData);

                // Update corresponding booking to 'AVAILABLE'
                if (client && blData.vesselVoyage && blData.consignee) {
                    const { data: bookings, error: fetchError } = await client.from('bookings').select('id, bookingNumber, salesOrderId, customer, status')

                        .eq('vesselVoyage', blData.vesselVoyage)
                        .or('status.eq.ACTIVE,status.eq.REQUESTED');

                    if (fetchError) {
                        console.error("Error fetching bookings to update:", fetchError);
                    } else if (bookings) {
                        // Fuzzy match consignee on B/L with customer on booking
                        const matchingBooking = bookings.find(b =>
                            b.customer && blData.consignee.toLowerCase().includes(b.customer.toLowerCase())
                        );

                        if (matchingBooking) {
                            const { error: updateError } = await client.from('bookings')
                                .update({ status: 'AVAILABLE' })
                                .eq('id', matchingBooking.id);

                            if (updateError) {
                                console.error('Failed to update booking status:', updateError);
                            } else {
                                console.log(`Booking ${matchingBooking.bookingNumber} status updated to AVAILABLE.`);
                            }
                        }
                    }
                }
            } else if (type === 'BOOKING' && onSaveBooking) {
                const pol = normalizePort(String(data.POL || ''));
                const pod = normalizePort(String(data.POD || ''));

                await onSaveBooking({
                    id: `BK${Date.now()}`, companyId, createdAt: created,
                    bookingNumber: String(data.DOC_NUMBER || ''),
                    customer: String(data.CUSTOMER || ''),
                    agentName: String(data.CARGO_AGENT || ''),
                    vesselVoyage: String(data.VESSEL_VOYAGE || ''),
                    pol: pol,
                    pod: pod,
                    equipment: String(data.EQUIPMENT || ''),
                    etd: String(data.ETD || ''),
                    eta: String(data.ETA || ''),
                    cargoCutOff: String(data.CARGO_CUT_OFF || ''),
                    vgmCutOff: String(data.VGM_CUT_OFF || ''),
                    draftCutOff: String(data.DRAFT_CUT_OFF || ''),
                    freeTime: String(data.FREE_TIME || ''),
                    terminal: String(data.TERMINAL || ''),
                    originalDocument: previewUrl || '',
                    status: 'AVAILABLE'
                });
            } else if (type === 'ESTIMATE' && onSaveEstimate) {
                await onSaveEstimate({
                    id: `EST${Date.now()}`, companyId, createdAt: created,
                    estimateNumber: String(data.DOC_NUMBER || ''),
                    supplier: String(data.SELLER_NAME || ''),
                    buyer: String(data.BUYER_NAME || ''),
                    shipTo: String(data.SHIP_TO || ''),
                    payTo: String(data.PAY_TO || ''),
                    date: String(data.DATE || ''),
                    terms: String(data.PAYMENT_TERMS || ''),
                    incoterm: String(data.INCOTERM || ''),
                    subtotal: Number(data.SUBTOTAL || 0),
                    tax: Number(data.TAX || 0),
                    totalAmount: Number(data.TOTAL_AMOUNT || 0),
                    currency: String(data.CURRENCY || 'USD'),
                    items: JSON.stringify(data.ITEMS || []),
                    acceptedBy: String(data.ACCEPTED_BY || ''),
                    acceptedDate: String(data.ACCEPTED_DATE || ''),
                    originalDocument: previewUrl || ''
                });
            } else if (type === 'PROFORMA INVOICE' && onSaveProforma) {
                await onSaveProforma({
                    id: `PI${Date.now()}`, companyId, createdAt: created,
                    piNumber: String(data.DOC_NUMBER || ''),
                    supplier: String(data.SELLER_NAME || ''),
                    buyer: String(data.BUYER_NAME || ''),
                    shipTo: String(data.SHIP_TO || ''),
                    payTo: String(data.PAY_TO || ''),
                    date: String(data.DATE || ''),
                    terms: String(data.PAYMENT_TERMS || ''),
                    incoterm: String(data.INCOTERM || ''),
                    subtotal: Number(data.SUBTOTAL || 0),
                    tax: Number(data.TAX || 0),
                    totalAmount: Number(data.TOTAL_AMOUNT || 0),
                    currency: String(data.CURRENCY || 'USD'),
                    items: JSON.stringify(data.ITEMS || []),
                    acceptedBy: String(data.ACCEPTED_BY || ''),
                    acceptedDate: String(data.ACCEPTED_DATE || ''),
                    originalDocument: previewUrl || ''
                });
            } else if (type === 'PURCHASE ORDER' && onSavePO) {
                await onSavePO({
                    id: `PO${Date.now()}`,
                    companyId,
                    createdAt: created,
                    poNumber: String(data.DOC_NUMBER || ''),
                    vendor: String(data.SELLER_NAME || data.VENDOR_NAME || ''),
                    date: String(data.DATE || ''),
                    totalAmount: String(data.TOTAL_AMOUNT || ''),
                    currency: String(data.CURRENCY || ''),
                    items: JSON.stringify(data.ITEMS || []),
                    originalDocument: previewUrl || ''
                });
            } else if (type === 'INVOICE' && onSaveSupplierInvoice) {
                await onSaveSupplierInvoice({
                    id: `INV${Date.now()}`,
                    companyId,
                    createdAt: created,
                    invoiceNumber: `${data.INVOICE_NUMBER || ''}`,
                    invoiceDate: `${data.INVOICE_DATE || ''}`,
                    shipperName: `${data.SELLER_NAME || ''}`,
                    shipperAddress: `${data.SELLER_ADDRESS || ''}`,
                    soldTo: `${data.BUYER_NAME_ADDRESS || ''}`,
                    shipTo: `${data.SHIP_TO_ADDRESS || ''}`,
                    paymentTerms: `${data.PAYMENT_TERMS || ''}`,
                    incoterm: `${data.INCOTERMS || ''}`,
                    dateOrder: `${data.DATE_SHIPPED || ''}`,
                    customerPo: `${data.PO_NUMBER || ''}`,
                    carrier: `${data.CARRIER || ''}`,
                    transportRef: `${data.TRANSPORT_ID || ''}`,
                    freightTerms: `${data.FREIGHT_TERMS || ''}`,
                    items: JSON.stringify(data.ITEMS || []),
                    grossWeight: `${data.WEIGHT_GROSS || ''}`,
                    netWeight: `${data.WEIGHT_NET || ''}`,
                    tareWeight: `${data.WEIGHT_TARE || ''}`,
                    totalQuantity: `${data.TOTAL_QUANTITY || ''}`,
                    subtotal: Number(data.SUBTOTAL || 0),
                    totalAmount: Number(data.TOTAL_AMOUNT || 0),
                    currency: `${data.CURRENCY || 'USD'}`,
                    remitTo: `${data.REMIT_TO_NAME || ''}`,
                    bankName: `${data.BANK_NAME || ''}`,
                    swiftCode: `${data.SWIFT_CODE || ''}`,
                    routingNumber: `${data.ROUTING_NUMBER || ''}`,
                    accountNumber: `${data.ACCOUNT_NUMBER || ''}`,
                    originalDocument: previewUrl || ''
                });
            } else if (type === 'PACKING LIST' && onSavePackingList) {
                await onSavePackingList({
                    id: `PL${Date.now()}`,
                    companyId,
                    createdAt: created,
                    plNumber: String(data.PL_NUMBER || ''),
                    blNumber: String(data.BL_NUMBER || ''),
                    shipper: String(data.SHIPPER || ''),
                    consignee: String(data.CONSIGNEE || ''),
                    shippingPoint: String(data.SHIPPING_POINT || ''),
                    destination: String(data.DESTINATION || ''),
                    date: String(data.DATE || ''),
                    carrier: String(data.CARRIER || ''),
                    containerNumber: String(data.CONTAINER_NUMBER || ''),
                    sealNumber: String(data.SEAL_NUMBER || ''),
                    vesselVoyage: String(data.VESSEL_VOYAGE || ''),
                    productDescription: String(data.PRODUCT_DESCRIPTION || ''),
                    unitCount: String(data.UNIT_COUNT || ''),
                    unitNumbers: String(data.UNIT_NUMBERS || ''),
                    grossWeight: String(data.GROSS_WEIGHT || ''),
                    netWeight: String(data.NET_WEIGHT || ''),
                    freightTerms: String(data.FREIGHT_TERMS || ''),
                    poNumber: String(data.PO_NUMBER || ''),
                    notes: String(data.NOTES || ''),
                    scheduledShipDate: String(data.SCH_SHIP_DATE || ''),
                    items: JSON.stringify(data.ITEMS || []),
                    originalDocument: previewUrl || ''
                });
            }
            setSavedSuccess(true);
        } catch (err: any) {
            console.error("Auto-save failed", err);
            const msg = err instanceof Error ? err.message : String(err);
            setError(`Failed to save to database: ${msg}`);
        }
    }, [extractionResult, savedSuccess, identifiedDocType, currentCompanyId, previewUrl, onSaveBL, onSaveBooking, onSaveEstimate, onSaveProforma, onSavePO, onSaveSupplierInvoice, onSavePackingList, normalizePort]);

    const getSafeValue = (value: any, defaultValue = 'N/A') => (!value || value === 'null' || value === 'N/A' || value === 'Unknown') ? defaultValue : value;

    const renderExtractedView = () => {
        if (!extractionResult) return null;
        const data = extractionResult.mergedData;
        const type = identifiedDocType;

        const InfoField = ({ icon: Icon, label, value }: { icon: any, label: string, value: any }) => (
            <div className="border-b border-slate-100 pb-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase mb-1 flex items-center gap-1"><Icon size={12} /> {label}</p>
                <p className="font-medium text-slate-800 text-xs break-words">{getSafeValue(value)}</p>
            </div>
        );

        const ItemsTable = ({ items }: { items: any[] }) => (
            <div className="border border-slate-200 rounded-lg overflow-hidden mt-3">
                <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500"><tr><th className="p-2">Desc.</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Rate</th><th className="p-2 text-right">Amount</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                        {items.map((item, idx) => (
                            <tr key={idx}>
                                <td className="p-2 font-medium text-slate-700">{item.activity || item.description}</td>
                                <td className="p-2 text-right">{item.qty || item.quantity}</td>
                                <td className="p-2 text-right">{item.rate || item.unit_price}</td>
                                <td className="p-2 text-right font-bold">{item.amount || item.total}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );

        const commonFields = {
            'PO': { ref: data.DOC_NUMBER, date: data.DATE, supplier: data.SELLER_NAME, total: data.TOTAL_AMOUNT, currency: data.CURRENCY, terms: data.PAYMENT_TERMS },
            'ESTIMATE': { ref: data.DOC_NUMBER, date: data.DATE, supplier: data.SELLER_NAME, total: data.TOTAL_AMOUNT, currency: data.CURRENCY, terms: data.PAYMENT_TERMS },
            'PROFORMA INVOICE': { ref: data.DOC_NUMBER, date: data.DATE, supplier: data.SELLER_NAME, total: data.TOTAL_AMOUNT, currency: data.CURRENCY, terms: data.PAYMENT_TERMS },
            'INVOICE': { ref: data.INVOICE_NUMBER, date: data.INVOICE_DATE, supplier: data.SELLER_NAME, total: data.TOTAL_AMOUNT, currency: data.CURRENCY, terms: data.PAYMENT_TERMS },
            'PACKING LIST': { ref: data.PL_NUMBER || data.BL_NUMBER, date: data.DATE, shipper: data.SHIPPER, consignee: data.CONSIGNEE },
            'BOOKING': { ref: data.DOC_NUMBER, etd: data.ETD, eta: data.ETA, pol: data.POL, pod: data.POD },
            'BILL OF LADING': { ref: data.DOC_NUMBER, date: data.SHIPPED_DATE, shipper: data.SHIPPER, consignee: data.CONSIGNEE, pol: data.PORT_LOADING, pod: data.PORT_DISCHARGE },
        }[type!] || {};

        return (
            <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <InfoField icon={FileCode} label="Reference #" value={commonFields.ref} />
                    <InfoField icon={Calendar} label="Date" value={commonFields.date || commonFields.etd} />
                    {(commonFields.supplier || commonFields.shipper) && <InfoField icon={ShoppingBag} label="Supplier/Shipper" value={commonFields.supplier || commonFields.shipper} />}
                    {commonFields.consignee && <InfoField icon={Package} label="Consignee" value={commonFields.consignee} />}
                    {(commonFields.pol || commonFields.pod) && <InfoField icon={Anchor} label="Route" value={`${commonFields.pol || ''} → ${commonFields.pod || ''}`} />}
                    {(commonFields.total !== undefined) && <InfoField icon={DollarSign} label="Total Amount" value={`${commonFields.currency} ${Number(commonFields.total).toLocaleString()}`} />}
                    {commonFields.terms && <InfoField icon={Clock} label="Terms" value={commonFields.terms} />}
                </div>
                {(data.ITEMS || data.items) && Array.isArray(data.ITEMS || data.items) && <ItemsTable items={data.ITEMS || data.items} />}
                {/* Confidence Score */}
                {data.EXTRACTION_CONFIDENCE && (
                    <div className="mt-3 flex items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-500 uppercase">Confidence</span>
                        <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden max-w-[120px]">
                            <div className={`h-full rounded-full ${Number(data.EXTRACTION_CONFIDENCE) >= 0.85 ? 'bg-emerald-500' : Number(data.EXTRACTION_CONFIDENCE) >= 0.5 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Number(data.EXTRACTION_CONFIDENCE) * 100}%` }} />
                        </div>
                        <span className="text-[10px] font-bold text-slate-600">{Math.round(Number(data.EXTRACTION_CONFIDENCE) * 100)}%</span>
                    </div>
                )}
                {savedSuccess ? (
                    <div className="mt-4 flex items-center gap-2 text-emerald-600 font-bold text-xs bg-emerald-50 px-3 py-2 rounded-full border border-emerald-100 animate-in fade-in">
                        <CheckCircle2 size={14} /> Saved to {type} Documents
                    </div>
                ) : (
                    <div className="mt-4 flex items-center gap-2 text-slate-400 text-xs">
                        <Loader2 size={14} className="animate-spin" /> Saving document to database...
                    </div>
                )}
            </div>
        )
    };

    return (
        <div className="flex flex-col h-full bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden relative">
            {/* Email Connection Modal */}
            {showConnectModal && !isEmailConnected && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
                    <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95">
                        <div className="p-6 text-center">
                            <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
                                <Mail size={32} />
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 mb-2">Connect Automation Email</h3>
                            <p className="text-slate-500 text-sm mb-6">
                                Link Outlook to enable full automation features like Inbox Scanning and Agent Emails.
                            </p>

                            <div className="space-y-3">
                                <button
                                    onClick={handleConnectOutlook}
                                    className="w-full flex items-center justify-center gap-3 bg-[#2F2F2F] text-white px-6 py-3.5 rounded-lg text-base font-semibold hover:bg-[#1a1a1a] transition-colors shadow-md"
                                >
                                    <div className="grid grid-cols-2 gap-[2px]">
                                        <div className="w-2.5 h-2.5 bg-[#f35325]"></div>
                                        <div className="w-2.5 h-2.5 bg-[#81bc06]"></div>
                                        <div className="w-2.5 h-2.5 bg-[#05a6f0]"></div>
                                        <div className="w-2.5 h-2.5 bg-[#ffba08]"></div>
                                    </div>
                                    <span>Connect with Outlook</span>
                                </button>
                                <button
                                    onClick={() => setShowConnectModal(false)}
                                    className="w-full text-slate-400 text-xs hover:text-slate-600 font-medium"
                                >
                                    Continue without connecting
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="p-4 border-b border-slate-200 bg-slate-50 shrink-0">
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                        <div className="p-2 bg-gradient-to-r from-rose-500 to-pink-500 rounded-xl text-white"><Sparkles size={24} /></div>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-800">AI Document Processor</h1>
                            <p className="text-slate-500 text-sm mt-1">Powered by Gemini Pro (Latest)</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => { setBatchMode(!batchMode); if (!batchMode) setShowBatchPanel(true); }}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${batchMode ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}
                        >
                            <Layers size={16} /> Batch Mode {batchMode ? 'ON' : 'OFF'}
                        </button>
                        {file && !batchMode && (
                            <button onClick={handleRemoveFile} className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-all shadow-md font-medium text-sm">
                                <Trash2 size={16} /> Clear
                            </button>
                        )}
                    </div>
                </div>

                {/* Batch Panel */}
                {batchMode && (
                    <div className="mt-4">
                        <div className="flex items-center justify-between mb-2">
                            <button onClick={() => setShowBatchPanel(!showBatchPanel)} className="flex items-center gap-2 text-sm font-bold text-slate-700">
                                {showBatchPanel ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                Batch Queue ({batchStats.total} files)
                            </button>
                            <div className="flex items-center gap-2">
                                {batchStats.total > 0 && (
                                    <div className="flex items-center gap-3 text-[11px] font-semibold">
                                        {batchStats.completed > 0 && <span className="text-emerald-600">{batchStats.completed} saved</span>}
                                        {batchStats.processing > 0 && <span className="text-blue-600">{batchStats.processing} processing</span>}
                                        {batchStats.needsReview > 0 && <span className="text-amber-600">{batchStats.needsReview} review</span>}
                                        {batchStats.duplicates > 0 && <span className="text-slate-500">{batchStats.duplicates} duplicates</span>}
                                        {batchStats.failed > 0 && <span className="text-red-600">{batchStats.failed} failed</span>}
                                    </div>
                                )}
                                <input type="file" ref={batchInputRef} onChange={(e) => { if (e.target.files) handleBatchFiles(e.target.files); }} className="hidden" accept="application/pdf,image/jpeg,image/png" multiple />
                                <button onClick={() => batchInputRef.current?.click()} className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition-colors">
                                    + Add Files
                                </button>
                                {batchStats.completed > 0 && (
                                    <button onClick={() => documentPipelineService.clearCompleted()} className="px-3 py-1.5 bg-slate-200 text-slate-600 text-xs font-bold rounded-lg hover:bg-slate-300 transition-colors">
                                        Clear Done
                                    </button>
                                )}
                            </div>
                        </div>

                        {showBatchPanel && batchFiles.length > 0 && (
                            <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-[200px] overflow-y-auto">
                                {batchFiles.map(bf => (
                                    <div key={bf.id} className="px-3 py-2 flex items-center gap-3 text-xs hover:bg-slate-50">
                                        {/* Status indicator */}
                                        <div className="shrink-0">
                                            {bf.status === 'completed' && <CheckCircle2 size={14} className="text-emerald-500" />}
                                            {bf.status === 'failed' && <AlertCircle size={14} className="text-red-500" />}
                                            {bf.status === 'duplicate' && <Link2 size={14} className="text-slate-400" />}
                                            {bf.status === 'review' && <Eye size={14} className="text-amber-500" />}
                                            {['identifying', 'extracting', 'saving'].includes(bf.status) && <Loader2 size={14} className="text-blue-500 animate-spin" />}
                                            {bf.status === 'queued' && <Clock size={14} className="text-slate-300" />}
                                        </div>

                                        {/* File name */}
                                        <span className="font-medium text-slate-700 truncate flex-1 min-w-0">{bf.file.name}</span>

                                        {/* Doc type badge */}
                                        {bf.docType && bf.docType !== 'UNKNOWN' && (
                                            <span className="shrink-0 px-1.5 py-0.5 bg-indigo-50 text-indigo-600 font-bold rounded text-[9px]">{bf.docType}</span>
                                        )}

                                        {/* Confidence bar */}
                                        {bf.confidence > 0 && (
                                            <div className="shrink-0 w-16 flex items-center gap-1">
                                                <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                                    <div className={`h-full rounded-full ${bf.confidence >= 0.85 ? 'bg-emerald-500' : bf.confidence >= 0.5 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${bf.confidence * 100}%` }} />
                                                </div>
                                                <span className="text-[9px] text-slate-400">{Math.round(bf.confidence * 100)}%</span>
                                            </div>
                                        )}

                                        {/* Status text */}
                                        <span className={`shrink-0 text-[10px] font-semibold ${
                                            bf.status === 'completed' ? 'text-emerald-600' :
                                            bf.status === 'failed' ? 'text-red-600' :
                                            bf.status === 'duplicate' ? 'text-slate-500' :
                                            bf.status === 'review' ? 'text-amber-600' :
                                            'text-blue-600'
                                        }`}>
                                            {bf.status === 'identifying' ? 'Classifying...' :
                                             bf.status === 'extracting' ? 'Extracting...' :
                                             bf.status === 'saving' ? 'Saving...' :
                                             bf.status === 'completed' ? 'Saved' :
                                             bf.status === 'duplicate' ? 'Duplicate' :
                                             bf.status === 'review' ? 'Review' :
                                             bf.status === 'failed' ? 'Failed' : 'Queued'}
                                        </span>

                                        {/* Actions */}
                                        <div className="shrink-0 flex gap-1">
                                            {bf.status === 'review' && (
                                                <button onClick={() => documentPipelineService.approveFile(bf.id, currentCompanyId || 'ALL', handleBatchSave)} className="p-1 text-emerald-500 hover:bg-emerald-50 rounded" title="Approve & Save">
                                                    <CheckCircle2 size={12} />
                                                </button>
                                            )}
                                            {bf.status === 'failed' && (
                                                <button onClick={() => documentPipelineService.retryFile(bf.id)} className="p-1 text-blue-500 hover:bg-blue-50 rounded" title="Retry">
                                                    <RefreshCw size={12} />
                                                </button>
                                            )}
                                            <button onClick={() => documentPipelineService.removeFile(bf.id)} className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded" title="Remove">
                                                <X size={12} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {showBatchPanel && batchFiles.length === 0 && (
                            <div className="bg-white rounded-lg border border-dashed border-slate-300 p-6 text-center"
                                onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
                            >
                                <Layers size={24} className="text-slate-300 mx-auto mb-2" />
                                <p className="text-sm text-slate-500 font-medium">Drop multiple files here for batch processing</p>
                                <p className="text-xs text-slate-400 mt-1">PDF, JPEG, PNG — up to 10MB each — processed in parallel</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="flex flex-1 overflow-hidden">

                {/* LEFT PANEL: PREVIEW / UPLOAD */}
                <div className={`flex flex-col border-r border-slate-200 transition-all duration-300 ${file ? 'w-1/2' : 'w-full'}`}>
                    {file && previewUrl ? (
                        <div className="flex-1 bg-slate-100 p-4 overflow-auto flex flex-col items-center justify-center relative">
                            {file.type === 'application/pdf' ? (
                                <div className="w-full h-full flex flex-col items-center justify-center text-slate-500">
                                    <object data={previewUrl} type="application/pdf" className="w-full h-full rounded shadow-sm border border-slate-300">
                                        <div className="flex flex-col items-center p-10">
                                            <FileText size={64} className="mb-4 text-slate-400" />
                                            <p>PDF Preview not available.</p>
                                            <a href={previewUrl} download={file.name} className="text-blue-600 hover:underline mt-2">Download to view</a>
                                        </div>
                                    </object>
                                </div>
                            ) : (
                                <img src={previewUrl} alt="Preview" className="max-w-full max-h-full object-contain rounded shadow-sm border border-slate-300" />
                            )}
                            <div className="absolute bottom-4 left-4 bg-black/70 text-white text-xs px-3 py-1 rounded-full backdrop-blur-sm">
                                {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                            </div>
                        </div>
                    ) : (
                        <div
                            className={`flex-1 flex flex-col items-center justify-center p-10 transition-colors ${dragActive ? 'bg-blue-50' : 'bg-slate-50'}`}
                            onDragEnter={handleDrag}
                            onDragLeave={handleDrag}
                            onDragOver={handleDrag}
                            onDrop={handleDrop}
                        >
                            <div className={`w-full max-w-md border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center text-center transition-all ${dragActive ? 'border-blue-500 bg-blue-100/50' : 'border-slate-300 bg-white'}`}>
                                <div className="bg-blue-50 p-4 rounded-full mb-4">
                                    <UploadCloud size={32} className="text-blue-600" />
                                </div>
                                <p className="font-bold text-slate-700 mb-2">Drag & drop your documents here</p>
                                <p className="text-sm text-slate-500">PDF, JPEG, PNG up to 10MB — drop multiple files for batch mode</p>
                                <div className="my-4 text-xs text-slate-400 w-full flex items-center gap-2">
                                    <hr className="flex-1" /> OR <hr className="flex-1" />
                                </div>
                                <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept="application/pdf,image/jpeg,image/png" multiple />
                                <button onClick={() => fileInputRef.current?.click()} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg transition-colors">
                                    Browse Files
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* RIGHT PANEL: ANALYSIS */}
                {file && (
                    <div className="w-1/2 flex flex-col h-full bg-slate-50">
                        <div className="p-4 border-b border-slate-200 bg-white shadow-sm flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-1.5 bg-purple-600 rounded text-white shadow-sm">
                                    <Bot size={18} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-800 text-sm">AI Analysis</h3>
                                    <p className="text-[10px] text-slate-500 uppercase tracking-widest flex items-center gap-1">
                                        <span className={`w-1.5 h-1.5 rounded-full ${isProcessing || isIdentifying ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`}></span>
                                        {isIdentifying ? 'Identifying Document Type...' : isProcessing ? 'Processing...' : extractionResult ? 'Completed' : 'Ready'}
                                    </p>
                                </div>
                            </div>
                            {identifiedDocType && !extractionResult && <span className="text-xs font-bold bg-slate-200 text-slate-600 px-2 py-1 rounded">{identifiedDocType}</span>}
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar" ref={messagesEndRef}>
                            {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-center gap-2 mb-4"><AlertCircle size={16} />{error}</div>}

                            {extractionResult ? (
                                <div className="animate-in fade-in">
                                    <div className="mb-6 p-4 rounded-xl border border-indigo-100 bg-indigo-50/50 flex items-center gap-3">
                                        <div className="p-2 rounded-lg bg-indigo-600 text-white"><ScanEye size={20} /></div>
                                        <div>
                                            <p className="text-xs font-bold text-indigo-400 uppercase tracking-wider">DOCUMENT TYPE</p>
                                            <h3 className="text-lg font-bold text-slate-800">{identifiedDocType}</h3>
                                        </div>
                                    </div>
                                    {renderExtractedView()}
                                </div>
                            ) : analysis ? (
                                <div className="prose prose-sm max-w-none whitespace-pre-wrap">{analysis}</div>
                            ) : (
                                <div className="text-center text-slate-400 pt-10 flex flex-col items-center">
                                    {isIdentifying ? (
                                        <>
                                            <Loader2 size={32} className="mx-auto mb-4 animate-spin text-purple-600" />
                                            <p className="text-sm font-medium text-slate-600">Analyzing document structure...</p>
                                            <p className="text-xs text-slate-400 mt-1">Identifying document type to run extraction.</p>
                                        </>
                                    ) : isProcessing ? (
                                        <>
                                            <Loader2 size={32} className="mx-auto mb-4 animate-spin text-purple-600" />
                                            <p className="text-sm font-medium text-slate-600">Extracting data...</p>
                                            <p className="text-xs text-slate-400 mt-1">This may take a few seconds.</p>
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles size={32} className="mx-auto mb-2 opacity-50" />
                                            <p className="text-sm">Ready to analyze.</p>
                                            <p className="text-xs text-slate-400 mt-1">Click a quick action below or wait for auto-detection.</p>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="p-4 bg-white border-t border-slate-200">
                            <div className="flex gap-2 mb-2">
                                {quickActions.map((qa => (
                                    <button key={qa.label} onClick={() => runAnalysis(qa.prompt)} className="text-xs bg-slate-100 text-slate-600 px-3 py-1 rounded-full hover:bg-slate-200 transition-colors">
                                        {qa.label}
                                    </button>
                                )))}
                            </div>
                            <div className="relative">
                                <input
                                    type="text"
                                    className="w-full pl-3 pr-10 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                                    placeholder="Ask a follow-up question..."
                                    value={customPrompt}
                                    onChange={(e) => setCustomPrompt(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && runAnalysis(customPrompt)}
                                />
                                <button onClick={() => runAnalysis(customPrompt)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-purple-600 transition-colors">
                                    <Send size={16} />
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AiUpload;