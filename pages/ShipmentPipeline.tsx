import React, { useState, useMemo } from 'react';
import {
    Ship, Package, FileText, ScrollText, ChevronDown, ChevronUp,
    Search, Filter, AlertTriangle, CheckCircle2, Clock, Circle,
    ExternalLink, Brain, TrendingUp, Calendar, MapPin, User, RefreshCw, Loader2
} from 'lucide-react';
import {
    SalesOrder, CommissionSalesOrder, Booking, Invoice, BillOfLading, Company, Port
} from '../types';
import { lookupShipmentETA, ETALookupResult } from '../services/geminiService';
import { shipsgoLookupETA } from '../services/shipsgoService';

interface ShipmentPipelineProps {
    salesOrders: SalesOrder[];
    commissionOrders: CommissionSalesOrder[];
    bookings: Booking[];
    invoices: Invoice[];
    billOfLadings: BillOfLading[];
    currentCompanyId: string;
    availableCompanies: Company[];
    ports?: Port[];
    onUpdateCommission?: (id: string, updates: any) => Promise<void>;
}

// Pipeline stage status
type StageStatus = 'COMPLETE' | 'PENDING' | 'MISSING';

// Aggregated shipment pipeline
interface AggregatedShipment {
    id: string;
    customerName: string;
    orderType: 'SALES' | 'COMMISSION';

    // Stage 1: Order
    order?: SalesOrder | CommissionSalesOrder;
    orderNumber: string;
    orderDate: string;
    orderStatus: StageStatus;

    // Stage 2: Booking
    booking?: Booking;
    bookingNumber?: string;
    bookingStatus: StageStatus;
    pol?: string;
    pod?: string;
    etd?: string;
    eta?: string;

    // Stage 3: Invoice
    invoice?: Invoice;
    invoiceNumber?: string;
    invoiceStatus: StageStatus;
    invoiceAmount?: number;

    // Stage 4: Bill of Lading
    billOfLading?: BillOfLading;
    blNumber?: string;
    blStatus: StageStatus;

    // Computed
    overallProgress: number;
    needsAttention: boolean;
    nextAction: string;
    products?: string;
    shipper?: string;
}

type FilterTab = 'ALL' | 'IN_PROGRESS' | 'COMPLETED' | 'ATTENTION';

const ShipmentPipeline: React.FC<ShipmentPipelineProps> = ({
    salesOrders,
    commissionOrders,
    bookings,
    invoices,
    billOfLadings,
    currentCompanyId,
    availableCompanies,
    ports = [],
    onUpdateCommission
}) => {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [etaLookupId, setEtaLookupId] = useState<string | null>(null);
    const [etaResult, setEtaResult] = useState<{ id: string; result: ETALookupResult } | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState<FilterTab>('ALL');
    const [selectedCustomers, setSelectedCustomers] = useState<Set<string>>(new Set());
    const [showCustomerFilter, setShowCustomerFilter] = useState(false);

    // Toggle customer in multi-select
    const toggleCustomer = (customer: string) => {
        setSelectedCustomers(prev => {
            const next = new Set(prev);
            if (next.has(customer)) {
                next.delete(customer);
            } else {
                next.add(customer);
            }
            return next;
        });
    };

    // Helper to get first name
    const getFirstName = (fullName: string) => {
        if (!fullName) return '—';
        return fullName.split(' ')[0];
    };

    // Helper to normalize POD to 5-digit port code only
    const normalizePortCode = (rawPod: string): string => {
        if (!rawPod) return '—';
        const cleaned = rawPod.trim();
        // Already a 5-letter code
        if (/^[A-Z]{5}$/i.test(cleaned)) return cleaned.toUpperCase();
        // Extract from "Name (CODE)" format
        const parenMatch = cleaned.match(/\(([A-Z]{5})\)/i);
        if (parenMatch) return parenMatch[1].toUpperCase();
        // Extract from "CODE-Name" format
        const dashMatch = cleaned.match(/^([A-Z]{5})-/i);
        if (dashMatch) return dashMatch[1].toUpperCase();
        // Extract from "CODE Name" format
        const spaceMatch = cleaned.match(/^([A-Z]{5})\s/i);
        if (spaceMatch) return spaceMatch[1].toUpperCase();

        // Fuzzy match against ports list
        if (ports && ports.length > 0) {
            const upper = cleaned.toUpperCase();
            const inputTokens = new Set(upper.split(/[^A-Z0-9]+/).filter(t => t.length >= 3));
            // Exact code match
            const exactCode = ports.find(p => p.code && p.code.toUpperCase() === upper);
            if (exactCode) return exactCode.code;
            // Token-based name match
            let bestMatch: Port | null = null;
            let maxScore = 0;
            for (const port of ports) {
                if (!port.code || !port.name) continue;
                const pName = port.name.toUpperCase();
                let score = 0;
                // Code in input tokens
                if (inputTokens.has(port.code.toUpperCase())) score += 200;
                // Name token matching
                const nameTokens = pName.split(/[^A-Z0-9]+/).filter(t => t.length >= 3);
                let common = 0;
                for (const nt of nameTokens) {
                    if (inputTokens.has(nt)) common++;
                }
                if (common > 0) score += common * 50;
                if (common === nameTokens.length && common > 0) score += 100;
                // Simple includes fallback
                if (score === 0 && upper.includes(pName) && pName.length > 3) score += 20;
                if (score === 0 && pName.includes(upper) && upper.length > 3) score += 20;
                if (score > maxScore) { maxScore = score; bestMatch = port; }
            }
            if (bestMatch && maxScore >= 20) return bestMatch.code;
        }

        // Return raw if no pattern matches
        return cleaned;
    };

    // ETA Lookup handler — tries ShipsGo first, then Gemini Search fallback
    const handleETALookup = async (shipment: AggregatedShipment) => {
        if (etaLookupId) return; // Already looking up
        setEtaLookupId(shipment.id);
        setEtaResult(null);

        try {
            // Gather container numbers from ALL sources
            const containerSources: string[] = [];
            if (shipment.billOfLading?.container) containerSources.push(shipment.billOfLading.container);
            if (shipment.booking?.containerNumber) containerSources.push(shipment.booking.containerNumber);
            if ((shipment.order as any)?.containerNumbers) containerSources.push(String((shipment.order as any).containerNumbers));

            const allContainerStr = containerSources.join(' ');
            const containerNumbers = allContainerStr
                .split(/[,;|\s\/]+/)
                .map(c => c.trim().toUpperCase())
                .filter(c => c.length >= 7 && /^[A-Z]{3,4}[A-Z0-9]/.test(c));

            const carrier = shipment.booking?.carrier || undefined;
            const blNumber = shipment.blNumber || undefined;
            const vesselVoyage = shipment.billOfLading?.vesselVoyage || shipment.booking?.vesselVoyage || undefined;

            console.log('[ETA Lookup] Shipment:', shipment.id, 'BL:', blNumber, 'Containers:', containerNumbers, 'Carrier:', carrier);

            let eta: string | null = null;
            let etd: string | null = null;
            let resultParts: string[] = [];
            let usedSource = '';

            // --- Try ShipsGo first ---
            const shipsgoResult = await shipsgoLookupETA({
                containerNumbers: containerNumbers.length > 0 ? containerNumbers : undefined,
                blNumber,
                shippingLine: carrier,
            });

            if (!shipsgoResult.error && (shipsgoResult.eta || shipsgoResult.status)) {
                eta = shipsgoResult.eta;
                etd = shipsgoResult.etd;
                usedSource = 'ShipsGo';
                if (shipsgoResult.eta) resultParts.push(`ETA: ${shipsgoResult.eta}`);
                if (shipsgoResult.etd) resultParts.push(`ETD: ${shipsgoResult.etd}`);
                if (shipsgoResult.vesselName) resultParts.push(`Vessel: ${shipsgoResult.vesselName}`);
                if (shipsgoResult.status) resultParts.push(`Status: ${shipsgoResult.status}`);
                if (shipsgoResult.lastPort) resultParts.push(`Location: ${shipsgoResult.lastPort}`);
                resultParts.push(`Source: ShipsGo`);
            } else {
                // --- Fall back to Gemini Search ---
                console.log('[ETA Lookup] ShipsGo failed, trying Gemini Search...', shipsgoResult.error);
                const geminiResult = await lookupShipmentETA({
                    blNumber,
                    containerNumbers: containerNumbers.length > 0 ? containerNumbers : undefined,
                    vesselVoyage,
                    carrier,
                    pod: shipment.pod || undefined,
                });

                if (!geminiResult.error && (geminiResult.eta || geminiResult.status)) {
                    eta = geminiResult.eta;
                    etd = geminiResult.etd;
                    usedSource = 'Gemini Search';
                    if (geminiResult.eta) resultParts.push(`ETA: ${geminiResult.eta}`);
                    if (geminiResult.etd) resultParts.push(`ETD: ${geminiResult.etd}`);
                    if (geminiResult.vesselName) resultParts.push(`Vessel: ${geminiResult.vesselName}`);
                    if (geminiResult.status) resultParts.push(`Status: ${geminiResult.status}`);
                    if (geminiResult.source) resultParts.push(`Source: ${geminiResult.source}`);
                } else {
                    // Both failed
                    const errorMsg = shipsgoResult.error || geminiResult.error || 'No tracking data found';
                    alert(`ETA Lookup: ${errorMsg}`);
                    return;
                }
            }

            // Update the commission record if we got an ETA
            if (eta && onUpdateCommission) {
                const sourceId = shipment.order?.id || shipment.invoice?.id;
                if (sourceId) {
                    const updates: any = {};
                    if (eta) updates.eta = eta;
                    if (etd) updates.etd = etd;
                    await onUpdateCommission(sourceId, updates);
                }
            }

            alert(`🔍 ETA Lookup (${usedSource}):\n${resultParts.join('\n')}`);

        } catch (err: any) {
            alert(`ETA Lookup failed: ${err.message || 'Unknown error'}`);
        } finally {
            setEtaLookupId(null);
        }
    };

    // Aggregate shipments from all data sources - OPTIMIZED APPROACH
    const aggregatedShipments = useMemo((): AggregatedShipment[] => {
        try {
            const shipments: AggregatedShipment[] = [];
            const processedIds = new Set<string>(); // Track to avoid duplicates

            // Safety checks - return empty array if data isn't loaded yet
            if (!invoices || !commissionOrders || !bookings || !salesOrders || !billOfLadings) {
                console.warn('ShipmentPipeline: Waiting for data to load...');
                return [];
            }

            // Step 1: Create lookup maps for O(1) access instead of O(n) find()
            const bookingMap = new Map<string, Booking>();
            (bookings || []).filter(b => b?.companyId === currentCompanyId).forEach(b => {
                if (b?.bookingNumber) bookingMap.set(b.bookingNumber, b);
            });

            const salesOrderMap = new Map<string, SalesOrder>();
            (salesOrders || []).filter(so => so?.companyId === currentCompanyId).forEach(so => {
                if (so?.orderNumber) salesOrderMap.set(so.orderNumber, so);
            });

            const billOfLadingMap = new Map<string, BillOfLading>();
            const billOfLadingByBlNumberMap = new Map<string, BillOfLading>();
            const billOfLadingByInvoiceMap = new Map<string, BillOfLading>();

            console.log('[ShipmentPipeline] Raw billOfLadings count:', (billOfLadings || []).length,
                'after companyId filter:', (billOfLadings || []).filter(bl => bl?.companyId === currentCompanyId).length,
                'currentCompanyId:', currentCompanyId);

            (billOfLadings || []).filter(bl => bl?.companyId === currentCompanyId).forEach(bl => {
                if (bl?.bookingNumber) billOfLadingMap.set(bl.bookingNumber, bl);
                // Map by blNumber for direct text matching (e.g. invoice.bl === bl.blNumber)
                if (bl?.blNumber) billOfLadingByBlNumberMap.set(bl.blNumber, bl);
                // Also map by invoice number/id if available
                const invNum = (bl as any).invoiceNumber || (bl as any).invoice_number || (bl as any).invoiceId;
                if (invNum) billOfLadingByInvoiceMap.set(invNum, bl);
            });

            console.log('[ShipmentPipeline] B/L maps: byBooking:', billOfLadingMap.size,
                'byBlNumber:', billOfLadingByBlNumberMap.size,
                'byInvoice:', billOfLadingByInvoiceMap.size);


            // Helper function to safely extract products from items (handles non-array items)
            const getProductsFromItems = (items: any): string | undefined => {
                if (!items) return undefined;

                // If it's already an array, map it
                if (Array.isArray(items)) {
                    return items
                        .map(i => i?.productDescription || i?.description || i?.productName || i?.product)
                        .filter(Boolean)
                        .join(', ') || undefined;
                }

                // If it's a JSON string, parse it first
                if (typeof items === 'string') {
                    try {
                        const parsed = JSON.parse(items);
                        if (Array.isArray(parsed)) {
                            return parsed
                                .map(i => i?.productDescription || i?.description || i?.productName || i?.product)
                                .filter(Boolean)
                                .join(', ') || undefined;
                        }
                    } catch (e) {
                        console.warn('Failed to parse items as JSON:', e);
                    }
                }

                return undefined;
            };

            // Helper function to calculate stage statuses and progress
            const calculateProgress = (hasOrder: boolean, hasBooking: boolean, hasInvoice: boolean, hasBL: boolean) => {
                const orderStatus: StageStatus = hasOrder ? 'COMPLETE' : 'MISSING';
                const bookingStatus: StageStatus = hasBooking ? 'COMPLETE' : 'MISSING';
                const invoiceStatus: StageStatus = hasInvoice ? 'COMPLETE' : 'MISSING';
                const blStatus: StageStatus = hasBL ? 'COMPLETE' : 'MISSING';

                const completedStages = [orderStatus, bookingStatus, invoiceStatus, blStatus].filter(s => s === 'COMPLETE').length;
                const overallProgress = (completedStages / 4) * 100;

                let nextAction = '';
                let needsAttention = false;

                if (!hasBooking && hasOrder) {
                    nextAction = 'Create booking';
                    needsAttention = true;
                } else if (!hasInvoice && hasBooking) {
                    nextAction = 'Create invoice';
                    needsAttention = true;
                } else if (!hasBL && hasInvoice) {
                    nextAction = 'Upload Bill of Lading';
                    needsAttention = true;
                } else if (overallProgress === 100) {
                    nextAction = 'Shipment complete';
                } else {
                    nextAction = 'In progress';
                }

                return { orderStatus, bookingStatus, invoiceStatus, blStatus, overallProgress, nextAction, needsAttention };
            };

            // Step 2: Process INVOICES first (they have most data: customer, SO#, amounts, booking#)
            invoices
                .filter(inv => inv.companyId === currentCompanyId)
                .forEach(invoice => {
                    const soNumber = invoice.soNumber || (invoice as any).so_number || invoice.customerPo;
                    if (!soNumber) return; // Skip invoices without SO reference

                    const id = `invoice-${invoice.id}`;
                    if (processedIds.has(id)) return;
                    processedIds.add(id);

                    // Lookup related records using Maps (O(1))
                    const salesOrder = soNumber ? salesOrderMap.get(soNumber) : undefined;
                    const booking = invoice.bookingNumber ? bookingMap.get(invoice.bookingNumber) : undefined;
                    const billOfLading = booking?.bookingNumber ? billOfLadingMap.get(booking.bookingNumber) :
                        invoice.bookingNumber ? billOfLadingMap.get(invoice.bookingNumber) :
                            invoice.bl ? billOfLadingByBlNumberMap.get(invoice.bl) :
                                billOfLadingByInvoiceMap.get(invoice.invoiceNumber) || billOfLadingByInvoiceMap.get(invoice.id) || undefined;

                    // Consider booking "linked" if invoice has bookingNumber, even without a booking record
                    const hasBookingLink = !!booking || !!invoice.bookingNumber;
                    const progress = calculateProgress(!!salesOrder, hasBookingLink, true, !!billOfLading);

                    shipments.push({
                        id,
                        customerName: invoice.soldTo || invoice.shipTo || salesOrder?.customerName || 'Unknown Customer',
                        orderType: 'SALES',
                        order: salesOrder,
                        orderNumber: soNumber,
                        orderDate: invoice.invoiceDate || salesOrder?.orderDate || invoice.date || invoice.createdAt || '',
                        orderStatus: salesOrder ? (salesOrder.status === 'APPROVED' || salesOrder.status === 'FULFILLED' ? 'COMPLETE' : 'PENDING') : 'MISSING',
                        booking,
                        bookingNumber: booking?.bookingNumber || invoice.bookingNumber,
                        bookingStatus: progress.bookingStatus,
                        pol: booking?.pol || salesOrder?.poa,
                        pod: booking?.pod || salesOrder?.pod || invoice.pod,
                        etd: booking?.etd,
                        eta: booking?.eta,
                        invoice,
                        invoiceNumber: invoice.invoiceNumber,
                        invoiceStatus: progress.invoiceStatus,
                        invoiceAmount: invoice.totalAmount,
                        billOfLading,
                        blNumber: billOfLading?.blNumber || invoice.bl,
                        blStatus: progress.blStatus,
                        overallProgress: progress.overallProgress,
                        needsAttention: progress.needsAttention,
                        nextAction: progress.nextAction,
                        products: getProductsFromItems(invoice.items) || getProductsFromItems(salesOrder?.items) || 'N/A',
                        shipper: invoice.shipper || (booking as any)?.shipper || invoice.shipperName
                    });
                });

            // Step 3: Process COMMISSION ORDERS (they also have most built-in data)
            commissionOrders
                .filter(co => co.companyId === currentCompanyId || !co.companyId)
                .forEach(order => {
                    const id = `commission-${order.id}`;
                    if (processedIds.has(id)) return;
                    processedIds.add(id);

                    // Lookup related records using Maps (O(1))
                    const booking = order.bookingNumber ? bookingMap.get(order.bookingNumber) : undefined;
                    const billOfLading = booking?.bookingNumber ? billOfLadingMap.get(booking.bookingNumber) :
                        order.blNumber ? Array.from(billOfLadingMap.values()).find(bl => bl.blNumber === order.blNumber) : undefined;

                    const hasInvoice = !!order.invoiceNumber;
                    // Consider booking "linked" if order has bookingNumber, even without a booking record
                    const hasBookingLink = !!booking || !!order.bookingNumber;
                    const progress = calculateProgress(true, hasBookingLink, hasInvoice, !!billOfLading || !!order.blDocumentUrl);

                    shipments.push({
                        id,
                        customerName: order.customerName || 'Unknown Customer',
                        orderType: 'COMMISSION',
                        order,
                        orderNumber: order.orderNumber,
                        orderDate: order.createdAt,
                        orderStatus: order.status === 'APPROVED' || order.status === 'COMPLETED' || order.status === 'SHIPPED' ? 'COMPLETE' : 'PENDING',
                        booking,
                        bookingNumber: booking?.bookingNumber || order.bookingNumber,
                        bookingStatus: progress.bookingStatus,
                        pol: booking?.pol || order.pol,
                        pod: booking?.pod || order.pod,
                        etd: booking?.etd || order.etd,
                        eta: booking?.eta || order.eta,
                        invoice: undefined, // Commission orders don't directly link to invoice records
                        invoiceNumber: order.invoiceNumber,
                        invoiceStatus: progress.invoiceStatus,
                        invoiceAmount: order.orderTotal,
                        billOfLading,
                        blNumber: billOfLading?.blNumber || order.blNumber,
                        blStatus: progress.blStatus,
                        overallProgress: progress.overallProgress,
                        needsAttention: progress.needsAttention,
                        nextAction: progress.nextAction,
                        products: getProductsFromItems(order.items) || 'N/A',
                        shipper: (booking as any)?.shipper || order.sellerName
                    });
                });

            // Step 4: Process STANDALONE BOOKINGS (not yet included from invoices/commissions)
            bookings
                .filter(b => b.companyId === currentCompanyId)
                .forEach(booking => {
                    // Check if already processed via invoice or commission
                    const alreadyProcessed = shipments.some(s => s.bookingNumber === booking.bookingNumber);
                    if (alreadyProcessed) return;

                    const id = `booking-${booking.id}`;
                    if (processedIds.has(id)) return;
                    processedIds.add(id);

                    // Lookup related records
                    const salesOrder = booking.salesOrderId ? Array.from(salesOrderMap.values()).find(so => so.id === booking.salesOrderId || (so as any).sales_order_id === booking.salesOrderId) : undefined;
                    const billOfLading = booking.bookingNumber ? billOfLadingMap.get(booking.bookingNumber) : undefined;

                    const progress = calculateProgress(!!salesOrder, true, false, !!billOfLading);

                    shipments.push({
                        id,
                        customerName: booking.customer || salesOrder?.customerName || 'Unknown Customer',
                        orderType: 'SALES',
                        order: salesOrder,
                        orderNumber: salesOrder?.orderNumber || booking.bookingNumber || '',
                        orderDate: booking.createdAt || salesOrder?.orderDate || '',
                        orderStatus: progress.orderStatus,
                        booking,
                        bookingNumber: booking.bookingNumber,
                        bookingStatus: progress.bookingStatus,
                        pol: booking.pol || salesOrder?.poa,
                        pod: booking.pod || salesOrder?.pod,
                        etd: booking.etd,
                        eta: booking.eta,
                        invoice: undefined,
                        invoiceNumber: undefined,
                        invoiceStatus: progress.invoiceStatus,
                        invoiceAmount: undefined,
                        billOfLading,
                        blNumber: billOfLading?.blNumber,
                        blStatus: progress.blStatus,
                        overallProgress: progress.overallProgress,
                        needsAttention: progress.needsAttention,
                        nextAction: progress.nextAction,
                        products: salesOrder?.items?.map(i => i.productName).join(', ') || 'N/A',
                        shipper: (booking as any).shipper
                    });
                });

            // Sort by date (newest first)
            return shipments.sort((a, b) =>
                new Date(b.orderDate || 0).getTime() - new Date(a.orderDate || 0).getTime()
            );
        } catch (error) {
            console.error('ShipmentPipeline aggregation error:', error);
            return []; // Return empty array on error instead of crashing
        }
    }, [invoices, commissionOrders, bookings, salesOrders, billOfLadings, currentCompanyId]);

    // Filter shipments based on active tab and search
    const filteredShipments = useMemo(() => {
        let filtered = aggregatedShipments;

        // Filter by tab
        switch (activeTab) {
            case 'IN_PROGRESS':
                filtered = filtered.filter(s => s.overallProgress > 0 && s.overallProgress < 100);
                break;
            case 'COMPLETED':
                filtered = filtered.filter(s => s.overallProgress === 100);
                break;
            case 'ATTENTION':
                filtered = filtered.filter(s => s.needsAttention);
                break;
        }

        // Filter by customer (multi-select)
        if (selectedCustomers.size > 0) {
            filtered = filtered.filter(s => selectedCustomers.has(s.customerName));
        }

        // Filter by search
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(s =>
                s.customerName.toLowerCase().includes(query) ||
                s.orderNumber.toLowerCase().includes(query) ||
                s.bookingNumber?.toLowerCase().includes(query) ||
                s.invoiceNumber?.toLowerCase().includes(query) ||
                s.blNumber?.toLowerCase().includes(query) ||
                s.products?.toLowerCase().includes(query)
            );
        }

        return filtered;
    }, [aggregatedShipments, activeTab, searchQuery, selectedCustomers]);

    // Unique customers for autofilter
    const uniqueCustomers = useMemo(() => {
        const customers = [...new Set(aggregatedShipments.map(s => s.customerName))].sort();
        return customers;
    }, [aggregatedShipments]);

    // Stats
    const stats = useMemo(() => ({
        total: aggregatedShipments.length,
        inProgress: aggregatedShipments.filter(s => s.overallProgress > 0 && s.overallProgress < 100).length,
        completed: aggregatedShipments.filter(s => s.overallProgress === 100).length,
        attention: aggregatedShipments.filter(s => s.needsAttention).length
    }), [aggregatedShipments]);

    // Render stage indicator
    const StageIndicator: React.FC<{ status: StageStatus; label: string; isLast?: boolean }> = ({ status, label, isLast }) => (
        <div className="flex flex-col items-center">
            <div className="flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${status === 'COMPLETE'
                    ? 'bg-emerald-500 text-white'
                    : status === 'PENDING'
                        ? 'bg-amber-400 text-white animate-pulse'
                        : 'bg-slate-200 text-slate-400'
                    }`}>
                    {status === 'COMPLETE' ? <CheckCircle2 size={16} /> :
                        status === 'PENDING' ? <Clock size={14} /> :
                            <Circle size={14} />}
                </div>
                {!isLast && (
                    <div className={`w-12 h-1 ${status === 'COMPLETE' ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                )}
            </div>
            <span className={`text-xs mt-1 font-medium ${status === 'COMPLETE' ? 'text-emerald-600' :
                status === 'PENDING' ? 'text-amber-600' : 'text-slate-400'
                }`}>
                {label}
            </span>
        </div>
    );

    // Render compact single-line shipment row
    const ShipmentRow: React.FC<{ shipment: AggregatedShipment }> = ({ shipment }) => {
        const isExpanded = expandedId === shipment.id;

        // Inline mini stage indicator with text label
        const MiniStage: React.FC<{ status: StageStatus; label: string; code: string }> = ({ status, label, code }) => (
            <div className="flex flex-col items-center" title={label}>
                <div className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${status === 'COMPLETE' ? 'bg-emerald-500 text-white' :
                    status === 'PENDING' ? 'bg-amber-400 text-white' :
                        'bg-slate-200 text-slate-400'
                    }`}>
                    {code}
                </div>
            </div>
        );

        return (
            <div className={`bg-white border-b transition-all ${shipment.needsAttention ? 'border-l-4 border-l-amber-400' : 'border-l-4 border-l-transparent'} hover:bg-slate-50`}>
                {/* Single Line Row */}
                <div
                    className="flex items-center px-4 py-2.5 cursor-pointer gap-4"
                    onClick={() => setExpandedId(isExpanded ? null : shipment.id)}
                >
                    {/* Type Badge */}
                    <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 ${shipment.orderType === 'COMMISSION' ? 'bg-purple-100' : 'bg-blue-100'
                        }`}>
                        <Ship size={14} className={shipment.orderType === 'COMMISSION' ? 'text-purple-600' : 'text-blue-600'} />
                    </div>

                    {/* Customer Name - First name only with tooltip */}
                    <div className="w-32 shrink-0" title={shipment.customerName}>
                        <span className="font-medium text-slate-800 text-sm truncate block">{getFirstName(shipment.customerName)}</span>
                    </div>

                    {/* Order Number */}
                    <div className="w-24 shrink-0">
                        <span className="text-xs text-slate-500 font-mono">{shipment.orderNumber}</span>
                    </div>

                    {/* Shipper */}
                    <div className="w-24 shrink-0" title={shipment.shipper}>
                        <span className="text-xs text-slate-600 truncate block">{getFirstName(shipment.shipper || '')}</span>
                    </div>

                    {/* Booking # */}
                    <div className="w-28 shrink-0">
                        <span className="text-xs text-slate-500 font-mono">{shipment.bookingNumber || '—'}</span>
                    </div>

                    {/* Invoice # */}
                    <div className="w-24 shrink-0">
                        <span className="text-xs text-slate-500 font-mono">{shipment.invoiceNumber || '—'}</span>
                    </div>

                    {/* POD (Route) */}
                    <div className="w-16 shrink-0 text-xs text-slate-600 font-mono">
                        {shipment.pod ? (
                            <span title={shipment.pod}>{normalizePortCode(shipment.pod)}</span>
                        ) : (
                            <span className="text-slate-300">—</span>
                        )}
                    </div>

                    {/* ETD */}
                    <div className="w-20 shrink-0 text-xs text-slate-500">
                        {shipment.etd ? new Date(shipment.etd).toLocaleDateString() : '—'}
                    </div>

                    {/* ETA + Update Button */}
                    <div className="w-20 shrink-0 text-xs text-slate-500 flex items-center gap-1">
                        <span>{shipment.eta ? new Date(shipment.eta).toLocaleDateString() : '—'}</span>
                        {(shipment.blNumber || shipment.billOfLading?.container || shipment.booking?.containerNumber) && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleETALookup(shipment);
                                }}
                                disabled={etaLookupId === shipment.id}
                                className="p-0.5 rounded hover:bg-blue-100 text-blue-400 hover:text-blue-600 transition-colors disabled:opacity-50"
                                title="Look up latest ETA via AI Search"
                            >
                                {etaLookupId === shipment.id ? (
                                    <Loader2 size={12} className="animate-spin" />
                                ) : (
                                    <RefreshCw size={12} />
                                )}
                            </button>
                        )}
                    </div>

                    {/* B/L # */}
                    <div className="w-24 shrink-0">
                        <span className="text-xs text-slate-500 font-mono">{shipment.blNumber || '—'}</span>
                    </div>

                    {/* Pipeline Stages - Text Labels */}
                    <div className="flex items-center gap-0.5 shrink-0">
                        <MiniStage status={shipment.orderStatus} label="Sales Order" code="SO" />
                        <div className={`w-2 h-0.5 ${shipment.orderStatus === 'COMPLETE' ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                        <MiniStage status={shipment.bookingStatus} label="Booking" code="BK" />
                        <div className={`w-2 h-0.5 ${shipment.bookingStatus === 'COMPLETE' ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                        <MiniStage status={shipment.invoiceStatus} label="Commercial Invoice" code="CI" />
                        <div className={`w-2 h-0.5 ${shipment.invoiceStatus === 'COMPLETE' ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                        <MiniStage status={shipment.blStatus} label="Bill of Lading" code="BL" />
                    </div>

                    {/* Progress % */}
                    <div className="w-12 shrink-0 text-right">
                        <span className={`text-xs font-semibold ${shipment.overallProgress === 100 ? 'text-emerald-600' :
                            shipment.overallProgress >= 50 ? 'text-blue-600' :
                                'text-slate-500'
                            }`}>
                            {Math.round(shipment.overallProgress)}%
                        </span>
                    </div>

                    {/* Status Badge */}
                    <div className="w-24 shrink-0">
                        {shipment.needsAttention ? (
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                                <AlertTriangle size={10} />
                                Action
                            </span>
                        ) : shipment.overallProgress === 100 ? (
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                                <CheckCircle2 size={10} />
                                Complete
                            </span>
                        ) : (
                            <span className="text-xs text-slate-400">In Progress</span>
                        )}
                    </div>

                    {/* Expand Arrow */}
                    <button className="p-1 hover:bg-slate-100 rounded shrink-0">
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                    <div className="border-t border-slate-100 p-4 bg-slate-50/50">
                        <div className="grid grid-cols-4 gap-4 mb-4">
                            {/* Order Card */}
                            <div className="bg-white rounded-lg p-3 border border-slate-200">
                                <div className="flex items-center gap-2 mb-2">
                                    <FileText size={16} className="text-blue-500" />
                                    <span className="font-medium text-sm">Order</span>
                                </div>
                                <p className="text-sm font-semibold text-slate-800">{shipment.orderNumber}</p>
                                <div className={`inline-flex items-center gap-1 text-xs mt-1 px-2 py-0.5 rounded-full ${shipment.orderStatus === 'COMPLETE'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-amber-100 text-amber-700'
                                    }`}>
                                    {shipment.orderStatus === 'COMPLETE' ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                                    {shipment.orderStatus}
                                </div>
                            </div>

                            {/* Booking Card */}
                            <div className="bg-white rounded-lg p-3 border border-slate-200">
                                <div className="flex items-center gap-2 mb-2">
                                    <Ship size={16} className="text-indigo-500" />
                                    <span className="font-medium text-sm">Booking</span>
                                </div>
                                <p className="text-sm font-semibold text-slate-800">
                                    {shipment.bookingNumber || '—'}
                                </p>
                                <div className={`inline-flex items-center gap-1 text-xs mt-1 px-2 py-0.5 rounded-full ${shipment.bookingStatus === 'COMPLETE'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : shipment.bookingStatus === 'PENDING'
                                        ? 'bg-amber-100 text-amber-700'
                                        : 'bg-slate-100 text-slate-600'
                                    }`}>
                                    {shipment.bookingStatus === 'COMPLETE' ? <CheckCircle2 size={12} /> :
                                        shipment.bookingStatus === 'PENDING' ? <Clock size={12} /> :
                                            <Circle size={12} />}
                                    {shipment.bookingStatus}
                                </div>
                            </div>

                            {/* Invoice Card */}
                            <div className="bg-white rounded-lg p-3 border border-slate-200">
                                <div className="flex items-center gap-2 mb-2">
                                    <ScrollText size={16} className="text-green-500" />
                                    <span className="font-medium text-sm">Invoice</span>
                                </div>
                                <p className="text-sm font-semibold text-slate-800">
                                    {shipment.invoiceNumber || '—'}
                                </p>
                                {shipment.invoiceAmount && (
                                    <p className="text-xs text-slate-500">${shipment.invoiceAmount.toLocaleString()}</p>
                                )}
                                <div className={`inline-flex items-center gap-1 text-xs mt-1 px-2 py-0.5 rounded-full ${shipment.invoiceStatus === 'COMPLETE'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : shipment.invoiceStatus === 'PENDING'
                                        ? 'bg-amber-100 text-amber-700'
                                        : 'bg-slate-100 text-slate-600'
                                    }`}>
                                    {shipment.invoiceStatus === 'COMPLETE' ? <CheckCircle2 size={12} /> :
                                        shipment.invoiceStatus === 'PENDING' ? <Clock size={12} /> :
                                            <Circle size={12} />}
                                    {shipment.invoiceStatus}
                                </div>
                            </div>

                            {/* BL Card */}
                            <div className="bg-white rounded-lg p-3 border border-slate-200">
                                <div className="flex items-center gap-2 mb-2">
                                    <FileText size={16} className="text-orange-500" />
                                    <span className="font-medium text-sm">Bill of Lading</span>
                                </div>
                                <p className="text-sm font-semibold text-slate-800">
                                    {shipment.blNumber || '—'}
                                </p>
                                <div className={`inline-flex items-center gap-1 text-xs mt-1 px-2 py-0.5 rounded-full ${shipment.blStatus === 'COMPLETE'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : shipment.blStatus === 'PENDING'
                                        ? 'bg-amber-100 text-amber-700'
                                        : 'bg-slate-100 text-slate-600'
                                    }`}>
                                    {shipment.blStatus === 'COMPLETE' ? <CheckCircle2 size={12} /> :
                                        shipment.blStatus === 'PENDING' ? <Clock size={12} /> :
                                            <Circle size={12} />}
                                    {shipment.blStatus}
                                </div>
                            </div>
                        </div>

                        {/* AI Insights */}
                        {shipment.needsAttention && (
                            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg p-3 border border-indigo-200">
                                <div className="flex items-center gap-2 mb-2">
                                    <Brain size={16} className="text-indigo-600" />
                                    <span className="font-medium text-sm text-indigo-800">AI Insight</span>
                                </div>
                                <p className="text-sm text-indigo-700">
                                    <AlertTriangle size={14} className="inline mr-1" />
                                    <strong>Next action:</strong> {shipment.nextAction}
                                </p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 p-6">
            {/* Header */}
            <div className="mb-6">
                <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-lg">
                        <Ship size={24} className="text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">Shipment Pipeline</h1>
                        <p className="text-sm text-slate-500">AI-powered shipment tracking and follow-up</p>
                    </div>
                </div>
            </div>

            {/* Stats Cards - Compact Single Line */}
            <div className="flex gap-3 mb-6">
                <div className="flex-1 bg-white rounded-lg px-4 py-2 border border-slate-200 shadow-sm flex items-center justify-between">
                    <span className="text-xs text-slate-500">Total Shipments</span>
                    <span className="text-lg font-bold text-slate-800">{stats.total}</span>
                    <Package size={18} className="text-slate-400" />
                </div>
                <div className="flex-1 bg-white rounded-lg px-4 py-2 border border-blue-200 shadow-sm flex items-center justify-between">
                    <span className="text-xs text-blue-600">In Progress</span>
                    <span className="text-lg font-bold text-blue-700">{stats.inProgress}</span>
                    <TrendingUp size={18} className="text-blue-400" />
                </div>
                <div className="flex-1 bg-white rounded-lg px-4 py-2 border border-emerald-200 shadow-sm flex items-center justify-between">
                    <span className="text-xs text-emerald-600">Completed</span>
                    <span className="text-lg font-bold text-emerald-700">{stats.completed}</span>
                    <CheckCircle2 size={18} className="text-emerald-400" />
                </div>
                <div className="flex-1 bg-white rounded-lg px-4 py-2 border border-amber-200 shadow-sm flex items-center justify-between">
                    <span className="text-xs text-amber-600">Needs Attention</span>
                    <span className="text-lg font-bold text-amber-700">{stats.attention}</span>
                    <AlertTriangle size={18} className="text-amber-400" />
                </div>
            </div>

            {/* Filter Bar */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-6">
                <div className="flex items-center justify-between">
                    {/* Tabs */}
                    <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
                        {[
                            { key: 'ALL', label: 'All', count: stats.total },
                            { key: 'IN_PROGRESS', label: 'In Progress', count: stats.inProgress },
                            { key: 'COMPLETED', label: 'Completed', count: stats.completed },
                            { key: 'ATTENTION', label: 'Attention', count: stats.attention }
                        ].map(tab => (
                            <button
                                key={tab.key}
                                onClick={() => setActiveTab(tab.key as FilterTab)}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === tab.key
                                    ? 'bg-white shadow-sm text-slate-800'
                                    : 'text-slate-500 hover:text-slate-700'
                                    }`}
                            >
                                {tab.label}
                                <span className={`ml-2 px-1.5 py-0.5 rounded-full text-xs ${activeTab === tab.key
                                    ? 'bg-indigo-100 text-indigo-700'
                                    : 'bg-slate-200 text-slate-600'
                                    }`}>
                                    {tab.count}
                                </span>
                            </button>
                        ))}
                    </div>

                    {/* Search */}
                    <div className="relative">
                        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search shipments..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent w-64"
                        />
                    </div>
                </div>
            </div>

            {/* Shipment Table */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                {/* Header Row */}
                <div className="flex items-center px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wide gap-4">
                    <div className="w-6 shrink-0"></div>
                    <div className="w-32 shrink-0 flex items-center gap-1 relative">
                        <span>Customer</span>
                        <button
                            onClick={() => setShowCustomerFilter(!showCustomerFilter)}
                            className={`p-0.5 rounded hover:bg-slate-200 ${selectedCustomers.size > 0 ? 'text-indigo-600 bg-indigo-100' : 'text-slate-400'}`}
                            title="Filter by customer"
                        >
                            <Filter size={12} />
                            {selectedCustomers.size > 0 && (
                                <span className="absolute -top-1 -right-1 w-3 h-3 bg-indigo-600 text-white text-[8px] rounded-full flex items-center justify-center">
                                    {selectedCustomers.size}
                                </span>
                            )}
                        </button>
                        {showCustomerFilter && (
                            <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 min-w-[200px] max-h-72 overflow-y-auto">
                                <div className="sticky top-0 bg-white border-b border-slate-100 px-3 py-2 flex items-center justify-between">
                                    <span className="text-xs font-medium text-slate-600">Select Customers</span>
                                    {selectedCustomers.size > 0 && (
                                        <button
                                            onClick={() => setSelectedCustomers(new Set())}
                                            className="text-[10px] text-indigo-600 hover:text-indigo-800"
                                        >
                                            Clear All
                                        </button>
                                    )}
                                </div>
                                {uniqueCustomers.map(c => (
                                    <label
                                        key={c}
                                        className={`flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-50 cursor-pointer ${selectedCustomers.has(c) ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700'}`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedCustomers.has(c)}
                                            onChange={() => toggleCustomer(c)}
                                            className="w-3 h-3 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                        />
                                        <span className="truncate" title={c}>{getFirstName(c)}</span>
                                    </label>
                                ))}
                                <div className="sticky bottom-0 bg-white border-t border-slate-100 px-3 py-2">
                                    <button
                                        onClick={() => setShowCustomerFilter(false)}
                                        className="w-full text-center text-xs text-slate-600 hover:text-slate-800 font-medium"
                                    >
                                        Done
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="w-24 shrink-0">Order #</div>
                    <div className="w-24 shrink-0">Shipper</div>
                    <div className="w-28 shrink-0">Booking #</div>
                    <div className="w-24 shrink-0">Invoice #</div>
                    <div className="w-16 shrink-0">POD</div>
                    <div className="w-20 shrink-0">ETD</div>
                    <div className="w-20 shrink-0">ETA</div>
                    <div className="w-24 shrink-0">B/L #</div>
                    <div className="w-[116px] shrink-0 text-center">Pipeline</div>
                    <div className="w-12 shrink-0 text-right">%</div>
                    <div className="w-24 shrink-0">Status</div>
                    <div className="w-6 shrink-0"></div>
                </div>
                {filteredShipments.length === 0 ? (
                    <div className="p-12 text-center">
                        <Package size={48} className="mx-auto text-slate-300 mb-4" />
                        <h3 className="text-lg font-medium text-slate-600 mb-2">No shipments found</h3>
                        <p className="text-sm text-slate-400">
                            {searchQuery ? 'Try adjusting your search query' : 'Create a sales order to start tracking shipments'}
                        </p>
                    </div>
                ) : (
                    filteredShipments.map(shipment => (
                        <ShipmentRow key={shipment.id} shipment={shipment} />
                    ))
                )}
            </div>
        </div>
    );
};

export default ShipmentPipeline;
