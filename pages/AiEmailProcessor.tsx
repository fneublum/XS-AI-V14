
import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, Loader2, CheckCircle2, Inbox, FileText, AlertCircle, ShieldCheck, ChevronRight, FileCode, Play, WifiOff, LogIn, X, Key, Mail, HelpCircle, Server, ExternalLink, LogOut, Lock, PauseCircle, PlayCircle, Clock, Send, Sparkles, User, Bot, Search, Anchor, Ship, Calculator, Package, Receipt, ClipboardList, ShoppingBag, Calendar, CreditCard, PenTool, ScrollText, DollarSign, ScanEye, ArrowDownUp, Copy, Trash2, Archive } from 'lucide-react';
import { analyzeDocument, getEmailAgentResponse } from '../services/geminiService';
import { loginFor, getAccountFor, loginRequest, ProcessorKey, initializeMsal, logoutFor, getTokenFor } from "../services/smailAuth";
import { BillOfLading, Booking, Estimate, ProformaInvoice, PurchaseOrderExtract, Invoice, PackingList, SupplierInvoice } from '../types';
import { notificationService } from '../services/notificationService';

interface AiEmailProcessorProps {
    onSaveBL?: (data: BillOfLading) => void;
    onSaveBooking?: (data: Booking) => void;
    onSaveEstimate?: (data: Estimate) => void;
    onSaveProforma?: (data: ProformaInvoice) => void;
    onSavePO?: (data: PurchaseOrderExtract) => void;
    onSaveInvoice?: (data: Invoice) => void;
    onSaveSupplierInvoice?: (data: SupplierInvoice) => void;
    onSavePackingList?: (data: PackingList) => void;
    currentCompanyId?: string;
    processorKey?: ProcessorKey;
}

interface EmailAttachment {
    id: string;
    name: string;
    contentType: string;
}

interface EmailMessage {
    id: string;
    from: string;
    subject: string;
    date: string;
    receivedDateTime: string;
    snippet: string;
    hasAttachment: boolean;
    attachmentName?: string;
    attachmentType?: string;
    attachmentData?: string;
    attachments?: EmailAttachment[];
    status: 'UNREAD' | 'PROCESSED' | 'ERROR';
}

interface ExtractedData {
    mergedData: any;
    completenessScore: number;
    validationResults: any;
}

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

const AiEmailProcessor: React.FC<AiEmailProcessorProps> = ({
    onSaveBL, onSaveBooking, onSaveEstimate, onSaveProforma, onSavePO, onSaveInvoice, onSaveSupplierInvoice, onSavePackingList,
    currentCompanyId,
    processorKey = 'automation'
}) => {
    const [targetEmail, setTargetEmail] = useState('Checking...');
    const [isConnected, setIsConnected] = useState(false);
    const [useMsal, setUseMsal] = useState(false);
    const [activeKey, setActiveKey] = useState<ProcessorKey>(processorKey);

    const [emails, setEmails] = useState<EmailMessage[]>([]);
    const [isScanning, setIsScanning] = useState(false);
    const [scanError, setScanError] = useState<string | null>(null);
    const [selectedEmail, setSelectedEmail] = useState<EmailMessage | null>(null);

    const [isProcessing, setIsProcessing] = useState(false);
    const [processStatus, setProcessStatus] = useState<string>('');
    const [docExtractionResult, setDocExtractionResult] = useState<ExtractedData | null>(null);
    const [identifiedDocType, setIdentifiedDocType] = useState<string | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [savedSuccess, setSavedSuccess] = useState(false);
    const [allProcessedResults, setAllProcessedResults] = useState<{ docType: string; data: ExtractedData; previewUrl: string; attachmentName: string; saved: boolean }[]>([]);

    const [autoRun, setAutoRun] = useState(false);
    const [sortOrder, setSortOrder] = useState<'DESC' | 'ASC'>('DESC');
    const [activeFolder, setActiveFolder] = useState<'inbox' | 'deleteditems'>('inbox');

    // --- COPILOT STATE ---
    const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'model', text: string }[]>([
        { role: 'model', text: "Hello! I'm your AI Email Dispatcher. I can help you scan for new documents or process your incoming attachments. Try asking: 'Are there any new invoices?'" }
    ]);
    const [chatInput, setChatInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const chatEndRef = useRef<HTMLDivElement>(null);

    // --- LOGIN SCREEN STATE ---
    const [redirectUri] = useState(`${window.location.origin}`); // Use origin
    const [copied, setCopied] = useState(false);

    const isScanningRef = useRef(isScanning);
    const isProcessingRef = useRef(isProcessing);

    useEffect(() => {
        isScanningRef.current = isScanning;
    }, [isScanning]);

    useEffect(() => {
        isProcessingRef.current = isProcessing;
    }, [isProcessing]);

    useEffect(() => {
        // Initialize MSAL on mount to handle redirects
        const init = async () => {
            await initializeMsal();
            checkConnection();
        };
        init();
    }, [processorKey]);

    useEffect(() => {
        if (isConnected) {
            handleScanInbox(true); // Initial scan with reset
        }
    }, [isConnected, activeFolder, sortOrder]);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages]);

    useEffect(() => {
        let interval: any;
        if (autoRun) {
            interval = setInterval(() => {
                if (!isScanningRef.current && !isProcessingRef.current) {
                    handleScanInbox();
                }
            }, 5 * 60 * 1000); // Scan every 5 minutes
        }
        return () => clearInterval(interval);
    }, [autoRun]);

    useEffect(() => {
        if (autoRun && !isProcessing && !isScanning && isConnected) {
            const nextEmail = emails.find(e => e.status === 'UNREAD');
            if (nextEmail) {
                const timer = setTimeout(() => {
                    handleProcessEmail(nextEmail);
                }, 1000);
                return () => clearTimeout(timer);
            }
        }
    }, [autoRun, isProcessing, isScanning, emails, isConnected]);

    useEffect(() => {
        if (docExtractionResult && !savedSuccess && !isProcessing && allProcessedResults.length === 0) {
            handleAutoSave();
        }
    }, [docExtractionResult, isProcessing]);

    const checkConnection = () => {
        // Check MSAL interactive accounts only
        const automationAccount = getAccountFor('automation');
        const myAccount = getAccountFor('my');
        const msalAccount = automationAccount || myAccount;

        if (msalAccount) {
            setActiveKey(automationAccount ? 'automation' : 'my');
            setTargetEmail(msalAccount.username);
            setIsConnected(true);
            setUseMsal(true);
            setScanError(null);
            return;
        }

        setTargetEmail('Not Signed In');
        setIsConnected(false);
        setUseMsal(false);
    };

    const handleLoginMsal = async () => {
        setScanError(null);
        try {
            const account = await loginFor(processorKey as ProcessorKey, loginRequest.scopes);
            setActiveKey(processorKey as ProcessorKey);
            setTargetEmail(account.username);
            setIsConnected(true);
            setUseMsal(true);
            setScanError(null);
        } catch (e: any) {
            if (e.message?.includes("Redirecting")) {
                return; // Gracefully handle Safari redirect signal
            }
            if (e.errorCode === "user_cancelled" || e.message?.includes("user_cancelled")) {
                setScanError(null);
                return;
            }
            if (e.message?.includes("interaction_in_progress") || e.errorCode === "interaction_in_progress") {
                if (confirm("Auth already in progress. Reload app?")) window.location.reload();
            } else {
                setScanError("Connection failed.");
            }
        }
    };

    const handleDisconnect = () => {
        if (useMsal) {
            logoutFor(activeKey);
        }
        setTargetEmail('Not Signed In');
        setIsConnected(false);
        setUseMsal(false);
        setEmails([]);
        setSelectedEmail(null);
        setAutoRun(false);
        setActiveKey(processorKey as ProcessorKey);
        setDocExtractionResult(null);
        setPreviewUrl(null);
        setIdentifiedDocType(null);
    };

    const handleScanInbox = async (reset = false) => {
        setIsScanning(true);
        setScanError(null);

        let token = '';
        try {
            token = await getTokenFor(activeKey, loginRequest.scopes);
        } catch (e: any) {
            if (e.message?.includes("Redirecting")) return "REDIRECTING";
            setScanError("Auth Expired");
            setIsConnected(false);
            setIsScanning(false);
            return "AUTH_ERROR";
        }

        try {
            // Updated Endpoint to use activeFolder variable
            const endpoint = `https://graph.microsoft.com/v1.0/me/mailFolders/${activeFolder}/messages?$orderby=receivedDateTime ${sortOrder}&$select=id,subject,from,receivedDateTime,bodyPreview,hasAttachments&$top=15`;
            const listResp = await fetch(endpoint, { headers: { 'Authorization': `Bearer ${token}` } });
            if (!listResp.ok) throw new Error("API_ERROR");

            const listData = await listResp.json();
            const rawMessages = listData.value || [];
            let newEmails: EmailMessage[] = [];

            for (const msg of rawMessages) {
                if (!reset && emails.some(e => e.id === msg.id)) continue;

                if (msg.hasAttachments) {
                    const attachUrl = `https://graph.microsoft.com/v1.0/me/messages/${msg.id}/attachments?$select=id,name,contentType,size,isInline`;
                    const attachResp = await fetch(attachUrl, { headers: { 'Authorization': `Bearer ${token}` } });

                    if (attachResp.ok) {
                        const attachData = await attachResp.json();
                        const validAttachments = (attachData.value || []).filter((a: any) => !a.isInline);
                        if (validAttachments.length > 0) {
                            newEmails.push({
                                id: msg.id,
                                from: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || 'Unknown',
                                subject: msg.subject || '(No Subject)',
                                date: new Date(msg.receivedDateTime).toLocaleDateString(),
                                receivedDateTime: msg.receivedDateTime,
                                snippet: msg.bodyPreview || '',
                                hasAttachment: true,
                                attachmentName: validAttachments[0].name,
                                attachmentType: validAttachments[0].contentType,
                                attachmentData: validAttachments[0].id,
                                attachments: validAttachments.map((a: any) => ({ id: a.id, name: a.name, contentType: a.contentType })),
                                status: 'UNREAD'
                            });
                        }
                    }
                }
            }
            if (reset) {
                setEmails(newEmails);
            } else if (newEmails.length > 0) {
                setEmails(prev => [...newEmails, ...prev]);
            }
            return newEmails;
        } catch (err: any) {
            setScanError("Failed to scan.");
            return "SCAN_FAIL";
        } finally {
            setIsScanning(false);
        }
    };

    const handleAutoProcessToggle = async () => {
        if (autoRun) {
            setAutoRun(false);
        } else {
            // Trigger a scan immediately when starting
            await handleScanInbox();
            setAutoRun(true);
        }
    };

    const processExtractionLogic = (jsonText: string) => {
        try {
            let cleanText = jsonText;
            if (cleanText.startsWith('"') && cleanText.includes('\\"')) {
                cleanText = cleanText.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '').replace(/\\\\/g, '\\').trim();
            }
            const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("No JSON found");
            const extractedData = JSON.parse(jsonMatch[0]);

            if (!extractedData.DOC_TYPE && identifiedDocType) {
                extractedData.DOC_TYPE = identifiedDocType;
            }

            return { mergedData: extractedData, completenessScore: 5, validationResults: {} };
        } catch (e) {
            console.error("Extraction Parsing Error", e);
            return null;
        }
    };

    const saveDocumentInline = async (docType: string, data: any, docUrl: string) => {
        const companyId = currentCompanyId || 'ALL';
        const created = new Date().toISOString();
        try {
            if (docType === 'BOOKING' && onSaveBooking) {
                await onSaveBooking({ id: `BK${Date.now()}`, companyId, createdAt: created, bookingNumber: String(data.DOC_NUMBER || ''), customer: String(data.CUSTOMER || ''), vesselVoyage: String(data.VESSEL_VOYAGE || ''), pol: String(data.POL || ''), pod: String(data.POD || ''), equipment: String(data.EQUIPMENT || ''), etd: String(data.ETD || ''), eta: String(data.ETA || ''), cargoCutOff: String(data.CARGO_CUT_OFF || ''), vgmCutOff: String(data.VGM_CUT_OFF || ''), draftCutOff: String(data.DRAFT_CUT_OFF || ''), freeTime: String(data.FREE_TIME || ''), terminal: String(data.TERMINAL || ''), originalDocument: docUrl });
                return true;
            } else if (docType === 'BILL OF LADING' && onSaveBL) {
                await onSaveBL({ id: `BL${Date.now()}`, companyId, createdAt: created, blNumber: String(data.DOC_NUMBER || ''), shipper: String(data.SHIPPER || ''), consignee: String(data.CONSIGNEE || ''), notifyParty: String(data.NOTIFY || ''), vesselVoyage: String(data.VESSEL_VOYAGE || ''), portLoading: String(data.PORT_LOADING || ''), portDischarge: String(data.PORT_DISCHARGE || ''), placeReceipt: String(data.PLACE_OF_RECEIPT || ''), placeDelivery: String(data.PLACE_OF_DELIVERY || ''), shippedDate: String(data.SHIPPED_DATE || ''), originals: String(data.NUMBER_OF_ORIGINALS || ''), container: String(data.CONTAINER || ''), seal: String(data.SEAL || ''), description: String(data.PRODUCT_DESCRIPTION || ''), grossWeight: String(data.GROSS_WEIGHT || ''), measurement: String(data.MEASUREMENT || ''), packages: String(data.PACKAGES || ''), freightPayable: String(data.FREIGHT_PAYABLE || ''), remarks: String(data.TERMS || ''), originalDocument: docUrl });
                return true;
            } else if (docType === 'ESTIMATE' && onSaveEstimate) {
                await onSaveEstimate({ id: `EST${Date.now()}`, companyId, createdAt: created, estimateNumber: String(data.DOC_NUMBER || ''), supplier: String(data.SELLER_NAME || ''), buyer: String(data.BUYER_NAME || ''), shipTo: String(data.SHIP_TO || ''), payTo: String(data.PAY_TO || ''), date: String(data.DATE || ''), terms: String(data.PAYMENT_TERMS || ''), incoterm: String(data.INCOTERM || ''), subtotal: Number(data.SUBTOTAL || 0), tax: Number(data.TAX || 0), totalAmount: Number(data.TOTAL_AMOUNT || 0), currency: String(data.CURRENCY || 'USD'), items: JSON.stringify(data.ITEMS || []), acceptedBy: String(data.ACCEPTED_BY || ''), acceptedDate: String(data.ACCEPTED_DATE || ''), originalDocument: docUrl });
                return true;
            } else if (docType === 'PROFORMA INVOICE' && onSaveProforma) {
                await onSaveProforma({ id: `PI${Date.now()}`, companyId, createdAt: created, piNumber: String(data.DOC_NUMBER || ''), supplier: String(data.SELLER_NAME || ''), buyer: String(data.BUYER_NAME || ''), shipTo: String(data.SHIP_TO || ''), payTo: String(data.PAY_TO || ''), date: String(data.DATE || ''), terms: String(data.PAYMENT_TERMS || ''), incoterm: String(data.INCOTERM || ''), subtotal: Number(data.SUBTOTAL || 0), tax: Number(data.TAX || 0), totalAmount: Number(data.TOTAL_AMOUNT || 0), currency: String(data.CURRENCY || 'USD'), items: JSON.stringify(data.ITEMS || []), acceptedBy: String(data.ACCEPTED_BY || ''), acceptedDate: String(data.ACCEPTED_DATE || ''), originalDocument: docUrl });
                return true;
            } else if (docType === 'PURCHASE ORDER' && onSavePO) {
                await onSavePO({ id: `PO${Date.now()}`, companyId, createdAt: created, poNumber: String(data.DOC_NUMBER || ''), vendor: String(data.SELLER_NAME || data.VENDOR_NAME || ''), date: String(data.DATE || ''), totalAmount: String(data.TOTAL_AMOUNT || ''), currency: String(data.CURRENCY || ''), items: JSON.stringify(data.ITEMS || []), originalDocument: docUrl });
                return true;
            } else if (docType === 'INVOICE' && onSaveSupplierInvoice) {
                await onSaveSupplierInvoice({ id: `INV${Date.now()}`, companyId, createdAt: created, invoiceNumber: String(data.INVOICE_NUMBER || ''), invoiceDate: String(data.INVOICE_DATE || ''), shipperName: String(data.SELLER_NAME || ''), shipperAddress: String(data.SELLER_ADDRESS || ''), soldTo: String(data.BUYER_NAME_ADDRESS || ''), shipTo: String(data.SHIP_TO_ADDRESS || ''), paymentTerms: String(data.PAYMENT_TERMS || ''), incoterm: String(data.INCOTERMS || ''), dateOrder: String(data.DATE_SHIPPED || ''), customerPo: String(data.PO_NUMBER || ''), carrier: String(data.CARRIER || ''), transportRef: String(data.TRANSPORT_ID || ''), freightTerms: String(data.FREIGHT_TERMS || ''), items: JSON.stringify(data.ITEMS || []), grossWeight: String(data.WEIGHT_GROSS || ''), netWeight: String(data.WEIGHT_NET || ''), tareWeight: String(data.WEIGHT_TARE || ''), totalQuantity: String(data.TOTAL_QUANTITY || ''), subtotal: Number(data.SUBTOTAL || 0), totalAmount: Number(data.TOTAL_AMOUNT || 0), currency: String(data.CURRENCY || 'USD'), remitTo: String(data.REMIT_TO_NAME || ''), bankName: String(data.BANK_NAME || ''), swiftCode: String(data.SWIFT_CODE || ''), routingNumber: String(data.ROUTING_NUMBER || ''), accountNumber: String(data.ACCOUNT_NUMBER || ''), originalDocument: docUrl });
                return true;
            } else if (docType === 'PACKING LIST' && onSavePackingList) {
                await onSavePackingList({ id: `PL${Date.now()}`, companyId, createdAt: created, plNumber: String(data.PL_NUMBER || ''), blNumber: String(data.BL_NUMBER || ''), shipper: String(data.SHIPPER || ''), consignee: String(data.CONSIGNEE || ''), shippingPoint: String(data.SHIPPING_POINT || ''), destination: String(data.DESTINATION || ''), date: String(data.DATE || ''), carrier: String(data.CARRIER || ''), containerNumber: String(data.CONTAINER_NUMBER || ''), sealNumber: String(data.SEAL_NUMBER || ''), vesselVoyage: String(data.VESSEL_VOYAGE || ''), productDescription: String(data.PRODUCT_DESCRIPTION || ''), unitCount: String(data.UNIT_COUNT || ''), unitNumbers: String(data.UNIT_NUMBERS || ''), grossWeight: String(data.GROSS_WEIGHT || ''), netWeight: String(data.NET_WEIGHT || ''), freightTerms: String(data.FREIGHT_TERMS || ''), poNumber: String(data.PO_NUMBER || ''), notes: String(data.NOTES || ''), scheduledShipDate: String(data.SCH_SHIP_DATE || ''), items: JSON.stringify(data.ITEMS || []), originalDocument: docUrl });
                return true;
            }
            return false;
        } catch (err) {
            console.error('Inline save failed:', err);
            return false;
        }
    };

    const handleProcessEmail = async (email: EmailMessage) => {
        if (!email.attachmentData && (!email.attachments || email.attachments.length === 0)) return;

        setSelectedEmail(email);
        setIsProcessing(true);
        setProcessStatus('Starting...');
        setDocExtractionResult(null);
        setIdentifiedDocType(null);
        setPreviewUrl(null);
        setSavedSuccess(false);
        setAllProcessedResults([]);

        let token = '';
        try {
            token = await getTokenFor(activeKey, loginRequest.scopes);
        } catch (e: any) {
            if (e.message?.includes("Redirecting")) return;
            setIsProcessing(false);
            return;
        }

        const attachmentsToProcess = email.attachments && email.attachments.length > 0
            ? email.attachments
            : [{ id: email.attachmentData!, name: email.attachmentName!, contentType: email.attachmentType! }];

        try {
            // Only mark as read if in Inbox
            if (activeFolder === 'inbox') {
                const readUrl = `https://graph.microsoft.com/v1.0/me/messages/${email.id}`;
                await fetch(readUrl, { method: 'PATCH', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ isRead: true }) });
            }

            const results: typeof allProcessedResults = [];

            for (let idx = 0; idx < attachmentsToProcess.length; idx++) {
                const att = attachmentsToProcess[idx];
                setProcessStatus(`Downloading ${att.name} (${idx + 1}/${attachmentsToProcess.length})...`);

                const attachUrl = `https://graph.microsoft.com/v1.0/me/messages/${email.id}/attachments/${att.id}`;
                const attachResp = await fetch(attachUrl, { headers: { 'Authorization': `Bearer ${token}` } });
                if (!attachResp.ok) { console.error(`Download failed for ${att.name}`); continue; }
                const attachJson = await attachResp.json();
                const base64Data = attachJson.contentBytes;

                const dataUrl = `data:${att.contentType};base64,${base64Data}`;
                setPreviewUrl(dataUrl);

                setProcessStatus(`AI identifying ${att.name}...`);
                const typeResult = await analyzeDocument(base64Data, att.contentType || 'application/pdf', IDENTIFICATION_PROMPT);
                const docType = String(typeResult ?? '').replace(/[\*\"]/g, '').trim().toUpperCase();
                setIdentifiedDocType(docType);

                setProcessStatus(`Extracting ${docType} from ${att.name}...`);
                const prompt = EXTRACTION_PROMPTS[docType as keyof typeof EXTRACTION_PROMPTS];
                if (!prompt) {
                    console.warn(`No extraction rules for '${docType}' in ${att.name}`);
                    continue;
                }

                const resultRaw: any = await analyzeDocument(base64Data, att.contentType || 'application/pdf', prompt);
                const extractionResultStr = typeof resultRaw === 'string' ? resultRaw : String(resultRaw);
                const processed = processExtractionLogic(extractionResultStr);

                if (processed) {
                    setDocExtractionResult(processed);
                    setPreviewUrl(dataUrl);
                    setIdentifiedDocType(docType);

                    // Save inline using direct dataUrl (not stale state)
                    const saved = await saveDocumentInline(docType, processed.mergedData, dataUrl);
                    setSavedSuccess(saved);

                    results.push({ docType, data: processed, previewUrl: dataUrl, attachmentName: att.name, saved });
                }
            }

            setAllProcessedResults(results);
            if (results.length > 0) {
                // Set the last result as current for display
                const last = results[results.length - 1];
                setDocExtractionResult(last.data);
                setIdentifiedDocType(last.docType);
                setPreviewUrl(last.previewUrl);
                setSavedSuccess(true);

                // Send notification for auto-processed documents
                const savedCount = results.filter(r => r.saved).length;
                if (savedCount > 0) {
                    notificationService.add({
                        type: 'success',
                        title: 'Email Documents Processed',
                        message: `${savedCount} document${savedCount > 1 ? 's' : ''} extracted from "${email.subject}" (${email.from}): ${results.map(r => r.docType).join(', ')}`,
                        category: 'ai',
                        companyId: currentCompanyId || 'ALL',
                    });
                }
            }

            // Move to Deleted Items if successfully processed
            if (results.length > 0 && activeFolder === 'inbox') {
                const moveUrl = `https://graph.microsoft.com/v1.0/me/messages/${email.id}/move`;
                await fetch(moveUrl, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ destinationId: "deleteditems" })
                });
            }

            setEmails(prev => prev.map(e => e.id === email.id ? { ...e, status: 'PROCESSED' } : e));

        } catch (e: any) {
            setProcessStatus('Processing Failed');
            setEmails(prev => prev.map(e => e.id === email.id ? { ...e, status: 'ERROR' } : e));
        } finally {
            setIsProcessing(false);
        }
    };

    const handleAutoSave = async () => {
        if (!docExtractionResult || savedSuccess) return;
        const data = docExtractionResult.mergedData;
        const type = identifiedDocType;
        const companyId = currentCompanyId || 'ALL';
        const created = new Date().toISOString();

        try {
            if (type === 'BILL OF LADING' && onSaveBL) {
                await onSaveBL({
                    id: `BL${Date.now()}`, companyId, createdAt: created,
                    blNumber: String(data.DOC_NUMBER || ''), shipper: String(data.SHIPPER || ''), consignee: String(data.CONSIGNEE || ''), notifyParty: String(data.NOTIFY || ''),
                    vesselVoyage: String(data.VESSEL_VOYAGE || ''), portLoading: String(data.PORT_LOADING || ''), portDischarge: String(data.PORT_DISCHARGE || ''),
                    placeReceipt: String(data.PLACE_OF_RECEIPT || ''), placeDelivery: String(data.PLACE_OF_DELIVERY || ''), shippedDate: String(data.SHIPPED_DATE || ''),
                    originals: String(data.NUMBER_OF_ORIGINALS || ''), container: String(data.CONTAINER || ''), seal: String(data.SEAL || ''),
                    description: String(data.PRODUCT_DESCRIPTION || ''), grossWeight: String(data.GROSS_WEIGHT || ''),
                    measurement: String(data.MEASUREMENT || ''),
                    packages: String(data.PACKAGES || ''), freightPayable: String(data.FREIGHT_PAYABLE || ''), remarks: String(data.TERMS || ''),
                    originalDocument: previewUrl || ''
                });
            } else if (type === 'BOOKING' && onSaveBooking) {
                await onSaveBooking({
                    id: `BK${Date.now()}`, companyId, createdAt: created,
                    bookingNumber: String(data.DOC_NUMBER || ''),
                    customer: String(data.CUSTOMER || ''),
                    vesselVoyage: String(data.VESSEL_VOYAGE || ''),
                    pol: String(data.POL || ''),
                    pod: String(data.POD || ''),
                    equipment: String(data.EQUIPMENT || ''),
                    etd: String(data.ETD || ''),
                    eta: String(data.ETA || ''),
                    cargoCutOff: String(data.CARGO_CUT_OFF || ''),
                    vgmCutOff: String(data.VGM_CUT_OFF || ''),
                    draftCutOff: String(data.DRAFT_CUT_OFF || ''),
                    freeTime: String(data.FREE_TIME || ''),
                    terminal: String(data.TERMINAL || ''),
                    originalDocument: previewUrl || ''
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
                    invoiceNumber: String(data.INVOICE_NUMBER || ''),
                    invoiceDate: String(data.INVOICE_DATE || ''),
                    shipperName: String(data.SELLER_NAME || ''),
                    shipperAddress: String(data.SELLER_ADDRESS || ''),
                    soldTo: String(data.BUYER_NAME_ADDRESS || ''),
                    shipTo: String(data.SHIP_TO_ADDRESS || ''),
                    paymentTerms: String(data.PAYMENT_TERMS || ''),
                    incoterm: String(data.INCOTERMS || ''),
                    dateOrder: String(data.DATE_SHIPPED || ''),
                    customerPo: String(data.PO_NUMBER || ''),
                    carrier: String(data.CARRIER || ''),
                    transportRef: String(data.TRANSPORT_ID || ''),
                    freightTerms: String(data.FREIGHT_TERMS || ''),
                    items: JSON.stringify(data.ITEMS || []),
                    grossWeight: String(data.WEIGHT_GROSS || ''),
                    netWeight: String(data.WEIGHT_NET || ''),
                    tareWeight: String(data.WEIGHT_TARE || ''),
                    totalQuantity: String(data.TOTAL_QUANTITY || ''),
                    subtotal: Number(data.SUBTOTAL || 0),
                    totalAmount: Number(data.TOTAL_AMOUNT || 0),
                    currency: String(data.CURRENCY || 'USD'),
                    remitTo: String(data.REMIT_TO_NAME || ''),
                    bankName: String(data.BANK_NAME || ''),
                    swiftCode: String(data.SWIFT_CODE || ''),
                    routingNumber: String(data.ROUTING_NUMBER || ''),
                    accountNumber: String(data.ACCOUNT_NUMBER || ''),
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
        } catch (err) {
            console.error("Auto-save failed", err);
            setProcessStatus(`Failed to save document. Check console.`);
        }
    };

    const clearSelection = () => {
        setSelectedEmail(null);
        setDocExtractionResult(null);
        setIdentifiedDocType(null);
        setPreviewUrl(null);
        setAllProcessedResults([]);
    };

    const handleSendChat = async (overrideText?: string) => {
        const text = overrideText || chatInput;
        if (!text.trim()) return;

        const newHistory = [...chatMessages, { role: 'user' as const, text }];
        setChatMessages(newHistory);
        setChatInput('');
        setIsThinking(true);

        try {
            const contextData = {
                unreadEmails: emails.filter(e => e.status === 'UNREAD'),
                status: isConnected ? 'Connected' : 'Disconnected'
            };

            const response = await getEmailAgentResponse(text, newHistory, contextData);

            if (response.functionCall && response.functionCall.name === 'scan_unread_emails') {
                setChatMessages(prev => [...prev, { role: 'model', text: "Of course! I'm scanning your inbox now for unread emails with attachments..." }]);
                const scanResult = await handleScanInbox();

                let followUp = "I've finished scanning. ";
                if (Array.isArray(scanResult)) {
                    followUp += scanResult.length > 0
                        ? `I found ${scanResult.length} new documents: ${scanResult.map(e => e.attachmentName).join(', ')}. You can select them in the list to the left to process them.`
                        : "I didn't find any unread emails with attachments at this time.";
                } else {
                    followUp += "Unfortunately, I encountered an issue accessing your inbox. Please check your connection.";
                }

                setChatMessages(prev => [...prev, { role: 'model', text: followUp }]);
            } else if (response.text) {
                setChatMessages(prev => [...prev, { role: 'model', text: response.text! }]);
            }

        } catch (error) {
            setChatMessages(prev => [...prev, { role: 'model', text: "Sorry, I'm having trouble with my intelligence engine." }]);
        } finally {
            setIsThinking(false);
        }
    };

    const handleCopyUri = () => {
        navigator.clipboard.writeText(redirectUri);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const getSafeValue = (value: any, defaultValue = 'N/A') => (!value || value === 'null' || value === 'N/A' || value === 'Unknown') ? defaultValue : value;

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

    const renderExtractedView = () => {
        if (!docExtractionResult) return null;
        const data = docExtractionResult.mergedData;
        const type = identifiedDocType;

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

    if (!isConnected) {
        return (
            <div className="h-full flex flex-col items-center justify-center bg-slate-50 p-6">
                <div className="bg-white p-10 rounded-2xl shadow-xl text-center max-w-md border border-slate-200">
                    <div className="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-200">
                        <Mail size={40} className="text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-slate-800 mb-2">Inbox Scanner</h1>
                    <p className="text-slate-500 mb-8">Automated document extraction powered by Microsoft Graph & Gemini AI.</p>

                    {processorKey === 'automation' ? (
                        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 mb-6">
                            <p className="font-bold text-sm mb-1">Configuration Required</p>
                            <p className="text-xs">
                                Verification is strictly handled via stored credentials.
                                Please configure your email account in <br /><strong>Settings &gt; Integrations</strong>.
                            </p>
                        </div>
                    ) : (
                        <>
                            <button
                                onClick={handleLoginMsal}
                                className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-black transition-all flex items-center justify-center gap-3 shadow-lg hover:shadow-xl active:scale-[0.98]"
                            >
                                <svg className="w-5 h-5" viewBox="0 0 23 23"><path fill="#f35325" d="M1 1h10v10H1z" /><path fill="#81bc06" d="M12 1h10v10H12z" /><path fill="#05a6f0" d="M1 12h10v10H1z" /><path fill="#ffba08" d="M12 12h10v10H12z" /></svg>
                                Connect with Outlook
                            </button>
                            <p className="text-xs text-slate-400 mt-4">Secure OAuth2 Authorization</p>
                        </>
                    )}

                    <div className="mt-8 p-4 bg-blue-50 border border-blue-100 rounded-xl text-left">
                        <p className="text-[10px] font-bold text-blue-800 uppercase mb-2">Azure Configuration: Redirect URI</p>
                        <p className="text-[11px] text-blue-600/80 mb-2 leading-tight">
                            Copy this URL and add it to your Azure App Registration under <strong>Authentication &gt; Single-page application &gt; Redirect URIs</strong>.
                        </p>
                        <div
                            onClick={handleCopyUri}
                            className="flex items-center justify-between bg-white border border-blue-200 rounded px-3 py-2 cursor-pointer hover:border-blue-400 transition-colors group"
                            title="Click to Copy"
                        >
                            <code className="text-xs text-slate-600 font-mono truncate mr-2">{redirectUri}</code>
                            {copied ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Copy size={14} className="text-slate-400 group-hover:text-blue-500" />}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full bg-white relative">
            {/* Sidebar List */}
            <div className="w-1/3 border-r border-slate-200 flex flex-col min-w-[320px]">
                <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">
                            A
                        </div>
                        <div className="overflow-hidden">
                            <h3 className="font-bold text-sm text-slate-800 truncate w-32">AI Agent</h3>
                            <p className="text-xs text-slate-500 truncate w-32">{targetEmail}</p>
                        </div>
                    </div>
                    <div className="flex gap-1 items-center">
                        <div className="flex bg-white border border-slate-200 rounded-lg p-0.5 mr-2">
                            <button onClick={() => setActiveFolder('inbox')} className={`p-1.5 rounded-md transition-colors ${activeFolder === 'inbox' ? 'bg-blue-100 text-blue-600' : 'text-slate-400 hover:text-slate-600'}`} title="Inbox"><Inbox size={14} /></button>
                            <button onClick={() => setActiveFolder('deleteditems')} className={`p-1.5 rounded-md transition-colors ${activeFolder === 'deleteditems' ? 'bg-red-100 text-red-600' : 'text-slate-400 hover:text-slate-600'}`} title="Deleted Items"><Archive size={14} /></button>
                        </div>
                        <button
                            onClick={() => setSortOrder(prev => prev === 'DESC' ? 'ASC' : 'DESC')}
                            className="p-2 text-slate-500 hover:text-blue-600 hover:bg-white rounded-lg transition-colors"
                            title={`Sort by ${sortOrder === 'DESC' ? 'Oldest' : 'Newest'}`}
                        >
                            <ArrowDownUp size={16} />
                        </button>
                        <button onClick={() => handleScanInbox(true)} className="p-2 text-slate-500 hover:text-blue-600 hover:bg-white rounded-lg transition-colors" title="Refresh">
                            <RefreshCw size={16} className={isScanning ? 'animate-spin' : ''} />
                        </button>
                        <button onClick={handleDisconnect} className="p-2 text-slate-500 hover:text-red-600 hover:bg-white rounded-lg transition-colors" title="Sign Out">
                            <LogOut size={16} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar relative">
                    <div className="divide-y divide-slate-100">
                        {emails.map(email => (
                            <div
                                key={email.id}
                                onClick={() => {
                                    if (!isProcessing) {
                                        setSelectedEmail(email);
                                        setDocExtractionResult(null);
                                        setAllProcessedResults([]);
                                        setPreviewUrl(null);
                                        setIdentifiedDocType(null);
                                    }
                                }}
                                className={`p-4 cursor-pointer transition-all hover:bg-slate-50 group relative ${selectedEmail?.id === email.id ? 'bg-blue-50/50 border-l-4 border-blue-500' : 'border-l-4 border-transparent'} ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                <div className="flex justify-between items-start mb-1">
                                    <span className={`font-bold text-[10px] uppercase truncate pr-2 w-32 ${selectedEmail?.id === email.id ? 'text-blue-700' : 'text-slate-800'}`} title={email.from}>{email.from}</span>
                                    <span className="text-[10px] text-slate-400 whitespace-nowrap">{email.date}</span>
                                </div>
                                <h4 className="text-xs font-medium text-slate-700 mb-1 line-clamp-1">{email.subject}</h4>
                                {email.hasAttachment && (
                                    <div className="flex flex-wrap gap-1 mt-2">
                                        {(email.attachments || [{ id: email.attachmentData!, name: email.attachmentName!, contentType: email.attachmentType! }]).map((att, i) => (
                                            <div key={i} className="flex items-center gap-1 text-[10px] text-blue-600 bg-blue-50/50 w-fit px-1.5 py-0.5 rounded">
                                                <FileText size={10} />
                                                <span className="truncate max-w-[120px]">{att.name}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {email.status === 'PROCESSED' && <div className="absolute top-2 right-2 text-emerald-500"><CheckCircle2 size={16} /></div>}
                            </div>
                        ))}
                    </div>

                    {emails.length === 0 && !isScanning && (
                        <div className="flex flex-col items-center justify-center h-48 text-slate-400 opacity-50 p-4 text-center">
                            <Inbox size={32} className="mb-2" />
                            <p className="text-xs">No documents found in {activeFolder}. <br />Use 'Refresh' or ask the Copilot.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* RIGHT PANEL: Copilot & Analysis Pane */}
            <div className="flex-1 flex flex-col bg-slate-50 h-full overflow-hidden">
                <div className="p-3 bg-white border-b border-slate-200 flex items-center justify-between shadow-sm shrink-0">
                    <div className="flex items-center gap-3">
                        {selectedEmail && !docExtractionResult ? (
                            <>
                                <button
                                    onClick={() => handleProcessEmail(selectedEmail)}
                                    disabled={isProcessing}
                                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors text-sm font-bold shadow-sm"
                                >
                                    <ScanEye size={16} /> Process
                                </button>
                            </>
                        ) : (
                            <>
                                <div className="p-1.5 bg-indigo-600 rounded text-white shadow-sm"><Bot size={18} /></div>
                                <div>
                                    <h3 className="font-bold text-slate-800 text-sm">{docExtractionResult ? 'Extracted Data' : 'Assistant Copilot'}</h3>
                                    <p className="text-[10px] text-slate-500 uppercase tracking-widest flex items-center gap-1">
                                        <span className={`w-1.5 h-1.5 rounded-full ${isThinking || isProcessing ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`}></span>
                                        {isProcessing ? processStatus : isThinking ? 'Thinking...' : 'Active'}
                                    </p>
                                </div>
                            </>
                        )}
                    </div>
                    {(docExtractionResult || selectedEmail) && (
                        <button onClick={clearSelection} className="text-xs bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg hover:bg-slate-200 font-bold border border-slate-200">Back to Chat</button>
                    )}
                </div>

                <div className="flex-1 overflow-hidden relative">
                    {isProcessing && !docExtractionResult ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/50 backdrop-blur-sm z-10">
                            <Loader2 size={32} className="animate-spin text-blue-600 mb-2" />
                            <span className="text-sm font-bold text-slate-600">{processStatus}</span>
                        </div>
                    ) : docExtractionResult && selectedEmail && previewUrl ? (
                        <div className="flex h-full">
                            <div className="flex-1 h-full bg-slate-100 p-4 border-r border-slate-200 overflow-auto flex flex-col items-center">
                                <object data={previewUrl} type={selectedEmail.attachmentType} className="w-full h-full rounded shadow-sm border border-slate-300 bg-white">
                                    <div className="p-8 text-center text-slate-500">Preview not available for this file type.</div>
                                </object>
                            </div>
                            {/* OCR Data Sidebar */}
                            <div className="w-[320px] h-full overflow-y-auto bg-white border-l border-slate-200 custom-scrollbar shrink-0">
                                <div className="p-4 border-b border-slate-200 bg-slate-50">
                                    <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                        <ScanEye size={16} className="text-indigo-600" /> OCR Extracted Data
                                    </h3>
                                    <p className="text-[10px] text-slate-500 mt-1">{allProcessedResults.length} document{allProcessedResults.length !== 1 ? 's' : ''} processed</p>
                                </div>
                                {allProcessedResults.length > 0 ? (
                                    <div className="p-4 space-y-4">
                                        {allProcessedResults.map((result, idx) => (
                                            <div key={idx} className="border border-slate-200 rounded-xl overflow-hidden">
                                                <div className="px-3 py-2 bg-indigo-50 border-b border-indigo-100 flex items-center justify-between cursor-pointer"
                                                    onClick={() => { setPreviewUrl(result.previewUrl); setDocExtractionResult(result.data); setIdentifiedDocType(result.docType); }}>
                                                    <div>
                                                        <p className="text-[10px] font-bold text-indigo-500 uppercase">{result.docType}</p>
                                                        <p className="text-xs font-medium text-slate-700 truncate max-w-[200px]">{result.attachmentName}</p>
                                                    </div>
                                                    {result.saved && <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />}
                                                </div>
                                                <div className="p-3 space-y-2">
                                                    {Object.entries(result.data.mergedData)
                                                        .filter(([_, v]) => v && v !== 'null' && v !== 'N/A' && !Array.isArray(v))
                                                        .slice(0, 10)
                                                        .map(([key, value]) => (
                                                            <div key={key} className="flex justify-between text-[10px] gap-2">
                                                                <span className="text-slate-400 font-medium uppercase truncate shrink-0">{key.replace(/_/g, ' ')}</span>
                                                                <span className="text-slate-700 font-medium text-right truncate">{String(value)}</span>
                                                            </div>
                                                        ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="p-6">
                                        <div className="mb-4 p-4 rounded-xl border border-indigo-100 bg-indigo-50/50 flex items-center gap-3">
                                            <div className="p-2 rounded-lg bg-indigo-600 text-white"><ScanEye size={20} /></div>
                                            <div>
                                                <p className="text-xs font-bold text-indigo-400 uppercase tracking-wider">DOCUMENT TYPE</p>
                                                <h3 className="text-lg font-bold text-slate-800">{identifiedDocType}</h3>
                                            </div>
                                        </div>
                                        {renderExtractedView()}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : selectedEmail && !docExtractionResult ? (
                        /* Email Content View — before processing */
                        <div className="h-full flex flex-col bg-white overflow-y-auto">
                            <div className="p-6">
                                <h2 className="text-lg font-bold text-slate-800 mb-2">{selectedEmail.subject}</h2>
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center text-white font-bold text-sm">
                                        {selectedEmail.from.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <p className="font-bold text-sm text-slate-700">{selectedEmail.from}</p>
                                        <p className="text-xs text-slate-400">{selectedEmail.date}</p>
                                    </div>
                                </div>
                                {/* Attachments */}
                                {selectedEmail.hasAttachment && (
                                    <div className="flex flex-wrap gap-2 mb-4">
                                        {(selectedEmail.attachments || [{ id: selectedEmail.attachmentData!, name: selectedEmail.attachmentName!, contentType: selectedEmail.attachmentType! }]).map((att, i) => (
                                            <div key={i} className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
                                                <FileText size={14} /> {att.name}
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-600 leading-relaxed whitespace-pre-wrap border border-slate-200">
                                    {selectedEmail.snippet}
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* Default: Chat */
                        <div className="h-full flex flex-col bg-white">
                            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar relative">
                                {chatMessages.map((msg, idx) => (
                                    <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${msg.role === 'user' ? 'bg-slate-900 text-white' : 'bg-indigo-100 text-indigo-600'}`}>
                                            {msg.role === 'user' ? <User size={14} /> : <Sparkles size={14} />}
                                        </div>
                                        <div className={`p-3 rounded-2xl text-sm max-w-[85%] whitespace-pre-wrap leading-relaxed shadow-sm border ${msg.role === 'user'
                                            ? 'bg-slate-800 text-white border-slate-700 rounded-tr-none'
                                            : 'bg-white border-slate-200 text-slate-700 rounded-tl-none'
                                            }`}>
                                            {msg.text}
                                        </div>
                                    </div>
                                ))}
                                {isThinking && (
                                    <div className="flex gap-3">
                                        <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                                            <Loader2 size={14} className="animate-spin" />
                                        </div>
                                        <div className="bg-white border border-slate-200 p-2 px-3 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-1">
                                            <span className="w-1 h-1 bg-slate-400 rounded-full animate-bounce"></span>
                                            <span className="w-1 h-1 bg-slate-400 rounded-full animate-bounce delay-75"></span>
                                            <span className="w-1 h-1 bg-slate-400 rounded-full animate-bounce delay-150"></span>
                                        </div>
                                    </div>
                                )}
                                <div ref={chatEndRef} />
                            </div>

                            <div className="p-4 border-t border-slate-200 bg-white">
                                <div className="relative flex items-center">
                                    <input
                                        type="text"
                                        value={chatInput}
                                        onChange={(e) => setChatInput(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                                        placeholder="Ask the copilot..."
                                        className="w-full pl-4 pr-12 py-3 bg-slate-50 border border-slate-300 rounded-xl outline-none text-sm transition-all focus:ring-2 focus:ring-indigo-500"
                                        disabled={isThinking || isProcessing}
                                    />
                                    <button
                                        onClick={() => handleSendChat()}
                                        disabled={!chatInput.trim() || isThinking || isProcessing}
                                        className="absolute right-2 p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-md active:scale-95"
                                    >
                                        <Send size={16} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AiEmailProcessor;
