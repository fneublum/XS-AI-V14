import React, { useState, useMemo } from 'react';
import {
    InventoryItem, Booking, BillOfLading, FreightQuote, SalesOrder,
    CargoAgent, Customer, Port, Invoice
} from '../types';
import {
    Ship, Anchor, TrendingUp, Package, MapPin, Filter, X, ArrowUp, ArrowDown,
    FileText, DollarSign, Calendar, Users, Building, Truck, Send, Plus,
    CheckCircle2, Clock, AlertCircle, Search, ChevronRight, ChevronDown, Globe, Plane,
    ClipboardList, RefreshCw, ExternalLink, Eye, Edit2, Trash2, Info, Save, Mail, Loader2
} from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

interface LogisticsProps {
    bookings: Booking[];
    billOfLadings: BillOfLading[];
    inventory: InventoryItem[];
    freightQuotes?: FreightQuote[];
    salesOrders?: SalesOrder[];
    cargoAgents?: CargoAgent[];
    customers?: Customer[];
    ports?: Port[];
    invoices?: Invoice[];
    currentCompanyId?: string;
    onUpdateSalesOrder?: (record: SalesOrder) => Promise<SalesOrder | null>;
    onUpdateFreightQuote?: (record: FreightQuote) => Promise<FreightQuote | null>;
}

type ActiveWindow = 'QUOTES' | 'REQUEST' | 'FOLLOW_UP' | 'INVOICE_FOLLOW_UP';
type FollowUpTab = 'TO_SHIP' | 'SHIPPED';
type QuoteStatusFilter = 'ALL' | 'PENDING' | 'ACTIVE' | 'EXPIRED';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatCurrency = (amount?: number, currency: string = 'USD') => {
    if (typeof amount !== 'number') return 'N/A';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
};

const getServiceLabel = (type?: string) => {
    switch (type) {
        case 'PORT_PORT': return 'Port to Port';
        case 'PORT_DOOR': return 'Port to Door';
        case 'DOOR_PORT': return 'Door to Port';
        case 'DOOR_DOOR': return 'Door to Door';
        default: return type || 'N/A';
    }
};

// Helper to extract port code from strings like "Houston (USHOU)" or "Manaus (BRMAO)"
const extractPortCode = (portStr: string): string => {
    if (!portStr) return '';
    // Try to extract code from parentheses: "Name (CODE)" -> "CODE"
    const parenMatch = portStr.match(/\(([A-Z0-9]{3,6})\)/i);
    if (parenMatch) return parenMatch[1].toUpperCase();
    // Try to extract from format: "CODE - Name" -> "CODE"
    const dashMatch = portStr.match(/^([A-Z0-9]{3,6})\s*[-–—:]/i);
    if (dashMatch) return dashMatch[1].toUpperCase();
    return portStr.trim();
};

// Helper to extract just the port name (without code) from strings like "Houston (USHOU)"
const extractPortName = (portStr: string): string => {
    if (!portStr) return '';
    // Remove code in parentheses: "Houston (USHOU)" -> "Houston"
    return portStr.replace(/\s*\([A-Z0-9]{3,6}\)\s*$/i, '').trim();
};

const getStatusColor = (status?: string) => {
    switch (status) {
        case 'ACTIVE': case 'APPROVED': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
        case 'PENDING': return 'bg-amber-100 text-amber-700 border-amber-200';
        case 'EXPIRED': case 'REJECTED': return 'bg-red-100 text-red-700 border-red-200';
        case 'SHIPPED': case 'FULFILLED': return 'bg-blue-100 text-blue-700 border-blue-200';
        default: return 'bg-slate-100 text-slate-600 border-slate-200';
    }
};

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
    rate: q.rate !== undefined ? q.rate : 0,
    status: q.status || 'PENDING'
});

const formatPortDisplay = (val?: string) => {
    if (!val) return 'N/A';
    let s = val.trim();
    const prefixMatch = s.match(/^([A-Z0-9]{3,6})\s*[\-\–\—\:]\s*([^,(\[]+)/);
    if (prefixMatch) return `${prefixMatch[1].toUpperCase()} - ${prefixMatch[2].trim()}`;
    const suffixMatch = s.match(/^([^,(\[]+).*\(([A-Z0-9]{3,6})\)/);
    if (suffixMatch) return `${suffixMatch[2].toUpperCase()} - ${suffixMatch[1].trim()}`;
    return s.split(',')[0].trim();
};

// ============================================================================
// COMPONENT
// ============================================================================

const Logistics: React.FC<LogisticsProps> = ({
    bookings,
    billOfLadings,
    inventory,
    freightQuotes = [],
    salesOrders = [],
    cargoAgents = [],
    customers = [],
    ports = [],
    invoices = [],
    currentCompanyId,
    onUpdateSalesOrder,
    onUpdateFreightQuote
}) => {
    // Window State
    const [activeWindow, setActiveWindow] = useState<ActiveWindow>('QUOTES');
    const [followUpTab, setFollowUpTab] = useState<FollowUpTab>('TO_SHIP');

    // Window 1: Freight Quotes State
    const [quoteStatusFilter, setQuoteStatusFilter] = useState<QuoteStatusFilter>('ALL');
    const [quoteSearch, setQuoteSearch] = useState('');
    const [quoteSortConfig, setQuoteSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

    // Route Filters
    const [soFilter, setSoFilter] = useState('');
    const [soPickupLocation, setSoPickupLocation] = useState('');
    const [zipFilter, setZipFilter] = useState('');
    const [poaFilter, setPoaFilter] = useState('');
    const [podFilter, setPodFilter] = useState('');

    // Window 2: Request Quotes State
    const [selectedSO, setSelectedSO] = useState<SalesOrder | null>(null);
    const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
    const [manualOriginPort, setManualOriginPort] = useState('');
    const [manualDestPort, setManualDestPort] = useState('');
    const [manualPickupZip, setManualPickupZip] = useState('');

    // Quote Action Modals State
    const [viewQuote, setViewQuote] = useState<FreightQuote | null>(null);
    const [editQuote, setEditQuote] = useState<FreightQuote | null>(null);
    const [deleteQuote, setDeleteQuote] = useState<FreightQuote | null>(null);
    const [editFormData, setEditFormData] = useState<Partial<FreightQuote>>({});

    // Email Preview Modal State
    const [emailPreviewOpen, setEmailPreviewOpen] = useState(false);
    const [emailSubject, setEmailSubject] = useState('');
    const [emailBody, setEmailBody] = useState('');
    const [sendingEmail, setSendingEmail] = useState(false);

    // Sales Order View Modal State (Order Follow-Up)
    const [viewSalesOrder, setViewSalesOrder] = useState<SalesOrder | null>(null);
    const [editSalesOrder, setEditSalesOrder] = useState<SalesOrder | null>(null);
    const [editSoFormData, setEditSoFormData] = useState<Partial<SalesOrder>>({});
    const [savingSalesOrder, setSavingSalesOrder] = useState(false);

    // Invoice Follow-Up Filters
    const [invoiceSearch, setInvoiceSearch] = useState('');
    const [invoiceCustomerFilter, setInvoiceCustomerFilter] = useState('');
    const [invoicePoaFilter, setInvoicePoaFilter] = useState('');
    const [invoicePodFilter, setInvoicePodFilter] = useState('');

    // Document Viewer Modal State
    const [viewingDocument, setViewingDocument] = useState<{
        type: 'invoice' | 'booking' | 'bl' | 'so';
        title: string;
        url: string;
        docNumber: string;
    } | null>(null);


    // ========================================================================
    // DERIVED DATA
    // ========================================================================

    // Freight Quotes - filtered and sorted
    const filteredQuotes = useMemo(() => {
        // Normalize data to handle snake_case from DB
        let result = freightQuotes.map(normalizeQuote);

        // DEBUG: Log initial state
        console.log('=== filteredQuotes DEBUG ===');
        console.log('Initial quotes:', result.length);
        console.log('Filters:', { soFilter, zipFilter, poaFilter, podFilter, quoteStatusFilter });

        // Status filter
        if (quoteStatusFilter !== 'ALL') {
            result = result.filter(q => q.status === quoteStatusFilter);
            console.log('After status filter:', result.length);
        }

        // Route filters - use flexible matching for ports
        // Handle SO format like "Houston (USHOU)" matching quote format like "Houston"
        if (zipFilter) {
            const beforeZip = result.length;
            result = result.filter(q => q.pickupZip === zipFilter);
            console.log(`After ZIP filter "${zipFilter}":`, beforeZip, '->', result.length);
        }
        if (poaFilter) {
            // Extract just the port name from filters like "Houston (USHOU)" -> "Houston"
            const filterName = extractPortName(poaFilter).toLowerCase();
            const filterCode = extractPortCode(poaFilter);
            const beforePoa = result.length;
            result = result.filter(q => {
                const qPortName = extractPortName(q.originPort || '').toLowerCase();
                const qCode = q.originPortCode?.toUpperCase() || extractPortCode(q.originPort || '');
                // Match by: port name, port code, or partial match
                return qPortName === filterName ||
                    (filterCode && qCode === filterCode) ||
                    qPortName.includes(filterName) ||
                    filterName.includes(qPortName);
            });
            console.log(`After POA filter "${poaFilter}" (name: ${filterName}):`, beforePoa, '->', result.length);
        }
        if (podFilter) {
            // Extract just the port name from filters like "Manaus (BRMAO)" -> "Manaus"
            const filterName = extractPortName(podFilter).toLowerCase();
            const filterCode = extractPortCode(podFilter);
            const beforePod = result.length;
            result = result.filter(q => {
                const qPortName = extractPortName(q.destinationPort || '').toLowerCase();
                const qCode = q.destinationPortCode?.toUpperCase() || extractPortCode(q.destinationPort || '');
                // Match by: port name, port code, or partial match
                return qPortName === filterName ||
                    (filterCode && qCode === filterCode) ||
                    qPortName.includes(filterName) ||
                    filterName.includes(qPortName);
            });
            console.log(`After POD filter "${podFilter}" (name: ${filterName}):`, beforePod, '->', result.length);
        }

        // Search filter
        if (quoteSearch.trim()) {
            const search = quoteSearch.toLowerCase();
            result = result.filter(q =>
                q.agentName?.toLowerCase().includes(search) ||
                q.originPort?.toLowerCase().includes(search) ||
                q.destinationPort?.toLowerCase().includes(search)
            );
        }

        // Sorting - custom sort takes precedence, otherwise default to route grouping
        if (quoteSortConfig) {
            result.sort((a, b) => {
                const aVal = (a as any)[quoteSortConfig.key] || '';
                const bVal = (b as any)[quoteSortConfig.key] || '';
                if (aVal < bVal) return quoteSortConfig.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return quoteSortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        } else {
            // Default: Group by same route (pickupZip, POA, POD) for easy comparison
            result.sort((a, b) => {
                // First by pickupZip
                const zipA = (a.pickupZip || '').toLowerCase();
                const zipB = (b.pickupZip || '').toLowerCase();
                if (zipA !== zipB) return zipA.localeCompare(zipB);

                // Then by origin port (POA)
                const poaA = (a.originPort || a.originPortCode || '').toLowerCase();
                const poaB = (b.originPort || b.originPortCode || '').toLowerCase();
                if (poaA !== poaB) return poaA.localeCompare(poaB);

                // Then by destination port (POD)
                const podA = (a.destinationPort || a.destinationPortCode || '').toLowerCase();
                const podB = (b.destinationPort || b.destinationPortCode || '').toLowerCase();
                if (podA !== podB) return podA.localeCompare(podB);

                // Finally by rate (ascending) for easy cost comparison
                return (a.rate || 0) - (b.rate || 0);
            });
        }

        return result;
    }, [freightQuotes, quoteStatusFilter, quoteSearch, quoteSortConfig, zipFilter, poaFilter, podFilter]);

    // Unique values for route filter dropdowns
    const uniqueZips = useMemo(() => {
        const normalized = freightQuotes.map(normalizeQuote);
        const zips = normalized.map(q => q.pickupZip).filter(z => z && z.trim());
        return Array.from(new Set(zips)).sort();
    }, [freightQuotes]);

    const uniquePOAs = useMemo(() => {
        const normalized = freightQuotes.map(normalizeQuote);
        const poas = normalized.map(q => q.originPort || q.originPortCode).filter(p => p && p.trim());
        return Array.from(new Set(poas)).sort();
    }, [freightQuotes]);

    const uniquePODs = useMemo(() => {
        const normalized = freightQuotes.map(normalizeQuote);
        const pods = normalized.map(q => q.destinationPort || q.destinationPortCode).filter(p => p && p.trim());
        return Array.from(new Set(pods)).sort();
    }, [freightQuotes]);

    // Sales Orders eligible for freight quote requests (approved exports)
    const eligibleSOs = useMemo(() => {
        return salesOrders.filter(so =>
            so.status === 'APPROVED' &&
            (so.saleType === 'EXPORT' || so.deliveryMethod?.includes('PORT'))
        );
    }, [salesOrders]);

    // Orders to ship (approved but no booking linked)
    const ordersToShip = useMemo(() => {
        const bookedSOIds = new Set(bookings.filter(b => b.salesOrderId).map(b => b.salesOrderId));
        return salesOrders.filter(so =>
            so.status === 'APPROVED' && !bookedSOIds.has(so.id)
        );
    }, [salesOrders, bookings]);

    // Invoices needing follow-up (pending payment, etc.) - enriched with booking/BL data
    const pendingInvoices = useMemo(() => {
        const bookingMap = new Map<string, Booking>(bookings.map(b => [b.bookingNumber, b]));
        const blMap = new Map<string, BillOfLading>(billOfLadings.map(bl => [bl.blNumber, bl]));
        // Also create a map by booking number for BLs
        const blByBookingMap = new Map<string, BillOfLading>();
        billOfLadings.forEach(bl => {
            if (bl.bookingNumber) blByBookingMap.set(bl.bookingNumber, bl);
        });
        // Create normalized booking number map for fuzzy matching
        const normalizedBlByBookingMap = new Map<string, BillOfLading>();

        // Normalize function for fuzzy matching
        const normalize = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

        billOfLadings.forEach(bl => {
            if (bl.bookingNumber) {
                const normalized = normalize(bl.bookingNumber);
                if (normalized) normalizedBlByBookingMap.set(normalized, bl);
            }
        });

        // Create a map of bookings by blNumber for reverse lookup
        const bookingByBlMap = new Map<string, Booking>();
        bookings.forEach(b => {
            if (b.blNumber) bookingByBlMap.set(b.blNumber, b);
        });

        // Create SO-to-Booking map
        const bookingBySoIdMap = new Map<string, Booking>();
        bookings.forEach(b => {
            if (b.salesOrderId) bookingBySoIdMap.set(b.salesOrderId, b);
        });

        return invoices
            .filter(inv => inv.totalAmount > 0)
            .map(inv => {
                // First, try to find the booking
                let booking: Booking | undefined = inv.bookingNumber ? bookingMap.get(inv.bookingNumber) : undefined;

                // If no booking found directly, try normalized match
                if (!booking && inv.bookingNumber) {
                    const invBookingNorm = normalize(inv.bookingNumber);
                    for (const [bNum, b] of bookingMap.entries()) {
                        if (normalize(bNum) === invBookingNorm) {
                            booking = b;
                            break;
                        }
                    }
                }

                // Try multiple ways to find the BL - ENHANCED ALGORITHM
                let bl: BillOfLading | undefined;

                // 1. Direct match via invoice.bl field
                if (inv.bl) {
                    bl = blMap.get(inv.bl);
                    // Also try normalized match
                    if (!bl) {
                        const invBlNorm = normalize(inv.bl);
                        bl = billOfLadings.find(b => normalize(b.blNumber) === invBlNorm);
                    }
                }

                // 2. Via booking's blNumber (from the linked booking record)
                if (!bl && booking?.blNumber) {
                    bl = blMap.get(booking.blNumber);
                    // Also try normalized
                    if (!bl) {
                        const bookingBlNorm = normalize(booking.blNumber);
                        bl = billOfLadings.find(b => normalize(b.blNumber) === bookingBlNorm);
                    }
                }

                // 3. CRITICAL: Check if invoice.bookingNumber IS ACTUALLY a BL number!
                //    Some invoices store the BL number in the bookingNumber field
                if (!bl && inv.bookingNumber) {
                    // Try exact match first
                    bl = blMap.get(inv.bookingNumber);
                    // Try normalized match
                    if (!bl) {
                        const invBookingNorm = normalize(inv.bookingNumber);
                        bl = billOfLadings.find(b => normalize(b.blNumber) === invBookingNorm);
                    }
                }

                // 4. Via BL's bookingNumber matching invoice bookingNumber (exact)
                if (!bl && inv.bookingNumber) {
                    bl = blByBookingMap.get(inv.bookingNumber);
                }

                // 5. Via BL's bookingNumber matching invoice bookingNumber (normalized)
                if (!bl && inv.bookingNumber) {
                    const invBookingNorm = normalize(inv.bookingNumber);
                    bl = normalizedBlByBookingMap.get(invBookingNorm);
                }

                // 5. Prefix/partial match on booking number (e.g., CDM0181239 might match CDM018123900)
                if (!bl && inv.bookingNumber) {
                    const invBookingNorm = normalize(inv.bookingNumber);
                    if (invBookingNorm.length >= 6) {
                        bl = billOfLadings.find(b => {
                            const blBookingNorm = normalize(b.bookingNumber || '');
                            return blBookingNorm.startsWith(invBookingNorm) ||
                                invBookingNorm.startsWith(blBookingNorm) ||
                                blBookingNorm.includes(invBookingNorm) ||
                                invBookingNorm.includes(blBookingNorm);
                        });
                    }
                }

                // 6. Match via container number (if invoice has containers)
                if (!bl && inv.containers) {
                    const invContainers = typeof inv.containers === 'string' ? inv.containers : (inv.containers as any[]).map((c: any) => c.container || c.containerNo || c).join(',');
                    const invContainerNorm = normalize(invContainers);
                    if (invContainerNorm.length > 6) {
                        bl = billOfLadings.find(b => {
                            const blContainerNorm = normalize(b.container || '');
                            return blContainerNorm && (
                                invContainerNorm.includes(blContainerNorm) ||
                                blContainerNorm.includes(invContainerNorm.slice(0, 11)) // Container numbers are usually 11 chars
                            );
                        });
                    }
                }

                // 7. Match via consignee name (more lenient)
                if (!bl && inv.consignee) {
                    const invConsigneeNorm = normalize(inv.consignee);
                    if (invConsigneeNorm.length > 4) {
                        bl = billOfLadings.find(b => {
                            const blConsigneeNorm = normalize(b.consignee || '');
                            return blConsigneeNorm.includes(invConsigneeNorm.slice(0, 8)) ||
                                invConsigneeNorm.includes(blConsigneeNorm.slice(0, 8));
                        });
                    }
                }

                // 8. Match via shipper name (soldTo or shipperName)
                if (!bl && (inv.soldTo || inv.shipperName)) {
                    const invShipperNorm = normalize(inv.soldTo || inv.shipperName || '');
                    if (invShipperNorm.length > 4) {
                        bl = billOfLadings.find(b => {
                            const blShipperNorm = normalize(b.shipper || '');
                            const blConsigneeNorm = normalize(b.consignee || '');
                            return blShipperNorm.includes(invShipperNorm.slice(0, 6)) ||
                                invShipperNorm.includes(blShipperNorm.slice(0, 6)) ||
                                blConsigneeNorm.includes(invShipperNorm.slice(0, 6)) ||
                                invShipperNorm.includes(blConsigneeNorm.slice(0, 6));
                        });
                    }
                }

                // 9. Match via SO number if invoice has soNumber
                if (!bl && inv.soNumber) {
                    // Check if there's a booking linked to this SO
                    const soBooking = bookingBySoIdMap.get(inv.soNumber);
                    if (soBooking?.blNumber) {
                        bl = blMap.get(soBooking.blNumber);
                    }
                    // Also check if any BL has this booking's bookingNumber
                    if (!bl && soBooking?.bookingNumber) {
                        bl = blByBookingMap.get(soBooking.bookingNumber);
                    }
                }

                // 10. Match by invoice date proximity + POD (if available)
                if (!bl && inv.pod && inv.invoiceDate) {
                    const invDateObj = new Date(inv.invoiceDate);
                    const invPodNorm = normalize(inv.pod);
                    bl = billOfLadings.find(b => {
                        const blPodNorm = normalize(b.portDischarge || '');
                        if (!blPodNorm.includes(invPodNorm.slice(0, 4)) && !invPodNorm.includes(blPodNorm.slice(0, 4))) return false;
                        // Check if BL shipped date is within 60 days of invoice date
                        if (b.shippedDate) {
                            const blDate = new Date(b.shippedDate);
                            const diffDays = Math.abs((invDateObj.getTime() - blDate.getTime()) / (1000 * 60 * 60 * 24));
                            return diffDays < 60;
                        }
                        return false;
                    });
                }

                // Calculate ETA: BL shippedDate + booking transit time (if available)
                let calculatedEta = '';
                if (bl?.shippedDate && booking?.eta) {
                    // Use booking ETA directly if available
                    calculatedEta = booking.eta;
                } else if (bl?.eta) {
                    calculatedEta = bl.eta;
                } else if (booking?.eta) {
                    calculatedEta = booking.eta;
                }

                // Calculate ETA days remaining
                let etaDays: number | null = null;
                let etaStatus: 'arrived' | 'urgent' | 'soon' | 'normal' | null = null;
                if (calculatedEta) {
                    const etaDate = new Date(calculatedEta);
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    etaDate.setHours(0, 0, 0, 0);
                    etaDays = Math.ceil((etaDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                    if (etaDays < 0) etaStatus = 'arrived';
                    else if (etaDays <= 2) etaStatus = 'urgent';
                    else if (etaDays <= 6) etaStatus = 'soon';
                    else etaStatus = 'normal';
                }

                // Parse containers
                let containerCount = 0;
                if (inv.containers) {
                    if (Array.isArray(inv.containers)) {
                        containerCount = inv.containers.length;
                    } else if (typeof inv.containers === 'string') {
                        try {
                            const parsed = JSON.parse(inv.containers);
                            containerCount = Array.isArray(parsed) ? parsed.length : 1;
                        } catch {
                            containerCount = inv.containers.split(',').filter(Boolean).length || 1;
                        }
                    }
                }

                return {
                    ...inv,
                    booking,
                    blData: bl,
                    calculatedEta,
                    etaDays,
                    etaStatus,
                    containerCount,
                    // Get first name of customer
                    customerFirstName: (inv.soldTo || inv.shipperName || '').split(' ')[0] || 'N/A',
                };
            })
            .sort((a, b) => new Date(b.invoiceDate || b.createdAt || '').getTime() - new Date(a.invoiceDate || a.createdAt || '').getTime());
    }, [invoices, bookings, billOfLadings]);

    // Filtered invoices for display (apply search and filters)
    const filteredInvoices = useMemo(() => {
        let result = pendingInvoices;

        // Search filter
        if (invoiceSearch) {
            const search = invoiceSearch.toLowerCase();
            result = result.filter(inv =>
                inv.invoiceNumber?.toLowerCase().includes(search) ||
                inv.soNumber?.toLowerCase().includes(search) ||
                inv.bookingNumber?.toLowerCase().includes(search) ||
                (inv.blData?.blNumber || inv.bl || '').toLowerCase().includes(search)
            );
        }

        // Customer filter
        if (invoiceCustomerFilter) {
            result = result.filter(inv =>
                (inv.soldTo || inv.shipperName || '').toLowerCase().includes(invoiceCustomerFilter.toLowerCase())
            );
        }

        // POA filter
        if (invoicePoaFilter) {
            result = result.filter(inv =>
                (inv.poa || inv.blData?.portLoading || '').toLowerCase().includes(invoicePoaFilter.toLowerCase())
            );
        }

        // POD filter
        if (invoicePodFilter) {
            result = result.filter(inv =>
                (inv.pod || inv.blData?.portDischarge || '').toLowerCase().includes(invoicePodFilter.toLowerCase())
            );
        }

        return result;
    }, [pendingInvoices, invoiceSearch, invoiceCustomerFilter, invoicePoaFilter, invoicePodFilter]);

    // Get unique filter options for dropdowns
    const invoiceFilterOptions = useMemo(() => {
        const customers = new Set<string>();
        const poas = new Set<string>();
        const pods = new Set<string>();

        pendingInvoices.forEach(inv => {
            const customer = inv.soldTo || inv.shipperName;
            if (customer) customers.add(customer);

            const poa = inv.poa || inv.blData?.portLoading;
            if (poa) poas.add(poa);

            const pod = inv.pod || inv.blData?.portDischarge;
            if (pod) pods.add(pod);
        });

        return {
            customers: Array.from(customers).sort(),
            poas: Array.from(poas).sort(),
            pods: Array.from(pods).sort(),
        };
    }, [pendingInvoices]);

    // Shipments arriving this week (next 7 days)
    const arrivingThisWeek = useMemo(() => {
        return pendingInvoices.filter(inv =>
            inv.etaStatus && inv.etaDays !== null && inv.etaDays >= 0 && inv.etaDays <= 7
        );
    }, [pendingInvoices]);

    // KPI Stats - use normalized quotes for proper status filtering
    const normalizedQuotes = useMemo(() => freightQuotes.map(normalizeQuote), [freightQuotes]);
    const activeQuotesCount = normalizedQuotes.filter(q => q.status === 'ACTIVE').length;
    const pendingQuotesCount = normalizedQuotes.filter(q => q.status === 'PENDING').length;

    // ========================================================================
    // HANDLERS
    // ========================================================================

    const handleQuoteSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (quoteSortConfig?.key === key && quoteSortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setQuoteSortConfig({ key, direction });
    };

    // extractPortCode is now a module-level helper function

    // Find best matching POA/POD in available freight quote options
    const findMatchingPort = (portValue: string, availableOptions: string[]): string => {
        if (!portValue || availableOptions.length === 0) return portValue;

        const searchCode = extractPortCode(portValue);
        const searchLower = portValue.toLowerCase();

        // First: Exact match
        const exactMatch = availableOptions.find(opt => opt === portValue);
        if (exactMatch) return exactMatch;

        // Second: Match by port code
        const codeMatch = availableOptions.find(opt => {
            const optCode = extractPortCode(opt);
            return optCode && searchCode && optCode.toUpperCase() === searchCode.toUpperCase();
        });
        if (codeMatch) return codeMatch;

        // Third: Partial name match (first word)
        const firstName = portValue.split(/[\s\(\-]/)[0].toLowerCase();
        const nameMatch = availableOptions.find(opt => opt.toLowerCase().includes(firstName));
        if (nameMatch) return nameMatch;

        // Return original value if no match (will still be used for display)
        return portValue;
    };

    // Handle SO filter selection - auto-populate route filters
    const handleSoFilterChange = (soId: string) => {
        setSoFilter(soId);
        if (!soId) {
            // Clear route filters when SO is cleared
            setSoPickupLocation('');
            setZipFilter('');
            setPoaFilter('');
            setPodFilter('');
            return;
        }

        const so = salesOrders.find(s => s.id === soId) as any;
        if (so) {
            // Log SO data for debugging
            console.log('SO Selected:', so);

            // Store the SO's pickup location for display
            const pickup = so.pickupLocation || so.pickup_location || '';
            setSoPickupLocation(pickup);
            console.log('SO Pick Up:', pickup);

            // NOTE: ZIP filter auto-fill disabled because:
            // 1. SOs typically have destination/delivery address ZIP (e.g., Manaus 69015)
            // 2. Freight quotes filter by PICKUP ZIP (origin location)
            // 3. Using destination ZIP to filter pickup ZIP causes 0 matches
            // Users can manually set ZIP filter if needed
            setZipFilter('');

            // Get POA from SO and find matching option
            const rawPoa = so.poa || so.port_of_origin || so.originPort || so.origin_port || '';
            const matchedPoa = findMatchingPort(rawPoa, uniquePOAs);
            console.log('POA:', rawPoa, '-> Matched:', matchedPoa);
            setPoaFilter(matchedPoa);

            // Get POD from SO, fallback to Customer's default POD if not set
            let rawPod = so.pod || so.port_of_destination || so.destinationPort || so.destination_port || '';

            // Fallback: Get POD from Customer record if SO doesn't have it
            if (!rawPod) {
                const customerId = so.customerId || so.customer_id;
                const customer = customers.find(c => c.id === customerId) as any;
                if (customer) {
                    rawPod = customer.pod || customer.port_of_destination || '';
                    console.log('POD from Customer:', rawPod);
                }
            }

            const matchedPod = findMatchingPort(rawPod, uniquePODs);
            console.log('POD:', rawPod, '-> Matched:', matchedPod);
            setPodFilter(matchedPod);
        }
    };

    const toggleAgentSelection = (agentId: string) => {
        setSelectedAgents(prev =>
            prev.includes(agentId)
                ? prev.filter(id => id !== agentId)
                : [...prev, agentId]
        );
    };

    const selectSalesOrder = (so: SalesOrder) => {
        setSelectedSO(so);
        // Always reset all fields first, then set from SO if available
        setManualOriginPort(so.poa || '');
        setManualDestPort(so.pod || '');
        setManualPickupZip(so.pickupLocation || '');
    };

    const handleRequestQuotes = () => {
        if (selectedAgents.length === 0) {
            alert('Please select at least one cargo agent');
            return;
        }

        // Get selected agent names
        const selectedAgentNames = cargoAgents
            .filter(a => selectedAgents.includes(a.id))
            .map(a => a.name)
            .join(', ');

        // Generate email subject and body
        const origin = manualOriginPort || 'TBD';
        const destination = manualDestPort || 'TBD';
        const pickup = manualPickupZip || 'N/A';
        const soInfo = selectedSO ? `\n\nReference: ${selectedSO.orderNumber}\nCustomer: ${selectedSO.customerName}` : '';

        setEmailSubject(`Freight Quote Request: ${origin} → ${destination}`);
        setEmailBody(`Dear Freight Partner,

We are requesting a freight quote for the following shipment:

ROUTE DETAILS:
• Origin Port (POA): ${origin}
• Destination Port (POD): ${destination}
• Pick Up: ${pickup}${soInfo}

SHIPMENT REQUIREMENTS:
• Container Type: 40' HC (please confirm)
• Commodity: General Cargo
• Incoterms: FOB

Please provide your best rate including:
- Ocean freight
- Port fees
- Transit time
- Free time at destination
- Validity period

We appreciate your prompt response.

Best regards,
X-Solution Logistics Team`);

        setEmailPreviewOpen(true);
    };

    const handleSendQuoteEmail = async () => {
        setSendingEmail(true);
        try {
            // TODO: Integrate with actual email sending service
            await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate sending
            alert(`Quote request sent successfully to ${selectedAgents.length} agent(s)!`);
            setEmailPreviewOpen(false);
            setSelectedAgents([]);
        } catch (error) {
            alert('Failed to send email. Please try again.');
        } finally {
            setSendingEmail(false);
        }
    };

    // ========================================================================
    // RENDER HELPERS
    // ========================================================================

    const renderSortableHeader = (label: string, key: string, align: 'left' | 'center' | 'right' = 'left') => (
        <th
            className={`px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-700 transition-colors whitespace-nowrap ${align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left'}`}
            onClick={() => handleQuoteSort(key)}
        >
            <div className={`flex items-center gap-1 ${align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : ''}`}>
                {label}
                {quoteSortConfig?.key === key && (
                    quoteSortConfig.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                )}
            </div>
        </th>
    );

    const windowTabs = [
        { id: 'QUOTES' as ActiveWindow, label: 'Freight Quotes', icon: DollarSign, count: freightQuotes.length },
        { id: 'REQUEST' as ActiveWindow, label: 'Request Quotes', icon: Send, count: eligibleSOs.length },
        { id: 'FOLLOW_UP' as ActiveWindow, label: 'Order Follow-Up', icon: ClipboardList, count: ordersToShip.length },
        { id: 'INVOICE_FOLLOW_UP' as ActiveWindow, label: 'Invoice Follow-Up', icon: FileText, count: pendingInvoices.length }
    ];

    // ========================================================================
    // RENDER
    // ========================================================================

    return (
        <div className="space-y-6 animate-fade-in pb-12">
            {/* Header */}
            <div className="mb-6 flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
                        <div className="p-2 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-xl text-white">
                            <TrendingUp size={24} />
                        </div>
                        Logistics Control Tower
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">Manage freight quotes, requests, and shipment tracking</p>
                </div>
                <div className="flex items-center gap-3">
                    {windowTabs.map((tab, index) => {
                        const Icon = tab.icon;
                        const isActive = activeWindow === tab.id;
                        // Color schemes matching PL-Invoice Engine: indigo, orange, teal, emerald
                        const colorSchemes = [
                            { active: 'bg-indigo-500 text-white hover:bg-indigo-600', inactive: 'bg-indigo-50 text-indigo-600 border border-indigo-200 hover:bg-indigo-100' },
                            { active: 'bg-orange-500 text-white hover:bg-orange-600', inactive: 'bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100' },
                            { active: 'bg-teal-500 text-white hover:bg-teal-600', inactive: 'bg-teal-50 text-teal-600 border border-teal-200 hover:bg-teal-100' },
                            { active: 'bg-emerald-500 text-white hover:bg-emerald-600', inactive: 'bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100' }
                        ];
                        const colorScheme = colorSchemes[index % colorSchemes.length];
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveWindow(tab.id)}
                                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-all shadow-md ${isActive ? colorScheme.active : colorScheme.inactive}`}
                            >
                                <Icon size={18} />
                                {tab.label}
                                {tab.count > 0 && (
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${isActive ? 'bg-white/20' : 'bg-white'}`}>
                                        {tab.count}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ================================================================ */}
            {/* WINDOW 1: FREIGHT QUOTES COMPARISON */}
            {/* ================================================================ */}
            {activeWindow === 'QUOTES' && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in">
                    {/* Toolbar */}
                    <div className="p-4 border-b border-slate-100 flex flex-col gap-3 bg-slate-50/50">
                        {/* Search and Route Filters Row */}
                        <div className="flex flex-wrap items-center gap-3">
                            {/* Search */}
                            <div className="relative">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="Search agents, ports..."
                                    value={quoteSearch}
                                    onChange={(e) => setQuoteSearch(e.target.value)}
                                    className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 w-52"
                                />
                            </div>

                            {/* Sales Order Filter - Auto-fills route */}
                            <select
                                value={soFilter}
                                onChange={(e) => handleSoFilterChange(e.target.value)}
                                className="px-3 py-2 bg-white border border-blue-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-medium text-blue-700"
                            >
                                <option value="">Select SO...</option>
                                {salesOrders.filter(so => so.status === 'APPROVED').map(so => (
                                    <option key={so.id} value={so.id}>
                                        {so.orderNumber} - {so.customerName?.substring(0, 20)}
                                    </option>
                                ))}
                            </select>

                            {/* Pick Up Filter */}
                            <select
                                value={zipFilter}
                                onChange={(e) => setZipFilter(e.target.value)}
                                className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            >
                                <option value="">All ZIPs</option>
                                {uniqueZips.map(zip => (
                                    <option key={zip} value={zip}>{zip}</option>
                                ))}
                            </select>

                            {/* POA Filter */}
                            <select
                                value={poaFilter}
                                onChange={(e) => setPoaFilter(e.target.value)}
                                className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            >
                                <option value="">All POA</option>
                                {uniquePOAs.map(poa => (
                                    <option key={poa} value={poa}>{poa}</option>
                                ))}
                            </select>

                            {/* POD Filter */}
                            <select
                                value={podFilter}
                                onChange={(e) => setPodFilter(e.target.value)}
                                className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            >
                                <option value="">All POD</option>
                                {uniquePODs.map(pod => (
                                    <option key={pod} value={pod}>{pod}</option>
                                ))}
                            </select>

                            {/* Clear Filters Button */}
                            {(soFilter || zipFilter || poaFilter || podFilter) && (
                                <button
                                    onClick={() => { setSoFilter(''); setZipFilter(''); setPoaFilter(''); setPodFilter(''); }}
                                    className="px-3 py-2 text-xs font-semibold text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex items-center gap-1"
                                >
                                    <X size={14} /> Clear
                                </button>
                            )}
                        </div>

                        {/* Status Filter Row */}
                        <div className="flex items-center gap-2">
                            {(['ALL', 'ACTIVE', 'PENDING', 'EXPIRED'] as QuoteStatusFilter[]).map(status => (
                                <button
                                    key={status}
                                    onClick={() => setQuoteStatusFilter(status)}
                                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${quoteStatusFilter === status
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                                        }`}
                                >
                                    {status}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* SO Pick Up Banner */}
                    {soFilter && soPickupLocation && (
                        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-2">
                            <MapPin size={16} className="text-blue-600" />
                            <span className="text-sm text-blue-800">
                                <span className="font-semibold">SO Pick Up:</span> {soPickupLocation}
                            </span>
                        </div>
                    )}

                    {/* Table */}
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 border-b border-slate-200">
                                <tr>
                                    {renderSortableHeader('Cargo Agent', 'agentName')}
                                    {renderSortableHeader('Service', 'freightType', 'center')}
                                    {renderSortableHeader('Pickup', 'pickupZip', 'center')}
                                    {renderSortableHeader('POA', 'originPort')}
                                    {renderSortableHeader('POD', 'destinationPort')}
                                    {renderSortableHeader('Cost', 'rate', 'right')}
                                    {renderSortableHeader('Free Time', 'freeTime', 'center')}
                                    {renderSortableHeader('Transit Time', 'transitTime', 'center')}
                                    {renderSortableHeader('Valid Until', 'validUntil', 'center')}
                                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Status</th>
                                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredQuotes.map(quote => (
                                    <tr key={quote.id} className="hover:bg-blue-50/30 transition-colors">
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center">
                                                    <Building size={16} />
                                                </div>
                                                <span className="font-medium text-slate-800">{quote.agentName || 'Unknown'}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs font-medium">
                                                {getServiceLabel(quote.freightType)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-center text-sm text-slate-600">
                                            {soFilter && soPickupLocation ? soPickupLocation : (quote.pickupZip || quote.pickupLocation || '—')}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className="text-sm text-slate-700">{formatPortDisplay(quote.originPort)}</span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className="text-sm text-slate-700">{formatPortDisplay(quote.destinationPort)}</span>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <span className="font-bold text-slate-800">{formatCurrency(quote.rate, quote.currency)}</span>
                                        </td>
                                        <td className="px-4 py-3 text-center text-sm text-slate-600">
                                            {quote.freeTime ? `${quote.freeTime} days` : '—'}
                                        </td>
                                        <td className="px-4 py-3 text-center text-sm text-slate-600">
                                            {quote.transitTime ? `${quote.transitTime} days` : '—'}
                                        </td>
                                        <td className="px-4 py-3 text-center text-sm text-slate-600">
                                            {formatDate(quote.validUntil)}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${getStatusColor(quote.status)}`}>
                                                {quote.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <button
                                                    onClick={() => setViewQuote(quote)}
                                                    className="p-1.5 hover:bg-blue-100 rounded-lg transition-colors group"
                                                    title="View Quote"
                                                >
                                                    <Eye size={16} className="text-slate-400 group-hover:text-blue-600" />
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setEditQuote(quote);
                                                        setEditFormData({ ...quote });
                                                    }}
                                                    className="p-1.5 hover:bg-amber-100 rounded-lg transition-colors group"
                                                    title="Edit Quote"
                                                >
                                                    <Edit2 size={16} className="text-slate-400 group-hover:text-amber-600" />
                                                </button>
                                                <button
                                                    onClick={() => setDeleteQuote(quote)}
                                                    className="p-1.5 hover:bg-red-100 rounded-lg transition-colors group"
                                                    title="Delete Quote"
                                                >
                                                    <Trash2 size={16} className="text-slate-400 group-hover:text-red-600" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}

                                {filteredQuotes.length === 0 && (
                                    <tr>
                                        <td colSpan={11} className="py-16 text-center">
                                            <div className="flex flex-col items-center text-slate-400">
                                                <DollarSign size={48} className="mb-4 opacity-20" />
                                                <p className="font-medium">No freight quotes found</p>
                                                <p className="text-sm mt-1">Try adjusting your filters or add new quotes</p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ================================================================ */}
            {/* WINDOW 2: REQUEST NEW FREIGHT QUOTES */}
            {/* ================================================================ */}
            {activeWindow === 'REQUEST' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in">
                    {/* Left: Sales Orders Selection */}
                    <div className="lg:col-span-1 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="p-4 border-b border-slate-100 bg-slate-50">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                <ClipboardList size={18} className="text-blue-600" />
                                Sales Orders
                            </h3>
                            <p className="text-xs text-slate-500 mt-1">Select an order to request quotes</p>
                        </div>

                        <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
                            {eligibleSOs.length === 0 ? (
                                <div className="p-8 text-center text-slate-400">
                                    <FileText size={32} className="mx-auto mb-2 opacity-20" />
                                    <p className="text-sm">No eligible sales orders</p>
                                </div>
                            ) : (
                                eligibleSOs.map(so => (
                                    <button
                                        key={so.id}
                                        onClick={() => selectSalesOrder(so)}
                                        className={`w-full p-4 text-left hover:bg-blue-50 transition-colors ${selectedSO?.id === so.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''}`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="font-bold text-slate-800">{so.orderNumber}</span>
                                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${getStatusColor(so.status)}`}>
                                                {so.status}
                                            </span>
                                        </div>
                                        <p className="text-sm text-slate-600 mt-1">{so.customerName}</p>
                                        <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
                                            {so.poa && <span className="flex items-center gap-1"><Anchor size={12} /> {so.poa}</span>}
                                            {so.poa && so.pod && <ChevronRight size={12} />}
                                            {so.pod && <span className="flex items-center gap-1"><Ship size={12} /> {so.pod}</span>}
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Middle: Route Configuration */}
                    <div className="lg:col-span-1 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                            <div>
                                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                    <MapPin size={18} className="text-emerald-600" />
                                    Route Configuration
                                </h3>
                                <p className="text-xs text-slate-500 mt-1">Configure pickup and delivery points</p>
                            </div>
                            <button
                                onClick={() => {
                                    // Clear all route fields and deselect SO for manual entry
                                    setSelectedSO(null);
                                    setManualOriginPort('');
                                    setManualDestPort('');
                                    setManualPickupZip('');
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-xs font-bold hover:bg-emerald-600 transition-all shadow-sm"
                            >
                                <Plus size={14} />
                                New
                            </button>
                        </div>

                        <div className="p-4 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Origin Port (POA)</label>
                                <div className="relative">
                                    <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10" />
                                    <select
                                        value={manualOriginPort}
                                        onChange={(e) => setManualOriginPort(e.target.value)}
                                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 appearance-none"
                                    >
                                        <option value="">Select Origin Port...</option>
                                        {/* Custom/Manual Entry Option */}
                                        {manualOriginPort && !salesOrders.some(so => so.poa === manualOriginPort) && (
                                            <option value={manualOriginPort}>{manualOriginPort} (Custom)</option>
                                        )}
                                        {/* Unique POA values from Sales Orders */}
                                        {[...new Set(salesOrders.filter(so => so.poa).map(so => so.poa!))].map(poa => (
                                            <option key={poa} value={poa}>{poa}</option>
                                        ))}
                                    </select>
                                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Destination Port (POD)</label>
                                <div className="relative">
                                    <Anchor size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10" />
                                    <select
                                        value={manualDestPort}
                                        onChange={(e) => setManualDestPort(e.target.value)}
                                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 appearance-none"
                                    >
                                        <option value="">Select Destination Port...</option>
                                        {/* Custom/Manual Entry Option */}
                                        {manualDestPort && !salesOrders.some(so => so.pod === manualDestPort) && (
                                            <option value={manualDestPort}>{manualDestPort} (Custom)</option>
                                        )}
                                        {/* Unique POD values from Sales Orders */}
                                        {[...new Set(salesOrders.filter(so => so.pod).map(so => so.pod!))].map(pod => (
                                            <option key={pod} value={pod}>{pod}</option>
                                        ))}
                                    </select>
                                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Pick Up (Optional)</label>
                                <div className="relative">
                                    <Truck size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10" />
                                    <select
                                        value={manualPickupZip}
                                        onChange={(e) => setManualPickupZip(e.target.value)}
                                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 appearance-none"
                                    >
                                        <option value="">Select Pick Up...</option>
                                        {/* Custom/Manual Entry Option */}
                                        {manualPickupZip && !salesOrders.some(so => so.pickupLocation?.includes(manualPickupZip)) && (
                                            <option value={manualPickupZip}>{manualPickupZip} (Custom)</option>
                                        )}
                                        {/* Unique Pick Ups from Sales Orders */}
                                        {[...new Set(salesOrders.filter(so => so.pickupLocation).map(so => so.pickupLocation!))].map(loc => (
                                            <option key={loc} value={loc}>{loc}</option>
                                        ))}
                                    </select>
                                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                </div>
                            </div>

                            {selectedSO && (
                                <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
                                    <p className="text-xs font-bold text-blue-600">Selected Order</p>
                                    <p className="text-sm text-blue-800 mt-1">{selectedSO.orderNumber} • {selectedSO.customerName}</p>
                                    <p className="text-xs text-blue-600 mt-1">{formatCurrency(selectedSO.totalAmount, selectedSO.currency)}</p>
                                </div>
                            )}

                            {/* Save/Update Route Button */}
                            {selectedSO && (manualOriginPort || manualDestPort) && (
                                <div className="mt-4 pt-4 border-t border-slate-100">
                                    {/* Check if route has been modified from original SO values */}
                                    {(() => {
                                        const hasChanges = (
                                            (manualOriginPort && manualOriginPort !== selectedSO.poa) ||
                                            (manualDestPort && manualDestPort !== selectedSO.pod) ||
                                            (manualPickupZip && manualPickupZip !== selectedSO.pickupLocation)
                                        );
                                        return (
                                            <button
                                                onClick={() => {
                                                    // Show confirmation for route update
                                                    const action = hasChanges ? 'update' : 'save';
                                                    const message = hasChanges
                                                        ? `Update route for ${selectedSO.orderNumber}?\n\nNew Route:\n• Origin: ${manualOriginPort || 'N/A'}\n• Destination: ${manualDestPort || 'N/A'}\n• Pickup: ${manualPickupZip || 'N/A'}`
                                                        : `Save route configuration for ${selectedSO.orderNumber}?`;
                                                    if (window.confirm(message)) {
                                                        // TODO: Implement actual save/update via props callback when available
                                                        alert(`Route ${action}d successfully!\n\nOrder: ${selectedSO.orderNumber}\nOrigin: ${manualOriginPort}\nDestination: ${manualDestPort}\nPickup: ${manualPickupZip || 'N/A'}`);
                                                    }
                                                }}
                                                className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-sm transition-all shadow-md ${hasChanges
                                                    ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600'
                                                    : 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-600 hover:to-teal-600'
                                                    }`}
                                            >
                                                <Save size={16} />
                                                {hasChanges ? 'Update SO Route' : 'Save Route'}
                                            </button>
                                        );
                                    })()}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right: Cargo Agents Selection */}
                    <div className="lg:col-span-1 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                        <div className="p-4 border-b border-slate-100 bg-slate-50">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                <Users size={18} className="text-purple-600" />
                                Cargo Agents
                            </h3>
                            <p className="text-xs text-slate-500 mt-1">Select agents to request quotes from</p>
                        </div>

                        <div className="flex-1 max-h-64 overflow-y-auto divide-y divide-slate-100">
                            {cargoAgents.length === 0 ? (
                                <div className="p-8 text-center text-slate-400">
                                    <Users size={32} className="mx-auto mb-2 opacity-20" />
                                    <p className="text-sm">No cargo agents available</p>
                                </div>
                            ) : (
                                cargoAgents.map(agent => (
                                    <label
                                        key={agent.id}
                                        className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-slate-50 transition-colors ${selectedAgents.includes(agent.id) ? 'bg-purple-50' : ''}`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedAgents.includes(agent.id)}
                                            onChange={() => toggleAgentSelection(agent.id)}
                                            className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                                        />
                                        <div className="flex-1">
                                            <p className="font-medium text-slate-800 text-sm">{agent.name}</p>
                                            {agent.country && <p className="text-xs text-slate-500">{agent.country}</p>}
                                        </div>
                                    </label>
                                ))
                            )}
                        </div>

                        <div className="p-4 border-t border-slate-100 bg-slate-50">
                            <button
                                onClick={handleRequestQuotes}
                                disabled={selectedAgents.length === 0}
                                className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-sm transition-all ${selectedAgents.length > 0
                                    ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700 shadow-md'
                                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                    }`}
                            >
                                <Send size={16} />
                                Request Quotes ({selectedAgents.length})
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ================================================================ */}
            {/* WINDOW 3: ORDER FOLLOW-UP */}
            {/* ================================================================ */}
            {activeWindow === 'FOLLOW_UP' && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in">
                    {/* Sub-tabs */}
                    <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center gap-4">
                        <button
                            onClick={() => setFollowUpTab('TO_SHIP')}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all ${followUpTab === 'TO_SHIP'
                                ? 'bg-amber-100 text-amber-700 shadow-sm'
                                : 'text-slate-500 hover:bg-slate-100'
                                }`}
                        >
                            <Clock size={16} />
                            Orders to Ship
                            <span className={`px-2 py-0.5 rounded-full text-xs ${followUpTab === 'TO_SHIP' ? 'bg-amber-200 text-amber-800' : 'bg-slate-200'}`}>
                                {ordersToShip.length}
                            </span>
                        </button>

                        <button
                            onClick={() => setFollowUpTab('SHIPPED')}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all ${followUpTab === 'SHIPPED'
                                ? 'bg-emerald-100 text-emerald-700 shadow-sm'
                                : 'text-slate-500 hover:bg-slate-100'
                                }`}
                        >
                            <FileText size={16} />
                            Invoice Follow-Up
                            <span className={`px-2 py-0.5 rounded-full text-xs ${followUpTab === 'SHIPPED' ? 'bg-emerald-200 text-emerald-800' : 'bg-slate-200'}`}>
                                {pendingInvoices.length}
                            </span>
                        </button>
                    </div>

                    {/* Orders to Ship Table */}
                    {followUpTab === 'TO_SHIP' && (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-slate-50 border-b border-slate-200">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">SO #</th>
                                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">Customer</th>
                                        <th className="px-4 py-3 text-center text-xs font-bold text-slate-500 uppercase">Order Date</th>
                                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase">Total</th>
                                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase">POD</th>
                                        <th className="px-4 py-3 text-center text-xs font-bold text-slate-500 uppercase">Status</th>
                                        <th className="px-4 py-3 text-center text-xs font-bold text-slate-500 uppercase">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {ordersToShip.map(so => (
                                        <tr key={so.id} className="hover:bg-amber-50/30 transition-colors">
                                            <td className="px-4 py-3">
                                                <span className="font-bold text-slate-800 font-mono">{so.orderNumber}</span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="text-sm text-slate-700">{so.customerName}</span>
                                            </td>
                                            <td className="px-4 py-3 text-center text-sm text-slate-600">
                                                {formatDate(so.orderDate)}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <span className="font-bold text-slate-800">{formatCurrency(so.totalAmount, so.currency)}</span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="text-sm text-slate-600">{so.pod || 'TBD'}</span>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${getStatusColor(so.status)}`}>
                                                    {so.status}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    <button
                                                        onClick={() => setViewSalesOrder(so)}
                                                        className="p-1.5 hover:bg-blue-100 rounded-lg transition-colors group"
                                                        title="View Order Details"
                                                    >
                                                        <Eye size={16} className="text-slate-400 group-hover:text-blue-600" />
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            setEditSalesOrder(so);
                                                            setEditSoFormData({ ...so });
                                                        }}
                                                        className="p-1.5 hover:bg-amber-100 rounded-lg transition-colors group"
                                                        title="Edit Order"
                                                    >
                                                        <Edit2 size={16} className="text-slate-400 group-hover:text-amber-600" />
                                                    </button>
                                                    <button className="px-3 py-1.5 bg-blue-100 text-blue-600 rounded-lg text-xs font-bold hover:bg-blue-200 transition-colors">
                                                        Create Booking
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}

                                    {ordersToShip.length === 0 && (
                                        <tr>
                                            <td colSpan={7} className="py-16 text-center">
                                                <div className="flex flex-col items-center text-slate-400">
                                                    <CheckCircle2 size={48} className="mb-4 opacity-20" />
                                                    <p className="font-medium">All orders have been booked</p>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Invoice Follow-Up Table */}
                    {(followUpTab === 'SHIPPED' || activeWindow === 'INVOICE_FOLLOW_UP') && (
                        <div>
                            {/* KPI Card - Shipments Arriving This Week */}
                            <div className="p-4 bg-gradient-to-r from-blue-50 to-cyan-50 border-b border-blue-100">
                                <div className="flex items-center gap-4">
                                    <div className="p-3 bg-blue-500 rounded-xl text-white">
                                        <Ship size={24} />
                                    </div>
                                    <div>
                                        <p className="text-sm text-blue-600 font-medium">Arriving This Week</p>
                                        <p className="text-3xl font-bold text-blue-900">{arrivingThisWeek.length}</p>
                                    </div>
                                    {arrivingThisWeek.length > 0 && (
                                        <div className="ml-auto flex gap-2">
                                            {arrivingThisWeek.filter(i => i.etaStatus === 'urgent').length > 0 && (
                                                <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm font-bold">
                                                    🔴 {arrivingThisWeek.filter(i => i.etaStatus === 'urgent').length} urgent
                                                </span>
                                            )}
                                            {arrivingThisWeek.filter(i => i.etaStatus === 'soon').length > 0 && (
                                                <span className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-sm font-bold">
                                                    🟡 {arrivingThisWeek.filter(i => i.etaStatus === 'soon').length} this week
                                                </span>
                                            )}
                                            {arrivingThisWeek.filter(i => i.etaStatus === 'normal').length > 0 && (
                                                <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-bold">
                                                    🟢 {arrivingThisWeek.filter(i => i.etaStatus === 'normal').length} later
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Filter Bar */}
                            <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap gap-3 items-center">
                                {/* Search */}
                                <div className="relative flex-1 min-w-[200px] max-w-[300px]">
                                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        type="text"
                                        placeholder="Search Invoice#, SO#, BL#..."
                                        value={invoiceSearch}
                                        onChange={(e) => setInvoiceSearch(e.target.value)}
                                        className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    />
                                </div>

                                {/* Customer Filter */}
                                <select
                                    value={invoiceCustomerFilter}
                                    onChange={(e) => setInvoiceCustomerFilter(e.target.value)}
                                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                                >
                                    <option value="">All Customers</option>
                                    {invoiceFilterOptions.customers.map(c => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </select>

                                {/* POA Filter */}
                                <select
                                    value={invoicePoaFilter}
                                    onChange={(e) => setInvoicePoaFilter(e.target.value)}
                                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                                >
                                    <option value="">All POA</option>
                                    {invoiceFilterOptions.poas.map(p => (
                                        <option key={p} value={p}>{p}</option>
                                    ))}
                                </select>

                                {/* POD Filter */}
                                <select
                                    value={invoicePodFilter}
                                    onChange={(e) => setInvoicePodFilter(e.target.value)}
                                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                                >
                                    <option value="">All POD</option>
                                    {invoiceFilterOptions.pods.map(p => (
                                        <option key={p} value={p}>{p}</option>
                                    ))}
                                </select>

                                {/* Clear Filters */}
                                {(invoiceSearch || invoiceCustomerFilter || invoicePoaFilter || invoicePodFilter) && (
                                    <button
                                        onClick={() => {
                                            setInvoiceSearch('');
                                            setInvoiceCustomerFilter('');
                                            setInvoicePoaFilter('');
                                            setInvoicePodFilter('');
                                        }}
                                        className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-1"
                                    >
                                        <X size={14} />
                                        Clear
                                    </button>
                                )}

                                {/* Results count */}
                                <span className="text-sm text-slate-500 ml-auto">
                                    {filteredInvoices.length} of {pendingInvoices.length} invoices
                                </span>
                            </div>

                            {/* Table */}
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead className="bg-slate-50 border-b border-slate-200">
                                        <tr>
                                            <th className="px-3 py-3 text-center text-xs font-bold text-slate-500 uppercase">Invoice Date</th>
                                            <th className="px-3 py-3 text-left text-xs font-bold text-slate-500 uppercase">Invoice #</th>
                                            <th className="px-3 py-3 text-left text-xs font-bold text-slate-500 uppercase">SO #</th>
                                            <th className="px-3 py-3 text-left text-xs font-bold text-slate-500 uppercase">Customer</th>
                                            <th className="px-3 py-3 text-left text-xs font-bold text-slate-500 uppercase">Booking</th>
                                            <th className="px-3 py-3 text-left text-xs font-bold text-slate-500 uppercase">BL</th>
                                            <th className="px-3 py-3 text-left text-xs font-bold text-slate-500 uppercase">POA</th>
                                            <th className="px-3 py-3 text-left text-xs font-bold text-slate-500 uppercase">POD</th>
                                            <th className="px-3 py-3 text-center text-xs font-bold text-slate-500 uppercase">ETA</th>
                                            <th className="px-3 py-3 text-center text-xs font-bold text-slate-500 uppercase">Containers</th>
                                            <th className="px-3 py-3 text-right text-xs font-bold text-slate-500 uppercase">Weight</th>
                                            <th className="px-3 py-3 text-center text-xs font-bold text-slate-500 uppercase">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {filteredInvoices.map(inv => (
                                            <tr key={inv.id} className="hover:bg-emerald-50/30 transition-colors">
                                                <td className="px-3 py-3 text-center text-sm text-slate-600">
                                                    {formatDate(inv.invoiceDate)}
                                                </td>
                                                <td className="px-3 py-3">
                                                    {inv.originalDocument ? (
                                                        <button
                                                            onClick={() => setViewingDocument({
                                                                type: 'invoice',
                                                                title: 'Invoice',
                                                                url: inv.originalDocument!,
                                                                docNumber: inv.invoiceNumber
                                                            })}
                                                            className="font-bold text-purple-600 font-mono text-sm hover:underline cursor-pointer"
                                                        >
                                                            {inv.invoiceNumber}
                                                        </button>
                                                    ) : (
                                                        <span className="font-bold text-slate-800 font-mono text-sm">{inv.invoiceNumber}</span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-3">
                                                    {inv.soNumber ? (
                                                        <button
                                                            onClick={() => {
                                                                const so = salesOrders.find(s => s.soNumber === inv.soNumber);
                                                                if (so) setViewSalesOrder(so);
                                                            }}
                                                            className="font-mono text-blue-600 text-sm hover:underline cursor-pointer"
                                                        >
                                                            {inv.soNumber}
                                                        </button>
                                                    ) : <span className="text-slate-400">-</span>}
                                                </td>
                                                <td className="px-3 py-3">
                                                    <span className="text-sm text-slate-700 font-medium">{inv.customerFirstName}</span>
                                                </td>
                                                <td className="px-3 py-3">
                                                    {inv.booking?.originalDocument ? (
                                                        <button
                                                            onClick={() => setViewingDocument({
                                                                type: 'booking',
                                                                title: 'Booking Confirmation',
                                                                url: inv.booking!.originalDocument!,
                                                                docNumber: inv.bookingNumber || ''
                                                            })}
                                                            className="font-mono text-cyan-600 text-sm hover:underline cursor-pointer"
                                                        >
                                                            {inv.bookingNumber}
                                                        </button>
                                                    ) : inv.bookingNumber ? (
                                                        <span className="font-mono text-slate-600 text-sm">{inv.bookingNumber}</span>
                                                    ) : <span className="text-slate-400">-</span>}
                                                </td>
                                                <td className="px-3 py-3">
                                                    {inv.blData?.originalDocument ? (
                                                        <button
                                                            onClick={() => setViewingDocument({
                                                                type: 'bl',
                                                                title: 'Bill of Lading',
                                                                url: inv.blData!.originalDocument!,
                                                                docNumber: inv.blData!.blNumber
                                                            })}
                                                            className="font-mono text-emerald-600 text-sm hover:underline cursor-pointer"
                                                        >
                                                            {inv.blData.blNumber}
                                                        </button>
                                                    ) : inv.blData?.blNumber || inv.bl ? (
                                                        <span className="font-mono text-emerald-600 text-sm">{inv.blData?.blNumber || inv.bl}</span>
                                                    ) : <span className="text-slate-400">-</span>}
                                                </td>
                                                <td className="px-3 py-3">
                                                    <span className="text-sm text-slate-600">{inv.poa || inv.blData?.portLoading || '-'}</span>
                                                </td>
                                                <td className="px-3 py-3">
                                                    <span className="text-sm text-slate-600">{inv.pod || inv.blData?.portDischarge || '-'}</span>
                                                </td>
                                                <td className="px-3 py-3 text-center">
                                                    {inv.etaStatus === 'arrived' ? (
                                                        <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold">✓ Arrived</span>
                                                    ) : inv.etaStatus === 'urgent' ? (
                                                        <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-bold">{inv.etaDays}d 🔴</span>
                                                    ) : inv.etaStatus === 'soon' ? (
                                                        <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-bold">{inv.etaDays}d 🟡</span>
                                                    ) : inv.etaStatus === 'normal' ? (
                                                        <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-bold">{inv.etaDays}d 🟢</span>
                                                    ) : (
                                                        <span className="text-sm text-slate-400">-</span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-3 text-center">
                                                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-sm font-bold">
                                                        {inv.containerCount || '-'}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-3 text-right">
                                                    <span className="text-sm text-slate-600">{inv.grossWeight ? parseFloat(inv.grossWeight.replace(/,/g, '')).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-'}</span>
                                                </td>
                                                <td className="px-3 py-3">
                                                    <div className="flex items-center justify-center gap-1">
                                                        {/* View PDF */}
                                                        {inv.originalDocument && (
                                                            <a
                                                                href={inv.originalDocument}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="p-1.5 hover:bg-blue-100 rounded-lg transition-colors group"
                                                                title="View Invoice PDF"
                                                            >
                                                                <FileText size={14} className="text-slate-400 group-hover:text-blue-600" />
                                                            </a>
                                                        )}
                                                        {/* Send Reminder Email */}
                                                        <a
                                                            href={`mailto:?subject=Invoice ${inv.invoiceNumber} Reminder&body=Dear ${inv.customerFirstName},%0D%0A%0D%0AThis is a friendly reminder regarding Invoice ${inv.invoiceNumber} dated ${formatDate(inv.invoiceDate)}.%0D%0A%0D%0APlease let us know if you have any questions.%0D%0A%0D%0ABest regards`}
                                                            className="p-1.5 hover:bg-amber-100 rounded-lg transition-colors group"
                                                            title="Send Reminder Email"
                                                        >
                                                            <Mail size={14} className="text-slate-400 group-hover:text-amber-600" />
                                                        </a>
                                                        {/* Mark as Paid indicator */}
                                                        <button
                                                            className="p-1.5 hover:bg-emerald-100 rounded-lg transition-colors group"
                                                            title="Mark as Paid"
                                                        >
                                                            <CheckCircle2 size={14} className="text-slate-400 group-hover:text-emerald-600" />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}

                                        {filteredInvoices.length === 0 && (
                                            <tr>
                                                <td colSpan={12} className="py-16 text-center">
                                                    <div className="flex flex-col items-center text-slate-400">
                                                        <FileText size={48} className="mb-4 opacity-20" />
                                                        <p className="font-medium">No invoices to follow up</p>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* ================================================================ */}
                    {/* DOCUMENT VIEWER MODAL */}
                    {/* ================================================================ */}
                    {viewingDocument && (
                        <div
                            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200"
                            onClick={() => setViewingDocument(null)}
                        >
                            <div
                                className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl mx-4 max-h-[95vh] overflow-hidden animate-in zoom-in-95 duration-200"
                                onClick={e => e.stopPropagation()}
                            >
                                {/* Header */}
                                <div className={`px-6 py-4 flex items-center justify-between ${viewingDocument.type === 'invoice' ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600' :
                                    viewingDocument.type === 'booking' ? 'bg-gradient-to-r from-cyan-600 to-blue-600' :
                                        viewingDocument.type === 'bl' ? 'bg-gradient-to-r from-emerald-600 to-teal-600' :
                                            'bg-gradient-to-r from-slate-600 to-slate-700'
                                    }`}>
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                                            <FileText size={20} className="text-white" />
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-bold text-white">{viewingDocument.title}</h2>
                                            <p className="text-white/80 text-sm font-mono">{viewingDocument.docNumber}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <a
                                            href={viewingDocument.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="px-3 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-white text-sm font-medium transition-colors flex items-center gap-2"
                                        >
                                            <ExternalLink size={16} />
                                            Open in New Tab
                                        </a>
                                        <button
                                            onClick={() => setViewingDocument(null)}
                                            className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                                        >
                                            <X size={20} className="text-white" />
                                        </button>
                                    </div>
                                </div>

                                {/* Document Preview */}
                                <div className="bg-slate-100 p-4" style={{ height: 'calc(95vh - 80px)' }}>
                                    {viewingDocument.url.toLowerCase().endsWith('.pdf') ? (
                                        <iframe
                                            src={viewingDocument.url}
                                            className="w-full h-full rounded-lg border border-slate-200 bg-white"
                                            title={`${viewingDocument.title} - ${viewingDocument.docNumber}`}
                                        />
                                    ) : viewingDocument.url.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                                        <div className="w-full h-full flex items-center justify-center overflow-auto bg-white rounded-lg border border-slate-200">
                                            <img
                                                src={viewingDocument.url}
                                                alt={`${viewingDocument.title} - ${viewingDocument.docNumber}`}
                                                className="max-w-full max-h-full object-contain"
                                            />
                                        </div>
                                    ) : (
                                        /* Default: assume PDF or attempt iframe for other document types */
                                        <iframe
                                            src={viewingDocument.url}
                                            className="w-full h-full rounded-lg border border-slate-200 bg-white"
                                            title={`${viewingDocument.title} - ${viewingDocument.docNumber}`}
                                        />
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ================================================================ */}
                    {/* VIEW SALES ORDER MODAL */}
                    {/* ================================================================ */}
                    {viewSalesOrder && (
                        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
                            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200">
                                {/* Header */}
                                <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-4 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                                            <ClipboardList size={20} className="text-white" />
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-bold text-white">Sales Order Details</h2>
                                            <p className="text-emerald-100 text-sm font-mono">{viewSalesOrder.orderNumber}</p>
                                        </div>
                                    </div>
                                    <button onClick={() => setViewSalesOrder(null)} className="p-2 hover:bg-white/20 rounded-lg transition-colors">
                                        <X size={20} className="text-white" />
                                    </button>
                                </div>

                                {/* Content */}
                                <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
                                    <div className="grid grid-cols-2 gap-6">
                                        {/* Order Info */}
                                        <div className="col-span-2 bg-slate-50 rounded-xl p-4">
                                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Order Information</h3>
                                            <div className="grid grid-cols-4 gap-4">
                                                <div>
                                                    <p className="text-xs text-slate-500">Order Type</p>
                                                    <p className="font-semibold text-slate-800">{viewSalesOrder.orderType}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-slate-500">Order Date</p>
                                                    <p className="font-semibold text-slate-800">{formatDate(viewSalesOrder.orderDate)}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-slate-500">Status</p>
                                                    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold border ${getStatusColor(viewSalesOrder.status)}`}>
                                                        {viewSalesOrder.status}
                                                    </span>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-slate-500">Sale Type</p>
                                                    <p className="font-semibold text-slate-800">{viewSalesOrder.saleType || '—'}</p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Customer Info */}
                                        <div className="bg-blue-50 rounded-xl p-4">
                                            <h3 className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-3 flex items-center gap-2">
                                                <Building size={14} /> Customer
                                            </h3>
                                            <p className="font-semibold text-slate-800">{viewSalesOrder.customerName}</p>
                                            {viewSalesOrder.deliveryAddress && (
                                                <p className="text-sm text-slate-600 mt-1">{viewSalesOrder.deliveryAddress}</p>
                                            )}
                                        </div>

                                        {/* Payment & Terms */}
                                        <div className="bg-purple-50 rounded-xl p-4">
                                            <h3 className="text-xs font-bold text-purple-600 uppercase tracking-wider mb-3 flex items-center gap-2">
                                                <DollarSign size={14} /> Payment & Terms
                                            </h3>
                                            <div className="space-y-1">
                                                <p className="text-sm"><span className="text-slate-500">Incoterm:</span> <span className="font-semibold text-slate-800">{viewSalesOrder.incoterm}</span></p>
                                                <p className="text-sm"><span className="text-slate-500">Payment:</span> <span className="font-semibold text-slate-800">{viewSalesOrder.paymentTerms}</span></p>
                                                <p className="text-sm"><span className="text-slate-500">Currency:</span> <span className="font-semibold text-slate-800">{viewSalesOrder.currency}</span></p>
                                            </div>
                                        </div>

                                        {/* Shipping Route */}
                                        <div className="col-span-2 bg-amber-50 rounded-xl p-4">
                                            <h3 className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-3 flex items-center gap-2">
                                                <Ship size={14} /> Shipping Route
                                            </h3>
                                            <div className="grid grid-cols-4 gap-4">
                                                <div>
                                                    <p className="text-xs text-slate-500">Port of Origin (POA)</p>
                                                    <p className="font-semibold text-slate-800">{viewSalesOrder.poa || '—'}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-slate-500">Port of Destination (POD)</p>
                                                    <p className="font-semibold text-slate-800">{viewSalesOrder.pod || '—'}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-slate-500">Pickup Location</p>
                                                    <p className="font-semibold text-slate-800">{viewSalesOrder.pickupLocation || '—'}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-slate-500">Delivery Method</p>
                                                    <p className="font-semibold text-slate-800">{viewSalesOrder.deliveryMethod || '—'}</p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Order Items */}
                                        <div className="col-span-2 bg-white rounded-xl border border-slate-200 overflow-hidden">
                                            <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                                                <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center gap-2">
                                                    <Package size={14} /> Order Items ({viewSalesOrder.items?.length || 0})
                                                </h3>
                                            </div>
                                            <div className="overflow-x-auto">
                                                <table className="w-full text-sm">
                                                    <thead className="bg-slate-50 border-b border-slate-100">
                                                        <tr>
                                                            <th className="px-4 py-2 text-left text-xs font-bold text-slate-500">Product</th>
                                                            <th className="px-4 py-2 text-left text-xs font-bold text-slate-500">Description</th>
                                                            <th className="px-4 py-2 text-center text-xs font-bold text-slate-500">HS Code</th>
                                                            <th className="px-4 py-2 text-right text-xs font-bold text-slate-500">Qty</th>
                                                            <th className="px-4 py-2 text-right text-xs font-bold text-slate-500">Unit Price</th>
                                                            <th className="px-4 py-2 text-right text-xs font-bold text-slate-500">Total</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {viewSalesOrder.items?.map((item, idx) => (
                                                            <tr key={idx} className="hover:bg-slate-50">
                                                                <td className="px-4 py-2 font-medium text-slate-800">{item.productName}</td>
                                                                <td className="px-4 py-2 text-slate-600">{item.customerDescription || '—'}</td>
                                                                <td className="px-4 py-2 text-center text-slate-500 font-mono text-xs">{item.hsCode || '—'}</td>
                                                                <td className="px-4 py-2 text-right text-slate-700">{item.quantity?.toLocaleString()}</td>
                                                                <td className="px-4 py-2 text-right text-slate-700">{formatCurrency(item.unitPrice, viewSalesOrder.currency)}</td>
                                                                <td className="px-4 py-2 text-right font-bold text-slate-800">{formatCurrency(item.total, viewSalesOrder.currency)}</td>
                                                            </tr>
                                                        ))}
                                                        {(!viewSalesOrder.items || viewSalesOrder.items.length === 0) && (
                                                            <tr>
                                                                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">No items in this order</td>
                                                            </tr>
                                                        )}
                                                    </tbody>
                                                    <tfoot className="bg-emerald-50 border-t border-emerald-100">
                                                        <tr>
                                                            <td colSpan={5} className="px-4 py-3 text-right font-bold text-emerald-700 uppercase text-sm">Total Amount:</td>
                                                            <td className="px-4 py-3 text-right font-bold text-emerald-800 text-lg">{formatCurrency(viewSalesOrder.totalAmount, viewSalesOrder.currency)}</td>
                                                        </tr>
                                                    </tfoot>
                                                </table>
                                            </div>
                                        </div>

                                        {/* Notes */}
                                        {viewSalesOrder.notes && (
                                            <div className="col-span-2 bg-slate-50 rounded-xl p-4">
                                                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Notes</h3>
                                                <p className="text-sm text-slate-700 whitespace-pre-wrap">{viewSalesOrder.notes}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Footer */}
                                <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end">
                                    <button
                                        onClick={() => setViewSalesOrder(null)}
                                        className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium rounded-lg transition-colors"
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ================================================================ */}
                    {/* EDIT SALES ORDER MODAL */}
                    {/* ================================================================ */}
                    {editSalesOrder && (
                        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
                            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200">
                                {/* Header */}
                                <div className="bg-gradient-to-r from-amber-500 to-amber-600 px-6 py-4 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                                            <Edit2 size={20} className="text-white" />
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-bold text-white">Edit Sales Order</h2>
                                            <p className="text-amber-100 text-sm font-mono">{editSalesOrder.orderNumber}</p>
                                        </div>
                                    </div>
                                    <button onClick={() => setEditSalesOrder(null)} className="p-2 hover:bg-white/20 rounded-lg transition-colors">
                                        <X size={20} className="text-white" />
                                    </button>
                                </div>

                                {/* Form Content */}
                                <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
                                    <div className="grid grid-cols-2 gap-4">
                                        {/* Status */}
                                        <div>
                                            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Status</label>
                                            <select
                                                value={editSoFormData.status || ''}
                                                onChange={(e) => setEditSoFormData({ ...editSoFormData, status: e.target.value as any })}
                                                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                            >
                                                <option value="PENDING">Pending</option>
                                                <option value="APPROVED">Approved</option>
                                                <option value="REJECTED">Rejected</option>
                                                <option value="FULFILLED">Fulfilled</option>
                                            </select>
                                        </div>

                                        {/* Sale Type */}
                                        <div>
                                            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Sale Type</label>
                                            <select
                                                value={editSoFormData.saleType || ''}
                                                onChange={(e) => setEditSoFormData({ ...editSoFormData, saleType: e.target.value as any })}
                                                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                            >
                                                <option value="">Select...</option>
                                                <option value="LOCAL">Local</option>
                                                <option value="EXPORT">Export</option>
                                            </select>
                                        </div>

                                        {/* Port of Origin (POA) */}
                                        <div>
                                            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Port of Origin (POA)</label>
                                            <input
                                                type="text"
                                                value={editSoFormData.poa || ''}
                                                onChange={(e) => setEditSoFormData({ ...editSoFormData, poa: e.target.value })}
                                                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                                placeholder="e.g., Houston (USHOU)"
                                            />
                                        </div>

                                        {/* Port of Destination (POD) */}
                                        <div>
                                            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Port of Destination (POD)</label>
                                            <input
                                                type="text"
                                                value={editSoFormData.pod || ''}
                                                onChange={(e) => setEditSoFormData({ ...editSoFormData, pod: e.target.value })}
                                                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                                placeholder="e.g., Manaus (BRMAO)"
                                            />
                                        </div>

                                        {/* Pickup Location */}
                                        <div>
                                            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Pickup Location</label>
                                            <input
                                                type="text"
                                                value={editSoFormData.pickupLocation || ''}
                                                onChange={(e) => setEditSoFormData({ ...editSoFormData, pickupLocation: e.target.value })}
                                                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                                placeholder="Full address"
                                            />
                                        </div>

                                        {/* Delivery Method */}
                                        <div>
                                            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Delivery Method</label>
                                            <select
                                                value={editSoFormData.deliveryMethod || ''}
                                                onChange={(e) => setEditSoFormData({ ...editSoFormData, deliveryMethod: e.target.value })}
                                                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                            >
                                                <option value="">Select...</option>
                                                <option value="PICKUP">Pickup</option>
                                                <option value="DELIVERY">Delivery</option>
                                                <option value="PORT_PORT">Port to Port</option>
                                                <option value="PORT_DOOR">Port to Door</option>
                                                <option value="DOOR_PORT">Door to Port</option>
                                                <option value="DOOR_DOOR">Door to Door</option>
                                            </select>
                                        </div>

                                        {/* Incoterm */}
                                        <div>
                                            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Incoterm</label>
                                            <select
                                                value={editSoFormData.incoterm || ''}
                                                onChange={(e) => setEditSoFormData({ ...editSoFormData, incoterm: e.target.value })}
                                                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                            >
                                                <option value="">Select...</option>
                                                <option value="EXW">EXW</option>
                                                <option value="FCA">FCA</option>
                                                <option value="FAS">FAS</option>
                                                <option value="FOB">FOB</option>
                                                <option value="CFR">CFR</option>
                                                <option value="CIF">CIF</option>
                                                <option value="CPT">CPT</option>
                                                <option value="CIP">CIP</option>
                                                <option value="DAP">DAP</option>
                                                <option value="DPU">DPU</option>
                                                <option value="DDP">DDP</option>
                                            </select>
                                        </div>

                                        {/* Payment Terms */}
                                        <div>
                                            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Payment Terms</label>
                                            <input
                                                type="text"
                                                value={editSoFormData.paymentTerms || ''}
                                                onChange={(e) => setEditSoFormData({ ...editSoFormData, paymentTerms: e.target.value })}
                                                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                                placeholder="e.g., Net 30, CAD, etc."
                                            />
                                        </div>

                                        {/* Delivery Address */}
                                        <div className="col-span-2">
                                            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Delivery Address</label>
                                            <input
                                                type="text"
                                                value={editSoFormData.deliveryAddress || ''}
                                                onChange={(e) => setEditSoFormData({ ...editSoFormData, deliveryAddress: e.target.value })}
                                                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                                placeholder="Full delivery address"
                                            />
                                        </div>

                                        {/* Notes */}
                                        <div className="col-span-2">
                                            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Notes</label>
                                            <textarea
                                                value={editSoFormData.notes || ''}
                                                onChange={(e) => setEditSoFormData({ ...editSoFormData, notes: e.target.value })}
                                                rows={3}
                                                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 resize-none"
                                                placeholder="Additional notes..."
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Footer */}
                                <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
                                    <button
                                        onClick={() => setEditSalesOrder(null)}
                                        className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium rounded-lg transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        disabled={savingSalesOrder}
                                        onClick={async () => {
                                            if (!onUpdateSalesOrder || !editSalesOrder) {
                                                alert('Update function not available');
                                                return;
                                            }
                                            setSavingSalesOrder(true);
                                            try {
                                                const updatedRecord: SalesOrder = {
                                                    ...editSalesOrder,
                                                    status: editSoFormData.status || editSalesOrder.status,
                                                    saleType: (editSoFormData.saleType || editSalesOrder.saleType) as 'LOCAL' | 'EXPORT',
                                                    poa: editSoFormData.poa ?? editSalesOrder.poa,
                                                    pod: editSoFormData.pod ?? editSalesOrder.pod,
                                                    pickupLocation: editSoFormData.pickupLocation ?? editSalesOrder.pickupLocation,
                                                    deliveryMethod: editSoFormData.deliveryMethod ?? editSalesOrder.deliveryMethod,
                                                    incoterm: editSoFormData.incoterm ?? editSalesOrder.incoterm,
                                                    paymentTerms: editSoFormData.paymentTerms ?? editSalesOrder.paymentTerms,
                                                    deliveryAddress: editSoFormData.deliveryAddress ?? editSalesOrder.deliveryAddress,
                                                    notes: editSoFormData.notes ?? editSalesOrder.notes,
                                                };
                                                await onUpdateSalesOrder(updatedRecord);
                                                setEditSalesOrder(null);
                                            } catch (error) {
                                                console.error('Error updating sales order:', error);
                                                alert('Failed to save. Please try again.');
                                            } finally {
                                                setSavingSalesOrder(false);
                                            }
                                        }}
                                        className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white font-bold rounded-lg transition-colors flex items-center gap-2"
                                    >
                                        {savingSalesOrder ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                        {savingSalesOrder ? 'Saving...' : 'Save Changes'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ================================================================ */}
                    {/* VIEW QUOTE MODAL */}
                    {/* ================================================================ */}
                    {viewQuote && (
                        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
                            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200">
                                {/* Header */}
                                <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                                            <Eye size={20} className="text-white" />
                                        </div>
                                        <div>
                                            <h2 className="text-lg font-bold text-white">Quote Details</h2>
                                            <p className="text-blue-100 text-sm">{viewQuote.agentName}</p>
                                        </div>
                                    </div>
                                    <button onClick={() => setViewQuote(null)} className="p-2 hover:bg-white/20 rounded-lg transition-colors">
                                        <X size={20} className="text-white" />
                                    </button>
                                </div>

                                {/* Content */}
                                <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
                                    <div className="grid grid-cols-2 gap-6">
                                        {/* Service Info */}
                                        <div className="col-span-2 bg-slate-50 rounded-xl p-4">
                                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Service Information</h3>
                                            <div className="grid grid-cols-3 gap-4">
                                                <div>
                                                    <p className="text-xs text-slate-500">Service Type</p>
                                                    <p className="font-semibold text-slate-800">{getServiceLabel(viewQuote.freightType)}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-slate-500">Status</p>
                                                    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold border ${getStatusColor(viewQuote.status)}`}>
                                                        {viewQuote.status}
                                                    </span>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-slate-500">Valid Until</p>
                                                    <p className="font-semibold text-slate-800">{formatDate(viewQuote.validUntil)}</p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Route */}
                                        <div className="bg-blue-50 rounded-xl p-4">
                                            <h3 className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-3 flex items-center gap-2">
                                                <Anchor size={14} /> Origin
                                            </h3>
                                            <p className="font-semibold text-slate-800">{formatPortDisplay(viewQuote.originPort)}</p>
                                            {/* Show SO pickup location if SO filter is active, otherwise show quote pickup */}
                                            {soFilter && soPickupLocation ? (
                                                <p className="text-sm text-blue-600 mt-1 flex items-center gap-1">
                                                    <MapPin size={12} /> SO Pickup: {soPickupLocation}
                                                </p>
                                            ) : (
                                                <>
                                                    {viewQuote.pickupZip && <p className="text-sm text-slate-500 mt-1">ZIP: {viewQuote.pickupZip}</p>}
                                                    {viewQuote.pickupLocation && <p className="text-sm text-slate-500">{viewQuote.pickupLocation}</p>}
                                                </>
                                            )}
                                        </div>
                                        <div className="bg-emerald-50 rounded-xl p-4">
                                            <h3 className="text-xs font-bold text-emerald-600 uppercase tracking-wider mb-3 flex items-center gap-2">
                                                <MapPin size={14} /> Destination
                                            </h3>
                                            <p className="font-semibold text-slate-800">{formatPortDisplay(viewQuote.destinationPort)}</p>
                                            {viewQuote.deliveryZip && <p className="text-sm text-slate-500 mt-1">ZIP: {viewQuote.deliveryZip}</p>}
                                            {viewQuote.deliveryLocation && <p className="text-sm text-slate-500">{viewQuote.deliveryLocation}</p>}
                                        </div>

                                        {/* Cost Breakdown */}
                                        <div className="col-span-2 bg-amber-50 rounded-xl p-4">
                                            <h3 className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-3 flex items-center gap-2">
                                                <DollarSign size={14} /> Cost Breakdown
                                            </h3>
                                            <div className="grid grid-cols-4 gap-4">
                                                <div>
                                                    <p className="text-xs text-slate-500">Total Rate</p>
                                                    <p className="font-bold text-xl text-slate-800">{formatCurrency(viewQuote.rate, viewQuote.currency)}</p>
                                                </div>
                                                {viewQuote.pickupCost && (
                                                    <div>
                                                        <p className="text-xs text-slate-500">Pickup</p>
                                                        <p className="font-semibold text-slate-700">{formatCurrency(viewQuote.pickupCost)}</p>
                                                    </div>
                                                )}
                                                {viewQuote.oceanCost && (
                                                    <div>
                                                        <p className="text-xs text-slate-500">Ocean</p>
                                                        <p className="font-semibold text-slate-700">{formatCurrency(viewQuote.oceanCost)}</p>
                                                    </div>
                                                )}
                                                {viewQuote.deliveryCost && (
                                                    <div>
                                                        <p className="text-xs text-slate-500">Delivery</p>
                                                        <p className="font-semibold text-slate-700">{formatCurrency(viewQuote.deliveryCost)}</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Additional Details */}
                                        <div className="col-span-2 grid grid-cols-4 gap-4">
                                            {viewQuote.transitTime && (
                                                <div className="bg-slate-50 rounded-lg p-3">
                                                    <p className="text-xs text-slate-500">Transit Time</p>
                                                    <p className="font-semibold text-slate-800">{viewQuote.transitTime} days</p>
                                                </div>
                                            )}
                                            {viewQuote.freeTime && (
                                                <div className="bg-slate-50 rounded-lg p-3">
                                                    <p className="text-xs text-slate-500">Free Time</p>
                                                    <p className="font-semibold text-slate-800">{viewQuote.freeTime} days</p>
                                                </div>
                                            )}
                                            {viewQuote.containerCount && (
                                                <div className="bg-slate-50 rounded-lg p-3">
                                                    <p className="text-xs text-slate-500">Containers</p>
                                                    <p className="font-semibold text-slate-800">{viewQuote.containerCount}</p>
                                                </div>
                                            )}
                                            {viewQuote.isAllIn !== undefined && (
                                                <div className="bg-slate-50 rounded-lg p-3">
                                                    <p className="text-xs text-slate-500">All-In Rate</p>
                                                    <p className="font-semibold text-slate-800">{viewQuote.isAllIn ? 'Yes' : 'No'}</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Footer */}
                                <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end">
                                    <button
                                        onClick={() => setViewQuote(null)}
                                        className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium rounded-lg transition-colors"
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ================================================================ */}
                    {/* EDIT QUOTE MODAL */}
                    {/* ================================================================ */}
                    {
                        editQuote && (
                            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
                                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200">
                                    {/* Header */}
                                    <div className="bg-gradient-to-r from-amber-500 to-amber-600 px-6 py-4 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                                                <Edit2 size={20} className="text-white" />
                                            </div>
                                            <div>
                                                <h2 className="text-lg font-bold text-white">Edit Quote</h2>
                                                <p className="text-amber-100 text-sm">{editQuote.agentName}</p>
                                            </div>
                                        </div>
                                        <button onClick={() => setEditQuote(null)} className="p-2 hover:bg-white/20 rounded-lg transition-colors">
                                            <X size={20} className="text-white" />
                                        </button>
                                    </div>

                                    {/* Form Content */}
                                    <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
                                        <div className="grid grid-cols-2 gap-4">
                                            {/* Service Type */}
                                            <div>
                                                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Service Type</label>
                                                <select
                                                    value={editFormData.freightType || ''}
                                                    onChange={(e) => setEditFormData({ ...editFormData, freightType: e.target.value as any })}
                                                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                                >
                                                    <option value="PORT_PORT">Port to Port</option>
                                                    <option value="PORT_DOOR">Port to Door</option>
                                                    <option value="DOOR_PORT">Door to Port</option>
                                                    <option value="DOOR_DOOR">Door to Door</option>
                                                </select>
                                            </div>

                                            {/* Status */}
                                            <div>
                                                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Status</label>
                                                <select
                                                    value={editFormData.status || ''}
                                                    onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value as any })}
                                                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                                >
                                                    <option value="PENDING">Pending</option>
                                                    <option value="ACTIVE">Active</option>
                                                    <option value="EXPIRED">Expired</option>
                                                </select>
                                            </div>

                                            {/* Origin Port */}
                                            <div>
                                                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Origin Port (POA)</label>
                                                <input
                                                    type="text"
                                                    value={editFormData.originPort || ''}
                                                    onChange={(e) => setEditFormData({ ...editFormData, originPort: e.target.value })}
                                                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                                    placeholder="e.g., Houston (USHOU)"
                                                />
                                            </div>

                                            {/* Destination Port */}
                                            <div>
                                                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Destination Port (POD)</label>
                                                <input
                                                    type="text"
                                                    value={editFormData.destinationPort || ''}
                                                    onChange={(e) => setEditFormData({ ...editFormData, destinationPort: e.target.value })}
                                                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                                    placeholder="e.g., Manaus (BRMAO)"
                                                />
                                            </div>

                                            {/* Pick Up */}
                                            <div>
                                                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Pick Up</label>
                                                <input
                                                    type="text"
                                                    value={editFormData.pickupZip || ''}
                                                    onChange={(e) => setEditFormData({ ...editFormData, pickupZip: e.target.value })}
                                                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                                    placeholder="e.g., 77020"
                                                />
                                            </div>

                                            {/* Rate */}
                                            <div>
                                                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Rate (USD)</label>
                                                <input
                                                    type="number"
                                                    value={editFormData.rate || ''}
                                                    onChange={(e) => setEditFormData({ ...editFormData, rate: parseFloat(e.target.value) })}
                                                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                                    placeholder="e.g., 2500"
                                                />
                                            </div>

                                            {/* Transit Time */}
                                            <div>
                                                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Transit Time (days)</label>
                                                <input
                                                    type="number"
                                                    value={editFormData.transitTime || ''}
                                                    onChange={(e) => setEditFormData({ ...editFormData, transitTime: parseInt(e.target.value) })}
                                                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                                    placeholder="e.g., 21"
                                                />
                                            </div>

                                            {/* Valid Until */}
                                            <div>
                                                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">Valid Until</label>
                                                <input
                                                    type="date"
                                                    value={editFormData.validUntil?.split('T')[0] || ''}
                                                    onChange={(e) => setEditFormData({ ...editFormData, validUntil: e.target.value })}
                                                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Footer */}
                                    <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
                                        <button
                                            onClick={() => setEditQuote(null)}
                                            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium rounded-lg transition-colors"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={async () => {
                                                if (!onUpdateFreightQuote || !editQuote) {
                                                    alert('Update function not available');
                                                    return;
                                                }
                                                try {
                                                    const updatedQuote: FreightQuote = {
                                                        ...editQuote,
                                                        freightType: editFormData.freightType || editQuote.freightType,
                                                        status: editFormData.status || editQuote.status,
                                                        originPort: editFormData.originPort ?? editQuote.originPort,
                                                        originPortCode: extractPortCode(editFormData.originPort || editQuote.originPort || ''),
                                                        destinationPort: editFormData.destinationPort ?? editQuote.destinationPort,
                                                        destinationPortCode: extractPortCode(editFormData.destinationPort || editQuote.destinationPort || ''),
                                                        pickupZip: editFormData.pickupZip ?? editQuote.pickupZip,
                                                        rate: editFormData.rate ?? editQuote.rate,
                                                        transitTime: editFormData.transitTime ?? editQuote.transitTime,
                                                        validUntil: editFormData.validUntil ?? editQuote.validUntil,
                                                    };
                                                    await onUpdateFreightQuote(updatedQuote);
                                                    setEditQuote(null);
                                                } catch (error) {
                                                    console.error('Error updating freight quote:', error);
                                                    alert('Failed to save. Please try again.');
                                                }
                                            }}
                                            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg transition-colors flex items-center gap-2"
                                        >
                                            <Save size={16} /> Save Changes
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                    {/* ================================================================ */}
                    {/* DELETE QUOTE MODAL */}
                    {/* ================================================================ */}
                    {deleteQuote && (
                        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
                            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 animate-in zoom-in-95 duration-200">
                                {/* Header */}
                                <div className="bg-gradient-to-r from-red-500 to-red-600 px-6 py-4 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                                            <Trash2 size={20} className="text-white" />
                                        </div>
                                        <h2 className="text-lg font-bold text-white">Delete Quote</h2>
                                    </div>
                                    <button onClick={() => setDeleteQuote(null)} className="p-2 hover:bg-white/20 rounded-lg transition-colors">
                                        <X size={20} className="text-white" />
                                    </button>
                                </div>

                                {/* Content */}
                                <div className="p-6">
                                    <div className="flex items-start gap-4">
                                        <div className="flex-shrink-0 w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center">
                                            <AlertCircle size={24} />
                                        </div>
                                        <div>
                                            <p className="text-slate-800 font-medium">Are you sure you want to delete this quote?</p>
                                            <p className="text-sm text-slate-500 mt-2">
                                                This will permanently remove the freight quote from <strong>{deleteQuote.agentName}</strong> for the route{' '}
                                                <strong>{formatPortDisplay(deleteQuote.originPort)}</strong> → <strong>{formatPortDisplay(deleteQuote.destinationPort)}</strong>.
                                            </p>
                                            <p className="text-sm text-red-600 mt-3 font-medium">This action cannot be undone.</p>
                                        </div>
                                    </div>
                                </div>

                                {/* Footer */}
                                <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
                                    <button
                                        onClick={() => setDeleteQuote(null)}
                                        className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium rounded-lg transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => {
                                            // TODO: Implement delete from Supabase
                                            console.log('Delete quote:', deleteQuote.id);
                                            alert('Quote deleted! (Demo - implement Supabase delete)');
                                            setDeleteQuote(null);
                                        }}
                                        className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-bold rounded-lg transition-colors flex items-center gap-2"
                                    >
                                        <Trash2 size={16} /> Delete Quote
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Email Preview Modal */}
                    {emailPreviewOpen && (
                        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
                            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
                                {/* Header */}
                                <div className="bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-4 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <Mail className="text-white" size={24} />
                                        <h3 className="text-xl font-bold text-white">Email Preview</h3>
                                    </div>
                                    <button
                                        onClick={() => setEmailPreviewOpen(false)}
                                        className="p-1.5 rounded-lg hover:bg-white/20 transition-colors text-white"
                                    >
                                        <X size={20} />
                                    </button>
                                </div>

                                {/* Recipients */}
                                <div className="px-6 py-3 bg-slate-50 border-b border-slate-200">
                                    <p className="text-xs font-bold text-slate-500 uppercase mb-1">Recipients ({selectedAgents.length})</p>
                                    <div className="flex flex-wrap gap-2">
                                        {cargoAgents.filter(a => selectedAgents.includes(a.id)).map(agent => (
                                            <span key={agent.id} className="px-2 py-1 bg-purple-100 text-purple-700 text-xs font-medium rounded-full">
                                                {agent.name}
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                {/* Content */}
                                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                                    {/* Subject */}
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Subject</label>
                                        <input
                                            type="text"
                                            value={emailSubject}
                                            onChange={(e) => setEmailSubject(e.target.value)}
                                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                        />
                                    </div>

                                    {/* Body */}
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Message</label>
                                        <textarea
                                            value={emailBody}
                                            onChange={(e) => setEmailBody(e.target.value)}
                                            rows={15}
                                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none font-mono"
                                        />
                                    </div>
                                </div>

                                {/* Footer */}
                                <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
                                    <button
                                        onClick={() => setEmailPreviewOpen(false)}
                                        className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium rounded-lg transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleSendQuoteEmail}
                                        disabled={sendingEmail}
                                        className="px-6 py-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-bold rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                                    >
                                        {sendingEmail ? (
                                            <>
                                                <Loader2 size={16} className="animate-spin" />
                                                Sending...
                                            </>
                                        ) : (
                                            <>
                                                <Send size={16} />
                                                Send Email
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ================================================================ */}
            {/* WINDOW 4: INVOICE FOLLOW-UP (Standalone) */}
            {/* ================================================================ */}
            {activeWindow === 'INVOICE_FOLLOW_UP' && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in">
                    {/* KPI Card - Shipments Arriving This Week */}
                    <div className="p-4 bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-emerald-100">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-emerald-500 rounded-xl text-white">
                                <Ship size={24} />
                            </div>
                            <div>
                                <p className="text-sm text-emerald-600 font-medium">Arriving This Week</p>
                                <p className="text-3xl font-bold text-emerald-900">{arrivingThisWeek.length}</p>
                            </div>
                            {arrivingThisWeek.length > 0 && (
                                <div className="ml-auto flex gap-2">
                                    {arrivingThisWeek.filter(i => i.etaStatus === 'urgent').length > 0 && (
                                        <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm font-bold">
                                            🔴 {arrivingThisWeek.filter(i => i.etaStatus === 'urgent').length} urgent
                                        </span>
                                    )}
                                    {arrivingThisWeek.filter(i => i.etaStatus === 'soon').length > 0 && (
                                        <span className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-sm font-bold">
                                            🟡 {arrivingThisWeek.filter(i => i.etaStatus === 'soon').length} this week
                                        </span>
                                    )}
                                    {arrivingThisWeek.filter(i => i.etaStatus === 'normal').length > 0 && (
                                        <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-bold">
                                            🟢 {arrivingThisWeek.filter(i => i.etaStatus === 'normal').length} later
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Filter Bar */}
                    <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap gap-3 items-center">
                        {/* Search */}
                        <div className="relative flex-1 min-w-[200px] max-w-[300px]">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Search Invoice#, SO#, BL#..."
                                value={invoiceSearch}
                                onChange={(e) => setInvoiceSearch(e.target.value)}
                                className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                            />
                        </div>

                        {/* Customer Filter */}
                        <select
                            value={invoiceCustomerFilter}
                            onChange={(e) => setInvoiceCustomerFilter(e.target.value)}
                            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                        >
                            <option value="">All Customers</option>
                            {invoiceFilterOptions.customers.map(c => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>

                        {/* POA Filter */}
                        <select
                            value={invoicePoaFilter}
                            onChange={(e) => setInvoicePoaFilter(e.target.value)}
                            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                        >
                            <option value="">All POA</option>
                            {invoiceFilterOptions.poas.map(p => (
                                <option key={p} value={p}>{p}</option>
                            ))}
                        </select>

                        {/* POD Filter */}
                        <select
                            value={invoicePodFilter}
                            onChange={(e) => setInvoicePodFilter(e.target.value)}
                            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                        >
                            <option value="">All POD</option>
                            {invoiceFilterOptions.pods.map(p => (
                                <option key={p} value={p}>{p}</option>
                            ))}
                        </select>

                        {/* Clear Filters */}
                        {(invoiceSearch || invoiceCustomerFilter || invoicePoaFilter || invoicePodFilter) && (
                            <button
                                onClick={() => {
                                    setInvoiceSearch('');
                                    setInvoiceCustomerFilter('');
                                    setInvoicePoaFilter('');
                                    setInvoicePodFilter('');
                                }}
                                className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg flex items-center gap-1"
                            >
                                <X size={14} />
                                Clear
                            </button>
                        )}

                        {/* Results count */}
                        <span className="text-sm text-slate-500 ml-auto">
                            {filteredInvoices.length} of {pendingInvoices.length} invoices
                        </span>
                    </div>

                    {/* Table */}
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-slate-50 border-b border-slate-200">
                                <tr>
                                    {renderSortableHeader('INVOICE DATE', 'invoiceDate', 'left')}
                                    {renderSortableHeader('INVOICE #', 'invoiceNumber', 'left')}
                                    {renderSortableHeader('SO #', 'soNumber', 'left')}
                                    {renderSortableHeader('CUSTOMER', 'customer', 'left')}
                                    {renderSortableHeader('BOOKING', 'bookingNumber', 'left')}
                                    <th className="px-3 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">BL</th>
                                    <th className="px-3 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">POA</th>
                                    <th className="px-3 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">POD</th>
                                    {renderSortableHeader('ETA', 'eta', 'center')}
                                    <th className="px-3 py-3 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">CONTAINERS</th>
                                    {renderSortableHeader('WEIGHT', 'grossWeight', 'right')}
                                    <th className="px-3 py-3 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">ACTIONS</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredInvoices.map(inv => (
                                    <tr key={inv.id} className="hover:bg-emerald-50/30 transition-colors">
                                        <td className="px-3 py-3">
                                            <span className="text-sm text-slate-500">{formatDate(inv.invoiceDate)}</span>
                                        </td>
                                        <td className="px-3 py-3">
                                            {inv.originalDocument ? (
                                                <button
                                                    onClick={() => setViewingDocument({
                                                        type: 'invoice',
                                                        title: 'Invoice',
                                                        url: inv.originalDocument!,
                                                        docNumber: inv.invoiceNumber
                                                    })}
                                                    className="font-bold text-purple-600 font-mono hover:underline cursor-pointer"
                                                >
                                                    {inv.invoiceNumber}
                                                </button>
                                            ) : (
                                                <span className="font-bold text-slate-800 font-mono">{inv.invoiceNumber}</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-3">
                                            {inv.soNumber ? (
                                                <button
                                                    onClick={() => {
                                                        const so = salesOrders.find(s => s.soNumber === inv.soNumber);
                                                        if (so) setViewSalesOrder(so);
                                                    }}
                                                    className="font-mono text-indigo-600 hover:text-indigo-800 hover:underline text-sm font-medium"
                                                >
                                                    {inv.soNumber}
                                                </button>
                                            ) : <span className="text-slate-400">-</span>}
                                        </td>
                                        <td className="px-3 py-3">
                                            <span className="font-medium text-slate-700">{inv.customerFirstName}</span>
                                        </td>
                                        <td className="px-3 py-3">
                                            {inv.booking?.originalDocument ? (
                                                <button
                                                    onClick={() => setViewingDocument({
                                                        type: 'booking',
                                                        title: 'Booking Confirmation',
                                                        url: inv.booking!.originalDocument!,
                                                        docNumber: inv.bookingNumber || ''
                                                    })}
                                                    className="font-mono text-cyan-600 text-sm hover:underline cursor-pointer"
                                                >
                                                    {inv.bookingNumber}
                                                </button>
                                            ) : inv.bookingNumber ? (
                                                <span className="font-mono text-teal-600 text-sm">{inv.bookingNumber}</span>
                                            ) : <span className="text-slate-400">-</span>}
                                        </td>
                                        <td className="px-3 py-3">
                                            {inv.blData?.originalDocument ? (
                                                <button
                                                    onClick={() => setViewingDocument({
                                                        type: 'bl',
                                                        title: 'Bill of Lading',
                                                        url: inv.blData!.originalDocument!,
                                                        docNumber: inv.blData!.blNumber
                                                    })}
                                                    className="font-mono text-emerald-600 text-sm hover:underline cursor-pointer"
                                                >
                                                    {inv.blData.blNumber}
                                                </button>
                                            ) : inv.blData?.blNumber || inv.bl ? (
                                                <span className="font-mono text-emerald-600 text-sm">{inv.blData?.blNumber || inv.bl}</span>
                                            ) : <span className="text-slate-400">-</span>}
                                        </td>
                                        <td className="px-3 py-3">
                                            <span className="text-sm text-slate-600">{inv.poa || inv.blData?.portLoading || '-'}</span>
                                        </td>
                                        <td className="px-3 py-3">
                                            <span className="text-sm text-slate-600">{inv.pod || inv.blData?.portDischarge || '-'}</span>
                                        </td>
                                        <td className="px-3 py-3 text-center">
                                            {inv.etaStatus === 'arrived' ? (
                                                <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold">✓ Arrived</span>
                                            ) : inv.etaStatus === 'urgent' ? (
                                                <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-bold">{inv.etaDays}d 🔴</span>
                                            ) : inv.etaStatus === 'soon' ? (
                                                <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-bold">{inv.etaDays}d 🟡</span>
                                            ) : inv.etaStatus === 'normal' ? (
                                                <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-bold">{inv.etaDays}d 🟢</span>
                                            ) : (
                                                <span className="text-sm text-slate-400">-</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-3 text-center">
                                            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-sm font-bold">
                                                {inv.containerCount || '-'}
                                            </span>
                                        </td>
                                        <td className="px-3 py-3 text-right">
                                            <span className="text-sm text-slate-600">{inv.grossWeight ? parseFloat(inv.grossWeight.replace(/,/g, '')).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-'}</span>
                                        </td>
                                        <td className="px-3 py-3">
                                            <div className="flex items-center justify-center gap-1">
                                                {/* View PDF */}
                                                {inv.originalDocument && (
                                                    <a
                                                        href={inv.originalDocument}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="p-1.5 hover:bg-blue-100 rounded-lg transition-colors group"
                                                        title="View Invoice PDF"
                                                    >
                                                        <FileText size={14} className="text-slate-400 group-hover:text-blue-600" />
                                                    </a>
                                                )}
                                                {/* Send Reminder Email */}
                                                <a
                                                    href={`mailto:?subject=Invoice ${inv.invoiceNumber} Reminder&body=Dear ${inv.customerFirstName},%0D%0A%0D%0AThis is a friendly reminder regarding Invoice ${inv.invoiceNumber} dated ${formatDate(inv.invoiceDate)}.%0D%0A%0D%0APlease let us know if you have any questions.%0D%0A%0D%0ABest regards`}
                                                    className="p-1.5 hover:bg-amber-100 rounded-lg transition-colors group"
                                                    title="Send Reminder Email"
                                                >
                                                    <Mail size={14} className="text-slate-400 group-hover:text-amber-600" />
                                                </a>
                                                {/* Mark as Paid indicator */}
                                                <button
                                                    className="p-1.5 hover:bg-emerald-100 rounded-lg transition-colors group"
                                                    title="Mark as Paid"
                                                >
                                                    <CheckCircle2 size={14} className="text-slate-400 group-hover:text-emerald-600" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}

                                {filteredInvoices.length === 0 && (
                                    <tr>
                                        <td colSpan={12} className="py-16 text-center">
                                            <div className="flex flex-col items-center text-slate-400">
                                                <FileText size={48} className="mb-4 opacity-20" />
                                                <p className="font-medium">No invoices to follow up</p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )
            }
        </div >

    );
};

export default Logistics;
