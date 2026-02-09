import React, { useState, useRef, useEffect, useMemo } from 'react';
import { SalesOrder, Booking, FreightQuote, CargoAgent, User, Company, BillOfLading, Customer, Invoice } from '../types';
import { Bot, Sparkles, Send, Loader2, Ship, Link, Plus, ArrowRight, Truck, Anchor, Search, AlertCircle, CheckCircle2, Clock, MapPin, Package, X, FileText, ClipboardList, Mail, Eye, Edit, Trash2, ArrowUp, ArrowDown, Filter, Save, Download, Scale } from 'lucide-react';
import { getLogisticsAgentResponse, generateContextualEmail } from '../services/geminiService';
import { getAccountFor } from '../services/smailAuth';
import { sendEmail } from '../services/emailService';
import jsPDF from 'jspdf';
import { getSupabaseClient } from '../services/supabase';

interface AiLogisticsManagerProps {
    salesOrders: SalesOrder[];
    bookings: Booking[];
    billOfLadings: BillOfLading[];
    freightQuotes: FreightQuote[];
    cargoAgents: CargoAgent[];
    onUpdateBooking: (b: Booking) => void;
    onUpdateBillOfLading: (bl: BillOfLading) => void;
    onAddBooking: (b: Booking) => void;
    onAddFreightQuote: (fq: FreightQuote) => void;
    currentUser: User;
    currentCompanyId: string;
    availableCompanies: Company[];
    showPendingOrders?: boolean; // New prop to control layout
    customers: Customer[];
    invoices: Invoice[];
}

const AiLogisticsManager: React.FC<AiLogisticsManagerProps> = ({
    salesOrders,
    bookings,
    billOfLadings,
    freightQuotes,
    cargoAgents,
    onUpdateBooking,
    onUpdateBillOfLading,
    onAddBooking,
    onAddFreightQuote,
    currentUser,
    currentCompanyId,
    availableCompanies,
    showPendingOrders = true, // Default to showing everything
    customers = [], // Default empty
    invoices = [] // Default empty
}) => {
    // --- STATE ---
    const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null);
    const [activeTab, setActiveTab] = useState<'MATCH' | 'REQUEST'>('MATCH');
    const [resumeTab, setResumeTab] = useState<'BOOKINGS' | 'BL' | 'SALES_ORDERS' | 'COMPARE'>('BOOKINGS');

    // Table State
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>({ key: 'date', direction: 'asc' });
    const [filters, setFilters] = useState<Record<string, string>>({});
    const [activeFilterColumn, setActiveFilterColumn] = useState<string | null>(null);

    // Edit Modal State
    const [showBookingEditModal, setShowBookingEditModal] = useState(false);
    const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
    const [editForm, setEditForm] = useState<Partial<Booking>>({});
    const [isReadOnly, setIsReadOnly] = useState(false);

    // AI Chat
    const [messages, setMessages] = useState<{ role: 'user' | 'model', text: string }[]>([
        { role: 'model', text: "Hello. I am your Logistics AI. Select a Sales Order to begin optimization. I can help you find the best freight rates or match existing bookings." }
    ]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    // Email Sending State
    const [sendingEmails, setSendingEmails] = useState(false);
    const [showEmailPreviewModal, setShowEmailPreviewModal] = useState(false);
    // BL Modal State
    const [showBLEditModal, setShowBLEditModal] = useState(false);
    const [editingBL, setEditingBL] = useState<BillOfLading | null>(null);
    const [blEditForm, setBLEditForm] = useState<Partial<BillOfLading>>({});

    // PDF Preview Modal State
    const [showPdfPreviewModal, setShowPdfPreviewModal] = useState(false);
    const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
    const [pdfPreviewTitle, setPdfPreviewTitle] = useState<string>('');

    const [pendingEmailDrafts, setPendingEmailDrafts] = useState<{
        agentId: string;
        agentName: string;
        to: string;
        subject: string;
        htmlBody: string;
        preferredSender: string;
        ccList: string[];
        attachments?: { name: string; contentBytes: string; contentType: string }[];
    }[]>([]);

    const chatEndRef = useRef<HTMLDivElement>(null);

    // Search State for Active Logistics (Legacy Search - Keep for fallback or global search)
    const [logisticsSearch, setLogisticsSearch] = useState('');

    // Filter orders ready to ship (Approved but not Fulfilled)
    const ordersToShip = salesOrders.filter(o => o.status === 'APPROVED');

    // Auto-scroll chat
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Update AI context when order selected
    useEffect(() => {
        if (selectedOrder) {
            handleAiMessage(`I selected Order #${selectedOrder.orderNumber}. Analyze shipping options for ${selectedOrder.pod || 'destination'}.`, true);
        }
    }, [selectedOrder]);

    // --- LOGIC HELPERS ---

    const getPortCode = (portString?: string): string => {
        if (!portString) return '';
        const s = portString.trim();
        const match = s.match(/\(([^)]+)\)$/);
        return match ? match[1] : s;
    };

    const formatDate = (dateString?: string) => {
        if (!dateString) return '-';
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return dateString;

            // Adjust for timezone offset to keep the visual date same as string date if it's YYYY-MM-DD
            const adjustedDate = new Date(date.getTime() + date.getTimezoneOffset() * 60000);

            const day = adjustedDate.getDate().toString().padStart(2, '0');
            // Format: dd-mmm-yy (lowercase month)
            const month = adjustedDate.toLocaleString('en-US', { month: 'short' }).toLowerCase();
            const year = adjustedDate.getFullYear().toString().slice(-2);

            return `${day}-${month}-${year}`;
        } catch (e) {
            return dateString;
        }
    };

    const getFirstWord = (str?: string) => {
        if (!str) return '';
        return str.split(' ')[0];
    };

    const getFirstTwoWords = (str?: string) => {
        if (!str) return '';
        return str.split(' ').slice(0, 2).join(' ');
    };

    // --- ACTIONS HELPERS ---
    // --- ACTIONS HELPERS ---
    // handleEmailPreview defined below with generated PDF support




    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    // --- BL ACTIONS ---


    const handleEditBL = (bl: BillOfLading) => {
        setEditingBL(bl);
        setBLEditForm({
            blNumber: bl.blNumber,
            consignee: bl.consignee,
            portLoading: bl.portLoading,
            portDischarge: bl.portDischarge,
            shippedDate: bl.shippedDate
        });
        setIsReadOnly(false);
        setShowBLEditModal(true);
    };

    const handleSaveBL = () => {
        if (editingBL && onUpdateBillOfLading) {
            const updatedBL = { ...editingBL, ...blEditForm };
            onUpdateBillOfLading(updatedBL);
        }
        setShowBLEditModal(false);
        setEditingBL(null);
    };

    const handleEditBooking = (booking: Booking) => {
        setEditingBooking(booking);
        setEditForm({
            status: booking.status,
            etd: booking.etd,
            eta: booking.eta,
            carrier: booking.carrier,
            containerNumber: booking.containerNumber,
            blNumber: booking.blNumber
        });
        setIsReadOnly(false);
        setShowBookingEditModal(true);
    };



    const handleSaveBooking = () => {
        if (editingBooking && onUpdateBooking) {
            onUpdateBooking({
                ...editingBooking,
                ...editForm
            });
            setShowBookingEditModal(false);
            setEditingBooking(null);
        }
    };

    // Filter Popover Render Helper
    const renderFilterPopover = (columnKey: string, placeholder: string, options?: string[]) => {
        if (activeFilterColumn !== columnKey) return null;

        return (
            <div className="absolute top-full left-0 mt-2 w-48 bg-white rounded-lg shadow-xl border border-slate-200 z-50 p-2 animate-in fade-in zoom-in-95">
                <div className="flex flex-col gap-2">
                    <div className="flex gap-1 border-b border-slate-100 pb-2">
                        <button onClick={() => setSortConfig({ key: columnKey, direction: 'asc' })} className="flex-1 p-1 hover:bg-slate-100 rounded text-[10px] flex items-center justify-center gap-1 text-slate-600"><ArrowUp size={12} /> Asc</button>
                        <button onClick={() => setSortConfig({ key: columnKey, direction: 'desc' })} className="flex-1 p-1 hover:bg-slate-100 rounded text-[10px] flex items-center justify-center gap-1 text-slate-600"><ArrowDown size={12} /> Desc</button>
                    </div>
                    {options ? (
                        <select
                            autoFocus
                            className="w-full text-xs p-2 border border-slate-200 rounded focus:ring-2 focus:ring-blue-100 outline-none bg-white"
                            value={filters[columnKey] || ''}
                            onChange={(e) => handleFilterChange(columnKey, e.target.value)}
                        >
                            <option value="">All Statuses</option>
                            {options.map(opt => (
                                <option key={opt} value={opt}>{opt}</option>
                            ))}
                        </select>
                    ) : (
                        <input
                            autoFocus
                            className="w-full text-xs p-2 border border-slate-200 rounded focus:ring-2 focus:ring-blue-100 outline-none"
                            placeholder={placeholder}
                            value={filters[columnKey] || ''}
                            onChange={(e) => handleFilterChange(columnKey, e.target.value)}
                        />
                    )}
                    <button onClick={() => setActiveFilterColumn(null)} className="text-[10px] text-blue-600 hover:underline self-end">Close</button>
                </div>
            </div>
        );
    };

    const handleFilterChange = (key: string, value: string) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    const sortData = (data: any[]) => {
        if (!sortConfig) return data;
        return [...data].sort((a, b) => {
            let aVal = a[sortConfig.key];
            let bVal = b[sortConfig.key];

            // Handle nested or mapped fields logic if simpler keys passed
            if (sortConfig.key === 'customer' && a.customer) aVal = a.customer;
            if (sortConfig.key === 'consignee' && a.consignee) aVal = a.consignee || a.shipper;

            if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    };

    // Filter Logic for Resume Table
    const filteredBookings = useMemo(() => {
        let data = bookings.filter(b => {
            // Global Search
            const globalMatch = !logisticsSearch ||
                b.bookingNumber.toLowerCase().includes(logisticsSearch.toLowerCase()) ||
                b.customer.toLowerCase().includes(logisticsSearch.toLowerCase());

            if (!globalMatch) return false;

            // Column Filters
            if (filters['bookingNumber'] && !b.bookingNumber.toLowerCase().includes(filters['bookingNumber'].toLowerCase())) return false;
            if (filters['customer'] && !b.customer.toLowerCase().includes(filters['customer'].toLowerCase())) return false;
            if (filters['pol'] && !getPortCode(b.pol).toLowerCase().includes(filters['pol'].toLowerCase())) return false;
            if (filters['pod'] && !getPortCode(b.pod).toLowerCase().includes(filters['pod'].toLowerCase())) return false;
            if (filters['etd'] && !b.etd?.includes(filters['etd'])) return false;

            return true;
        });

        // Apply Sort
        if (sortConfig) {
            data.sort((a, b) => {
                let aVal: any = '';
                let bVal: any = '';

                // Map keys to data fields
                switch (sortConfig.key) {
                    case 'bookingNumber': aVal = a.bookingNumber; bVal = b.bookingNumber; break;
                    case 'customer': aVal = a.customer; bVal = b.customer; break;
                    case 'pol': aVal = getPortCode(a.pol); bVal = getPortCode(b.pol); break;
                    case 'pod': aVal = getPortCode(a.pod); bVal = getPortCode(b.pod); break;
                    case 'date': aVal = a.etd; bVal = b.etd; break;
                    default: aVal = a[sortConfig.key] || ''; bVal = b[sortConfig.key] || '';
                }

                if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return data;
    }, [bookings, logisticsSearch, filters, sortConfig]);

    const filteredBLs = useMemo(() => {
        let data = billOfLadings.filter(bl => {
            // Global Search
            const globalMatch = !logisticsSearch ||
                bl.blNumber.toLowerCase().includes(logisticsSearch.toLowerCase()) ||
                (bl.consignee && bl.consignee.toLowerCase().includes(logisticsSearch.toLowerCase())) ||
                (bl.shipper && bl.shipper.toLowerCase().includes(logisticsSearch.toLowerCase()));

            if (!globalMatch) return false;

            // Column Filters
            if (filters['blNumber'] && !bl.blNumber.toLowerCase().includes(filters['blNumber'].toLowerCase())) return false;
            if (filters['consignee'] && !(bl.consignee || bl.shipper || '').toLowerCase().includes(filters['consignee'].toLowerCase())) return false;
            if (filters['portLoading'] && !getPortCode(bl.portLoading).toLowerCase().includes(filters['portLoading'].toLowerCase())) return false;
            if (filters['portDischarge'] && !getPortCode(bl.portDischarge).toLowerCase().includes(filters['portDischarge'].toLowerCase())) return false;
            if (filters['shippedDate'] && !bl.shippedDate?.includes(filters['shippedDate'])) return false;

            return true;
        });

        // Apply Sort
        if (sortConfig) {
            data.sort((a, b) => {
                let aVal: any = '';
                let bVal: any = '';

                switch (sortConfig.key) {
                    case 'bookingNumber': aVal = a.blNumber; bVal = b.blNumber; break; // Re-use key for simplicity or map
                    case 'blNumber': aVal = a.blNumber; bVal = b.blNumber; break;
                    case 'customer': aVal = a.consignee || a.shipper; bVal = b.consignee || b.shipper; break;
                    case 'consignee': aVal = a.consignee || a.shipper; bVal = b.consignee || b.shipper; break;
                    case 'pol': aVal = getPortCode(a.portLoading); bVal = getPortCode(b.portLoading); break;
                    case 'portLoading': aVal = getPortCode(a.portLoading); bVal = getPortCode(b.portLoading); break;
                    case 'pod': aVal = getPortCode(a.portDischarge); bVal = getPortCode(b.portDischarge); break;
                    case 'portDischarge': aVal = getPortCode(a.portDischarge); bVal = getPortCode(b.portDischarge); break;
                    case 'date': aVal = a.shippedDate; bVal = b.shippedDate; break;
                    case 'shippedDate': aVal = a.shippedDate; bVal = b.shippedDate; break;
                    default: aVal = a[sortConfig.key as keyof BillOfLading] || ''; bVal = b[sortConfig.key as keyof BillOfLading] || '';
                }

                if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return data;
    }, [billOfLadings, logisticsSearch, filters, sortConfig]);

    // 1. Find Available Bookings that match the Order's Route (POA -> POL, POD -> POD)
    const getMatchingBookings = (order: SalesOrder) => {
        const orderPodCode = getPortCode(order.pod).toLowerCase();
        const orderPoaCode = getPortCode(order.poa).toLowerCase();

        return bookings.filter(b => {
            // Must be AVAILABLE (unassigned)
            if ((b.status as any) !== 'AVAILABLE') return false;

            // Basic route matching logic
            const bookingPodCode = getPortCode(b.pod).toLowerCase();
            const bookingPolCode = getPortCode(b.pol).toLowerCase();

            // Match POD: Exact or Partial inclusion
            const podMatch = !orderPodCode || bookingPodCode.includes(orderPodCode) || orderPodCode.includes(bookingPodCode);

            // Match POA (Order) -> POL (Booking): Exact or Partial inclusion
            const poaMatch = !orderPoaCode || bookingPolCode.includes(orderPoaCode) || orderPoaCode.includes(bookingPolCode);

            return podMatch && poaMatch;
        });
    };

    const filteredSalesOrders = useMemo(() => {
        let data = salesOrders.filter(so => {
            // Global Search
            const globalMatch = !logisticsSearch ||
                so.orderNumber.toLowerCase().includes(logisticsSearch.toLowerCase()) ||
                so.customerName.toLowerCase().includes(logisticsSearch.toLowerCase());

            if (!globalMatch) return false;

            // Column Filters (Reusing existing keys for mapped SO fields)
            if (filters['bookingNumber'] && !so.orderNumber.toLowerCase().includes(filters['bookingNumber'].toLowerCase())) return false;
            if (filters['customer'] && !so.customerName.toLowerCase().includes(filters['customer'].toLowerCase())) return false;
            if (filters['status'] && !so.status.toLowerCase().includes(filters['status'].toLowerCase())) return false;
            // Map POA -> POL filter, POD -> POD filter
            if (filters['pol'] && !getPortCode(so.poa).toLowerCase().includes(filters['pol'].toLowerCase())) return false;
            if (filters['pod'] && !getPortCode(so.pod).toLowerCase().includes(filters['pod'].toLowerCase())) return false;
            if (filters['etd'] && !so.readinessDate?.includes(filters['etd'])) return false;

            return true;
        });

        // Apply Sort
        if (sortConfig) {
            data.sort((a, b) => {
                let aVal: any = '';
                let bVal: any = '';

                // Map keys to data fields
                switch (sortConfig.key) {
                    case 'bookingNumber': aVal = a.orderNumber; bVal = b.orderNumber; break;
                    case 'customer': aVal = a.customerName; bVal = b.customerName; break;
                    case 'status': aVal = a.status; bVal = b.status; break;
                    case 'pol': aVal = getPortCode(a.poa); bVal = getPortCode(b.poa); break;
                    case 'pod': aVal = getPortCode(a.pod); bVal = getPortCode(b.pod); break;
                    case 'etd': aVal = a.readinessDate; bVal = b.readinessDate; break;
                    default: aVal = a[sortConfig.key as keyof SalesOrder] || ''; bVal = b[sortConfig.key as keyof SalesOrder] || '';
                }

                if (!aVal) return 1;
                if (!bVal) return -1;
                if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return data;
    }, [salesOrders, logisticsSearch, filters, sortConfig]);

    // 2. Find Valid Freight Quotes for the Order
    const getMatchingQuotes = (order: SalesOrder) => {
        const orderPod = (order.pod || '').toLowerCase().trim();
        const soMethod = order.deliveryMethod;

        return freightQuotes.filter(q => {
            if (q.status !== 'ACTIVE') return false;

            // Type Check
            let requiredType = '';
            if (soMethod === 'PORT_TO_PORT') requiredType = 'PORT_PORT';
            else if (soMethod === 'DOOR_TO_PORT') requiredType = 'DOOR_PORT';
            else if (soMethod === 'DOOR_TO_DOOR') requiredType = 'DOOR_DOOR';
            else if (soMethod === 'PORT_TO_DOOR') requiredType = 'PORT_TO_DOOR';

            if (requiredType && q.freightType !== requiredType) return false;

            // Destination Check
            if (!orderPod) return true; // If order has no POD, show all valid quotes for type

            const qDestName = (q.destinationPort || '').toLowerCase().trim();
            const qDestCode = (q.destinationPortCode || '').toLowerCase().trim();

            return (qDestName && orderPod.includes(qDestName)) ||
                (qDestCode && orderPod.includes(qDestCode)) ||
                (orderPod.includes(qDestName)) ||
                (orderPod.includes(qDestCode));
        });
    };

    const filteredInvoices = useMemo(() => {
        let data = invoices.filter(inv => {
            // Global Search
            const globalMatch = !logisticsSearch ||
                inv.invoiceNumber.toLowerCase().includes(logisticsSearch.toLowerCase()) ||
                (inv.soldTo || '').toLowerCase().includes(logisticsSearch.toLowerCase());

            if (!globalMatch) return false;

            // Column Filters
            if (filters['invoiceNumber'] && !inv.invoiceNumber.toLowerCase().includes(filters['invoiceNumber'].toLowerCase())) return false;
            if (filters['customer'] && !(inv.soldTo || '').toLowerCase().includes(filters['customer'].toLowerCase())) return false;
            // Booking Number Filter (transportRef)
            if (filters['bookingNumber'] && !(inv.transportRef || '').toLowerCase().includes(filters['bookingNumber'].toLowerCase())) return false;
            // SO Number Filter
            if (filters['soNumber'] && !(inv.soNumber || '').toLowerCase().includes(filters['soNumber'].toLowerCase())) return false;

            return true;
        });

        // Apply Sort
        if (sortConfig) {
            data.sort((a, b) => {
                let aVal: any = '';
                let bVal: any = '';

                // Map keys
                switch (sortConfig.key) {
                    case 'invoiceNumber': aVal = a.invoiceNumber; bVal = b.invoiceNumber; break;
                    case 'date': aVal = a.invoiceDate; bVal = b.invoiceDate; break;
                    case 'customer': aVal = a.soldTo; bVal = b.soldTo; break;
                    case 'bookingNumber': aVal = a.transportRef; bVal = b.transportRef; break;
                    case 'soNumber': aVal = a.soNumber; bVal = b.soNumber; break;
                    case 'amount': aVal = a.totalAmount; bVal = b.totalAmount; break;
                    default: aVal = a[sortConfig.key as keyof Invoice] || ''; bVal = b[sortConfig.key as keyof Invoice] || '';
                }

                if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return data;
    }, [invoices, logisticsSearch, filters, sortConfig]);

    // --- GROUPED QUOTES FOR COMPARISON VIEW ---
    const groupedQuotes = useMemo(() => {
        const groups: Record<string, FreightQuote[]> = {};

        freightQuotes.filter(q => q.status === 'ACTIVE').forEach(quote => {
            // Create unique route key from Pickup + Origin + Destination
            const pickup = ((quote as any).pickupLocation || (quote as any).pickup_location || 'ANY').toUpperCase().trim();
            const origin = ((quote as any).originPortCode || (quote as any).origin_port_code || (quote as any).originPort || 'ANY').toUpperCase().trim();
            const dest = ((quote as any).destinationPortCode || (quote as any).destination_port_code || (quote as any).destinationPort || 'ANY').toUpperCase().trim();
            const routeKey = `${pickup}|${origin}|${dest}`;

            if (!groups[routeKey]) groups[routeKey] = [];
            groups[routeKey].push(quote);
        });

        // Return all routes, sorted by number of quotes (descending)
        return Object.entries(groups)
            .sort((a, b) => b[1].length - a[1].length);
    }, [freightQuotes]);

    // --- TOOL HANDLERS ---
    const executeSendEmail = async (recipientName: string, subject: string, body: string) => {
        // Determine Context Company
        let contextCompanyId = currentCompanyId;
        if (contextCompanyId === 'ALL') {
            // Fallback to selected order or first available order if in global view
            contextCompanyId = selectedOrder?.companyId || (ordersToShip.length > 0 ? ordersToShip[0].companyId : '');
        }

        // Identify Company Details
        const company = availableCompanies.find(c => c.id === contextCompanyId);
        const companyName = company?.name.toUpperCase() || '';

        // Default Settings
        let preferredSender = 'ai.agent@xsolution.com';
        let ccList: string[] = ['felipe@xsolution.com'];

        // Logic Rule: EC4 ENTERPRISES
        if (companyName.includes('EC4 ENTERPRISES')) {
            preferredSender = 'ai.agent@ec4.enterprises';
            ccList = ['felipe@xsolution.com'];
        }
        // Logic Rule: XSOLUTION (Explicit or Default)
        else if (companyName.includes('XSOLUTION')) {
            preferredSender = 'ai.agent@xsolution.com';
            ccList = ['felipe@xsolution.com'];
        }

        // Find recipient email from cargoAgents list
        const agent = cargoAgents.find(a => a.name.toLowerCase().includes(recipientName.toLowerCase()));
        const recipientEmail = agent?.email || '';

        if (!recipientEmail) {
            setMessages(prev => [...prev, { role: 'model', text: `⚠️ Could not find email address for agent '${recipientName}' in database.` }]);
            return;
        }

        setMessages(prev => [...prev, { role: 'model', text: `📧 Sending email to ${recipientName}...` }]);

        const result = await sendEmail(
            {
                to: [recipientEmail],
                cc: ccList,
                subject: subject,
                htmlBody: body
            },
            preferredSender
        );

        if (result.success) {
            setMessages(prev => [...prev, { role: 'model', text: `✅ ${result.message}` }]);
        } else {
            console.error(result.message);
            setMessages(prev => [...prev, { role: 'model', text: `❌ Failed to send email to ${recipientName}. ${result.message}` }]);
        }
    };


    const handleAiMessage = async (text: string, silent = false) => {
        if (!text.trim()) return;
        if (!silent) {
            setMessages(prev => [...prev, { role: 'user', text }]);
            setInput('');
        }
        setIsThinking(true);

        try {
            // Build rich context for the AI
            const context = {
                selectedOrder,
                matchingBookings: selectedOrder ? getMatchingBookings(selectedOrder) : [],
                matchingQuotes: selectedOrder ? getMatchingQuotes(selectedOrder) : [],
                allOrders: ordersToShip.length,
                cargoAgents: cargoAgents.map(a => ({ name: a.name, id: a.id })), // Pass agent names for lookup
                freightQuotes: freightQuotes // Pass quote data
            };

            const response = await getLogisticsAgentResponse(text, messages, context);

            // 1. Always show the text response
            setMessages(prev => [...prev, { role: 'model', text: response.text }]);

            // 2. Check for Tool Calls (e.g. send_email)
            if (response.toolCalls) {
                for (const toolCall of response.toolCalls) {
                    if (toolCall.name === 'send_email') {
                        const { recipientName, subject, body } = toolCall.args;
                        setMessages(prev => [...prev, { role: 'model', text: `📧 Initiating email dispatch to ${recipientName}...` }]);
                        await executeSendEmail(recipientName, subject, body);
                    }
                }
            }

        } catch (e) {
            console.error(e);
            setMessages(prev => [...prev, { role: 'model', text: "Connection error." }]);
        } finally {
            setIsThinking(false);
        }
    };

    // --- ACTIONS ---

    const handleLinkBooking = async (booking: Booking) => {
        if (!selectedOrder) return;

        if (confirm(`Link Booking ${booking.bookingNumber} to Order ${selectedOrder.orderNumber}?`)) {
            // 1. Link Booking to Sales Order
            const updatedBooking: Booking = {
                ...booking,
                salesOrderId: selectedOrder.id,
                status: 'ACTIVE',
                customer: selectedOrder.customerName
            };
            onUpdateBooking(updatedBooking);

            // UI Feedback
            setMessages(prev => [...prev, { role: 'model', text: `✅ Successfully linked Booking ${booking.bookingNumber} to Order ${selectedOrder.orderNumber}. Preparing notifications...` }]);
            setIsThinking(true);
            setSelectedOrder(null); // Close expansion

            try {
                // 2. Draft Email to Supplier
                const supplierDraft = await generateContextualEmail(
                    "Supplier",
                    "Booking Details & Shipping Instructions",
                    [
                        `Booking Reference: ${booking.bookingNumber}`,
                        `Vessel/Voyage: ${booking.vesselVoyage}`,
                        `ETD: ${booking.etd}`,
                        `Cut-off: ${booking.cargoCutOff || 'Standard'}`,
                        "Please proceed with container pickup and stuffing."
                    ],
                    "Professional"
                );

                // 3. Draft Email to Cargo Agent
                const agentDraft = await generateContextualEmail(
                    "Cargo Agent",
                    "Customer Nomination & Details",
                    [
                        `Booking: ${booking.bookingNumber}`,
                        `Customer: ${selectedOrder.customerName}`,
                        `Destination: ${selectedOrder.pod}`,
                        `Order Ref: ${selectedOrder.orderNumber}`,
                        "Please release equipment and issue Draft BL."
                    ],
                    "Professional"
                );

                // Display Drafts
                if (supplierDraft && agentDraft) {
                    setMessages(prev => [
                        ...prev,
                        {
                            role: 'model',
                            text: `I've prepared the email drafts for this shipment:\n\n` +
                                `**📤 To Supplier:**\n` +
                                `Subject: ${supplierDraft.subject}\n` +
                                `${supplierDraft.body}\n\n` +
                                `---\n\n` +
                                `**📤 To Cargo Agent:**\n` +
                                `Subject: ${agentDraft.subject}\n` +
                                `${agentDraft.body}`
                        }
                    ]);
                } else {
                    setMessages(prev => [...prev, { role: 'model', text: "Linked successfully, but failed to generate email drafts." }]);
                }
            } catch (err) {
                console.error("AI Error:", err);
                setMessages(prev => [...prev, { role: 'model', text: "Linked successfully. AI service unavailable for email drafting." }]);
            } finally {
                setIsThinking(false);
            }
        }
    };

    const handleRequestNewBooking = async (quote: FreightQuote) => {
        if (!selectedOrder) return;

        const confirmMsg = `Request booking with ${quote.agentName}?\nRate: $${quote.rate}\nRoute: ${quote.originPortCode} -> ${quote.destinationPortCode}\n\nThis will send an email to the agent.`;
        if (confirm(confirmMsg)) {
            const newBookingId = `BK${Date.now()}`;
            const newBooking: Booking = {
                id: newBookingId,
                companyId: selectedOrder.companyId,
                createdAt: new Date().toISOString(),
                bookingNumber: `REQ-${newBookingId.slice(-6)}`,
                customer: selectedOrder.customerName,
                vesselVoyage: 'TBD',
                pol: quote.originPort || 'TBD',
                pod: quote.destinationPort || selectedOrder.pod || 'TBD',
                equipment: '40HC', // Defaulting, in real app would ask
                etd: new Date().toISOString().split('T')[0],
                eta: 'TBD',
                salesOrderId: selectedOrder.id,
                status: 'REQUESTED'
            };

            // 1. Add Booking to DB
            onAddBooking(newBooking);
            setMessages(prev => [...prev, { role: 'model', text: `✅ Booking Request record created. Status: REQUESTED.` }]);
            setSelectedOrder(null);

            // 2. Send Email
            const agentName = quote.agentName;

            // Find Agent Email (using cargoAgents prop)
            // Note: quote objects might only have agentName, so we look up full agent details
            const agentInfo = cargoAgents.find(a => a.name.toLowerCase() === agentName.toLowerCase()) || { email: '', contact: 'Partner' };

            if (!agentInfo.email) {
                setMessages(prev => [...prev, { role: 'model', text: `⚠️ Could not find email for agent '${agentName}'. Please email them manually.` }]);
                return;
            }

            const subject = `Booking Request - ${selectedOrder.orderNumber} - ${selectedOrder.pod}`;
            const body = `
                <div style="font-family: sans-serif;">
                    <p>Dear ${agentInfo.contact || agentName},</p>
                    <p>Please accept this booking request based on your quote <strong>Ref #${quote.id.slice(0, 8)}</strong>.</p>
                    
                    <div style="background-color: #f0f9ff; padding: 15px; border-radius: 8px; border: 1px solid #bae6fd; margin: 15px 0;">
                        <h3 style="margin-top:0; color: #0369a1;">Booking Details</h3>
                        <p><strong>Order Ref:</strong> ${selectedOrder.orderNumber}</p>
                        <p><strong>Customer:</strong> ${selectedOrder.customerName}</p>
                        <p><strong>Origin:</strong> ${quote.originPort || 'POA'}</p>
                        <p><strong>Destination:</strong> ${selectedOrder.pod}</p>
                        <p><strong>Equipment:</strong> 1 x 40'HC</p>
                        <p><strong>Agreed Rate:</strong> $${quote.rate.toLocaleString()}</p>
                        <p><strong>Ready Date:</strong> ${selectedOrder.deliveryDate || 'Ready Now'}</p>
                    </div>

                    <p>Please confirm booking and provide SO/Release Order.</p>
                    <p>Best regards,<br/>Logistics Team</p>
                </div>
            `;

            setMessages(prev => [...prev, { role: 'model', text: `📧 Initiating email dispatch to ${agentName} (${agentInfo.email})...` }]);
            await executeSendEmail(agentName, subject, body);
        }
    };

    const handleRequestFreightQuote = async () => {
        if (!selectedOrder || !cargoAgents || cargoAgents.length === 0) {
            alert("No cargo agents found in the database to send requests to.");
            return;
        }

        // Determine Context Company
        let contextCompanyId = currentCompanyId;
        if (contextCompanyId === 'ALL') {
            // Fallback to selected order if present
            if (selectedOrder && selectedOrder.companyId) {
                contextCompanyId = selectedOrder.companyId;
            }
        }

        // Identify Company Details
        const company = availableCompanies.find(c => c.id === contextCompanyId);
        const companyName = company?.name.toUpperCase() || '';

        // Default Settings
        let preferredSender = 'ai.agent@xsolution.com';
        let ccList: string[] = ['felipe@xsolution.com'];

        // Logic Rule: EC4 ENTERPRISES
        if (companyName.includes('EC4 ENTERPRISES')) {
            preferredSender = 'ai.agent@ec4.enterprises';
            ccList = ['felipe@xsolution.com'];
        }
        // Logic Rule: XSOLUTION (Explicit or Default)
        else if (companyName.includes('XSOLUTION')) {
            preferredSender = 'ai.agent@xsolution.com';
            ccList = ['felipe@xsolution.com'];
        }

        const soNumber = selectedOrder.orderNumber;
        const pod = selectedOrder.pod || 'POD';
        const poa = 'POA'; // Usually from order, simplifed here

        const newDrafts = [];

        for (const agent of cargoAgents) {
            if (agent.email) {
                const subject = `Freight Quote Request for SO #${soNumber}`;
                // Determine correct origin label based on order data
                const originLabel = selectedOrder?.pickupLocation
                    ? `Pick Up: ${selectedOrder.pickupLocation}`
                    : `Port of Loading (POA): ${selectedOrder?.poa || poa}`;

                const htmlBody = `
                    <div style="font-family: sans-serif;">
                        <p>Dear ${agent.contact || agent.name},</p>
                        <p>Please provide a freight quote for the following shipment:</p>
                        <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 15px 0;">
                            <p style="margin: 5px 0;"><strong>Sales Order Ref:</strong> ${soNumber}</p>
                            <p style="margin: 5px 0;"><strong>${originLabel.split(':')[0]}:</strong> ${originLabel.split(':')[1]}</p>
                            <p style="margin: 5px 0;"><strong>Port of Discharge (POD):</strong> ${pod}</p>
                        </div>
                        <p>Please submit your best rate and transit time at your earliest convenience.</p>
                        <p>Thank you,<br/>${company?.name || 'XSolution AI Agent'}</p>
                    </div>
                `;

                newDrafts.push({
                    agentId: agent.id,
                    agentName: agent.name,
                    to: agent.email,
                    subject: subject,
                    htmlBody: htmlBody,
                    preferredSender,
                    ccList
                });
            }
        }

        if (newDrafts.length > 0) {
            setPendingEmailDrafts(newDrafts);
            setShowEmailPreviewModal(true);
        } else {
            alert("No valid email addresses found for cargo agents.");
        }
    };

    const createBookingPDFDoc = (booking: Booking): jsPDF => {
        const doc = new jsPDF();

        // Header
        doc.setFillColor(30, 64, 175); // Blue
        doc.rect(0, 0, 210, 40, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(24);
        doc.setFont('helvetica', 'bold');
        doc.text("BOOKING CONFIRMATION", 105, 25, { align: 'center' });

        // Booking Info
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');

        let y = 50;
        const addLine = (label: string, value: string) => {
            doc.setFont('helvetica', 'bold');
            doc.text(`${label}:`, 20, y);
            doc.setFont('helvetica', 'normal');
            doc.text(value || '-', 80, y);
            y += 10;
        };

        addLine("Booking Number", booking.bookingNumber);
        addLine("Customer", booking.customer);
        addLine("Port of Request (POL)", booking.pol);
        addLine("Port of Discharge (POD)", booking.pod);
        if (booking.etd) addLine("Est. Departure (ETD)", formatDate(booking.etd));
        if (booking.eta) addLine("Est. Arrival (ETA)", formatDate(booking.eta));
        if (booking.carrier) addLine("Carrier", booking.carrier);
        if (booking.containerNumber) addLine("Container No.", booking.containerNumber);
        if (booking.blNumber) addLine("BL Reference", booking.blNumber);

        // Footer
        doc.setDrawColor(200, 200, 200);
        doc.line(20, 250, 190, 250);
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text("Generated by XSolution AI Logistics", 105, 260, { align: 'center' });

        return doc;
    };

    const createBLPDFDoc = (bl: BillOfLading): jsPDF => {
        const doc = new jsPDF();

        // Header
        doc.setFillColor(30, 64, 175); // Blue
        doc.rect(0, 0, 210, 40, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(24);
        doc.setFont('helvetica', 'bold');
        doc.text("BILL OF LADING", 105, 25, { align: 'center' });

        // BL Info
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');

        let y = 50;
        const addLine = (label: string, value: string) => {
            doc.setFont('helvetica', 'bold');
            doc.text(`${label}:`, 20, y);
            doc.setFont('helvetica', 'normal');
            doc.text(value || '-', 80, y);
            y += 10;
        };

        addLine("BL Number", bl.blNumber);
        addLine("Consignee", bl.consignee);
        addLine("Shipper", bl.shipper);
        addLine("Vessel / Voyage", bl.vesselVoyage);
        addLine("Port of Loading", bl.portLoading);
        addLine("Port of Discharge", bl.portDischarge);
        addLine("Shipped Date", formatDate(bl.shippedDate));
        if (bl.container) addLine("Container", bl.container);
        if (bl.description) addLine("Description", bl.description);
        if (bl.grossWeight) addLine("Gross Weight", bl.grossWeight);

        // Footer
        doc.setDrawColor(200, 200, 200);
        doc.line(20, 250, 190, 250);
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text("Generated by XSolution AI Logistics", 105, 260, { align: 'center' });

        return doc;
    };

    const handleViewBooking = (booking: Booking) => {
        if (booking.originalDocument) {
            setPdfPreviewUrl(booking.originalDocument);
        } else {
            const doc = createBookingPDFDoc(booking);
            setPdfPreviewUrl(doc.output('bloburl'));
        }
        setPdfPreviewTitle(`Booking: ${booking.bookingNumber}`);
        setShowPdfPreviewModal(true);
    };

    const handleViewBL = (bl: BillOfLading) => {
        if (bl.originalDocument) {
            setPdfPreviewUrl(bl.originalDocument);
        } else {
            const doc = createBLPDFDoc(bl);
            setPdfPreviewUrl(doc.output('bloburl'));
        }
        setPdfPreviewTitle(`Bill of Lading: ${bl.blNumber}`);
        setShowPdfPreviewModal(true);
    };

    const handleUpdateSchedule = async (record: BillOfLading | Booking) => {
        const isBL = 'blNumber' in record && !('bookingNumber' in record); // strict check for BL vs Booking (Booking has bookingNumber)
        // Actually Booking has 'blNumber' too as reference. 
        // BillOfLading has 'blNumber' as primary.
        // Let's check for 'bookingNumber' to identify Booking.
        const isBooking = 'bookingNumber' in record;

        const refNumber = isBooking ? (record as Booking).bookingNumber : (record as BillOfLading).blNumber;
        const container = isBooking ? (record as Booking).containerNumber : (record as BillOfLading).container;
        const voyage = record.vesselVoyage;

        // 1. User Feedback: "AI Agent Active"
        setMessages(prev => [...prev, {
            role: 'model',
            text: `🚢 Researching vessel schedule for **${voyage}** (Ref: ${refNumber}, Container: ${container || 'N/A'}). Checking official shipping lines and port data...`
        }]);

        // 2. Simulate AI Processing Delay (Search & Analysis)
        await new Promise(resolve => setTimeout(resolve, 3000));

        // 3. Determine Outcome (Mock Logic)
        const currentEtaStr = isBooking ? (record as Booking).eta : (record as BillOfLading).placeDelivery;
        const currentEta = new Date(currentEtaStr || new Date().toISOString());

        const newEtaDate = new Date();
        newEtaDate.setDate(newEtaDate.getDate() + 14); // Mock: ETA is 2 weeks from now
        const newEtaString = newEtaDate.toISOString().split('T')[0];

        const isDelay = Math.random() > 0.5; // Randomly find a delay

        if (isDelay) {
            setMessages(prev => [...prev, {
                role: 'model',
                text: `⚠️ **Schedule Update Found** for ${refNumber}: The vessel is delayed due to congestion at transshipment port. \n\n**New ETA:** ${newEtaString} (Previously: ${formatDate(currentEtaStr || '')})\n\nI have updated the record.`
            }]);
        } else {
            setMessages(prev => [...prev, {
                role: 'model',
                text: `✅ **Schedule Confirmed** for ${refNumber}: The vessel is on track. Current ETA (${formatDate(currentEtaStr || '')}) is accurate based on latest satellite data.`
            }]);
            return; // No update needed
        }

        // 4. Update Record
        if (isBooking) {
            const updatedBooking = {
                ...(record as Booking),
                eta: newEtaString
            };
            await onUpdateBooking(updatedBooking);
        } else {
            const updatedBL = {
                ...(record as BillOfLading),
                placeDelivery: newEtaString,
                remarks: `${(record as BillOfLading).remarks || ''}\n[AI Update ${new Date().toLocaleDateString()}] ETA Revised to ${newEtaString}`
            };
            await onUpdateBillOfLading(updatedBL);
        }
    };

    const handleEmailPreview = async (
        agentId: string,
        agentName: string,
        recipientEmails: string,
        subject: string,
        htmlBody: string,
        attachmentBooking?: Booking,
        attachmentBL?: BillOfLading
    ) => {
        const attachments: { name: string; contentBytes: string; contentType: string }[] = [];

        try {
            if (attachmentBooking) {
                // If original doc exists (and is accessible - though for email attachment we need bytes, so URL might be tricky if not public/CORS)
                // For now, always generate fresh PDF for consistency unless we fetch the blob. 
                // Given constraints, generating fresh is safer for now.
                const doc = createBookingPDFDoc(attachmentBooking);
                const pdfBase64 = doc.output('datauristring').split(',')[1];
                attachments.push({
                    name: `Booking_${attachmentBooking.bookingNumber}.pdf`,
                    contentBytes: pdfBase64,
                    contentType: 'application/pdf'
                });
            } else if (attachmentBL) {
                const doc = createBLPDFDoc(attachmentBL);
                const pdfBase64 = doc.output('datauristring').split(',')[1];
                attachments.push({
                    name: `BL_${attachmentBL.blNumber}.pdf`,
                    contentBytes: pdfBase64,
                    contentType: 'application/pdf'
                });
            }
        } catch (e) {
            console.error("Failed to generate PDF", e);
        }

        // Email Lookup Logic
        let finalTo = recipientEmails;
        // If recipient doesn't look like an email, try to find it in Customers list
        if (!finalTo.includes('@') && customers.length > 0) {
            const matchedCustomer = customers.find(c => c.name.toLowerCase().includes(agentName.toLowerCase()));
            if (matchedCustomer && matchedCustomer.email) {
                finalTo = matchedCustomer.email;
            } else {
                // Fallback or Alert? For now, leave as is, user can edit in modal if needed? 
                // Actually the email modal doesn't allow editing "To" field easily in the current UI 
                // (it shows it as a badge). 
                // Let's force a prompt or better, just default to a placeholder if not found.
                if (!finalTo) finalTo = "email@example.com";
            }
        }

        setPendingEmailDrafts([{
            agentId,
            agentName,
            to: finalTo,
            subject,
            htmlBody,
            preferredSender: 'ai.agent@xsolution.com',
            ccList: [],
            attachments
        }]);
        setShowEmailPreviewModal(true);
    };

    const handleConfirmSendEmails = async () => {
        setSendingEmails(true);
        let sentCount = 0;
        const total = pendingEmailDrafts.length;

        for (const draft of pendingEmailDrafts) {
            const result = await sendEmail(
                {
                    to: [draft.to],
                    cc: draft.ccList,
                    subject: draft.subject,
                    htmlBody: draft.htmlBody,
                    attachments: draft.attachments
                },
                draft.preferredSender
            );

            if (result.success) {
                sentCount++;
            } else {
                console.error(`Failed to email ${draft.agentName}:`, result.message);
            }
        }

        setSendingEmails(false);
        setShowEmailPreviewModal(false);
        setPendingEmailDrafts([]);
        setMessages(prev => [...prev, { role: 'model', text: `✅ Successfully dispatched ${sentCount}/${total} Quote Requests.` }]);

    };

    return (
        <div className="flex h-screen bg-slate-50 overflow-hidden">
            {/* LEFT: PENDING ORDERS - REMOVED */}

            {/* MAIN CONTENT AREA */}
            <div className="flex-1 flex flex-row h-full overflow-hidden min-w-0 relative">

                {/* TOP: ACTIVE LOGISTICS WORKSPACE */}
                <div className="flex-1 p-4 overflow-hidden flex flex-col gap-4">
                    {/* Header */}
                    {/* Header Removed - Moved inside Card */}

                    {/* ACTIVE LOGISTICS TABLE */}
                    <div className="flex-1 flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                        <div className={`p-4 border-b border-slate-100 ${resumeTab === 'COMPARE' ? 'bg-gradient-to-r from-purple-50 to-indigo-50' : 'bg-slate-50'} flex justify-between items-center shrink-0`}>
                            <div className="flex items-center gap-3">
                                <div className={`p-2 bg-white rounded-lg border ${resumeTab === 'COMPARE' ? 'border-purple-200' : 'border-slate-200'} shadow-sm`}>
                                    {resumeTab === 'COMPARE' ? <Scale className="text-purple-600" size={24} /> : <ClipboardList className="text-teal-600" size={24} />}
                                </div>
                                <h1 className={`text-2xl font-bold ${resumeTab === 'COMPARE' ? 'text-purple-800' : 'text-slate-800'}`}>
                                    {resumeTab === 'COMPARE' ? 'COMPARE QUOTES' : 'SHIPMENTS STATUS'}
                                </h1>
                                {resumeTab === 'COMPARE' && (
                                    <span className="text-xs text-purple-600 bg-purple-100 px-2 py-1 rounded-full font-medium">
                                        {freightQuotes.filter(q => q.status === 'ACTIVE').length} active quotes
                                    </span>
                                )}
                            </div>
                            <div className="flex gap-4 items-center">
                                {resumeTab !== 'COMPARE' && (
                                    <div className="relative">
                                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                                        <input
                                            className="w-48 pl-7 pr-3 py-1 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 outline-none"
                                            placeholder="Global Search..."
                                            value={logisticsSearch}
                                            onChange={e => setLogisticsSearch(e.target.value)}
                                        />
                                    </div>
                                )}
                                <button onClick={() => setResumeTab('SALES_ORDERS')} className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${resumeTab === 'SALES_ORDERS' ? 'bg-orange-50 text-orange-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Follow Up</button>
                                <button onClick={() => setResumeTab('BOOKINGS')} className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${resumeTab === 'BOOKINGS' ? 'bg-teal-50 text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Bookings</button>
                                <button onClick={() => setResumeTab('BL')} className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${resumeTab === 'BL' ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Bill of Ladings</button>
                                <button onClick={() => setResumeTab('COMPARE')} className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${resumeTab === 'COMPARE' ? 'bg-purple-100 text-purple-700 shadow-sm ring-1 ring-purple-200' : 'text-slate-500 hover:text-slate-700'}`}>Compare</button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto custom-scrollbar p-0">
                            {resumeTab === 'COMPARE' ? (
                                /* COMPARE VIEW - Compact Spreadsheet Layout */
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-slate-50 text-slate-500 font-bold uppercase sticky top-0 z-10 border-b border-slate-200 shadow-sm">
                                        <tr>
                                            {/* SERVICE */}
                                            <th className="p-2 border-b min-w-[50px] w-[70px] relative group">
                                                <div className="flex items-center gap-1">
                                                    <div className="flex items-center gap-1 cursor-pointer hover:bg-slate-100 px-1 rounded" onClick={() => handleSort('freightType')}>
                                                        <span>Service</span>
                                                        <div className="flex flex-col ml-1">{sortConfig?.key === 'freightType' ? (sortConfig.direction === 'asc' ? <ArrowUp size={10} className="text-blue-600" /> : <ArrowDown size={10} className="text-blue-600" />) : <><ArrowUp size={7} className="text-slate-300" /><ArrowDown size={7} className="text-slate-300 -mt-1" /></>}</div>
                                                    </div>
                                                    <div className="cursor-pointer p-0.5 hover:bg-slate-100 rounded text-slate-400" onClick={() => setActiveFilterColumn(activeFilterColumn === 'cmpService' ? null : 'cmpService')}>
                                                        <Filter size={10} className={filters['cmpService'] ? 'text-blue-600' : ''} />
                                                    </div>
                                                </div>
                                                {activeFilterColumn === 'cmpService' && (
                                                    <div className="absolute top-full left-0 mt-1 w-40 bg-white rounded-lg shadow-xl border border-slate-200 z-50 p-2">
                                                        <input autoFocus className="w-full text-xs p-1.5 border border-slate-200 rounded" placeholder="Filter service..." value={filters['cmpService'] || ''} onChange={e => setFilters(p => ({ ...p, cmpService: e.target.value }))} />
                                                        <button onClick={() => setActiveFilterColumn(null)} className="text-[9px] text-blue-600 hover:underline mt-1">Close</button>
                                                    </div>
                                                )}
                                            </th>
                                            {/* PICK UP */}
                                            <th className="p-2 border-b min-w-[60px] w-[80px] relative group">
                                                <div className="flex items-center gap-1">
                                                    <div className="flex items-center gap-1 cursor-pointer hover:bg-slate-100 px-1 rounded" onClick={() => handleSort('pickupLocation')}>
                                                        <span>Pick Up</span>
                                                        <div className="flex flex-col ml-1">{sortConfig?.key === 'pickupLocation' ? (sortConfig.direction === 'asc' ? <ArrowUp size={10} className="text-blue-600" /> : <ArrowDown size={10} className="text-blue-600" />) : <><ArrowUp size={7} className="text-slate-300" /><ArrowDown size={7} className="text-slate-300 -mt-1" /></>}</div>
                                                    </div>
                                                    <div className="cursor-pointer p-0.5 hover:bg-slate-100 rounded text-slate-400" onClick={() => setActiveFilterColumn(activeFilterColumn === 'cmpPickup' ? null : 'cmpPickup')}>
                                                        <Filter size={10} className={filters['cmpPickup'] ? 'text-blue-600' : ''} />
                                                    </div>
                                                </div>
                                                {activeFilterColumn === 'cmpPickup' && (
                                                    <div className="absolute top-full left-0 mt-1 w-40 bg-white rounded-lg shadow-xl border border-slate-200 z-50 p-2">
                                                        <input autoFocus className="w-full text-xs p-1.5 border border-slate-200 rounded" placeholder="Filter pickup..." value={filters['cmpPickup'] || ''} onChange={e => setFilters(p => ({ ...p, cmpPickup: e.target.value }))} />
                                                        <button onClick={() => setActiveFilterColumn(null)} className="text-[9px] text-blue-600 hover:underline mt-1">Close</button>
                                                    </div>
                                                )}
                                            </th>
                                            {/* POL */}
                                            <th className="p-2 border-b min-w-[70px] w-[100px] relative group">
                                                <div className="flex items-center gap-1">
                                                    <div className="flex items-center gap-1 cursor-pointer hover:bg-slate-100 px-1 rounded" onClick={() => handleSort('originPort')}>
                                                        <span>POL</span>
                                                        <div className="flex flex-col ml-1">{sortConfig?.key === 'originPort' ? (sortConfig.direction === 'asc' ? <ArrowUp size={10} className="text-blue-600" /> : <ArrowDown size={10} className="text-blue-600" />) : <><ArrowUp size={7} className="text-slate-300" /><ArrowDown size={7} className="text-slate-300 -mt-1" /></>}</div>
                                                    </div>
                                                    <div className="cursor-pointer p-0.5 hover:bg-slate-100 rounded text-slate-400" onClick={() => setActiveFilterColumn(activeFilterColumn === 'cmpOrigin' ? null : 'cmpOrigin')}>
                                                        <Filter size={10} className={filters['cmpOrigin'] ? 'text-blue-600' : ''} />
                                                    </div>
                                                </div>
                                                {activeFilterColumn === 'cmpOrigin' && (
                                                    <div className="absolute top-full left-0 mt-1 w-40 bg-white rounded-lg shadow-xl border border-slate-200 z-50 p-2">
                                                        <input autoFocus className="w-full text-xs p-1.5 border border-slate-200 rounded" placeholder="Filter POL..." value={filters['cmpOrigin'] || ''} onChange={e => setFilters(p => ({ ...p, cmpOrigin: e.target.value }))} />
                                                        <button onClick={() => setActiveFilterColumn(null)} className="text-[9px] text-blue-600 hover:underline mt-1">Close</button>
                                                    </div>
                                                )}
                                            </th>
                                            {/* POD */}
                                            <th className="p-2 border-b min-w-[70px] w-[100px] relative group">
                                                <div className="flex items-center gap-1">
                                                    <div className="flex items-center gap-1 cursor-pointer hover:bg-slate-100 px-1 rounded" onClick={() => handleSort('destinationPort')}>
                                                        <span>POD</span>
                                                        <div className="flex flex-col ml-1">{sortConfig?.key === 'destinationPort' ? (sortConfig.direction === 'asc' ? <ArrowUp size={10} className="text-blue-600" /> : <ArrowDown size={10} className="text-blue-600" />) : <><ArrowUp size={7} className="text-slate-300" /><ArrowDown size={7} className="text-slate-300 -mt-1" /></>}</div>
                                                    </div>
                                                    <div className="cursor-pointer p-0.5 hover:bg-slate-100 rounded text-slate-400" onClick={() => setActiveFilterColumn(activeFilterColumn === 'cmpDest' ? null : 'cmpDest')}>
                                                        <Filter size={10} className={filters['cmpDest'] ? 'text-blue-600' : ''} />
                                                    </div>
                                                </div>
                                                {activeFilterColumn === 'cmpDest' && (
                                                    <div className="absolute top-full left-0 mt-1 w-40 bg-white rounded-lg shadow-xl border border-slate-200 z-50 p-2">
                                                        <input autoFocus className="w-full text-xs p-1.5 border border-slate-200 rounded" placeholder="Filter POD..." value={filters['cmpDest'] || ''} onChange={e => setFilters(p => ({ ...p, cmpDest: e.target.value }))} />
                                                        <button onClick={() => setActiveFilterColumn(null)} className="text-[9px] text-blue-600 hover:underline mt-1">Close</button>
                                                    </div>
                                                )}
                                            </th>
                                            {/* AGENT */}
                                            <th className="p-2 border-b min-w-[100px] relative group">
                                                <div className="flex items-center gap-1">
                                                    <div className="flex items-center gap-1 cursor-pointer hover:bg-slate-100 px-1 rounded" onClick={() => handleSort('agentName')}>
                                                        <span>Agent</span>
                                                        <div className="flex flex-col ml-1">{sortConfig?.key === 'agentName' ? (sortConfig.direction === 'asc' ? <ArrowUp size={10} className="text-blue-600" /> : <ArrowDown size={10} className="text-blue-600" />) : <><ArrowUp size={7} className="text-slate-300" /><ArrowDown size={7} className="text-slate-300 -mt-1" /></>}</div>
                                                    </div>
                                                    <div className="cursor-pointer p-0.5 hover:bg-slate-100 rounded text-slate-400" onClick={() => setActiveFilterColumn(activeFilterColumn === 'cmpAgent' ? null : 'cmpAgent')}>
                                                        <Filter size={10} className={filters['cmpAgent'] ? 'text-blue-600' : ''} />
                                                    </div>
                                                </div>
                                                {activeFilterColumn === 'cmpAgent' && (
                                                    <div className="absolute top-full left-0 mt-1 w-40 bg-white rounded-lg shadow-xl border border-slate-200 z-50 p-2">
                                                        <input autoFocus className="w-full text-xs p-1.5 border border-slate-200 rounded" placeholder="Filter agent..." value={filters['cmpAgent'] || ''} onChange={e => setFilters(p => ({ ...p, cmpAgent: e.target.value }))} />
                                                        <button onClick={() => setActiveFilterColumn(null)} className="text-[9px] text-blue-600 hover:underline mt-1">Close</button>
                                                    </div>
                                                )}
                                            </th>
                                            {/* RATE */}
                                            <th className="p-2 border-b w-[80px] cursor-pointer hover:bg-slate-100" onClick={() => handleSort('rate')}>
                                                <div className="flex items-center justify-end gap-1">
                                                    <span>Rate</span>
                                                    <div className="flex flex-col ml-1">{sortConfig?.key === 'rate' ? (sortConfig.direction === 'asc' ? <ArrowUp size={10} className="text-blue-600" /> : <ArrowDown size={10} className="text-blue-600" />) : <><ArrowUp size={7} className="text-slate-300" /><ArrowDown size={7} className="text-slate-300 -mt-1" /></>}</div>
                                                </div>
                                            </th>
                                            {/* TT */}
                                            <th className="p-2 border-b w-[50px] text-center cursor-pointer hover:bg-slate-100" onClick={() => handleSort('transitTime')}>
                                                <div className="flex items-center justify-center gap-1">
                                                    <span>TT</span>
                                                    <div className="flex flex-col">{sortConfig?.key === 'transitTime' ? (sortConfig.direction === 'asc' ? <ArrowUp size={10} className="text-blue-600" /> : <ArrowDown size={10} className="text-blue-600" />) : <><ArrowUp size={7} className="text-slate-300" /><ArrowDown size={7} className="text-slate-300 -mt-1" /></>}</div>
                                                </div>
                                            </th>
                                            {/* FT */}
                                            <th className="p-2 border-b w-[50px] text-center cursor-pointer hover:bg-slate-100" onClick={() => handleSort('freeTime')}>
                                                <div className="flex items-center justify-center gap-1">
                                                    <span>FT</span>
                                                    <div className="flex flex-col">{sortConfig?.key === 'freeTime' ? (sortConfig.direction === 'asc' ? <ArrowUp size={10} className="text-blue-600" /> : <ArrowDown size={10} className="text-blue-600" />) : <><ArrowUp size={7} className="text-slate-300" /><ArrowDown size={7} className="text-slate-300 -mt-1" /></>}</div>
                                                </div>
                                            </th>
                                            {/* VALID */}
                                            <th className="p-2 border-b w-[70px] text-right cursor-pointer hover:bg-slate-100" onClick={() => handleSort('validUntil')}>
                                                <div className="flex items-center justify-end gap-1">
                                                    <span>Valid</span>
                                                    <div className="flex flex-col">{sortConfig?.key === 'validUntil' ? (sortConfig.direction === 'asc' ? <ArrowUp size={10} className="text-blue-600" /> : <ArrowDown size={10} className="text-blue-600" />) : <><ArrowUp size={7} className="text-slate-300" /><ArrowDown size={7} className="text-slate-300 -mt-1" /></>}</div>
                                                </div>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {(() => {
                                            // Filter and sort ACTIVE quotes only
                                            let data = freightQuotes.filter(q => q.status === 'ACTIVE').map(q => ({
                                                ...q,
                                                agentName: (q as any).agentName || (q as any).agent_name || '',
                                                freightType: (q as any).freightType || (q as any).freight_type || '',
                                                pickupLocation: (q as any).pickupLocation || (q as any).pickup_location || '',
                                                originPort: (q as any).originPort || '',
                                                originPortCode: (q as any).originPortCode || (q as any).origin_port_code || '',
                                                destinationPort: (q as any).destinationPort || '',
                                                destinationPortCode: (q as any).destinationPortCode || (q as any).destination_port_code || '',
                                                transitTime: (q as any).transitTime || (q as any).transit_time || 0,
                                                freeTime: (q as any).freeTime || (q as any).free_time || 0,
                                                validUntil: (q as any).validUntil || (q as any).valid_until || ''
                                            }));

                                            // Apply filters
                                            if (filters['cmpAgent']) data = data.filter(q => q.agentName.toLowerCase().includes(filters['cmpAgent'].toLowerCase()));
                                            if (filters['cmpService']) data = data.filter(q => q.freightType.toLowerCase().includes(filters['cmpService'].toLowerCase()));
                                            if (filters['cmpPickup']) data = data.filter(q => q.pickupLocation.toLowerCase().includes(filters['cmpPickup'].toLowerCase()));
                                            if (filters['cmpOrigin']) data = data.filter(q => (q.originPort + q.originPortCode).toLowerCase().includes(filters['cmpOrigin'].toLowerCase()));
                                            if (filters['cmpDest']) data = data.filter(q => (q.destinationPort + q.destinationPortCode).toLowerCase().includes(filters['cmpDest'].toLowerCase()));

                                            // Group by PICKUP + POL + POD for comparison
                                            const getRouteKey = (q: any) => `${q.pickupLocation}|${q.originPortCode}|${q.destinationPortCode}`;

                                            // Sort by route group first, then by rate
                                            data.sort((a, b) => {
                                                const keyA = getRouteKey(a);
                                                const keyB = getRouteKey(b);
                                                if (keyA !== keyB) return keyA.localeCompare(keyB);
                                                // Within same route, sort by rate ascending
                                                return (a.rate || 0) - (b.rate || 0);
                                            });

                                            // Apply user sorting if specified (overrides default)
                                            if (sortConfig) {
                                                data.sort((a, b) => {
                                                    let aVal: any = a[sortConfig.key as keyof typeof a] || '';
                                                    let bVal: any = b[sortConfig.key as keyof typeof b] || '';
                                                    if (typeof aVal === 'number' && typeof bVal === 'number') {
                                                        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
                                                    }
                                                    if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                                                    if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                                                    return 0;
                                                });
                                            }

                                            // Find lowest rate per route (PICKUP + POL + POD)
                                            const lowestByRoute: Record<string, number> = {};
                                            data.forEach(q => {
                                                const routeKey = getRouteKey(q);
                                                if (!lowestByRoute[routeKey] || (q.rate || 0) < lowestByRoute[routeKey]) {
                                                    lowestByRoute[routeKey] = q.rate || 0;
                                                }
                                            });

                                            if (data.length === 0) {
                                                return <tr><td colSpan={9} className="p-4 text-center text-slate-400">No active quotes match your filters.</td></tr>;
                                            }

                                            // Track route groups for visual separation
                                            let lastRouteKey = '';
                                            let groupIndex = 0;

                                            return data.map((q, idx) => {
                                                const routeKey = getRouteKey(q);
                                                const isLowest = (q.rate || 0) === lowestByRoute[routeKey] && lowestByRoute[routeKey] > 0;
                                                const isNewGroup = routeKey !== lastRouteKey;
                                                if (isNewGroup) {
                                                    groupIndex++;
                                                    lastRouteKey = routeKey;
                                                }
                                                const groupBg = groupIndex % 2 === 0 ? '' : 'bg-slate-50/50';

                                                return (
                                                    <tr key={q.id} className={`hover:bg-blue-50/50 transition-colors text-[11px] ${isLowest ? 'bg-emerald-50/60' : groupBg} ${isNewGroup && idx > 0 ? 'border-t-2 border-purple-200' : ''}`}>
                                                        <td className="px-2 py-1 text-slate-600 whitespace-nowrap">{(q.freightType || '-').replace(/_/g, ' ')}</td>
                                                        <td className="px-2 py-1 text-slate-600 whitespace-nowrap">{q.pickupLocation || '-'}</td>
                                                        <td className="px-2 py-1 font-mono text-blue-600 font-semibold whitespace-nowrap">{q.originPortCode || '-'}</td>
                                                        <td className="px-2 py-1 font-mono text-emerald-600 font-semibold whitespace-nowrap">{q.destinationPortCode || '-'}</td>
                                                        <td className="px-2 py-1 font-medium text-slate-800 whitespace-nowrap">{q.agentName || '-'}</td>
                                                        <td className={`px-2 py-1 text-right font-mono font-bold whitespace-nowrap ${isLowest ? 'text-emerald-700' : 'text-slate-800'}`}>
                                                            ${(q.rate || 0).toLocaleString()}
                                                            {isLowest && <span className="ml-1 text-[7px] px-1 py-0.5 rounded bg-emerald-100 text-emerald-700">★</span>}
                                                        </td>
                                                        <td className="px-2 py-1 text-center text-slate-600 whitespace-nowrap">{q.transitTime || '-'}</td>
                                                        <td className="px-2 py-1 text-center text-slate-600 whitespace-nowrap">{q.freeTime || '-'}</td>
                                                        <td className="px-2 py-1 text-right text-slate-500 font-mono text-[10px] whitespace-nowrap">{formatDate(q.validUntil)}</td>
                                                    </tr>
                                                );
                                            });
                                        })()}
                                    </tbody>
                                </table>
                            ) : (
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-slate-50 text-slate-500 font-bold uppercase sticky top-0 z-10 border-b border-slate-200 shadow-sm">
                                        <tr>
                                            {resumeTab === 'SALES_ORDERS' ? (
                                                <>
                                                    <th className="p-3 border-b min-w-[120px] relative group">
                                                        <div className="flex items-center gap-2">
                                                            <div className="flex items-center gap-1 cursor-pointer hover:bg-slate-100 px-1 rounded" onClick={() => handleSort('invoiceNumber')}>
                                                                <span>Invoice #</span>
                                                                {sortConfig?.key === 'invoiceNumber' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                                                                {sortConfig?.key !== 'invoiceNumber' && <div className="flex flex-col"><ArrowUp size={8} className="text-slate-300" /><ArrowDown size={8} className="text-slate-300 -mt-1" /></div>}
                                                            </div>
                                                            <div className="cursor-pointer p-1 hover:bg-slate-100 rounded text-slate-400" onClick={() => setActiveFilterColumn('invoiceNumber')}>
                                                                <Filter size={12} className={activeFilterColumn === 'invoiceNumber' || filters['invoiceNumber'] ? 'text-blue-600' : ''} />
                                                            </div>
                                                        </div>
                                                        {renderFilterPopover('invoiceNumber', 'Search Inv #...')}
                                                    </th>
                                                    <th className="p-3 border-b min-w-[100px] cursor-pointer hover:bg-slate-100" onClick={() => handleSort('date')}>
                                                        Date
                                                    </th>
                                                    <th className="p-3 border-b min-w-[140px] relative group">
                                                        <div className="flex items-center gap-2">
                                                            <div className="flex items-center gap-1 cursor-pointer hover:bg-slate-100 px-1 rounded" onClick={() => handleSort('customer')}>
                                                                <span>Customer</span>
                                                                {sortConfig?.key === 'customer' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                                                                {sortConfig?.key !== 'customer' && <div className="flex flex-col"><ArrowUp size={8} className="text-slate-300" /><ArrowDown size={8} className="text-slate-300 -mt-1" /></div>}
                                                            </div>
                                                            <div className="cursor-pointer p-1 hover:bg-slate-100 rounded text-slate-400" onClick={() => setActiveFilterColumn('customer')}>
                                                                <Filter size={12} className={activeFilterColumn === 'customer' || filters['customer'] ? 'text-blue-600' : ''} />
                                                            </div>
                                                        </div>
                                                        {renderFilterPopover('customer', 'Search Customer...')}
                                                    </th>
                                                    <th className="p-3 border-b text-left">SO Number</th>
                                                    <th className="p-3 border-b text-left">PL Number</th>
                                                    <th className="p-3 border-b text-left">Booking #</th>
                                                    <th className="p-3 border-b text-left">Bill of Lading</th>
                                                    <th className="p-3 border-b text-right">Amount</th>
                                                    <th className="p-3 border-b text-center">Status</th>
                                                </>
                                            ) : (
                                                <>
                                                    <th className="p-3 border-b min-w-[140px] relative group">
                                                        <div className="flex items-center gap-2">
                                                            <div className="flex items-center gap-1 cursor-pointer hover:bg-slate-100 px-1 rounded" onClick={() => handleSort('bookingNumber')}>
                                                                <span>Number</span>
                                                                {sortConfig?.key === 'bookingNumber' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                                                                {sortConfig?.key !== 'bookingNumber' && <div className="flex flex-col"><ArrowUp size={8} className="text-slate-300" /><ArrowDown size={8} className="text-slate-300 -mt-1" /></div>}
                                                            </div>
                                                            <div className="cursor-pointer p-1 hover:bg-slate-100 rounded text-slate-400" onClick={() => setActiveFilterColumn('bookingNumber')}>
                                                                <Filter size={12} className={activeFilterColumn === 'bookingNumber' || filters['bookingNumber'] ? 'text-blue-600' : ''} />
                                                            </div>
                                                        </div>
                                                        {renderFilterPopover('bookingNumber', 'Search Number...')}
                                                    </th>
                                                    <th className="p-3 border-b min-w-[140px] relative group">
                                                        <div className="flex items-center gap-2">
                                                            <div className="flex items-center gap-1 cursor-pointer hover:bg-slate-100 px-1 rounded" onClick={() => handleSort('customer')}>
                                                                <span>Customer</span>
                                                                {sortConfig?.key === 'customer' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                                                                {sortConfig?.key !== 'customer' && <div className="flex flex-col"><ArrowUp size={8} className="text-slate-300" /><ArrowDown size={8} className="text-slate-300 -mt-1" /></div>}
                                                            </div>
                                                            <div className="cursor-pointer p-1 hover:bg-slate-100 rounded text-slate-400" onClick={() => setActiveFilterColumn('customer')}>
                                                                <Filter size={12} className={activeFilterColumn === 'customer' || filters['customer'] ? 'text-blue-600' : ''} />
                                                            </div>
                                                        </div>
                                                        {renderFilterPopover('customer', 'Search Customer...')}
                                                    </th>
                                                    <th className="p-3 border-b min-w-[120px] relative group">
                                                        <div className="flex items-center gap-2">
                                                            <div className="flex items-center gap-1 cursor-pointer hover:bg-slate-100 px-1 rounded" onClick={() => handleSort('status')}>
                                                                <span>Status</span>
                                                                {sortConfig?.key === 'status' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                                                                {sortConfig?.key !== 'status' && <div className="flex flex-col"><ArrowUp size={8} className="text-slate-300" /><ArrowDown size={8} className="text-slate-300 -mt-1" /></div>}
                                                            </div>
                                                            <div className="cursor-pointer p-1 hover:bg-slate-100 rounded text-slate-400" onClick={() => setActiveFilterColumn('status')}>
                                                                <Filter size={12} className={activeFilterColumn === 'status' || filters['status'] ? 'text-blue-600' : ''} />
                                                            </div>
                                                        </div>
                                                        {renderFilterPopover('status', 'Select Status', ['AVAILABLE', 'REQUESTED', 'ACTIVE', 'SHIPPED', 'CANCELLED'])}
                                                    </th>
                                                    <th className="p-3 border-b relative group">
                                                        <div className="flex items-center gap-2">
                                                            <div className="flex items-center gap-1 cursor-pointer hover:bg-slate-100 px-1 rounded" onClick={() => handleSort('pol')}>
                                                                <span>POA</span>
                                                                {sortConfig?.key === 'pol' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                                                                {sortConfig?.key !== 'pol' && <div className="flex flex-col"><ArrowUp size={8} className="text-slate-300" /><ArrowDown size={8} className="text-slate-300 -mt-1" /></div>}
                                                            </div>
                                                            <div className="cursor-pointer p-1 hover:bg-slate-100 rounded text-slate-400" onClick={() => setActiveFilterColumn('pol')}>
                                                                <Filter size={12} className={activeFilterColumn === 'pol' || filters['pol'] ? 'text-blue-600' : ''} />
                                                            </div>
                                                        </div>
                                                        {renderFilterPopover('pol', 'Search Port...')}
                                                    </th>
                                                    <th className="p-3 border-b relative group">
                                                        <div className="flex items-center gap-2">
                                                            <div className="flex items-center gap-1 cursor-pointer hover:bg-slate-100 px-1 rounded" onClick={() => handleSort('pod')}>
                                                                <span>POD</span>
                                                                {sortConfig?.key === 'pod' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                                                                {sortConfig?.key !== 'pod' && <div className="flex flex-col"><ArrowUp size={8} className="text-slate-300" /><ArrowDown size={8} className="text-slate-300 -mt-1" /></div>}
                                                            </div>
                                                            <div className="cursor-pointer p-1 hover:bg-slate-100 rounded text-slate-400" onClick={() => setActiveFilterColumn('pod')}>
                                                                <Filter size={12} className={activeFilterColumn === 'pod' || filters['pod'] ? 'text-blue-600' : ''} />
                                                            </div>
                                                        </div>
                                                        {renderFilterPopover('pod', 'Search Port...')}
                                                    </th>
                                                    <th className="p-3 border-b text-right min-w-[100px] relative group">
                                                        <div className="flex items-center justify-end gap-2">
                                                            <div className="flex items-center gap-1 cursor-pointer hover:bg-slate-100 px-1 rounded" onClick={() => handleSort('etd')}>
                                                                <span>ETD</span>
                                                                {sortConfig?.key === 'etd' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                                                                {sortConfig?.key !== 'etd' && <div className="flex flex-col"><ArrowUp size={8} className="text-slate-300" /><ArrowDown size={8} className="text-slate-300 -mt-1" /></div>}
                                                            </div>
                                                            <div className="cursor-pointer p-1 hover:bg-slate-100 rounded text-slate-400" onClick={() => setActiveFilterColumn('etd')}>
                                                                <Filter size={12} className={activeFilterColumn === 'etd' || filters['etd'] ? 'text-blue-600' : ''} />
                                                            </div>
                                                        </div>
                                                        {renderFilterPopover('etd', 'YYYY-MM-DD')}
                                                    </th>
                                                    <th className="p-3 border-b text-right min-w-[100px] relative group">
                                                        <div className="flex items-center justify-end gap-2">
                                                            <div className="flex items-center gap-1 cursor-pointer hover:bg-slate-100 px-1 rounded" onClick={() => handleSort('eta')}>
                                                                <span>ETA</span>
                                                                {sortConfig?.key === 'eta' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                                                                {sortConfig?.key !== 'eta' && <div className="flex flex-col"><ArrowUp size={8} className="text-slate-300" /><ArrowDown size={8} className="text-slate-300 -mt-1" /></div>}
                                                            </div>
                                                            <div className="cursor-pointer p-1 hover:bg-slate-100 rounded text-slate-400" onClick={() => setActiveFilterColumn('eta')}>
                                                                <Filter size={12} className={activeFilterColumn === 'eta' || filters['eta'] ? 'text-blue-600' : ''} />
                                                            </div>
                                                        </div>
                                                        {renderFilterPopover('eta', 'YYYY-MM-DD')}
                                                    </th>
                                                    <th className="p-3 border-b text-right w-[100px]">Actions</th>
                                                </>
                                            )}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {resumeTab === 'BOOKINGS' ? (
                                            filteredBookings.length === 0 ? <tr><td colSpan={8} className="p-6 text-center text-slate-400">No active bookings.</td></tr> :
                                                filteredBookings.map(b => (
                                                    <tr key={b.id} className="hover:bg-slate-50 group">
                                                        <td className="p-2.5 font-mono font-medium text-slate-700">{b.bookingNumber}</td>
                                                        <td className="p-2.5 text-slate-600 truncate max-w-[120px]" title={b.customer}>{getFirstWord(b.customer)}</td>
                                                        <td className="p-2.5">
                                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${b.status === 'AVAILABLE' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                                                                b.status === 'SHIPPED' ? 'bg-blue-50 text-blue-700 border-blue-100' :
                                                                    b.status === 'ACTIVE' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                                                                        'bg-slate-50 text-slate-600 border-slate-100'
                                                                }`}>
                                                                {b.status || 'N/A'}
                                                            </span>
                                                        </td>
                                                        <td className="p-2.5 text-slate-500">{getPortCode(b.pol)}</td>
                                                        <td className="p-2.5 text-slate-500">{getPortCode(b.pod)}</td>
                                                        <td className="p-2.5 text-right text-slate-600 font-mono text-xs">{formatDate(b.etd)}</td>
                                                        <td className="p-2.5 text-right text-slate-600 font-mono text-xs">{formatDate(b.eta)}</td>
                                                        <td className="p-2.5 text-right flex justify-end gap-1 opacity-100">
                                                            <button onClick={() => handleViewBooking(b)} className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-blue-600" title="View PDF">
                                                                <Eye size={14} />
                                                            </button>
                                                            <button onClick={() => handleUpdateSchedule(b)} className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-cyan-600" title="Update Schedule (AI)">
                                                                <Ship size={14} />
                                                            </button>
                                                            <button onClick={() => handleEditBooking(b)} className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-green-600" title="Edit">
                                                                <Edit size={14} />
                                                            </button>
                                                            <button onClick={() => handleEmailPreview(b.id, b.customer, b.customer, `Booking Update: ${b.bookingNumber}`, `<p>Please find attached the Booking Confirmation for <b>${b.bookingNumber}</b>.</p><p><b>Details:</b><br/>POL: ${b.pol}<br/>POD: ${b.pod}<br/>ETD: ${formatDate(b.etd)}</p>`, b)} className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-purple-600" title="Email with PDF">
                                                                <Mail size={14} />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))
                                        ) : resumeTab === 'SALES_ORDERS' ? (
                                            filteredInvoices.length === 0 ? <tr><td colSpan={9} className="p-6 text-center text-slate-400">No active invoices found.</td></tr> :
                                                filteredInvoices.map(inv => {
                                                    const linkedBooking = bookings.find(b => b.bookingNumber === inv.transportRef);
                                                    // Try to resolve BL via Booking if possible
                                                    const linkedBL = billOfLadings.find(bl => bl.bookingNumber === inv.transportRef);

                                                    return (
                                                        <tr key={inv.id} className="hover:bg-slate-50 group">
                                                            <td className="p-2.5 font-mono font-medium text-slate-700">{inv.invoiceNumber}</td>
                                                            <td className="p-2.5 text-slate-600 text-xs">{formatDate(inv.invoiceDate)}</td>
                                                            <td className="p-2.5 text-slate-600 truncate max-w-[150px]" title={inv.soldTo}>{getFirstTwoWords(inv.soldTo)}</td>
                                                            <td className="p-2.5 font-mono text-xs text-slate-600">{inv.soNumber || '-'}</td>
                                                            <td className="p-2.5 font-mono text-xs text-slate-600">{inv.plNumber || '-'}</td>
                                                            <td className="p-2.5">
                                                                {inv.transportRef ? (
                                                                    <span className="font-mono text-blue-600 font-medium text-xs">{inv.transportRef}</span>
                                                                ) : <span className="text-slate-300 text-xs">-</span>}
                                                            </td>
                                                            <td className="p-2.5 font-mono text-xs text-slate-600">{linkedBL?.blNumber || '-'}</td>
                                                            <td className="p-2.5 text-right font-mono text-xs font-bold text-slate-700">
                                                                {inv.currency} {inv.totalAmount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                            </td>
                                                            <td className="p-2.5 text-center">
                                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${linkedBooking?.status === 'SHIPPED' ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>
                                                                    {linkedBooking?.status || 'Active'}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    );
                                                })
                                        ) : (
                                            filteredBLs.length === 0 ? <tr><td colSpan={8} className="p-6 text-center text-slate-400">No bill of ladings found.</td></tr> :
                                                filteredBLs.map(bl => (
                                                    <tr key={bl.id} className="hover:bg-slate-50 group">
                                                        <td className="p-2.5 font-mono font-medium text-slate-700">{bl.blNumber}</td>
                                                        <td className="p-2.5 text-slate-600 truncate max-w-[120px]" title={bl.consignee}>{getFirstWord(bl.consignee || bl.shipper)}</td>
                                                        <td className="p-2.5">
                                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${bl.status === 'RELEASED' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                                                                bl.status === 'IN TRANSIT' ? 'bg-blue-50 text-blue-700 border-blue-100' :
                                                                    bl.status === 'BOOKING' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                                                                        'bg-slate-50 text-slate-600 border-slate-100'
                                                                }`}>
                                                                {bl.status || 'IN TRANSIT'}
                                                            </span>
                                                        </td>
                                                        <td className="p-2.5 text-slate-500">{getPortCode(bl.portLoading)}</td>
                                                        <td className="p-2.5 text-slate-500">{getPortCode(bl.portDischarge)}</td>
                                                        <td className="p-2.5 text-right text-slate-600 font-mono text-xs">{formatDate(bl.shippedDate)}</td>
                                                        <td className="p-2.5 text-right text-slate-600 font-mono text-xs">{bl.placeDelivery ? formatDate(bl.placeDelivery) : '-'}</td>
                                                        <td className="p-2.5 text-right flex justify-end gap-1 opacity-100">
                                                            <button onClick={() => handleViewBL(bl)} className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-blue-600" title="View PDF"><Eye size={14} /></button>
                                                            <button onClick={() => handleUpdateSchedule(bl)} className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-cyan-600" title="Update Schedule (AI)"><Ship size={14} /></button>
                                                            <button onClick={() => handleEditBL(bl)} className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-green-600" title="Edit"><Edit size={14} /></button>
                                                            <button onClick={() => handleEmailPreview(bl.id, bl.consignee || 'Consignee', bl.consignee || '', `BL Update: ${bl.blNumber}`, `<p>Attached Bill of Lading ${bl.blNumber}.</p>`, undefined, bl)} className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-purple-600" title="Email w/ PDF"><Mail size={14} /></button>
                                                        </td>
                                                    </tr>
                                                ))
                                        )}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div> {/* End Workspace */}
                </div> {/* End Top Flex */}



                {/* Input Area (Side by side in bottom panel?) No, stick to bottom of panel */}
            </div>

            {/* Process Order Modal */}
            {selectedOrder && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full flex flex-col overflow-hidden max-h-[90vh]">
                        {/* Header */}
                        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                            <div className="flex items-center gap-3">
                                <div className="bg-blue-100 p-2 rounded-lg text-blue-600">
                                    <Package size={24} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg text-slate-800">Process Order {selectedOrder.orderNumber}</h3>
                                    <p className="text-xs text-slate-500">{selectedOrder.customerName} • {selectedOrder.pod} • {selectedOrder.items.length} Items</p>
                                </div>
                            </div>
                            <button onClick={() => setSelectedOrder(null)} className="text-slate-400 hover:text-slate-600 bg-white p-1 rounded-full hover:bg-slate-100 transition-all shadow-sm border border-transparent hover:border-slate-200">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="flex-1 overflow-hidden flex flex-col p-6 bg-slate-50/50">
                            {/* Tabs */}
                            <div className="flex mb-4 bg-white rounded-lg p-1 border border-slate-200 w-fit shadow-sm">
                                <button
                                    onClick={() => setActiveTab('MATCH')}
                                    className={`px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'MATCH' ? 'bg-blue-100 text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                >
                                    <Link size={16} /> Match Existing Booking ({getMatchingBookings(selectedOrder).length})
                                </button>
                                <button
                                    onClick={() => setActiveTab('REQUEST')}
                                    className={`px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'REQUEST' ? 'bg-purple-100 text-purple-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                >
                                    <Plus size={16} /> Request New Booking ({getMatchingQuotes(selectedOrder).length})
                                </button>
                            </div>

                            {/* Content */}
                            <div className="flex-1 overflow-y-auto custom-scrollbar">
                                {activeTab === 'MATCH' && (
                                    <div className="space-y-3">
                                        {getMatchingBookings(selectedOrder).length > 0 ? (
                                            getMatchingBookings(selectedOrder).map(bk => (
                                                <div key={bk.id} className="p-4 rounded-xl border border-slate-200 bg-white hover:border-blue-400 hover:shadow-md transition-all flex items-center justify-between group">
                                                    <div className="flex items-center gap-4 flex-1">
                                                        <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 text-blue-600 shrink-0">
                                                            <Link size={24} />
                                                        </div>
                                                        <div className="flex-1">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <h4 className="font-bold text-base text-slate-800">{bk.bookingNumber}</h4>
                                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${bk.status === 'AVAILABLE' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-slate-50 text-slate-600 border-slate-100'}`}>{bk.status}</span>
                                                            </div>
                                                            <div className="flex items-center gap-3 text-xs text-slate-500 font-mono mb-2">
                                                                <span className="flex items-center gap-1"><MapPin size={12} /> {bk.pol}</span>
                                                                <ArrowRight size={10} />
                                                                <span className="flex items-center gap-1"><MapPin size={12} /> {bk.pod}</span>
                                                            </div>
                                                            <div className="flex gap-6 text-sm font-medium text-slate-700">
                                                                <span><span className="text-slate-400 font-normal">ETD:</span> {formatDate(bk.etd)}</span>
                                                                <span><span className="text-slate-400 font-normal">ETA:</span> {formatDate(bk.eta)}</span>
                                                                <span className="text-slate-500">|</span>
                                                                <span className="text-slate-600">{bk.equipment}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="text-right pl-6 border-l border-slate-100">
                                                        <button
                                                            onClick={() => handleLinkBooking(bk)}
                                                            className="bg-blue-600 text-white px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-blue-700 shadow-sm hover:shadow-lg transition-all flex items-center gap-2"
                                                        >
                                                            Link Order <ArrowRight size={16} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="flex flex-col items-center justify-center p-12 text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50">
                                                <Link size={48} className="mb-4 text-slate-200" />
                                                <p className="font-medium">No matching bookings found.</p>
                                                <p className="text-sm mt-1">Try requesting a new booking below.</p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {activeTab === 'REQUEST' && (
                                    <div className="space-y-6">
                                        <div className="grid grid-cols-1 gap-4">
                                            {getMatchingQuotes(selectedOrder).map(quote => (
                                                <div key={quote.id} className="p-4 rounded-xl border border-slate-200 bg-white hover:border-purple-400 hover:shadow-md transition-all flex items-center justify-between">
                                                    <div className="flex items-center gap-4">
                                                        <div className="bg-purple-50 p-3 rounded-lg border border-purple-100 text-purple-600">
                                                            <Ship size={24} />
                                                        </div>
                                                        <div>
                                                            <h4 className="font-bold text-lg text-slate-800">{quote.agentName}</h4>
                                                            <div className="flex gap-2 text-xs mt-1">
                                                                <span className="bg-slate-100 px-2 py-1 rounded text-slate-600 font-mono border border-slate-200">{quote.originPortCode || 'POA'}</span>
                                                                <span className="text-slate-300 self-center">→</span>
                                                                <span className="bg-slate-100 px-2 py-1 rounded text-slate-600 font-mono border border-slate-200">{quote.destinationPortCode || 'POD'}</span>
                                                            </div>
                                                            <div className="mt-2 text-xs text-slate-500">
                                                                {quote.validUntil ? `Valid until: ${formatDate(quote.validUntil)}` : 'Valid for 30 days'}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="font-bold text-2xl text-emerald-600 mb-2">${quote.rate.toLocaleString()}</div>
                                                        <button
                                                            onClick={() => handleRequestNewBooking(quote)}
                                                            className="bg-purple-600 text-white px-6 py-2 rounded-lg text-sm font-bold hover:bg-purple-700 shadow-sm hover:shadow-lg transition-all"
                                                        >
                                                            Book Now
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}

                                        </div>

                                        {getMatchingQuotes(selectedOrder).length === 0 && (
                                            <div className="text-center p-8 text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
                                                <p>No active quotes found for this route.</p>
                                            </div>
                                        )}

                                        <div className="border-t border-slate-200 pt-6">
                                            <h4 className="font-bold text-slate-700 mb-3 flex items-center gap-2"><Mail size={16} /> Request Quotes from Agents</h4>
                                            <button
                                                onClick={() => handleRequestFreightQuote()}
                                                className="w-full bg-white text-indigo-600 px-4 py-4 rounded-xl text-sm font-bold hover:bg-indigo-50 hover:border-indigo-300 transition-all flex items-center justify-center gap-3 border border-dashed border-slate-300"
                                            >
                                                <Send size={18} /> Broadcast Quote Request to All Matched Agents
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Booking Edit Modal */}
            {
                showBookingEditModal && editingBooking && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                        <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full flex flex-col overflow-hidden">
                            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                                <h3 className="font-bold text-lg text-slate-800">{isReadOnly ? 'View' : 'Edit'} Booking {editingBooking.bookingNumber}</h3>
                                <button onClick={() => setShowBookingEditModal(false)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
                            </div>

                            <div className="p-6 space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Carrier</label>
                                        <input
                                            className="w-full p-2 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-500"
                                            value={editForm.carrier || ''}
                                            onChange={e => setEditForm({ ...editForm, carrier: e.target.value })}
                                            placeholder="Enter Carrier..."
                                            disabled={isReadOnly}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Vessel / Voyage</label>
                                        <input
                                            className="w-full p-2 border border-slate-200 rounded text-sm bg-slate-50 text-slate-500"
                                            value={editingBooking.vesselVoyage}
                                            disabled
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">ETD</label>
                                        <input
                                            type="date"
                                            className="w-full p-2 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-500"
                                            value={editForm.etd ? editForm.etd.split('T')[0] : ''}
                                            onChange={e => setEditForm({ ...editForm, etd: e.target.value })}
                                            disabled={isReadOnly}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">ETA</label>
                                        <input
                                            type="date"
                                            className="w-full p-2 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-500"
                                            value={editForm.eta ? editForm.eta.split('T')[0] : ''}
                                            onChange={e => setEditForm({ ...editForm, eta: e.target.value })}
                                            disabled={isReadOnly}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Container Number</label>
                                        <input
                                            className="w-full p-2 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-500"
                                            value={editForm.containerNumber || ''}
                                            onChange={e => setEditForm({ ...editForm, containerNumber: e.target.value })}
                                            placeholder="ABCD1234567"
                                            disabled={isReadOnly}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">BL Number</label>
                                        <input
                                            className="w-full p-2 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-500"
                                            value={editForm.blNumber || ''}
                                            onChange={e => setEditForm({ ...editForm, blNumber: e.target.value })}
                                            placeholder="Enter BL Number..."
                                            disabled={isReadOnly}
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Status</label>
                                        <select
                                            className="w-full p-2 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-500"
                                            value={editForm.status || 'ACTIVE'}
                                            onChange={e => setEditForm({ ...editForm, status: e.target.value as any })}
                                            disabled={isReadOnly}
                                        >
                                            <option value="REQUESTED">REQUESTED</option>
                                            <option value="ACTIVE">ACTIVE</option>
                                            <option value="SHIPPED">SHIPPED</option>
                                            <option value="AVAILABLE">AVAILABLE</option>
                                            <option value="CANCELLED">CANCELLED</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div className="p-6 border-t border-slate-100 bg-white flex justify-end gap-3">
                                <button onClick={() => setShowBookingEditModal(false)} className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-700">Cancel</button>
                                {!isReadOnly && (
                                    <button onClick={handleSaveBooking} className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-blue-700 shadow-lg flex items-center gap-2">
                                        <Save size={18} /> Save Changes
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )
            }

            {/* BL Edit Modal */}
            {
                showBLEditModal && editingBL && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                        <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full flex flex-col overflow-hidden">
                            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                                <h3 className="font-bold text-lg text-slate-800">{isReadOnly ? 'View' : 'Edit'} Bill of Lading {editingBL.blNumber}</h3>
                                <button onClick={() => setShowBLEditModal(false)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
                            </div>
                            <div className="p-6 space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">BL Number</label>
                                        <input
                                            className="w-full p-2 border border-slate-200 rounded text-sm bg-slate-50 text-slate-500"
                                            value={editingBL.blNumber}
                                            disabled
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Consignee</label>
                                        <input
                                            className="w-full p-2 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-500"
                                            value={blEditForm.consignee || ''}
                                            onChange={e => setBLEditForm({ ...blEditForm, consignee: e.target.value })}
                                            disabled={isReadOnly}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Port of Loading</label>
                                        <input
                                            className="w-full p-2 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-500"
                                            value={blEditForm.portLoading || ''}
                                            onChange={e => setBLEditForm({ ...blEditForm, portLoading: e.target.value })}
                                            disabled={isReadOnly}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Port of Discharge</label>
                                        <input
                                            className="w-full p-2 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-500"
                                            value={blEditForm.portDischarge || ''}
                                            onChange={e => setBLEditForm({ ...blEditForm, portDischarge: e.target.value })}
                                            disabled={isReadOnly}
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="p-6 border-t border-slate-100 bg-white flex justify-end gap-3">
                                <button onClick={() => setShowBLEditModal(false)} className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-700">Close</button>
                                {!isReadOnly && (
                                    <button onClick={handleSaveBL} className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-blue-700 shadow-lg flex items-center gap-2">
                                        <Save size={18} /> Save Changes
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )
            }



            {/* PDF Preview Modal */}
            {
                showPdfPreviewModal && pdfPreviewUrl && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                        <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden">
                            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                                <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                                    <FileText size={20} className="text-blue-600" />
                                    {pdfPreviewTitle}
                                </h3>
                                <div className="flex items-center gap-2">
                                    <a
                                        href={pdfPreviewUrl}
                                        download={pdfPreviewTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase() + ".pdf"}
                                        className="p-2 hover:bg-slate-200 rounded text-slate-500 hover:text-blue-600"
                                        title="Download"
                                    >
                                        <Download size={20} />
                                    </a>
                                    <button
                                        onClick={() => setShowPdfPreviewModal(false)}
                                        className="p-2 hover:bg-slate-200 rounded text-slate-500 hover:text-red-500"
                                    >
                                        <X size={24} />
                                    </button>
                                </div>
                            </div>
                            <div className="flex-1 bg-slate-100 p-1">
                                <iframe
                                    src={pdfPreviewUrl}
                                    className="w-full h-full rounded-b-lg border-none"
                                    title="PDF Preview"
                                />
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Email Preview Modal */}
            {
                showEmailPreviewModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                        <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
                            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                                <div>
                                    <h3 className="font-bold text-lg flex items-center gap-2 text-slate-800"><Mail size={20} className="text-blue-600" /> Review Quote Requests</h3>
                                    <p className="text-sm text-slate-500 mt-1">Found {pendingEmailDrafts.length} recipients for broadcast.</p>
                                </div>
                                <button onClick={() => setShowEmailPreviewModal(false)} disabled={sendingEmails} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 space-y-4">
                                {/* Preview of the First Email (Assuming they are mostly template based) */}
                                {pendingEmailDrafts.length > 0 && (
                                    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                        <div className="mb-4 border-b border-slate-100 pb-4">
                                            <p className="text-xs font-bold text-slate-400 uppercase mb-1">Subject</p>
                                            <p className="font-medium text-slate-800">{pendingEmailDrafts[0].subject}</p>
                                        </div>
                                        <div className="mb-4 border-b border-slate-100 pb-4">
                                            <p className="text-xs font-bold text-slate-400 uppercase mb-1">Recipients ({pendingEmailDrafts.length})</p>
                                            <div className="flex flex-wrap gap-2 mt-2">
                                                {pendingEmailDrafts.map(d => (
                                                    <span key={d.agentId} className="bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs font-bold border border-blue-100 flex items-center gap-1">
                                                        {d.agentName} <span className="font-normal opacity-70">&lt;{d.to}&gt;</span>
                                                    </span>
                                                ))}
                                            </div>
                                        </div>


                                        {/* Attachments Section */}
                                        {pendingEmailDrafts[0].attachments && pendingEmailDrafts[0].attachments.length > 0 && (
                                            <div className="mb-4 border-b border-slate-100 pb-4">
                                                <p className="text-xs font-bold text-slate-400 uppercase mb-2">Attachments ({pendingEmailDrafts[0].attachments.length})</p>
                                                <div className="flex flex-wrap gap-2">
                                                    {pendingEmailDrafts[0].attachments.map((att, i) => (
                                                        <div key={i} className="flex items-center gap-2 bg-slate-100 px-3 py-2 rounded-lg border border-slate-200">
                                                            <FileText size={16} className="text-red-500" />
                                                            <span className="text-sm font-medium text-slate-700">{att.name}</span>
                                                            <span className="text-xs text-slate-400">({Math.round(att.contentBytes.length * 0.75 / 1024)} KB)</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        <div>
                                            <p className="text-xs font-bold text-slate-400 uppercase mb-2">Message Body Preview</p>
                                            <div className="prose prose-sm max-w-none p-4 bg-slate-50 rounded-lg border border-slate-200" dangerouslySetInnerHTML={{ __html: pendingEmailDrafts[0].htmlBody }} />
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="p-6 border-t border-slate-100 bg-white flex justify-end gap-3">
                                <button
                                    onClick={() => setShowEmailPreviewModal(false)}
                                    disabled={sendingEmails}
                                    className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-700"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleConfirmSendEmails}
                                    disabled={sendingEmails}
                                    className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-blue-700 shadow-lg flex items-center gap-2 disabled:opacity-70 disabled:cursor-wait"
                                >
                                    {sendingEmails ? (
                                        <>
                                            <Loader2 size={18} className="animate-spin" />
                                            Sending...
                                        </>
                                    ) : (
                                        <>
                                            <Mail size={18} />
                                            Confirm & Send ({pendingEmailDrafts.length})
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default AiLogisticsManager;
