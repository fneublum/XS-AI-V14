import React, { useState, useMemo, useEffect } from 'react';
import {
    Ship, Package, FileText, ScrollText, ChevronDown, ChevronUp,
    Search, Filter, AlertTriangle, CheckCircle2, Clock, Circle,
    ExternalLink, Brain, TrendingUp, Calendar, MapPin, User, RefreshCw, Loader2,
    Download, Mail, X, Eye
} from 'lucide-react';
import {
    SalesOrder, CommissionSalesOrder, Booking, Invoice, BillOfLading, Company, Port
} from '../types';
import { lookupShipmentETA, ETALookupResult } from '../services/geminiService';
import { shipsgoLookupETA } from '../services/shipsgoService';
import { getSupabaseClient } from '../services/supabase';

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
    onUpdateBooking?: (booking: Booking) => Promise<Booking | null>;
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
type TypeFilter = 'ALL' | 'SALES' | 'COMMISSION';

const ShipmentPipeline: React.FC<ShipmentPipelineProps> = ({
    salesOrders,
    commissionOrders,
    bookings,
    invoices,
    billOfLadings,
    currentCompanyId,
    availableCompanies,
    ports = [],
    onUpdateCommission,
    onUpdateBooking
}) => {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [etaLookupId, setEtaLookupId] = useState<string | null>(null);
    const [etaResult, setEtaResult] = useState<{ id: string; result: ETALookupResult } | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState<FilterTab>('ALL');
    const [selectedCustomers, setSelectedCustomers] = useState<Set<string>>(new Set());
    const [showCustomerFilter, setShowCustomerFilter] = useState(false);
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');

    // Bulk tracking state
    const [isBulkTracking, setIsBulkTracking] = useState(false);
    const [bulkTrackProgress, setBulkTrackProgress] = useState({ current: 0, total: 0 });
    const [bulkTrackResults, setBulkTrackResults] = useState<{ updated: number; failed: number; total: number } | null>(null);
    const [updatedShipmentIds, setUpdatedShipmentIds] = useState<Set<string>>(new Set());

    // Document viewer modal state
    const [docViewer, setDocViewer] = useState<{
        title: string; label: string; documentData?: string; identifier: string;
        stage: 'SO' | 'BK' | 'CI' | 'BL';
        order?: SalesOrder | CommissionSalesOrder;
        invoice?: Invoice;
        booking?: Booking;
        billOfLading?: BillOfLading;
        shipment?: AggregatedShipment;
    } | null>(null);
    const [docViewTab, setDocViewTab] = useState<'content' | 'pdf'>('content');
    const [fetchedBooking, setFetchedBooking] = useState<Booking | null>(null);

    // Fetch booking from supabase when modal opens for BK and no local booking data
    useEffect(() => {
        if (!docViewer || docViewer.stage !== 'BK') {
            setFetchedBooking(null);
            return;
        }
        const bookingNum = docViewer.shipment?.bookingNumber;
        // Already have booking data
        if (docViewer.booking || !bookingNum) return;

        // Try to find in local bookings prop first
        const localMatch = bookings.find(b => b.bookingNumber === bookingNum);
        if (localMatch) {
            setFetchedBooking(localMatch);
            return;
        }

        // Fetch from supabase
        const fetchBooking = async () => {
            const client = getSupabaseClient();
            if (!client) return;
            console.log('[BK Modal] Fetching booking from supabase:', bookingNum);
            const { data } = await client
                .from('bookings')
                .select('*')
                .eq('bookingNumber', bookingNum)
                .maybeSingle();
            if (data) {
                console.log('[BK Modal] Found booking:', data.bookingNumber);
                setFetchedBooking(data as Booking);
            } else {
                console.log('[BK Modal] No booking found for:', bookingNum);
            }
        };
        fetchBooking();
    }, [docViewer?.stage, docViewer?.shipment?.bookingNumber]);

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

    // Shared ETA lookup core — returns { eta, etd, source, resultParts } or null
    const lookupETACore = async (shipment: AggregatedShipment): Promise<{ eta: string | null; etd: string | null; source: string; resultParts: string[] } | null> => {
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
        } else {
            // --- Fall back to Gemini Search ---
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
            } else {
                return null; // Both failed
            }
        }

        return { eta, etd, source: usedSource, resultParts };
    };

    // Save ETA to related records (booking + commission)
    const saveETAToRecords = async (shipment: AggregatedShipment, eta: string | null, etd: string | null) => {
        // Update booking record
        if (onUpdateBooking && shipment.booking && (eta || etd)) {
            const updatedBooking = { ...shipment.booking };
            if (eta) updatedBooking.eta = eta;
            if (etd) updatedBooking.etd = etd;
            await onUpdateBooking(updatedBooking);
        }
        // Update commission record
        if (onUpdateCommission && (eta || etd)) {
            const sourceId = shipment.order?.id || shipment.invoice?.id;
            if (sourceId) {
                const updates: any = {};
                if (eta) updates.eta = eta;
                if (etd) updates.etd = etd;
                await onUpdateCommission(sourceId, updates);
            }
        }
    };

    // ETA Lookup handler — tries ShipsGo first, then Gemini Search fallback
    const handleETALookup = async (shipment: AggregatedShipment) => {
        if (etaLookupId) return;
        setEtaLookupId(shipment.id);
        setEtaResult(null);

        try {
            console.log('[ETA Lookup] Shipment:', shipment.id, 'BL:', shipment.blNumber);
            const result = await lookupETACore(shipment);

            if (!result) {
                alert('ETA Lookup: No tracking data found from ShipsGo or Gemini Search.');
                return;
            }

            // Save to DB
            await saveETAToRecords(shipment, result.eta, result.etd);
            setUpdatedShipmentIds(prev => new Set(prev).add(shipment.id));

            alert(`🔍 ETA Lookup (${result.source}):\n${result.resultParts.join('\n')}`);

        } catch (err: any) {
            alert(`ETA Lookup failed: ${err.message || 'Unknown error'}`);
        } finally {
            setEtaLookupId(null);
        }
    };

    // Bulk Track All handler
    const handleTrackAll = async () => {
        if (isBulkTracking) return;

        // Find trackable shipments (those with container # or BL #)
        const trackable = filteredShipments.filter(s => {
            const hasContainer = !!(s.billOfLading?.container || s.booking?.containerNumber || (s.order as any)?.containerNumbers);
            const hasBL = !!s.blNumber;
            return hasContainer || hasBL;
        });

        if (trackable.length === 0) {
            alert('No trackable shipments found. Shipments need a container number or BL number.');
            return;
        }

        setIsBulkTracking(true);
        setBulkTrackProgress({ current: 0, total: trackable.length });
        setBulkTrackResults(null);

        let updated = 0;
        let failed = 0;

        for (let i = 0; i < trackable.length; i++) {
            const shipment = trackable[i];
            setBulkTrackProgress({ current: i + 1, total: trackable.length });

            try {
                const result = await lookupETACore(shipment);
                if (result && (result.eta || result.etd)) {
                    await saveETAToRecords(shipment, result.eta, result.etd);
                    setUpdatedShipmentIds(prev => new Set(prev).add(shipment.id));
                    updated++;
                    console.log(`[Track All] ✅ ${i + 1}/${trackable.length} - ${shipment.orderNumber}: ETA=${result.eta}`);
                } else {
                    failed++;
                    console.log(`[Track All] ❌ ${i + 1}/${trackable.length} - ${shipment.orderNumber}: No data`);
                }
            } catch (err) {
                failed++;
                console.error(`[Track All] ❌ ${i + 1}/${trackable.length} - ${shipment.orderNumber}:`, err);
            }

            // Small delay between requests to avoid rate limiting
            if (i < trackable.length - 1) {
                await new Promise(r => setTimeout(r, 500));
            }
        }

        setBulkTrackResults({ updated, failed, total: trackable.length });
        setIsBulkTracking(false);

        // Auto-dismiss results after 10 seconds
        setTimeout(() => setBulkTrackResults(null), 10000);
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
            const billOfLadingByConsigneeMap = new Map<string, BillOfLading[]>();

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
                // Map by consignee name (lowercased, first word) for customer-based matching
                if (bl?.consignee) {
                    const key = bl.consignee.trim().toLowerCase().split(/\s+/)[0];
                    if (key && key.length > 2) {
                        const existing = billOfLadingByConsigneeMap.get(key) || [];
                        existing.push(bl);
                        billOfLadingByConsigneeMap.set(key, existing);
                    }
                }
            });

            console.log('[ShipmentPipeline] B/L maps: byBooking:', billOfLadingMap.size,
                'byBlNumber:', billOfLadingByBlNumberMap.size,
                'byInvoice:', billOfLadingByInvoiceMap.size,
                'byConsignee:', billOfLadingByConsigneeMap.size);

            // Helper: find BL by customer name via consignee matching
            const findBLByCustomer = (customerName: string | undefined, bookingNum?: string): BillOfLading | undefined => {
                if (!customerName) return undefined;
                const key = customerName.trim().toLowerCase().split(/\s+/)[0];
                if (!key || key.length <= 2) return undefined;
                const candidates = billOfLadingByConsigneeMap.get(key);
                if (!candidates || candidates.length === 0) return undefined;
                // If we have a booking number, try to match BL by booking's port/date for more precision
                if (bookingNum) {
                    const booking = bookingMap.get(bookingNum);
                    if (booking?.pod) {
                        const matched = candidates.find(bl => bl.portDischarge?.toLowerCase().includes(booking.pod?.toLowerCase() || ''));
                        if (matched) return matched;
                    }
                }
                // Return the most recent BL for this consignee
                return candidates.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];
            };


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
                    const billOfLading = (booking?.bookingNumber ? billOfLadingMap.get(booking.bookingNumber) : undefined) ||
                        (invoice.bookingNumber ? billOfLadingMap.get(invoice.bookingNumber) : undefined) ||
                        (invoice.bl ? billOfLadingByBlNumberMap.get(invoice.bl) : undefined) ||
                        billOfLadingByInvoiceMap.get(invoice.invoiceNumber) || billOfLadingByInvoiceMap.get(invoice.id) ||
                        findBLByCustomer(invoice.soldTo || invoice.shipTo, invoice.bookingNumber) ||
                        undefined;

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
                    const billOfLading = (booking?.bookingNumber ? billOfLadingMap.get(booking.bookingNumber) : undefined) ||
                        (order.blNumber ? billOfLadingByBlNumberMap.get(order.blNumber) : undefined) ||
                        findBLByCustomer(order.customerName, order.bookingNumber) ||
                        undefined;

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

            // Sort by date (newest first) — use best available date
            return shipments.sort((a, b) => {
                const getDate = (s: AggregatedShipment) => {
                    const d = s.orderDate || (s.order as any)?.createdAt || (s.invoice as any)?.createdAt || s.etd || s.eta || '';
                    return new Date(d || 0).getTime();
                };
                return getDate(b) - getDate(a);
            });
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

        // Filter by type (Invoices vs Commission)
        if (typeFilter === 'SALES') {
            filtered = filtered.filter(s => s.orderType === 'SALES');
        } else if (typeFilter === 'COMMISSION') {
            filtered = filtered.filter(s => s.orderType === 'COMMISSION');
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
    }, [aggregatedShipments, activeTab, searchQuery, selectedCustomers, typeFilter]);

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

        // Helper: get document for a given stage
        const getStageDocument = (stage: 'SO' | 'BK' | 'CI' | 'BL'): { doc: string | undefined; title: string; identifier: string } => {
            switch (stage) {
                case 'SO': {
                    const so = shipment.order;
                    const doc = (so as any)?.originalDocument || (so as any)?.signedDocumentUrl || (so as any)?.originalDocumentUrl;
                    return { doc, title: 'Sales Order', identifier: shipment.orderNumber || '—' };
                }
                case 'BK': {
                    const bk = shipment.booking || bookings.find(b => b.bookingNumber === shipment.bookingNumber);
                    const doc = bk?.originalDocument || (shipment.order as any)?.bookingDocumentUrl;
                    return { doc, title: 'Booking', identifier: shipment.bookingNumber || '—' };
                }
                case 'CI': {
                    const inv = shipment.invoice;
                    const doc = inv?.originalDocument || (shipment.order as any)?.originalDocumentUrl;
                    return { doc, title: 'Commercial Invoice', identifier: shipment.invoiceNumber || '—' };
                }
                case 'BL': {
                    const bl = shipment.billOfLading;
                    const doc = bl?.originalDocument || (shipment.order as any)?.blDocumentUrl;
                    return { doc, title: 'Bill of Lading', identifier: shipment.blNumber || '—' };
                }
            }
        };

        // Helper: open the document/content viewer for a given stage
        const openStageViewer = (stage: 'SO' | 'BK' | 'CI' | 'BL', e?: React.MouseEvent) => {
            if (e) e.stopPropagation();
            const { doc, title, identifier } = getStageDocument(stage);
            // SO, CI, and BK always open (show content view). BL only if doc exists.
            if (stage === 'SO' || stage === 'CI' || stage === 'BK' || doc) {
                const resolvedBooking = shipment.booking || bookings.find(b => b.bookingNumber === shipment.bookingNumber);
                setDocViewTab(stage === 'SO' || stage === 'CI' || stage === 'BK' ? 'content' : 'pdf');
                setDocViewer({
                    title, label: stage, documentData: doc, identifier, stage,
                    order: shipment.order,
                    invoice: shipment.invoice,
                    booking: resolvedBooking,
                    billOfLading: shipment.billOfLading,
                    shipment
                });
            }
        };

        // Check if a stage can be opened (SO, CI, and BK always if record exists; BL only if doc exists)
        const canOpenStage = (stage: 'SO' | 'BK' | 'CI' | 'BL'): boolean => {
            if (stage === 'SO') return shipment.orderStatus !== 'MISSING';
            if (stage === 'CI') return shipment.invoiceStatus !== 'MISSING';
            if (stage === 'BK') return shipment.bookingStatus !== 'MISSING';
            return !!getStageDocument(stage).doc;
        };

        // Inline mini stage indicator with text label
        const MiniStage: React.FC<{ status: StageStatus; label: string; code: string; stage: 'SO' | 'BK' | 'CI' | 'BL' }> = ({ status, label, code, stage }) => {
            const canOpen = canOpenStage(stage);
            return (
                <div
                    className={`flex flex-col items-center ${canOpen ? 'cursor-pointer' : ''}`}
                    title={canOpen ? `View ${label}` : label}
                    onClick={canOpen ? (e) => openStageViewer(stage, e) : undefined}
                >
                    <div className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-all ${status === 'COMPLETE' ? 'bg-emerald-500 text-white' :
                        status === 'PENDING' ? 'bg-amber-400 text-white' :
                            'bg-slate-200 text-slate-400'
                        } ${canOpen ? 'hover:ring-2 hover:ring-blue-400 hover:ring-offset-1 hover:scale-110' : ''}`}>
                        {code}
                    </div>
                </div>
            );
        };

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

                    {/* ETA + Update Button + Updated Indicator */}
                    <div className="w-20 shrink-0 text-xs text-slate-500 flex items-center gap-1">
                        {updatedShipmentIds.has(shipment.id) && (
                            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shrink-0" title="ETA recently updated" />
                        )}
                        <span>{shipment.eta ? new Date(shipment.eta).toLocaleDateString() : '—'}</span>
                        {(shipment.blNumber || shipment.billOfLading?.container || shipment.booking?.containerNumber) && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleETALookup(shipment);
                                }}
                                disabled={etaLookupId === shipment.id || isBulkTracking}
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
                        <MiniStage status={shipment.orderStatus} label="Sales Order" code="SO" stage="SO" />
                        <div className={`w-2 h-0.5 ${shipment.orderStatus === 'COMPLETE' ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                        <MiniStage status={shipment.bookingStatus} label="Booking" code="BK" stage="BK" />
                        <div className={`w-2 h-0.5 ${shipment.bookingStatus === 'COMPLETE' ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                        <MiniStage status={shipment.invoiceStatus} label="Commercial Invoice" code="CI" stage="CI" />
                        <div className={`w-2 h-0.5 ${shipment.invoiceStatus === 'COMPLETE' ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                        <MiniStage status={shipment.blStatus} label="Bill of Lading" code="BL" stage="BL" />
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

                    {/* Order Number */}
                    <div className="w-24 shrink-0">
                        <span className="text-xs text-slate-500 font-mono">{shipment.orderNumber}</span>
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
                            <div
                                className={`bg-white rounded-lg p-3 border border-slate-200 transition-all ${canOpenStage('SO') ? 'cursor-pointer hover:border-blue-400 hover:shadow-md' : ''}`}
                                onClick={() => canOpenStage('SO') && openStageViewer('SO')}
                            >
                                <div className="flex items-center gap-2 mb-2">
                                    <FileText size={16} className="text-blue-500" />
                                    <span className="font-medium text-sm">Order</span>
                                    {canOpenStage('SO') && <Eye size={14} className="text-blue-400 ml-auto" />}
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
                            <div
                                className={`bg-white rounded-lg p-3 border border-slate-200 transition-all ${canOpenStage('BK') ? 'cursor-pointer hover:border-indigo-400 hover:shadow-md' : ''}`}
                                onClick={() => canOpenStage('BK') && openStageViewer('BK')}
                            >
                                <div className="flex items-center gap-2 mb-2">
                                    <Ship size={16} className="text-indigo-500" />
                                    <span className="font-medium text-sm">Booking</span>
                                    {canOpenStage('BK') && <Eye size={14} className="text-indigo-400 ml-auto" />}
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
                            <div
                                className={`bg-white rounded-lg p-3 border border-slate-200 transition-all ${canOpenStage('CI') ? 'cursor-pointer hover:border-green-400 hover:shadow-md' : ''}`}
                                onClick={() => canOpenStage('CI') && openStageViewer('CI')}
                            >
                                <div className="flex items-center gap-2 mb-2">
                                    <ScrollText size={16} className="text-green-500" />
                                    <span className="font-medium text-sm">Invoice</span>
                                    {canOpenStage('CI') && <Eye size={14} className="text-green-400 ml-auto" />}
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
                            <div
                                className={`bg-white rounded-lg p-3 border border-slate-200 transition-all ${canOpenStage('BL') ? 'cursor-pointer hover:border-orange-400 hover:shadow-md' : ''}`}
                                onClick={() => canOpenStage('BL') && openStageViewer('BL')}
                            >
                                <div className="flex items-center gap-2 mb-2">
                                    <FileText size={16} className="text-orange-500" />
                                    <span className="font-medium text-sm">Bill of Lading</span>
                                    {canOpenStage('BL') && <Eye size={14} className="text-orange-400 ml-auto" />}
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
            <div className="mb-6 flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
                        <div className="p-2 bg-gradient-to-r from-orange-500 to-amber-500 rounded-xl text-white">
                            <Ship size={24} />
                        </div>
                        Shipment Pipeline
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">AI-powered shipment tracking and follow-up</p>
                </div>
                <button
                    onClick={handleTrackAll}
                    disabled={isBulkTracking}
                    className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                    title="Track all shipments with container or BL numbers"
                >
                    {isBulkTracking ? (
                        <><Loader2 size={18} className="animate-spin" /> Tracking {bulkTrackProgress.current}/{bulkTrackProgress.total}...</>
                    ) : (
                        <><RefreshCw size={18} /> Track All Vessels</>
                    )}
                </button>
            </div>

            {/* Bulk Tracking Progress Bar */}
            {isBulkTracking && (
                <div className="mb-4 bg-blue-50 rounded-lg p-3 border border-blue-200">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-blue-700 flex items-center gap-2">
                            <Loader2 size={14} className="animate-spin" />
                            Tracking vessel {bulkTrackProgress.current} of {bulkTrackProgress.total}...
                        </span>
                        <span className="text-xs text-blue-600">{Math.round((bulkTrackProgress.current / bulkTrackProgress.total) * 100)}%</span>
                    </div>
                    <div className="w-full bg-blue-200 rounded-full h-2">
                        <div
                            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${(bulkTrackProgress.current / bulkTrackProgress.total) * 100}%` }}
                        />
                    </div>
                </div>
            )}

            {/* Bulk Tracking Results Banner */}
            {bulkTrackResults && (
                <div className={`mb-4 rounded-lg p-3 border flex items-center justify-between ${bulkTrackResults.updated > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                    <span className={`text-sm font-medium flex items-center gap-2 ${bulkTrackResults.updated > 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {bulkTrackResults.updated > 0 ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                        ✅ {bulkTrackResults.updated}/{bulkTrackResults.total} shipments updated.
                        {bulkTrackResults.failed > 0 && ` ${bulkTrackResults.failed} had no tracking data.`}
                    </span>
                    <button onClick={() => setBulkTrackResults(null)} className="text-slate-400 hover:text-slate-600 p-1">
                        <span className="text-xs">✕</span>
                    </button>
                </div>
            )}

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

                    {/* Type Filter Buttons */}
                    <div className="flex gap-1 ml-3">
                        <button
                            onClick={() => setTypeFilter(typeFilter === 'SALES' ? 'ALL' : 'SALES')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${typeFilter === 'SALES'
                                ? 'bg-blue-100 border-blue-300 text-blue-700'
                                : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                                }`}
                        >
                            Invoices
                        </button>
                        <button
                            onClick={() => setTypeFilter(typeFilter === 'COMMISSION' ? 'ALL' : 'COMMISSION')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${typeFilter === 'COMMISSION'
                                ? 'bg-purple-100 border-purple-300 text-purple-700'
                                : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                                }`}
                        >
                            Commission
                        </button>
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
                    <div className="w-24 shrink-0">Order #</div>
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

            {/* Document Viewer Modal */}
            {docViewer && (
                <div
                    className="fixed inset-0 z-[9999] flex items-center justify-center"
                    onClick={() => setDocViewer(null)}
                >
                    {/* Backdrop */}
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

                    {/* Modal */}
                    <div
                        className="relative bg-white rounded-2xl shadow-2xl w-[90vw] max-w-5xl h-[85vh] flex flex-col overflow-hidden"
                        onClick={e => e.stopPropagation()}
                        style={{ animation: 'fadeInScale 0.2s ease-out' }}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-blue-50/30">
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm ${docViewer.label === 'SO' ? 'bg-blue-500' :
                                    docViewer.label === 'BK' ? 'bg-indigo-500' :
                                        docViewer.label === 'CI' ? 'bg-green-500' :
                                            'bg-orange-500'
                                    }`}>
                                    {docViewer.label}
                                </div>
                                <div>
                                    <h2 className="text-lg font-semibold text-slate-800">{docViewer.title}</h2>
                                    <p className="text-sm text-slate-500 font-mono">{docViewer.identifier}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {/* Content/PDF tabs for SO/CI/BK */}
                                {(docViewer.stage === 'SO' || docViewer.stage === 'CI' || docViewer.stage === 'BK') && (
                                    <div className="flex bg-slate-100 rounded-lg p-0.5 mr-2">
                                        <button
                                            onClick={() => setDocViewTab('content')}
                                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${docViewTab === 'content' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
                                        >
                                            Content
                                        </button>
                                        {docViewer.documentData && (
                                            <button
                                                onClick={() => setDocViewTab('pdf')}
                                                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${docViewTab === 'pdf' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
                                            >
                                                PDF
                                            </button>
                                        )}
                                    </div>
                                )}
                                {/* Download */}
                                {docViewer.documentData && (
                                    <button
                                        onClick={() => {
                                            try {
                                                const data = docViewer.documentData!;
                                                let blob: Blob;
                                                if (data.startsWith('data:')) {
                                                    const [header, b64] = data.split(',');
                                                    const mime = header.match(/data:(.*?);/)?.[1] || 'application/pdf';
                                                    const binary = atob(b64);
                                                    const bytes = new Uint8Array(binary.length);
                                                    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                                                    blob = new Blob([bytes], { type: mime });
                                                } else {
                                                    blob = new Blob([data], { type: 'application/pdf' });
                                                }
                                                const url = URL.createObjectURL(blob);
                                                const a = document.createElement('a');
                                                a.href = url;
                                                a.download = `${docViewer.title.replace(/\s+/g, '_')}_${docViewer.identifier}.pdf`;
                                                a.click();
                                                URL.revokeObjectURL(url);
                                            } catch (err) {
                                                alert('Download failed: ' + (err as any)?.message);
                                            }
                                        }}
                                        className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-all"
                                    >
                                        <Download size={16} />
                                        Download
                                    </button>
                                )}
                                {/* Email */}
                                <button
                                    onClick={() => {
                                        const subject = encodeURIComponent(`${docViewer.title} - ${docViewer.identifier}`);
                                        const body = encodeURIComponent(`Please find attached the ${docViewer.title} document (${docViewer.identifier}).\n\nNote: Please download the document from the platform and attach it to this email.`);
                                        window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
                                    }}
                                    className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-all"
                                >
                                    <Mail size={16} />
                                    Email
                                </button>
                                {/* Close */}
                                <button
                                    onClick={() => setDocViewer(null)}
                                    className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-all ml-2"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>

                        {/* Content Area */}
                        <div className="flex-1 overflow-auto bg-slate-100 p-4">
                            {/* ---- SO Content View ---- */}
                            {docViewer.stage === 'SO' && docViewTab === 'content' && (() => {
                                const order = docViewer.order;
                                if (!order) return <p className="text-center text-slate-400 py-8">No order data available</p>;
                                const isCO = docViewer.shipment?.orderType === 'COMMISSION';
                                const co = isCO ? order as CommissionSalesOrder : null;
                                const so = !isCO ? order as SalesOrder : null;
                                const items = isCO ? (co?.items || []) : (so?.items || []);
                                return (
                                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                                        {/* Order Header */}
                                        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4 border-b border-slate-200">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-xl font-bold text-slate-800">{order.orderNumber || docViewer.identifier}</span>
                                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${isCO ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                                            {isCO ? 'COMMISSION' : (so?.orderType || 'SALES')}
                                                        </span>
                                                        {so?.saleType && <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${so.saleType === 'EXPORT' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>{so.saleType}</span>}
                                                    </div>
                                                    <p className="text-sm text-slate-600">{isCO ? co?.customerName : so?.customerName}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-2xl font-bold text-slate-800">
                                                        {so?.currency || 'USD'} {(so?.totalAmount || co?.orderTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </p>
                                                    <p className="text-xs text-slate-500">{order.status || 'N/A'}</p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Order Details Grid */}
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-6 py-4 border-b border-slate-100">
                                            <div>
                                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Date</p>
                                                <p className="text-sm text-slate-700 font-medium">{so?.orderDate ? new Date(so.orderDate).toLocaleDateString() : co?.createdAt ? new Date(co.createdAt).toLocaleDateString() : '—'}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Incoterm</p>
                                                <p className="text-sm text-slate-700 font-medium">{so?.incoterm || co?.incoterm || '—'}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Payment Terms</p>
                                                <p className="text-sm text-slate-700 font-medium">{so?.paymentTerms || co?.paymentTerms || '—'}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Delivery</p>
                                                <p className="text-sm text-slate-700 font-medium">{so?.deliveryMethod || co?.pod || '—'}</p>
                                            </div>
                                            {(so?.pod || co?.pod) && (
                                                <div>
                                                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Destination (POD)</p>
                                                    <p className="text-sm text-slate-700 font-medium">{so?.pod || co?.pod}</p>
                                                </div>
                                            )}
                                            {isCO && co?.sellerName && (
                                                <div>
                                                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Seller</p>
                                                    <p className="text-sm text-slate-700 font-medium">{co.sellerName}</p>
                                                </div>
                                            )}
                                            {co?.bookingNumber && (
                                                <div>
                                                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Booking #</p>
                                                    <p className="text-sm text-slate-700 font-mono font-medium">{co.bookingNumber}</p>
                                                </div>
                                            )}
                                            {co?.blNumber && (
                                                <div>
                                                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">B/L #</p>
                                                    <p className="text-sm text-slate-700 font-mono font-medium">{co.blNumber}</p>
                                                </div>
                                            )}
                                        </div>

                                        {/* Line Items Table */}
                                        <div className="px-6 py-4">
                                            <h3 className="text-sm font-semibold text-slate-700 mb-3">Line Items ({items.length})</h3>
                                            <div className="border border-slate-200 rounded-lg overflow-hidden">
                                                <table className="w-full text-sm">
                                                    <thead>
                                                        <tr className="bg-slate-50 text-left">
                                                            <th className="px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase">#</th>
                                                            <th className="px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase">Product</th>
                                                            <th className="px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase text-right">Qty</th>
                                                            <th className="px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase text-right">Unit Price</th>
                                                            <th className="px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase text-right">Amount</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {items.map((item: any, idx: number) => (
                                                            <tr key={idx} className="border-t border-slate-100 hover:bg-slate-50">
                                                                <td className="px-3 py-2 text-slate-400">{idx + 1}</td>
                                                                <td className="px-3 py-2 text-slate-800 font-medium">{item.productName || item.description || '—'}</td>
                                                                <td className="px-3 py-2 text-right text-slate-700">{(item.quantity || 0).toLocaleString()} {item.unit || item.uom || ''}</td>
                                                                <td className="px-3 py-2 text-right text-slate-700">${(item.unitPrice || item.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                                                <td className="px-3 py-2 text-right font-semibold text-slate-800">${((item.quantity || 0) * (item.unitPrice || item.price || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                    <tfoot>
                                                        <tr className="border-t-2 border-slate-200 bg-slate-50">
                                                            <td colSpan={4} className="px-3 py-2 text-right font-bold text-slate-700">Total</td>
                                                            <td className="px-3 py-2 text-right font-bold text-lg text-slate-800">
                                                                ${(so?.totalAmount || co?.orderTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                            </td>
                                                        </tr>
                                                    </tfoot>
                                                </table>
                                            </div>
                                        </div>

                                        {/* Commission Info (for commission orders only) */}
                                        {isCO && co && (
                                            <div className="px-6 py-3 border-t border-slate-100 bg-purple-50/50">
                                                <div className="flex items-center gap-6 text-sm">
                                                    <span className="text-purple-700 font-medium">Commission: {co.commissionRate}% ({co.commissionType})</span>
                                                    <span className="text-purple-800 font-bold">= ${co.commissionAmount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}

                            {/* ---- CI Content View (matches Delivery Documents Invoice layout) ---- */}
                            {docViewer.stage === 'CI' && docViewTab === 'content' && (() => {
                                const inv = docViewer.invoice;
                                const co = docViewer.shipment?.orderType === 'COMMISSION' ? docViewer.order as CommissionSalesOrder : null;
                                const shp = docViewer.shipment;
                                if (!inv && !co) return <p className="text-center text-slate-400 py-8">No invoice data available</p>;
                                const invItems = inv?.items ? (typeof inv.items === 'string' ? JSON.parse(inv.items) : inv.items) : [];
                                // Parse containers
                                let containersList: any[] = [];
                                try {
                                    if (inv?.containers) {
                                        containersList = typeof inv.containers === 'string' ? JSON.parse(inv.containers) : inv.containers;
                                    }
                                } catch { }
                                // Compute weight totals from items
                                const totalNetLbs = invItems.reduce((s: number, i: any) => s + Number(i.netLbs || i.quantity || 0), 0);
                                const totalNetKg = invItems.reduce((s: number, i: any) => s + Number(i.netKg || (i.netLbs || i.quantity || 0) * 0.453592), 0);
                                const totalGrossLbs = invItems.reduce((s: number, i: any) => s + Number(i.grossLbs || 0), 0);
                                const totalGrossKg = invItems.reduce((s: number, i: any) => s + Number(i.grossKg || (i.grossLbs || 0) * 0.453592), 0);
                                const totalVolumes = invItems.reduce((s: number, i: any) => s + Number(i.volumes || 0), 0);

                                return (
                                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden text-sm">

                                        {/* ===== SHIPPER HEADER ===== */}
                                        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between">
                                            <div>
                                                <p className="font-bold text-slate-800 text-base">{inv?.shipperName || shp?.shipper || 'Shipper'}</p>
                                                {inv?.shipperAddress && <p className="text-xs text-slate-500 mt-0.5">{inv.shipperAddress}</p>}
                                            </div>
                                        </div>

                                        {/* ===== INVOICE TITLE ===== */}
                                        <div className="px-6 pt-3 pb-1">
                                            <h2 className="text-2xl font-light" style={{ color: '#00A0B0' }}>INVOICE</h2>
                                        </div>

                                        {/* ===== BILL TO / SHIP TO / INVOICE INFO (3 columns) ===== */}
                                        <div className="grid grid-cols-3 gap-4 px-6 py-3 border-b border-slate-200">
                                            {/* BILL TO */}
                                            <div>
                                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Bill To</p>
                                                <p className="font-bold text-slate-800">{inv?.billToName || inv?.soldTo || shp?.customerName || '—'}</p>
                                                {inv?.billToAddress && <p className="text-xs text-slate-500 mt-0.5">{inv.billToAddress}</p>}
                                            </div>

                                            {/* SHIP TO */}
                                            <div>
                                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Ship To</p>
                                                <p className="font-bold text-slate-800">{(inv as any)?.consignee || inv?.shipTo || inv?.billToName || inv?.soldTo || '—'}</p>
                                            </div>

                                            {/* INVOICE INFO */}
                                            <div className="space-y-1.5">
                                                <div className="flex justify-between">
                                                    <span className="font-bold text-slate-500 text-xs">INVOICE #</span>
                                                    <span className="font-mono text-slate-800">{inv?.invoiceNumber || co?.invoiceNumber || docViewer.identifier}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="font-bold text-slate-500 text-xs">DATE</span>
                                                    <span className="text-slate-800">{inv?.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString() : '—'}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="font-bold text-slate-500 text-xs">SO #</span>
                                                    <span className="font-mono text-slate-800">{inv?.soNumber || inv?.customerPo || '—'}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="font-bold text-slate-500 text-xs">BOOKING #</span>
                                                    <span className="font-mono text-slate-800">{(inv as any)?.bookingNumber || inv?.transportRef || shp?.bookingNumber || '—'}</span>
                                                </div>
                                                {(inv?.bl || shp?.blNumber) && (
                                                    <div className="flex justify-between">
                                                        <span className="font-bold text-slate-500 text-xs">BL #</span>
                                                        <span className="font-mono text-slate-800">{inv?.bl || shp?.blNumber}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* ===== TERMS / INCOTERM / POD ROW ===== */}
                                        <div className="grid grid-cols-3 gap-4 px-6 py-3 border-b border-slate-200">
                                            <div>
                                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Terms</p>
                                                <p className="font-medium" style={{ color: '#00A0B0' }}>{inv?.paymentTerms || '—'}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Incoterm</p>
                                                <p className="font-medium" style={{ color: '#00A0B0' }}>{inv?.incoterm || '—'}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">POD</p>
                                                <p className="font-medium" style={{ color: '#00A0B0' }}>{(inv as any)?.pod || shp?.pod || '—'}</p>
                                            </div>
                                        </div>

                                        {/* ===== ITEMS TABLE (matches PDF: Description, HS Code, QTY LBS/KG, PRICE $/LB-$/KG, AMOUNT) ===== */}
                                        {Array.isArray(invItems) && invItems.length > 0 && (
                                            <div className="px-6 py-4">
                                                <div className="border border-slate-200 rounded-lg overflow-x-auto">
                                                    <table className="w-full text-sm">
                                                        <thead>
                                                            <tr style={{ backgroundColor: '#E8F4F5' }}>
                                                                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase" style={{ color: '#00A0B0' }}>Description</th>
                                                                <th className="px-2 py-2 text-left text-[10px] font-bold uppercase" style={{ color: '#00A0B0' }}>HS Code</th>
                                                                <th className="px-2 py-2 text-right text-[10px] font-bold uppercase" style={{ color: '#00A0B0' }}>QTY (LBS / KG)</th>
                                                                <th className="px-2 py-2 text-right text-[10px] font-bold uppercase" style={{ color: '#00A0B0' }}>UNIT PRICE ($/LB - $/KG)</th>
                                                                <th className="px-3 py-2 text-right text-[10px] font-bold uppercase" style={{ color: '#00A0B0' }}>Amount US$</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {invItems.map((item: any, idx: number) => {
                                                                const desc = item.customerDescription || item.description || item.productName || '—';
                                                                const hsCode = item.hsCode || '—';
                                                                const netLbs = item.netLbs || item.quantity || 0;
                                                                const netKg = item.netKg || (netLbs * 0.453592);
                                                                const priceLb = item.unitPriceLbs || item.unitPrice || 0;
                                                                const priceKg = item.unitPriceKg || (priceLb * 2.20462);
                                                                const amount = item.amount || (netLbs * priceLb);
                                                                return (
                                                                    <tr key={idx} className="border-t border-slate-100 hover:bg-slate-50 align-top">
                                                                        <td className="px-3 py-2 text-slate-800 font-medium">
                                                                            {desc}
                                                                            {(item.containerNo || item.sealNo) && (
                                                                                <div className="text-[10px] text-slate-400 mt-0.5">
                                                                                    {item.containerNo && <span>Cntr: {item.containerNo}</span>}
                                                                                    {item.containerNo && item.sealNo && <span className="mx-1">·</span>}
                                                                                    {item.sealNo && <span>Seal: {item.sealNo}</span>}
                                                                                </div>
                                                                            )}
                                                                        </td>
                                                                        <td className="px-2 py-2 text-slate-600 font-mono text-xs">{hsCode}</td>
                                                                        <td className="px-2 py-2 text-right text-slate-700 whitespace-nowrap">
                                                                            <div>{netLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} lbs</div>
                                                                            <div className="text-slate-400">{netKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg</div>
                                                                        </td>
                                                                        <td className="px-2 py-2 text-right text-slate-700 whitespace-nowrap">
                                                                            <div>${priceLb.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/lb</div>
                                                                            <div className="text-slate-400">${priceKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/kg</div>
                                                                        </td>
                                                                        <td className="px-3 py-2 text-right font-semibold text-slate-800">${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        )}

                                        {/* ===== WEIGHT & CONTAINER INFO / TOTAL ===== */}
                                        <div className="px-6 py-3 border-t border-slate-100 flex items-start justify-between">
                                            {/* Left: Weight & Container info */}
                                            <div className="space-y-1 text-xs text-slate-600">
                                                <p>Net weight: <span className="font-medium text-slate-800">{(inv?.netWeight || totalNetKg.toLocaleString(undefined, { minimumFractionDigits: 1 }))} {inv?.netWeight ? '' : 'Kgs'}</span></p>
                                                <p>Gross Weight: <span className="font-medium text-slate-800">{(inv?.grossWeight || totalGrossKg.toLocaleString(undefined, { minimumFractionDigits: 1 }))} {inv?.grossWeight ? '' : 'Kgs'}</span></p>
                                                {totalVolumes > 0 && <p>Total volumes: <span className="font-medium text-slate-800">{totalVolumes}</span></p>}
                                                {/* Container details */}
                                                {Array.isArray(containersList) && containersList.length > 0 && (
                                                    <div className="mt-2 pt-2 border-t border-slate-100">
                                                        <p className="font-bold text-slate-700 mb-1">Container No. &nbsp; Seal No. &nbsp; Volumes</p>
                                                        {containersList.map((c: any, i: number) => {
                                                            const contNo = c.container || c.containerNumber || c.containerNo || '—';
                                                            const sealNo = c.seal || c.sealNumber || c.sealNo || '';
                                                            const contItems = invItems.filter((itm: any) => itm.containerNo === contNo);
                                                            const contVolumes = contItems.reduce((s: number, itm: any) => s + (itm.volumes || 0), 0);
                                                            return (
                                                                <p key={i} className="font-mono text-slate-600">
                                                                    {contNo} &nbsp; {sealNo} &nbsp; {contVolumes || '—'}
                                                                </p>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Right: TOTAL */}
                                            <div className="text-right">
                                                <p className="text-xs font-bold text-slate-500 uppercase mb-1">Total</p>
                                                <p className="text-2xl font-bold" style={{ color: '#00A0B0' }}>
                                                    ${(inv?.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </p>
                                            </div>
                                        </div>

                                        {/* ===== BANK DETAILS ===== */}
                                        {(inv?.bankName || inv?.accountNumber) && (
                                            <div className="px-6 py-3 border-t border-slate-200" style={{ backgroundColor: '#E8F4F5' }}>
                                                <h3 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: '#00A0B0' }}>Bank Details</h3>
                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                                                    {inv?.bankName && <div><span className="text-slate-500">Bank: </span><span className="font-medium text-slate-800">{inv.bankName}</span></div>}
                                                    {inv?.bankAddress && <div><span className="text-slate-500">Address: </span><span className="font-medium text-slate-800">{inv.bankAddress}</span></div>}
                                                    {inv?.swiftCode && <div><span className="text-slate-500">SWIFT: </span><span className="font-mono font-medium text-slate-800">{inv.swiftCode}</span></div>}
                                                    {inv?.accountNumber && <div><span className="text-slate-500">Account: </span><span className="font-mono font-medium text-slate-800">{inv.accountNumber}</span></div>}
                                                    {inv?.routingNumber && <div><span className="text-slate-500">Routing: </span><span className="font-mono font-medium text-slate-800">{inv.routingNumber}</span></div>}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}

                            {/* ---- BK Content View ---- */}
                            {docViewer.stage === 'BK' && docViewTab === 'content' && (() => {
                                // Try docViewer.booking first, then fetchedBooking from supabase
                                const bk = (docViewer.booking || fetchedBooking) as any;
                                const shipment = docViewer.shipment;
                                // If no booking record at all, show data from shipment
                                const display = bk || {
                                    bookingNumber: shipment?.bookingNumber,
                                    customer: shipment?.customerName,
                                    pol: shipment?.pol,
                                    pod: shipment?.pod,
                                    etd: shipment?.etd,
                                    eta: shipment?.eta,
                                    status: shipment?.bookingStatus,
                                    vesselVoyage: null,
                                    carrier: null,
                                    equipment: null,
                                    containerNumber: null,
                                    blNumber: shipment?.blNumber,
                                };
                                return (
                                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden max-w-3xl mx-auto">
                                        {/* Booking Header */}
                                        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-4">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <h3 className="text-lg font-bold">Booking Confirmation</h3>
                                                    <p className="text-indigo-200 text-sm font-mono mt-0.5">{display.bookingNumber || '—'}</p>
                                                </div>
                                                {display.status && (
                                                    <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${display.status === 'ACTIVE' || display.status === 'SHIPPED' || display.status === 'COMPLETE' ? 'bg-emerald-400/20 text-emerald-100' :
                                                            display.status === 'CANCELLED' ? 'bg-red-400/20 text-red-200' :
                                                                'bg-white/20 text-white'
                                                        }`}>
                                                        {display.status}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Routing: POL → POD */}
                                        <div className="px-6 py-4 bg-gradient-to-r from-indigo-50/50 to-purple-50/50 border-b border-slate-100">
                                            <div className="flex items-center justify-center gap-6">
                                                <div className="text-center">
                                                    <p className="text-[10px] text-slate-400 uppercase font-bold">Port of Loading</p>
                                                    <p className="text-lg font-bold text-indigo-700">{display.pol || '—'}</p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-8 h-0.5 bg-indigo-300"></div>
                                                    <Ship size={20} className="text-indigo-500" />
                                                    <div className="w-8 h-0.5 bg-indigo-300"></div>
                                                </div>
                                                <div className="text-center">
                                                    <p className="text-[10px] text-slate-400 uppercase font-bold">Port of Discharge</p>
                                                    <p className="text-lg font-bold text-indigo-700">{display.pod || '—'}</p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Details Grid */}
                                        <div className="px-6 py-4 grid grid-cols-2 md:grid-cols-3 gap-4">
                                            <div>
                                                <p className="text-[10px] text-slate-400 uppercase font-bold">Customer</p>
                                                <p className="text-sm font-semibold text-slate-800">{display.customer || '—'}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-slate-400 uppercase font-bold">Vessel / Voyage</p>
                                                <p className="text-sm font-semibold text-slate-800">{display.vesselVoyage || '—'}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-slate-400 uppercase font-bold">Carrier</p>
                                                <p className="text-sm font-semibold text-slate-800">{display.carrier || '—'}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-slate-400 uppercase font-bold">Equipment</p>
                                                <p className="text-sm font-semibold text-slate-800">{display.equipment || '—'}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-slate-400 uppercase font-bold">Container #</p>
                                                <p className="text-sm font-mono font-semibold text-slate-800">{display.containerNumber || '—'}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-slate-400 uppercase font-bold">B/L #</p>
                                                <p className="text-sm font-mono font-semibold text-slate-800">{display.blNumber || '—'}</p>
                                            </div>
                                        </div>

                                        {/* Dates */}
                                        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50">
                                            <h4 className="text-[10px] text-slate-400 uppercase font-bold mb-3">Schedule & Cut-Off Dates</h4>
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                <div>
                                                    <p className="text-[10px] text-slate-400 uppercase">ETD</p>
                                                    <p className="text-sm font-semibold text-slate-800">{display.etd ? new Date(display.etd).toLocaleDateString() : '—'}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[10px] text-slate-400 uppercase">ETA</p>
                                                    <p className="text-sm font-semibold text-slate-800">{display.eta ? new Date(display.eta).toLocaleDateString() : '—'}</p>
                                                </div>
                                                {display.cargoCutOff && (
                                                    <div>
                                                        <p className="text-[10px] text-slate-400 uppercase">Cargo Cut-Off</p>
                                                        <p className="text-sm font-semibold text-amber-700">{new Date(display.cargoCutOff).toLocaleDateString()}</p>
                                                    </div>
                                                )}
                                                {display.vgmCutOff && (
                                                    <div>
                                                        <p className="text-[10px] text-slate-400 uppercase">VGM Cut-Off</p>
                                                        <p className="text-sm font-semibold text-amber-700">{new Date(display.vgmCutOff).toLocaleDateString()}</p>
                                                    </div>
                                                )}
                                                {display.draftCutOff && (
                                                    <div>
                                                        <p className="text-[10px] text-slate-400 uppercase">Draft Cut-Off</p>
                                                        <p className="text-sm font-semibold text-amber-700">{new Date(display.draftCutOff).toLocaleDateString()}</p>
                                                    </div>
                                                )}
                                                {display.freeTime && (
                                                    <div>
                                                        <p className="text-[10px] text-slate-400 uppercase">Free Time</p>
                                                        <p className="text-sm font-semibold text-slate-800">{display.freeTime}</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Terminal & Agent */}
                                        {(display.terminal || display.agentName) && (
                                            <div className="px-6 py-4 border-t border-slate-100">
                                                <div className="grid grid-cols-2 gap-4">
                                                    {display.terminal && (
                                                        <div>
                                                            <p className="text-[10px] text-slate-400 uppercase font-bold">Terminal</p>
                                                            <p className="text-sm font-semibold text-slate-800">{display.terminal}</p>
                                                        </div>
                                                    )}
                                                    {display.agentName && (
                                                        <div>
                                                            <p className="text-[10px] text-slate-400 uppercase font-bold">Cargo Agent</p>
                                                            <p className="text-sm font-semibold text-slate-800">{display.agentName}</p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* No PDF notice */}
                                        {!docViewer.documentData && !bk?.originalDocument && (
                                            <div className="px-6 py-4 border-t border-slate-100 bg-amber-50">
                                                <p className="text-xs text-amber-700 flex items-center gap-2">
                                                    <AlertTriangle size={14} />
                                                    No original PDF document uploaded for this booking.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}

                            {/* ---- PDF Viewer (for BL always, or SO/CI/BK when pdf tab selected) ---- */}
                            {(docViewer.stage === 'BL' || docViewTab === 'pdf') && docViewer.documentData && (() => {
                                const data = docViewer.documentData!;
                                if (data.startsWith('data:application/pdf') || data.startsWith('data:application/octet-stream')) {
                                    return (
                                        <iframe
                                            src={data}
                                            className="w-full h-full rounded-lg bg-white shadow-inner"
                                            style={{ minHeight: '100%' }}
                                            title={docViewer.title}
                                        />
                                    );
                                } else if (data.startsWith('data:image')) {
                                    return (
                                        <div className="flex items-center justify-center h-full">
                                            <img
                                                src={data}
                                                alt={docViewer.title}
                                                className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
                                            />
                                        </div>
                                    );
                                } else if (data.startsWith('http')) {
                                    return (
                                        <iframe
                                            src={data}
                                            className="w-full h-full rounded-lg bg-white shadow-inner"
                                            style={{ minHeight: '100%' }}
                                            title={docViewer.title}
                                        />
                                    );
                                } else {
                                    return (
                                        <iframe
                                            src={`data:application/pdf;base64,${data}`}
                                            className="w-full h-full rounded-lg bg-white shadow-inner"
                                            style={{ minHeight: '100%' }}
                                            title={docViewer.title}
                                        />
                                    );
                                }
                            })()}
                        </div>
                    </div>
                </div>
            )}

            {/* Animation keyframes */}
            <style>{`
                @keyframes fadeInScale {
                    from { opacity: 0; transform: scale(0.95); }
                    to { opacity: 1; transform: scale(1); }
                }
            `}</style>
        </div>
    );
};

export default ShipmentPipeline;
