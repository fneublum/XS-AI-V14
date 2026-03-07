
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Power } from 'lucide-react';
import {
    Mail, RefreshCw, Loader2, AlertCircle, CheckCircle2, Play, Trash2, FileText, Inbox,
    MailPlus, Settings, LogIn, Paperclip, Forward, ShieldAlert, Send, X, Eye, Search,
    Archive, LogOut, ChevronDown, MailOpen, Sparkles, Save
} from 'lucide-react';
import { analyzeDocument } from '../services/geminiService';
import { initializeMsal, getAccountFor, getTokenFor, loginFor, logoutFor, loginRequest, type ProcessorKey } from '../services/smailAuth';
import { BillOfLading, Booking, Estimate, ProformaInvoice, PurchaseOrderExtract, Invoice, PackingList, SupplierInvoice, Port } from '../types';
import { getSupabaseClient } from '../services/supabase';

// ─── Doc OCR Prompts (same as AiUpload) ─────────────────────────────────
const IDENTIFICATION_PROMPT = `Analyze the uploaded document image and classify it into exactly one of these categories:
- BILL OF LADING
- BOOKING
- ESTIMATE
- PROFORMA INVOICE
- PURCHASE ORDER
- INVOICE
- PACKING LIST
- FREIGHT QUOTE
- COMMISSION SALES ORDER
- COMMISSION INVOICE
- OTHER

Classification Rules:
1. If the document title contains "Straight Bill of Lading" or "Short Form Straight Bill of Lading", classify it strictly as "PACKING LIST".
2. If the document is a standard "Bill of Lading" (negotiable, ocean, or multimodal) WITHOUT the word "Straight", classify it as "BILL OF LADING".
3. A distinct "Packing List" document is also classified as "PACKING LIST".
4. FREIGHT QUOTE: If the document contains shipping/freight RATES between ports (origin/destination), container types (20GP, 40HC, 40GP), transit times, free time, ocean freight costs, or comes from a cargo agent/carrier/forwarder — classify as "FREIGHT QUOTE". These are NOT estimates.
5. ESTIMATE: Only classify as "ESTIMATE" if the document is a cost breakdown with itemized services, subtotals, and taxes — NOT a freight rate sheet.
6. COMMISSION SALES ORDER: If the document is a sales order, confirmation, or PO from a commission agent/seller with product line items showing quantities in LBS/KGS and prices per unit — classify as "COMMISSION SALES ORDER".
7. COMMISSION INVOICE: If the document is a commercial invoice that includes shipping details (ETD, ETA, vessel, B/L, containers) alongside product line items — AND comes from a commission seller/agent context — classify as "COMMISSION INVOICE". Standard supplier invoices without commission context should remain "INVOICE".

Return ONLY the category name. Do not add any explanation or punctuation.`;

const EXTRACTION_PROMPTS: Record<string, string> = {
    'BILL OF LADING': `Extract the following fields specifically for a BILL OF LADING document.
    Return a valid JSON object with the exact keys listed below. If a field is not found, return null.
    KEYS: DOC_NUMBER (B/L Number), SHIPPER, CONSIGNEE, NOTIFY, NUMBER_OF_ORIGINALS, PRODUCT_DESCRIPTION, MARKS_NUMBERS, CONTAINER, SEAL, PACKAGES, GROSS_WEIGHT, MEASUREMENT, VESSEL_VOYAGE, PORT_LOADING, PORT_DISCHARGE, PLACE_OF_ISSUE, PLACE_OF_RECEIPT, PLACE_OF_DELIVERY, SHIPPED_DATE, FREIGHT_PAYABLE, TERMS.`,

    'BOOKING': `Extract the following fields specifically for a SHIPPING BOOKING CONFIRMATION document.
    Return a valid JSON object with the exact keys listed below. If a field is not found, return null.
    KEYS: DOC_NUMBER, CUSTOMER, CARGO_AGENT, VESSEL_VOYAGE, POL, POD, EQUIPMENT, ETD, ETA, CARGO_CUT_OFF, VGM_CUT_OFF, DRAFT_CUT_OFF, FREE_TIME, TERMINAL.`,

    'ESTIMATE': `Extract the following fields specifically for a PROFORMA INVOICE or ESTIMATE.
    Return a valid JSON object with the exact keys listed below. If a field is not found, return null.
    KEYS: DOC_NUMBER, DATE, SELLER_NAME, BUYER_NAME, SHIP_TO, PAY_TO, PAYMENT_TERMS, INCOTERM, ITEMS, SUBTOTAL, TAX, TOTAL_AMOUNT, CURRENCY, ACCEPTED_BY, ACCEPTED_DATE.`,

    'PROFORMA INVOICE': `Extract the following fields specifically for a PROFORMA INVOICE or ESTIMATE.
    Return a valid JSON object with the exact keys listed below. If a field is not found, return null.
    KEYS: DOC_NUMBER, DATE, SELLER_NAME, BUYER_NAME, SHIP_TO, PAY_TO, PAYMENT_TERMS, INCOTERM, ITEMS, SUBTOTAL, TAX, TOTAL_AMOUNT, CURRENCY, ACCEPTED_BY, ACCEPTED_DATE.`,

    'PURCHASE ORDER': `Extract the following fields specifically for a PURCHASE ORDER.
    Return a valid JSON object.
    KEYS: DOC_NUMBER, DATE, BUYER_NAME, SELLER_NAME, VENDOR_REF, FOLDER_NUMBER, PRODUCT_DESCRIPTION, QUANTITY, UNIT_OF_MEASURE, UNIT_PRICE, LINE_TOTAL, TOTAL_AMOUNT, CURRENCY, INCOTERM, PAYMENT_TERMS, PORT_DISCHARGE, PACKING_INSTRUCTIONS, SHIPMENT_INSTRUCTIONS, MARKINGS, INSPECTION, ITEMS.`,

    'INVOICE': `Extract the following fields specifically for a COMMERCIAL INVOICE from a Supplier.
    Return a valid JSON object with the exact keys listed below. If a field is not found, return null.
    KEYS: INVOICE_NUMBER, INVOICE_DATE, SELLER_NAME, SELLER_ADDRESS, BUYER_NAME_ADDRESS, SHIP_TO_ADDRESS, PAYMENT_TERMS, INCOTERMS, DATE_SHIPPED, PO_NUMBER, CARRIER, TRANSPORT_ID, FREIGHT_TERMS, ITEMS, WEIGHT_GROSS, WEIGHT_NET, WEIGHT_TARE, TOTAL_QUANTITY, SUBTOTAL, TOTAL_AMOUNT, CURRENCY, REMIT_TO_NAME, BANK_NAME, SWIFT_CODE, ROUTING_NUMBER, ACCOUNT_NUMBER.`,

    'PACKING LIST': `Extract the following fields specifically for a PACKING LIST / STRAIGHT BILL OF LADING.
    Return a valid JSON object.
    KEYS: BL_NUMBER, PL_NUMBER, SHIPPER, CONSIGNEE, SHIPPING_POINT, DESTINATION, DATE, CARRIER, CONTAINER_NUMBER, SEAL_NUMBER, VESSEL_VOYAGE, PRODUCT_DESCRIPTION, UNIT_COUNT, UNIT_NUMBERS, GROSS_WEIGHT, NET_WEIGHT, FREIGHT_TERMS, PO_NUMBER, NOTES, SCH_SHIP_DATE.`,

    'FREIGHT QUOTE': `Extract the following fields for a FREIGHT QUOTE / FREIGHT RATE document. Return a valid JSON object. If a field is not found, return null.
    KEYS: AGENT_NAME, CARRIER, FREIGHT_TYPE (one of: PORT_PORT, PORT_DOOR, DOOR_PORT, DOOR_DOOR), ORIGIN_PORT, ORIGIN_PORT_CODE, PICKUP_LOCATION, PICKUP_ZIP, DESTINATION_PORT, DESTINATION_PORT_CODE, DELIVERY_LOCATION, DELIVERY_ZIP, RATE, CHASSIS, OVERWEIGHT, CONTAINER_COUNT, CURRENCY, VALID_UNTIL, COMMENTS, TRANSIT_TIME, FREE_TIME, IS_ALL_IN (boolean), PICKUP_COST, OCEAN_COST, DELIVERY_COST, PORT_FEES, DECONSOLIDATION, CONTAINER_RETURN, BL_RELEASE, THC, ISPS, TRS, SECURITY_FEE, OBSERVATION.`,

    'COMMISSION SALES ORDER': `Analyze the uploaded document, which is a commission sales order or similar confirmation.
Extract the key information into a structured JSON object.
RULES:
1. Return ONLY a valid JSON object. Do not add any commentary.
2. If a field is not found, return null for its value.
3. For line items, parse each product row into an object within the "items" array.
4. Try to identify the unit of measure (LBS or KGS). If not specified, assume LBS.
KEYS for the JSON object:
{
    "orderNumber": "string (The primary document reference number)",
    "sellerName": "string",
    "customerName": "string",
    "incoterm": "string (e.g., FOB, CIF)",
    "paymentTerms": "string (e.g., 30 days)",
    "pod": "string (Port of Destination)",
    "deliveryDate": "string (YYYY-MM-DD format if possible)",
    "items": [
        { "productName": "string", "quantity": "number", "unit": "string (LBS or KGS)", "pricePerUnit": "number", "total": "number" }
    ]
}`,

    'COMMISSION INVOICE': `Analyze the uploaded document, which is a commercial INVOICE.
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
    "containerNumbers": "string (Comma-separated list of container numbers if found)",
    "items": [
        { "productName": "string", "quantity": "number", "unit": "string (LBS or KGS)", "pricePerUnit": "number", "total": "number" }
    ]
}`
};

// ─── Interfaces ────────────────────────────────────────────────────────
interface EmailAttachment {
    id: string;
    name: string;
    contentType: string;
    size: number;
    isInline: boolean;
}

interface EmailMessage {
    id: string;
    subject: string;
    from: string;
    fromName: string;
    receivedDateTime: string;
    hasAttachments: boolean;
    provider: 'GMAIL' | 'OUTLOOK' | 'IMAP';
    accountEmail: string;
    attachmentId?: string;
    attachmentName?: string;
    attachmentType?: string;
    status: 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'ERROR';
    analysisResult?: string;
    docType?: string;
    savedToDb?: boolean;
    bodyPreview: string;
    body?: { contentType: 'text' | 'html'; content: string };
    toRecipients?: Array<{ name: string; address: string }>;
    ccRecipients?: Array<{ name: string; address: string }>;
    isRead: boolean;
    attachments?: EmailAttachment[];
}

interface MailFolder {
    id: string;
    displayName: string;
    unreadItemCount: number;
    totalItemCount: number;
}

const MSAL_KEY: ProcessorKey = 'automation';

interface AiEmailAssistantProps {
    onNavigate?: (module: string, subModule: string) => void;
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

// ─── Helpers ────────────────────────────────────────────────────────
const formatTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
    if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
};

const AVATAR_COLORS = [
    'from-blue-500 to-indigo-500',
    'from-emerald-500 to-teal-500',
    'from-rose-500 to-pink-500',
    'from-amber-500 to-orange-500',
    'from-violet-500 to-purple-500',
    'from-cyan-500 to-blue-500',
    'from-red-500 to-rose-500',
    'from-lime-500 to-emerald-500',
];

const getAvatarColor = (name: string): string => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

// Sidebar shows only these 4 real folders (matched by Graph well-known ID pattern)
// Plus "Not Read" (virtual) at top and "Attachments" smart mailbox below
const SIDEBAR_FOLDERS: Array<{ graphId: string; label: string; icon: React.FC<any> }> = [
    { graphId: 'inbox', label: 'Inbox', icon: Inbox },
    { graphId: 'sentitems', label: 'Sent', icon: Send },
    { graphId: 'deleteditems', label: 'Trash', icon: Trash2 },
    { graphId: 'junkemail', label: 'Spam', icon: ShieldAlert },
];

// Match an API folder to a well-known Graph ID by checking known display-name patterns
// (Microsoft returns localized names like "Caixa de Entrada" for Inbox in pt-BR)
const DISPLAY_NAME_TO_GRAPH: Record<string, string> = {
    // English
    'inbox': 'inbox', 'sent items': 'sentitems', 'deleted items': 'deleteditems',
    'junk email': 'junkemail', 'drafts': 'drafts', 'archive': 'archive',
    // Portuguese (pt-BR)
    'caixa de entrada': 'inbox', 'itens enviados': 'sentitems', 'itens excluídos': 'deleteditems',
    'lixo eletrônico': 'junkemail', 'rascunhos': 'drafts', 'arquivo morto': 'archive',
    'caixa de saída': 'outbox',
    // Spanish
    'bandeja de entrada': 'inbox', 'elementos enviados': 'sentitems', 'elementos eliminados': 'deleteditems',
    'correo no deseado': 'junkemail', 'borradores': 'drafts', 'archivo': 'archive',
};

const resolveGraphId = (folder: { displayName: string; id: string }): string => {
    const key = folder.displayName.toLowerCase().trim();
    return DISPLAY_NAME_TO_GRAPH[key] || folder.id;
};

// ─── Component ────────────────────────────────────────────────────────
const AiEmailAssistant: React.FC<AiEmailAssistantProps> = ({
    onNavigate,
    onSaveBL, onSaveBooking, onSaveEstimate, onSaveProforma, onSavePO,
    onSaveInvoice, onSaveSupplierInvoice, onSavePackingList,
    currentCompanyId, ports = []
}) => {
    // Auth
    const [isConnected, setIsConnected] = useState<boolean | null>(null);
    const [connectedEmail, setConnectedEmail] = useState<string>('');
    const [isConnecting, setIsConnecting] = useState(false);

    // Folders
    const [folders, setFolders] = useState<MailFolder[]>([]);
    const [selectedFolderId, setSelectedFolderId] = useState<string>('inbox');
    const [selectedFolderName, setSelectedFolderName] = useState<string>('Inbox');
    // Smart filters: 'none' = normal folder, 'unread' = not-read filter, 'attachments' = attachments filter
    const [smartFilter, setSmartFilter] = useState<'none' | 'unread' | 'attachments'>('none');

    // Emails
    const [emails, setEmails] = useState<EmailMessage[]>([]);
    const [isScanning, setIsScanning] = useState(false);
    const [scanError, setScanError] = useState<string | null>(null);

    // Selection & Preview
    const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
    const [emailBodyLoading, setEmailBodyLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // Multi-select & bulk actions
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isBulkProcessing, setIsBulkProcessing] = useState(false);
    const [showForwardModal, setShowForwardModal] = useState(false);
    const [forwardEmail, setForwardEmail] = useState('');

    // Auto-scan
    const [autoScanEnabled, setAutoScanEnabled] = useState<boolean>(() => {
        try { return localStorage.getItem('sx-auto-scan') === 'true'; } catch { return false; }
    });
    const [lastAutoScan, setLastAutoScan] = useState<Date | null>(null);
    const [autoScanRunning, setAutoScanRunning] = useState(false);
    const autoScanRunningRef = useRef(false);
    const autoScanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const iframeRef = useRef<HTMLIFrameElement>(null);

    // ─── Port normalization (same as AiUpload) ─────────────────────
    const normalizePort = useCallback((rawInput: any): string => {
        const raw = String(rawInput || '');
        if (!raw) return '';
        if (!ports || ports.length === 0) return raw;

        const cleanRaw = raw.toUpperCase().trim();
        const exactCodeMatch = ports.find(p => p.code && p.code.toUpperCase() === cleanRaw);
        if (exactCodeMatch) return exactCodeMatch.code;

        const inputTokens = new Set(cleanRaw.split(/[^A-Z0-9]+/).filter(t => t.length >= 3));
        if (inputTokens.size === 0) return raw;

        let bestMatch: Port | null = null;
        let maxScore = 0;

        for (const port of ports) {
            if (!port.code || !port.name) continue;
            const pName = port.name.toUpperCase().trim();
            const pCode = port.code.toUpperCase().trim();
            let score = 0;

            if (inputTokens.has(pCode)) score += 200;

            const nameTokens: string[] = pName.split(/[^A-Z0-9]+/).filter(t => t.length >= 3);
            let commonCount = 0;
            for (const token of nameTokens) {
                if (inputTokens.has(token)) commonCount++;
            }
            if (commonCount > 0) {
                score += commonCount * 50;
                if (commonCount === nameTokens.length) score += 100;
            }
            if (score === 0 && cleanRaw.includes(pName) && pName.length > 3) score += 20;

            if (score > maxScore) { maxScore = score; bestMatch = port; }
        }

        return (bestMatch && maxScore >= 50) ? bestMatch.code : raw;
    }, [ports]);

    // ─── Auth ─────────────────────────────────────────────────────
    useEffect(() => {
        const init = async () => {
            try {
                await initializeMsal();
                const account = getAccountFor(MSAL_KEY);
                if (account) {
                    setIsConnected(true);
                    setConnectedEmail(account.username || account.name || '');
                } else {
                    setIsConnected(false);
                }
            } catch {
                setIsConnected(false);
            }
        };
        init();
    }, []);

    // Auto-load folders + inbox when connected
    useEffect(() => {
        if (isConnected) {
            fetchFolders();
            scanEmails('inbox');
        }
    }, [isConnected]);

    const handleSignIn = async () => {
        setIsConnecting(true);
        try {
            await loginFor(MSAL_KEY, loginRequest.scopes);
        } catch (e: any) {
            if (!e.message?.includes('Redirecting')) {
                setScanError('Sign-in failed. Please try again.');
                setIsConnecting(false);
            }
        }
    };

    const handleSignOut = async () => {
        try {
            await logoutFor(MSAL_KEY);
            setIsConnected(false);
            setConnectedEmail('');
            setEmails([]);
            setFolders([]);
            setSelectedEmailId(null);
        } catch (e) {
            console.error('Logout failed', e);
        }
    };

    const acquireToken = async (): Promise<string> => {
        const token = await getTokenFor(MSAL_KEY, loginRequest.scopes);
        if (token) return token;
        throw new Error('No valid access token. Please sign in.');
    };

    // ─── Folder fetch ─────────────────────────────────────────────
    const fetchFolders = async () => {
        try {
            const token = await acquireToken();
            const resp = await fetch(
                'https://graph.microsoft.com/v1.0/me/mailFolders?$top=50&$select=id,displayName,unreadItemCount,totalItemCount',
                { headers: { 'Authorization': `Bearer ${token}` } }
            );
            if (!resp.ok) return;
            const data = await resp.json();
            const raw: MailFolder[] = (data.value || []).map((f: any) => ({
                id: f.id,
                displayName: f.displayName,
                unreadItemCount: f.unreadItemCount || 0,
                totalItemCount: f.totalItemCount || 0,
            }));
            setFolders(raw);
        } catch (e) {
            console.error('Folder fetch error:', e);
        }
    };

    // ─── Email list fetch ─────────────────────────────────────────
    const scanEmails = async (folderId?: string) => {
        const targetFolder = folderId || selectedFolderId;
        setIsScanning(true);
        setScanError(null);
        setEmails([]);
        setSelectedEmailId(null);

        try {
            const token = await acquireToken();
            const resp = await fetch(
                `https://graph.microsoft.com/v1.0/me/mailFolders/${targetFolder}/messages?$orderby=receivedDateTime DESC&$top=50&$select=id,subject,from,receivedDateTime,hasAttachments,bodyPreview,isRead`,
                { headers: { 'Authorization': `Bearer ${token}` } }
            );

            if (!resp.ok) {
                const errText = await resp.text();
                throw new Error(`Graph API Error (${resp.status}): ${errText}`);
            }

            const data = await resp.json();
            const messages = data.value || [];
            const newEmails: EmailMessage[] = messages.map((msg: any) => ({
                id: msg.id,
                subject: msg.subject || '(No Subject)',
                from: msg.from?.emailAddress?.address || 'Unknown',
                fromName: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || 'Unknown',
                receivedDateTime: msg.receivedDateTime,
                hasAttachments: !!msg.hasAttachments,
                provider: 'OUTLOOK' as const,
                accountEmail: connectedEmail,
                status: 'PENDING' as const,
                bodyPreview: msg.bodyPreview || '',
                isRead: !!msg.isRead,
            }));

            setEmails(newEmails);
            setIsConnected(true);
        } catch (e: any) {
            if (e.message?.includes('No account selected') || e.message?.includes('No valid access token')) {
                setIsConnected(false);
                setScanError('Not signed in. Please sign in with your Microsoft account.');
            } else {
                setScanError(e.message || 'Failed to scan emails.');
            }
        } finally {
            setIsScanning(false);
        }
    };

    // ─── On-demand body fetch ─────────────────────────────────────
    const fetchEmailBody = async (emailId: string) => {
        setEmailBodyLoading(true);
        try {
            const token = await acquireToken();
            // 1. Fetch body + recipients
            const resp = await fetch(
                `https://graph.microsoft.com/v1.0/me/messages/${emailId}?$select=body,toRecipients,ccRecipients`,
                { headers: { 'Authorization': `Bearer ${token}` } }
            );
            if (!resp.ok) throw new Error('Failed to fetch email body');
            const data = await resp.json();

            let htmlContent = data.body?.content || '';
            let fetchedAttachments: EmailAttachment[] = [];
            let firstNonInline: EmailAttachment | undefined;

            // 2. Fetch attachments (for both CID resolution and attachment list)
            try {
                const attResp = await fetch(
                    `https://graph.microsoft.com/v1.0/me/messages/${emailId}/attachments`,
                    { headers: { 'Authorization': `Bearer ${token}` } }
                );
                if (attResp.ok) {
                    const attData = await attResp.json();
                    for (const att of (attData.value || [])) {
                        // Resolve CID inline images
                        if (att.isInline && att.contentId && att.contentBytes && data.body?.contentType === 'html') {
                            const dataUri = `data:${att.contentType || 'image/png'};base64,${att.contentBytes}`;
                            htmlContent = htmlContent.replace(
                                new RegExp(`cid:${att.contentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi'),
                                dataUri
                            );
                        }
                        // Build attachment list
                        fetchedAttachments.push({
                            id: att.id, name: att.name, contentType: att.contentType,
                            size: att.size, isInline: att.isInline
                        });
                    }
                    firstNonInline = fetchedAttachments.find(a => !a.isInline) || fetchedAttachments[0];
                }
            } catch { /* attachment fetch is best-effort */ }

            setEmails(prev => prev.map(e => e.id === emailId ? {
                ...e,
                body: { contentType: data.body?.contentType || 'text', content: htmlContent },
                toRecipients: (data.toRecipients || []).map((r: any) => ({
                    name: r.emailAddress?.name || '',
                    address: r.emailAddress?.address || ''
                })),
                ccRecipients: (data.ccRecipients || []).map((r: any) => ({
                    name: r.emailAddress?.name || '',
                    address: r.emailAddress?.address || ''
                })),
                ...(fetchedAttachments.length > 0 ? {
                    attachments: fetchedAttachments,
                    ...(firstNonInline ? {
                        attachmentId: firstNonInline.id,
                        attachmentName: firstNonInline.name,
                        attachmentType: firstNonInline.contentType
                    } : {})
                } : {}),
            } : e));
        } catch (e) {
            console.error('Body fetch error:', e);
        } finally {
            setEmailBodyLoading(false);
        }
    };

    const fetchAttachmentList = async (emailId: string) => {
        try {
            const token = await acquireToken();
            const resp = await fetch(
                `https://graph.microsoft.com/v1.0/me/messages/${emailId}/attachments?$select=id,name,contentType,size,isInline`,
                { headers: { 'Authorization': `Bearer ${token}` } }
            );
            if (!resp.ok) return;
            const data = await resp.json();
            const attachments: EmailAttachment[] = (data.value || []).map((a: any) => ({
                id: a.id, name: a.name, contentType: a.contentType,
                size: a.size, isInline: a.isInline
            }));

            // Also set first non-inline attachment for processing
            const firstAtt = attachments.find(a => !a.isInline) || attachments[0];

            setEmails(prev => prev.map(e => e.id === emailId ? {
                ...e,
                attachments,
                ...(firstAtt ? {
                    attachmentId: firstAtt.id,
                    attachmentName: firstAtt.name,
                    attachmentType: firstAtt.contentType
                } : {})
            } : e));
        } catch { /* silently fail */ }
    };

    // ─── Mark as read ─────────────────────────────────────────────
    const markAsRead = async (emailId: string) => {
        try {
            const token = await acquireToken();
            await fetch(`https://graph.microsoft.com/v1.0/me/messages/${emailId}`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ isRead: true })
            });
            setEmails(prev => prev.map(e => e.id === emailId ? { ...e, isRead: true } : e));
        } catch { /* non-blocking */ }
    };

    // ─── Select email ─────────────────────────────────────────────
    const handleSelectEmail = async (email: EmailMessage) => {
        setSelectedEmailId(email.id);

        if (!email.isRead) markAsRead(email.id);
        if (!email.body) fetchEmailBody(email.id);
        if (email.hasAttachments && !email.attachments) fetchAttachmentList(email.id);
    };

    // ─── Select folder ────────────────────────────────────────────
    const handleFolderClick = (graphId: string, label: string) => {
        setSelectedFolderId(graphId);
        setSelectedFolderName(label);
        setSmartFilter('none');
        setSelectedIds(new Set());
        setSearchQuery('');
        scanEmails(graphId);
    };

    const handleSmartFilter = (filter: 'unread' | 'attachments') => {
        setSmartFilter(filter);
        setSelectedFolderName(filter === 'unread' ? 'Not Read' : 'Attachments');
        setSelectedIds(new Set());
        setSearchQuery('');
        // For "Not Read", load inbox first if not already on it
        if (filter === 'unread' && selectedFolderId !== 'inbox') {
            setSelectedFolderId('inbox');
            scanEmails('inbox');
        }
    };

    // ─── Doc OCR: Parse JSON from Gemini extraction ──────────────
    const parseExtractionJson = (jsonText: string): any | null => {
        try {
            let cleanText = jsonText;
            if (cleanText.startsWith('"') && cleanText.includes('\\"')) {
                cleanText = cleanText.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '').replace(/\\\\/g, '\\').trim();
            }
            const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return null;
            return JSON.parse(jsonMatch[0]);
        } catch {
            return null;
        }
    };

    // ─── Doc OCR: Auto-save to Supabase ──────────────────────────
    const autoSaveToDatabase = useCallback(async (docType: string, data: any, docUrl: string = ''): Promise<boolean> => {
        const companyId = currentCompanyId || 'ALL';
        const created = new Date().toISOString();
        const client = getSupabaseClient();

        try {
            if (docType === 'BILL OF LADING' && onSaveBL) {
                const pol = normalizePort(String(data.PORT_LOADING || ''));
                const pod = normalizePort(String(data.PORT_DISCHARGE || ''));

                const blData: BillOfLading = {
                    id: `BL${Date.now()}`, companyId, createdAt: created,
                    blNumber: String(data.DOC_NUMBER || ''),
                    shipper: String(data.SHIPPER || ''),
                    consignee: String(data.CONSIGNEE || ''),
                    notifyParty: String(data.NOTIFY || ''),
                    vesselVoyage: String(data.VESSEL_VOYAGE || ''),
                    portLoading: pol, portDischarge: pod,
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
                    originalDocument: docUrl,
                    status: 'AVAILABLE'
                };
                await onSaveBL(blData);

                // Update corresponding booking to 'AVAILABLE'
                if (client && blData.vesselVoyage && blData.consignee) {
                    const { data: bookings } = await client.from('bookings').select('id, bookingNumber, salesOrderId, customer, status')
                        .eq('vesselVoyage', blData.vesselVoyage)
                        .or('status.eq.ACTIVE,status.eq.REQUESTED');
                    if (bookings) {
                        const matchingBooking = bookings.find((b: any) =>
                            b.customer && blData.consignee.toLowerCase().includes(b.customer.toLowerCase())
                        );
                        if (matchingBooking) {
                            await client.from('bookings').update({ status: 'AVAILABLE' }).eq('id', matchingBooking.id);
                        }
                    }
                }
                return true;

            } else if (docType === 'BOOKING' && onSaveBooking) {
                const pol = normalizePort(String(data.POL || ''));
                const pod = normalizePort(String(data.POD || ''));
                await onSaveBooking({
                    id: `BK${Date.now()}`, companyId, createdAt: created,
                    bookingNumber: String(data.DOC_NUMBER || ''),
                    customer: String(data.CUSTOMER || ''),
                    agentName: String(data.CARGO_AGENT || ''),
                    vesselVoyage: String(data.VESSEL_VOYAGE || ''),
                    pol, pod,
                    equipment: String(data.EQUIPMENT || ''),
                    etd: String(data.ETD || ''), eta: String(data.ETA || ''),
                    cargoCutOff: String(data.CARGO_CUT_OFF || ''),
                    vgmCutOff: String(data.VGM_CUT_OFF || ''),
                    draftCutOff: String(data.DRAFT_CUT_OFF || ''),
                    freeTime: String(data.FREE_TIME || ''),
                    terminal: String(data.TERMINAL || ''),
                    originalDocument: docUrl, status: 'AVAILABLE'
                });
                return true;

            } else if (docType === 'ESTIMATE' && onSaveEstimate) {
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
                    originalDocument: docUrl
                });
                return true;

            } else if (docType === 'PROFORMA INVOICE' && onSaveProforma) {
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
                    originalDocument: docUrl
                });
                return true;

            } else if (docType === 'PURCHASE ORDER' && onSavePO) {
                await onSavePO({
                    id: `PO${Date.now()}`, companyId, createdAt: created,
                    poNumber: String(data.DOC_NUMBER || ''),
                    vendor: String(data.SELLER_NAME || data.VENDOR_NAME || ''),
                    date: String(data.DATE || ''),
                    totalAmount: String(data.TOTAL_AMOUNT || ''),
                    currency: String(data.CURRENCY || ''),
                    items: JSON.stringify(data.ITEMS || []),
                    originalDocument: docUrl
                });
                return true;

            } else if (docType === 'INVOICE' && onSaveSupplierInvoice) {
                await onSaveSupplierInvoice({
                    id: `INV${Date.now()}`, companyId, createdAt: created,
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
                    originalDocument: docUrl
                });
                return true;

            } else if (docType === 'PACKING LIST' && onSavePackingList) {
                await onSavePackingList({
                    id: `PL${Date.now()}`, companyId, createdAt: created,
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
                    originalDocument: docUrl
                });
                return true;
            } else if (docType === 'FREIGHT QUOTE') {
                const client = getSupabaseClient();
                if (client) {
                    const originPort = normalizePort(String(data.ORIGIN_PORT || ''));
                    const destPort = normalizePort(String(data.DESTINATION_PORT || ''));
                    await client.from('freight_quotes').insert({
                        id: `FQ${Date.now()}`,
                        companyId,
                        createdAt: created,
                        agentName: String(data.AGENT_NAME || ''),
                        carrier: String(data.CARRIER || ''),
                        freightType: String(data.FREIGHT_TYPE || 'PORT_PORT'),
                        originPort,
                        originPortCode: String(data.ORIGIN_PORT_CODE || ''),
                        destinationPort: destPort,
                        destinationPortCode: String(data.DESTINATION_PORT_CODE || ''),
                        pickupLocation: String(data.PICKUP_LOCATION || ''),
                        pickupZip: String(data.PICKUP_ZIP || ''),
                        deliveryLocation: String(data.DELIVERY_LOCATION || ''),
                        deliveryZip: String(data.DELIVERY_ZIP || ''),
                        rate: Number(data.RATE || 0),
                        chassis: Number(data.CHASSIS || 0),
                        overweight: Number(data.OVERWEIGHT || 0),
                        containerCount: Number(data.CONTAINER_COUNT || 1),
                        currency: String(data.CURRENCY || 'USD'),
                        validUntil: String(data.VALID_UNTIL || ''),
                        comments: String(data.COMMENTS || ''),
                        transitTime: Number(data.TRANSIT_TIME || 0),
                        freeTime: Number(data.FREE_TIME || 0),
                        isAllIn: Boolean(data.IS_ALL_IN),
                        pickupCost: Number(data.PICKUP_COST || 0),
                        oceanCost: Number(data.OCEAN_COST || 0),
                        deliveryCost: Number(data.DELIVERY_COST || 0),
                        portFees: Number(data.PORT_FEES || 0),
                        deconsolidation: Number(data.DECONSOLIDATION || 0),
                        containerReturn: Number(data.CONTAINER_RETURN || 0),
                        blRelease: Number(data.BL_RELEASE || 0),
                        thc: Number(data.THC || 0),
                        isps: Number(data.ISPS || 0),
                        trs: Number(data.TRS || 0),
                        securityFee: Number(data.SECURITY_FEE || 0),
                        observation: String(data.OBSERVATION || ''),
                        status: 'ACTIVE'
                    });
                    return true;
                }
                return false;

            } else if (docType === 'COMMISSION SALES ORDER' || docType === 'COMMISSION INVOICE') {
                const client = getSupabaseClient();
                if (client) {
                    const items = Array.isArray(data.items) ? data.items.map((item: any, idx: number) => ({
                        id: `item_${Date.now()}_${idx}`,
                        productName: String(item.productName || ''),
                        quantity: Number(item.quantity || 0),
                        unit: String(item.unit || 'LBS'),
                        pricePerUnit: Number(item.pricePerUnit || 0),
                        total: Number(item.total || 0)
                    })) : [];
                    const orderTotal = items.reduce((sum: number, i: any) => sum + (Number(i.total) || 0), 0);

                    const pod = normalizePort(String(data.pod || ''));
                    const pol = normalizePort(String(data.pol || ''));

                    await client.from('commission_sales_orders').insert({
                        id: `COM${Date.now()}`,
                        companyId,
                        createdAt: created,
                        orderNumber: String(data.orderNumber || ''),
                        sellerName: String(data.sellerName || ''),
                        customerName: String(data.customerName || ''),
                        incoterm: String(data.incoterm || ''),
                        paymentTerms: String(data.paymentTerms || ''),
                        pod,
                        pol: pol || undefined,
                        deliveryDate: String(data.deliveryDate || ''),
                        etd: data.etd ? String(data.etd) : undefined,
                        eta: data.eta ? String(data.eta) : undefined,
                        bookingNumber: data.bookingNumber ? String(data.bookingNumber) : undefined,
                        vesselVoyage: data.vesselVoyage ? String(data.vesselVoyage) : undefined,
                        containerNumbers: data.containerNumbers ? String(data.containerNumbers) : undefined,
                        invoiceNumber: docType === 'COMMISSION INVOICE' ? String(data.orderNumber || '') : undefined,
                        items,
                        orderTotal,
                        commissionRate: 0,
                        commissionType: 'PERCENT',
                        commissionAmount: 0,
                        totalQuantity: items.reduce((sum: number, i: any) => sum + (Number(i.quantity) || 0), 0),
                        status: docType === 'COMMISSION INVOICE' ? 'APPROVED' : 'DRAFT',
                        invoiceStatus: docType === 'COMMISSION INVOICE' ? 'UNPAID' : undefined,
                        commissionPaymentStatus: 'UNPAID',
                        originalDocumentUrl: docUrl
                    });
                    return true;
                }
                return false;
            }

            return false; // No matching save handler
        } catch (err) {
            console.error('Auto-save to DB failed:', err);
            return false;
        }
    }, [currentCompanyId, normalizePort, onSaveBL, onSaveBooking, onSaveEstimate, onSaveProforma, onSavePO, onSaveSupplierInvoice, onSavePackingList]);

    // ─── Auto-scan interval ───────────────────────────────────────
    const runAutoScan = useCallback(async () => {
        if (autoScanRunningRef.current || !isConnected) return;
        autoScanRunningRef.current = true;
        setAutoScanRunning(true);

        // Notify XS AI that scan is starting
        window.dispatchEvent(new CustomEvent('sx-doc-saved', {
            detail: { message: `🔄 **Email Auto-Scan** started at ${new Date().toLocaleTimeString()}...` }
        }));

        const results: Array<{ subject: string; from: string; docType: string; saved: boolean }> = [];
        try {
            const token = await acquireToken();

            // Fetch recent inbox messages (no $filter — causes 400 with $orderby)
            const resp = await fetch(
                `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$orderby=receivedDateTime DESC&$top=50&$select=id,subject,from,receivedDateTime,hasAttachments,bodyPreview,isRead`,
                { headers: { 'Authorization': `Bearer ${token}` } }
            );
            if (!resp.ok) { autoScanRunningRef.current = false; setAutoScanRunning(false); return; }
            const data = await resp.json();
            // Filter client-side: unread + has attachments
            const unreadWithAtt: any[] = (data.value || []).filter((m: any) => !m.isRead && m.hasAttachments);

            for (const msg of unreadWithAtt) {
                try {
                    // Fetch attachments list
                    const attResp = await fetch(
                        `https://graph.microsoft.com/v1.0/me/messages/${msg.id}/attachments?$select=id,name,contentType,size,isInline`,
                        { headers: { 'Authorization': `Bearer ${token}` } }
                    );
                    if (!attResp.ok) continue;
                    const attData = await attResp.json();
                    const attachments = (attData.value || []).filter((a: any) => !a.isInline && (a.contentType?.includes('pdf') || a.contentType?.includes('image')));
                    if (attachments.length === 0) {
                        // Mark as read even if no processable attachments
                        await fetch(`https://graph.microsoft.com/v1.0/me/messages/${msg.id}`, {
                            method: 'PATCH',
                            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ isRead: true })
                        });
                        continue;
                    }

                    for (const att of attachments) {
                        // Download attachment
                        const dlResp = await fetch(
                            `https://graph.microsoft.com/v1.0/me/messages/${msg.id}/attachments/${att.id}/$value`,
                            { headers: { 'Authorization': `Bearer ${token}` } }
                        );
                        if (!dlResp.ok) continue;
                        const blob = await dlResp.blob();
                        const base64Content = await new Promise<string>((resolve) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
                            reader.readAsDataURL(blob);
                        });

                        if (!base64Content) continue;

                        const mimeType = att.contentType || 'application/pdf';
                        const docUrl = `data:${mimeType};base64,${base64Content}`;

                        // Classify
                        const identifyRaw = await analyzeDocument(base64Content, mimeType, IDENTIFICATION_PROMPT);
                        const docType = String(identifyRaw).replace(/[\*\"]/g, '').trim().toUpperCase();

                        // Extract
                        const extractionPrompt = EXTRACTION_PROMPTS[docType];
                        let extractedData: any = null;
                        let saved = false;

                        if (extractionPrompt) {
                            const extractRaw = await analyzeDocument(base64Content, mimeType, extractionPrompt);
                            const extractStr = typeof extractRaw === 'string' ? extractRaw : String(extractRaw);
                            extractedData = parseExtractionJson(extractStr);
                        }

                        if (extractedData && docType !== 'OTHER') {
                            saved = await autoSaveToDatabase(docType, extractedData, docUrl);
                        }

                        // Notify XS Agent per document
                        if (saved) {
                            const fromName = msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || 'Unknown';
                            const docRef = extractedData?.DOC_NUMBER || extractedData?.INVOICE_NUMBER || extractedData?.orderNumber || extractedData?.AGENT_NAME || '';

                            // Build compact items summary
                            const rawItems = extractedData?.ITEMS || extractedData?.items;
                            const itemsArr = Array.isArray(rawItems) ? rawItems : (typeof rawItems === 'string' ? (() => { try { return JSON.parse(rawItems); } catch { return []; } })() : []);
                            let itemsLine = '';
                            if (itemsArr.length > 0) {
                                const lines = itemsArr.slice(0, 4).map((it: any) => {
                                    const desc = it.description || it.productName || it.activity || '—';
                                    const qty = it.quantity || it.qty || '';
                                    const unit = it.unit || it.unit_of_measure || '';
                                    const price = it.unit_price || it.pricePerUnit || it.rate || '';
                                    const total = it.total || it.amount || '';
                                    let line = `• ${desc}`;
                                    if (qty) line += ` — ${Number(qty).toLocaleString()} ${unit}`;
                                    if (price) line += ` @ $${Number(price).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
                                    if (total) line += ` = $${Number(total).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
                                    return line;
                                });
                                if (itemsArr.length > 4) lines.push(`• ...+${itemsArr.length - 4} more`);
                                itemsLine = '\n' + lines.join('\n');
                            }

                            const totalAmt = extractedData?.TOTAL_AMOUNT || extractedData?.orderTotal;
                            const currency = extractedData?.CURRENCY || extractedData?.currency || 'USD';
                            const totalLine = totalAmt ? `\n**Total: ${currency} ${Number(totalAmt).toLocaleString(undefined, { minimumFractionDigits: 2 })}**` : '';

                            const compact = `📩 **${docType}**${docRef ? ` #${docRef}` : ''} from *${fromName}* — saved ✅${itemsLine}${totalLine}`;
                            window.dispatchEvent(new CustomEvent('sx-doc-saved', { detail: { message: compact } }));
                        }

                        results.push({
                            subject: msg.subject || '(No Subject)',
                            from: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || 'Unknown',
                            docType,
                            saved
                        });
                    }

                    // Mark as read after processing all attachments
                    await fetch(`https://graph.microsoft.com/v1.0/me/messages/${msg.id}`, {
                        method: 'PATCH',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ isRead: true })
                    });
                } catch (e) {
                    console.error('Auto-scan: failed to process email', msg.id, e);
                }
            }

            // Report to SX Assistant
            if (results.length > 0) {
                const lines = results.map((r, i) => `${i + 1}. **${r.docType}** from *${r.from}* — "${r.subject}" ${r.saved ? '✅ Saved' : '⚠️ Not saved'}`);
                const report = `📧 **Auto Scan Complete** (${new Date().toLocaleTimeString()})\n\nProcessed ${results.length} email(s) with attachments:\n${lines.join('\n')}`;
                window.dispatchEvent(new CustomEvent('sx-auto-scan-report', { detail: { report } }));
            } else {
                window.dispatchEvent(new CustomEvent('sx-doc-saved', {
                    detail: { message: `✅ **Auto-Scan Complete** (${new Date().toLocaleTimeString()}) — No new documents found. Next scan in 15 min.` }
                }));
            }

            setLastAutoScan(new Date());
        } catch (e) {
            console.error('Auto-scan error:', e);
        } finally {
            autoScanRunningRef.current = false;
            setAutoScanRunning(false);
        }
    }, [isConnected, autoSaveToDatabase]);

    useEffect(() => {
        if (autoScanEnabled && isConnected) {
            // Run immediately on enable
            runAutoScan();
            // Then every 15 minutes
            autoScanIntervalRef.current = setInterval(runAutoScan, 15 * 60 * 1000);
        } else {
            if (autoScanIntervalRef.current) {
                clearInterval(autoScanIntervalRef.current);
                autoScanIntervalRef.current = null;
            }
        }
        return () => {
            if (autoScanIntervalRef.current) {
                clearInterval(autoScanIntervalRef.current);
                autoScanIntervalRef.current = null;
            }
        };
    }, [autoScanEnabled, isConnected, runAutoScan]);

    const toggleAutoScan = () => {
        const next = !autoScanEnabled;
        setAutoScanEnabled(next);
        try { localStorage.setItem('sx-auto-scan', String(next)); } catch { }
    };

    // ─── Process email attachment (full Doc OCR pipeline) ─────────
    const processEmail = async (email: EmailMessage) => {
        setEmails(prev => prev.map(e => e.id === email.id ? { ...e, status: 'PROCESSING' } : e));

        try {
            const token = await acquireToken();

            // Mark as Read
            await fetch(`https://graph.microsoft.com/v1.0/me/messages/${email.id}`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ isRead: true })
            });

            // Determine attachments to process
            const nonInlineAttachments = (email.attachments || []).filter(a => !a.isInline);
            const attachmentsToProcess = nonInlineAttachments.length > 0
                ? nonInlineAttachments
                : (email.attachmentId ? [{ id: email.attachmentId, name: email.attachmentName || 'Attachment', contentType: email.attachmentType || 'application/pdf', size: 0, isInline: false }] : []);

            if (attachmentsToProcess.length === 0) throw new Error('No attachments to process');

            const allResults: Array<{ docType: string; data: any; attachmentName: string; saved: boolean }> = [];

            for (const att of attachmentsToProcess) {
                // Download attachment
                const url = `https://graph.microsoft.com/v1.0/me/messages/${email.id}/attachments/${att.id}/$value`;
                const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
                if (!resp.ok) { console.error(`Download failed for ${att.name}`); continue; }
                const blob = await resp.blob();

                const base64Content = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const res = reader.result as string;
                        resolve(res.split(',')[1]);
                    };
                    reader.readAsDataURL(blob);
                });

                if (!base64Content) { console.error(`Empty content for ${att.name}`); continue; }

                const mimeType = att.contentType || 'application/pdf';
                const docUrl = `data:${mimeType};base64,${base64Content}`;

                // Step 1: Classify document type
                const identifyRaw = await analyzeDocument(base64Content, mimeType, IDENTIFICATION_PROMPT);
                const docType = String(identifyRaw).replace(/[\*\"]/g, '').trim().toUpperCase();

                // Step 2: Extract structured data
                const extractionPrompt = EXTRACTION_PROMPTS[docType];
                let extractedData: any = null;

                if (extractionPrompt) {
                    const extractRaw = await analyzeDocument(base64Content, mimeType, extractionPrompt);
                    const extractStr = typeof extractRaw === 'string' ? extractRaw : String(extractRaw);
                    extractedData = parseExtractionJson(extractStr);
                } else {
                    const fallbackPrompt = `Extract structured data from this document. Identify document type and key fields. Return JSON.`;
                    const rawAnalysis: any = await analyzeDocument(base64Content, mimeType, fallbackPrompt);
                    const rawStr = typeof rawAnalysis === 'string' ? rawAnalysis : String(rawAnalysis);
                    extractedData = parseExtractionJson(rawStr);
                }

                // Step 3: Auto-save to Supabase with the PDF
                let saved = false;
                if (extractedData && docType !== 'OTHER') {
                    saved = await autoSaveToDatabase(docType, extractedData, docUrl);
                }

                allResults.push({ docType, data: extractedData, attachmentName: att.name, saved });
            }

            // Move to Deleted Items (if in Inbox)
            if (selectedFolderId === 'inbox' && allResults.length > 0) {
                await fetch(`https://graph.microsoft.com/v1.0/me/messages/${email.id}/move`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ destinationId: 'deleteditems' })
                });
            }

            // Build analysis text for sidebar
            const anySaved = allResults.some(r => r.saved);
            const firstDocType = allResults[0]?.docType || '';
            const analysisText = JSON.stringify(allResults.map(r => ({
                attachmentName: r.attachmentName,
                docType: r.docType,
                saved: r.saved,
                ...(r.data || {})
            })), null, 2);

            setEmails(prev => prev.map(e => e.id === email.id ? {
                ...e,
                status: 'PROCESSED',
                analysisResult: analysisText,
                isRead: true,
                docType: allResults.length === 1 ? firstDocType : `${allResults.length} DOCS`,
                savedToDb: anySaved
            } : e));
        } catch (e) {
            console.error('Processing failed', e);
            setEmails(prev => prev.map(e => e.id === email.id ? { ...e, status: 'ERROR' } : e));
        }
    };

    // ─── Multi-select helpers ─────────────────────────────────────
    const toggleSelect = (id: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === displayedEmails.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(displayedEmails.map(e => e.id)));
        }
    };

    // ─── Bulk Actions ─────────────────────────────────────────────
    const bulkDelete = async () => {
        if (selectedIds.size === 0) return;
        setIsBulkProcessing(true);
        try {
            const token = await acquireToken();
            for (const id of Array.from(selectedIds)) {
                await fetch(`https://graph.microsoft.com/v1.0/me/messages/${id}/move`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ destinationId: 'deleteditems' })
                });
            }
            if (selectedEmailId && selectedIds.has(selectedEmailId)) setSelectedEmailId(null);
            setEmails(prev => prev.filter(e => !selectedIds.has(e.id)));
            setSelectedIds(new Set());
            fetchFolders();
        } catch (e: any) {
            setScanError(e.message || 'Failed to delete emails.');
        } finally {
            setIsBulkProcessing(false);
        }
    };

    const bulkSpam = async () => {
        if (selectedIds.size === 0) return;
        setIsBulkProcessing(true);
        try {
            const token = await acquireToken();
            for (const id of Array.from(selectedIds)) {
                await fetch(`https://graph.microsoft.com/v1.0/me/messages/${id}/move`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ destinationId: 'junkemail' })
                });
            }
            if (selectedEmailId && selectedIds.has(selectedEmailId)) setSelectedEmailId(null);
            setEmails(prev => prev.filter(e => !selectedIds.has(e.id)));
            setSelectedIds(new Set());
            fetchFolders();
        } catch (e: any) {
            setScanError(e.message || 'Failed to mark as spam.');
        } finally {
            setIsBulkProcessing(false);
        }
    };

    const bulkForward = async () => {
        if (selectedIds.size === 0 || !forwardEmail.trim()) return;
        setIsBulkProcessing(true);
        try {
            const token = await acquireToken();
            for (const id of Array.from(selectedIds)) {
                const fwdResp = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${id}/createForward`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ toRecipients: [{ emailAddress: { address: forwardEmail.trim() } }] })
                });
                if (fwdResp.ok) {
                    const draft = await fwdResp.json();
                    await fetch(`https://graph.microsoft.com/v1.0/me/messages/${draft.id}/send`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                }
            }
            setSelectedIds(new Set());
            setShowForwardModal(false);
            setForwardEmail('');
        } catch (e: any) {
            setScanError(e.message || 'Failed to forward emails.');
        } finally {
            setIsBulkProcessing(false);
        }
    };

    // ─── Single-email actions ─────────────────────────────────────
    const singleDelete = async (emailId: string) => {
        setIsBulkProcessing(true);
        try {
            const token = await acquireToken();
            await fetch(`https://graph.microsoft.com/v1.0/me/messages/${emailId}/move`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ destinationId: 'deleteditems' })
            });
            if (selectedEmailId === emailId) setSelectedEmailId(null);
            setEmails(prev => prev.filter(e => e.id !== emailId));
            setSelectedIds(prev => { const next = new Set(prev); next.delete(emailId); return next; });
            fetchFolders();
        } catch (e: any) {
            setScanError(e.message || 'Failed to delete email.');
        } finally {
            setIsBulkProcessing(false);
        }
    };

    const singleSpam = async (emailId: string) => {
        setIsBulkProcessing(true);
        try {
            const token = await acquireToken();
            await fetch(`https://graph.microsoft.com/v1.0/me/messages/${emailId}/move`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ destinationId: 'junkemail' })
            });
            if (selectedEmailId === emailId) setSelectedEmailId(null);
            setEmails(prev => prev.filter(e => e.id !== emailId));
            setSelectedIds(prev => { const next = new Set(prev); next.delete(emailId); return next; });
            fetchFolders();
        } catch (e: any) {
            setScanError(e.message || 'Failed to mark as spam.');
        } finally {
            setIsBulkProcessing(false);
        }
    };

    const singleForward = (emailId: string) => {
        setSelectedIds(new Set([emailId]));
        setShowForwardModal(true);
    };

    // ─── Computed ─────────────────────────────────────────────────
    const displayedEmails = useMemo(() => {
        let filtered = emails;

        // Smart filters
        if (smartFilter === 'unread') filtered = filtered.filter(e => !e.isRead);
        if (smartFilter === 'attachments') filtered = filtered.filter(e => e.hasAttachments);

        // Search
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(e =>
                e.fromName.toLowerCase().includes(q) ||
                e.from.toLowerCase().includes(q) ||
                e.subject.toLowerCase().includes(q) ||
                e.bodyPreview.toLowerCase().includes(q)
            );
        }
        return filtered;
    }, [emails, searchQuery, smartFilter]);

    const selectedEmail = useMemo(() => {
        if (!selectedEmailId) return null;
        return emails.find(e => e.id === selectedEmailId) || null;
    }, [emails, selectedEmailId]);

    // Map API folders to their Graph IDs for sidebar display + unread counts
    const folderMap = useMemo(() => {
        const map: Record<string, MailFolder> = {};
        for (const f of folders) {
            const gId = resolveGraphId(f);
            map[gId] = f;
        }
        return map;
    }, [folders]);

    const attachmentCount = useMemo(() => emails.filter(e => e.hasAttachments).length, [emails]);
    const unreadCount = useMemo(() => emails.filter(e => !e.isRead).length, [emails]);

    // ─── Not connected — sign-in prompt ───────────────────────────
    if (isConnected === false && emails.length === 0) {
        return (
            <div className="h-full flex flex-col p-6 space-y-6">
                <div className="mb-6 flex items-start justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-gradient-to-r from-rose-500 to-pink-500 rounded-xl text-white"><Mail size={24} /></div>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-800">AI Email Assistant</h1>
                            <p className="text-slate-500 text-sm mt-1">Automated inbox scanning and document extraction.</p>
                        </div>
                    </div>
                </div>

                {scanError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-center gap-3">
                        <AlertCircle size={20} />
                        {scanError}
                    </div>
                )}

                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center max-w-md space-y-6">
                        <div className="mx-auto w-20 h-20 bg-gradient-to-br from-rose-100 to-pink-100 rounded-2xl flex items-center justify-center">
                            <MailPlus size={36} className="text-rose-500" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-slate-800 mb-2">Connect Your Email</h2>
                            <p className="text-slate-500 text-sm leading-relaxed">
                                Sign in with your Microsoft account to start scanning your inbox for documents and attachments automatically.
                            </p>
                        </div>
                        <div className="flex flex-col items-center gap-3">
                            <button
                                onClick={handleSignIn}
                                disabled={isConnecting}
                                className="flex items-center gap-2 px-6 py-3 bg-rose-500 text-white rounded-xl hover:bg-rose-600 transition-all shadow-lg shadow-rose-200 font-semibold disabled:opacity-50"
                            >
                                {isConnecting ? <Loader2 size={18} className="animate-spin" /> : <LogIn size={18} />}
                                Sign in with Microsoft
                            </button>
                            <p className="text-xs text-slate-400 mt-1">Or configure accounts in Settings → Integrations</p>
                            <button
                                onClick={() => onNavigate?.('SETTINGS', 'INTEGRATIONS')}
                                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-rose-500 transition-colors underline underline-offset-2"
                            >
                                <Settings size={12} />
                                Go to Integrations
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ─── 3-Panel Layout (fixed, no outer scroll) ──────────────────
    return (
        <div className="flex h-full overflow-hidden bg-white">
            {/* ═══ LEFT PANEL: Folder Sidebar ═══ */}
            <div className="w-56 bg-slate-50/80 border-r border-slate-200 flex flex-col shrink-0 overflow-hidden">
                {/* Account header */}
                <div className="p-3 border-b border-slate-200 shrink-0">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rose-500 to-pink-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
                            {connectedEmail?.charAt(0).toUpperCase() || 'M'}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold text-slate-700 truncate">{connectedEmail || 'Outlook'}</p>
                            <p className="text-[10px] text-slate-400">Microsoft 365</p>
                        </div>
                    </div>
                    {/* Auto Scan toggle */}
                    <button
                        onClick={toggleAutoScan}
                        className={`mt-2 w-full flex items-center gap-2 px-1 py-1.5 rounded-lg transition-all text-[11px] font-medium
                            ${autoScanEnabled
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-150'}`}
                    >
                        <div className={`relative w-7 h-[16px] rounded-full transition-colors ${autoScanEnabled ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                            <div className={`absolute top-[2px] w-[12px] h-[12px] rounded-full bg-white shadow transition-transform ${autoScanEnabled ? 'translate-x-[13px]' : 'translate-x-[2px]'}`} />
                        </div>
                        <span>Auto Scan</span>
                        {autoScanRunning && <Loader2 size={11} className="animate-spin ml-auto text-emerald-500" />}
                    </button>
                    {autoScanEnabled && lastAutoScan && (
                        <p className="text-[9px] text-slate-400 mt-0.5 px-1">Last: {lastAutoScan.toLocaleTimeString()}</p>
                    )}
                </div>

                {/* Folders list */}
                <div className="flex-1 overflow-y-auto py-2 px-1.5 min-h-0">
                    {folders.length === 0 ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 size={16} className="animate-spin text-slate-300" />
                        </div>
                    ) : (
                        <>
                            {/* ── Mailboxes ── */}
                            <p className="px-2 text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Mailboxes</p>

                            {/* Not Read (virtual filter) */}
                            {(() => {
                                const isActive = smartFilter === 'unread';
                                return (
                                    <button
                                        onClick={() => handleSmartFilter('unread')}
                                        className={`w-full text-left px-2.5 py-1.5 flex items-center gap-2 rounded-lg mb-0.5 transition-colors
                                            ${isActive ? 'bg-blue-500 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                                    >
                                        <MailOpen size={14} className={isActive ? 'text-white' : 'text-blue-400'} />
                                        <span className="flex-1 truncate text-xs font-medium">Not Read</span>
                                        {unreadCount > 0 && (
                                            <span className={`text-[10px] font-bold ${isActive ? 'text-white/80' : 'text-blue-500'}`}>{unreadCount}</span>
                                        )}
                                    </button>
                                );
                            })()}

                            {/* Real folders: Inbox, Sent, Trash, Spam */}
                            {SIDEBAR_FOLDERS.map(sf => {
                                const folder = folderMap[sf.graphId];
                                const isActive = selectedFolderId === sf.graphId && smartFilter === 'none';
                                const FolderIcon = sf.icon;
                                const unread = folder?.unreadItemCount || 0;

                                return (
                                    <button
                                        key={sf.graphId}
                                        onClick={() => handleFolderClick(sf.graphId, sf.label)}
                                        className={`w-full text-left px-2.5 py-1.5 flex items-center gap-2 rounded-lg mb-0.5 transition-colors
                                            ${isActive ? 'bg-blue-500 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                                    >
                                        <FolderIcon size={14} className={isActive ? 'text-white' : 'text-slate-400'} />
                                        <span className="flex-1 truncate text-xs font-medium">{sf.label}</span>
                                        {unread > 0 && (
                                            <span className={`text-[10px] font-bold ${isActive ? 'text-white/80' : 'text-blue-500'}`}>{unread}</span>
                                        )}
                                    </button>
                                );
                            })}

                            {/* ── Smart Mailboxes ── */}
                            <div className="mt-4 pt-2 border-t border-slate-200">
                                <p className="px-2 text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Smart Mailboxes</p>

                                {/* Attachments smart filter */}
                                {(() => {
                                    const isActive = smartFilter === 'attachments';
                                    return (
                                        <button
                                            onClick={() => handleSmartFilter('attachments')}
                                            className={`w-full text-left px-2.5 py-1.5 flex items-center gap-2 rounded-lg mb-0.5 transition-colors
                                                ${isActive ? 'bg-blue-500 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                                        >
                                            <Paperclip size={14} className={isActive ? 'text-white' : 'text-amber-400'} />
                                            <span className="flex-1 truncate text-xs font-medium">Attachments</span>
                                            {attachmentCount > 0 && (
                                                <span className={`text-[10px] font-bold ${isActive ? 'text-white/80' : 'text-amber-500'}`}>{attachmentCount}</span>
                                            )}
                                        </button>
                                    );
                                })()}
                            </div>
                        </>
                    )}
                </div>

                {/* Bottom actions */}
                <div className="p-2 border-t border-slate-200 shrink-0">
                    <button
                        onClick={handleSignOut}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                        <LogOut size={12} />
                        Sign Out
                    </button>
                </div>
            </div>

            {/* ═══ MIDDLE PANEL: Email List ═══ */}
            <div className="w-[360px] border-r border-slate-200 flex flex-col shrink-0 bg-white overflow-hidden">
                {/* Header */}
                <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/60 shrink-0">
                    <div className="flex items-center justify-between mb-2">
                        <div>
                            <h2 className="text-sm font-bold text-slate-800">{selectedFolderName}</h2>
                            <p className="text-[10px] text-slate-400">{displayedEmails.length} messages</p>
                        </div>
                        <button
                            onClick={() => scanEmails()}
                            disabled={isScanning}
                            className="p-2 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors"
                            title="Refresh"
                        >
                            <RefreshCw size={15} className={isScanning ? 'animate-spin' : ''} />
                        </button>
                    </div>
                    {/* Search */}
                    <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search emails..."
                            className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
                        />
                    </div>
                </div>

                {/* Error */}
                {scanError && (
                    <div className="px-3 py-2 bg-red-50 border-b border-red-200 text-red-600 text-xs flex items-center gap-2 shrink-0">
                        <AlertCircle size={12} />
                        <span className="truncate">{scanError}</span>
                        <button onClick={() => setScanError(null)} className="ml-auto"><X size={12} /></button>
                    </div>
                )}

                {/* Bulk Action Bar */}
                {selectedIds.size > 0 && (
                    <div className="px-3 py-2 bg-indigo-50 border-b border-indigo-100 flex items-center justify-between shrink-0">
                        <span className="text-[10px] font-bold text-indigo-700">{selectedIds.size} selected</span>
                        <div className="flex items-center gap-1">
                            <button onClick={bulkDelete} disabled={isBulkProcessing} className="p-1.5 bg-red-500 text-white rounded-md hover:bg-red-600 disabled:opacity-50 transition-colors" title="Delete">
                                <Trash2 size={12} />
                            </button>
                            <button onClick={() => setShowForwardModal(true)} disabled={isBulkProcessing} className="p-1.5 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 transition-colors" title="Forward">
                                <Forward size={12} />
                            </button>
                            <button onClick={bulkSpam} disabled={isBulkProcessing} className="p-1.5 bg-amber-500 text-white rounded-md hover:bg-amber-600 disabled:opacity-50 transition-colors" title="Spam">
                                <ShieldAlert size={12} />
                            </button>
                            <button onClick={() => setSelectedIds(new Set())} className="p-1.5 text-slate-400 hover:text-slate-600" title="Clear selection">
                                <X size={12} />
                            </button>
                        </div>
                    </div>
                )}

                {/* Email list */}
                <div className="flex-1 overflow-y-auto min-h-0">
                    {isScanning && emails.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                            <Loader2 size={24} className="animate-spin mb-3" />
                            <p className="text-xs">Loading emails...</p>
                        </div>
                    ) : displayedEmails.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                            <Mail size={32} className="mb-3 opacity-20" />
                            <p className="text-xs">{searchQuery ? 'No matching emails.' : 'No emails in this folder.'}</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {displayedEmails.map(email => {
                                const isSelected = email.id === selectedEmailId;
                                const isChecked = selectedIds.has(email.id);

                                return (
                                    <div
                                        key={email.id}
                                        onClick={() => handleSelectEmail(email)}
                                        className={`px-4 py-3 cursor-pointer transition-colors relative group
                                            ${isSelected ? 'bg-blue-50 border-l-[3px] border-blue-500' : 'border-l-[3px] border-transparent hover:bg-slate-50'}
                                            ${isChecked ? 'bg-indigo-50/40' : ''}`}
                                    >
                                        <div className="flex items-start gap-2.5">
                                            {/* Checkbox */}
                                            <input
                                                type="checkbox"
                                                checked={isChecked}
                                                onChange={() => toggleSelect(email.id)}
                                                onClick={e => e.stopPropagation()}
                                                className="mt-1 w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 shrink-0 opacity-0 group-hover:opacity-100 checked:opacity-100 transition-opacity cursor-pointer"
                                            />

                                            {/* Unread dot */}
                                            {!email.isRead && (
                                                <div className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                                            )}

                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between items-baseline gap-2">
                                                    <span className={`text-sm truncate ${!email.isRead ? 'font-bold text-slate-900' : 'font-medium text-slate-600'}`}>
                                                        {email.fromName}
                                                    </span>
                                                    <span className="text-[10px] text-slate-400 shrink-0">
                                                        {formatTime(email.receivedDateTime)}
                                                    </span>
                                                </div>
                                                <p className={`text-xs truncate mt-0.5 ${!email.isRead ? 'font-semibold text-slate-800' : 'text-slate-500'}`}>
                                                    {email.subject}
                                                </p>
                                                <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed mt-0.5">
                                                    {email.bodyPreview}
                                                </p>
                                                <div className="flex items-center gap-2 mt-1">
                                                    {email.hasAttachments && (
                                                        <div className="flex items-center gap-1">
                                                            <Paperclip size={10} className="text-slate-400" />
                                                            <span className="text-[10px] text-slate-400 truncate max-w-[120px]">
                                                                {email.attachmentName || 'Attachment'}
                                                            </span>
                                                        </div>
                                                    )}
                                                    {email.status === 'PROCESSED' && (
                                                        <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 font-semibold">
                                                            <CheckCircle2 size={10} /> Processed
                                                        </span>
                                                    )}
                                                    {email.status === 'PROCESSING' && (
                                                        <span className="flex items-center gap-0.5 text-[10px] text-blue-500 font-semibold">
                                                            <Loader2 size={10} className="animate-spin" /> Processing
                                                        </span>
                                                    )}
                                                    {email.savedToDb && (
                                                        <span className="flex items-center gap-0.5 text-[10px] text-violet-600 font-semibold">
                                                            <Save size={10} /> Saved
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* ═══ RIGHT PANEL: Reading Pane ═══ */}
            <div className="flex-1 flex flex-col bg-white min-w-0 overflow-hidden">
                {selectedEmail ? (
                    <>
                        {/* Toolbar */}
                        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 bg-slate-50/60 shrink-0">
                            <div className="flex items-center gap-1">
                                <button onClick={() => singleDelete(selectedEmail.id)} disabled={isBulkProcessing} className="p-2 rounded-lg hover:bg-red-100 text-slate-400 hover:text-red-600 transition-colors disabled:opacity-50" title="Delete">
                                    <Trash2 size={16} />
                                </button>
                                <button onClick={() => singleForward(selectedEmail.id)} disabled={isBulkProcessing} className="p-2 rounded-lg hover:bg-blue-100 text-slate-400 hover:text-blue-600 transition-colors disabled:opacity-50" title="Forward">
                                    <Forward size={16} />
                                </button>
                                <button onClick={() => singleSpam(selectedEmail.id)} disabled={isBulkProcessing} className="p-2 rounded-lg hover:bg-amber-100 text-slate-400 hover:text-amber-600 transition-colors disabled:opacity-50" title="Mark as Spam">
                                    <ShieldAlert size={16} />
                                </button>
                                {selectedEmail.hasAttachments && (selectedEmail.attachmentId || (selectedEmail.attachments && selectedEmail.attachments.some(a => !a.isInline))) && selectedEmail.status === 'PENDING' && (
                                    <button onClick={() => processEmail(selectedEmail)} className="flex items-center gap-1.5 px-3 py-1.5 ml-1 bg-blue-500 text-white rounded-lg text-xs font-bold hover:bg-blue-600 transition-colors" title="Process Attachment with AI">
                                        <Play size={13} /> Process
                                    </button>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                {selectedEmail.status === 'PROCESSING' && <span className="flex items-center gap-1.5 text-xs text-blue-600 font-semibold"><Loader2 size={12} className="animate-spin" />Processing...</span>}
                                {selectedEmail.status === 'PROCESSED' && (
                                    <div className="flex items-center gap-2">
                                        <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold"><CheckCircle2 size={12} />Processed</span>
                                        {selectedEmail.docType && (
                                            <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded text-[10px] font-bold">{selectedEmail.docType}</span>
                                        )}
                                        {selectedEmail.savedToDb && (
                                            <span className="flex items-center gap-1 px-2 py-0.5 bg-violet-100 text-violet-700 rounded text-[10px] font-bold">
                                                <Save size={10} /> Saved to DB
                                            </span>
                                        )}
                                    </div>
                                )}
                                {selectedEmail.status === 'ERROR' && <span className="flex items-center gap-1.5 text-xs text-red-600 font-semibold"><AlertCircle size={12} />Error</span>}
                            </div>
                        </div>

                        {/* Email Header */}
                        <div className="px-6 py-4 border-b border-slate-100 shrink-0">
                            <h2 className="text-lg font-bold text-slate-900 mb-3 leading-tight">{selectedEmail.subject}</h2>
                            <div className="flex items-start gap-3">
                                {/* Avatar */}
                                <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${getAvatarColor(selectedEmail.fromName)} text-white flex items-center justify-center text-sm font-bold shrink-0`}>
                                    {selectedEmail.fromName.charAt(0).toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-baseline gap-2 flex-wrap">
                                        <span className="text-sm font-bold text-slate-800">{selectedEmail.fromName}</span>
                                        <span className="text-xs text-slate-400">&lt;{selectedEmail.from}&gt;</span>
                                    </div>
                                    <p className="text-[11px] text-slate-400 mt-0.5">
                                        {new Date(selectedEmail.receivedDateTime).toLocaleString()}
                                    </p>
                                    {/* To / Cc */}
                                    {selectedEmail.toRecipients && selectedEmail.toRecipients.length > 0 && (
                                        <p className="text-[11px] text-slate-400 mt-1">
                                            <span className="font-medium text-slate-500">To:</span>{' '}
                                            {selectedEmail.toRecipients.map(r => r.name || r.address).join(', ')}
                                        </p>
                                    )}
                                    {selectedEmail.ccRecipients && selectedEmail.ccRecipients.length > 0 && (
                                        <p className="text-[11px] text-slate-400 mt-0.5">
                                            <span className="font-medium text-slate-500">Cc:</span>{' '}
                                            {selectedEmail.ccRecipients.map(r => r.name || r.address).join(', ')}
                                        </p>
                                    )}

                                    {/* Attachments */}
                                    {selectedEmail.hasAttachments && selectedEmail.attachments && selectedEmail.attachments.filter(a => !a.isInline).length > 0 && (
                                        <div className="mt-2">
                                            <div className="flex flex-wrap gap-1.5">
                                                {selectedEmail.attachments.filter(a => !a.isInline).map(att => (
                                                    <div key={att.id} className="flex items-center gap-1.5 bg-slate-100 border border-slate-200 rounded-md px-2 py-1 hover:border-slate-300 transition-colors">
                                                        <Paperclip size={10} className="text-slate-400" />
                                                        <span className="text-[10px] text-slate-600 font-medium truncate max-w-[180px]">{att.name}</span>
                                                        <span className="text-[9px] text-slate-400">{formatFileSize(att.size)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Email Body + OCR Sidebar */}
                        <div className="flex-1 flex min-h-0 overflow-hidden">
                            {/* Email Content */}
                            <div className="flex-1 overflow-y-auto min-h-0">
                                {emailBodyLoading ? (
                                    <div className="flex items-center justify-center py-16">
                                        <Loader2 size={24} className="animate-spin text-slate-300" />
                                    </div>
                                ) : selectedEmail.body ? (
                                    selectedEmail.body.contentType === 'html' ? (
                                        <iframe
                                            ref={iframeRef}
                                            srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#334155;line-height:1.6;padding:24px;margin:0;word-wrap:break-word;}a{color:#3b82f6;}img{max-width:100%;height:auto;}table{border-collapse:collapse;max-width:100%;}td,th{padding:4px 8px;}</style></head><body>${selectedEmail.body.content}</body></html>`}
                                            sandbox="allow-same-origin"
                                            className="w-full h-full border-0"
                                            title="Email body"
                                        />
                                    ) : (
                                        <div className="px-6 py-4 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                                            {selectedEmail.body.content}
                                        </div>
                                    )
                                ) : (
                                    <div className="px-6 py-4 text-sm text-slate-500 whitespace-pre-wrap leading-relaxed">
                                        {selectedEmail.bodyPreview || 'No content available.'}
                                    </div>
                                )}
                            </div>

                            {/* OCR Data Sidebar */}
                            {selectedEmail.analysisResult && (
                                <div className="w-[320px] shrink-0 border-l border-slate-200 bg-white overflow-y-auto">
                                    <div className="p-4 border-b border-slate-200 bg-slate-50">
                                        <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                            <CheckCircle2 size={16} className="text-emerald-600" /> OCR Extracted Data
                                        </h3>
                                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                                            {selectedEmail.docType && (
                                                <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded text-[10px] font-bold">{selectedEmail.docType}</span>
                                            )}
                                            {selectedEmail.savedToDb && (
                                                <span className="flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold">
                                                    <Save size={10} /> Saved to DB
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="p-4 space-y-1">
                                        {(() => {
                                            const text = selectedEmail.analysisResult || '';
                                            try {
                                                const parsed = JSON.parse(text);
                                                const items = Array.isArray(parsed) ? parsed : [parsed];
                                                return items.map((item: any, idx: number) => (
                                                    <div key={idx} className={idx > 0 ? 'pt-3 mt-3 border-t border-slate-200' : ''}>
                                                        {/* Attachment header */}
                                                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                            <span className="text-[11px] font-bold text-slate-700 truncate max-w-[180px]">{item.attachmentName || `Doc ${idx + 1}`}</span>
                                                            {item.docType && <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded text-[9px] font-bold">{item.docType}</span>}
                                                            {item.saved && <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[9px] font-bold flex items-center gap-0.5"><Save size={8} />Saved</span>}
                                                        </div>
                                                        {/* Fields */}
                                                        {Object.entries(item)
                                                            .filter(([k, v]) => !['attachmentName', 'docType', 'saved', 'ITEMS'].includes(k) && v && v !== 'null' && v !== 'N/A' && !Array.isArray(v) && typeof v !== 'object')
                                                            .map(([key, value]) => (
                                                                <div key={key} className="flex justify-between items-start gap-2 py-1 border-b border-slate-50 last:border-0">
                                                                    <span className="text-[10px] text-slate-400 font-bold uppercase shrink-0 leading-tight mt-0.5">{key.replace(/_/g, ' ')}</span>
                                                                    <span className="text-xs text-slate-700 font-medium text-right leading-tight">{String(value)}</span>
                                                                </div>
                                                            ))}
                                                    </div>
                                                ));
                                            } catch {
                                                // Fallback for old format
                                                const jsonMatch = text.match(/\{[\s\S]*\}/);
                                                if (jsonMatch) {
                                                    try {
                                                        const parsed = JSON.parse(jsonMatch[0]);
                                                        return Object.entries(parsed)
                                                            .filter(([_, v]) => v && v !== 'null' && v !== 'N/A' && !Array.isArray(v) && typeof v !== 'object')
                                                            .map(([key, value]) => (
                                                                <div key={key} className="flex justify-between items-start gap-2 py-1.5 border-b border-slate-100 last:border-0">
                                                                    <span className="text-[10px] text-slate-400 font-bold uppercase shrink-0 leading-tight mt-0.5">{key.replace(/_/g, ' ')}</span>
                                                                    <span className="text-xs text-slate-700 font-medium text-right leading-tight">{String(value)}</span>
                                                                </div>
                                                            ));
                                                    } catch { }
                                                }
                                                return <pre className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed font-sans">{text}</pre>;
                                            }
                                        })()}
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    /* Empty state */
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 bg-slate-50/30">
                        <Mail size={56} className="mb-4 opacity-10" />
                        <p className="text-sm font-medium text-slate-400">Select an email to read</p>
                        <p className="text-xs text-slate-300 mt-1">{emails.length} messages in {selectedFolderName}</p>
                    </div>
                )}
            </div>

            {/* ═══ Forward Modal ═══ */}
            {showForwardModal && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowForwardModal(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                <Forward size={20} className="text-blue-500" /> Forward {selectedIds.size} email{selectedIds.size > 1 ? 's' : ''}
                            </h3>
                            <button onClick={() => setShowForwardModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>
                        <label className="text-sm font-medium text-slate-600 mb-1 block">Forward to:</label>
                        <input
                            type="email"
                            value={forwardEmail}
                            onChange={e => setForwardEmail(e.target.value)}
                            placeholder="recipient@example.com"
                            className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-4"
                            autoFocus
                            onKeyDown={e => e.key === 'Enter' && forwardEmail.trim() && bulkForward()}
                        />
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setShowForwardModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-all">Cancel</button>
                            <button
                                onClick={bulkForward}
                                disabled={!forwardEmail.trim() || isBulkProcessing}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-bold hover:bg-blue-600 transition-all disabled:opacity-50"
                            >
                                {isBulkProcessing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AiEmailAssistant;
