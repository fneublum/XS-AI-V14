import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { FreightQuote, Port, Supplier, Company, CargoAgent, Carrier, SavedLocation, User, Role } from '../types';
import { Ship, Plus, X, Save, Trash2, MapPin, Anchor, ArrowRight, Pencil, AlertCircle, Truck, LayoutGrid, List, CheckCircle2, Loader2, Clock, CalendarClock, Package, Container, Building, DollarSign, Filter, Search, ChevronDown, FilePlus, Mail, Send, ScanEye, UploadCloud, Sparkles, Globe, Eye } from 'lucide-react';
import { FormattedInput, PriceInput } from '../components/UnitInputs';
import { lookupLocation, analyzeDocument } from '../services/geminiService';
import { sendEmail } from '../services/emailService';

interface FreightQuotesProps {
    quotes: FreightQuote[];
    onAdd: (q: FreightQuote) => void;
    onUpdate: (q: FreightQuote) => void;
    onDelete: (id: string) => void;
    ports: Port[];
    onAddPort: (p: Port) => void;

    // New Props for Agents/Carriers
    cargoAgents: CargoAgent[];
    onAddAgent: (a: CargoAgent) => void;
    carriers: Carrier[];
    onAddCarrier: (c: Carrier) => void;

    // Locations
    locations: SavedLocation[];
    onAddLocation: (l: SavedLocation) => void;

    dbError?: string | null;
    currentCompanyId: string;
    availableCompanies: Company[];
    currentUser?: User; // Optional prop to handle access control
}

// Helper to extract unique values for filtering
const getUniqueValues = (data: any[], key: string) => {
    const values = data.map(item => item[key]).filter(v => v !== undefined && v !== null && v !== '');
    return Array.from(new Set(values)).sort();
};

// Helper to format address: Remove street part if present (heuristic: starts with number)
const formatAddress = (address?: string, maxLen = 25) => {
    if (!address) return '';
    const parts = address.split(',').map(p => p.trim());
    // If >1 part and first part starts with digit, assume street address and strip it
    let result = address;
    if (parts.length > 1 && /^\d/.test(parts[0])) {
        result = parts.slice(1).join(', ');
    }
    return result.length > maxLen ? result.substring(0, maxLen) + '…' : result;
};

const getStatusStyling = (status?: 'PENDING' | 'ACTIVE' | 'EXPIRED') => {
    switch (status) {
        case 'ACTIVE':
            return 'bg-emerald-100 text-emerald-700 border-emerald-200';
        case 'PENDING':
            return 'bg-amber-100 text-amber-700 border-amber-200';
        case 'EXPIRED':
            return 'bg-slate-100 text-slate-600 border-slate-200';
        default:
            return 'bg-slate-100 text-slate-600 border-slate-200';
    }
};

const FreightQuotes: React.FC<FreightQuotesProps> = ({
    quotes, onAdd, onUpdate, onDelete,
    ports, onAddPort,
    cargoAgents, onAddAgent,
    carriers, onAddCarrier,
    locations, onAddLocation,
    dbError, currentCompanyId, availableCompanies,
    currentUser
}) => {
    // --- ROLE BASED ACCESS LOGIC ---
    const isCargoAgentUser = currentUser?.role === Role.CARGO_AGENT;
    const linkedAgentName = isCargoAgentUser
        ? cargoAgents.find(a => a.id === currentUser?.linked_entity_id)?.name || ''
        : '';

    // Filter quotes: if Cargo Agent, only show their own quotes. Otherwise show all.
    // Filter quotes: if Cargo Agent, only show their own quotes. Otherwise show all.
    // Use quotes passed from parent (already filtered)

    // NORMALIZE DATA: Handle potential snake_case from DB
    const normalizeQuote = (q: any): FreightQuote => ({
        ...q,
        freightType: q.freightType || q.freight_type || 'PORT_PORT',
        agentName: q.agentName || q.agent_name || '',
        companyId: q.companyId || q.company_id || '',
        originPort: q.originPort || q.origin_port || '',
        originPortCode: q.originPortCode || q.origin_port_code || '',
        destinationPort: q.destinationPort || q.destination_port || '',
        destinationPortCode: q.destinationPortCode || q.destination_port_code || '',
        pickupLocation: q.pickupLocation || q.pickup_location || '',
        pickupZip: q.pickupZip || q.pickup_zip || '',
        deliveryLocation: q.deliveryLocation || q.delivery_location || '',
        deliveryZip: q.deliveryZip || q.delivery_zip || '',
        validUntil: q.validUntil || q.valid_until || '',
        transitTime: q.transitTime || q.transit_time,
        freeTime: q.freeTime || q.free_time,
        isAllIn: q.isAllIn !== undefined ? q.isAllIn : q.is_all_in,
        pickupCost: q.pickupCost || q.pickup_cost,
        oceanCost: q.oceanCost || q.ocean_cost,
        deliveryCost: q.deliveryCost || q.delivery_cost,
        portFees: q.portFees || q.port_fees,
        containerCount: q.containerCount || q.container_count,
        containerReturn: q.containerReturn || q.container_return,
        blRelease: q.blRelease || q.bl_release,
        securityFee: q.securityFee || q.security_fee,
        originalDocument: q.originalDocument || q.original_document || '',
        containerType: q.containerType || q.container_type || '',
        rate: q.rate !== undefined ? q.rate : 0
    });

    // Filter quotes: if Cargo Agent, only show quotes matching their linked agent name
    const visibleQuotes = quotes.map(normalizeQuote).filter(q => {
        if (!isCargoAgentUser) return true; // Non-agents see all quotes
        if (!linkedAgentName) return true; // No linked agent = show all (fallback)

        // Match quote's agentName against the linked agent name (case-insensitive)
        const quoteAgent = (q.agentName || '').toUpperCase();
        const targetAgent = linkedAgentName.toUpperCase();

        // Flexible match: quote agent contains target agent name OR vice versa
        return quoteAgent.includes(targetAgent) || targetAgent.includes(quoteAgent);
    });

    // Determine selectable companies for the dropdown
    const selectableCompanies = isCargoAgentUser
        ? availableCompanies.filter(c =>
            !currentUser?.allowed_company_ids?.length ||
            currentUser.allowed_company_ids.includes(c.id)
        )
        : availableCompanies;

    // --------------------------------

    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'grid' | 'table'>('table');
    const [isLocationLoading, setIsLocationLoading] = useState(false);
    const [useAllIn, setUseAllIn] = useState(true);
    const [formError, setFormError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    // Filtering State
    const [activeFilterColumn, setActiveFilterColumn] = useState<string | null>(null);
    const [filters, setFilters] = useState<Record<string, string[]>>({});
    const [filterSearch, setFilterSearch] = useState('');
    const filterMenuRef = useRef<HTMLDivElement>(null);

    // Quick Add Port State
    const [showQuickAddPort, setShowQuickAddPort] = useState(false);
    const [newPortCode, setNewPortCode] = useState('');
    const [newPortName, setNewPortName] = useState('');
    const [newPortCountry, setNewPortCountry] = useState('');
    const [portAddedMessage, setPortAddedMessage] = useState('');
    const [targetPortField, setTargetPortField] = useState<'origin' | 'destination' | null>(null);

    // Quick Add Supplier/Carrier State
    const [showQuickAddEntity, setShowQuickAddEntity] = useState(false);
    const [newEntityName, setNewEntityName] = useState('');
    const [newEntityAddedMessage, setNewEntityAddedMessage] = useState('');
    const [targetEntityField, setTargetEntityField] = useState<'agent' | 'carrier' | null>(null);

    // Quick Add Location State
    const [showQuickAddLocation, setShowQuickAddLocation] = useState(false);
    const [newLocName, setNewLocName] = useState('');
    const [newLocAddress, setNewLocAddress] = useState('');
    const [newLocCity, setNewLocCity] = useState('');
    const [newLocState, setNewLocState] = useState('');
    const [newLocZip, setNewLocZip] = useState('');
    const [targetLocationField, setTargetLocationField] = useState<'pickup' | 'delivery' | null>(null);
    const [locationAddedMessage, setLocationAddedMessage] = useState('');

    // Booking Request Modal State
    const [bookingQuote, setBookingQuote] = useState<FreightQuote | null>(null);
    const [bookingContainerCount, setBookingContainerCount] = useState(1);
    const [bookingSending, setBookingSending] = useState(false);
    const [bookingMessage, setBookingMessage] = useState('');
    const [bookingStep, setBookingStep] = useState<'input' | 'preview'>('input');

    // RFQ (Rate Quote Request) Modal State
    const [rfqQuote, setRfqQuote] = useState<FreightQuote | null>(null);
    const [rfqSelectedAgents, setRfqSelectedAgents] = useState<Set<string>>(new Set());
    const [rfqSending, setRfqSending] = useState(false);
    const [rfqMessage, setRfqMessage] = useState('');
    const [rfqAgentSearch, setRfqAgentSearch] = useState('');
    const [rfqStep, setRfqStep] = useState<'select' | 'preview'>('select');

    // CC Email State (shared between Booking & RFQ modals)
    const [ccEmails, setCcEmails] = useState<string[]>(['felipe@ec4.enterprises']);
    const [newCcEmail, setNewCcEmail] = useState('');

    // Send Quote Modal State
    const [sendQuoteOpen, setSendQuoteOpen] = useState(false);
    const [sendQuoteStep, setSendQuoteStep] = useState<'route' | 'preview'>('route');
    const [sendQuoteSelectedAgents, setSendQuoteSelectedAgents] = useState<Set<string>>(new Set());
    const [sendQuoteSending, setSendQuoteSending] = useState(false);
    const [sendQuoteMessage, setSendQuoteMessage] = useState('');
    const [sendQuoteAgentSearch, setSendQuoteAgentSearch] = useState('');
    const [sendQuoteOriginPort, setSendQuoteOriginPort] = useState('');
    const [sendQuoteDestPort, setSendQuoteDestPort] = useState('');
    const [sendQuoteFreightType, setSendQuoteFreightType] = useState('PORT_PORT');
    const [sendQuotePickup, setSendQuotePickup] = useState('');
    const [sendQuoteDelivery, setSendQuoteDelivery] = useState('');
    const [sendQuoteContainerType, setSendQuoteContainerType] = useState('40DC');

    // OCR Upload State
    const [showOcrModal, setShowOcrModal] = useState(false);
    const [ocrFile, setOcrFile] = useState<File | null>(null);
    const [ocrPreviewUrl, setOcrPreviewUrl] = useState<string | null>(null);
    const [ocrProcessing, setOcrProcessing] = useState(false);
    const [ocrDragActive, setOcrDragActive] = useState(false);
    const [ocrError, setOcrError] = useState<string | null>(null);
    const ocrFileInputRef = useRef<HTMLInputElement>(null);
    const [showOcrReview, setShowOcrReview] = useState(false);
    const [ocrReviewData, setOcrReviewData] = useState<Partial<FreightQuote>>({});
    const [ocrMatchedQuote, setOcrMatchedQuote] = useState<FreightQuote | null>(null);
    const [ocrDetectedLanguage, setOcrDetectedLanguage] = useState<string | null>(null);
    const [ocrOriginalDocument, setOcrOriginalDocument] = useState<string | null>(null);
    const [viewDocumentUrl, setViewDocumentUrl] = useState<string | null>(null);

    // Column Widths
    const [colWidths, setColWidths] = useState({
        service: 140,
        status: 110,
        agent: 180,
        pickup: 220,
        origin: 110,
        poaName: 180, // New Column
        dest: 110,
        pooName: 180, // New Column

        rate: 130,
        time: 120,
        validity: 130,
        carrier: 160,
        actions: 100
    });

    // Track which quotes have already been marked expired to prevent infinite loops
    const expiredIdsRef = React.useRef<Set<string>>(new Set());

    useEffect(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Set to start of day for comparison

        const expiredQuotes = quotes.filter(q => {
            const nq = normalizeQuote(q);
            if (nq.status !== 'ACTIVE' && nq.status !== 'PENDING') return false;
            if (!nq.validUntil) return false;
            if (expiredIdsRef.current.has(nq.id)) return false; // Already attempted
            try {
                const parts = nq.validUntil.split('-');
                if (parts.length !== 3) return false;
                const validUntilDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                return validUntilDate < today;
            } catch (e) {
                return false;
            }
        });

        if (expiredQuotes.length > 0) {
            expiredQuotes.forEach(q => {
                expiredIdsRef.current.add(q.id);
                // Only send id + status to avoid camelCase field mismatch with Supabase
                onUpdate({ id: q.id, status: 'EXPIRED' } as any);
            });
        }
    }, [quotes, onUpdate]);

    // Handle click outside for filter menu
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (filterMenuRef.current && !filterMenuRef.current.contains(event.target as Node)) {
                setActiveFilterColumn(null);
                setFilterSearch('');
                setFilterBtnPos(null);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const startResize = (e: React.MouseEvent, colKey: keyof typeof colWidths) => {
        e.preventDefault();
        const startX = e.pageX;
        const startWidth = colWidths[colKey];

        const onMouseMove = (moveEvent: MouseEvent) => {
            const newWidth = Math.max(10, startWidth + (moveEvent.pageX - startX));
            setColWidths(prev => ({ ...prev, [colKey]: newWidth }));
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    const initialFormState: Partial<FreightQuote> = {
        agentName: isCargoAgentUser ? linkedAgentName : '', // Pre-fill for Cargo Agent
        carrier: '',
        freightType: 'PORT_PORT',
        originPort: '',
        originPortCode: '',
        pickupLocation: '',
        pickupZip: '',
        destinationPort: '',
        destinationPortCode: '',
        deliveryLocation: '',
        deliveryZip: '',
        rate: 0,
        chassis: 0,
        overweight: 0,
        containerCount: 1,
        currency: 'USD',
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        comments: '',
        companyId: currentCompanyId === 'ALL' ? '' : currentCompanyId,
        transitTime: 0,
        freeTime: 0,
        isAllIn: true,
        pickupCost: 0,
        oceanCost: 0,
        deliveryCost: 0,
        portFees: 0,
        deconsolidation: 0,
        containerReturn: 0,
        blRelease: 0,
        thc: 0,
        isps: 0,
        trs: 0,
        securityFee: 0,
        observation: '',
        containerType: '',
        status: 'PENDING'
    };

    const [formData, setFormData] = useState<Partial<FreightQuote>>(initialFormState);

    // DEBUG: Log data flow
    console.log('[FreightQuotes] Input quotes:', quotes.length, 'visibleQuotes:', visibleQuotes.length);

    // Apply Filters
    const filteredQuotes = visibleQuotes.filter(quote => {
        // Global Search
        const searchLower = searchTerm.toLowerCase();
        const matchesGlobal = searchTerm === '' ||
            (quote.agentName && quote.agentName.toLowerCase().includes(searchLower)) ||
            (quote.carrier && quote.carrier.toLowerCase().includes(searchLower)) ||
            (quote.originPortCode && quote.originPortCode.toLowerCase().includes(searchLower)) ||
            (quote.destinationPortCode && quote.destinationPortCode.toLowerCase().includes(searchLower)) ||
            (quote.pickupLocation && quote.pickupLocation.toLowerCase().includes(searchLower)) ||
            (quote.deliveryLocation && quote.deliveryLocation.toLowerCase().includes(searchLower)) ||
            (quote.status && quote.status.toLowerCase().includes(searchLower));

        if (!matchesGlobal) return false;

        // Column Filters
        for (const [key, selectedValues] of Object.entries(filters)) {
            const values = selectedValues as string[];
            if (values.length > 0) {
                const cellValue = String(quote[key as keyof FreightQuote] || '');
                if (!values.includes(cellValue)) return false;
            }
        }
        return true;
    }).sort((a, b) => (a.originPort || '').localeCompare(b.originPort || ''));

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

    const handleAddNew = () => {
        setFormData({
            ...initialFormState,
            companyId: (currentCompanyId === 'ALL' || isCargoAgentUser) ? (formData.companyId || '') : currentCompanyId,
            agentName: isCargoAgentUser ? linkedAgentName : '' // Ensure logic persists on new
        });
        setUseAllIn(true);
        setEditingId(null);
        setFormError(null);
        setIsAdding(true);
    };

    const handleEdit = (quote: FreightQuote, e: React.MouseEvent) => {
        e.stopPropagation();
        setFormData(quote);
        setUseAllIn(quote.isAllIn !== false); // Default to true if undefined
        setEditingId(quote.id);
        setFormError(null);
        setIsAdding(true);
    };

    const handleDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm('Delete this freight quote?')) {
            onDelete(id);
        }
    };

    const handleOpenBookingModal = (quote: FreightQuote, e: React.MouseEvent) => {
        e.stopPropagation();
        setBookingQuote(quote);
        setBookingContainerCount(quote.containerCount || 1);
        setBookingMessage('');
        setBookingStep('input');
        const agent = cargoAgents.find(a => a.name === quote.agentName);
        const initialCc = ['felipe@ec4.enterprises'];
        if (agent?.email2 && agent.email2.trim()) initialCc.push(agent.email2.trim());
        setCcEmails(initialCc);
        setNewCcEmail('');
    };

    const buildBookingEmailHtml = (quote: FreightQuote, containerCount: number) => {
        const originLabel = quote.originPortCode ? `${quote.originPort} (${quote.originPortCode})` : (quote.originPort || 'N/A');
        const destLabel = quote.destinationPortCode ? `${quote.destinationPort} (${quote.destinationPortCode})` : (quote.destinationPort || 'N/A');
        return `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #1e293b; border-bottom: 2px solid #f97316; padding-bottom: 8px;">📦 Booking Request</h2>
                <p>Dear <strong>${quote.agentName}</strong>,</p>
                <p>We would like to request a booking based on the following freight quote:</p>
                <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                    <tr style="background: #f8fafc;"><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold; width: 40%;">Service Type</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${quote.freightType?.replace(/_/g, ' to ') || 'Port to Port'}</td></tr>
                    <tr><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Origin</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${originLabel}</td></tr>
                    <tr style="background: #f8fafc;"><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Destination</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${destLabel}</td></tr>
                    ${quote.pickupLocation ? `<tr><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Pick Up</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${quote.pickupLocation}</td></tr>` : ''}
                    ${quote.deliveryLocation ? `<tr style="background: #f8fafc;"><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Delivery</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${quote.deliveryLocation}</td></tr>` : ''}
                    <tr><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Carrier</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${quote.carrier || 'N/A'}</td></tr>
                    <tr style="background: #f8fafc;"><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Rate</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0; color: #059669; font-weight: bold;">$${quote.rate?.toLocaleString()} ${quote.currency || 'USD'}</td></tr>
                    <tr><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Transit Time</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${quote.transitTime ? quote.transitTime + ' days' : 'N/A'}</td></tr>
                    <tr style="background: #fff7ed; font-size: 15px;"><td style="padding: 10px 12px; border: 1px solid #e2e8f0; font-weight: bold; color: #c2410c;">Containers Requested</td><td style="padding: 10px 12px; border: 1px solid #e2e8f0; font-weight: bold; color: #c2410c; font-size: 16px;">${containerCount}</td></tr>
                </table>
                <p>Please confirm availability and provide the booking details at your earliest convenience.</p>
                <p style="color: #64748b; font-size: 12px; margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 12px;">This booking request was sent from XS CRM — X-Solution AI Business Platform.</p>
            </div>
        `;
    };

    const buildBookingSubject = (quote: FreightQuote, containerCount: number) => {
        const originLabel = quote.originPortCode ? `${quote.originPort} (${quote.originPortCode})` : (quote.originPort || 'N/A');
        const destLabel = quote.destinationPortCode ? `${quote.destinationPort} (${quote.destinationPortCode})` : (quote.destinationPort || 'N/A');
        return `Booking Request — ${originLabel} → ${destLabel} | ${containerCount} Container(s)`;
    };

    const handleSendBookingRequest = async () => {
        if (!bookingQuote) return;
        setBookingSending(true);
        setBookingMessage('');

        // Find the cargo agent email
        const agent = cargoAgents.find(a => a.name === bookingQuote.agentName);
        const agentEmail = agent?.email;

        if (!agentEmail) {
            setBookingMessage('❌ No email found for cargo agent "' + bookingQuote.agentName + '". Please add an email to this agent in the system.');
            setBookingSending(false);
            return;
        }

        const subject = buildBookingSubject(bookingQuote, bookingContainerCount);
        const htmlBody = buildBookingEmailHtml(bookingQuote, bookingContainerCount);

        try {
            const result = await sendEmail({ to: [agentEmail], cc: ccEmails, subject, htmlBody });
            if (result.success) {
                setBookingMessage('✅ Booking request sent successfully via ' + result.provider + '!');
                setTimeout(() => { setBookingQuote(null); setBookingMessage(''); setBookingStep('input'); }, 2500);
            } else {
                setBookingMessage('❌ ' + result.message);
            }
        } catch (err: any) {
            setBookingMessage('❌ Error: ' + (err.message || 'Failed to send email'));
        } finally {
            setBookingSending(false);
        }
    };

    // ─── RFQ (Rate Quote Request) Functions ──────────────────────────────
    const handleOpenRfqModal = (quote: FreightQuote, e: React.MouseEvent) => {
        e.stopPropagation();
        setRfqQuote(quote);
        setRfqSelectedAgents(new Set());
        setRfqMessage('');
        setRfqAgentSearch('');
        setRfqStep('select');
        const agent = cargoAgents.find(a => a.name === quote.agentName);
        const initialCc = ['felipe@ec4.enterprises'];
        if (agent?.email2 && agent.email2.trim()) initialCc.push(agent.email2.trim());
        setCcEmails(initialCc);
        setNewCcEmail('');
    };

    const toggleRfqAgent = (agentId: string) => {
        setRfqSelectedAgents(prev => {
            const next = new Set(prev);
            if (next.has(agentId)) next.delete(agentId);
            else next.add(agentId);
            return next;
        });
    };

    const buildRfqSubject = (quote: FreightQuote) => {
        const originLabel = quote.originPortCode ? `${quote.originPort} (${quote.originPortCode})` : (quote.originPort || 'N/A');
        const destLabel = quote.destinationPortCode ? `${quote.destinationPort} (${quote.destinationPortCode})` : (quote.destinationPort || 'N/A');
        const serviceType = quote.freightType?.replace(/_/g, ' to ') || 'Port to Port';
        return `Rate Request — ${originLabel} → ${destLabel} | ${serviceType}`;
    };

    const buildRfqEmailHtml = (quote: FreightQuote, agentName: string) => {
        const originLabel = quote.originPortCode ? `${quote.originPort} (${quote.originPortCode})` : (quote.originPort || 'N/A');
        const destLabel = quote.destinationPortCode ? `${quote.destinationPort} (${quote.destinationPortCode})` : (quote.destinationPort || 'N/A');
        return `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #1e293b; border-bottom: 2px solid #059669; padding-bottom: 8px;">💰 Rate Request</h2>
                <p>Dear <strong>${agentName}</strong>,</p>
                <p>We would like to request a freight rate quotation for the following route:</p>
                <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                    <tr style="background: #f8fafc;"><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold; width: 40%;">Service Type</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${quote.freightType?.replace(/_/g, ' to ') || 'Port to Port'}</td></tr>
                    <tr><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Origin</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${originLabel}</td></tr>
                    <tr style="background: #f8fafc;"><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Destination</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${destLabel}</td></tr>
                    ${quote.pickupLocation ? `<tr><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Pick Up</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${quote.pickupLocation}</td></tr>` : ''}
                    ${quote.deliveryLocation ? `<tr style="background: #f8fafc;"><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Delivery</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${quote.deliveryLocation}</td></tr>` : ''}
                </table>
                <p>Please provide your best rate, transit time, free time, and any applicable surcharges at your earliest convenience.</p>
                <p style="color: #64748b; font-size: 12px; margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 12px;">This rate request was sent from XS CRM — X-Solution AI Business Platform.</p>
            </div>
        `;
    };

    const handleSendRfqEmails = async () => {
        if (!rfqQuote || rfqSelectedAgents.size === 0) return;
        setRfqSending(true);
        setRfqMessage('');

        const subject = buildRfqSubject(rfqQuote);
        let successCount = 0;
        let failCount = 0;
        const errors: string[] = [];

        for (const agentId of rfqSelectedAgents) {
            const agent = cargoAgents.find(a => a.id === agentId);
            if (!agent?.email) {
                failCount++;
                errors.push(`${agent?.name || agentId}: No email`);
                continue;
            }
            try {
                const htmlBody = buildRfqEmailHtml(rfqQuote, agent.name);
                const result = await sendEmail({ to: [agent.email], cc: ccEmails, subject, htmlBody });
                if (result.success) {
                    successCount++;
                } else {
                    failCount++;
                    errors.push(`${agent.name}: ${result.message}`);
                }
            } catch (err: any) {
                failCount++;
                errors.push(`${agent.name}: ${err.message}`);
            }
        }

        if (failCount === 0) {
            setRfqMessage(`✅ Rate request sent to ${successCount} agent(s) successfully!`);
            setTimeout(() => { setRfqQuote(null); setRfqMessage(''); }, 2500);
        } else {
            setRfqMessage(`✅ ${successCount} sent, ❌ ${failCount} failed: ${errors.join('; ')}`);
        }
        setRfqSending(false);
    };

    // ─── Send Quote Functions ──────────────────────────────────────────
    const handleOpenSendQuote = () => {
        setSendQuoteOpen(true);
        setSendQuoteStep('route');
        setSendQuoteSelectedAgents(new Set());
        setSendQuoteMessage('');
        setSendQuoteAgentSearch('');
        setSendQuoteOriginPort('');
        setSendQuoteDestPort('');
        setSendQuoteFreightType('PORT_PORT');
        setSendQuotePickup('');
        setSendQuoteDelivery('');
        setSendQuoteContainerType('40DC');
        const initialCc = ['felipe@ec4.enterprises'];
        setCcEmails(initialCc);
        setNewCcEmail('');
    };

    const toggleSendQuoteAgent = (agentId: string) => {
        setSendQuoteSelectedAgents(prev => {
            const next = new Set(prev);
            if (next.has(agentId)) next.delete(agentId);
            else next.add(agentId);
            return next;
        });
    };

    const getSendQuoteOriginInfo = () => {
        const port = ports.find(p => p.id === sendQuoteOriginPort);
        return port ? { name: port.name, code: port.code } : { name: '', code: '' };
    };

    const getSendQuoteDestInfo = () => {
        const port = ports.find(p => p.id === sendQuoteDestPort);
        return port ? { name: port.name, code: port.code } : { name: '', code: '' };
    };

    const buildSendQuoteSubject = () => {
        const origin = getSendQuoteOriginInfo();
        const dest = getSendQuoteDestInfo();
        const originLabel = origin.code ? `${origin.name} (${origin.code})` : 'N/A';
        const destLabel = dest.code ? `${dest.name} (${dest.code})` : 'N/A';
        const serviceType = sendQuoteFreightType.replace(/_/g, ' to ') || 'Port to Port';
        return `Quote Request — ${originLabel} → ${destLabel} | ${serviceType}`;
    };

    const buildSendQuoteEmailHtml = (agentName: string) => {
        const origin = getSendQuoteOriginInfo();
        const dest = getSendQuoteDestInfo();
        const originLabel = origin.code ? `${origin.name} (${origin.code})` : 'N/A';
        const destLabel = dest.code ? `${dest.name} (${dest.code})` : 'N/A';
        const serviceType = sendQuoteFreightType.replace(/_/g, ' to ') || 'Port to Port';
        return `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #1e293b; border-bottom: 2px solid #10b981; padding-bottom: 8px;">📋 Freight Quote Request</h2>
                <p>Dear <strong>${agentName}</strong>,</p>
                <p>We kindly request a freight quotation for the following route:</p>
                <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                    <tr style="background: #f8fafc;"><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold; width: 40%;">Service Type</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${serviceType}</td></tr>
                    <tr><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Origin</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${originLabel}</td></tr>
                    <tr style="background: #f8fafc;"><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Destination</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${destLabel}</td></tr>
                    ${sendQuotePickup ? `<tr><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Pick Up</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${sendQuotePickup}</td></tr>` : ''}
                    ${sendQuoteDelivery ? `<tr style="background: #f8fafc;"><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Delivery</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${sendQuoteDelivery}</td></tr>` : ''}
                    <tr><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Equipment</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${sendQuoteContainerType === '20DC' ? '20\' Dry' : sendQuoteContainerType === '40DC' ? '40\' Dry' : '40\' HC'}</td></tr>
                </table>
                <p>Please provide your best rate, transit time, free time, and any applicable surcharges at your earliest convenience.</p>
                <p style="color: #64748b; font-size: 12px; margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 12px;">This quote request was sent from XS CRM — X-Solution AI Business Platform.</p>
            </div>
        `;
    };

    const handleSendQuoteEmails = async () => {
        if (sendQuoteSelectedAgents.size === 0) return;
        setSendQuoteSending(true);
        setSendQuoteMessage('');

        const origin = getSendQuoteOriginInfo();
        const dest = getSendQuoteDestInfo();
        const subject = buildSendQuoteSubject();
        let successCount = 0;
        let failCount = 0;
        const errors: string[] = [];

        const companyIdForRecord = currentCompanyId === 'ALL' ? '' : currentCompanyId;

        let agentIndex = 0;
        for (const agentId of sendQuoteSelectedAgents) {
            const agent = cargoAgents.find(a => a.id === agentId);
            if (!agent?.email) {
                failCount++;
                errors.push(`${agent?.name || agentId}: No email`);
                continue;
            }
            try {
                const htmlBody = buildSendQuoteEmailHtml(agent.name);
                const result = await sendEmail({ to: [agent.email], cc: ccEmails, subject, htmlBody });
                if (result.success) {
                    successCount++;
                    // Create a PENDING freight quote record for this agent
                    const pendingQuote = {
                        id: `FQ${Date.now()}_${agentIndex}`,
                        company_id: companyIdForRecord,
                        agent_name: agent.name,
                        carrier: '',
                        freight_type: sendQuoteFreightType,
                        origin_port: origin.name,
                        origin_port_code: origin.code,
                        destination_port: dest.name,
                        destination_port_code: dest.code,
                        pickup_location: sendQuotePickup,
                        pickup_zip: '',
                        delivery_location: sendQuoteDelivery,
                        delivery_zip: '',
                        rate: 0,
                        chassis: 0,
                        overweight: 0,
                        container_count: 1,
                        currency: 'USD',
                        valid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                        comments: '',
                        transit_time: 0,
                        free_time: 0,
                        is_all_in: true,
                        pickup_cost: 0,
                        ocean_cost: 0,
                        delivery_cost: 0,
                        port_fees: 0,
                        deconsolidation: 0,
                        container_return: 0,
                        bl_release: 0,
                        thc: 0,
                        isps: 0,
                        trs: 0,
                        security_fee: 0,
                        observation: '',
                        container_type: sendQuoteContainerType,
                        status: 'PENDING'
                    };
                    onAdd(pendingQuote as any);
                } else {
                    failCount++;
                    errors.push(`${agent.name}: ${result.message}`);
                }
            } catch (err: any) {
                failCount++;
                errors.push(`${agent.name}: ${err.message}`);
            }
            agentIndex++;
        }

        if (failCount === 0) {
            setSendQuoteMessage(`✅ Quote request sent to ${successCount} agent(s) and ${successCount} PENDING quote(s) created!`);
            setTimeout(() => { setSendQuoteOpen(false); setSendQuoteMessage(''); }, 3000);
        } else {
            setSendQuoteMessage(`✅ ${successCount} sent, ❌ ${failCount} failed: ${errors.join('; ')}`);
        }
        setSendQuoteSending(false);
    };

    const handleLocationLookup = async (context: 'pickup' | 'delivery', lookupBy: 'city' | 'zip') => {
        const currentCity = context === 'pickup' ? formData.pickupLocation : formData.deliveryLocation;
        const currentZip = context === 'pickup' ? formData.pickupZip : formData.deliveryZip;

        const query = lookupBy === 'city' ? currentCity : currentZip;
        if (!query || query.length < (lookupBy === 'city' ? 3 : 5)) return;

        setIsLocationLoading(true);
        const result = await lookupLocation(query, lookupBy);
        setIsLocationLoading(false);

        if (result) {
            setFormData(prev => ({
                ...prev,
                [context === 'pickup' ? 'pickupZip' : 'deliveryZip']: result.zip,
                [context === 'pickup' ? 'pickupLocation' : 'deliveryLocation']: `${result.city}, ${result.state}`
            }));
        }
    };

    const handleQuickAddPort = async () => {
        if (!newPortCode || !newPortName) return;
        const newPort: Port = {
            id: `PRT${Date.now()}`,
            companyId: 'ALL',
            code: newPortCode.toUpperCase(),
            name: newPortName,
            country: newPortCountry
        };
        await onAddPort(newPort);

        if (targetPortField === 'origin') {
            setFormData(prev => ({
                ...prev,
                originPort: newPort.name,
                originPortCode: newPort.code
            }));
        } else if (targetPortField === 'destination') {
            setFormData(prev => ({
                ...prev,
                destinationPort: newPort.name,
                destinationPortCode: newPort.code
            }));
        }

        setNewPortCode(''); setNewPortName(''); setNewPortCountry('');
        setShowQuickAddPort(false);
        setPortAddedMessage('Port added!');
        setTimeout(() => setPortAddedMessage(''), 3000);
    };

    const handleQuickAddEntity = async () => {
        if (!newEntityName.trim()) return;

        const companyIdForNewRecord = formData.companyId || (currentCompanyId === 'ALL' ? '' : currentCompanyId);
        if (!companyIdForNewRecord) {
            alert("Please select a company context first.");
            return;
        }

        if (targetEntityField === 'agent') {
            const newAgent: CargoAgent = {
                id: `AGT${Date.now()}`,
                companyId: companyIdForNewRecord,
                name: newEntityName.trim(),
                email: '', phone: '', country: ''
            };
            await onAddAgent(newAgent);
            setFormData(prev => ({ ...prev, agentName: newAgent.name }));
        } else if (targetEntityField === 'carrier') {
            const newCarrier: Carrier = {
                id: `CRR${Date.now()}`,
                companyId: companyIdForNewRecord,
                name: newEntityName.trim(),
                scac: '', country: ''
            };
            await onAddCarrier(newCarrier);
            setFormData(prev => ({ ...prev, carrier: newCarrier.name }));
        }

        setNewEntityName('');
        setShowQuickAddEntity(false);
        setNewEntityAddedMessage('Added!');
        setTimeout(() => setNewEntityAddedMessage(''), 3000);
    };

    const handleQuickAddLocation = async () => {
        if (!newLocName) return;
        const companyIdForNewRecord = formData.companyId || (currentCompanyId === 'ALL' ? '' : currentCompanyId);

        const newLocation: SavedLocation = {
            id: `LOC${Date.now()}`,
            companyId: companyIdForNewRecord || 'ALL',
            code: `LOC-${Math.floor(Math.random() * 1000)}`,
            name: newLocName,
            address: newLocAddress,
            city: newLocCity,
            state: newLocState,
            zip: newLocZip,
            country: 'USA',
            entityType: 'WAREHOUSE',
            entityId: '',
            entityName: ''
        };

        await onAddLocation(newLocation);

        const addressString = `${newLocation.address ? newLocation.address + ', ' : ''}${newLocation.city}, ${newLocation.state}`;
        if (targetLocationField === 'pickup') {
            setFormData(prev => ({ ...prev, pickupLocation: addressString, pickupZip: newLocation.zip }));
        } else if (targetLocationField === 'delivery') {
            setFormData(prev => ({ ...prev, deliveryLocation: addressString, deliveryZip: newLocation.zip }));
        }

        setShowQuickAddLocation(false);
        setNewLocName(''); setNewLocAddress(''); setNewLocCity(''); setNewLocState(''); setNewLocZip('');
        setLocationAddedMessage('Location saved & applied!');
        setTimeout(() => setLocationAddedMessage(''), 3000);
    };

    const handleLocationSelect = (e: React.ChangeEvent<HTMLSelectElement>, type: 'pickup' | 'delivery') => {
        const val = e.target.value;
        if (val === '_ADD_NEW_') {
            setTargetLocationField(type);
            setShowQuickAddLocation(true);
            return;
        }

        const loc = locations.find(l => l.id === val);
        if (loc) {
            // Construct address string
            let addr = loc.address || '';
            if (loc.city && loc.state) {
                addr = addr ? `${addr}, ${loc.city}, ${loc.state}` : `${loc.city}, ${loc.state}`;
            }
            // Fallback if empty
            if (!addr) addr = loc.name;

            if (type === 'pickup') {
                setFormData(prev => ({ ...prev, pickupLocation: addr, pickupZip: loc.zip }));
            } else {
                setFormData(prev => ({ ...prev, deliveryLocation: addr, deliveryZip: loc.zip }));
            }
        }
    };

    const handlePortSelect = (e: React.ChangeEvent<HTMLSelectElement>, type: 'origin' | 'destination') => {
        const val = e.target.value;
        if (val === '_ADD_NEW_') {
            setTargetPortField(type);
            setShowQuickAddPort(true);
            return;
        }
        const port = ports.find(p => p.id === val);
        if (port) {
            if (type === 'origin') {
                setFormData(prev => ({ ...prev, originPort: port.name, originPortCode: port.code }));
            } else {
                setFormData(prev => ({ ...prev, destinationPort: port.name, destinationPortCode: port.code }));
            }
        }
    };

    const handleEntitySelect = (e: React.ChangeEvent<HTMLSelectElement>, type: 'agent' | 'carrier') => {
        const val = e.target.value;
        if (val === '_ADD_NEW_') {
            setTargetEntityField(type);
            setShowQuickAddEntity(true);
            return;
        }
        if (type === 'agent') {
            setFormData(prev => ({ ...prev, agentName: val }));
        } else {
            setFormData(prev => ({ ...prev, carrier: val }));
        }
    };

    const handleComponentChange = (field: string, val: number) => {
        setFormData(prev => {
            const newData = { ...prev, [field]: val };
            if (!useAllIn) {
                newData.rate = (newData.pickupCost || 0) + (newData.oceanCost || 0) + (newData.deliveryCost || 0) + (newData.portFees || 0) +
                    (newData.deconsolidation || 0) + (newData.containerReturn || 0) + (newData.blRelease || 0) +
                    (newData.thc || 0) + (newData.isps || 0) + (newData.trs || 0) + (newData.securityFee || 0);
            }
            return newData;
        });
    }

    // ─── OCR FREIGHT QUOTE UPLOAD ─────────────────────────────────────────
    const FREIGHT_QUOTE_EXTRACTION_PROMPT = `You are an expert document analyzer for international freight and logistics.
Analyze this FREIGHT QUOTE / RATE SHEET document and extract the following fields.
Return a valid JSON object with the exact keys listed below. If a field is not found, return null.

IMPORTANT RULES:
1. DETECT the language of the document. Return the detected language name in the DETECTED_LANGUAGE field.
2. If the document is NOT in English, TRANSLATE all extracted values to English.
3. For PORT fields, extract the full port name and/or code (e.g., "HOUSTON", "SANTOS", "USMIA").
4. For RATE/COST fields, extract numeric values only (no currency symbols).
5. For DATE fields, convert to YYYY-MM-DD format when possible.

KEYS:
DETECTED_LANGUAGE: The language of the document (e.g., "English", "Portuguese", "Spanish", "Chinese").
AGENT_NAME: The Cargo Agent, Freight Forwarder, or Shipping Line name.
CARRIER: The ocean carrier / shipping line name (e.g., MSC, OOCL, Maersk, Hapag-Lloyd, ONE).
FREIGHT_TYPE: Service type - one of: PORT_PORT, PORT_DOOR, DOOR_PORT, DOOR_DOOR.
ORIGIN_PORT: Port of Loading / Origin Port name.
ORIGIN_PORT_CODE: Port of Loading code (e.g., USSAV, BRSSZ).
DESTINATION_PORT: Port of Discharge / Destination Port name.
DESTINATION_PORT_CODE: Port of Discharge code.
PICKUP_LOCATION: Pickup / Collection address or city (for door services).
PICKUP_ZIP: Pickup ZIP code.
DELIVERY_LOCATION: Delivery address or city (for door services).
DELIVERY_ZIP: Delivery ZIP code.
RATE: Total all-in freight rate per container (numeric only).
CURRENCY: Currency code (USD, EUR, etc.).
PICKUP_COST: Pickup / drayage / trucking cost (numeric only).
OCEAN_COST: Ocean freight cost (numeric only).
DELIVERY_COST: Delivery / last-mile cost (numeric only).
PORT_FEES: Port / terminal charges (numeric only).
DECONSOLIDATION: Deconsolidation fee (numeric only).
CONTAINER_RETURN: Container return / drop-off fee (numeric only).
BL_RELEASE: Bill of Lading release fee (numeric only).
THC: Terminal Handling Charge (numeric only).
ISPS: ISPS security surcharge (numeric only).
TRS: TRS / equipment fee (numeric only).
SECURITY_FEE: Security fee (numeric only).
CHASSIS: Chassis fee (numeric only).
OVERWEIGHT: Overweight surcharge (numeric only).
CONTAINER_COUNT: Number of containers quoted.
TRANSIT_TIME: Transit time in days (numeric only).
FREE_TIME: Free time / detention days (numeric only).
VALID_UNTIL: Quote validity / expiration date - format as YYYY-MM-DD.
COMMENTS: Any special notes, remarks, or observations.
OBSERVATION: Additional observations or conditions.`;

    const handleOcrFile = useCallback((selectedFile: File) => {
        const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
        if (!validTypes.includes(selectedFile.type)) {
            setOcrError("Unsupported file type. Please upload PDF, JPEG, PNG, or WebP.");
            return;
        }
        if (selectedFile.size > 10 * 1024 * 1024) {
            setOcrError("File size exceeds 10MB limit.");
            return;
        }
        setOcrFile(selectedFile);
        setOcrError(null);

        const reader = new FileReader();
        reader.onload = (e) => {
            const result = e.target?.result as string;
            if (result) setOcrPreviewUrl(result);
        };
        reader.readAsDataURL(selectedFile);
    }, []);

    const handleOcrDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") setOcrDragActive(true);
        else if (e.type === "dragleave") setOcrDragActive(false);
    };

    const handleOcrDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setOcrDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleOcrFile(e.dataTransfer.files[0]);
        }
    };

    const handleOcrFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            handleOcrFile(e.target.files[0]);
        }
    };

    const resetOcrModal = () => {
        setShowOcrModal(false);
        setOcrFile(null);
        setOcrPreviewUrl(null);
        setOcrError(null);
        setOcrProcessing(false);
        if (ocrFileInputRef.current) ocrFileInputRef.current.value = '';
    };

    const resetOcrReview = () => {
        setShowOcrReview(false);
        setOcrReviewData({});
        setOcrMatchedQuote(null);
        setOcrDetectedLanguage(null);
        setOcrOriginalDocument(null);
    };

    const lookupPortCode = (portStr: any): string => {
        if (!portStr) return '';
        const s = String(portStr).trim().toUpperCase();
        if (!s) return '';
        const exactMatch = ports.find(p => p.code.toUpperCase() === s);
        if (exactMatch) return exactMatch.code;
        const byName = ports.find(p =>
            p.name.toUpperCase().includes(s) ||
            s.includes(p.name.toUpperCase()) ||
            p.name.toUpperCase().startsWith(s.split(',')[0].trim()) ||
            s.startsWith(p.name.toUpperCase())
        );
        if (byName) return byName.code;
        const cityPart = s.split(',')[0].trim();
        const byCity = ports.find(p =>
            p.name.toUpperCase().includes(cityPart) ||
            p.code.toUpperCase().includes(cityPart.substring(0, 3))
        );
        if (byCity) return byCity.code;
        return s;
    };

    const lookupPortName = (portStr: any): string => {
        if (!portStr) return '';
        const s = String(portStr).trim().toUpperCase();
        if (!s) return '';
        const exactCode = ports.find(p => p.code.toUpperCase() === s);
        if (exactCode) return exactCode.name;
        const byName = ports.find(p => p.name.toUpperCase().includes(s));
        if (byName) return byName.name;
        return String(portStr).trim();
    };

    const processOcrFreightQuote = useCallback(async () => {
        if (!ocrFile || !ocrPreviewUrl) return;
        setOcrProcessing(true);
        setOcrError(null);

        try {
            const base64Data = ocrPreviewUrl.split(',')[1];
            if (!base64Data) throw new Error("Invalid file data");

            const rawResult = await analyzeDocument(base64Data, ocrFile.type, FREIGHT_QUOTE_EXTRACTION_PROMPT);
            const analysisResult = String(rawResult ?? '');

            // Parse JSON from response
            let cleanText = analysisResult;
            if (cleanText.startsWith('"') && cleanText.includes('\\"')) {
                cleanText = cleanText.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '').trim();
            }
            const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("No JSON found in AI response. Please try again.");

            const data = JSON.parse(jsonMatch[0]);
            console.log('OCR Extracted Freight Quote Data:', data);

            // Detect language
            const detectedLang = data.DETECTED_LANGUAGE || 'English';
            setOcrDetectedLanguage(detectedLang);

            // Map extracted data to FreightQuote fields
            const originPortCode = lookupPortCode(data.ORIGIN_PORT_CODE || data.ORIGIN_PORT);
            const destPortCode = lookupPortCode(data.DESTINATION_PORT_CODE || data.DESTINATION_PORT);
            const originPortName = lookupPortName(data.ORIGIN_PORT || data.ORIGIN_PORT_CODE);
            const destPortName = lookupPortName(data.DESTINATION_PORT || data.DESTINATION_PORT_CODE);

            const extractedQuote: Partial<FreightQuote> = {
                companyId: currentCompanyId === 'ALL' ? '' : currentCompanyId,
                agentName: String(data.AGENT_NAME || ''),
                carrier: String(data.CARRIER || ''),
                freightType: (['PORT_PORT', 'PORT_DOOR', 'DOOR_PORT', 'DOOR_DOOR'].includes(data.FREIGHT_TYPE) ? data.FREIGHT_TYPE : 'PORT_PORT') as FreightQuote['freightType'],
                originPort: originPortName,
                originPortCode: originPortCode,
                destinationPort: destPortName,
                destinationPortCode: destPortCode,
                pickupLocation: String(data.PICKUP_LOCATION || ''),
                pickupZip: String(data.PICKUP_ZIP || ''),
                deliveryLocation: String(data.DELIVERY_LOCATION || ''),
                deliveryZip: String(data.DELIVERY_ZIP || ''),
                rate: parseFloat(data.RATE) || 0,
                currency: String(data.CURRENCY || 'USD'),
                pickupCost: parseFloat(data.PICKUP_COST) || 0,
                oceanCost: parseFloat(data.OCEAN_COST) || 0,
                deliveryCost: parseFloat(data.DELIVERY_COST) || 0,
                portFees: parseFloat(data.PORT_FEES) || 0,
                deconsolidation: parseFloat(data.DECONSOLIDATION) || 0,
                containerReturn: parseFloat(data.CONTAINER_RETURN) || 0,
                blRelease: parseFloat(data.BL_RELEASE) || 0,
                thc: parseFloat(data.THC) || 0,
                isps: parseFloat(data.ISPS) || 0,
                trs: parseFloat(data.TRS) || 0,
                securityFee: parseFloat(data.SECURITY_FEE) || 0,
                chassis: parseFloat(data.CHASSIS) || 0,
                overweight: parseFloat(data.OVERWEIGHT) || 0,
                containerCount: parseInt(data.CONTAINER_COUNT) || 1,
                transitTime: parseInt(data.TRANSIT_TIME) || 0,
                freeTime: parseInt(data.FREE_TIME) || 0,
                validUntil: data.VALID_UNTIL || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                comments: String(data.COMMENTS || ''),
                observation: String(data.OBSERVATION || ''),
                isAllIn: (data.RATE && !data.OCEAN_COST) ? true : false,
                status: 'PENDING'
            };

            // --- Matching logic: find pending quotes matching agent, pickup, POD ---
            const extractedAgent = (extractedQuote.agentName || '').toUpperCase();
            const extractedPickup = (extractedQuote.pickupLocation || '').toUpperCase();
            const extractedPOD = (extractedQuote.destinationPortCode || '').toUpperCase();

            const matchedQuote = quotes.map(normalizeQuote).find(q => {
                if (q.status !== 'PENDING') return false;

                // Match agent name (flexible)
                const qAgent = (q.agentName || '').toUpperCase();
                const agentMatch = extractedAgent && qAgent &&
                    (qAgent.includes(extractedAgent) || extractedAgent.includes(qAgent));
                if (!agentMatch) return false;

                // Match POD (destination port code)
                const qPOD = (q.destinationPortCode || '').toUpperCase();
                const podMatch = !extractedPOD || !qPOD || qPOD === extractedPOD ||
                    qPOD.includes(extractedPOD) || extractedPOD.includes(qPOD);

                // Match pickup location (if both present)
                const qPickup = (q.pickupLocation || '').toUpperCase();
                const pickupMatch = !extractedPickup || !qPickup ||
                    qPickup.includes(extractedPickup) || extractedPickup.includes(qPickup);

                return podMatch && pickupMatch;
            }) || null;

            setOcrMatchedQuote(matchedQuote);
            setOcrOriginalDocument(ocrPreviewUrl);

            // If matched, pre-fill the company from the matched quote
            if (matchedQuote) {
                extractedQuote.companyId = matchedQuote.companyId;
            }

            setOcrReviewData(extractedQuote);
            setShowOcrModal(false);
            setShowOcrReview(true);

        } catch (err: any) {
            console.error("OCR Freight Quote processing failed:", err);
            setOcrError(`OCR failed: ${err.message || String(err)}`);
        } finally {
            setOcrProcessing(false);
        }
    }, [ocrFile, ocrPreviewUrl, currentCompanyId, quotes, ports]);

    const handleOcrReviewSave = () => {
        const companyIdForRecord = ocrReviewData.companyId || (currentCompanyId === 'ALL' ? '' : currentCompanyId);
        if (!companyIdForRecord) {
            alert("Please select a company before saving.");
            return;
        }

        // Determine status
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const finalRate = ocrReviewData.rate || 0;
        let isExpired = false;
        if (ocrReviewData.validUntil) {
            try {
                const parts = ocrReviewData.validUntil.split('-');
                const validUntilDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                isExpired = validUntilDate < today;
            } catch { /* ignore */ }
        }
        const status = (finalRate > 0 && !isExpired) ? 'ACTIVE' : (finalRate > 0 && isExpired) ? 'EXPIRED' : 'PENDING';

        const safeDbRecord = {
            id: ocrMatchedQuote ? ocrMatchedQuote.id : `FQ${Date.now()}`,
            company_id: companyIdForRecord,
            agent_name: ocrReviewData.agentName || '',
            carrier: ocrReviewData.carrier || '',
            freight_type: ocrReviewData.freightType || 'PORT_PORT',
            origin_port: ocrReviewData.originPort || '',
            origin_port_code: ocrReviewData.originPortCode || '',
            destination_port: ocrReviewData.destinationPort || '',
            destination_port_code: ocrReviewData.destinationPortCode || '',
            pickup_location: ocrReviewData.pickupLocation || '',
            pickup_zip: ocrReviewData.pickupZip || '',
            delivery_location: ocrReviewData.deliveryLocation || '',
            delivery_zip: ocrReviewData.deliveryZip || '',
            rate: finalRate,
            chassis: ocrReviewData.chassis || 0,
            overweight: ocrReviewData.overweight || 0,
            container_count: ocrReviewData.containerCount || 1,
            currency: ocrReviewData.currency || 'USD',
            valid_until: ocrReviewData.validUntil || '',
            comments: ocrReviewData.comments || '',
            transit_time: ocrReviewData.transitTime || 0,
            free_time: ocrReviewData.freeTime || 0,
            is_all_in: ocrReviewData.isAllIn ?? true,
            pickup_cost: ocrReviewData.pickupCost || 0,
            ocean_cost: ocrReviewData.oceanCost || 0,
            delivery_cost: ocrReviewData.deliveryCost || 0,
            port_fees: ocrReviewData.portFees || 0,
            deconsolidation: ocrReviewData.deconsolidation || 0,
            container_return: ocrReviewData.containerReturn || 0,
            bl_release: ocrReviewData.blRelease || 0,
            thc: ocrReviewData.thc || 0,
            isps: ocrReviewData.isps || 0,
            trs: ocrReviewData.trs || 0,
            security_fee: ocrReviewData.securityFee || 0,
            observation: ocrReviewData.observation || '',
            original_document: ocrOriginalDocument || '',
            status: status
        };

        if (ocrMatchedQuote) {
            onUpdate(safeDbRecord as any);
        } else {
            onAdd(safeDbRecord as any);
        }

        resetOcrReview();
        resetOcrModal();
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setFormError(null);

        const companyIdForNewRecord = formData.companyId || ((currentCompanyId === 'ALL' || isCargoAgentUser) ? '' : currentCompanyId);

        if (!companyIdForNewRecord) {
            setFormError("Please select a 'Assign to Company' value.");
            return;
        }

        const finalAgentName = isCargoAgentUser ? linkedAgentName : (formData.agentName || '');
        if (!finalAgentName) {
            setFormError("Cargo Agent is required.");
            return;
        }

        let finalRate = formData.rate || 0;
        if (!useAllIn) {
            finalRate = (formData.pickupCost || 0) + (formData.oceanCost || 0) + (formData.deliveryCost || 0) + (formData.portFees || 0) +
                (formData.deconsolidation || 0) + (formData.containerReturn || 0) + (formData.blRelease || 0) +
                (formData.thc || 0) + (formData.isps || 0) + (formData.trs || 0) + (formData.securityFee || 0);
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const parts = formData.validUntil!.split('-');
        const validUntilDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        const isExpired = validUntilDate < today;

        const status = (finalRate > 0 && !isExpired) ? 'ACTIVE' : (finalRate > 0 && isExpired) ? 'EXPIRED' : 'PENDING';

        const quoteData: FreightQuote = {
            id: editingId || `FQ${Date.now()}`,
            companyId: companyIdForNewRecord,
            agentName: finalAgentName,
            carrier: formData.carrier || '',
            freightType: formData.freightType || 'PORT_PORT',
            originPort: formData.originPort || '',
            originPortCode: formData.originPortCode || '',
            pickupLocation: formData.pickupLocation || '',
            pickupZip: formData.pickupZip || '',
            destinationPort: formData.destinationPort || '',
            destinationPortCode: formData.destinationPortCode || '',
            deliveryLocation: formData.deliveryLocation || '',
            deliveryZip: formData.deliveryZip || '',
            rate: finalRate,
            chassis: formData.chassis || 0,
            overweight: formData.overweight || 0,
            containerCount: formData.containerCount || 1,
            currency: formData.currency || 'USD',
            validUntil: formData.validUntil!,
            comments: formData.comments || '',
            transitTime: formData.transitTime || 0,
            freeTime: formData.freeTime || 0,
            isAllIn: useAllIn,
            pickupCost: useAllIn ? 0 : (formData.pickupCost || 0),
            oceanCost: useAllIn ? 0 : (formData.oceanCost || 0),
            deliveryCost: useAllIn ? 0 : (formData.deliveryCost || 0),
            portFees: useAllIn ? 0 : (formData.portFees || 0),
            deconsolidation: formData.deconsolidation || 0,
            containerReturn: formData.containerReturn || 0,
            blRelease: formData.blRelease || 0,
            thc: formData.thc || 0,
            isps: formData.isps || 0,
            trs: formData.trs || 0,
            securityFee: formData.securityFee || 0,
            observation: formData.observation || '',
            containerType: formData.containerType || '',
            status: status
        };

        // Prepare for DB (snake_case as expected by actual Supabase schema)
        // The schema.ts shows quoted camelCase, but actual DB uses snake_case
        const safeDbRecord = {
            id: quoteData.id,
            company_id: quoteData.companyId,
            agent_name: quoteData.agentName,
            carrier: quoteData.carrier,
            freight_type: quoteData.freightType,

            origin_port: quoteData.originPort,
            origin_port_code: quoteData.originPortCode,

            destination_port: quoteData.destinationPort,
            destination_port_code: quoteData.destinationPortCode,

            pickup_location: quoteData.pickupLocation,
            pickup_zip: quoteData.pickupZip,

            delivery_location: quoteData.deliveryLocation,
            delivery_zip: quoteData.deliveryZip,

            rate: quoteData.rate,
            chassis: quoteData.chassis,
            overweight: quoteData.overweight,
            container_count: quoteData.containerCount,
            currency: quoteData.currency,

            valid_until: quoteData.validUntil,
            comments: quoteData.comments,

            transit_time: quoteData.transitTime,
            free_time: quoteData.freeTime,
            is_all_in: quoteData.isAllIn,

            pickup_cost: quoteData.pickupCost,
            ocean_cost: quoteData.oceanCost,
            delivery_cost: quoteData.deliveryCost,
            port_fees: quoteData.portFees,

            deconsolidation: quoteData.deconsolidation,
            container_return: quoteData.containerReturn,
            bl_release: quoteData.blRelease,
            thc: quoteData.thc,
            isps: quoteData.isps,
            trs: quoteData.trs,
            security_fee: quoteData.securityFee,
            observation: quoteData.observation,
            container_type: quoteData.containerType || '',

            status: quoteData.status
        };

        // HACK: We pass 'any' to bypass TS check since onAdd expects FreightQuote
        // We separate ID from the payload for the update to ensure we don't try to update the PK column itself, 
        // essentially providing a clean "SET" payload.
        if (editingId) {
            const { id, ...updatePayload } = safeDbRecord;
            // We must pass an object that matches the shape expected by useSupabase's updateRecord
            // which uses .eq('id', record.id). So we actually DO need the ID in the object passed to the hook.
            // But valid Supabase update shouldn't fail on ID if it matches. 
            // The 400 is almost certainly missing columns.
            onUpdate(safeDbRecord as any);
        }
        else onAdd(safeDbRecord as any);

        setIsAdding(false);
        setFormData(initialFormState);
    };

    // Helper to find Port ID from Code to bind Select value
    const getPortId = (code?: string) => {
        if (!code) return '';
        const port = ports.find(p => p.code === code);
        return port ? port.id : '';
    };

    const getTypeLabel = (type?: string) => {
        switch (type) {
            case 'PORT_PORT': return 'Port to Port';
            case 'PORT_DOOR': return 'Port to Door';
            case 'DOOR_PORT': return 'Door to Port';
            case 'DOOR_DOOR': return 'Door to Door';
            default: return 'Port to Port';
        }
    };

    const [filterBtnPos, setFilterBtnPos] = useState<{ top: number, left: number } | null>(null);

    const renderColumnHeader = (id: keyof FreightQuote | null, label: string, widthKey: keyof typeof colWidths, align: 'left' | 'right' | 'center' = 'left') => {
        const uniqueValues = id ? getUniqueValues(visibleQuotes, id as string) : [];
        const activeValues = id ? (filters[id as string] || []) : [];
        const isFilterActive = activeValues.length > 0;

        const handleFilterBtnClick = (e: React.MouseEvent<HTMLButtonElement>) => {
            e.stopPropagation();
            if (activeFilterColumn === id) {
                setActiveFilterColumn(null);
                setFilterBtnPos(null);
            } else {
                setActiveFilterColumn(id as string);
                setFilterSearch('');
                const rect = e.currentTarget.getBoundingClientRect();
                setFilterBtnPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - 256) });
            }
        };

        return (
            <th
                className="px-4 py-3 bg-slate-50 border-b border-r border-slate-200 text-xs font-bold text-slate-600 uppercase tracking-wider relative group select-none"
                style={{ width: colWidths[widthKey], minWidth: colWidths[widthKey] }}
            >
                <div className={`flex items-center gap-2 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-between'}`}>
                    <span>{label}</span>
                    {id && (
                        <button
                            onClick={handleFilterBtnClick}
                            className={`p-1 rounded hover:bg-slate-200 transition-colors ${isFilterActive ? 'text-blue-600 bg-blue-50' : 'text-slate-400 opacity-0 group-hover:opacity-100'}`}
                        >
                            <Filter size={14} fill={isFilterActive ? "currentColor" : "none"} />
                        </button>
                    )}
                </div>

                {/* Filter Dropdown - rendered via portal to escape overflow containers */}
                {id && activeFilterColumn === id && filterBtnPos && ReactDOM.createPortal(
                    <div ref={filterMenuRef} className="fixed w-64 bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden text-left font-sans normal-case" style={{ top: filterBtnPos.top, left: filterBtnPos.left, zIndex: 9999 }}>
                        <div className="p-2 border-b border-slate-100">
                            <div className="relative">
                                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    className="w-full pl-8 pr-2 py-1.5 text-xs border border-slate-200 rounded bg-slate-50 outline-none focus:ring-1 focus:ring-blue-500"
                                    placeholder="Search..."
                                    value={filterSearch}
                                    onChange={e => setFilterSearch(e.target.value)}
                                    autoFocus
                                />
                            </div>
                        </div>
                        <div className="max-h-48 overflow-y-auto p-1 custom-scrollbar">
                            <button
                                onClick={() => clearColumnFilter(id as string)}
                                className="w-full text-left px-2 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded flex items-center gap-2"
                            >
                                <X size={12} /> Clear Filter
                            </button>
                            {uniqueValues.filter(v => String(v).toLowerCase().includes(filterSearch.toLowerCase())).map(val => (
                                <button
                                    key={String(val)}
                                    onClick={() => toggleFilter(id as string, String(val))}
                                    className="w-full text-left px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded flex items-center gap-2"
                                >
                                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${activeValues.includes(String(val)) ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'}`}>
                                        {activeValues.includes(String(val)) && <CheckCircle2 size={10} className="text-white" />}
                                    </div>
                                    <span className="truncate">{String(val)}</span>
                                </button>
                            ))}
                        </div>
                    </div>,
                    document.body
                )}

                {/* Resize Handle */}
                <div
                    onMouseDown={(e) => startResize(e, widthKey)}
                    className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300 z-10"
                />
            </th>
        );
    };

    return (
        <div className="space-y-6">
            {/* Header Row */}
            <div className="mb-6 flex items-start justify-between">
                <div className="flex items-center gap-4">
                    <div className="p-2 bg-gradient-to-r from-orange-500 to-amber-500 rounded-xl text-white">
                        <Ship size={24} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">Freight Quotes</h1>
                        <p className="text-slate-500 text-sm">
                            {isCargoAgentUser
                                ? `Managing Quotes for: ${linkedAgentName}`
                                : "Manage logistics cost estimates from cargo agents."}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={handleOpenSendQuote} className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-all shadow-md font-medium">
                        <Send size={18} /> Send Quote
                    </button>
                    <button onClick={() => setShowOcrModal(true)} className="flex items-center gap-2 px-5 py-2.5 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-all shadow-md font-medium">
                        <ScanEye size={18} /> OCR Upload
                    </button>
                    <button onClick={handleAddNew} className="flex items-center gap-2 px-5 py-2.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-all shadow-md font-medium">
                        <Plus size={18} /> Input Quote
                    </button>
                </div>
            </div>

            {/* Search & View Toggle Row */}
            <div className="flex items-center gap-2 mb-4">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                        type="text"
                        placeholder="Global Search..."
                        className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 outline-none"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="bg-white border border-slate-200 rounded-lg p-1 flex gap-1">
                    <button
                        onClick={() => setViewMode('grid')}
                        className={`p-2 rounded transition-all ${viewMode === 'grid' ? 'bg-slate-100 text-orange-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        title="Grid View"
                    >
                        <LayoutGrid size={18} />
                    </button>
                    <button
                        onClick={() => setViewMode('table')}
                        className={`p-2 rounded transition-all ${viewMode === 'table' ? 'bg-slate-100 text-orange-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        title="Table View"
                    >
                        <List size={18} />
                    </button>
                </div>
            </div>

            {dbError && (
                <div className="bg-red-50 text-red-600 p-4 rounded-xl flex items-start gap-3 border border-red-100 animate-in fade-in">
                    <AlertCircle size={20} className="mt-0.5 shrink-0" />
                    <div><p className="font-bold text-sm">Database Error</p><p className="text-xs mt-1 opacity-90">{dbError}</p></div>
                </div>
            )}


            {/* Main Content Area */}
            {viewMode === 'grid' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredQuotes.map(quote => (
                        <div key={quote.id} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow group relative">
                            <div className="flex justify-between items-start mb-4">
                                <div className="flex items-center gap-4">
                                    <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
                                        <Ship size={24} />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-slate-800 text-lg">{quote.agentName}</h4>
                                        <p className="text-sm text-slate-500 font-medium">Carrier: {quote.carrier}</p>
                                    </div>
                                </div>
                                <div className="text-right flex flex-col items-end">
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded mb-1 border ${getStatusStyling(quote.status)}`}>
                                        {quote.status}
                                    </span>
                                    <p className="text-2xl font-bold text-emerald-600">${quote.rate.toLocaleString()}</p>
                                    {quote.isAllIn === false && <span className="text-[10px] bg-slate-100 text-slate-500 px-1 rounded">Split Cost</span>}
                                </div>
                            </div>

                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 relative overflow-hidden">
                                {/* Type Badge */}
                                <div className="absolute top-0 right-0 bg-blue-100 text-blue-700 text-[10px] px-2 py-0.5 font-bold rounded-bl-lg border-l border-b border-blue-200">
                                    {getTypeLabel(quote.freightType)}
                                </div>

                                <div className="flex items-center justify-between mt-2">
                                    <div className="flex-1 text-center">
                                        <span className="block text-lg font-bold text-slate-700">{quote.originPortCode || 'POA'}</span>
                                        <span className="text-xs text-slate-500">{quote.originPort}</span>
                                        {quote.pickupLocation && (
                                            <p className="text-[10px] text-slate-400 mt-1 truncate max-w-[150px] mx-auto bg-white px-1 rounded border border-slate-200">
                                                <span className="font-bold">PU:</span> {formatAddress(quote.pickupLocation)}
                                            </p>
                                        )}
                                    </div>
                                    <div className="px-4 text-slate-300"><ArrowRight size={20} /></div>
                                    <div className="flex-1 text-center">
                                        <span className="block text-lg font-bold text-slate-700">{quote.destinationPortCode || 'POD'}</span>
                                        <span className="text-xs text-slate-500">{quote.destinationPort}</span>
                                        {quote.deliveryLocation && (
                                            <p className="text-[10px] text-slate-400 mt-1 truncate max-w-[150px] mx-auto bg-white px-1 rounded border border-slate-200">
                                                <span className="font-bold">DEL:</span> {formatAddress(quote.deliveryLocation)}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="mt-3 flex justify-between items-center px-1">
                                <div className="flex gap-3 text-xs text-slate-500">
                                    {quote.transitTime ? <span className="flex items-center gap-1" title="Transit Time"><Clock size={12} /> {quote.transitTime} days</span> : null}
                                    {quote.freeTime ? <span className="flex items-center gap-1" title="Free Time"><CalendarClock size={12} /> {quote.freeTime} days FT</span> : null}
                                </div>
                                <div className="flex gap-2">
                                    {quote.chassis && quote.chassis > 0 && <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200">Chassis: ${quote.chassis}</span>}
                                    {quote.overweight && quote.overweight > 0 && <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200">Over: ${quote.overweight}</span>}
                                </div>
                            </div>

                            <div className="flex justify-between items-center mt-4 text-xs text-slate-500 border-t border-slate-100 pt-3">
                                <span>Valid Until: {quote.validUntil}</span>
                                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={(e) => handleOpenRfqModal(quote, e)} className="text-slate-400 hover:text-emerald-500" title="Request Rate Quote"><DollarSign size={16} /></button>
                                    <button onClick={(e) => handleOpenBookingModal(quote, e)} className="text-slate-400 hover:text-orange-500" title="Request Booking"><Mail size={16} /></button>
                                    <button onClick={(e) => handleEdit(quote, e)} className="text-slate-400 hover:text-amber-500"><Pencil size={16} /></button>
                                    <button onClick={(e) => handleDelete(quote.id, e)} className="text-slate-400 hover:text-red-500"><Trash2 size={16} /></button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                // --- EXCEL-LIKE TABLE VIEW ---
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col h-full max-h-[calc(100vh-16rem)]">
                    <div className="overflow-auto custom-scrollbar flex-1">
                        <table className="min-w-full text-left border-collapse">
                            <thead className="bg-slate-50 sticky top-0 z-20 shadow-sm">
                                <tr>
                                    {renderColumnHeader('freightType', 'Service', 'service')}
                                    {renderColumnHeader('status', 'Status', 'status')}
                                    {renderColumnHeader('agentName', 'Agent', 'agent')}
                                    {renderColumnHeader('pickupLocation', 'Pick Up', 'pickup')}
                                    {renderColumnHeader('originPortCode', 'POA', 'origin')}
                                    {renderColumnHeader('originPort', 'POA NAME', 'poaName')}
                                    {renderColumnHeader('destinationPortCode', 'POD', 'dest')}
                                    {renderColumnHeader('destinationPort', 'POD NAME', 'pooName')}
                                    {renderColumnHeader(null, 'Rate ($)', 'rate', 'right')}
                                    {renderColumnHeader(null, 'TT / FT', 'time', 'right')}
                                    {renderColumnHeader(null, 'Validity', 'validity')}
                                    {renderColumnHeader(null, 'Actions', 'actions', 'right')}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredQuotes.map(quote => (
                                    <tr key={quote.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-2 py-0.5 border-r border-slate-100 text-xs whitespace-nowrap">
                                            <span className="font-bold bg-blue-50 text-blue-700 px-1 py-0 rounded border border-blue-100 text-[10px]">
                                                {getTypeLabel(quote.freightType)}
                                            </span>
                                        </td>
                                        <td className="px-2 py-0.5 border-r border-slate-100 text-xs whitespace-nowrap">
                                            <span className={`font-bold px-1 py-0 rounded border text-[10px] ${getStatusStyling(quote.status)}`}>
                                                {quote.status || 'PENDING'}
                                            </span>
                                        </td>
                                        <td className="px-2 py-0.5 border-r border-slate-100 text-xs font-medium text-slate-800 whitespace-nowrap" title={quote.agentName}>
                                            {quote.agentName}
                                        </td>
                                        <td className="px-2 py-0.5 border-r border-slate-100 text-xs text-slate-600 whitespace-nowrap">
                                            {(!quote.pickupLocation && !quote.pickupZip) ? (
                                                <span className="text-slate-400 italic text-[10px]">NA</span>
                                            ) : (
                                                <div className="flex items-center gap-1" title={quote.pickupLocation}>
                                                    <span>{formatAddress(quote.pickupLocation)}</span>
                                                    {quote.pickupZip && <span className="text-[10px] text-slate-400 shrink-0">({quote.pickupZip})</span>}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-2 py-0.5 border-r border-slate-100 text-xs font-mono text-slate-700 whitespace-nowrap" title={quote.originPort}>{quote.originPortCode || '-'}</td>
                                        <td className="px-2 py-0.5 border-r border-slate-100 text-xs text-slate-600 whitespace-nowrap" title={quote.originPort}>
                                            {quote.originPort ? (quote.originPort.length > 20 ? quote.originPort.substring(0, 20) + '…' : quote.originPort) : '-'}
                                        </td>
                                        <td className="px-2 py-0.5 border-r border-slate-100 text-xs font-mono text-slate-700 whitespace-nowrap" title={quote.destinationPort}>{quote.destinationPortCode || '-'}</td>
                                        <td className="px-2 py-0.5 border-r border-slate-100 text-xs text-slate-600 whitespace-nowrap" title={quote.destinationPort}>
                                            {quote.destinationPort ? (quote.destinationPort.length > 20 ? quote.destinationPort.substring(0, 20) + '…' : quote.destinationPort) : '-'}
                                        </td>

                                        <td className="px-2 py-0.5 border-r border-slate-100 text-right whitespace-nowrap">
                                            <span className="font-bold text-emerald-600 text-xs">${quote.rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                        </td>
                                        <td className="px-2 py-0.5 border-r border-slate-100 text-right text-[10px] text-slate-600 whitespace-nowrap">
                                            {quote.transitTime ? `${quote.transitTime}d` : '-'} / {quote.freeTime ? `${quote.freeTime}d` : '-'}
                                        </td>
                                        <td className="px-2 py-0.5 border-r border-slate-100 text-[10px] text-slate-500 whitespace-nowrap">
                                            {quote.validUntil}
                                        </td>
                                        <td className="px-2 py-0.5 text-right whitespace-nowrap">
                                            <div className="flex items-center justify-end gap-1">
                                                <button disabled={!quote.originalDocument} onClick={() => { if (quote.originalDocument) setViewDocumentUrl(quote.originalDocument); }} className={`p-0.5 ${quote.originalDocument ? 'text-blue-500 hover:text-blue-700' : 'text-slate-200 cursor-not-allowed'}`} title={quote.originalDocument ? 'View Document' : 'No document saved'}><Eye size={12} /></button>
                                                <button onClick={(e) => handleOpenRfqModal(quote, e)} className="text-slate-400 hover:text-emerald-500 p-0.5" title="Request Rate Quote"><DollarSign size={12} /></button>
                                                <button onClick={(e) => handleOpenBookingModal(quote, e)} className="text-slate-400 hover:text-orange-500 p-0.5" title="Request Booking"><Mail size={12} /></button>
                                                <button onClick={(e) => handleEdit(quote, e)} className="text-slate-400 hover:text-amber-500 p-0.5"><Pencil size={12} /></button>
                                                <button onClick={(e) => handleDelete(quote.id, e)} className="text-slate-400 hover:text-red-500 p-0.5"><Trash2 size={12} /></button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {filteredQuotes.length === 0 && (
                                    <tr>
                                        <td colSpan={10} className="px-6 py-12 text-center text-slate-400">
                                            No quotes found matching filters.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div className="bg-slate-50 border-t border-slate-200 p-2 text-xs text-slate-500 flex justify-between">
                        <span>Showing {filteredQuotes.length} quotes</span>
                        <span>Use column headers to filter</span>
                    </div>
                </div>
            )}

            {filteredQuotes.length === 0 && !isAdding && viewMode === 'grid' && (
                <div className="text-center py-12 text-slate-400 bg-white rounded-xl border border-dashed border-slate-200">
                    <Ship size={48} className="mx-auto mb-4 opacity-20" />
                    <p>No freight quotes available.</p>
                </div>
            )}

            {isAdding && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-in zoom-in-95">
                        {/* Header */}
                        <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-slate-50">
                            <h3 className="font-bold text-slate-800 text-xl flex items-center gap-2">
                                {editingId ? <Pencil size={20} className="text-blue-600" /> : <Plus size={20} className="text-blue-600" />}
                                {editingId ? 'Edit Freight Quote' : 'New Freight Quote'}
                            </h3>
                            <button onClick={() => setIsAdding(false)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
                        </div>

                        {/* Form Body */}
                        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                            {formError && (
                                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-center gap-2 border border-red-100">
                                    <AlertCircle size={16} /> {formError}
                                </div>
                            )}

                            {/* Company & Agent */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {(currentCompanyId === 'ALL' || isCargoAgentUser) && (
                                    <div>
                                        <label className="block text-xs font-bold text-blue-800 uppercase mb-1">Assign to Company</label>
                                        <select
                                            required
                                            value={formData.companyId}
                                            onChange={e => setFormData({ ...formData, companyId: e.target.value })}
                                            className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                                        >
                                            <option value="">Select Company...</option>
                                            {[...selectableCompanies].sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>
                                    </div>
                                )}

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cargo Agent</label>
                                    {isCargoAgentUser ? (
                                        <input className="w-full border border-slate-200 bg-slate-100 rounded-lg p-2 text-sm text-slate-500 cursor-not-allowed" value={linkedAgentName} readOnly />
                                    ) : (
                                        <select
                                            required
                                            value={formData.agentName}
                                            onChange={e => handleEntitySelect(e, 'agent')}
                                            className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                                        >
                                            <option value="">Select Agent...</option>
                                            <option value="_ADD_NEW_" className="font-bold text-blue-600">+ Add New Agent</option>
                                            {[...cargoAgents].sort((a, b) => a.name.localeCompare(b.name)).map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                                        </select>
                                    )}
                                </div>
                            </div>

                            {/* Service Type & Carrier */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Service Type</label>
                                    <select
                                        className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                                        value={formData.freightType}
                                        onChange={e => setFormData({ ...formData, freightType: e.target.value as any })}
                                    >
                                        <option value="PORT_PORT">Port to Port</option>
                                        <option value="PORT_DOOR">Port to Door</option>
                                        <option value="DOOR_PORT">Door to Port</option>
                                        <option value="DOOR_DOOR">Door to Door</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Carrier</label>
                                    <select
                                        className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                                        value={formData.carrier}
                                        onChange={e => handleEntitySelect(e, 'carrier')}
                                    >
                                        <option value="">Select Carrier...</option>
                                        <option value="_ADD_NEW_" className="font-bold text-blue-600">+ Add New Carrier</option>
                                        {[...carriers].sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                    </select>
                                </div>
                            </div>

                            {/* Route: Origin / Dest / Pickup / Delivery based on Type */}
                            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
                                <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1"><MapPin size={12} /> Route Details</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {(formData.freightType === 'DOOR_PORT' || formData.freightType === 'DOOR_DOOR') && (
                                        <div className="col-span-2 md:col-span-1 relative">
                                            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Pick Up</label>
                                            <div className="flex gap-1">
                                                <select className="w-8 border border-slate-300 rounded-l-lg bg-white p-1 text-xs" onChange={e => handleLocationSelect(e, 'pickup')}><option value="">Select</option><option value="_ADD_NEW_">+</option>{[...locations].sort((a, b) => a.name.localeCompare(b.name)).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
                                                <input className="flex-1 border border-slate-300 rounded-r-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="City or Zip" value={formData.pickupLocation} onChange={e => setFormData({ ...formData, pickupLocation: e.target.value })} onBlur={() => handleLocationLookup('pickup', 'city')} />
                                            </div>
                                            {isLocationLoading && <Loader2 size={12} className="absolute right-2 top-8 animate-spin text-slate-400" />}
                                        </div>
                                    )}

                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Port of Loading (Origin)</label>
                                        <select
                                            className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                            value={getPortId(formData.originPortCode)}
                                            onChange={e => handlePortSelect(e, 'origin')}
                                        >
                                            <option value="">Select Port...</option>
                                            <option value="_ADD_NEW_" className="font-bold text-blue-600">+ Add Port</option>
                                            {[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Port of Discharge (Dest)</label>
                                        <select
                                            className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                            value={getPortId(formData.destinationPortCode)}
                                            onChange={e => handlePortSelect(e, 'destination')}
                                        >
                                            <option value="">Select Port...</option>
                                            <option value="_ADD_NEW_" className="font-bold text-blue-600">+ Add Port</option>
                                            {[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
                                        </select>
                                    </div>

                                    {(formData.freightType === 'PORT_DOOR' || formData.freightType === 'DOOR_DOOR') && (
                                        <div className="col-span-2 md:col-span-1 relative">
                                            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Delivery Location</label>
                                            <div className="flex gap-1">
                                                <select className="w-8 border border-slate-300 rounded-l-lg bg-white p-1 text-xs" onChange={e => handleLocationSelect(e, 'delivery')}><option value="">Select</option><option value="_ADD_NEW_">+</option>{[...locations].sort((a, b) => a.name.localeCompare(b.name)).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
                                                <input className="flex-1 border border-slate-300 rounded-r-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="City or Zip" value={formData.deliveryLocation} onChange={e => setFormData({ ...formData, deliveryLocation: e.target.value })} onBlur={() => handleLocationLookup('delivery', 'city')} />
                                            </div>
                                            {isLocationLoading && <Loader2 size={12} className="absolute right-2 top-8 animate-spin text-slate-400" />}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Pricing */}
                            <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl space-y-4">
                                <div className="flex justify-between items-center">
                                    <h4 className="text-xs font-bold text-emerald-700 uppercase flex items-center gap-1"><DollarSign size={12} /> Pricing & Costs</h4>
                                    <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                                        <input type="checkbox" checked={useAllIn} onChange={e => setUseAllIn(e.target.checked)} className="rounded text-emerald-600 focus:ring-emerald-500" />
                                        <span className="font-bold text-slate-700">All-In Rate</span>
                                    </label>
                                </div>

                                {useAllIn ? (
                                    <div>
                                        <label className="block text-xs font-bold text-emerald-800 uppercase mb-1">Total Rate</label>
                                        <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                                            <input
                                                type="number"
                                                className="w-full pl-8 border border-emerald-200 rounded-lg p-2 text-lg font-bold text-emerald-700 focus:ring-2 focus:ring-emerald-500 outline-none"
                                                placeholder="0.00"
                                                value={formData.rate}
                                                onChange={e => handleComponentChange('rate', parseFloat(e.target.value))}
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 gap-4">
                                        <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Pickup Cost</label><FormattedInput value={formData.pickupCost || 0} onChange={v => handleComponentChange('pickupCost', v)} className="w-full border border-slate-300 rounded p-1.5 text-sm" /></div>
                                        <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Ocean Freight</label><FormattedInput value={formData.oceanCost || 0} onChange={v => handleComponentChange('oceanCost', v)} className="w-full border border-slate-300 rounded p-1.5 text-sm" /></div>
                                        <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Delivery Cost</label><FormattedInput value={formData.deliveryCost || 0} onChange={v => handleComponentChange('deliveryCost', v)} className="w-full border border-slate-300 rounded p-1.5 text-sm" /></div>
                                        <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Port/Doc Fees</label><FormattedInput value={formData.portFees || 0} onChange={v => handleComponentChange('portFees', v)} className="w-full border border-slate-300 rounded p-1.5 text-sm" /></div>
                                        <div className="col-span-2 pt-2 border-t border-emerald-200 flex justify-between items-center text-sm font-bold text-emerald-800">
                                            <span>Total Calculated Rate:</span>
                                            <span>${formData.rate?.toLocaleString()}</span>
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-3 gap-4 pt-2 border-t border-emerald-200">
                                    <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Currency</label><select className="w-full border border-slate-300 rounded p-1.5 text-sm bg-white" value={formData.currency} onChange={e => setFormData({ ...formData, currency: e.target.value })}><option>USD</option><option>EUR</option><option>CNY</option></select></div>
                                    <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Valid Until</label><input type="date" className="w-full border border-slate-300 rounded p-1.5 text-sm" value={formData.validUntil} onChange={e => setFormData({ ...formData, validUntil: e.target.value })} /></div>
                                </div>

                                {/* Extra Charges / Fees */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2 border-t border-emerald-200">
                                    <div className="col-span-full pb-1"><h5 className="text-[10px] font-bold text-emerald-700 uppercase">Additional Fees</h5></div>
                                    <div><label className="block text-[10px] font-bold text-slate-500 uppercase">THC</label><FormattedInput value={formData.thc || 0} onChange={v => handleComponentChange('thc', v)} className="w-full border border-slate-300 rounded p-1.5 text-sm" /></div>
                                    <div><label className="block text-[10px] font-bold text-slate-500 uppercase">ISPS</label><FormattedInput value={formData.isps || 0} onChange={v => handleComponentChange('isps', v)} className="w-full border border-slate-300 rounded p-1.5 text-sm" /></div>
                                    <div><label className="block text-[10px] font-bold text-slate-500 uppercase">B/L Release</label><FormattedInput value={formData.blRelease || 0} onChange={v => handleComponentChange('blRelease', v)} className="w-full border border-slate-300 rounded p-1.5 text-sm" /></div>
                                    <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Container Return</label><FormattedInput value={formData.containerReturn || 0} onChange={v => handleComponentChange('containerReturn', v)} className="w-full border border-slate-300 rounded p-1.5 text-sm" /></div>
                                    <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Deconsolidation</label><FormattedInput value={formData.deconsolidation || 0} onChange={v => handleComponentChange('deconsolidation', v)} className="w-full border border-slate-300 rounded p-1.5 text-sm" /></div>
                                    <div><label className="block text-[10px] font-bold text-slate-500 uppercase">TRS</label><FormattedInput value={formData.trs || 0} onChange={v => handleComponentChange('trs', v)} className="w-full border border-slate-300 rounded p-1.5 text-sm" /></div>
                                    <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Security Fee</label><FormattedInput value={formData.securityFee || 0} onChange={v => handleComponentChange('securityFee', v)} className="w-full border border-slate-300 rounded p-1.5 text-sm" /></div>
                                </div>
                            </div>

                            {/* Details */}
                            <div className="grid grid-cols-4 gap-4">
                                <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Transit Time (Days)</label><input type="number" className="w-full border border-slate-300 rounded p-2 text-sm" value={formData.transitTime} onChange={e => setFormData({ ...formData, transitTime: parseFloat(e.target.value) || 0 })} /></div>
                                <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Free Time (Days)</label><input type="number" className="w-full border border-slate-300 rounded p-2 text-sm" value={formData.freeTime} onChange={e => setFormData({ ...formData, freeTime: parseFloat(e.target.value) || 0 })} /></div>
                                <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Chassis ($)</label><input type="number" className="w-full border border-slate-300 rounded p-2 text-sm" value={formData.chassis} onChange={e => setFormData({ ...formData, chassis: parseFloat(e.target.value) || 0 })} /></div>
                                <div><label className="block text-[10px] font-bold text-slate-500 uppercase">Overweight ($)</label><input type="number" className="w-full border border-slate-300 rounded p-2 text-sm" value={formData.overweight} onChange={e => setFormData({ ...formData, overweight: parseFloat(e.target.value) || 0 })} /></div>
                            </div>

                            {/* Observation / Comments */}
                            <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Observation</label>
                                <textarea
                                    className="w-full border border-slate-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    rows={2}
                                    placeholder="Any observations..."
                                    value={formData.observation}
                                    onChange={e => setFormData({ ...formData, observation: e.target.value })}
                                />
                            </div>

                            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2">
                                <Save size={18} /> {editingId ? 'Update Quote' : 'Save Quote'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Quick Add Port */}
            {showQuickAddPort && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl max-sm w-full overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50"><h3 className="font-bold text-slate-800 flex items-center gap-2"><Anchor size={20} /> Quick Add Port</h3><button onClick={() => setShowQuickAddPort(false)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button></div>
                        <div className="p-6 space-y-4">
                            <div><input className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm uppercase font-mono mb-2" placeholder="Code (3-5 Letters)" maxLength={5} value={newPortCode} onChange={e => setNewPortCode(e.target.value.toUpperCase())} autoFocus /></div>
                            <div><input className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm mb-2" placeholder="Port Name" value={newPortName} onChange={e => setNewPortName(e.target.value)} /></div>
                            <div><input className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" placeholder="Country" value={newPortCountry} onChange={e => setNewPortCountry(e.target.value)} /></div>
                            <button onClick={handleQuickAddPort} disabled={!newPortCode || !newPortName} className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">Add & Select Port</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Quick Add Entity */}
            {showQuickAddEntity && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50"><h3 className="font-bold text-slate-800 flex items-center gap-2"><Truck size={20} /> New Partner</h3><button onClick={() => setShowQuickAddEntity(false)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button></div>
                        <div className="p-6 space-y-4">
                            <input className="w-full border border-slate-300 rounded-lg p-2 text-sm" placeholder="Company Name" value={newEntityName} onChange={e => setNewEntityName(e.target.value)} autoFocus />
                            <button onClick={handleQuickAddEntity} disabled={!newEntityName} className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">Add & Select</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Quick Add Location */}
            {showQuickAddLocation && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-lg border border-slate-200 w-80 space-y-3 p-6">
                        <div className="flex justify-between items-center mb-2"><h4 className="font-bold text-lg flex items-center gap-2"><MapPin size={20} /> New Location</h4><button onClick={() => setShowQuickAddLocation(false)}><X size={18} className="text-slate-400" /></button></div>
                        <input className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" placeholder="Location Name" value={newLocName} onChange={e => setNewLocName(e.target.value)} />
                        <input className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" placeholder="Address" value={newLocAddress} onChange={e => setNewLocAddress(e.target.value)} />
                        <div className="grid grid-cols-2 gap-2">
                            <input className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" placeholder="City" value={newLocCity} onChange={e => setNewLocCity(e.target.value)} />
                            <input className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" placeholder="State" value={newLocState} onChange={e => setNewLocState(e.target.value)} />
                        </div>
                        <input className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded p-2 text-sm" placeholder="Zip Code" value={newLocZip} onChange={e => setNewLocZip(e.target.value)} />
                        <button onClick={handleQuickAddLocation} disabled={!newLocName} className="w-full bg-blue-600 text-white font-bold py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 mt-2">Save Location</button>
                    </div>
                </div>
            )}

            {/* Booking Request Modal */}
            {bookingQuote && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className={`bg-white rounded-xl shadow-2xl w-full overflow-hidden animate-in zoom-in-95 duration-200 ${bookingStep === 'preview' ? 'max-w-2xl' : 'max-w-md'}`}>
                        <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-gradient-to-r from-orange-50 to-amber-50">
                            <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                                <Mail size={20} className="text-orange-600" /> {bookingStep === 'preview' ? 'Email Preview' : 'Request Booking'}
                            </h3>
                            <button onClick={() => { setBookingQuote(null); setBookingMessage(''); setBookingStep('input'); }} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            {bookingStep === 'input' ? (
                                <>
                                    {/* Quote Summary */}
                                    <div className="bg-slate-50 rounded-lg p-4 border border-slate-200 space-y-2 text-sm">
                                        <div className="flex justify-between"><span className="text-slate-500">Agent</span><span className="font-bold text-slate-800">{bookingQuote.agentName}</span></div>
                                        <div className="flex justify-between"><span className="text-slate-500">Route</span><span className="font-bold text-slate-700">{bookingQuote.originPortCode || 'POA'} → {bookingQuote.destinationPortCode || 'POD'}</span></div>
                                        <div className="flex justify-between"><span className="text-slate-500">Carrier</span><span className="text-slate-700">{bookingQuote.carrier || 'N/A'}</span></div>
                                        <div className="flex justify-between"><span className="text-slate-500">Rate</span><span className="font-bold text-emerald-600">${bookingQuote.rate?.toLocaleString()} {bookingQuote.currency || 'USD'}</span></div>
                                    </div>

                                    {/* Container Count Input */}
                                    <div>
                                        <label className="block text-xs font-bold text-slate-600 uppercase mb-2">Number of Containers</label>
                                        <input
                                            type="number"
                                            min={1}
                                            className="w-full border border-slate-300 rounded-lg p-3 text-lg font-bold text-center text-orange-700 focus:ring-2 focus:ring-orange-500 outline-none"
                                            value={bookingContainerCount}
                                            onChange={e => setBookingContainerCount(Math.max(1, parseInt(e.target.value) || 1))}
                                            autoFocus
                                        />
                                    </div>

                                    {/* Preview Button */}
                                    <button
                                        onClick={() => {
                                            const agent = cargoAgents.find(a => a.name === bookingQuote.agentName);
                                            if (!agent?.email) {
                                                setBookingMessage('❌ No email found for cargo agent "' + bookingQuote.agentName + '". Please add an email to this agent in the system.');
                                                return;
                                            }
                                            setBookingMessage('');
                                            setBookingStep('preview');
                                        }}
                                        className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
                                    >
                                        <Mail size={18} /> Preview Email
                                    </button>

                                    {/* Error Message */}
                                    {bookingMessage && (
                                        <div className="text-sm p-3 rounded-lg border bg-red-50 text-red-700 border-red-200">
                                            {bookingMessage}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <>
                                    {/* Email Header Info */}
                                    <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 text-xs space-y-1">
                                        <div className="flex gap-2"><span className="font-bold text-slate-500 w-10">To:</span><span className="text-slate-700">{cargoAgents.find(a => a.name === bookingQuote.agentName)?.email}</span></div>
                                        <div className="flex gap-2 items-start"><span className="font-bold text-slate-500 w-10 pt-1">CC:</span><div className="flex-1"><div className="flex flex-wrap gap-1 mb-1">{ccEmails.map((email, i) => (<span key={i} className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full text-[11px] border border-emerald-200">{email}<button type="button" onClick={() => setCcEmails(prev => prev.filter((_, idx) => idx !== i))} className="text-emerald-400 hover:text-red-500"><X size={10} /></button></span>))}</div><div className="flex gap-1"><input type="email" value={newCcEmail} onChange={e => setNewCcEmail(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newCcEmail.trim() && newCcEmail.includes('@')) { e.preventDefault(); setCcEmails(prev => [...prev, newCcEmail.trim()]); setNewCcEmail(''); } }} placeholder="Add CC email..." className="text-[11px] px-2 py-1 border border-slate-200 rounded-lg flex-1 outline-none focus:border-emerald-400" /><button type="button" onClick={() => { if (newCcEmail.trim() && newCcEmail.includes('@')) { setCcEmails(prev => [...prev, newCcEmail.trim()]); setNewCcEmail(''); } }} className="text-emerald-500 hover:text-emerald-700 px-1"><Plus size={14} /></button></div></div></div>
                                        <div className="flex gap-2"><span className="font-bold text-slate-500 w-10">Subj:</span><span className="text-slate-700 font-medium">{buildBookingSubject(bookingQuote, bookingContainerCount)}</span></div>
                                    </div>

                                    {/* Email Preview */}
                                    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                                        <iframe
                                            srcDoc={buildBookingEmailHtml(bookingQuote, bookingContainerCount)}
                                            className="w-full border-0"
                                            style={{ height: '380px' }}
                                            title="Email Preview"
                                        />
                                    </div>

                                    {/* Status Message */}
                                    {bookingMessage && (
                                        <div className={`text-sm p-3 rounded-lg border ${bookingMessage.startsWith('✅') ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                                            {bookingMessage}
                                        </div>
                                    )}

                                    {/* Action Buttons */}
                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => setBookingStep('input')}
                                            className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
                                        >
                                            ← Back
                                        </button>
                                        <button
                                            onClick={handleSendBookingRequest}
                                            disabled={bookingSending}
                                            className="flex-[2] bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
                                        >
                                            {bookingSending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                                            {bookingSending ? 'Sending...' : 'Send Booking Request'}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* RFQ (Rate Quote Request) Modal */}
            {rfqQuote && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className={`bg-white rounded-xl shadow-2xl w-full overflow-hidden animate-in zoom-in-95 duration-200 ${rfqStep === 'preview' ? 'max-w-2xl' : 'max-w-lg'}`}>
                        <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-green-50">
                            <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                                <DollarSign size={20} className="text-emerald-600" /> {rfqStep === 'preview' ? 'Email Preview' : 'Request Freight Rate'}
                            </h3>
                            <button onClick={() => { setRfqQuote(null); setRfqMessage(''); setRfqStep('select'); }} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            {/* Route Summary */}
                            <div className="bg-slate-50 rounded-lg p-4 border border-slate-200 space-y-2 text-sm">
                                <div className="flex justify-between"><span className="text-slate-500">Service</span><span className="font-bold text-slate-800">{rfqQuote.freightType?.replace(/_/g, ' to ') || 'Port to Port'}</span></div>
                                <div className="flex justify-between"><span className="text-slate-500">Route</span><span className="font-bold text-slate-700">{rfqQuote.originPortCode || 'POA'} → {rfqQuote.destinationPortCode || 'POD'}</span></div>
                                {rfqQuote.pickupLocation && <div className="flex justify-between"><span className="text-slate-500">Pickup</span><span className="text-slate-700">{rfqQuote.pickupLocation}</span></div>}
                                {rfqQuote.deliveryLocation && <div className="flex justify-between"><span className="text-slate-500">Delivery</span><span className="text-slate-700">{rfqQuote.deliveryLocation}</span></div>}
                            </div>

                            {rfqStep === 'select' ? (
                                <>
                                    {/* Agent Selection */}
                                    <div>
                                        <label className="block text-xs font-bold text-slate-600 uppercase mb-2">Select Cargo Agents</label>
                                        <div className="relative mb-2">
                                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                            <input
                                                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg bg-slate-50 outline-none focus:ring-2 focus:ring-emerald-500"
                                                placeholder="Search agents..."
                                                value={rfqAgentSearch}
                                                onChange={e => setRfqAgentSearch(e.target.value)}
                                                autoFocus
                                            />
                                        </div>
                                        <div className="flex gap-2 mb-2">
                                            <button
                                                onClick={() => setRfqSelectedAgents(new Set(cargoAgents.filter(a => a.email).map(a => a.id)))}
                                                className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 px-2 py-1 bg-emerald-50 rounded"
                                            >Select All</button>
                                            <button
                                                onClick={() => setRfqSelectedAgents(new Set())}
                                                className="text-[10px] font-bold text-slate-500 hover:text-slate-700 px-2 py-1 bg-slate-100 rounded"
                                            >Clear All</button>
                                            <span className="text-[10px] text-slate-400 ml-auto self-center">{rfqSelectedAgents.size} selected</span>
                                        </div>
                                        <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 custom-scrollbar">
                                            {cargoAgents
                                                .filter(a => a.name.toLowerCase().includes(rfqAgentSearch.toLowerCase()) || (a.email || '').toLowerCase().includes(rfqAgentSearch.toLowerCase()))
                                                .map(agent => (
                                                    <button
                                                        key={agent.id}
                                                        onClick={() => agent.email ? toggleRfqAgent(agent.id) : null}
                                                        className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors ${agent.email ? 'hover:bg-emerald-50 cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}
                                                    >
                                                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${rfqSelectedAgents.has(agent.id) ? 'bg-emerald-600 border-emerald-600' : 'border-slate-300 bg-white'
                                                            }`}>
                                                            {rfqSelectedAgents.has(agent.id) && <CheckCircle2 size={10} className="text-white" />}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="text-sm font-medium text-slate-800 truncate">{agent.name}</div>
                                                            <div className="text-[10px] text-slate-400 truncate">{agent.email || 'No email — cannot send'}</div>
                                                        </div>
                                                    </button>
                                                ))}
                                            {cargoAgents.length === 0 && (
                                                <div className="p-4 text-center text-xs text-slate-400">No cargo agents found. Add agents in Cargo Agents page.</div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Preview Button */}
                                    <button
                                        onClick={() => {
                                            if (rfqSelectedAgents.size === 0) {
                                                setRfqMessage('❌ Please select at least one cargo agent.');
                                                return;
                                            }
                                            setRfqMessage('');
                                            setRfqStep('preview');
                                        }}
                                        disabled={rfqSelectedAgents.size === 0}
                                        className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
                                    >
                                        <Mail size={18} /> Preview Email ({rfqSelectedAgents.size} agent{rfqSelectedAgents.size !== 1 ? 's' : ''})
                                    </button>

                                    {rfqMessage && (
                                        <div className="text-sm p-3 rounded-lg border bg-red-50 text-red-700 border-red-200">{rfqMessage}</div>
                                    )}
                                </>
                            ) : (
                                <>
                                    {/* Email Header Info */}
                                    <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 text-xs space-y-1">
                                        <div className="flex gap-2"><span className="font-bold text-slate-500 w-10">To:</span><span className="text-slate-700">{Array.from(rfqSelectedAgents).map(id => { const a = cargoAgents.find(x => x.id === id); return a ? `${a.name} <${a.email}>` : id; }).join(', ')}</span></div>
                                        <div className="flex gap-2 items-start"><span className="font-bold text-slate-500 w-10 pt-1">CC:</span><div className="flex-1"><div className="flex flex-wrap gap-1 mb-1">{ccEmails.map((email, i) => (<span key={i} className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full text-[11px] border border-emerald-200">{email}<button type="button" onClick={() => setCcEmails(prev => prev.filter((_, idx) => idx !== i))} className="text-emerald-400 hover:text-red-500"><X size={10} /></button></span>))}</div><div className="flex gap-1"><input type="email" value={newCcEmail} onChange={e => setNewCcEmail(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newCcEmail.trim() && newCcEmail.includes('@')) { e.preventDefault(); setCcEmails(prev => [...prev, newCcEmail.trim()]); setNewCcEmail(''); } }} placeholder="Add CC email..." className="text-[11px] px-2 py-1 border border-slate-200 rounded-lg flex-1 outline-none focus:border-emerald-400" /><button type="button" onClick={() => { if (newCcEmail.trim() && newCcEmail.includes('@')) { setCcEmails(prev => [...prev, newCcEmail.trim()]); setNewCcEmail(''); } }} className="text-emerald-500 hover:text-emerald-700 px-1"><Plus size={14} /></button></div></div></div>
                                        <div className="flex gap-2"><span className="font-bold text-slate-500 w-10">Subj:</span><span className="text-slate-700 font-medium">{buildRfqSubject(rfqQuote)}</span></div>
                                        <div className="text-[10px] text-slate-400 mt-1">📧 One individual email will be sent per agent ({rfqSelectedAgents.size} email{rfqSelectedAgents.size !== 1 ? 's' : ''})</div>
                                    </div>

                                    {/* Email Preview */}
                                    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                                        <iframe
                                            srcDoc={buildRfqEmailHtml(rfqQuote, '[Agent Name]')}
                                            className="w-full border-0"
                                            style={{ height: '320px' }}
                                            title="RFQ Email Preview"
                                        />
                                    </div>

                                    {/* Status Message */}
                                    {rfqMessage && (
                                        <div className={`text-sm p-3 rounded-lg border ${rfqMessage.startsWith('✅') ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                                            {rfqMessage}
                                        </div>
                                    )}

                                    {/* Action Buttons */}
                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => setRfqStep('select')}
                                            className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
                                        >
                                            ← Back
                                        </button>
                                        <button
                                            onClick={handleSendRfqEmails}
                                            disabled={rfqSending}
                                            className="flex-[2] bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
                                        >
                                            {rfqSending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                                            {rfqSending ? 'Sending...' : `Send to ${rfqSelectedAgents.size} Agent${rfqSelectedAgents.size !== 1 ? 's' : ''}`}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Send Quote Modal ────────────────────────────────────── */}
            {sendQuoteOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className={`bg-white rounded-xl shadow-2xl w-full overflow-hidden animate-in zoom-in-95 duration-200 ${sendQuoteStep === 'preview' ? 'max-w-2xl' : 'max-w-lg'}`}>
                        <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-teal-50">
                            <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                                <Send size={20} className="text-emerald-600" /> {sendQuoteStep === 'preview' ? 'Email Preview' : 'Send Quote Request'}
                            </h3>
                            <button onClick={() => { setSendQuoteOpen(false); setSendQuoteMessage(''); setSendQuoteStep('route'); }} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
                        </div>
                        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto custom-scrollbar">
                            {sendQuoteStep === 'route' ? (
                                <>
                                    {/* Route Selection */}
                                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
                                        <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1"><MapPin size={12} /> Route Details</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Service Type</label>
                                                <select
                                                    className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                                                    value={sendQuoteFreightType}
                                                    onChange={e => setSendQuoteFreightType(e.target.value)}
                                                >
                                                    <option value="PORT_PORT">Port to Port</option>
                                                    <option value="PORT_DOOR">Port to Door</option>
                                                    <option value="DOOR_PORT">Door to Port</option>
                                                    <option value="DOOR_DOOR">Door to Door</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Equipment</label>
                                                <select
                                                    className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                                                    value={sendQuoteContainerType}
                                                    onChange={e => setSendQuoteContainerType(e.target.value)}
                                                >
                                                    <option value="20DC">20' Dry</option>
                                                    <option value="40DC">40' Dry</option>
                                                    <option value="40HC">40' HC</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Port of Loading (Origin)</label>
                                                <select
                                                    className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                                                    value={sendQuoteOriginPort}
                                                    onChange={e => setSendQuoteOriginPort(e.target.value)}
                                                >
                                                    <option value="">Select Port...</option>
                                                    {[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Port of Discharge (Dest)</label>
                                                <select
                                                    className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 outline-none"
                                                    value={sendQuoteDestPort}
                                                    onChange={e => setSendQuoteDestPort(e.target.value)}
                                                >
                                                    <option value="">Select Port...</option>
                                                    {[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
                                                </select>
                                            </div>
                                        </div>
                                        {(sendQuoteFreightType === 'DOOR_PORT' || sendQuoteFreightType === 'DOOR_DOOR') && (
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Pick Up Location</label>
                                                <input className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="City or Address" value={sendQuotePickup} onChange={e => setSendQuotePickup(e.target.value)} />
                                            </div>
                                        )}
                                        {(sendQuoteFreightType === 'PORT_DOOR' || sendQuoteFreightType === 'DOOR_DOOR') && (
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Delivery Location</label>
                                                <input className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="City or Address" value={sendQuoteDelivery} onChange={e => setSendQuoteDelivery(e.target.value)} />
                                            </div>
                                        )}
                                    </div>

                                    {/* Agent Selection */}
                                    <div>
                                        <label className="block text-xs font-bold text-slate-600 uppercase mb-2">Select Cargo Agents</label>
                                        <div className="relative mb-2">
                                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                            <input
                                                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg bg-slate-50 outline-none focus:ring-2 focus:ring-emerald-500"
                                                placeholder="Search agents..."
                                                value={sendQuoteAgentSearch}
                                                onChange={e => setSendQuoteAgentSearch(e.target.value)}
                                            />
                                        </div>
                                        <div className="flex gap-2 mb-2">
                                            <button
                                                onClick={() => setSendQuoteSelectedAgents(new Set(cargoAgents.filter(a => a.email).map(a => a.id)))}
                                                className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 px-2 py-1 bg-emerald-50 rounded"
                                            >Select All</button>
                                            <button
                                                onClick={() => setSendQuoteSelectedAgents(new Set())}
                                                className="text-[10px] font-bold text-slate-500 hover:text-slate-700 px-2 py-1 bg-slate-100 rounded"
                                            >Clear All</button>
                                            <span className="text-[10px] text-slate-400 ml-auto self-center">{sendQuoteSelectedAgents.size} selected</span>
                                        </div>
                                        <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 custom-scrollbar">
                                            {cargoAgents
                                                .filter(a => a.name.toLowerCase().includes(sendQuoteAgentSearch.toLowerCase()) || (a.email || '').toLowerCase().includes(sendQuoteAgentSearch.toLowerCase()))
                                                .map(agent => (
                                                    <button
                                                        key={agent.id}
                                                        onClick={() => agent.email ? toggleSendQuoteAgent(agent.id) : null}
                                                        className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors ${agent.email ? 'hover:bg-emerald-50 cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}
                                                    >
                                                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${sendQuoteSelectedAgents.has(agent.id) ? 'bg-emerald-600 border-emerald-600' : 'border-slate-300 bg-white'}`}>
                                                            {sendQuoteSelectedAgents.has(agent.id) && <CheckCircle2 size={10} className="text-white" />}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="text-sm font-medium text-slate-800 truncate">{agent.name}</div>
                                                            <div className="text-[10px] text-slate-400 truncate">{agent.email || 'No email — cannot send'}</div>
                                                        </div>
                                                    </button>
                                                ))}
                                            {cargoAgents.length === 0 && (
                                                <div className="p-4 text-center text-xs text-slate-400">No cargo agents found. Add agents in Cargo Agents page.</div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Preview Button */}
                                    <button
                                        onClick={() => {
                                            if (!sendQuoteOriginPort || !sendQuoteDestPort) {
                                                setSendQuoteMessage('❌ Please select both origin and destination ports.');
                                                return;
                                            }
                                            if (sendQuoteSelectedAgents.size === 0) {
                                                setSendQuoteMessage('❌ Please select at least one cargo agent.');
                                                return;
                                            }
                                            setSendQuoteMessage('');
                                            setSendQuoteStep('preview');
                                        }}
                                        disabled={sendQuoteSelectedAgents.size === 0 || !sendQuoteOriginPort || !sendQuoteDestPort}
                                        className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
                                    >
                                        <Mail size={18} /> Preview Email ({sendQuoteSelectedAgents.size} agent{sendQuoteSelectedAgents.size !== 1 ? 's' : ''})
                                    </button>

                                    {sendQuoteMessage && (
                                        <div className="text-sm p-3 rounded-lg border bg-red-50 text-red-700 border-red-200">{sendQuoteMessage}</div>
                                    )}
                                </>
                            ) : (
                                <>
                                    {/* Route Summary */}
                                    <div className="bg-slate-50 rounded-lg p-4 border border-slate-200 space-y-2 text-sm">
                                        <div className="flex justify-between"><span className="text-slate-500">Service</span><span className="font-bold text-slate-800">{sendQuoteFreightType.replace(/_/g, ' to ')}</span></div>
                                        <div className="flex justify-between"><span className="text-slate-500">Route</span><span className="font-bold text-slate-700">{getSendQuoteOriginInfo().code || 'POA'} → {getSendQuoteDestInfo().code || 'POD'}</span></div>
                                        {sendQuotePickup && <div className="flex justify-between"><span className="text-slate-500">Pickup</span><span className="text-slate-700">{sendQuotePickup}</span></div>}
                                        {sendQuoteDelivery && <div className="flex justify-between"><span className="text-slate-500">Delivery</span><span className="text-slate-700">{sendQuoteDelivery}</span></div>}
                                    </div>

                                    {/* Email Header Info */}
                                    <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 text-xs space-y-1">
                                        <div className="flex gap-2"><span className="font-bold text-slate-500 w-10">To:</span><span className="text-slate-700">{Array.from(sendQuoteSelectedAgents).map(id => { const a = cargoAgents.find(x => x.id === id); return a ? `${a.name} <${a.email}>` : id; }).join(', ')}</span></div>
                                        <div className="flex gap-2 items-start"><span className="font-bold text-slate-500 w-10 pt-1">CC:</span><div className="flex-1"><div className="flex flex-wrap gap-1 mb-1">{ccEmails.map((email, i) => (<span key={i} className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full text-[11px] border border-emerald-200">{email}<button type="button" onClick={() => setCcEmails(prev => prev.filter((_, idx) => idx !== i))} className="text-emerald-400 hover:text-red-500"><X size={10} /></button></span>))}</div><div className="flex gap-1"><input type="email" value={newCcEmail} onChange={e => setNewCcEmail(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newCcEmail.trim() && newCcEmail.includes('@')) { e.preventDefault(); setCcEmails(prev => [...prev, newCcEmail.trim()]); setNewCcEmail(''); } }} placeholder="Add CC email..." className="text-[11px] px-2 py-1 border border-slate-200 rounded-lg flex-1 outline-none focus:border-emerald-400" /><button type="button" onClick={() => { if (newCcEmail.trim() && newCcEmail.includes('@')) { setCcEmails(prev => [...prev, newCcEmail.trim()]); setNewCcEmail(''); } }} className="text-emerald-500 hover:text-emerald-700 px-1"><Plus size={14} /></button></div></div></div>
                                        <div className="flex gap-2"><span className="font-bold text-slate-500 w-10">Subj:</span><span className="text-slate-700 font-medium">{buildSendQuoteSubject()}</span></div>
                                        <div className="text-[10px] text-slate-400 mt-1">📧 One individual email will be sent per agent ({sendQuoteSelectedAgents.size} email{sendQuoteSelectedAgents.size !== 1 ? 's' : ''}) + {sendQuoteSelectedAgents.size} PENDING quote(s) will be created</div>
                                    </div>

                                    {/* Email Preview */}
                                    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                                        <iframe
                                            srcDoc={buildSendQuoteEmailHtml('[Agent Name]')}
                                            className="w-full border-0"
                                            style={{ height: '320px' }}
                                            title="Send Quote Email Preview"
                                        />
                                    </div>

                                    {/* Status Message */}
                                    {sendQuoteMessage && (
                                        <div className={`text-sm p-3 rounded-lg border ${sendQuoteMessage.startsWith('✅') ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                                            {sendQuoteMessage}
                                        </div>
                                    )}

                                    {/* Action Buttons */}
                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => setSendQuoteStep('route')}
                                            className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
                                        >
                                            ← Back
                                        </button>
                                        <button
                                            onClick={handleSendQuoteEmails}
                                            disabled={sendQuoteSending}
                                            className="flex-[2] bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
                                        >
                                            {sendQuoteSending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                                            {sendQuoteSending ? 'Sending...' : `Send to ${sendQuoteSelectedAgents.size} Agent${sendQuoteSelectedAgents.size !== 1 ? 's' : ''}`}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ─── OCR Upload Modal ─────────────────────────────────────── */}
            {showOcrModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col animate-in zoom-in-95">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-purple-50 to-indigo-50">
                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                <Sparkles size={20} className="text-purple-600" />
                                OCR Freight Quote Upload
                            </h3>
                            <button onClick={resetOcrModal} className="text-slate-400 hover:text-slate-600">
                                <X size={24} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            {/* Drag Drop Zone */}
                            <div
                                onDragEnter={handleOcrDrag}
                                onDragLeave={handleOcrDrag}
                                onDragOver={handleOcrDrag}
                                onDrop={handleOcrDrop}
                                onClick={() => ocrFileInputRef.current?.click()}
                                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${ocrDragActive
                                    ? 'border-purple-500 bg-purple-50'
                                    : ocrFile
                                        ? 'border-green-400 bg-green-50'
                                        : 'border-slate-300 hover:border-purple-400 hover:bg-purple-50/50'
                                    }`}
                            >
                                <input
                                    ref={ocrFileInputRef}
                                    type="file"
                                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                                    onChange={handleOcrFileSelect}
                                    className="hidden"
                                />
                                {ocrFile ? (
                                    <div className="space-y-2">
                                        <CheckCircle2 size={48} className="mx-auto text-green-500" />
                                        <p className="font-bold text-green-700">{ocrFile.name}</p>
                                        <p className="text-xs text-slate-500">{(ocrFile.size / 1024).toFixed(1)} KB</p>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        <UploadCloud size={48} className="mx-auto text-purple-400" />
                                        <p className="text-slate-600 font-medium">
                                            Drag & drop a Freight Quote PDF or image here
                                        </p>
                                        <p className="text-xs text-slate-400">or click to browse</p>
                                        <p className="text-[10px] text-slate-400 mt-2">
                                            Supports: PDF, JPEG, PNG, WebP (max 10MB)
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Error */}
                            {ocrError && (
                                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                                    {ocrError}
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={resetOcrModal}
                                    className="flex-1 px-4 py-2.5 border border-slate-300 rounded-lg text-slate-600 font-medium hover:bg-slate-50 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={processOcrFreightQuote}
                                    disabled={!ocrFile || ocrProcessing}
                                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-bold transition-all ${!ocrFile || ocrProcessing
                                        ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                        : 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700 shadow-md hover:shadow-lg'
                                        }`}
                                >
                                    {ocrProcessing ? (
                                        <>
                                            <Loader2 size={18} className="animate-spin" />
                                            Processing...
                                        </>
                                    ) : (
                                        <>
                                            <ScanEye size={18} />
                                            Extract & Review
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── OCR Review Modal ─────────────────────────────────────── */}
            {showOcrReview && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col animate-in zoom-in-95">
                        <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-purple-50 to-indigo-50">
                            <div>
                                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                    <ScanEye size={20} className="text-purple-600" />
                                    Review Extracted Freight Quote
                                </h3>
                                <div className="flex items-center gap-3 mt-1">
                                    {ocrDetectedLanguage && ocrDetectedLanguage.toLowerCase() !== 'english' && (
                                        <span className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                                            <Globe size={12} />
                                            {ocrDetectedLanguage} → Translated to English
                                        </span>
                                    )}
                                    {ocrDetectedLanguage && ocrDetectedLanguage.toLowerCase() === 'english' && (
                                        <span className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">
                                            <Globe size={12} />
                                            English
                                        </span>
                                    )}
                                    {ocrMatchedQuote && (
                                        <span className="inline-flex items-center gap-1 text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">
                                            <CheckCircle2 size={12} />
                                            Matched to pending quote: {ocrMatchedQuote.id}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <button onClick={resetOcrReview} className="text-slate-400 hover:text-slate-600">
                                <X size={24} />
                            </button>
                        </div>
                        <div className="p-5 overflow-y-auto custom-scrollbar space-y-4">
                            {/* Company Selector */}
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Assign to Company</label>
                                <select
                                    value={ocrReviewData.companyId || ''}
                                    onChange={e => setOcrReviewData(prev => ({ ...prev, companyId: e.target.value }))}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                                >
                                    <option value="">Select Company...</option>
                                    {[...selectableCompanies].sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>

                            {/* Row 1: Agent, Carrier, Freight Type */}
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Cargo Agent</label>
                                    <select
                                        value={ocrReviewData.agentName || ''}
                                        onChange={e => setOcrReviewData(prev => ({ ...prev, agentName: e.target.value }))}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                    >
                                        <option value="">Select...</option>
                                        {[...cargoAgents].sort((a, b) => a.name.localeCompare(b.name)).map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Carrier</label>
                                    <select
                                        value={ocrReviewData.carrier || ''}
                                        onChange={e => setOcrReviewData(prev => ({ ...prev, carrier: e.target.value }))}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                    >
                                        <option value="">Select...</option>
                                        {[...carriers].sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Freight Type</label>
                                    <select
                                        value={ocrReviewData.freightType || 'PORT_PORT'}
                                        onChange={e => setOcrReviewData(prev => ({ ...prev, freightType: e.target.value as FreightQuote['freightType'] }))}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                    >
                                        <option value="PORT_PORT">Port to Port</option>
                                        <option value="PORT_DOOR">Port to Door</option>
                                        <option value="DOOR_PORT">Door to Port</option>
                                        <option value="DOOR_DOOR">Door to Door</option>
                                    </select>
                                </div>
                            </div>

                            {/* Row 2: Origin Port, Destination Port */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Origin Port</label>
                                    <div className="flex gap-2">
                                        <select
                                            value={getPortId(ocrReviewData.originPortCode)}
                                            onChange={e => {
                                                const port = ports.find(p => p.id === e.target.value);
                                                if (port) setOcrReviewData(prev => ({ ...prev, originPort: port.name, originPortCode: port.code }));
                                            }}
                                            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                        >
                                            <option value="">Select Port...</option>
                                            {[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
                                        </select>
                                        <input
                                            value={ocrReviewData.originPortCode || ''}
                                            onChange={e => setOcrReviewData(prev => ({ ...prev, originPortCode: e.target.value.toUpperCase() }))}
                                            className="w-24 border border-slate-300 rounded-lg px-2 py-2 text-sm font-mono text-center"
                                            placeholder="Code"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Destination Port (POD)</label>
                                    <div className="flex gap-2">
                                        <select
                                            value={getPortId(ocrReviewData.destinationPortCode)}
                                            onChange={e => {
                                                const port = ports.find(p => p.id === e.target.value);
                                                if (port) setOcrReviewData(prev => ({ ...prev, destinationPort: port.name, destinationPortCode: port.code }));
                                            }}
                                            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                        >
                                            <option value="">Select Port...</option>
                                            {[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
                                        </select>
                                        <input
                                            value={ocrReviewData.destinationPortCode || ''}
                                            onChange={e => setOcrReviewData(prev => ({ ...prev, destinationPortCode: e.target.value.toUpperCase() }))}
                                            className="w-24 border border-slate-300 rounded-lg px-2 py-2 text-sm font-mono text-center"
                                            placeholder="Code"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Row 3: Pickup & Delivery */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Pickup Location</label>
                                    <input
                                        value={ocrReviewData.pickupLocation || ''}
                                        onChange={e => setOcrReviewData(prev => ({ ...prev, pickupLocation: e.target.value }))}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                        placeholder="City, State"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Delivery Location</label>
                                    <input
                                        value={ocrReviewData.deliveryLocation || ''}
                                        onChange={e => setOcrReviewData(prev => ({ ...prev, deliveryLocation: e.target.value }))}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                        placeholder="City, State"
                                    />
                                </div>
                            </div>

                            {/* Row 4: Rate, Currency, Transit Time, Free Time */}
                            <div className="grid grid-cols-4 gap-3">
                                <div>
                                    <label className="text-xs font-bold text-emerald-600 uppercase mb-1 block">Rate (All-In)</label>
                                    <input
                                        type="number"
                                        value={ocrReviewData.rate || 0}
                                        onChange={e => setOcrReviewData(prev => ({ ...prev, rate: parseFloat(e.target.value) || 0 }))}
                                        className="w-full border border-emerald-300 rounded-lg px-3 py-2 text-sm font-bold text-emerald-700 bg-emerald-50"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Currency</label>
                                    <select
                                        value={ocrReviewData.currency || 'USD'}
                                        onChange={e => setOcrReviewData(prev => ({ ...prev, currency: e.target.value }))}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                    >
                                        <option value="USD">USD</option>
                                        <option value="EUR">EUR</option>
                                        <option value="BRL">BRL</option>
                                        <option value="CNY">CNY</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Transit (days)</label>
                                    <input
                                        type="number"
                                        value={ocrReviewData.transitTime || 0}
                                        onChange={e => setOcrReviewData(prev => ({ ...prev, transitTime: parseInt(e.target.value) || 0 }))}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Free Time (days)</label>
                                    <input
                                        type="number"
                                        value={ocrReviewData.freeTime || 0}
                                        onChange={e => setOcrReviewData(prev => ({ ...prev, freeTime: parseInt(e.target.value) || 0 }))}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                    />
                                </div>
                            </div>

                            {/* Row 5: Cost Components */}
                            <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                                <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Rate Components</h4>
                                <div className="grid grid-cols-4 gap-2">
                                    {[
                                        { key: 'pickupCost', label: 'Pickup' },
                                        { key: 'oceanCost', label: 'Ocean' },
                                        { key: 'deliveryCost', label: 'Delivery' },
                                        { key: 'portFees', label: 'Port Fees' },
                                        { key: 'thc', label: 'THC' },
                                        { key: 'isps', label: 'ISPS' },
                                        { key: 'blRelease', label: 'BL Release' },
                                        { key: 'deconsolidation', label: 'Deconsolidation' },
                                        { key: 'containerReturn', label: 'Container Return' },
                                        { key: 'trs', label: 'TRS' },
                                        { key: 'securityFee', label: 'Security Fee' },
                                        { key: 'chassis', label: 'Chassis' },
                                    ].map(({ key, label }) => (
                                        <div key={key}>
                                            <label className="text-[10px] text-slate-500 block">{label}</label>
                                            <input
                                                type="number"
                                                value={(ocrReviewData as any)[key] || 0}
                                                onChange={e => setOcrReviewData(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                                                className="w-full border border-slate-200 rounded px-2 py-1 text-xs"
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Row 6: Valid Until, Container Count */}
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Valid Until</label>
                                    <input
                                        type="date"
                                        value={ocrReviewData.validUntil || ''}
                                        onChange={e => setOcrReviewData(prev => ({ ...prev, validUntil: e.target.value }))}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Containers</label>
                                    <input
                                        type="number"
                                        value={ocrReviewData.containerCount || 1}
                                        onChange={e => setOcrReviewData(prev => ({ ...prev, containerCount: parseInt(e.target.value) || 1 }))}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Overweight</label>
                                    <input
                                        type="number"
                                        value={ocrReviewData.overweight || 0}
                                        onChange={e => setOcrReviewData(prev => ({ ...prev, overweight: parseFloat(e.target.value) || 0 }))}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                                    />
                                </div>
                            </div>

                            {/* Row 7: Comments / Observation */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Comments</label>
                                    <textarea
                                        value={ocrReviewData.comments || ''}
                                        onChange={e => setOcrReviewData(prev => ({ ...prev, comments: e.target.value }))}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm resize-none"
                                        rows={2}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Observation</label>
                                    <textarea
                                        value={ocrReviewData.observation || ''}
                                        onChange={e => setOcrReviewData(prev => ({ ...prev, observation: e.target.value }))}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm resize-none"
                                        rows={2}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Footer Actions */}
                        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-between items-center">
                            <button onClick={resetOcrReview} className="px-5 py-2.5 border border-slate-300 rounded-lg text-slate-600 font-medium hover:bg-slate-100 transition-colors">
                                Cancel
                            </button>
                            <button
                                onClick={handleOcrReviewSave}
                                className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-lg font-bold hover:from-emerald-600 hover:to-teal-600 shadow-md hover:shadow-lg transition-all"
                            >
                                <Save size={18} />
                                {ocrMatchedQuote ? 'Update Matched Quote' : 'Save New Quote'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Document View Modal ─────────────────────────────────── */}
            {viewDocumentUrl && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setViewDocumentUrl(null)}>
                    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50 rounded-t-2xl">
                            <h3 className="font-bold text-slate-700 flex items-center gap-2"><Eye size={18} className="text-blue-500" /> Freight Quote Document</h3>
                            <button onClick={() => setViewDocumentUrl(null)} className="text-slate-400 hover:text-red-500 transition-colors"><X size={20} /></button>
                        </div>
                        <div className="flex-1 overflow-auto p-2 bg-slate-100 flex items-center justify-center">
                            {viewDocumentUrl.startsWith('data:application/pdf') ? (
                                <iframe src={viewDocumentUrl} className="w-full h-full rounded-lg border border-slate-200" />
                            ) : (
                                <img src={viewDocumentUrl} className="max-w-full max-h-full object-contain rounded-lg shadow-lg" alt="Freight Quote Document" />
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default FreightQuotes;
