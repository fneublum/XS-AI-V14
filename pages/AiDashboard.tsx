
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, Sparkles, Mic, StopCircle, Zap, Check, X, Trash2, Paperclip, FileText, CheckCircle2, ScanEye, Volume2, VolumeX } from 'lucide-react';
import { speakText, stopSpeaking, setSpeakingCallback, isSpeakingNow } from '../services/elevenLabsService';
import { getDashboardAgentResponse, AgentAction, analyzeDocument } from '../services/geminiService';
import { loadSession, saveSession, ChatMessage as MemChatMessage, runMemoryMaintenance } from '../services/memoryService';
import { renderMarkdown } from '../utils/renderMarkdown';
import { BillOfLading, Booking, Estimate, ProformaInvoice, PurchaseOrderExtract, Invoice, PackingList, SupplierInvoice, Port, FreightQuote } from '../types';
import { getSupabaseClient } from '../services/supabase';
import {
    loadOrCreateConversation,
    saveMessage,
    loadLearnedTasks,
    saveLearnedTask,
    matchLearnedTask,
    executeAction,
    validateAction,
    normalizeEntities,
    mergeEntities,
    REQUIRED_FIELDS,
    LearnedTask,
    CrudCallbacks,
} from '../services/aiAssistantService';

// ── Doc OCR Prompts (from AiUpload) ─────────────────────────────────
const DOC_ID_PROMPT = `Analyze the uploaded document image and classify it into exactly one of these categories:
- BILL OF LADING
- BOOKING
- ESTIMATE
- PROFORMA INVOICE
- PURCHASE ORDER
- INVOICE
- PACKING LIST
- FREIGHT QUOTE
- OTHER

Classification Rules:
1. If the document title contains "Straight Bill of Lading" or "Short Form Straight Bill of Lading", classify it strictly as "PACKING LIST".
2. If the document is a standard "Bill of Lading" (negotiable, ocean, or multimodal) WITHOUT the word "Straight", classify it as "BILL OF LADING".
3. A distinct "Packing List" document is also classified as "PACKING LIST".
4. FREIGHT QUOTE: If the document contains shipping/freight RATES between ports (origin/destination), container types (20GP, 40HC, 40GP), transit times, free time, ocean freight costs, or comes from a cargo agent/carrier/forwarder — classify as "FREIGHT QUOTE". These are NOT estimates.
5. ESTIMATE: Only classify as "ESTIMATE" if the document is a cost breakdown with itemized services, subtotals, and taxes — NOT a freight rate sheet.

Return ONLY the category name. Do not add any explanation or punctuation.`;

const EXTRACTION_PROMPTS: Record<string, string> = {
    'BILL OF LADING': `Extract the following fields for a BILL OF LADING. Return a valid JSON object. If a field is not found, return null.\nKEYS: DOC_NUMBER (B/L Number), SHIPPER, CONSIGNEE, NOTIFY, NUMBER_OF_ORIGINALS, PRODUCT_DESCRIPTION, MARKS_NUMBERS, CONTAINER, SEAL, PACKAGES, GROSS_WEIGHT, MEASUREMENT, VESSEL_VOYAGE, PORT_LOADING, PORT_DISCHARGE, PLACE_OF_ISSUE, PLACE_OF_RECEIPT, PLACE_OF_DELIVERY, SHIPPED_DATE, FREIGHT_PAYABLE, TERMS.`,
    'BOOKING': `Extract the following fields for a SHIPPING BOOKING CONFIRMATION. Return a valid JSON object. If a field is not found, return null.\nKEYS: DOC_NUMBER (Booking Number), CUSTOMER, CARGO_AGENT, VESSEL_VOYAGE, POL (Port of Loading), POD (Port of Discharge), EQUIPMENT, ETD, ETA, CARGO_CUT_OFF, VGM_CUT_OFF, DRAFT_CUT_OFF, FREE_TIME, TERMINAL.`,
    'ESTIMATE': `Extract the following fields for a PROFORMA INVOICE or ESTIMATE. Return a valid JSON object. If a field is not found, return null.\nKEYS: DOC_NUMBER, DATE, SELLER_NAME, BUYER_NAME, SHIP_TO, PAY_TO, PAYMENT_TERMS, INCOTERM, ITEMS (array of { activity, qty, rate, amount }), SUBTOTAL, TAX, TOTAL_AMOUNT, CURRENCY, ACCEPTED_BY, ACCEPTED_DATE.`,
    'PROFORMA INVOICE': `Extract the following fields for a PROFORMA INVOICE. Return a valid JSON object. If a field is not found, return null.\nKEYS: DOC_NUMBER, DATE, SELLER_NAME, BUYER_NAME, SHIP_TO, PAY_TO, PAYMENT_TERMS, INCOTERM, ITEMS (array of { activity, qty, rate, amount }), SUBTOTAL, TAX, TOTAL_AMOUNT, CURRENCY, ACCEPTED_BY, ACCEPTED_DATE.`,
    'PURCHASE ORDER': `Extract the following fields for a PURCHASE ORDER. Return a valid JSON object. If a field is not found, return null.\nKEYS: DOC_NUMBER, DATE, BUYER_NAME, SELLER_NAME, VENDOR_REF, FOLDER_NUMBER, PRODUCT_DESCRIPTION, QUANTITY, UNIT_OF_MEASURE, UNIT_PRICE, LINE_TOTAL, TOTAL_AMOUNT, CURRENCY, INCOTERM, PAYMENT_TERMS, PORT_DISCHARGE, PACKING_INSTRUCTIONS, SHIPMENT_INSTRUCTIONS, MARKINGS, INSPECTION, ITEMS (array of { description, quantity, unit, unit_price, total }).`,
    'INVOICE': `Extract the following fields for a COMMERCIAL INVOICE. Return a valid JSON object. If a field is not found, return null.\nKEYS: INVOICE_NUMBER, INVOICE_DATE, SELLER_NAME, SELLER_ADDRESS, BUYER_NAME_ADDRESS, SHIP_TO_ADDRESS, PAYMENT_TERMS, INCOTERMS, DATE_SHIPPED, PO_NUMBER, CARRIER, TRANSPORT_ID, FREIGHT_TERMS, ITEMS (array of { description, hs_code, quantity, unit_price, amount }), WEIGHT_GROSS, WEIGHT_NET, WEIGHT_TARE, TOTAL_QUANTITY, SUBTOTAL, TOTAL_AMOUNT, CURRENCY, REMIT_TO_NAME, BANK_NAME, SWIFT_CODE, ROUTING_NUMBER, ACCOUNT_NUMBER.`,
    'PACKING LIST': `Extract the following fields for a PACKING LIST / STRAIGHT BILL OF LADING. Return a valid JSON object. If a field is not found, return null.\nKEYS: BL_NUMBER, PL_NUMBER, SHIPPER, CONSIGNEE, SHIPPING_POINT, DESTINATION, DATE, CARRIER, CONTAINER_NUMBER, SEAL_NUMBER, VESSEL_VOYAGE, PRODUCT_DESCRIPTION, UNIT_COUNT, UNIT_NUMBERS, GROSS_WEIGHT, NET_WEIGHT, FREIGHT_TERMS, PO_NUMBER, NOTES, SCH_SHIP_DATE.`,
    'FREIGHT QUOTE': `Extract the following fields for a FREIGHT QUOTE / FREIGHT RATE document. Return a valid JSON object. If a field is not found, return null.\nKEYS: AGENT_NAME, CARRIER, FREIGHT_TYPE (one of: PORT_PORT, PORT_DOOR, DOOR_PORT, DOOR_DOOR), ORIGIN_PORT, ORIGIN_PORT_CODE, PICKUP_LOCATION, PICKUP_ZIP, DESTINATION_PORT, DESTINATION_PORT_CODE, DELIVERY_LOCATION, DELIVERY_ZIP, RATE, CHASSIS, OVERWEIGHT, CONTAINER_COUNT, CURRENCY, VALID_UNTIL, COMMENTS, TRANSIT_TIME, FREE_TIME, IS_ALL_IN (boolean), PICKUP_COST, OCEAN_COST, DELIVERY_COST, PORT_FEES, DECONSOLIDATION, CONTAINER_RETURN, BL_RELEASE, THC, ISPS, TRS, SECURITY_FEE, OBSERVATION.`,
};
// ─────────────────────────────────────────────────────────────────────

interface AiDashboardProps {
    currentUser: any;
    currentCompanyId?: string;
    customers?: any[];
    suppliers?: any[];
    products?: any[];
    salesOrders?: any[];
    purchaseOrders?: any[];
    bookings?: any[];
    billOfLadings?: any[];
    cargoAgents?: any[];
    freightQuotes?: any[];
    invoices?: any[];
    estimates?: any[];
    proformas?: any[];
    packingLists?: any[];
    supplierInvoices?: any[];
    commissions?: any[];
    onAddCustomer?: Function;
    onUpdateCustomer?: Function;
    onAddSupplier?: Function;
    onUpdateSupplier?: Function;
    onAddProduct?: Function;
    onAddSalesOrder?: Function;
    onAddPurchaseOrder?: Function;
    onAddBooking?: Function;
    onAddCargoAgent?: Function;
    onAddFreightQuote?: Function;
    // Doc OCR save callbacks
    onSaveBL?: (data: BillOfLading) => Promise<void> | void;
    onSaveBooking?: (data: Booking) => Promise<void> | void;
    onSaveEstimate?: (data: Estimate) => Promise<void> | void;
    onSaveProforma?: (data: ProformaInvoice) => Promise<void> | void;
    onSavePO?: (data: PurchaseOrderExtract) => Promise<void> | void;
    onSaveInvoice?: (data: Invoice) => Promise<void> | void;
    onSaveSupplierInvoice?: (data: SupplierInvoice) => Promise<void> | void;
    onSavePackingList?: (data: PackingList) => Promise<void> | void;
    ports?: Port[];
    pendingOcrFile?: File | null;
    onOcrFileProcessed?: () => void;
}

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    timestamp: Date;
    isConfirmation?: boolean;
    fileName?: string;
}

const AiDashboard: React.FC<AiDashboardProps> = ({
    currentUser,
    currentCompanyId = 'ALL',
    customers = [],
    suppliers = [],
    products = [],
    salesOrders = [],
    purchaseOrders = [],
    bookings = [],
    billOfLadings = [],
    cargoAgents = [],
    freightQuotes = [],
    invoices = [],
    estimates = [],
    proformas = [],
    packingLists = [],
    supplierInvoices = [],
    commissions = [],
    onAddCustomer,
    onUpdateCustomer,
    onAddSupplier,
    onUpdateSupplier,
    onAddProduct,
    onAddSalesOrder,
    onAddPurchaseOrder,
    onAddBooking,
    onAddCargoAgent,
    onAddFreightQuote,
    onSaveBL,
    onSaveBooking: onSaveBookingDoc,
    onSaveEstimate,
    onSaveProforma,
    onSavePO,
    onSaveInvoice,
    onSaveSupplierInvoice,
    onSavePackingList,
    ports = [],
    pendingOcrFile,
    onOcrFileProcessed,
}) => {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [isLoadingHistory, setIsLoadingHistory] = useState(true);
    const [pendingAction, setPendingAction] = useState<AgentAction | null>(null);
    const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [learnedTasks, setLearnedTasks] = useState<LearnedTask[]>([]);
    const [speakingEnabled, setSpeakingEnabled] = useState(false);
    const [listeningEnabled, setListeningEnabled] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const recognitionRef = useRef<any>(null);
    const mountedRef = useRef(false);
    const speakingEnabledRef = useRef(false);
    const listeningEnabledRef = useRef(false);

    const userName = currentUser?.name?.split(' ')[0] || 'User';
    const userId = currentUser?.id || 'unknown';

    // Sync refs for use in closures
    useEffect(() => { speakingEnabledRef.current = speakingEnabled; }, [speakingEnabled]);
    useEffect(() => { listeningEnabledRef.current = listeningEnabled; }, [listeningEnabled]);

    // Register speaking state callback
    useEffect(() => {
        setSpeakingCallback((val) => setIsSpeaking(val));
        return () => setSpeakingCallback(() => { });
    }, []);

    // ── Continuous Listening Engine ──────────────────────────────────
    const handleSendRef = useRef<(text?: string) => void>(() => { });

    const startContinuousListening = useCallback(() => {
        const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SR) {
            console.warn('[Voice] SpeechRecognition not supported');
            return;
        }
        if (recognitionRef.current) {
            try { recognitionRef.current.stop(); } catch { /* ignore */ }
        }
        console.log('[Voice] Starting continuous listening...');
        const recognition = new SR();
        recognition.lang = 'en-US';
        recognition.continuous = false;  // Use single-shot + auto-restart (more reliable)
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        recognition.onstart = () => {
            console.log('[Voice] Recognition started');
            setIsListening(true);
        };
        recognition.onresult = (event: any) => {
            const transcript = event.results[0]?.[0]?.transcript?.trim();
            console.log('[Voice] Transcript:', transcript);
            if (transcript) {
                setInput(transcript);
                // Use ref to avoid stale closure
                setTimeout(() => handleSendRef.current(transcript), 300);
            }
        };
        recognition.onerror = (e: any) => {
            console.warn('[Voice] Error:', e.error);
            if (e.error === 'not-allowed') {
                console.error('[Voice] Microphone permission denied');
                setIsListening(false);
                return;
            }
        };
        recognition.onend = () => {
            console.log('[Voice] Recognition ended, enabled:', listeningEnabledRef.current, 'speaking:', isSpeakingNow());
            setIsListening(false);
            // Auto-restart if still enabled and not speaking
            if (listeningEnabledRef.current && !isSpeakingNow()) {
                setTimeout(() => {
                    if (listeningEnabledRef.current && !isSpeakingNow()) {
                        console.log('[Voice] Auto-restarting...');
                        startContinuousListening();
                    }
                }, 500);
            }
        };
        recognitionRef.current = recognition;
        try {
            recognition.start();
        } catch (e) {
            console.error('[Voice] Failed to start:', e);
        }
    }, []);

    const stopContinuousListening = useCallback(() => {
        if (recognitionRef.current) {
            try { recognitionRef.current.stop(); } catch { /* ignore */ }
            recognitionRef.current = null;
        }
        setIsListening(false);
    }, []);

    // Toggle handlers
    const toggleSpeaking = useCallback(() => {
        setSpeakingEnabled(prev => {
            if (prev) stopSpeaking(); // Stop any current speech when disabling
            return !prev;
        });
    }, []);

    const toggleListening = useCallback(() => {
        setListeningEnabled(prev => {
            const next = !prev;
            if (next) {
                startContinuousListening();
            } else {
                stopContinuousListening();
            }
            return next;
        });
    }, [startContinuousListening, stopContinuousListening]);

    // Pause/resume listening based on speaking state
    useEffect(() => {
        if (isSpeaking && listeningEnabled) {
            stopContinuousListening();
        } else if (!isSpeaking && listeningEnabled) {
            setTimeout(() => {
                if (listeningEnabledRef.current && !isSpeakingNow()) {
                    startContinuousListening();
                }
            }, 500);
        }
    }, [isSpeaking, listeningEnabled, startContinuousListening, stopContinuousListening]);

    const crudCallbacks: CrudCallbacks = {
        onAddCustomer: onAddCustomer as any,
        onUpdateCustomer: onUpdateCustomer as any,
        onAddSupplier: onAddSupplier as any,
        onUpdateSupplier: onUpdateSupplier as any,
        onAddProduct: onAddProduct as any,
        onAddSalesOrder: onAddSalesOrder as any,
        onAddPurchaseOrder: onAddPurchaseOrder as any,
        onAddBooking: onAddBooking as any,
        onAddCargoAgent: onAddCargoAgent as any,
        onAddFreightQuote: onAddFreightQuote as any,
    };

    // Load conversation history + learned tasks on mount
    useEffect(() => {
        if (mountedRef.current) return;
        mountedRef.current = true;

        const init = async () => {
            try {
                const [conv, tasks] = await Promise.all([
                    loadOrCreateConversation(userId, currentCompanyId),
                    loadLearnedTasks(userId, currentCompanyId),
                ]);

                setConversationId(conv.conversationId);
                setLearnedTasks(tasks);

                // Load previous session messages
                const session = await loadSession(userId);
                if (session && session.messages && session.messages.length > 0) {
                    // Restore previous conversation, filtering out old greeting messages
                    const isGreeting = (t: string) =>
                        /I'm your \*\*XS AI Assistant\*\*/i.test(t) ||
                        /I remember our previous conversation/i.test(t);
                    const restored: ChatMessage[] = session.messages
                        .filter((m: MemChatMessage) => !isGreeting(m.text))
                        .map((m: MemChatMessage) => ({
                            id: crypto.randomUUID(),
                            role: m.role === 'user' ? 'user' as const : 'assistant' as const,
                            text: m.text,
                            timestamp: new Date(m.timestamp),
                        }));
                    setMessages(restored);
                    setSessionId(session.id);
                } else {
                    setMessages([]);
                }

                // Run memory maintenance (decay + summarization) in background
                runMemoryMaintenance(userId).catch(() => { });
            } catch {
                setMessages([]);
            }
            setIsLoadingHistory(false);
            setTimeout(() => inputRef.current?.focus(), 300);
        };

        init();
    }, []);

    // Auto-save chat session to Supabase when messages change
    useEffect(() => {
        if (messages.length <= 1 || isLoadingHistory) return; // Skip greeting-only or during load
        const memMsgs: MemChatMessage[] = messages.map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            text: m.text,
            timestamp: m.timestamp.toISOString()
        }));
        saveSession(userId, memMsgs, sessionId || undefined).then(newId => {
            if (newId && !sessionId) setSessionId(newId);
        }).catch(() => { });
    }, [messages]);

    // Auto-scroll (only scrolls chat container, not entire page)
    useEffect(() => {
        if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
    }, [messages]);

    // Process files dropped from WhatsApp OCR zone
    useEffect(() => {
        if (pendingOcrFile) {
            handleFileUpload(pendingOcrFile);
            onOcrFileProcessed?.();
        }
    }, [pendingOcrFile]);

    // Listen for auto-scan reports from the email widget
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.report) {
                setMessages(prev => [...prev, {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    text: detail.report,
                    timestamp: new Date(),
                }]);
            }
        };
        window.addEventListener('sx-auto-scan-report', handler);
        return () => window.removeEventListener('sx-auto-scan-report', handler);
    }, []);

    // Listen for per-document auto-scan save notifications
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.message) {
                setMessages(prev => [...prev, {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    text: detail.message,
                    timestamp: new Date(),
                }]);
            }
        };
        window.addEventListener('sx-doc-saved', handler);
        return () => window.removeEventListener('sx-doc-saved', handler);
    }, []);

    const suggestions = [
        'Give me a business overview',
        'Add a new customer',
        'Show my bookings',
        'List open purchase orders',
        'Check shipment status',
        'Create a sales order',
        'Show pending invoices',
    ];

    const addMessage = useCallback((role: 'user' | 'assistant', text: string, isConfirmation?: boolean) => {
        const msg: ChatMessage = {
            id: crypto.randomUUID(),
            role,
            text,
            timestamp: new Date(),
            isConfirmation,
        };
        setMessages(prev => [...prev, msg]);
        if (conversationId) {
            saveMessage(conversationId, role, text).catch(() => { });
        }
        // Auto-speak assistant responses when speaking is enabled
        if (role === 'assistant' && speakingEnabledRef.current) {
            // Skip system/status messages (OCR progress, auto-scan)
            const isSystem = /^(🔍|📄|✅ \*\*Saved|⚠️|❌|Auto-Scan)/i.test(text);
            if (!isSystem) {
                speakText(text);
            }
        }
        return msg;
    }, [conversationId]);

    // ── Doc OCR: port normalizer ────────────────────────────────────
    const normalizePort = useCallback((rawInput: any): string => {
        const raw = String(rawInput || '');
        if (!raw || !ports || ports.length === 0) return raw;
        const cleanRaw = raw.toUpperCase().trim();
        const exact = ports.find(p => p.code && p.code.toUpperCase() === cleanRaw);
        if (exact) return exact.code;
        const inputTokens = new Set(cleanRaw.split(/[^A-Z0-9]+/).filter((t: string) => t.length >= 3));
        if (inputTokens.size === 0) return raw;
        let bestMatch: Port | null = null;
        let maxScore = 0;
        for (const port of ports) {
            if (!port.code || !port.name) continue;
            let score = 0;
            if (inputTokens.has(port.code.toUpperCase().trim())) score += 200;
            const nameTokens: Set<string> = new Set(port.name.toUpperCase().trim().split(/[^A-Z0-9]+/).filter((t: string) => t.length >= 3));
            let common = 0;
            for (const t of nameTokens) { if (inputTokens.has(t)) common++; }
            if (common > 0) { score += common * 50; if (common === nameTokens.size) score += 100; }
            if (score > maxScore) { maxScore = score; bestMatch = port; }
        }
        return (bestMatch && maxScore >= 50) ? bestMatch.code : raw;
    }, [ports]);

    // ── Doc OCR: handle file upload ─────────────────────────────────
    const handleFileUpload = useCallback(async (selectedFile: File) => {
        const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
        if (!validTypes.includes(selectedFile.type)) {
            addMessage('assistant', '⚠️ Unsupported file type. Please upload PDF, JPEG, or PNG.');
            return;
        }
        if (selectedFile.size > 10 * 1024 * 1024) {
            addMessage('assistant', '⚠️ File size exceeds 10MB limit.');
            return;
        }

        // Show user attachment message
        const userMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'user',
            text: `📎 Uploaded: **${selectedFile.name}** (${(selectedFile.size / 1024 / 1024).toFixed(2)} MB)`,
            timestamp: new Date(),
            fileName: selectedFile.name,
        };
        setMessages(prev => [...prev, userMsg]);
        if (conversationId) saveMessage(conversationId, 'user', userMsg.text).catch(() => { });

        setIsThinking(true);

        try {
            // Read file as base64
            const base64Data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const result = e.target?.result as string;
                    const parts = result?.split(',');
                    if (parts && parts.length > 1) resolve(parts[1]);
                    else reject(new Error('Invalid file data'));
                };
                reader.onerror = reject;
                reader.readAsDataURL(selectedFile);
            });

            // Step 1: Identify document type
            addMessage('assistant', '🔍 Identifying document type...');
            const idResultRaw = await analyzeDocument(base64Data, selectedFile.type, DOC_ID_PROMPT);
            const docType = String(idResultRaw).replace(/[\*\"]/g, '').trim().toUpperCase();

            // Remove the "identifying" message, replace with type
            setMessages(prev => {
                const filtered = prev.filter(m => m.text !== '🔍 Identifying document type...');
                return [...filtered, {
                    id: crypto.randomUUID(),
                    role: 'assistant' as const,
                    text: `📄 Document identified as: **${docType}**\n\nExtracting data...`,
                    timestamp: new Date(),
                }];
            });

            // Step 2: Extract data
            const extractionPrompt = EXTRACTION_PROMPTS[docType];
            if (!extractionPrompt) {
                // Generic OCR fallback: extract all visible text & data
                addMessage('assistant', `📄 No specific template for **${docType}**. Running full OCR...`);
                const genericPrompt = `You are an OCR assistant. Extract ALL visible text and data from this document image. Organize the output clearly with headers and bullet points. Include every field, label, number, date, name, address, and any other information you can read. Format it in a clean, readable way.`;
                try {
                    const ocrResult = await analyzeDocument(base64Data, selectedFile.type, genericPrompt);
                    const ocrText = String(ocrResult ?? '').trim();
                    // Replace the "running OCR" message with actual results
                    setMessages(prev => {
                        const filtered = prev.filter(m => !m.text.includes('Running full OCR...'));
                        return [...filtered, {
                            id: crypto.randomUUID(),
                            role: 'assistant' as const,
                            text: `### 📋 OCR Results — ${docType}\n\n${ocrText}`,
                            timestamp: new Date(),
                        }];
                    });
                } catch (ocrErr) {
                    addMessage('assistant', `⚠️ OCR failed: ${ocrErr}`);
                }
                setIsThinking(false);
                return;
            }

            const extractResultRaw = await analyzeDocument(base64Data, selectedFile.type, extractionPrompt);
            const extractStr = String(extractResultRaw ?? '');
            const jsonMatch = extractStr.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                addMessage('assistant', `Failed to parse extraction data. Raw output:\n${extractStr}`);
                setIsThinking(false);
                return;
            }

            const extractedData = JSON.parse(jsonMatch[0]);

            // Build a nice summary for the chat
            const summaryLines: string[] = [`### ✅ ${docType} — Extracted`];
            const fieldsToShow = Object.entries(extractedData).filter(([k, v]) => v && k !== 'ITEMS' && k !== 'items');
            for (const [key, value] of fieldsToShow) {
                const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                summaryLines.push(`**${label}**: ${value}`);
            }
            // Show items count if present
            const items = extractedData.ITEMS || extractedData.items;
            if (Array.isArray(items) && items.length > 0) {
                summaryLines.push(`**Line Items**: ${items.length} item(s)`);
            }

            // Remove the "extracting" message
            setMessages(prev => {
                const filtered = prev.filter(m => !m.text.includes('Extracting data...'));
                return [...filtered, {
                    id: crypto.randomUUID(),
                    role: 'assistant' as const,
                    text: summaryLines.join('\n'),
                    timestamp: new Date(),
                }];
            });

            // Step 3: Auto-save
            const companyId = currentCompanyId;
            const created = new Date().toISOString();
            const client = getSupabaseClient();
            let saved = false;

            try {
                if (docType === 'BILL OF LADING' && onSaveBL) {
                    const pol = normalizePort(String(extractedData.PORT_LOADING || ''));
                    const pod = normalizePort(String(extractedData.PORT_DISCHARGE || ''));
                    await onSaveBL({
                        id: `BL${Date.now()}`, companyId, createdAt: created,
                        blNumber: String(extractedData.DOC_NUMBER || ''), shipper: String(extractedData.SHIPPER || ''),
                        consignee: String(extractedData.CONSIGNEE || ''), notifyParty: String(extractedData.NOTIFY || ''),
                        vesselVoyage: String(extractedData.VESSEL_VOYAGE || ''), portLoading: pol, portDischarge: pod,
                        placeReceipt: String(extractedData.PLACE_OF_RECEIPT || ''), placeDelivery: String(extractedData.PLACE_OF_DELIVERY || ''),
                        shippedDate: String(extractedData.SHIPPED_DATE || ''), originals: String(extractedData.NUMBER_OF_ORIGINALS || ''),
                        container: String(extractedData.CONTAINER || ''), seal: String(extractedData.SEAL || ''),
                        description: String(extractedData.PRODUCT_DESCRIPTION || ''), grossWeight: String(extractedData.GROSS_WEIGHT || ''),
                        measurement: String(extractedData.MEASUREMENT || ''), packages: String(extractedData.PACKAGES || ''),
                        freightPayable: String(extractedData.FREIGHT_PAYABLE || ''), remarks: String(extractedData.TERMS || ''),
                        originalDocument: '', status: 'AVAILABLE',
                    });
                    // Update booking status if matched
                    if (client && extractedData.VESSEL_VOYAGE && extractedData.CONSIGNEE) {
                        const { data: bks } = await client.from('bookings').select('id, bookingNumber, customer, status')
                            .eq('vesselVoyage', extractedData.VESSEL_VOYAGE).or('status.eq.ACTIVE,status.eq.REQUESTED');
                        if (bks) {
                            const match = bks.find((b: any) => b.customer && String(extractedData.CONSIGNEE).toLowerCase().includes(b.customer.toLowerCase()));
                            if (match) await client.from('bookings').update({ status: 'AVAILABLE' }).eq('id', match.id);
                        }
                    }
                    saved = true;
                } else if (docType === 'BOOKING' && onSaveBookingDoc) {
                    const pol = normalizePort(String(extractedData.POL || ''));
                    const pod = normalizePort(String(extractedData.POD || ''));
                    await onSaveBookingDoc({
                        id: `BK${Date.now()}`, companyId, createdAt: created,
                        bookingNumber: String(extractedData.DOC_NUMBER || ''), customer: String(extractedData.CUSTOMER || ''),
                        agentName: String(extractedData.CARGO_AGENT || ''), vesselVoyage: String(extractedData.VESSEL_VOYAGE || ''),
                        pol, pod, equipment: String(extractedData.EQUIPMENT || ''),
                        etd: String(extractedData.ETD || ''), eta: String(extractedData.ETA || ''),
                        cargoCutOff: String(extractedData.CARGO_CUT_OFF || ''), vgmCutOff: String(extractedData.VGM_CUT_OFF || ''),
                        draftCutOff: String(extractedData.DRAFT_CUT_OFF || ''), freeTime: String(extractedData.FREE_TIME || ''),
                        terminal: String(extractedData.TERMINAL || ''), originalDocument: '', status: 'AVAILABLE',
                    });
                    saved = true;
                } else if (docType === 'ESTIMATE' && onSaveEstimate) {
                    await onSaveEstimate({
                        id: `EST${Date.now()}`, companyId, createdAt: created,
                        estimateNumber: String(extractedData.DOC_NUMBER || ''), supplier: String(extractedData.SELLER_NAME || ''),
                        buyer: String(extractedData.BUYER_NAME || ''), shipTo: String(extractedData.SHIP_TO || ''),
                        payTo: String(extractedData.PAY_TO || ''), date: String(extractedData.DATE || ''),
                        terms: String(extractedData.PAYMENT_TERMS || ''), incoterm: String(extractedData.INCOTERM || ''),
                        subtotal: Number(extractedData.SUBTOTAL || 0), tax: Number(extractedData.TAX || 0),
                        totalAmount: Number(extractedData.TOTAL_AMOUNT || 0), currency: String(extractedData.CURRENCY || 'USD'),
                        items: JSON.stringify(extractedData.ITEMS || []),
                        acceptedBy: String(extractedData.ACCEPTED_BY || ''), acceptedDate: String(extractedData.ACCEPTED_DATE || ''),
                        originalDocument: '',
                    });
                    saved = true;
                } else if (docType === 'PROFORMA INVOICE' && onSaveProforma) {
                    await onSaveProforma({
                        id: `PI${Date.now()}`, companyId, createdAt: created,
                        piNumber: String(extractedData.DOC_NUMBER || ''), supplier: String(extractedData.SELLER_NAME || ''),
                        buyer: String(extractedData.BUYER_NAME || ''), shipTo: String(extractedData.SHIP_TO || ''),
                        payTo: String(extractedData.PAY_TO || ''), date: String(extractedData.DATE || ''),
                        terms: String(extractedData.PAYMENT_TERMS || ''), incoterm: String(extractedData.INCOTERM || ''),
                        subtotal: Number(extractedData.SUBTOTAL || 0), tax: Number(extractedData.TAX || 0),
                        totalAmount: Number(extractedData.TOTAL_AMOUNT || 0), currency: String(extractedData.CURRENCY || 'USD'),
                        items: JSON.stringify(extractedData.ITEMS || []),
                        acceptedBy: String(extractedData.ACCEPTED_BY || ''), acceptedDate: String(extractedData.ACCEPTED_DATE || ''),
                        originalDocument: '',
                    });
                    saved = true;
                } else if (docType === 'PURCHASE ORDER' && onSavePO) {
                    await onSavePO({
                        id: `PO${Date.now()}`, companyId, createdAt: created,
                        poNumber: String(extractedData.DOC_NUMBER || ''), vendor: String(extractedData.SELLER_NAME || extractedData.VENDOR_NAME || ''),
                        date: String(extractedData.DATE || ''), totalAmount: String(extractedData.TOTAL_AMOUNT || ''),
                        currency: String(extractedData.CURRENCY || ''), items: JSON.stringify(extractedData.ITEMS || []),
                        originalDocument: '',
                    });
                    saved = true;
                } else if (docType === 'INVOICE' && onSaveSupplierInvoice) {
                    await onSaveSupplierInvoice({
                        id: `INV${Date.now()}`, companyId, createdAt: created,
                        invoiceNumber: String(extractedData.INVOICE_NUMBER || ''), invoiceDate: String(extractedData.INVOICE_DATE || ''),
                        shipperName: String(extractedData.SELLER_NAME || ''), shipperAddress: String(extractedData.SELLER_ADDRESS || ''),
                        soldTo: String(extractedData.BUYER_NAME_ADDRESS || ''), shipTo: String(extractedData.SHIP_TO_ADDRESS || ''),
                        paymentTerms: String(extractedData.PAYMENT_TERMS || ''), incoterm: String(extractedData.INCOTERMS || ''),
                        dateOrder: String(extractedData.DATE_SHIPPED || ''), customerPo: String(extractedData.PO_NUMBER || ''),
                        carrier: String(extractedData.CARRIER || ''), transportRef: String(extractedData.TRANSPORT_ID || ''),
                        freightTerms: String(extractedData.FREIGHT_TERMS || ''), items: JSON.stringify(extractedData.ITEMS || []),
                        grossWeight: String(extractedData.WEIGHT_GROSS || ''), netWeight: String(extractedData.WEIGHT_NET || ''),
                        tareWeight: String(extractedData.WEIGHT_TARE || ''), totalQuantity: String(extractedData.TOTAL_QUANTITY || ''),
                        subtotal: Number(extractedData.SUBTOTAL || 0), totalAmount: Number(extractedData.TOTAL_AMOUNT || 0),
                        currency: String(extractedData.CURRENCY || 'USD'), remitTo: String(extractedData.REMIT_TO_NAME || ''),
                        bankName: String(extractedData.BANK_NAME || ''), swiftCode: String(extractedData.SWIFT_CODE || ''),
                        routingNumber: String(extractedData.ROUTING_NUMBER || ''), accountNumber: String(extractedData.ACCOUNT_NUMBER || ''),
                        originalDocument: '',
                    });
                    saved = true;
                } else if (docType === 'PACKING LIST' && onSavePackingList) {
                    await onSavePackingList({
                        id: `PL${Date.now()}`, companyId, createdAt: created,
                        plNumber: String(extractedData.PL_NUMBER || ''), blNumber: String(extractedData.BL_NUMBER || ''),
                        shipper: String(extractedData.SHIPPER || ''), consignee: String(extractedData.CONSIGNEE || ''),
                        shippingPoint: String(extractedData.SHIPPING_POINT || ''), destination: String(extractedData.DESTINATION || ''),
                        date: String(extractedData.DATE || ''), carrier: String(extractedData.CARRIER || ''),
                        containerNumber: String(extractedData.CONTAINER_NUMBER || ''), sealNumber: String(extractedData.SEAL_NUMBER || ''),
                        vesselVoyage: String(extractedData.VESSEL_VOYAGE || ''), productDescription: String(extractedData.PRODUCT_DESCRIPTION || ''),
                        unitCount: String(extractedData.UNIT_COUNT || ''), unitNumbers: String(extractedData.UNIT_NUMBERS || ''),
                        grossWeight: String(extractedData.GROSS_WEIGHT || ''), netWeight: String(extractedData.NET_WEIGHT || ''),
                        freightTerms: String(extractedData.FREIGHT_TERMS || ''), poNumber: String(extractedData.PO_NUMBER || ''),
                        notes: String(extractedData.NOTES || ''), scheduledShipDate: String(extractedData.SCH_SHIP_DATE || ''),
                        items: JSON.stringify(extractedData.ITEMS || []), originalDocument: '',
                    });
                    saved = true;
                } else if (docType === 'FREIGHT QUOTE' && onAddFreightQuote) {
                    const originCode = normalizePort(String(extractedData.ORIGIN_PORT_CODE || extractedData.ORIGIN_PORT || ''));
                    const destCode = normalizePort(String(extractedData.DESTINATION_PORT_CODE || extractedData.DESTINATION_PORT || ''));
                    await (onAddFreightQuote as (data: FreightQuote) => Promise<void>)({
                        id: `FQ${Date.now()}`, companyId,
                        agentName: String(extractedData.AGENT_NAME || ''),
                        carrier: String(extractedData.CARRIER || ''),
                        freightType: (extractedData.FREIGHT_TYPE || 'PORT_PORT') as FreightQuote['freightType'],
                        originPort: String(extractedData.ORIGIN_PORT || ''),
                        originPortCode: originCode,
                        pickupLocation: String(extractedData.PICKUP_LOCATION || ''),
                        pickupZip: String(extractedData.PICKUP_ZIP || ''),
                        destinationPort: String(extractedData.DESTINATION_PORT || ''),
                        destinationPortCode: destCode,
                        deliveryLocation: String(extractedData.DELIVERY_LOCATION || ''),
                        deliveryZip: String(extractedData.DELIVERY_ZIP || ''),
                        rate: Number(extractedData.RATE || 0),
                        chassis: Number(extractedData.CHASSIS || 0),
                        overweight: Number(extractedData.OVERWEIGHT || 0),
                        containerCount: Number(extractedData.CONTAINER_COUNT || 0),
                        currency: String(extractedData.CURRENCY || 'USD'),
                        validUntil: String(extractedData.VALID_UNTIL || ''),
                        comments: String(extractedData.COMMENTS || ''),
                        transitTime: Number(extractedData.TRANSIT_TIME || 0),
                        freeTime: Number(extractedData.FREE_TIME || 0),
                        isAllIn: Boolean(extractedData.IS_ALL_IN),
                        pickupCost: Number(extractedData.PICKUP_COST || 0),
                        oceanCost: Number(extractedData.OCEAN_COST || 0),
                        deliveryCost: Number(extractedData.DELIVERY_COST || 0),
                        portFees: Number(extractedData.PORT_FEES || 0),
                        deconsolidation: Number(extractedData.DECONSOLIDATION || 0),
                        containerReturn: Number(extractedData.CONTAINER_RETURN || 0),
                        blRelease: Number(extractedData.BL_RELEASE || 0),
                        thc: Number(extractedData.THC || 0),
                        isps: Number(extractedData.ISPS || 0),
                        trs: Number(extractedData.TRS || 0),
                        securityFee: Number(extractedData.SECURITY_FEE || 0),
                        observation: String(extractedData.OBSERVATION || ''),
                        status: 'ACTIVE',
                    });
                    saved = true;
                }

                if (saved) {
                    addMessage('assistant', `✅ **Saved to ${docType} documents.**`);
                } else {
                    addMessage('assistant', `⚠️ No save handler available for **${docType}**. Data was extracted but not saved.`);
                }
            } catch (saveErr: any) {
                addMessage('assistant', `⚠️ Extraction succeeded but save failed: ${saveErr.message || String(saveErr)}`);
            }
        } catch (err: any) {
            addMessage('assistant', `❌ Error processing document: ${err.message || 'Unknown error'}. Please try again.`);
        }

        setIsThinking(false);
        inputRef.current?.focus();
    }, [addMessage, conversationId, currentCompanyId, normalizePort, onSaveBL, onSaveBookingDoc, onSaveEstimate, onSaveProforma, onSavePO, onSaveSupplierInvoice, onSavePackingList, onAddFreightQuote]);

    const handleConfirm = async () => {
        if (!pendingAction) return;
        setAwaitingConfirmation(false);
        setIsThinking(true);
        addMessage('user', 'Confirmed');

        const result = await executeAction(
            pendingAction,
            crudCallbacks,
            currentCompanyId,
            { customers, suppliers, products }
        );

        addMessage('assistant', result.success ? result.message : `Failed: ${result.message}`);
        setPendingAction(null);
        setIsThinking(false);
        inputRef.current?.focus();
    };

    const handleCancel = () => {
        setAwaitingConfirmation(false);
        setPendingAction(null);
        addMessage('user', 'Cancelled');
        addMessage('assistant', 'Cancelled.');
        inputRef.current?.focus();
    };

    const handleSend = async (overrideInput?: string) => {
        const text = overrideInput || input.trim();
        if (!text || isThinking) return;

        addMessage('user', text);
        setInput('');
        setIsThinking(true);

        try {
            // 1. Learn command: "learn: <trigger> -> <instruction>"
            const learnMatch = text.match(/^learn:\s*(.+?)\s*->\s*(.+)$/i);
            if (learnMatch) {
                const trigger = learnMatch[1].trim();
                const instruction = learnMatch[2].trim();
                await saveLearnedTask(userId, currentCompanyId, trigger, instruction);
                const tasks = await loadLearnedTasks(userId, currentCompanyId);
                setLearnedTasks(tasks);
                addMessage('assistant', `Got it. When you say "${trigger}", I'll ${instruction}.`);
                setIsThinking(false);
                inputRef.current?.focus();
                return;
            }

            // 2. If awaiting confirmation, handle yes/no locally
            if (awaitingConfirmation && pendingAction) {
                const lower = text.toLowerCase().trim();
                if (['yes', 'confirm', 'ok', 'do it', 'proceed', 'save', 'create it', 'y'].includes(lower)) {
                    await handleConfirm();
                    return;
                }
                if (['no', 'cancel', 'stop', 'nevermind', 'abort', 'n'].includes(lower)) {
                    handleCancel();
                    setIsThinking(false);
                    return;
                }
            }

            // 3. Check learned tasks
            const learned = matchLearnedTask(text, learnedTasks);

            // 4. Build RICH context for AI — compact summaries so AI can answer specific data queries
            const ctx = {
                stats: {
                    customers: customers.length,
                    suppliers: suppliers.length,
                    activeDeals: salesOrders.filter((s: any) => s.status !== 'Completed' && s.status !== 'Cancelled').length,
                    activeShipments: bookings.filter((b: any) => b.status !== 'Delivered' && b.status !== 'Cancelled').length,
                },
                recentActivity: {
                    sales: salesOrders.slice(0, 5).map((s: any) => `${s.orderNumber || 'SO'}: ${s.customerName} - ${s.status}`),
                    pos: purchaseOrders.slice(0, 5).map((p: any) => `${p.orderNumber || 'PO'}: ${p.supplierName} - ${p.status}`),
                    shipments: bookings.slice(0, 5).map((b: any) => `${b.bookingNumber || 'BK'}: ${b.customer} - ${b.status}`),
                },
                // Full record data for AI to query
                salesOrders: salesOrders.slice(0, 30).map((s: any) => ({
                    so: s.salesOrderNumber || s.orderNumber || s.id,
                    customer: s.customerName || s.customer,
                    product: s.product,
                    qty: s.qty || s.quantity,
                    price: s.unitPrice || s.price,
                    total: s.totalAmount || s.total,
                    status: s.status,
                    date: s.createdAt?.substring?.(0, 10) || s.date,
                })),
                purchaseOrders: purchaseOrders.slice(0, 30).map((p: any) => ({
                    po: p.purchaseOrderNumber || p.orderNumber || p.id,
                    supplier: p.supplierName || p.supplier,
                    product: p.product,
                    qty: p.qty || p.quantity,
                    price: p.unitPrice || p.price,
                    total: p.totalAmount || p.total,
                    status: p.status,
                    date: p.createdAt?.substring?.(0, 10) || p.date,
                })),
                bookings: bookings.slice(0, 30).map((b: any) => ({
                    bk: b.bookingNumber || b.id,
                    customer: b.customer || b.customerName,
                    carrier: b.carrier,
                    vessel: b.vessel || b.vesselVoyage,
                    pol: b.pol || b.portOfLoading,
                    pod: b.pod || b.portOfDischarge,
                    etd: b.etd?.substring?.(0, 10),
                    eta: b.eta?.substring?.(0, 10),
                    status: b.status,
                    containers: b.containers || b.equipment,
                })),
                billOfLadings: billOfLadings.slice(0, 30).map((bl: any) => ({
                    bl: bl.blNumber || bl.id,
                    shipper: bl.shipper,
                    consignee: bl.consignee,
                    vessel: bl.vessel || bl.vesselVoyage,
                    pol: bl.pol || bl.portOfLoading,
                    pod: bl.pod || bl.portOfDischarge,
                    status: bl.status,
                    containers: bl.containers?.length || bl.containerCount,
                })),
                freightQuotes: freightQuotes.slice(0, 30).map((fq: any) => ({
                    id: fq.id,
                    agent: fq.agent || fq.cargoAgent,
                    carrier: fq.carrier,
                    origin: fq.originPort || fq.origin,
                    destination: fq.destinationPort || fq.destination,
                    rate: fq.rate || fq.oceanFreight,
                    transitTime: fq.transitTime,
                    freeTime: fq.freeTime,
                    validUntil: fq.validUntil?.substring?.(0, 10),
                    status: fq.status,
                })),
                invoices: invoices.slice(0, 30).map((inv: any) => ({
                    inv: inv.invoiceNumber || inv.id,
                    customer: inv.soldTo || inv.customerName || inv.customer,
                    product: inv.product || inv.description,
                    qty: inv.qty || inv.quantity,
                    total: inv.totalAmount || inv.total || inv.invoiceTotal,
                    status: inv.status,
                    date: inv.invoiceDate?.substring?.(0, 10) || inv.createdAt?.substring?.(0, 10),
                })),
                estimates: estimates.slice(0, 30).map((est: any) => ({
                    id: est.estimateNumber || est.id,
                    customer: est.customerName || est.customer,
                    product: est.product || est.description,
                    total: est.totalAmount || est.total,
                    status: est.status,
                    date: est.createdAt?.substring?.(0, 10),
                })),
                proformas: proformas.slice(0, 30).map((pi: any) => ({
                    id: pi.proformaNumber || pi.id,
                    customer: pi.customerName || pi.customer || pi.soldTo,
                    product: pi.product || pi.description,
                    total: pi.totalAmount || pi.total,
                    status: pi.status,
                    date: pi.createdAt?.substring?.(0, 10),
                })),
                packingLists: packingLists.slice(0, 30).map((pl: any) => ({
                    id: pl.packingListNumber || pl.id,
                    customer: pl.customerName || pl.customer || pl.consignee,
                    shipper: pl.shipper,
                    product: pl.product || pl.description,
                    grossWeight: pl.grossWeight,
                    netWeight: pl.netWeight,
                    status: pl.status,
                    date: pl.createdAt?.substring?.(0, 10),
                })),
                supplierInvoices: supplierInvoices.slice(0, 30).map((si: any) => ({
                    inv: si.invoiceNumber || si.id,
                    supplier: si.supplierName || si.supplier || si.vendorName,
                    product: si.product || si.description,
                    total: si.totalAmount || si.total,
                    status: si.status,
                    date: si.invoiceDate?.substring?.(0, 10) || si.createdAt?.substring?.(0, 10),
                })),
                commissions: commissions.slice(0, 30).map((c: any) => ({
                    order: c.orderNumber || c.salesOrderNumber || c.id,
                    seller: c.sellerName,
                    customer: c.customerName,
                    total: c.orderTotal,
                    commission: c.commissionAmount,
                    rate: c.commissionRate,
                    status: c.commissionPaymentStatus || c.status,
                    date: c.createdAt?.substring?.(0, 10),
                })),
            };

            // Convert chat history for AI
            const history = messages.slice(-20).map(m => ({
                role: m.role === 'user' ? 'user' as const : 'model' as const,
                text: m.text,
            }));
            history.push({ role: 'user', text: learned ? `${text} [LEARNED TASK: ${learned.instruction}]` : text });

            // 5. Call AI agent
            const response = await getDashboardAgentResponse(
                learned ? `${text} [LEARNED TASK: ${learned.instruction}]` : text,
                history,
                ctx,
                pendingAction || undefined,
                false,
                userId
            );

            // 6. Process response
            console.log('[XS-AI-DEBUG] Response:', JSON.stringify(response));
            if (response.action) {
                let action = response.action;

                // Normalize entities (belt-and-suspenders — also done in geminiService)
                action = { ...action, entities: normalizeEntities(action.entities) };
                console.log('[XS-AI-DEBUG] Normalized action:', JSON.stringify(action));

                // If we have a pending action and user is providing follow-up info,
                // merge new entities into the pending action
                if (pendingAction && !awaitingConfirmation) {
                    action = mergeEntities(pendingAction, action.entities);
                    action.type = pendingAction.type; // Keep original action type
                }

                // Code-side validation: check mandatory fields
                const missingLabels = validateAction(action);
                console.log('[XS-AI-DEBUG] Missing fields:', missingLabels);

                if (missingLabels.length > 0) {
                    // Missing mandatory fields — ask user (always show what's missing)
                    setPendingAction(action);
                    const askText = `To create this, I still need: **${missingLabels.join('**, **')}**. Please provide them.`;
                    addMessage('assistant', askText);
                } else {
                    // All mandatory fields present — show confirmation
                    setPendingAction(action);
                    setAwaitingConfirmation(true);

                    // Build summary from required fields only (cleaner)
                    const requiredList = REQUIRED_FIELDS[action.type] || [];
                    const summary = requiredList
                        .map(r => `**${r.label}**: ${(action.entities as any)[r.field]}`)
                        .join(' | ');

                    const confirmText = response.text || `Create **${action.type}**?\n${summary}`;
                    addMessage('assistant', confirmText, true);
                }
            } else {
                // Pure chat response
                addMessage('assistant', response.text || 'I processed that.');
                // Clear pending if it was a follow-up that resolved
                if (pendingAction && !awaitingConfirmation) {
                    setPendingAction(null);
                }
            }
        } catch (err: any) {
            addMessage('assistant', `Error: ${err.message || 'Connection failed'}. Try again.`);
        }

        setIsThinking(false);
        inputRef.current?.focus();
    };

    // Keep ref in sync so voice recognition always uses latest handleSend
    handleSendRef.current = handleSend;

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleVoiceInput = () => {
        if (isListening) {
            stopContinuousListening();
            setListeningEnabled(false);
            return;
        }
        setListeningEnabled(true);
        startContinuousListening();
    };

    const handleClearChat = () => {
        setMessages([]);
        setPendingAction(null);
        setAwaitingConfirmation(false);
        setSessionId(null); // Start a fresh session on next save
    };

    const formatTime = (date: Date) => {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const showSuggestions = messages.length <= 2 && !isLoadingHistory;

    return (
        <div className="h-full flex flex-col overflow-hidden rounded-xl bg-white border border-slate-200">

            {/* Header */}
            <div className="shrink-0 px-4 py-1.5 flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-indigo-50/80 to-white">
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-md shadow-indigo-200">
                            <Sparkles size={14} className="text-white" />
                        </div>
                        <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white bg-emerald-400" />
                    </div>
                    <div>
                        <h2 className="text-slate-900 font-bold text-sm tracking-wide">XS Agent</h2>
                        <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            <p className="text-xs text-slate-500 font-medium">Executive Intelligence • Online</p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {learnedTasks.length > 0 && (
                        <span className="text-[10px] text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full border border-slate-200">
                            {learnedTasks.length} learned task{learnedTasks.length !== 1 ? 's' : ''}
                        </span>
                    )}
                    {/* Speaking Toggle */}
                    <button
                        onClick={toggleSpeaking}
                        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold transition-all ${speakingEnabled
                            ? 'bg-emerald-50 text-emerald-600 border border-emerald-200 shadow-sm'
                            : 'bg-slate-50 text-slate-400 border border-slate-200 hover:bg-slate-100'
                            }`}
                        title={speakingEnabled ? 'Speaker ON — click to mute' : 'Speaker OFF — click to enable'}
                    >
                        {speakingEnabled ? <Volume2 size={13} className={isSpeaking ? 'animate-pulse' : ''} /> : <VolumeX size={13} />}
                        <span>{speakingEnabled ? 'ON' : 'OFF'}</span>
                    </button>
                    {/* Listening Toggle */}
                    <button
                        onClick={toggleListening}
                        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold transition-all ${listeningEnabled
                            ? 'bg-blue-50 text-blue-600 border border-blue-200 shadow-sm'
                            : 'bg-slate-50 text-slate-400 border border-slate-200 hover:bg-slate-100'
                            }`}
                        title={listeningEnabled ? 'Listening ON — click to stop' : 'Listening OFF — click to start'}
                    >
                        <Mic size={13} className={listeningEnabled && isListening ? 'animate-pulse' : ''} />
                        <span>{listeningEnabled ? 'ON' : 'OFF'}</span>
                    </button>
                    <button
                        onClick={handleClearChat}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="Clear chat"
                    >
                        <Trash2 size={13} />
                        Clear
                    </button>
                </div>
            </div>

            {/* Messages Area – capped at ~20 lines; only the chat scrolls */}
            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-3 py-1 bg-slate-50/50">

                {isLoadingHistory && (
                    <div className="flex items-center justify-center py-8 text-slate-400 text-sm">
                        <Loader2 size={16} className="animate-spin mr-2" />
                        Loading history...
                    </div>
                )}

                {messages.slice(-30).map((msg) => (
                    <div key={msg.id} className={`flex gap-1.5 mb-0.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                        {/* Avatar */}
                        <div className={`w-5 h-5 mt-0.5 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user'
                            ? 'bg-slate-800 text-white'
                            : 'bg-gradient-to-br from-indigo-100 to-violet-50 border border-indigo-200 text-indigo-500'
                            }`}>
                            {msg.role === 'user' ? (
                                <span className="text-[9px] font-bold">{userName.charAt(0).toUpperCase()}</span>
                            ) : (
                                <Sparkles size={10} />
                            )}
                        </div>

                        {/* Bubble */}
                        <div className="max-w-[75%] group">
                            <div className={`px-2.5 py-1 rounded-xl text-xs leading-tight shadow-sm ${msg.role === 'user'
                                ? 'bg-indigo-600 text-white rounded-tr-sm'
                                : msg.isConfirmation
                                    ? 'bg-amber-50 text-slate-700 rounded-tl-sm border border-amber-200'
                                    : 'bg-white text-slate-700 rounded-tl-sm border border-slate-200'
                                }`}>
                                {msg.role === 'assistant' ? renderMarkdown(msg.text) : (
                                    <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                                )}
                            </div>
                            <div className={`flex items-center gap-1 px-1 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <span className="text-[10px] text-slate-400">{formatTime(msg.timestamp)}</span>
                            </div>
                        </div>
                    </div>
                ))}

                {/* Confirmation Buttons */}
                {awaitingConfirmation && !isThinking && (
                    <div className="flex gap-2 pl-11">
                        <button
                            onClick={handleConfirm}
                            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 transition-all shadow-sm active:scale-95"
                        >
                            <Check size={14} /> Confirm
                        </button>
                        <button
                            onClick={handleCancel}
                            className="flex items-center gap-1.5 px-4 py-2 bg-white text-slate-600 text-xs font-semibold rounded-lg border border-slate-200 hover:bg-slate-50 transition-all shadow-sm active:scale-95"
                        >
                            <X size={14} /> Cancel
                        </button>
                    </div>
                )}

                {/* Thinking indicator */}
                {isThinking && (
                    <div className="flex gap-3">
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-100 to-violet-50 border border-indigo-200 text-indigo-500 flex items-center justify-center shrink-0">
                            <Loader2 size={14} className="animate-spin" />
                        </div>
                        <div className="bg-white border border-slate-200 px-3 py-2 rounded-2xl rounded-tl-sm shadow-sm text-xs text-slate-400 italic flex items-center gap-2">
                            <span className="inline-flex gap-0.5">
                                <span className="w-1.5 h-1.5 bg-indigo-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                <span className="w-1.5 h-1.5 bg-indigo-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                <span className="w-1.5 h-1.5 bg-indigo-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                            </span>
                            Thinking...
                        </div>
                    </div>
                )}



                <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            <div className="shrink-0 border-t border-slate-200 bg-white">
                {/* Quick Actions — single-line scroll above input */}
                {showSuggestions && !isThinking && (
                    <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-1 overflow-x-auto scrollbar-hide">
                        <Zap size={11} className="text-amber-500 shrink-0" />
                        {suggestions.map((q, i) => (
                            <button key={i} onClick={() => handleSend(q)}
                                className="whitespace-nowrap text-[11px] bg-slate-50 border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-500 hover:text-indigo-600 px-2.5 py-1 rounded-full transition-all shrink-0">
                                {q}
                            </button>
                        ))}
                    </div>
                )}
                <div className="p-2">
                    <div className={`flex items-center gap-2 border rounded-xl p-2 transition-all ${isListening
                        ? 'border-red-400 ring-2 ring-red-100'
                        : 'border-slate-200 focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-50'
                        }`}>
                        <button onClick={handleVoiceInput} className={`p-2 rounded-lg transition-colors ${isListening ? 'bg-red-50 text-red-600' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'
                            }`}>
                            {isListening ? <StopCircle size={20} className="animate-pulse" /> : <Mic size={20} />}
                        </button>
                        {/* Doc Upload Button */}
                        <input type="file" ref={fileInputRef} className="hidden" accept="application/pdf,image/jpeg,image/png,image/webp"
                            onChange={(e) => { if (e.target.files?.[0]) { handleFileUpload(e.target.files[0]); e.target.value = ''; } }} />
                        <button onClick={() => fileInputRef.current?.click()} disabled={isThinking}
                            className="p-2 rounded-lg transition-colors text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-50"
                            title="Upload document for OCR">
                            <Paperclip size={20} />
                        </button>
                        <input
                            ref={inputRef}
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={awaitingConfirmation ? 'Type yes to confirm or no to cancel...' : 'Ask XS AI anything...'}
                            disabled={isThinking}
                            className="flex-1 bg-transparent outline-none text-sm font-medium text-slate-700 placeholder:text-slate-400"
                        />
                        <button
                            onClick={() => handleSend()}
                            disabled={!input.trim() || isThinking}
                            className="p-2 bg-gradient-to-br from-indigo-500 to-violet-600 text-white rounded-lg hover:from-indigo-600 hover:to-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm active:scale-95"
                        >
                            {isThinking ? (
                                <Loader2 size={18} className="animate-spin" />
                            ) : (
                                <Send size={18} />
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AiDashboard;
