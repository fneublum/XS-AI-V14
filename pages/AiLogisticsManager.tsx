import React, { useState, useMemo, useEffect } from 'react';
import { SalesOrder, Booking, FreightQuote, CargoAgent, User, Company, BillOfLading, Customer, Invoice, PackingList, Supplier } from '../types';
import { Ship, Package, FileText, Mail, Eye, Scale, Globe, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, Receipt, ClipboardList, ScrollText, X, Download, Loader2, MapPin, Search, FolderOpen } from 'lucide-react';
import jsPDF from 'jspdf';
import PDFPreviewModal from '../components/PDFPreviewModal';
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
    customers: Customer[];
    invoices: Invoice[];
    packingLists?: PackingList[];
    suppliers?: Supplier[];
    availableCompanies?: Company[];
    products?: any[];
    showPendingOrders?: boolean;
    ports?: any[];
    locations?: any[];
}

const AiLogisticsManager: React.FC<AiLogisticsManagerProps> = ({
    salesOrders,
    bookings,
    billOfLadings,
    freightQuotes,
    cargoAgents,
    onUpdateBooking,
    onAddBooking,
    onAddFreightQuote,
    currentUser,
    currentCompanyId,
    showPendingOrders = false,
    customers = [],
    invoices = [],
    packingLists = [],
    suppliers = [],
    availableCompanies = [],
    products = [],
    ports = [],
    locations = [],
}) => {
    const [expandedSO, setExpandedSO] = useState<string | null>(null);
    const [expandedShipment, setExpandedShipment] = useState<string | null>(null);
    const [documentsModalOpen, setDocumentsModalOpen] = useState(false);
    const [selectedDocInvoice, setSelectedDocInvoice] = useState<Invoice | null>(null);

    // Quote Search State
    const [searchPickup, setSearchPickup] = useState('');
    const [searchPol, setSearchPol] = useState('');
    const [searchPod, setSearchPod] = useState('');
    const [searchDelivery, setSearchDelivery] = useState('');
    const [searchType, setSearchType] = useState('ALL');

    const manualQuotes = useMemo(() => {
        // If no filters set, show nothing or all? Usually nothing until searched.
        if (!searchPickup && !searchPol && !searchPod && !searchDelivery) return [];

        return freightQuotes.filter(q => {
            if (q.status !== 'ACTIVE') return false;

            // 1. Service Type Filter
            if (searchType !== 'ALL' && q.freightType !== searchType) return false;

            // 2. Location Filters (Bidirectional)
            // We allow match if Quote contains Search OR Search contains Quote
            if (searchPickup) {
                const qLoc = (q.pickupLocation || '').toLowerCase();
                const sLoc = searchPickup.toLowerCase();
                // If quote has no location but search has one -> usually fail, UNLESS we want to be very loose.
                // Sticking to text match:
                if (!qLoc || (!qLoc.includes(sLoc) && !sLoc.includes(qLoc))) return false;
            }

            if (searchDelivery) {
                const qLoc = (q.deliveryLocation || '').toLowerCase();
                const sLoc = searchDelivery.toLowerCase();
                if (!qLoc || (!qLoc.includes(sLoc) && !sLoc.includes(qLoc))) return false;
            }

            // 3. Port Filters (Bidirectional Code Match)
            if (searchPol) {
                const qPolCode = (q.originPortCode || '').toLowerCase();
                const sPol = searchPol.toLowerCase();
                if (!qPolCode || (!qPolCode.includes(sPol) && !sPol.includes(qPolCode))) return false;
            }

            if (searchPod) {
                const qPodCode = (q.destinationPortCode || '').toLowerCase();
                const sPod = searchPod.toLowerCase();
                if (!qPodCode || (!qPodCode.includes(sPod) && !sPod.includes(qPodCode))) return false;
            }

            return true;
        }).sort((a, b) => (a.rate || 0) - (b.rate || 0));
    }, [searchPickup, searchPol, searchPod, searchDelivery, searchType, freightQuotes]);

    // PDF Preview Modal State
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewTitle, setPreviewTitle] = useState('');
    const [previewFileName, setPreviewFileName] = useState('');
    const [isLoadingDoc, setIsLoadingDoc] = useState(false);
    const [logoUrl, setLogoUrl] = useState<string>('');

    // Fetch company logo for PDF branding (matches PLInvoiceEngine)
    useEffect(() => {
        const fetchLogo = async () => {
            if (!currentCompanyId) return;
            try {
                const client = getSupabaseClient();
                const targetId = currentCompanyId === 'ALL' ? 'SYSTEM' : currentCompanyId;
                console.log('[Logistics] Fetching logo for companyId:', targetId);

                const { data } = await client
                    .from('imagens')
                    .select('url')
                    .eq('companyId', targetId)
                    .eq('type', 'LOGO')
                    .single();

                if (data?.url) {
                    console.log('[Logistics] Logo found, URL length:', data.url.length);
                    setLogoUrl(data.url);
                } else if (targetId !== 'SYSTEM') {
                    // Try system logo if company-specific not found
                    console.log('[Logistics] No company logo, trying SYSTEM logo...');
                    const { data: sysData } = await client
                        .from('imagens')
                        .select('url')
                        .eq('companyId', 'SYSTEM')
                        .eq('type', 'LOGO')
                        .single();
                    if (sysData?.url) {
                        console.log('[Logistics] System logo found');
                        setLogoUrl(sysData.url);
                    }
                }
            } catch (e) {
                console.log('[Logistics] No logo found for company');
            }
        };
        fetchLogo();
    }, [currentCompanyId]);

    // ============ COMPUTED DATA ============

    const sosNeedingBooking = useMemo(() => {
        const bookedSoIds = new Set(bookings.map(b => b.salesOrderId).filter(Boolean));
        const invoicedSoNumbers = new Set(
            invoices.map(i => (i as any).soNumber || (i as any).salesOrderNumber).filter(Boolean)
        );
        return salesOrders.filter(so =>
            so.status === 'APPROVED' &&
            !bookedSoIds.has(so.id) &&
            !invoicedSoNumbers.has(so.orderNumber)
        );
    }, [salesOrders, bookings, invoices]);

    const activeShipments = useMemo(() => {
        // Show all invoices as shipment records (pull directly from invoices table)
        // Sort by date descending (newest first)
        return invoices
            .filter(inv => inv.invoiceNumber && inv.invoiceNumber.trim() !== '')
            .sort((a, b) => {
                const dateA = new Date(a.invoiceDate || a.createdAt || '').getTime() || 0;
                const dateB = new Date(b.invoiceDate || b.createdAt || '').getTime() || 0;
                return dateB - dateA; // Descending (newest first)
            });
    }, [invoices]);

    const getQuotesForRoute = (poa: string, pod: string) => {
        return freightQuotes.filter(q => {
            const qPol = (q as any).originPortCode || (q as any).origin_port_code || '';
            const qPod = (q as any).destinationPortCode || (q as any).destination_port_code || '';
            return q.status === 'ACTIVE' &&
                (qPol.includes(poa) || poa.includes(qPol)) &&
                (qPod.includes(pod) || pod.includes(qPod));
        }).sort((a, b) => (a.rate || 0) - (b.rate || 0));
    };

    const formatDate = (d?: string) => {
        if (!d) return '-';
        try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
        catch { return d; }
    };

    const getPickupLocation = (so: SalesOrder): string => {
        if (so.pickupLocation) return so.pickupLocation;

        // Try to find supplier location from products/suppliers
        // Since we don't have products list prop, but we have suppliers list:
        // We can try to infer supplier from item description or just fallback
        if (so.items && so.items.length > 0) {
            return 'Supplier Location';
        }
        return 'TBD';
    };

    // Helper to get city from address string if possible
    const getCityFromLocation = (loc: string) => {
        if (!loc) return '';
        if (loc === 'Supplier Location') return 'Supplier';
        return loc.split(',')[0].substring(0, 15);
    };

    const getShipmentDocs = (booking: Booking) => {
        const so = salesOrders.find(s => s.id === booking.salesOrderId);
        const bl = billOfLadings.find(b => b.blNumber === booking.blNumber || (b as any).bookingId === booking.id);
        const invoice = invoices.find(i => (i as any).soNumber === so?.orderNumber || (i as any).salesOrderId === so?.id || (i as any).transportRef === booking.bookingNumber);
        const pl = packingLists?.find(p => (p as any).soNumber === so?.orderNumber || (p as any).bookingId === booking.id);
        return { so, bl, invoice, pl };
    };

    // ============ PDF GENERATORS ============

    const openPreview = (url: string, title: string, filename: string) => {
        setPreviewUrl(url);
        setPreviewTitle(title);
        setPreviewFileName(filename);
    };

    const closePreview = () => {
        setPreviewUrl(null);
        setPreviewTitle('');
        setPreviewFileName('');
    };

    const createBookingPDF = (booking: Booking): string => {
        const doc = new jsPDF();
        doc.setFillColor(30, 64, 175);
        doc.rect(0, 0, 210, 40, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(24);
        doc.setFont('helvetica', 'bold');
        doc.text("BOOKING CONFIRMATION", 105, 25, { align: 'center' });

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
        addLine("Port of Loading (POL)", booking.pol);
        addLine("Port of Discharge (POD)", booking.pod);
        if (booking.etd) addLine("Est. Departure (ETD)", formatDate(booking.etd));
        if (booking.eta) addLine("Est. Arrival (ETA)", formatDate(booking.eta));
        if (booking.carrier) addLine("Carrier", booking.carrier);
        if (booking.containerNumber) addLine("Container No.", booking.containerNumber);
        if (booking.blNumber) addLine("BL Reference", booking.blNumber);
        if (booking.vesselVoyage) addLine("Vessel/Voyage", booking.vesselVoyage);
        if (booking.equipment) addLine("Equipment", booking.equipment);

        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text("Generated by XSolution AI Logistics", 105, 280, { align: 'center' });
        return String(doc.output('bloburl'));
    };

    const createBLPDF = (bl: BillOfLading): string => {
        const doc = new jsPDF();
        doc.setFillColor(30, 64, 175);
        doc.rect(0, 0, 210, 40, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(24);
        doc.setFont('helvetica', 'bold');
        doc.text("BILL OF LADING", 105, 25, { align: 'center' });

        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);
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

        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text("Generated by XSolution AI Logistics", 105, 280, { align: 'center' });
        return String(doc.output('bloburl'));
    };

    const createSOPDF = (so: SalesOrder): string => {
        const doc = new jsPDF();
        doc.setFillColor(245, 127, 37);
        doc.rect(0, 0, 210, 40, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(24);
        doc.setFont('helvetica', 'bold');
        doc.text("SALES ORDER", 105, 25, { align: 'center' });

        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);
        let y = 50;
        const addLine = (label: string, value: string) => {
            doc.setFont('helvetica', 'bold');
            doc.text(`${label}:`, 20, y);
            doc.setFont('helvetica', 'normal');
            doc.text(value || '-', 80, y);
            y += 10;
        };

        const customer = customers.find(c => c.id === so.customerId);
        addLine("Order Number", so.orderNumber);
        addLine("Customer", customer?.name || so.customerName || '-');
        addLine("Order Date", formatDate(so.orderDate));
        addLine("Status", so.status);
        addLine("Origin (POA)", so.poa || '-');
        addLine("Destination (POD)", so.pod || '-');
        addLine("Delivery Date", formatDate(so.deliveryDate));
        addLine("Incoterm", so.incoterm || '-');
        addLine("Total Amount", `$${(so.totalAmount || 0).toLocaleString()}`);

        // Items
        if (so.items && so.items.length > 0) {
            y += 10;
            doc.setFont('helvetica', 'bold');
            doc.text("Items:", 20, y);
            y += 8;
            so.items.forEach(item => {
                doc.setFont('helvetica', 'normal');
                doc.text(`- ${item.productName}: ${item.quantity} units @ $${item.unitPrice}`, 25, y);
                y += 6;
            });
        }

        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text("Generated by XSolution AI Logistics", 105, 280, { align: 'center' });
        return String(doc.output('bloburl'));
    };

    const createInvoicePDF = (inv: Invoice): string => {
        const doc = new jsPDF();
        doc.setFillColor(16, 185, 129);
        doc.rect(0, 0, 210, 40, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(24);
        doc.setFont('helvetica', 'bold');
        doc.text("COMMERCIAL INVOICE", 105, 25, { align: 'center' });

        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);
        let y = 50;
        const addLine = (label: string, value: string) => {
            doc.setFont('helvetica', 'bold');
            doc.text(`${label}:`, 20, y);
            doc.setFont('helvetica', 'normal');
            doc.text(value || '-', 80, y);
            y += 10;
        };

        addLine("Invoice Number", inv.invoiceNumber);
        addLine("Date", formatDate(inv.invoiceDate || (inv as any).date));
        addLine("Bill To", (inv as any).soldTo || (inv as any).billToName || '-');
        addLine("Transport Ref", (inv as any).transportRef || '-');
        addLine("Currency", inv.currency || 'USD');
        addLine("Total Amount", `$${(inv.totalAmount || 0).toLocaleString()}`);

        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text("Generated by XSolution AI Logistics", 105, 280, { align: 'center' });
        return String(doc.output('bloburl'));
    };

    const createPLPDF = (pl: PackingList): string => {
        const doc = new jsPDF();

        // Color scheme matching EC4 Enterprises
        const cyanColor = '#00A0B0';
        const darkGray = '#333333';

        // Get company info
        const company = availableCompanies.find(c => c.id === currentCompanyId);
        const companyName = company?.name || 'EC4 ENTERPRISES LLC';
        const companyAddress = company?.address || '112 Bartran Oaks Walk #600010';
        const companyCity = `${company?.city || 'ST Johns'}, ${company?.state || 'FL'} ${company?.zip || '32260'} US`;

        // --- HEADER: Company info on left ---
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(darkGray);
        doc.text(companyName, 14, 15);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(companyAddress, 14, 21);
        doc.text(companyCity, 14, 26);

        // Logo on right side
        if (logoUrl) {
            try {
                let format = 'JPEG';
                if (logoUrl.startsWith('data:image/')) {
                    const match = logoUrl.match(/data:image\/(\w+);/);
                    if (match) {
                        format = match[1].toUpperCase();
                        if (format === 'JPG') format = 'JPEG';
                    }
                }
                const imgProps = doc.getImageProperties(logoUrl);
                const maxWidth = 55;
                const maxHeight = 25;
                let width = imgProps.width;
                let height = imgProps.height;
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width *= ratio;
                height *= ratio;
                const logoX = 210 - 14 - width;
                doc.addImage(logoUrl, format, logoX, 10, width, height);
            } catch (e) {
                console.error('[PL PDF] Logo load failed:', e);
            }
        }

        // --- PACKING LIST TITLE ---
        doc.setFontSize(20);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(cyanColor);
        doc.text('PACKING LIST', 14, 45);

        // --- SHIPPER / CONSIGNEE / PL INFO ---
        let y = 58;

        // Shipper Header & Content
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(darkGray);
        doc.text('SHIPPER', 14, y);
        doc.text('PL #', 140, y);
        doc.setFont('helvetica', 'normal');
        doc.text(pl.plNumber || '', 158, y);

        y += 6;
        doc.setFont('helvetica', 'bold');
        doc.text('DATE', 140, y);
        doc.setFont('helvetica', 'normal');
        doc.text(new Date(pl.date || '').toLocaleDateString(), 158, y);

        // Shipper content
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        let shipperY = 64;
        doc.text(pl.shipper || companyName, 14, shipperY);

        y = 80;
        // Consignee Header
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('CONSIGNEE', 14, y);
        y += 5;
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        const consigneeLines = doc.splitTextToSize(pl.consignee || '', 80);
        doc.text(consigneeLines, 14, y);
        y += consigneeLines.length * 4;

        // Customer address
        const customer = customers.find(c => c.name === pl.consignee);
        if (customer) {
            doc.setFont('helvetica', 'normal');
            const addrParts = [customer.location, customer.city, customer.state, customer.zip, customer.country].filter(Boolean);
            const customerAddress = addrParts.join(', ');
            if (customerAddress) {
                const addrLines = doc.splitTextToSize(customerAddress, 80);
                doc.text(addrLines, 14, y);
                y += addrLines.length * 4;
            }
        }

        y = 115;
        // Container/Seal Info
        doc.setFillColor(232, 244, 245);
        doc.rect(14, y - 4, 182, 8, 'F');
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('CONTAINER #', 16, y);
        doc.text('SEAL #', 75, y);
        doc.text('GROSS WT', 120, y);
        doc.text('NET WT', 165, y);
        y += 8;

        doc.setFont('helvetica', 'normal');
        doc.text(pl.containerNumber || '-', 16, y);
        doc.text(pl.sealNumber || '-', 75, y);
        doc.text(pl.grossWeight || '-', 120, y);
        doc.text(pl.netWeight || '-', 165, y);

        y += 15;
        // Items if available
        const items = typeof pl.items === 'string' ? JSON.parse(pl.items || '[]') : (pl.items || []);
        if (items.length > 0) {
            doc.setFillColor(232, 244, 245);
            doc.rect(14, y - 4, 182, 8, 'F');
            doc.setFont('helvetica', 'bold');
            doc.text('DESCRIPTION', 16, y);
            doc.text('QUANTITY', 130, y);
            doc.text('WEIGHT', 165, y);
            y += 8;

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            items.slice(0, 10).forEach((item: any) => {
                // LIVE product lookup for system description
                let desc = '';
                if (item.productId && products.length > 0) {
                    const prod = products.find((p: any) => p.id === item.productId);
                    if (prod) desc = prod.name;
                }
                if (!desc) desc = (item.description || item.productName || item.customerDescription || '').substring(0, 60);
                doc.text(desc, 16, y);
                doc.text(String(item.quantity || item.netKg || ''), 130, y);
                doc.text(String(item.netWeight || item.netKg || '-'), 165, y);
                y += 5;
            });
        }

        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text("Generated by XSolution AI", 105, 285, { align: 'center' });
        return String(doc.output('bloburl'));
    };

    // Detailed Invoice PDF (matching PLInvoiceEngine format with logo)
    const createDetailedInvoicePDF = (inv: any): string => {
        const doc = new jsPDF();

        // Color scheme matching EC4 Enterprises
        const cyanColor = '#00A0B0';
        const darkGray = '#333333';

        // Get company info
        const company = availableCompanies.find(c => c.id === currentCompanyId);
        const companyName = company?.name || 'EC4 ENTERPRISES LLC';
        const companyAddress = company?.address || '112 Bartran Oaks Walk #600010';
        const companyCity = `${company?.city || 'ST Johns'}, ${company?.state || 'FL'} ${company?.zip || '32260'} US`;

        // --- HEADER: Company info on left ---
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(darkGray);
        doc.text(companyName, 14, 15);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(companyAddress, 14, 21);
        doc.text(companyCity, 14, 26);

        // Logo on right side
        if (logoUrl) {
            try {
                let format = 'JPEG';
                if (logoUrl.startsWith('data:image/')) {
                    const match = logoUrl.match(/data:image\/(\w+);/);
                    if (match) {
                        format = match[1].toUpperCase();
                        if (format === 'JPG') format = 'JPEG';
                    }
                }
                const imgProps = doc.getImageProperties(logoUrl);
                const maxWidth = 55;
                const maxHeight = 25;
                let width = imgProps.width;
                let height = imgProps.height;
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width *= ratio;
                height *= ratio;
                const logoX = 210 - 14 - width;
                doc.addImage(logoUrl, format, logoX, 10, width, height);
            } catch (e) {
                console.error('[Invoice PDF] Logo load failed:', e);
            }
        }

        // --- INVOICE TITLE ---
        doc.setFontSize(20);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(cyanColor);
        doc.text('INVOICE', 14, 45);

        // --- BILL TO / INVOICE INFO ---
        let y = 58;
        const billToName = inv.billToName || inv.soldTo || '';
        const customer = customers.find(c => c.name === billToName);
        let customerAddress = '';
        if (customer) {
            const addrParts = [customer.location, customer.city, customer.state, customer.zip, customer.country].filter(Boolean);
            customerAddress = addrParts.join(', ');
        }

        // Bill To Header
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(darkGray);
        doc.text('BILL TO', 14, y);
        doc.text('INVOICE #', 140, y);
        doc.setFont('helvetica', 'normal');
        doc.text(inv.invoiceNumber || '', 175, y);

        y += 6;
        doc.setFont('helvetica', 'bold');
        doc.text('DATE', 140, y);
        doc.setFont('helvetica', 'normal');
        doc.text(new Date(inv.date || inv.invoiceDate || '').toLocaleDateString(), 175, y);

        y += 6;
        doc.setFont('helvetica', 'bold');
        doc.text('BOOKING #', 140, y);
        doc.setFont('helvetica', 'normal');
        doc.text(inv.transportRef || inv.bookingNumber || '-', 175, y);

        // Bill To Content
        y = 64;
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        const billToLines = doc.splitTextToSize(billToName, 55);
        doc.text(billToLines, 14, y);
        y += billToLines.length * 4;

        doc.setFont('helvetica', 'normal');
        if (customerAddress) {
            const addrLines = doc.splitTextToSize(customerAddress, 55);
            doc.text(addrLines, 14, y);
            y += addrLines.length * 4;
        }
        if (customer?.email) {
            doc.text(customer.email, 14, y);
        }

        y = 92;

        // Items section
        const items = typeof inv.items === 'string' ? JSON.parse(inv.items || '[]') : (inv.items || []);
        if (items.length > 0) {
            doc.setFillColor(232, 244, 245);
            doc.rect(14, y - 4, 182, 8, 'F');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.text("DESCRIPTION", 16, y);
            doc.text("QTY", 115, y);
            doc.text("PRICE", 140, y);
            doc.text("AMOUNT", 175, y);
            y += 8;

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            items.slice(0, 12).forEach((item: any) => {
                // LIVE product lookup for system description
                let desc = '';
                if (item.productId && products.length > 0) {
                    const prod = products.find((p: any) => p.id === item.productId);
                    if (prod) desc = prod.name;
                }
                if (!desc) desc = (item.description || item.productName || item.customerDescription || '').substring(0, 55);
                doc.text(desc, 16, y);
                doc.text(String(item.quantity || item.netKg || ''), 115, y);
                doc.text(`$${(item.unitPrice || item.price || 0).toFixed(2)}`, 140, y);
                doc.text(`$${(item.amount || (item.quantity * item.unitPrice) || 0).toLocaleString()}`, 175, y);
                y += 5;
            });
        }

        y += 8;
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('Gross Weight:', 14, y);
        doc.setFont('helvetica', 'normal');
        doc.text(inv.grossWeight || inv.gross_weight || '-', 50, y);
        doc.setFont('helvetica', 'bold');
        doc.text('Net Weight:', 90, y);
        doc.setFont('helvetica', 'normal');
        doc.text(inv.netWeight || inv.net_weight || '-', 120, y);

        y += 12;
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(cyanColor);
        const total = inv.totalAmount || items.reduce((sum: number, i: any) => sum + (i.amount || 0), 0);
        doc.text(`Total: $${Number(total).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 140, y);

        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text("Generated by XSolution AI", 105, 285, { align: 'center' });
        return String(doc.output('bloburl'));
    };

    // SLI PDF (Shipper's Letter of Instruction - Standard EEI Format)
    const createSLIPDF = (inv: any): string => {
        const doc = new jsPDF();
        const cyanColor = '#00A0B0';
        const darkGray = '#333333';

        const company = availableCompanies.find(c => c.id === currentCompanyId);
        const companyName = company?.name || 'EC4 ENTERPRISES LLC';
        const companyAddress = company?.address || '112 Bartran Oaks Walk #600010';
        const companyCity = `${company?.city || 'St Johns'}, ${company?.state || 'FL'} ${company?.zip || '32260'}`;
        const companyEIN = (company as any)?.ein || '';
        const companyPhone = (company as any)?.phone || '';
        const companyState = company?.state || 'FL';

        const consigneeName = inv.consignee || inv.billToName || inv.soldTo || '';
        const customer = customers.find(c => c.name === consigneeName || c.name === inv.billToName);
        const customerCountry = customer?.country || '';
        const customerAddr = customer ? [customer.location, customer.city, customer.state, customer.zip, customer.country].filter(Boolean).join(', ') : '';

        const items = typeof inv.items === 'string' ? JSON.parse(inv.items || '[]') : (inv.items || []);

        // Supplier state for Field 4 (freight origin)
        const supplierName = inv.supplier || inv.shipperName || inv.shipper || '';
        const itemSupplier = items.length > 0 ? (items[0].supplier || '') : '';
        const effectiveSupplier = supplierName || itemSupplier;
        const supplierObj = suppliers?.find((s: any) =>
            s.name === effectiveSupplier ||
            s.nickname === effectiveSupplier ||
            (effectiveSupplier && s.name && effectiveSupplier.toLowerCase().includes(s.name.toLowerCase())) ||
            (effectiveSupplier && s.name && s.name.toLowerCase().includes(effectiveSupplier.toLowerCase()))
        );
        const freightOriginState = supplierObj?.state || inv.originState || companyState;

        // POA for Field 15
        const poaValue = inv.poa || '';

        const totalNetLbs = items.reduce((sum: number, item: any) => sum + Number(item.netLbs || item.quantity || 0), 0);
        const totalNetKg = totalNetLbs * 0.453592;
        const totalGrossLbs = items.reduce((sum: number, item: any) => sum + Number(item.grossLbs || 0), 0);
        const totalGrossKg = totalGrossLbs > 0 ? totalGrossLbs * 0.453592 : totalNetKg * 1.02;
        const totalVolumes = items.reduce((sum: number, item: any) => sum + Number(item.volumes || 0), 0);

        if (logoUrl) {
            try {
                let format = 'JPEG';
                if (logoUrl.startsWith('data:image/')) {
                    const match = logoUrl.match(/data:image\/(\w+);/);
                    if (match) { format = match[1].toUpperCase(); if (format === 'JPG') format = 'JPEG'; }
                }
                const imgProps = doc.getImageProperties(logoUrl);
                const maxW = 55, maxH = 22;
                let w = imgProps.width, h = imgProps.height;
                const ratio = Math.min(maxW / w, maxH / h);
                w *= ratio; h *= ratio;
                doc.addImage(logoUrl, format, 14, 10, w, h);
            } catch (e) { console.error('[SLI PDF] Logo load failed:', e); }
        }

        doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(darkGray);
        doc.text(companyName, 196, 15, { align: 'right' });
        doc.setFontSize(9); doc.setFont('helvetica', 'normal');
        doc.text(companyAddress, 196, 21, { align: 'right' });
        doc.text(companyCity, 196, 26, { align: 'right' });

        let y = 40;
        const leftCol = 14;
        const rightCol = 110;
        const lineHeight = 5;

        doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(cyanColor);
        doc.text("SHIPPER'S LETTER OF INSTRUCTION", 105, y, { align: 'center' });
        y += 10;

        const drawLabel = (n: string, l: string, x: number, yy: number) => { doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor('#888888'); doc.text(`${n}. ${l}`, x, yy); };
        const drawVal = (v: string, x: number, yy: number, mw = 85) => { doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(darkGray); const ls = doc.splitTextToSize(v || '-', mw); doc.text(ls, x, yy); return ls.length * 4; };

        doc.setDrawColor('#cccccc'); doc.setLineWidth(0.3);

        // 1a: USPPI
        drawLabel('1a', 'U.S. PRINCIPAL PARTY IN INTEREST (USPPI)', leftCol, y);
        y += 4;
        doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(darkGray);
        doc.text(companyName, leftCol, y); y += 4;
        doc.setFont('helvetica', 'normal');
        doc.text(companyAddress, leftCol, y); y += 4;
        doc.text(companyCity, leftCol, y);
        if (companyPhone) { y += 4; doc.text(`Tel: ${companyPhone}`, leftCol, y); }

        // 1b: EIN
        y += 6;
        drawLabel('1b', 'USPPI EIN (IRS) NO.', leftCol, y); y += 4;
        doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(darkGray);
        doc.text(companyEIN ? `EIN: ${companyEIN}` : 'EIN: ______________', leftCol, y);

        let rY = y - 22;
        drawLabel('2', 'DATE OF EXPORTATION', rightCol, rY); rY += 4;
        drawVal(new Date(inv.date || inv.invoiceDate || new Date()).toISOString().split('T')[0], rightCol, rY); rY += 8;
        drawLabel('3', 'TRANSPORTATION REFERENCE NO.', rightCol, rY); rY += 4;
        drawVal(inv.bookingNumber || inv.transportRef || '-', rightCol, rY);

        y += 8; doc.line(leftCol, y, 196, y); y += 4;

        // 4 & 5
        drawLabel('4', 'POINT (STATE) OF ORIGIN OR FTZ NO.', leftCol, y); y += 4;
        drawVal(freightOriginState, leftCol, y);
        drawLabel('5', 'ULTIMATE CONSIGNEE', rightCol, y - 4);
        doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(darkGray);
        const cLines = doc.splitTextToSize(consigneeName, 82);
        doc.text(cLines, rightCol, y);
        let consEndY = y + cLines.length * 4;
        if (customerAddr) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); const al = doc.splitTextToSize(customerAddr, 82); doc.text(al, rightCol, consEndY); consEndY += al.length * 3.5; }

        y = Math.max(y + 8, consEndY + 4); doc.line(leftCol, y, 196, y); y += 4;

        // 7 & 8
        drawLabel('7', 'COUNTRY OF ULTIMATE DESTINATION', leftCol, y); y += 4;
        drawVal(customerCountry || 'N/A', leftCol, y);
        drawLabel('8', 'PARTIES TO TRANSACTION', rightCol, y - 4);
        drawVal('Non-Related', rightCol, y);
        y += 8; doc.line(leftCol, y, 196, y); y += 4;

        // 11 & 15
        drawLabel('11', 'MODE OF TRANSPORT', leftCol, y); y += 4;
        drawVal('VESSEL (Ocean)', leftCol, y);
        drawLabel('15', 'PORT OF EXPORT', rightCol, y - 4);
        drawVal(poaValue, rightCol, y);
        y += 8; doc.line(leftCol, y, 196, y); y += 4;

        // Goods Table (18-27)
        doc.setFillColor(232, 244, 245); doc.rect(leftCol, y - 2, 182, 7, 'F');
        doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor('#555555');
        doc.text('18. D/F', leftCol + 1, y + 2);
        doc.text('19. SCHEDULE B DESCRIPTION', leftCol + 14, y + 2);
        doc.text('20. QTY', leftCol + 95, y + 2);
        doc.text('22. SHIP WT (KG)', leftCol + 113, y + 2);
        doc.text('23. ECCN', leftCol + 140, y + 2);
        doc.text('26. VALUE ($)', leftCol + 160, y + 2);
        y += 8;

        doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(darkGray);
        if (items.length > 0) {
            items.forEach((item: any) => {
                if (y > 260) return;
                // LIVE product lookup for system description
                let desc = '';
                if (item.productId && products.length > 0) {
                    const prod = products.find((p: any) => p.id === item.productId);
                    if (prod) desc = prod.name;
                }
                if (!desc) desc = item.description || item.productDescription || item.customerDescription || '';
                const hs = item.hsCode || '';
                const dh = hs ? `${hs} - ${desc}` : desc;
                const qty = Number(item.netLbs || item.quantity || 0);
                const qk = qty * 0.453592;
                const amt = Number(item.amount || 0);
                doc.text('D', leftCol + 4, y);
                const dl = doc.splitTextToSize(dh.substring(0, 70), 78);
                doc.text(dl, leftCol + 14, y);
                doc.text(qk.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), leftCol + 95, y);
                doc.text(qk.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), leftCol + 113, y);
                doc.text('EAR99', leftCol + 140, y);
                doc.text(`$${amt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, leftCol + 160, y);
                y += Math.max(dl.length * 4, 5) + 1;
            });
        } else { doc.text('No items', leftCol + 14, y); y += 6; }

        y += 2;
        doc.setFillColor(240, 240, 240); doc.rect(leftCol, y - 3, 182, 7, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
        doc.text('TOTALS:', leftCol + 14, y);
        doc.text(`${totalNetKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KG`, leftCol + 95, y);
        doc.text(`${totalNetKg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KG`, leftCol + 113, y);
        doc.text(`$${Number(inv.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, leftCol + 160, y);
        y += 10;
        doc.line(leftCol, y - 3, 196, y - 3);

        // 25 & 9
        drawLabel('25', 'LICENSE EXCEPTION / AUTHORIZATION', leftCol, y); y += 4;
        drawVal('NLR (No License Required)', leftCol, y);
        drawLabel('9', 'ROUTED EXPORT TRANSACTION', rightCol, y - 4);
        drawVal('No', rightCol, y);
        y += 10;

        // Shipping Details
        doc.setFillColor(232, 244, 245); doc.rect(14, y, 182, 7, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(darkGray);
        doc.text('Shipping Details', 16, y + 5); y += 12;

        doc.setFontSize(9);
        const lv = 50, rv = 145;
        doc.setFont('helvetica', 'bold'); doc.text('Carrier:', leftCol, y); doc.setFont('helvetica', 'normal'); doc.text(inv.carrier || '', lv, y);
        doc.setFont('helvetica', 'bold'); doc.text('Booking #:', rightCol, y); doc.setFont('helvetica', 'normal'); doc.text(inv.bookingNumber || inv.transportRef || '-', rv, y);
        y += lineHeight + 1;
        doc.setFont('helvetica', 'bold'); doc.text('Incoterm:', leftCol, y); doc.setFont('helvetica', 'normal'); doc.text(inv.incoterm || 'EX-WORKS USA', lv, y);
        doc.setFont('helvetica', 'bold'); doc.text('Invoice #:', rightCol, y); doc.setFont('helvetica', 'normal'); doc.text(inv.invoiceNumber || '', rv, y);
        y += lineHeight + 1;
        doc.setFont('helvetica', 'bold'); doc.text('Total Amount:', leftCol, y); doc.setFont('helvetica', 'normal'); doc.text(`$${Number(inv.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, lv, y);
        doc.setFont('helvetica', 'bold'); doc.text('Currency:', rightCol, y); doc.setFont('helvetica', 'normal'); doc.text(inv.currency || 'USD', rv, y);
        y += lineHeight + 1;
        doc.setFont('helvetica', 'bold'); doc.text('Country of Origin:', leftCol, y); doc.setFont('helvetica', 'normal'); doc.text('USA', lv, y);

        doc.setFontSize(8); doc.setTextColor(100, 100, 100);
        doc.text("Generated by XSolution AI", 105, 285, { align: 'center' });
        return String(doc.output('bloburl'));
    };




    // ============ DOCUMENT VIEW HANDLER ============


    const handleViewDocument = async (type: 'SO' | 'BOOKING' | 'INVOICE' | 'PL' | 'SLI' | 'BL', booking: Booking) => {
        setIsLoadingDoc(true);
        const docs = getShipmentDocs(booking);

        try {
            if (type === 'BOOKING') {
                // Check for original document first
                if (booking.originalDocument) {
                    openPreview(booking.originalDocument, `Booking ${booking.bookingNumber}`, `Booking_${booking.bookingNumber}.pdf`);
                } else {
                    const url = createBookingPDF(booking);
                    openPreview(url, `Booking ${booking.bookingNumber}`, `Booking_${booking.bookingNumber}.pdf`);
                }
            } else if (type === 'SO') {
                if (docs.so) {
                    const url = createSOPDF(docs.so);
                    openPreview(url, `Sales Order ${docs.so.orderNumber}`, `SO_${docs.so.orderNumber}.pdf`);
                } else {
                    alert('No Sales Order linked to this shipment.');
                }
            } else if (type === 'BL') {
                if (docs.bl) {
                    const url = createBLPDF(docs.bl);
                    openPreview(url, `Bill of Lading ${docs.bl.blNumber}`, `BL_${docs.bl.blNumber}.pdf`);
                } else if (booking.blNumber) {
                    // Try to fetch from DB
                    const client = getSupabaseClient();
                    const { data: bl } = await client.from('bill_of_ladings').select('*').eq('blNumber', booking.blNumber).single();
                    if (bl) {
                        const url = createBLPDF(bl);
                        openPreview(url, `Bill of Lading ${bl.blNumber}`, `BL_${bl.blNumber}.pdf`);
                    } else {
                        alert('Bill of Lading not found.');
                    }
                } else {
                    alert('No Bill of Lading linked to this shipment.');
                }
            } else if (type === 'INVOICE') {
                // Fetch full invoice data from Supabase like InvoiceEngine does
                try {
                    const client = getSupabaseClient();
                    // Try multiple ways to find the invoice
                    let inv = docs.invoice;

                    if (!inv) {
                        // Try by transportRef (booking number)
                        const { data: invByTransport } = await client.from('invoices').select('*').eq('transportRef', booking.bookingNumber).single();
                        if (invByTransport) inv = invByTransport;
                    }

                    if (!inv && docs.so) {
                        // Try by SO number
                        const { data: invBySO } = await client.from('invoices').select('*').eq('soNumber', docs.so.orderNumber).single();
                        if (invBySO) inv = invBySO;
                    }

                    if (inv) {
                        // Fetch fresh data from DB
                        const { data: fullInv } = await client.from('invoices').select('*').eq('invoiceNumber', inv.invoiceNumber).single();

                        if (fullInv) {
                            const url = createDetailedInvoicePDF(fullInv);
                            openPreview(url, `Invoice ${fullInv.invoiceNumber}`, `Invoice_${fullInv.invoiceNumber}.pdf`);
                        } else {
                            const url = createInvoicePDF(inv);
                            openPreview(url, `Invoice ${inv.invoiceNumber}`, `Invoice_${inv.invoiceNumber}.pdf`);
                        }
                    } else {
                        alert('No Invoice linked to this shipment.');
                    }
                } catch (err) {
                    console.error('Error loading invoice:', err);
                    if (docs.invoice) {
                        const url = createInvoicePDF(docs.invoice);
                        openPreview(url, `Invoice ${docs.invoice.invoiceNumber}`, `Invoice_${docs.invoice.invoiceNumber}.pdf`);
                    } else {
                        alert('Error loading Invoice.');
                    }
                }
            } else if (type === 'PL') {
                if (docs.pl) {
                    const url = createPLPDF(docs.pl);
                    openPreview(url, `Packing List ${docs.pl.plNumber}`, `PL_${docs.pl.plNumber}.pdf`);
                } else {
                    // Try to find PL via invoice
                    try {
                        const client = getSupabaseClient();
                        const { data: plData } = await client.from('packing_lists').select('*').eq('bookingNumber', booking.bookingNumber).single();
                        if (plData) {
                            const url = createPLPDF(plData);
                            openPreview(url, `Packing List ${plData.plNumber}`, `PL_${plData.plNumber}.pdf`);
                        } else {
                            alert('No Packing List linked to this shipment.');
                        }
                    } catch {
                        alert('No Packing List linked to this shipment.');
                    }
                }
            } else if (type === 'SLI') {
                // SLI - Shipper's Letter of Instruction - generated from invoice data
                try {
                    const client = getSupabaseClient();
                    let inv = docs.invoice;

                    if (!inv) {
                        const { data: invByTransport } = await client.from('invoices').select('*').eq('transportRef', booking.bookingNumber).single();
                        if (invByTransport) inv = invByTransport;
                    }

                    if (inv) {
                        const { data: fullInv } = await client.from('invoices').select('*').eq('invoiceNumber', inv.invoiceNumber).single();

                        if (fullInv) {
                            const url = createSLIPDF(fullInv);
                            openPreview(url, `SLI ${fullInv.invoiceNumber}`, `SLI_${fullInv.invoiceNumber}.pdf`);
                        } else {
                            const url = createSLIPDF(inv);
                            openPreview(url, `SLI ${inv.invoiceNumber}`, `SLI_${inv.invoiceNumber}.pdf`);
                        }
                    } else {
                        alert('No Invoice/SLI data linked to this shipment.');
                    }
                } catch (err) {
                    console.error('Error loading SLI:', err);
                    alert('Error loading SLI.');
                }
            }
        } catch (error) {
            console.error('Error viewing document:', error);
            alert('Error loading document.');
        } finally {
            setIsLoadingDoc(false);
        }
    };

    // ============ RENDER ============
    return (
        <div className="h-screen bg-slate-100 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-r from-orange-500 to-amber-500 rounded-xl text-white"><Globe size={24} /></div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">Logistics AI</h1>
                        <p className="text-slate-500 text-sm mt-1">Shipment Tracking • Booking Requests</p>
                    </div>
                </div>
                <div className="flex gap-6 text-xs">
                    <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">{activeShipments.length}</div>
                        <div className="text-slate-500">In Transit</div>
                    </div>
                    <div className="text-center">
                        <div className="text-2xl font-bold text-amber-600">{sosNeedingBooking.length}</div>
                        <div className="text-slate-500">Need Booking</div>
                    </div>
                </div>
            </div>

            {/* Two-Panel Layout */}
            <div className="flex-1 flex overflow-hidden">
                {/* LEFT PANEL: Shipment Follow-up - 60% */}
                <div className="w-[60%] border-r border-slate-200 flex flex-col bg-white">
                    <div className="px-4 py-3 bg-blue-50 border-b border-blue-200 flex items-center gap-2">
                        <Ship size={18} className="text-blue-600" />
                        <span className="font-bold text-blue-800">SHIPMENT FOLLOW-UP</span>
                        <span className="ml-auto text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">
                            {activeShipments.length} active
                        </span>
                    </div>

                    <div className="flex-1 overflow-auto">
                        {activeShipments.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-slate-400">
                                <Ship size={40} className="text-slate-300 mb-2" />
                                <p className="font-medium">No active shipments</p>
                            </div>
                        ) : (
                            <table className="w-full text-xs">
                                <thead className="sticky top-0 bg-slate-100 z-10">
                                    <tr className="text-[10px] font-bold text-slate-500 uppercase">
                                        <th className="px-2 py-2 text-left">Date</th>
                                        <th className="px-2 py-2 text-left">Invoice</th>
                                        <th className="px-2 py-2 text-left">Customer</th>
                                        <th className="px-2 py-2 text-center">POD</th>
                                        <th className="px-2 py-2 text-left">POD Name</th>
                                        <th className="px-2 py-2 text-center">Ctrs</th>
                                        <th className="px-2 py-2 text-right">Net Wt</th>
                                        <th className="px-2 py-2 text-center">ETD</th>
                                        <th className="px-2 py-2 text-center">ETA</th>
                                        <th className="px-2 py-2 text-center">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {activeShipments.map(invoice => {
                                        const isExpanded = expandedShipment === invoice.id;

                                        // Get customer name from invoice (first 2 words)
                                        const customerName = (invoice as any).soldTo || (invoice as any).shipTo || (invoice as any).billToName || '';
                                        const customerShort = customerName.split(' ').slice(0, 2).join(' ');

                                        // Get POA from invoice origin
                                        const poa = (invoice as any).origin || '-';

                                        // Get POD code from invoice
                                        const podCode = (invoice as any).pod || '';
                                        const podPort = ports.find(p => p.code === podCode);
                                        const podName = podPort?.name || podCode || '-';

                                        // Get container count from invoice.containers
                                        let containerCount: number | string = '-';
                                        const containers = invoice.containers;
                                        if (containers) {
                                            try {
                                                const containerArray = typeof containers === 'string' ? JSON.parse(containers) : containers;
                                                containerCount = Array.isArray(containerArray) ? containerArray.length : 1;
                                            } catch { containerCount = 1; }
                                        }

                                        // Get net weight from invoice.netWeight (stored in LBS)
                                        let netWeightDisplay = '-';
                                        const rawNetWeight = invoice.netWeight;
                                        if (rawNetWeight) {
                                            const cleanWeight = String(rawNetWeight).replace(/,/g, '').replace(/[^0-9.]/g, '');
                                            const netLbs = parseFloat(cleanWeight);
                                            if (!isNaN(netLbs) && netLbs > 0) {
                                                netWeightDisplay = netLbs.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
                                            }
                                        }

                                        // Get linked booking for ETD/ETA (via transportRef)
                                        const linkedBooking = bookings.find(b =>
                                            b.bookingNumber === (invoice as any).transportRef ||
                                            b.id === (invoice as any).bookingId
                                        );
                                        const etd = linkedBooking?.etd || '-';
                                        const eta = linkedBooking?.eta || '-';

                                        return (
                                            <React.Fragment key={invoice.id}>
                                                <tr
                                                    className={`hover:bg-slate-50 cursor-pointer ${isExpanded ? 'bg-blue-50' : ''}`}
                                                    onClick={() => setExpandedShipment(isExpanded ? null : invoice.id)}
                                                >
                                                    <td className="px-2 py-1.5 font-medium text-slate-700">
                                                        {formatDate(invoice.invoiceDate || invoice.createdAt)}
                                                    </td>
                                                    <td className="px-2 py-1.5">
                                                        <span className="font-mono font-bold text-indigo-600">{invoice.invoiceNumber}</span>
                                                    </td>
                                                    <td className="px-2 py-1.5 text-slate-700 max-w-[100px] truncate" title={customerName}>
                                                        {customerShort}
                                                    </td>
                                                    <td className="px-2 py-1.5 text-center">
                                                        <span className="font-mono font-bold text-emerald-600">{podCode || '-'}</span>
                                                    </td>
                                                    <td className="px-2 py-1.5 text-slate-600 max-w-[120px] truncate" title={podName}>
                                                        {podName}
                                                    </td>
                                                    <td className="px-2 py-1.5 text-center font-medium">{containerCount}</td>
                                                    <td className="px-2 py-1.5 text-right font-mono text-slate-700">{netWeightDisplay}</td>
                                                    <td className="px-2 py-1.5 text-center font-medium text-slate-700">
                                                        {etd !== '-' ? formatDate(etd) : '-'}
                                                    </td>
                                                    <td className="px-2 py-1.5 text-center font-medium text-slate-700">
                                                        {eta !== '-' ? formatDate(eta) : '-'}
                                                    </td>
                                                    <td className="px-2 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                                                        {((invoice as any).bolUrl || (invoice as any).bolurl) ? (
                                                            <button
                                                                className="p-1 hover:bg-blue-100 rounded text-blue-600"
                                                                title="View Bill of Lading"
                                                                onClick={() => {
                                                                    const bolData = (invoice as any).bolUrl || (invoice as any).bolurl;
                                                                    setPreviewUrl(bolData);
                                                                    setPreviewTitle(`Bill of Lading - ${invoice.invoiceNumber}`);
                                                                }}
                                                            >
                                                                <Ship size={14} />
                                                            </button>
                                                        ) : (
                                                            <span className="text-slate-400 text-[10px]">-</span>
                                                        )}
                                                    </td>
                                                </tr>

                                                {/* Expanded: Invoice Details & Documents */}
                                                {isExpanded && (
                                                    <tr>
                                                        <td colSpan={10} className="bg-slate-50 border-t border-slate-100 px-4 py-3">
                                                            <div className="text-xs font-medium text-slate-500 mb-2 flex items-center gap-1">
                                                                <FileText size={12} />
                                                                INVOICE DOCUMENTS - {invoice.invoiceNumber}
                                                            </div>
                                                            <div className="grid grid-cols-4 gap-2">
                                                                <DocButton icon={Receipt} label="Invoice" docId={invoice.invoiceNumber} available={true} onClick={() => handleViewDocument('INVOICE', invoice as any)} />
                                                                <DocButton icon={Package} label="PL" docId={invoice.plNumber} available={!!invoice.plNumber} onClick={() => handleViewDocument('PL', invoice as any)} />
                                                                <DocButton icon={ScrollText} label="SLI" docId={invoice.invoiceNumber} available={true} onClick={() => handleViewDocument('SLI', invoice as any)} />
                                                                <DocButton icon={Ship} label="BOL" docId={(invoice as any).bl} available={!!(invoice as any).bl} onClick={() => handleViewDocument('BL', invoice as any)} />
                                                            </div>

                                                            {/* Additional Invoice Info */}
                                                            <div className="mt-3 pt-3 border-t border-slate-200 grid grid-cols-4 gap-4 text-xs">
                                                                <div>
                                                                    <div className="text-slate-500">Transport Ref</div>
                                                                    <div className="font-mono font-medium text-slate-800">{(invoice as any).transportRef || '-'}</div>
                                                                </div>
                                                                <div>
                                                                    <div className="text-slate-500">Carrier</div>
                                                                    <div className="font-medium text-slate-800">{invoice.carrier || '-'}</div>
                                                                </div>
                                                                <div>
                                                                    <div className="text-slate-500">Payment Terms</div>
                                                                    <div className="font-medium text-slate-800">{invoice.paymentTerms || '-'}</div>
                                                                </div>
                                                                <div>
                                                                    <div className="text-slate-500">Total Amount</div>
                                                                    <div className="font-bold text-emerald-600">${invoice.totalAmount?.toLocaleString() || '0'}</div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

                {/* RIGHT PANEL: Booking Requests & Manual Search - 40% */}
                <div className="w-[40%] flex flex-col bg-white border-l border-slate-200">

                    {/* TOP SECTION: Booking Requests (Approx 1/2) */}
                    <div className="flex-1 flex flex-col overflow-hidden min-h-0 border-b border-slate-200">
                        <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-center gap-2 shrink-0">
                            <Package size={18} className="text-amber-600" />
                            <span className="font-bold text-amber-800">BOOKING REQUESTS</span>
                            <span className="ml-auto text-xs text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">
                                {sosNeedingBooking.length} pending
                            </span>
                        </div>

                        <div className="flex-1 overflow-auto custom-scrollbar">
                            {sosNeedingBooking.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8">
                                    <CheckCircle2 size={40} className="text-emerald-400 mb-2" />
                                    <p className="font-medium text-center">All orders have bookings!</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-slate-100">
                                    {sosNeedingBooking.map(so => {
                                        const customer = customers.find(c => c.id === so.customerId);
                                        const isExpanded = expandedSO === so.id;
                                        const quotes = getQuotesForRoute(so.poa || '', so.pod || '');
                                        const daysUntil = so.deliveryDate ? Math.ceil((new Date(so.deliveryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
                                        const isUrgent = daysUntil !== null && daysUntil <= 7;

                                        return (
                                            <div key={so.id} className={`${isUrgent ? 'bg-red-50/50' : ''}`}>
                                                {/* SO Row */}
                                                <div
                                                    className="px-4 py-2 flex items-center gap-3 hover:bg-slate-50 cursor-pointer"
                                                    onClick={() => setExpandedSO(isExpanded ? null : so.id)}
                                                >
                                                    {isExpanded ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}

                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-mono font-bold text-slate-800 text-sm">{so.orderNumber}</span>
                                                            {isUrgent && <span className="text-[10px] px-1.5 py-0.5 bg-red-500 text-white rounded font-bold">URGENT</span>}
                                                        </div>
                                                        <div className="text-xs text-slate-500 truncate">{customer?.name || 'Customer'}</div>
                                                    </div>

                                                    <div className="flex items-center gap-2 text-xs">
                                                        <span className="font-mono text-slate-500 font-bold flex items-center gap-1">
                                                            <MapPin size={10} />
                                                            {getCityFromLocation(so.pickupLocation || 'Supplier')}
                                                        </span>
                                                        <span className="text-slate-400">→</span>
                                                        <span className="font-mono text-blue-600 font-bold">{so.poa || 'POA'}</span>
                                                        <span className="text-slate-400">→</span>
                                                        <span className="font-mono text-emerald-600 font-bold">{so.pod || 'POD'}</span>
                                                        <div className={`ml-2 text-right ${quotes.length > 0 ? 'text-purple-600' : 'text-slate-400'}`}>
                                                            <Scale size={12} className="inline mr-1" />
                                                            {quotes.length}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Expanded: Quote Comparison */}
                                                {isExpanded && (
                                                    <div className="px-4 pb-3 bg-slate-50 border-t border-slate-100">
                                                        {quotes.length === 0 ? (
                                                            <div className="py-4 text-center text-sm text-slate-500">
                                                                No quotes for this route.
                                                                <button className="ml-1 text-blue-600 hover:underline">Request quotes</button>
                                                            </div>
                                                        ) : (
                                                            <div className="pt-2">
                                                                <div className="text-xs font-medium text-slate-500 mb-2">QUOTES ({quotes.length})</div>
                                                                <div className="space-y-1">
                                                                    {quotes.slice(0, 4).map((q, i) => (
                                                                        <div key={q.id} className={`flex items-center justify-between p-2 rounded-lg text-xs ${i === 0 ? 'bg-emerald-100 border border-emerald-300' : 'bg-white border border-slate-200'
                                                                            }`}>
                                                                            <div className="flex items-center gap-2">
                                                                                {i === 0 && <span className="text-emerald-600">★</span>}
                                                                                <span className="font-medium">{q.agentName}</span>
                                                                            </div>
                                                                            <div className="flex items-center gap-2">
                                                                                <span className={`font-mono font-bold ${i === 0 ? 'text-emerald-700' : 'text-slate-700'}`}>
                                                                                    ${(q.rate || 0).toLocaleString()}
                                                                                </span>
                                                                                <button className="px-2 py-1 bg-blue-600 text-white rounded font-bold hover:bg-blue-700">
                                                                                    Book
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}

                                                        <div className="mt-3 pt-2 border-t border-slate-200 flex justify-end">
                                                            <button className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 text-white text-xs font-bold rounded-lg hover:bg-purple-700">
                                                                <Mail size={12} />
                                                                Request Quotes
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* BOTTOM SECTION: Quote Search (Approx 1/3) */}
                    <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-10">
                        <div className="px-4 py-2 bg-purple-50 border-b border-purple-100 flex items-center gap-2">
                            <Search size={16} className="text-purple-600" />
                            <span className="font-bold text-purple-800 text-sm">QUOTE SEARCH</span>
                        </div>

                        {/* Search Filters Grid */}
                        <div className="p-3 border-b border-slate-200 bg-white grid grid-cols-2 gap-2">
                            {/* Row 1: Pickup & Delivery */}
                            <div>
                                <label className="block text-[9px] font-bold text-slate-400 uppercase">Pick Up Loc</label>
                                <select
                                    className="w-full border border-slate-300 rounded p-1 text-xs"
                                    value={searchPickup}
                                    onChange={e => setSearchPickup(e.target.value)}
                                >
                                    <option value="">Any</option>
                                    {[...locations].sort((a, b) => a.name.localeCompare(b.name)).map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-[9px] font-bold text-slate-400 uppercase">Delivery Loc</label>
                                <select
                                    className="w-full border border-slate-300 rounded p-1 text-xs"
                                    value={searchDelivery}
                                    onChange={e => setSearchDelivery(e.target.value)}
                                >
                                    <option value="">Any</option>
                                    {[...locations].sort((a, b) => a.name.localeCompare(b.name)).map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                                </select>
                            </div>

                            {/* Row 2: POA & POD */}
                            <div>
                                <label className="block text-[9px] font-bold text-slate-400 uppercase">POA (Origin)</label>
                                <select
                                    className="w-full border border-slate-300 rounded p-1 text-xs"
                                    value={searchPol}
                                    onChange={e => setSearchPol(e.target.value)}
                                >
                                    <option value="">Any</option>
                                    {[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.code}>{p.name} ({p.code})</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-[9px] font-bold text-slate-400 uppercase">POD (Dest)</label>
                                <select
                                    className="w-full border border-slate-300 rounded p-1 text-xs"
                                    value={searchPod}
                                    onChange={e => setSearchPod(e.target.value)}
                                >
                                    <option value="">Any</option>
                                    {[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.code}>{p.name} ({p.code})</option>)}
                                </select>
                            </div>

                            {/* Row 3: Service Type (Full Width) */}
                            <div className="col-span-2">
                                <label className="block text-[9px] font-bold text-slate-400 uppercase">Service Type</label>
                                <select
                                    className="w-full border border-slate-300 rounded p-1 text-xs"
                                    value={searchType}
                                    onChange={e => setSearchType(e.target.value)}
                                >
                                    <option value="ALL">All Types</option>
                                    <option value="PORT_PORT">Port to Port</option>
                                    <option value="PORT_DOOR">Port to Door</option>
                                    <option value="DOOR_PORT">Door to Port</option>
                                    <option value="DOOR_DOOR">Door to Door</option>
                                </select>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto p-2 bg-slate-50 custom-scrollbar">
                            {!searchPickup && !searchPol && !searchPod && !searchDelivery ? (
                                <div className="h-full flex flex-col items-center justify-center text-slate-400 text-xs">
                                    <Search size={24} className="mb-2 opacity-50" />
                                    <p>Select criteria to find quotes</p>
                                </div>
                            ) : manualQuotes.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-slate-400 text-xs">
                                    <p>No matching quotes found.</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {manualQuotes.map(q => (
                                        <div key={q.id} className="bg-white p-2 rounded border border-slate-200 shadow-sm flex items-center justify-between hover:shadow-md transition-shadow">
                                            <div className="min-w-0 flex-1 mr-2">
                                                <div className="font-bold text-slate-800 text-xs truncate" title={q.agentName}>{q.agentName}</div>
                                                <div className="text-[10px] text-slate-500 flex flex-wrap gap-1">
                                                    <span className="font-mono bg-slate-100 px-1 rounded">{q.originPortCode}</span>
                                                    <span>→</span>
                                                    <span className="font-mono bg-slate-100 px-1 rounded">{q.destinationPortCode}</span>
                                                    <span>•</span>
                                                    <span>{q.transitTime}d</span>
                                                </div>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <div className="font-bold text-emerald-600 text-sm">${(q.rate || 0).toLocaleString()}</div>
                                                <div className="text-[9px] text-slate-400">{q.validUntil}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* PDF Preview Modal - Using Standard Component */}
            <PDFPreviewModal
                isOpen={!!previewUrl}
                onClose={() => setPreviewUrl(null)}
                pdfUrl={previewUrl}
                title={previewTitle}
                fileName={previewFileName}
            // Determine if we can email based on context - for now simple download
            />

            {/* Loading Overlay */}
            {isLoadingDoc && (
                <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 flex items-center gap-3 shadow-xl">
                        <Loader2 className="animate-spin text-blue-600" size={24} />
                        <span className="font-medium text-slate-700">Loading document...</span>
                    </div>
                </div>
            )}

            {/* Delivery Documents Modal */}
            {documentsModalOpen && selectedDocInvoice && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
                        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white p-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold">Delivery Documents</h3>
                                <button onClick={() => setDocumentsModalOpen(false)} className="p-1 hover:bg-white/20 rounded">
                                    <X size={20} />
                                </button>
                            </div>
                            <p className="text-sm text-white/80 mt-1">Invoice #{selectedDocInvoice.invoiceNumber}</p>
                        </div>
                        <div className="p-4 space-y-3">
                            {/* Invoice */}
                            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                                <div className="flex items-center gap-3">
                                    <FileText size={20} className="text-indigo-600" />
                                    <div>
                                        <p className="font-medium text-slate-700">Invoice</p>
                                        <p className="text-xs text-slate-500">#{selectedDocInvoice.invoiceNumber}</p>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => handleViewDocument('INVOICE', selectedDocInvoice as any)} className="p-1.5 hover:bg-indigo-100 rounded text-indigo-600" title="View Invoice">
                                        <Eye size={16} />
                                    </button>
                                    <button
                                        onClick={async () => {
                                            const url = createDetailedInvoicePDF(selectedDocInvoice);
                                            const link = document.createElement('a');
                                            link.href = url;
                                            link.download = `Invoice_${selectedDocInvoice.invoiceNumber}.pdf`;
                                            link.click();
                                        }}
                                        className="p-1.5 hover:bg-indigo-100 rounded text-indigo-600"
                                        title="Download Invoice"
                                    >
                                        <Download size={16} />
                                    </button>
                                </div>
                            </div>

                            {/* Packing List */}
                            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                                <div className="flex items-center gap-3">
                                    <Package size={20} className="text-indigo-600" />
                                    <div>
                                        <p className="font-medium text-slate-700">Packing List</p>
                                        <p className="text-xs text-slate-500">{selectedDocInvoice.plNumber || 'From invoice data'}</p>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => handleViewDocument('PL', selectedDocInvoice as any)} className="p-1.5 hover:bg-indigo-100 rounded text-indigo-600" title="View Packing List">
                                        <Eye size={16} />
                                    </button>
                                    <button
                                        onClick={() => {
                                            const url = createPLPDF(selectedDocInvoice as any);
                                            const link = document.createElement('a');
                                            link.href = url;
                                            link.download = `PL_${selectedDocInvoice.plNumber || selectedDocInvoice.invoiceNumber}.pdf`;
                                            link.click();
                                        }}
                                        className="p-1.5 hover:bg-indigo-100 rounded text-indigo-600"
                                        title="Download Packing List"
                                    >
                                        <Download size={16} />
                                    </button>
                                </div>
                            </div>

                            {/* SLI */}
                            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                                <div className="flex items-center gap-3">
                                    <ClipboardList size={20} className="text-indigo-600" />
                                    <div>
                                        <p className="font-medium text-slate-700">Shipper's Letter of Instruction</p>
                                        <p className="text-xs text-slate-500">Auto-generated from invoice</p>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => handleViewDocument('SLI', selectedDocInvoice as any)} className="p-1.5 hover:bg-indigo-100 rounded text-indigo-600" title="View SLI">
                                        <Eye size={16} />
                                    </button>
                                    <button
                                        onClick={() => {
                                            const url = createSLIPDF(selectedDocInvoice);
                                            const link = document.createElement('a');
                                            link.href = url;
                                            link.download = `SLI_${selectedDocInvoice.invoiceNumber}.pdf`;
                                            link.click();
                                        }}
                                        className="p-1.5 hover:bg-indigo-100 rounded text-indigo-600"
                                        title="Download SLI"
                                    >
                                        <Download size={16} />
                                    </button>
                                </div>
                            </div>

                            {/* Bill of Lading */}
                            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                                <div className="flex items-center gap-3">
                                    <Ship size={20} className={((selectedDocInvoice as any).bolUrl || (selectedDocInvoice as any).bolurl || (selectedDocInvoice as any).bl) ? 'text-indigo-600' : 'text-amber-500'} />
                                    <div>
                                        <p className="font-medium text-slate-700">Bill of Lading</p>
                                        <p className="text-xs text-slate-500">{((selectedDocInvoice as any).bolUrl || (selectedDocInvoice as any).bolurl || (selectedDocInvoice as any).bl) ? 'Available' : 'Not available'}</p>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    {((selectedDocInvoice as any).bolUrl || (selectedDocInvoice as any).bolurl || (selectedDocInvoice as any).bl) ? (
                                        <>
                                            <button onClick={() => handleViewDocument('BL', selectedDocInvoice as any)} className="p-1.5 hover:bg-indigo-100 rounded text-indigo-600" title="View BOL">
                                                <Eye size={16} />
                                            </button>
                                            <button
                                                onClick={() => {
                                                    const bolData = (selectedDocInvoice as any).bolUrl || (selectedDocInvoice as any).bolurl;
                                                    const link = document.createElement('a');
                                                    link.href = bolData;
                                                    link.download = `BOL_${selectedDocInvoice.invoiceNumber}.pdf`;
                                                    link.click();
                                                }}
                                                className="p-1.5 hover:bg-indigo-100 rounded text-indigo-600"
                                                title="Download BOL"
                                            >
                                                <Download size={16} />
                                            </button>
                                        </>
                                    ) : (
                                        <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full">N/A</span>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="border-t p-4 bg-slate-50 flex justify-end">
                            <button
                                onClick={() => setDocumentsModalOpen(false)}
                                className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// Document Button Component
const DocButton = ({ icon: Icon, label, docId, available, onClick }: { icon: any, label: string, docId?: string, available: boolean, onClick: () => void }) => (
    <button
        disabled={!available}
        onClick={(e) => { e.stopPropagation(); if (available) onClick(); }}
        className={`flex items-center gap-2 p-2 rounded-lg text-xs transition-all ${available
            ? 'bg-white border border-slate-200 hover:border-blue-400 hover:bg-blue-50 cursor-pointer'
            : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-transparent'
            }`}
    >
        <Icon size={14} className={available ? 'text-blue-600' : 'text-slate-300'} />
        <div className="text-left flex-1 min-w-0">
            <div className={`font-medium ${available ? 'text-slate-700' : 'text-slate-400'}`}>{label}</div>
            <div className={`text-[10px] truncate ${available ? 'text-blue-600' : 'text-slate-400'}`}>
                {available ? docId || 'View' : 'N/A'}
            </div>
        </div>
        {available && <Eye size={12} className="text-slate-400" />}
    </button>
);

export default AiLogisticsManager;
