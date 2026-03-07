import React, { useState, useRef, useEffect, useMemo } from 'react';
import { SalesOrder, Booking, BillOfLading, Invoice, Customer, User } from '../types';
import { ClipboardList, Ship, FileText, Receipt, LayoutDashboard, ArrowRight, Eye, Anchor, Sparkles, Send, Loader2, Mic, StopCircle, X, Volume2, VolumeX, Link2, ChevronRight, ChevronDown, ChevronUp, CheckCircle2, Clock, Circle, Search, Package, AlertTriangle } from 'lucide-react';
import { getCustomerPortalAgentResponse } from '../services/geminiService';
import { getSupabaseClient } from '../services/supabase';
import TalkingAvatar from '../components/TalkingAvatar';

interface CustomerPortalProps {
    customerName: string;
    currentUser: User;
    salesOrders: SalesOrder[];
    bookings: Booking[];
    billOfLadings: BillOfLading[];
    allBillOfLadings?: BillOfLading[];
    invoices: Invoice[];
    opportunities?: any[];
    estimates?: any[];
    proformas?: any[];
}

// Pipeline item = one shipment lifecycle row
interface PipelineItem {
    id: string;
    orderNumber: string;
    order?: SalesOrder;
    booking?: Booking;
    invoice?: Invoice;
    billOfLading?: BillOfLading;
    product: string;
    quantityLbs: number;
    quantityKgs: number;
    amount: number;
    currency: string;
    etd?: string;
    eta?: string;
    pol?: string;
    pod?: string;
    bookingNumber?: string;
    invoiceNumber?: string;
    invoiceDate?: string;
    blNumber?: string;
    containerNumber?: string;
    status: 'TO SHIP' | 'LOADED' | 'SHIPPED';
    hasOrder: boolean;
    hasBooking: boolean;
    hasInvoice: boolean;
    hasBL: boolean;
    progress: number;
}

type FilterTab = 'ALL' | 'TO_SHIP' | 'LOADED' | 'SHIPPED';

const CustomerPortal: React.FC<CustomerPortalProps> = ({
    customerName,
    currentUser,
    salesOrders,
    bookings,
    billOfLadings,
    allBillOfLadings,
    invoices,
    opportunities,
    estimates,
    proformas
}) => {
    const blsForLookup = allBillOfLadings || billOfLadings;
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<FilterTab>('ALL');
    const [searchQuery, setSearchQuery] = useState('');

    // Chat State
    const [chatInput, setChatInput] = useState('');
    const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'model', text: string }[]>([
        { role: 'model', text: "Hello! I can help you check the status of your orders, shipments, or invoices. What would you like to know?" }
    ]);
    const [isThinking, setIsThinking] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [language, setLanguage] = useState<'en' | 'pt' | 'es' | 'zh'>('en');
    const chatEndRef = useRef<HTMLDivElement>(null);
    const recognitionRef = useRef<any>(null);
    const [lastAIResponse, setLastAIResponse] = useState<string>('');
    const [lastInputWasVoice, setLastInputWasVoice] = useState<boolean>(false);
    const [isMuted, setIsMuted] = useState<boolean>(false);
    const [showChat, setShowChat] = useState(false);

    // Document Viewer
    const [viewingDoc, setViewingDoc] = useState<{ url: string; title: string; isBlob: boolean } | null>(null);
    // Sales Order View
    const [viewingOrder, setViewingOrder] = useState<SalesOrder | null>(null);

    // ─── Build Pipeline ─────────────────────────────────────────
    // Mirror ShipmentPipeline: Invoices first → SOs → Standalone Bookings
    const pipelineItems = useMemo((): PipelineItem[] => {
        const items: PipelineItem[] = [];
        const processedBookingNums = new Set<string>();
        const processedSONums = new Set<string>();
        const processedInvoiceIds = new Set<string>();

        // Build lookup maps
        const soMap = new Map<string, SalesOrder>();
        salesOrders.forEach(so => {
            soMap.set(so.orderNumber.trim().toUpperCase(), so);
            soMap.set(so.id, so);
        });

        const bookingMap = new Map<string, Booking>();
        bookings.forEach(b => bookingMap.set(b.bookingNumber, b));

        const blByBooking = new Map<string, BillOfLading>();
        const blByBlNumber = new Map<string, BillOfLading>();
        const blByConsignee = new Map<string, BillOfLading[]>();
        blsForLookup.forEach(bl => {
            if (bl.blNumber) blByBlNumber.set(bl.blNumber, bl);
            if (bl.consignee) {
                const key = bl.consignee.trim().toLowerCase().split(/\s+/)[0];
                if (key && key.length > 2) {
                    const arr = blByConsignee.get(key) || [];
                    arr.push(bl);
                    blByConsignee.set(key, arr);
                }
            }
        });
        billOfLadings.forEach(bl => {
            if (bl.blNumber) blByBlNumber.set(bl.blNumber, bl);
        });

        // Helper: find BL by multiple strategies
        const findBL = (bookingNum?: string, invoiceNum?: string, blRef?: string, customerName?: string): BillOfLading | undefined => {
            // 1. Direct BL number
            if (blRef) { const bl = blByBlNumber.get(blRef); if (bl) return bl; }
            // 2. By booking number in BL map
            if (bookingNum) { const bl = blByBooking.get(bookingNum); if (bl) return bl; }
            // 3. By consignee (customer name)
            if (customerName) {
                const key = customerName.trim().toLowerCase().split(/\s+/)[0];
                const candidates = blByConsignee.get(key);
                if (candidates && candidates.length > 0) {
                    if (bookingNum) {
                        const matched = candidates.find(bl => bl.bookingNumber === bookingNum);
                        if (matched) return matched;
                    }
                    return candidates.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];
                }
            }
            return undefined;
        };

        // Helper: get products from invoice items
        const getInvoiceProducts = (inv: Invoice): string => {
            try { const p = JSON.parse(inv.items || '[]'); return Array.isArray(p) ? p.map((i: any) => i.description || i.productName || i.productDescription || i.product).filter(Boolean).join(', ') : 'N/A'; } catch { return 'N/A'; }
        };

        // Helper: parse invoice qty (try grossWeight first, then items)
        const parseInvoiceQty = (inv: Invoice): number => {
            if (inv.grossWeight) { const c = String(inv.grossWeight).replace(/,/g, '').replace(/[^0-9.]/g, ''); return parseFloat(c) || 0; }
            try { const p = JSON.parse(inv.items || '[]'); if (Array.isArray(p)) return p.reduce((s: number, i: any) => s + (Number(i.quantity) || 0), 0); } catch { }
            return 0;
        };

        // Status logic
        const getStatus = (hasOrder: boolean, hasBooking: boolean, hasInvoice: boolean, hasBL: boolean): 'TO SHIP' | 'LOADED' | 'SHIPPED' => {
            if (hasBL) return 'SHIPPED';
            if (hasInvoice && hasBooking) return 'LOADED';
            return 'TO SHIP';
        };
        const getProgress = (hasOrder: boolean, hasBooking: boolean, hasInvoice: boolean, hasBL: boolean): number => {
            return ([hasOrder, hasBooking, hasInvoice, hasBL].filter(Boolean).length / 4) * 100;
        };

        // ── STEP 1: Process INVOICES first (they have most linked data) ──
        invoices.forEach(inv => {
            const invId = inv.id;
            if (processedInvoiceIds.has(invId)) return;
            processedInvoiceIds.add(invId);

            const soNum = (inv.soNumber || (inv as any).so_number || inv.customerPo || '').trim();
            const bkNum = (inv.bookingNumber || '').trim();

            // Find linked records
            const salesOrder = soNum ? (soMap.get(soNum.toUpperCase()) || soMap.get(soNum)) : undefined;
            const booking = bkNum ? bookingMap.get(bkNum) : undefined;
            const hasBookingLink = !!booking || !!bkNum;
            const billOfLading = findBL(bkNum, inv.invoiceNumber, (inv as any).bl, inv.soldTo || inv.shipTo);

            const qtyKgs = parseInvoiceQty(inv);
            const hasOrder = !!salesOrder;
            const hasBooking = hasBookingLink;
            const hasInvoice = true;
            const hasBL = !!billOfLading;

            // Track processed
            if (soNum) processedSONums.add(soNum.toUpperCase());
            if (bkNum) processedBookingNums.add(bkNum);
            if (booking?.bookingNumber) processedBookingNums.add(booking.bookingNumber);

            const qtyLbs = salesOrder ? salesOrder.items.reduce((s, i) => s + (i.quantity || 0), 0) : Math.round(qtyKgs * 2.20462);

            items.push({
                id: `inv-${invId}`,
                orderNumber: soNum || inv.invoiceNumber,
                order: salesOrder,
                booking,
                invoice: inv,
                billOfLading,
                product: salesOrder ? salesOrder.items.map(i => i.productName).filter(Boolean).join(', ') : getInvoiceProducts(inv),
                quantityLbs: qtyLbs,
                quantityKgs: qtyKgs || Math.round(qtyLbs / 2.20462),
                amount: parseFloat(String(inv.totalAmount || salesOrder?.totalAmount || 0)) || 0,
                currency: inv.currency || salesOrder?.currency || 'USD',
                etd: booking?.etd,
                eta: booking?.eta || billOfLading?.eta,
                pol: booking?.pol || salesOrder?.poa,
                pod: booking?.pod || salesOrder?.pod || (inv as any).pod,
                bookingNumber: booking?.bookingNumber || bkNum || undefined,
                invoiceNumber: inv.invoiceNumber,
                invoiceDate: inv.invoiceDate || (inv as any).date,
                blNumber: billOfLading?.blNumber || (inv as any).bl,
                containerNumber: booking?.containerNumber,
                status: getStatus(hasOrder, hasBooking, hasInvoice, hasBL),
                hasOrder, hasBooking, hasInvoice, hasBL,
                progress: getProgress(hasOrder, hasBooking, hasInvoice, hasBL)
            });
        });

        // ── STEP 2: Process SALES ORDERS not already covered by invoices ──
        salesOrders.forEach(order => {
            if (order.status === 'REJECTED') return;
            const soNum = order.orderNumber.trim().toUpperCase();
            if (processedSONums.has(soNum)) return;
            processedSONums.add(soNum);

            const booking = bookings.find(b => b.salesOrderId === order.id) || undefined;
            const billOfLading = booking ? findBL(booking.bookingNumber) : undefined;
            if (booking) processedBookingNums.add(booking.bookingNumber);

            const qtyLbs = order.items.reduce((s, i) => s + (i.quantity || 0), 0);
            const hasOrder = true;
            const hasBooking = !!booking;
            const hasInvoice = false;
            const hasBL = !!billOfLading;

            items.push({
                id: `so-${order.id}`,
                orderNumber: order.orderNumber,
                order,
                booking,
                invoice: undefined,
                billOfLading,
                product: order.items.map(i => i.productName).filter(Boolean).join(', ') || 'N/A',
                quantityLbs: qtyLbs,
                quantityKgs: Math.round(qtyLbs / 2.20462),
                amount: parseFloat(String(order.totalAmount || 0)) || 0,
                currency: order.currency || 'USD',
                etd: booking?.etd,
                eta: booking?.eta,
                pol: booking?.pol,
                pod: booking?.pod || order.pod,
                bookingNumber: booking?.bookingNumber,
                invoiceNumber: undefined,
                invoiceDate: undefined,
                blNumber: billOfLading?.blNumber,
                containerNumber: booking?.containerNumber,
                status: getStatus(hasOrder, hasBooking, false, hasBL),
                hasOrder, hasBooking, hasInvoice, hasBL,
                progress: getProgress(hasOrder, hasBooking, false, hasBL)
            });
        });

        // ── STEP 3: Process STANDALONE BOOKINGS not already covered ──
        bookings.forEach(booking => {
            if (processedBookingNums.has(booking.bookingNumber)) return;

            // Skip if this booking's linked SO was already processed
            const salesOrder = booking.salesOrderId ? (soMap.get(booking.salesOrderId) || undefined) : undefined;
            if (!salesOrder) return; // No linked SO → don't show standalone bookings
            if (processedSONums.has(salesOrder.orderNumber.trim().toUpperCase())) return;

            processedBookingNums.add(booking.bookingNumber);
            const billOfLading = booking.blNumber ? findBL(undefined, undefined, booking.blNumber) : findBL(booking.bookingNumber);

            const hasOrder = !!salesOrder;
            const hasBooking = true;
            const hasInvoice = false;
            const hasBL = !!billOfLading;
            const qtyLbs = salesOrder ? salesOrder.items.reduce((s, i) => s + (i.quantity || 0), 0) : 0;

            items.push({
                id: `bk-${booking.id}`,
                orderNumber: salesOrder?.orderNumber || booking.bookingNumber,
                order: salesOrder,
                booking,
                invoice: undefined,
                billOfLading,
                product: salesOrder ? salesOrder.items.map(i => i.productName).filter(Boolean).join(', ') : 'N/A',
                quantityLbs: qtyLbs,
                quantityKgs: Math.round(qtyLbs / 2.20462),
                amount: salesOrder?.totalAmount || 0,
                currency: salesOrder?.currency || 'USD',
                etd: booking.etd,
                eta: booking.eta,
                pol: booking.pol,
                pod: booking.pod,
                bookingNumber: booking.bookingNumber,
                invoiceNumber: undefined,
                invoiceDate: undefined,
                blNumber: billOfLading?.blNumber,
                containerNumber: booking.containerNumber,
                status: getStatus(hasOrder, hasBooking, false, hasBL),
                hasOrder, hasBooking, hasInvoice, hasBL,
                progress: getProgress(hasOrder, hasBooking, false, hasBL)
            });
        });

        return items.sort((a, b) => {
            const statusOrder = { 'TO SHIP': 0, 'LOADED': 1, 'SHIPPED': 2 };
            const sd = statusOrder[a.status] - statusOrder[b.status];
            if (sd !== 0) return sd;
            // Within SHIPPED, sort by invoiceDate newest first
            if (a.status === 'SHIPPED') {
                const da = new Date(a.invoiceDate || '').getTime() || 0;
                const db = new Date(b.invoiceDate || '').getTime() || 0;
                return db - da;
            }
            return 0;
        });
    }, [salesOrders, bookings, invoices, billOfLadings, blsForLookup]);

    // Stats
    const stats = useMemo(() => ({
        total: pipelineItems.length,
        toShip: pipelineItems.filter(i => i.status === 'TO SHIP').length,
        loaded: pipelineItems.filter(i => i.status === 'LOADED').length,
        shipped: pipelineItems.filter(i => i.status === 'SHIPPED').length
    }), [pipelineItems]);

    // Filter
    const filtered = useMemo(() => {
        let items = pipelineItems;
        if (activeTab === 'TO_SHIP') items = items.filter(i => i.status === 'TO SHIP');
        else if (activeTab === 'LOADED') items = items.filter(i => i.status === 'LOADED');
        else if (activeTab === 'SHIPPED') items = items.filter(i => i.status === 'SHIPPED');
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            items = items.filter(i => i.orderNumber.toLowerCase().includes(q) || i.product.toLowerCase().includes(q) || i.bookingNumber?.toLowerCase().includes(q) || i.invoiceNumber?.toLowerCase().includes(q) || i.blNumber?.toLowerCase().includes(q));
        }
        return items;
    }, [pipelineItems, activeTab, searchQuery]);

    // Totals
    const totalKgs = filtered.reduce((s, i) => s + i.quantityKgs, 0);
    const totalAmount = filtered.reduce((s, i) => s + (parseFloat(String(i.amount)) || 0), 0);

    // Auto-scroll chat
    useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

    // ─── Helpers ─────────────────────────────────────────────────
    const formatDate = (d?: string) => {
        if (!d) return '—';
        try { const dt = new Date(d); if (isNaN(dt.getTime())) return '—'; return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' }).replace(/ /g, '-').toUpperCase(); } catch { return '—'; }
    };

    const formatCurrency = (val: number) => `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const openDocument = (docUrl?: string, title: string = 'Document') => {
        if (!docUrl) { alert("No document available."); return; }
        try {
            if (docUrl.startsWith('data:')) {
                const arr = docUrl.split(','); const mime = arr[0].match(/:(.*?);/)?.[1] || 'application/pdf';
                const bstr = atob(arr[1]); let n = bstr.length; const u8arr = new Uint8Array(n);
                while (n--) { u8arr[n] = bstr.charCodeAt(n); }
                const blob = new Blob([u8arr], { type: mime }); const blobUrl = URL.createObjectURL(blob);
                setViewingDoc({ url: blobUrl, title, isBlob: true });
            } else { setViewingDoc({ url: docUrl, title, isBlob: false }); }
        } catch { alert("Could not load document."); }
    };

    const closeDocument = () => { if (viewingDoc?.isBlob) URL.revokeObjectURL(viewingDoc.url); setViewingDoc(null); };

    const changeLanguage = (lang: 'en' | 'pt' | 'es' | 'zh') => {
        setLanguage(lang);
        const texts: Record<string, string> = { en: "Hello! I can help you check the status of your orders, shipments, or invoices.", pt: "Olá! Posso ajudá-lo a verificar o status de seus pedidos, embarques ou faturas.", es: "¡Hola! Puedo ayudarte a verificar el estado de tus pedidos, envíos o facturas.", zh: "你好！我可以帮助您查看订单、发货或发票的状态。" };
        setChatMessages(prev => [...prev, { role: 'model', text: texts[lang] }]);
        if (!isMuted) setLastAIResponse(texts[lang]);
    };

    const handleSendMessage = async (isVoice: boolean = false) => {
        if (!chatInput.trim()) return;
        const userText = chatInput; setChatInput(''); setLastInputWasVoice(isVoice);
        setChatMessages(prev => [...prev, { role: 'user', text: userText }]); setIsThinking(true);
        try {
            const response = await getCustomerPortalAgentResponse(userText, chatMessages, { salesOrders, bookings, billOfLadings, invoices, opportunities, estimates, proformas, language });
            setChatMessages(prev => [...prev, { role: 'model', text: response }]);
            if (isVoice && !isMuted) setLastAIResponse(response);
        } catch { setChatMessages(prev => [...prev, { role: 'model', text: "Sorry, I encountered an error. Please try again." }]); }
        finally { setIsThinking(false); }
    };

    const sendVoiceMessage = async (transcript: string) => {
        if (!transcript.trim()) return; setChatInput(''); setLastInputWasVoice(true);
        setChatMessages(prev => [...prev, { role: 'user', text: transcript }]); setIsThinking(true);
        try {
            const response = await getCustomerPortalAgentResponse(transcript, chatMessages, { salesOrders, bookings, billOfLadings, invoices, opportunities, estimates, proformas, language });
            setChatMessages(prev => [...prev, { role: 'model', text: response }]);
            if (!isMuted) setLastAIResponse(response);
        } catch { const msg = "Sorry, error."; setChatMessages(prev => [...prev, { role: 'model', text: msg }]); if (!isMuted) setLastAIResponse(msg); }
        finally { setIsThinking(false); }
    };

    const handleVoiceInput = () => {
        if (isListening) { recognitionRef.current?.stop(); setIsListening(false); return; }
        const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SR) { alert("Voice not supported."); return; }
        const r = new SR();
        r.lang = language === 'pt' ? 'pt-BR' : language === 'es' ? 'es-ES' : language === 'zh' ? 'zh-CN' : 'en-US';
        r.interimResults = false; r.maxAlternatives = 1;
        r.onstart = () => setIsListening(true); r.onend = () => setIsListening(false);
        r.onerror = () => setIsListening(false);
        r.onresult = (e: any) => { const t = e.results[0][0].transcript; if (t) { setChatInput(t); sendVoiceMessage(t); } };
        recognitionRef.current = r; r.start();
    };

    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const firstName = currentUser?.name?.split(/[\s,]+/)[0] || 'there';

    // ─── Status badge colors ────
    const statusStyle = (s: string) => {
        if (s === 'SHIPPED') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
        if (s === 'LOADED') return 'bg-blue-100 text-blue-700 border-blue-200';
        return 'bg-amber-100 text-amber-700 border-amber-200';
    };

    // ─── Mini stage indicator ────
    const MiniStage: React.FC<{ done: boolean; code: string; label: string }> = ({ done, code, label }) => (
        <div className="flex flex-col items-center" title={label}>
            <div className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${done ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-400'}`}>{code}</div>
        </div>
    );

    return (
        <div className="h-full flex gap-0 overflow-hidden">
            {/* ─── Left Column: Pipeline ────────────────────────── */}
            <div className="flex-1 overflow-y-auto custom-scrollbar pb-12 pr-2">
                <div className="p-6 space-y-6 max-w-7xl mx-auto">

                    {/* ─── Welcome Header ──────────────────────────────── */}
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-800">
                                {greeting}, <span className="bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent">{firstName}</span> 👋
                            </h1>
                            <p className="text-sm text-slate-500 mt-0.5">Welcome to your {customerName} portal</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2 bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg border border-indigo-200">
                                <Anchor size={14} />
                                <span className="text-xs font-bold uppercase tracking-wide">Client Hub</span>
                            </div>
                        </div>
                    </div>


                    {/* ─── Filter Bar ───────────────────────────────────── */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                        <div className="flex items-center justify-between">
                            <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
                                {([
                                    { key: 'ALL', label: 'All', count: stats.total, color: 'indigo', activeBg: 'bg-indigo-50', activeText: 'text-indigo-700', badgeBg: 'bg-indigo-100 text-indigo-700', hoverText: 'hover:text-indigo-600' },
                                    { key: 'TO_SHIP', label: 'To Ship', count: stats.toShip, color: 'amber', activeBg: 'bg-amber-50', activeText: 'text-amber-700', badgeBg: 'bg-amber-100 text-amber-700', hoverText: 'hover:text-amber-600' },
                                    { key: 'LOADED', label: 'Loaded', count: stats.loaded, color: 'blue', activeBg: 'bg-blue-50', activeText: 'text-blue-700', badgeBg: 'bg-blue-100 text-blue-700', hoverText: 'hover:text-blue-600' },
                                    { key: 'SHIPPED', label: 'Shipped', count: stats.shipped, color: 'emerald', activeBg: 'bg-emerald-50', activeText: 'text-emerald-700', badgeBg: 'bg-emerald-100 text-emerald-700', hoverText: 'hover:text-emerald-600' }
                                ] as { key: FilterTab; label: string; count: number; color: string; activeBg: string; activeText: string; badgeBg: string; hoverText: string }[]).map(tab => (
                                    <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === tab.key ? `${tab.activeBg} shadow-sm ${tab.activeText} border border-current/10` : `text-slate-500 ${tab.hoverText}`}`}>
                                        {tab.label}
                                        <span className={`ml-2 px-1.5 py-0.5 rounded-full text-xs font-semibold ${activeTab === tab.key ? tab.badgeBg : 'bg-slate-200 text-slate-600'}`}>{tab.count}</span>
                                    </button>
                                ))}
                            </div>
                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search orders..." className="pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-400 outline-none w-56" />
                            </div>
                        </div>
                    </div>

                    {/* ─── Pipeline Table ──────────────────────────────── */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        {/* Header */}
                        <div className="flex items-center px-4 py-3 bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider gap-4">
                            {activeTab === 'SHIPPED' && <div className="w-20">Date</div>}
                            <div className="w-28">{activeTab === 'SHIPPED' ? 'Invoice #' : 'Order #'}</div>
                            <div className="flex-1 min-w-0">Product</div>
                            <div className="w-24">Booking</div>
                            <div className="w-20 text-right">QTY (KG)</div>
                            <div className="w-24 text-right">Amount</div>
                            <div className="w-20">ETD</div>
                            <div className="w-20">ETA</div>
                            <div className="flex items-center gap-0.5 w-[120px] justify-center">
                                <span>SO</span><span className="text-slate-300 mx-0.5">→</span>
                                <span>BK</span><span className="text-slate-300 mx-0.5">→</span>
                                <span>CI</span><span className="text-slate-300 mx-0.5">→</span>
                                <span>BL</span>
                            </div>
                            <div className="w-20 text-center">Status</div>
                            <div className="w-6"></div>
                        </div>

                        {/* Rows */}
                        {filtered.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                                <Package size={40} className="mb-3 opacity-30" />
                                <p className="font-medium">No shipments found</p>
                                <p className="text-xs mt-1">Try adjusting your filters</p>
                            </div>
                        ) : filtered.map(item => {
                            const isExpanded = expandedId === item.id;
                            return (
                                <div key={item.id} className={`border-b border-slate-100 transition-all ${item.status === 'TO SHIP' ? 'border-l-4 border-l-amber-400' : item.status === 'LOADED' ? 'border-l-4 border-l-blue-400' : 'border-l-4 border-l-emerald-400'} hover:bg-slate-50`}>
                                    <div className="flex items-center px-4 py-2.5 cursor-pointer gap-4" onClick={() => setExpandedId(isExpanded ? null : item.id)}>
                                        {activeTab === 'SHIPPED' && <div className="w-20 shrink-0 text-xs text-slate-600">{formatDate(item.invoiceDate)}</div>}
                                        <div className="w-28 shrink-0">
                                            {item.status !== 'SHIPPED' && !item.hasOrder && item.hasBooking && <span className="text-[9px] font-bold text-amber-500 uppercase">Booking</span>}
                                            <span className="font-mono font-bold text-sm text-blue-600 block">{item.status === 'SHIPPED' && item.invoiceNumber ? item.invoiceNumber : item.orderNumber}</span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <span className="text-xs text-slate-700 font-medium truncate block">{item.product}</span>
                                        </div>
                                        <div className="w-24 shrink-0">
                                            <span className="text-xs font-mono text-slate-600">{item.bookingNumber || '—'}</span>
                                        </div>
                                        <div className="w-20 shrink-0 text-right">
                                            <span className="text-xs font-mono font-bold text-slate-700">{Math.round(item.quantityKgs).toLocaleString()}</span>
                                        </div>
                                        <div className="w-24 shrink-0 text-right">
                                            <span className="text-xs font-mono font-medium text-emerald-600">{formatCurrency(item.amount)}</span>
                                        </div>
                                        <div className="w-20 shrink-0 text-xs text-slate-500">{formatDate(item.etd)}</div>
                                        <div className="w-20 shrink-0 text-xs font-bold text-teal-700">{formatDate(item.eta)}</div>
                                        <div className="flex items-center gap-0.5 w-[120px] justify-center shrink-0">
                                            <MiniStage done={item.hasOrder} code="SO" label="Sales Order" />
                                            <div className={`w-2 h-0.5 ${item.hasOrder ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                                            <MiniStage done={item.hasBooking} code="BK" label="Booking" />
                                            <div className={`w-2 h-0.5 ${item.hasBooking ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                                            <MiniStage done={item.hasInvoice} code="CI" label="Invoice" />
                                            <div className={`w-2 h-0.5 ${item.hasInvoice ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                                            <MiniStage done={item.hasBL} code="BL" label="Bill of Lading" />
                                        </div>
                                        <div className="w-20 shrink-0 text-center">
                                            <span className={`inline-flex items-center text-[10px] px-2 py-0.5 rounded-full font-bold border ${statusStyle(item.status)}`}>{item.status}</span>
                                        </div>
                                        <button className="p-1 hover:bg-slate-100 rounded shrink-0">{isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
                                    </div>

                                    {/* Expanded */}
                                    {isExpanded && (
                                        <div className="border-t border-slate-100 p-4 bg-slate-50/50">
                                            <div className="grid grid-cols-4 gap-4">
                                                {/* SO Card */}
                                                <div className={`bg-white rounded-lg p-3 border ${item.hasOrder ? 'border-blue-200 hover:border-blue-400 hover:shadow-md cursor-pointer' : 'border-slate-200'}`}
                                                    onClick={() => item.order && setViewingOrder(item.order)}>
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <ClipboardList size={16} className="text-blue-500" />
                                                        <span className="font-medium text-sm">Sales Order</span>
                                                        {item.hasOrder && <Eye size={14} className="text-blue-400 ml-auto" />}
                                                    </div>
                                                    <p className="text-sm font-semibold text-slate-800">{item.orderNumber}</p>
                                                    <div className={`inline-flex items-center gap-1 text-xs mt-1 px-2 py-0.5 rounded-full ${item.hasOrder ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                                        {item.hasOrder ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                                                        {item.hasOrder ? 'Complete' : 'Missing'}
                                                    </div>
                                                </div>
                                                {/* BK Card */}
                                                <div className={`bg-white rounded-lg p-3 border ${item.hasBooking ? 'border-indigo-200 hover:border-indigo-400 hover:shadow-md cursor-pointer' : 'border-slate-200'}`}
                                                    onClick={() => item.booking?.originalDocument && openDocument(item.booking.originalDocument, item.bookingNumber || 'Booking')}>
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <Ship size={16} className="text-indigo-500" />
                                                        <span className="font-medium text-sm">Booking</span>
                                                        {item.booking?.originalDocument && <Eye size={14} className="text-indigo-400 ml-auto" />}
                                                    </div>
                                                    <p className="text-sm font-semibold text-slate-800">{item.bookingNumber || '—'}</p>
                                                    {item.etd && <p className="text-xs text-slate-500 mt-0.5">ETD: {formatDate(item.etd)}</p>}
                                                    <div className={`inline-flex items-center gap-1 text-xs mt-1 px-2 py-0.5 rounded-full ${item.hasBooking ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                                        {item.hasBooking ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                                                        {item.hasBooking ? 'Complete' : 'Missing'}
                                                    </div>
                                                </div>
                                                {/* CI Card */}
                                                <div className={`bg-white rounded-lg p-3 border ${item.hasInvoice ? 'border-green-200 hover:border-green-400 hover:shadow-md cursor-pointer' : 'border-slate-200'}`}
                                                    onClick={() => item.invoice?.originalDocument && openDocument(item.invoice.originalDocument, item.invoiceNumber || 'Invoice')}>
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <Receipt size={16} className="text-green-500" />
                                                        <span className="font-medium text-sm">Invoice</span>
                                                        {item.invoice?.originalDocument && <Eye size={14} className="text-green-400 ml-auto" />}
                                                    </div>
                                                    <p className="text-sm font-semibold text-slate-800">{item.invoiceNumber || '—'}</p>
                                                    {item.amount > 0 && <p className="text-xs text-slate-500 mt-0.5">{formatCurrency(item.amount)}</p>}
                                                    <div className={`inline-flex items-center gap-1 text-xs mt-1 px-2 py-0.5 rounded-full ${item.hasInvoice ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                                        {item.hasInvoice ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                                                        {item.hasInvoice ? 'Complete' : 'Missing'}
                                                    </div>
                                                </div>
                                                {/* BL Card */}
                                                <div className={`bg-white rounded-lg p-3 border ${item.hasBL ? 'border-orange-200 hover:border-orange-400 hover:shadow-md cursor-pointer' : 'border-slate-200'}`}
                                                    onClick={() => item.billOfLading?.originalDocument && openDocument(item.billOfLading.originalDocument, item.blNumber || 'BL')}>
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <FileText size={16} className="text-orange-500" />
                                                        <span className="font-medium text-sm">Bill of Lading</span>
                                                        {item.billOfLading?.originalDocument && <Eye size={14} className="text-orange-400 ml-auto" />}
                                                    </div>
                                                    <p className="text-sm font-semibold text-slate-800">{item.blNumber || '—'}</p>
                                                    {item.eta && <p className="text-xs text-slate-500 mt-0.5">ETA: {formatDate(item.eta)}</p>}
                                                    <div className={`inline-flex items-center gap-1 text-xs mt-1 px-2 py-0.5 rounded-full ${item.hasBL ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                                        {item.hasBL ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                                                        {item.hasBL ? 'Complete' : 'Missing'}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {/* Footer Totals */}
                        {filtered.length > 0 && (
                            <div className="flex items-center px-4 py-3 bg-gradient-to-r from-slate-100 to-slate-50 border-t border-slate-200 text-xs font-bold text-slate-700 gap-4">
                                {activeTab === 'SHIPPED' && <div className="w-20"></div>}
                                <div className="w-28">TOTALS</div>
                                <div className="flex-1">{filtered.length} shipments</div>
                                <div className="w-24"></div>
                                <div className="w-20 text-right font-mono">{Math.round(totalKgs).toLocaleString()} KG</div>
                                <div className="w-24 text-right font-mono text-emerald-600">{formatCurrency(totalAmount)}</div>
                                <div className="w-20"></div>
                                <div className="w-20"></div>
                                <div className="w-[120px]"></div>
                                <div className="w-20"></div>
                                <div className="w-6"></div>
                            </div>
                        )}
                    </div>

                </div>
            </div>

            {/* ─── Right Column: MAX AI Sidebar ───────────────────── */}
            <div className="w-[340px] shrink-0 border-l border-slate-200 bg-white flex flex-col h-full">
                {/* Sidebar Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-rose-50 to-pink-50 shrink-0">
                    <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Sparkles size={16} className="text-rose-600" /> MAX AI</h2>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setIsMuted(!isMuted)} className={`p-1 rounded-full transition-colors ${isMuted ? 'bg-rose-200 text-rose-600' : 'bg-rose-100 text-rose-400 hover:bg-rose-200'}`}>{isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>
                        <div className="flex gap-1">{(['en', 'pt', 'es', 'zh'] as const).map(l => (
                            <button key={l} onClick={() => changeLanguage(l)} className={`text-sm transition-transform hover:scale-110 ${language === l ? 'opacity-100 scale-110' : 'opacity-50 grayscale'}`}>
                                {l === 'en' ? '🇺🇸' : l === 'pt' ? '🇧🇷' : l === 'es' ? '🇪🇸' : '🇨🇳'}
                            </button>
                        ))}</div>
                    </div>
                </div>
                {/* Avatar */}
                <div className="p-4 border-b border-rose-100 bg-gradient-to-b from-rose-50 to-pink-50 flex justify-center shrink-0">
                    <TalkingAvatar text={lastAIResponse} autoSpeak={lastInputWasVoice && !isMuted} size="xl" variant="max" lang={language} showControls={false} onSpeakStart={() => setIsListening(false)} />
                </div>
                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50 custom-scrollbar">
                    {chatMessages.map((msg, idx) => (
                        <div key={idx} className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-white text-[10px] font-bold ${msg.role === 'user' ? 'bg-slate-800' : 'bg-rose-400'}`}>{msg.role === 'user' ? 'You' : 'M'}</div>
                            <div className={`px-3 py-2 rounded-xl text-xs max-w-[85%] ${msg.role === 'user' ? 'bg-white text-slate-800 border border-slate-200 rounded-tr-none' : 'bg-rose-400 text-white rounded-tl-none shadow-sm'}`}>{msg.text}</div>
                        </div>
                    ))}
                    {isThinking && <div className="flex gap-2"><div className="w-7 h-7 rounded-full bg-rose-400 flex items-center justify-center shrink-0 text-white text-[10px] font-bold">M</div><div className="bg-rose-400 px-3 py-2 rounded-xl rounded-tl-none flex items-center gap-1"><span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" /><span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce delay-75" /><span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce delay-150" /></div></div>}
                    <div ref={chatEndRef} />
                </div>
                {/* Input */}
                <div className="p-3 bg-white border-t border-slate-200 shrink-0">
                    <div className="relative flex items-center gap-2">
                        <input className="w-full pl-3 pr-20 py-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-rose-400 outline-none text-xs" placeholder="Ask about your orders..." value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage(false)} disabled={isThinking} />
                        <div className="absolute right-1 flex items-center gap-1">
                            <button onClick={handleVoiceInput} className={`p-1.5 rounded-md transition-colors ${isListening ? 'text-red-500 bg-red-50 animate-pulse' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}>{isListening ? <StopCircle size={14} /> : <Mic size={14} />}</button>
                            <button onClick={() => handleSendMessage(false)} disabled={!chatInput.trim() || isThinking} className="p-1.5 bg-rose-400 text-white rounded-md hover:bg-rose-500 transition-colors disabled:opacity-50">{isThinking ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}</button>
                        </div>
                    </div>
                </div>
            </div>

            {/* ─── Document Viewer Modal ────────────────────────── */}
            {viewingDoc && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col">
                        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2"><FileText size={20} className="text-blue-600" /> {viewingDoc.title}</h3>
                            <button onClick={closeDocument} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-200 rounded-full"><X size={24} /></button>
                        </div>
                        <div className="flex-1 bg-slate-100 p-2 overflow-hidden">
                            <iframe src={viewingDoc.url} className="w-full h-full rounded border border-slate-300 bg-white" title="Document" />
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Sales Order Detail Modal ─────────────────────── */}
            {viewingOrder && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden max-h-[90vh] flex flex-col">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                            <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2"><ClipboardList size={20} className="text-blue-600" /> Sales Order #{viewingOrder.orderNumber}</h3>
                            <button onClick={() => setViewingOrder(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>
                        <div className="p-6 overflow-y-auto custom-scrollbar">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 text-sm">
                                <div><p className="text-xs text-slate-500 uppercase font-bold">Date</p><p className="text-slate-700">{viewingOrder.orderDate}</p></div>
                                <div><p className="text-xs text-slate-500 uppercase font-bold">Status</p><span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${viewingOrder.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{viewingOrder.status}</span></div>
                                <div><p className="text-xs text-slate-500 uppercase font-bold">Total</p><p className="font-mono font-bold">{viewingOrder.currency} {viewingOrder.totalAmount.toLocaleString()}</p></div>
                                <div><p className="text-xs text-slate-500 uppercase font-bold">Terms</p><p className="text-slate-700">{viewingOrder.paymentTerms}</p></div>
                            </div>
                            <div className="border border-slate-200 rounded-lg overflow-hidden">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-slate-100 text-xs text-slate-500 uppercase"><tr><th className="p-3">Product</th><th className="p-3 text-right">Quantity</th><th className="p-3 text-right">Unit Price</th><th className="p-3 text-right">Total</th></tr></thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {viewingOrder.items.map((item, i) => (
                                            <tr key={i}><td className="p-3"><div className="font-medium text-slate-700">{item.productName}</div></td><td className="p-3 text-right">{item.quantity.toLocaleString()} lbs<div className="text-xs text-slate-400">{(item.quantity * 0.453592).toLocaleString(undefined, { maximumFractionDigits: 0 })} kg</div></td><td className="p-3 text-right">${item.unitPrice.toFixed(4)}</td><td className="p-3 text-right font-bold">${item.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td></tr>
                                        ))}
                                    </tbody>
                                    <tfoot className="bg-slate-50 font-bold"><tr><td colSpan={3} className="p-3 text-right">Total</td><td className="p-3 text-right">{viewingOrder.currency} {viewingOrder.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td></tr></tfoot>
                                </table>
                            </div>
                        </div>
                        <div className="p-4 bg-slate-50 border-t flex justify-end"><button onClick={() => setViewingOrder(null)} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-bold hover:bg-slate-50">Close</button></div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CustomerPortal;