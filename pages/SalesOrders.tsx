
import React, { useState, useEffect, useMemo } from 'react';
import { SalesOrder, SalesOrderItem, Customer, Product, Booking, Role, Invoice, User, Company, Port, FreightQuote, SavedLocation, CargoAgent, CompanyImage, Bank } from '../types';
import { Plus, Save, Trash2, Edit3, CheckCircle, XCircle, FileText, Link, Truck, Search, Bot, Loader2, Sparkles, AlertTriangle, ArrowRight, ClipboardList, Receipt, MapPin, Globe, Calendar, CreditCard, Ship, Package, Anchor, Mail, X, CheckCircle2, ListChecks, ArrowLeft, Building, Eye, FilePlus, ChevronDown, Copy } from 'lucide-react';
import PDFPreviewModal from '../components/PDFPreviewModal';
import { getSupabaseClient } from '../services/supabase';
import { generateCustomerDescription } from '../services/geminiService';
import { QuantityInput, PriceInput, FormattedInput } from '../components/UnitInputs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PAYMENT_TERM_OPTIONS } from '../constants';
import { useSupabase } from '../hooks/useSupabase';
import { getTokenFor, loginRequest } from '../services/smailAuth';
import { useWorkflow } from '../hooks/useWorkflow';
import { autoPopulateService } from '../services/autoPopulateService';

interface SalesOrdersProps {
    currentUser: User;
    currentCompanyId: string;
    customers: Customer[];
    products: Product[];
    bookings: Booking[];
    onAddBooking?: (b: Booking) => void;
    onUpdateBooking?: (b: Booking) => void;
    ports?: Port[];
    onAddPort?: (p: Port) => void;
    freightQuotes?: FreightQuote[];
    onAddFreightQuote: (fq: FreightQuote) => void;
    locations: SavedLocation[];
    onAddLocation: (l: SavedLocation) => void;
    salesOrders: SalesOrder[];
    onAdd: (order: SalesOrder) => void;
    onUpdate: (order: SalesOrder) => void;
    onDelete: (id: string) => void;
    invoices: Invoice[];
    banks?: Bank[];
}

const SalesOrders: React.FC<SalesOrdersProps> = ({
    currentUser,
    currentCompanyId,
    customers,
    products,
    bookings,
    onAddBooking,
    onUpdateBooking,
    ports = [],
    onAddPort,
    freightQuotes = [],
    onAddFreightQuote,
    locations,
    onAddLocation,
    salesOrders,
    onAdd,
    onUpdate,
    onDelete,
    invoices = [],
    banks = []
}) => {
    // --- WORKFLOW ENGINE ---
    const { onSalesOrderCreated, onSalesOrderApproved } = useWorkflow({
        companyId: currentCompanyId,
        userId: currentUser?.id,
    });

    // --- FULFILLMENT CHECK ---
    const isOrderFulfilled = (order: SalesOrder) => {
        // Option 1: Direct status check (if manually set)
        if (order.status === 'FULFILLED') return true;

        // Option 2: Check active Invoices
        // We look for any invoice that references this Order Number
        const normalizedOrderNumber = order.orderNumber.trim().toUpperCase();

        const linkedInvoice = invoices.find(inv => {
            if (!inv.invoiceNumber) return false;

            // Check reference fields
            const refMatches = [
                inv.transportRef,
                inv.customerPo,
                inv.soNumber,        // Specific SO field on Invoice
                inv.dateOrder        // Sometimes used for ref
            ].some(ref => ref && ref.trim().toUpperCase() === normalizedOrderNumber);

            // Also check items payload if it was pushed from SO
            let itemMatch = false;
            if (inv.items && typeof inv.items === 'string' && inv.items.includes(normalizedOrderNumber)) {
                itemMatch = true;
            }

            return refMatches || itemMatch;
        });

        return !!linkedInvoice;
    };

    const [viewMode, setViewMode] = useState<'LIST' | 'FORM'>('LIST');
    const [activeTab, setActiveTab] = useState<'PENDING' | 'APPROVED' | 'FULFILLED'>('PENDING');

    // Internal state for manual fetching (if needed)
    const [orders, setOrders] = useState<SalesOrder[]>([]);

    // Form State
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<SalesOrder>>({});
    const [currentItem, setCurrentItem] = useState<Partial<SalesOrderItem>>({
        quantity: 0,
        unitPrice: 0,
        total: 0,
        customerDescription: '',
        hsCode: ''
    });

    // AI State
    const [isAiGenerating, setIsAiGenerating] = useState(false);
    const [aiSuggestion, setAiSuggestion] = useState('');

    // Booking Request
    const [showBookingRequestModal, setShowBookingRequestModal] = useState(false);
    const [bookingModalView, setBookingModalView] = useState<'list' | 'form'>('list');
    const [selectedOrderForLink, setSelectedOrderForLink] = useState<SalesOrder | null>(null);
    const [quoteQuantities, setQuoteQuantities] = useState<Record<string, number>>({});
    const [selectedQuoteIds, setSelectedQuoteIds] = useState<string[]>([]);

    // New Quote Request State
    const [newQuotePickups, setNewQuotePickups] = useState<string[]>([]);
    const [currentPickupSelection, setCurrentPickupSelection] = useState('');
    const [newQuotePOA, setNewQuotePOA] = useState('');
    const [newQuotePOD, setNewQuotePOD] = useState('');

    // --- Dynamic Origin Support ---
    const [targetOriginField, setTargetOriginField] = useState<'POA' | 'PICKUP' | null>(null);

    // Port Quick Add State
    const [showQuickAddPort, setShowQuickAddPort] = useState(false);
    const [newPortCode, setNewPortCode] = useState('');
    const [newPortName, setNewPortName] = useState('');
    const [newPortCountry, setNewPortCountry] = useState('');
    const [portAddedMessage, setPortAddedMessage] = useState('');
    const [targetPortField, setTargetPortField] = useState<'MAIN_POD' | 'MAIN_POA' | 'QUOTE_POA' | 'QUOTE_POD' | null>(null);

    // Location Quick Add State
    const [showQuickAddLocation, setShowQuickAddLocation] = useState(false);
    const [newLocName, setNewLocName] = useState('');
    const [newLocAddress, setNewLocAddress] = useState('');
    const [newLocCity, setNewLocCity] = useState('');
    const [newLocState, setNewLocState] = useState('');
    const [newLocZip, setNewLocZip] = useState('');
    const [locationAddedMessage, setLocationAddedMessage] = useState('');

    // PDF Modal State
    const [showPdfModal, setShowPdfModal] = useState(false);
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
    const [pdfTitle, setPdfTitle] = useState('');
    const [pdfFileName, setPdfFileName] = useState('');
    const [pdfDownloadFn, setPdfDownloadFn] = useState<(() => void) | null>(null);

    // Customer Filter State
    const [customerFilter, setCustomerFilter] = useState('');

    const isAdminOrManager = [Role.ADMIN, Role.CEO, Role.MANAGER].includes(currentUser.role);

    // Scope customers: sales role only sees their assigned customers
    const scopedCustomers = isAdminOrManager
        ? customers
        : customers.filter(c => c.sales_person_id === currentUser.id);
    const client = getSupabaseClient();
    const { data: cargoAgents } = useSupabase<CargoAgent>('cargo_agents');
    // We need company list for PDF header
    const { data: companies } = useSupabase<Company>('companies');
    const { data: companyImages } = useSupabase<CompanyImage>('imagens');

    const getMatchingQuotes = () => {
        if (!selectedOrderForLink) return [];
        const orderPod = (selectedOrderForLink.pod || '').toLowerCase().trim();
        const soMethod = selectedOrderForLink.deliveryMethod;

        return freightQuotes.filter(q => {
            if (q.status !== 'ACTIVE') return false;

            let requiredType = '';
            if (soMethod === 'PORT_TO_PORT') requiredType = 'PORT_PORT';
            else if (soMethod === 'DOOR_TO_PORT') requiredType = 'DOOR_PORT';
            else if (soMethod === 'DOOR_TO_DOOR') requiredType = 'DOOR_DOOR';
            else if (soMethod === 'PORT_TO_DOOR') requiredType = 'PORT_TO_DOOR';

            if (requiredType && q.freightType !== requiredType) return false;

            if (!orderPod) return true;

            const qDestName = (q.destinationPort || '').toLowerCase().trim();
            const qDestCode = (q.destinationPortCode || '').toLowerCase().trim();

            const nameMatch = qDestName && (orderPod.includes(qDestName) || qDestName.includes(orderPod));
            const codeMatch = qDestCode && (orderPod.includes(qDestCode) || qDestCode.includes(orderPod));

            return nameMatch || codeMatch;
        });
    };

    const matchingQuotes = useMemo(() => getMatchingQuotes(), [selectedOrderForLink, freightQuotes]);


    const getPortCode = (portString?: string): string => {
        if (!portString) return '';
        const s = portString.trim();

        // Case 1: "Port Name (CODE)"
        const match = s.match(/\(([^)]+)\)$/);
        if (match) {
            return match[1];
        }

        // Case 2: It's a name, find the code
        const portMatch = ports.find(p => p.name.toLowerCase() === s.toLowerCase());
        if (portMatch) {
            return portMatch.code;
        }

        // Case 3: It's already a code
        const isCode = ports.some(p => p.code.toUpperCase() === s.toUpperCase());
        if (isCode) {
            return s.toUpperCase();
        }

        // Fallback
        return s;
    };

    const openDocument = (docUrl?: string) => {
        if (!docUrl) {
            alert("No document available for this booking.");
            return;
        }
        try {
            const windowFeatures = 'width=800,height=900,resizable,scrollbars=yes,status=1';
            if (docUrl.startsWith('data:') || docUrl.length > 500) {
                const win = window.open("", "DocumentPreview", windowFeatures);
                if (win) {
                    win.document.write('<html><head><title>Document Preview</title><style>body,html{margin:0;padding:0;height:100%;overflow:hidden;}</style></head><body>');
                    win.document.write(`<iframe src="${docUrl}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`);
                    win.document.write('</body></html>');
                    win.document.close();
                }
            } else {
                window.open(docUrl, "DocumentPreview", windowFeatures);
            }
        } catch (e) { console.error("Error opening document", e); }
    };

    useEffect(() => {
        fetchOrders();
    }, [currentCompanyId]);

    // Set initial modal view when it opens
    useEffect(() => {
        if (showBookingRequestModal && selectedOrderForLink) {
            const matching = matchingQuotes;
            const orderPodCode = getPortCode(selectedOrderForLink.pod).toLowerCase();
            const availableBookings = bookings.filter(b =>
                (b.status as any) === 'AVAILABLE' &&
                (!orderPodCode || getPortCode(b.pod).toLowerCase() === orderPodCode)
            );
            if (matching.length > 0 || availableBookings.length > 0) {
                setBookingModalView('list');
            } else {
                setBookingModalView('form');
            }
        }
    }, [showBookingRequestModal, selectedOrderForLink, bookings, matchingQuotes]);

    const fetchOrders = async () => {
        if (!client) return;
        const { data } = await client.from('sales_orders')
            .select('*')
            .eq(currentCompanyId === 'ALL' ? '' : 'companyId', currentCompanyId === 'ALL' ? '' : currentCompanyId)
            .order('createdAt', { ascending: false });

        if (data) {
            const filtered = currentCompanyId === 'ALL' ? data : data.filter(o => o.companyId === currentCompanyId);
            setOrders(filtered);
        }
    };

    // --- FORM HANDLERS ---

    const handleNewOrder = () => {
        setFormData({
            orderNumber: `SO-${Date.now().toString().slice(-6)}`,
            orderDate: new Date().toISOString().split('T')[0],
            status: 'PENDING',
            orderType: 'SPOT',
            currency: 'USD',
            items: [],
            saleType: 'LOCAL',
            deliveryMethod: 'PICKUP', // Default
            incoterm: 'EXW', // Default
            deliveryDate: 'Prompt', // Default
            poa: '',
            pickupLocation: '',
            companyId: currentCompanyId === 'ALL' ? '' : currentCompanyId
        });
        setEditingId(null);
        setViewMode('FORM');
    };

    const handleEditOrder = (order: SalesOrder) => {
        setFormData(order);
        setEditingId(order.id);
        setViewMode('FORM');
    };

    const handleDuplicateOrder = (order: SalesOrder) => {
        const { id: _id, createdAt: _createdAt, approvedBy: _approvedBy, ...rest } = order;
        setFormData({
            ...rest,
            orderNumber: `SO-${Date.now().toString().slice(-6)}`,
            orderDate: new Date().toISOString().split('T')[0],
            status: 'PENDING',
            items: (order.items ?? []).map(it => ({ ...it })),
        });
        setEditingId(null);
        setViewMode('FORM');
    };

    const handleDeleteOrder = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm("Are you sure you want to delete this Sales Order? This action cannot be undone.")) return;
        onDelete(id);
    };

    const handleCustomerSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const custId = e.target.value;
        const cust = customers.find(c => c.id === custId);

        if (cust) {
            let addr = '';
            if (cust.location) addr += cust.location;
            if (cust.city) addr += (addr ? ', ' : '') + cust.city;
            if (cust.state) addr += (addr ? ', ' : '') + cust.state;
            if (cust.zip) addr += ' ' + cust.zip;

            // Determine Scope based on Country (Default to Local if USA or undefined)
            const country = (cust.country || '').trim().toLowerCase();
            const isUS = ['usa', 'us', 'united states', 'united states of america'].includes(country);
            // If country is present and NOT US, then Export. 
            const saleType = (country && !isUS) ? 'EXPORT' : 'LOCAL';

            // Set default delivery method for the scope
            const deliveryMethod = saleType === 'EXPORT' ? 'PORT_TO_PORT' : 'PICKUP';
            const incoterm = saleType === 'EXPORT' ? 'FOB' : 'EXW';

            setFormData(prev => ({
                ...prev,
                customerId: custId,
                customerName: cust.name,
                paymentTerms: cust.paymentTerms,
                deliveryAddress: addr, // Default to customer address
                pod: cust.pod || '', // Default POD
                saleType: saleType,
                deliveryMethod: deliveryMethod,
                incoterm: incoterm,
                poa: cust.poa || '', // Hypothetical future field on Customer
                pickupLocation: cust.pickupLocation || '' // Hypothetical
            }));
        } else {
            setFormData(prev => ({
                ...prev,
                customerId: custId,
                customerName: '',
                paymentTerms: '',
                deliveryAddress: '',
                pod: ''
            }));
        }
    };

    const handleQuickAddPort = async () => {
        if (!newPortCode || !newPortName) return;

        const companyIdForNewRecord = 'ALL';

        const newPort: Port = {
            id: `PRT${Date.now()}`,
            companyId: companyIdForNewRecord,
            code: newPortCode.toUpperCase(),
            name: newPortName,
            country: newPortCountry
        };

        if (onAddPort) await onAddPort(newPort);

        const portDisplay = `${newPort.name} (${newPort.code})`;

        if (targetPortField === 'MAIN_POD') {
            setFormData(prev => ({ ...prev, pod: portDisplay }));
        } else if (targetPortField === 'QUOTE_POA') {
            setNewQuotePOA(portDisplay);
        } else if (targetPortField === 'QUOTE_POD') {
            setNewQuotePOD(portDisplay);
        } else if (targetPortField === 'MAIN_POA') {
            setFormData(prev => ({ ...prev, poa: portDisplay }));
        }


        setNewPortCode('');
        setNewPortName('');
        setNewPortCountry('');
        setShowQuickAddPort(false);
        setPortAddedMessage('Port added!');
        setTimeout(() => setPortAddedMessage(''), 3000);
    };

    const handleQuickAddLocation = async () => {
        if (!newLocName) return;
        const companyIdForNewRecord = selectedOrderForLink?.companyId || 'ALL';

        const newLocation: SavedLocation = {
            id: `LOC${Date.now()}`,
            companyId: companyIdForNewRecord,
            code: `LOC-${Math.floor(Math.random() * 1000)}`,
            name: newLocName,
            address: newLocAddress,
            city: newLocCity,
            state: newLocState,
            zip: newLocZip,
            country: 'USA', // Default
            entityType: 'WAREHOUSE', // Default
            entityId: '',
            entityName: ''
        };

        await onAddLocation(newLocation);

        const addressString = `${newLocation.address ? newLocation.address + ', ' : ''}${newLocation.city}, ${newLocation.state}`;

        if (targetOriginField === 'PICKUP') {
            setFormData(prev => ({ ...prev, pickupLocation: addressString }));
        } else {
            setNewQuotePickups(prev => [...prev, addressString]);
        }


        setShowQuickAddLocation(false);
        setNewLocName(''); setNewLocAddress(''); setNewLocCity(''); setNewLocState(''); setNewLocZip('');
        setLocationAddedMessage('Location saved & applied!');
        setTimeout(() => setLocationAddedMessage(''), 3000);
    };

    const handleAddItem = () => {
        if (!currentItem.productId || !currentItem.quantity) return;
        const total = (currentItem.quantity || 0) * (currentItem.unitPrice || 0);
        const newItem = { ...currentItem, total } as SalesOrderItem;

        setFormData(prev => ({
            ...prev,
            items: [...(prev.items || []), newItem],
            totalAmount: (prev.totalAmount || 0) + total
        }));

        setCurrentItem({ quantity: 0, unitPrice: 0, total: 0, customerDescription: '', hsCode: '' });
        setAiSuggestion('');
    };

    const handleRemoveItem = (idx: number) => {
        setFormData(prev => {
            const newItems = [...(prev.items || [])];
            const removed = newItems.splice(idx, 1)[0];
            return {
                ...prev,
                items: newItems,
                totalAmount: (prev.totalAmount || 0) - removed.total
            };
        });
    };

    const handleProductSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const prodId = e.target.value;
        const prod = products.find(p => p.id === prodId);
        if (prod) {
            setCurrentItem(prev => ({
                ...prev,
                productId: prod.id,
                productName: prod.name,
                hsCode: prod.hsCode || '',
                customerDescription: prod.name // Default
            }));
        }
    };

    const handleAiDescription = async () => {
        if (!currentItem.productName || !formData.customerName) return;

        setIsAiGenerating(true);
        // Find product specs for context
        const prod = products.find(p => p.id === currentItem.productId);
        const specs = prod ? JSON.stringify(prod.specs) : '';

        const result = await generateCustomerDescription(currentItem.productName, formData.customerName, specs);
        if (result) {
            setCurrentItem(prev => ({
                ...prev,
                customerDescription: result.description,
                hsCode: result.hsCode || prev.hsCode
            }));
            setAiSuggestion("AI Generated Description applied!");
            setTimeout(() => setAiSuggestion(''), 3000);
        }
        setIsAiGenerating(false);
    };

    const handleSaveOrder = async () => {
        if (!formData.customerId || !formData.items?.length) {
            alert("Customer and Items are required.");
            return;
        }

        const orderData: SalesOrder = {
            id: editingId || `SO${Date.now()}`,
            companyId: formData.companyId || currentCompanyId,
            customerId: formData.customerId!,
            customerName: formData.customerName!,
            orderNumber: formData.orderNumber!,
            orderDate: formData.orderDate!,
            orderType: formData.orderType as 'SPOT' | 'CONTRACT',
            // Use status from form (user can now edit it directly)
            status: (formData.status || 'PENDING') as any,
            items: formData.items!,
            totalAmount: formData.totalAmount || 0,
            currency: formData.currency || 'USD',
            paymentTerms: formData.paymentTerms || '',
            incoterm: formData.incoterm || '',
            notes: formData.notes || '',
            createdBy: editingId ? formData.createdBy : currentUser.id,
            createdAt: formData.createdAt || new Date().toISOString(),
            saleType: formData.saleType as 'LOCAL' | 'EXPORT',
            deliveryMethod: formData.deliveryMethod,
            deliveryAddress: formData.deliveryAddress,
            deliveryDate: formData.deliveryDate,
            pod: formData.pod,
            poa: formData.poa,
            pickupLocation: formData.pickupLocation,
            bankId: formData.bankId
        };

        if (editingId) {
            onUpdate(orderData);
        } else {
            onAdd(orderData);
            // Fire workflow event for new SO
            onSalesOrderCreated(orderData.id, orderData as any);
        }
        setViewMode('LIST');
    };

    const handleStatusChange = async (order: SalesOrder, newStatus: 'APPROVED' | 'REJECTED') => {
        onUpdate({
            ...order,
            status: newStatus,
            approvedBy: currentUser.id
        });

        // Fire workflow event for approval
        if (newStatus === 'APPROVED') {
            onSalesOrderApproved(order.id, { ...order, status: newStatus } as any);
            const updatedOrder = { ...order, status: newStatus, approvedBy: currentUser.id };
            setTimeout(() => generateSalesDoc(updatedOrder, 'PROFORMA', false), 300);
        }
    };

    // --- DOCUMENT GENERATION (INVOICE ENGINE LOGIC) ---
    const generateSalesDoc = (order: SalesOrder, type: 'PROFORMA' | 'CONTRACT' | 'CONFIRMATION', autoDownload = true) => {
        const doc = new jsPDF();

        if (type === 'PROFORMA') {
            // Updated Proforma Invoice Layout matching "EC4 Enterprises" visual style
            const orangeColor = '#F57F25';
            const darkGray = '#333333';
            const lightGray = '#888888';

            // --- Header ---
            const companyLogo = companyImages.find(img => img.companyId === order.companyId && img.type === 'LOGO');

            // Logo Top Left
            if (companyLogo && companyLogo.url) {
                try {
                    const imgProps = doc.getImageProperties(companyLogo.url);
                    const maxWidth = 75;
                    const maxHeight = 37.5;
                    let width = imgProps.width;
                    let height = imgProps.height;
                    const ratio = Math.min(maxWidth / width, maxHeight / height);
                    width *= ratio;
                    height *= ratio;
                    doc.addImage(companyLogo.url, 14, 10, width, height);
                } catch (e) {
                    doc.setFontSize(24);
                    doc.setTextColor('#CE1126');
                    doc.setFont(undefined, 'bold');
                    doc.text("EC4 ENTERPRISES", 14, 25);
                }
            } else {
                doc.setFontSize(24);
                doc.setTextColor('#CE1126');
                doc.setFont(undefined, 'bold');
                doc.text("EC4 ENTERPRISES", 14, 25);
            }

            // Company Info (Top Right)
            doc.setFontSize(9);
            doc.setTextColor(darkGray);
            doc.setFont(undefined, 'bold');

            const companyRec = companies.find(c => c.id === order.companyId);
            const companyName = companyRec?.name || "EC4 ENTERPRISES";
            const addressLine1 = companyRec?.address || "112 Bartran Oaks Walk #600010";
            const addressLine2 = (companyRec?.city && companyRec?.state) ? `${companyRec.city}, ${companyRec.state} ${companyRec.zip || ''}` : "St Johns, FL";
            const phone = "(904) 439-9343";
            const email = "felipe@ec4.enterprises";

            let yPos = 15;
            const rightX = 130;

            doc.text(companyName, rightX, yPos);
            doc.setFont(undefined, 'normal');
            yPos += 5;
            doc.text(addressLine1, rightX, yPos);
            yPos += 5;
            doc.text(addressLine2, rightX, yPos);
            yPos += 5;
            doc.text(phone, rightX, yPos);
            yPos += 5;
            doc.text(email, rightX, yPos);

            // --- Title ---
            yPos = 55;
            doc.setFontSize(16);
            doc.setTextColor(orangeColor);
            doc.setFont(undefined, 'bold');
            doc.text("PROFORMA INVOICE", 14, yPos);

            // --- Consignee & Order Details ---
            yPos += 10;
            const startSectionY = yPos;

            // Left: CONSIGNEE
            doc.setFontSize(8);
            doc.setTextColor(lightGray);
            doc.text("CONSIGNEE", 14, yPos);

            yPos += 5;
            doc.setFontSize(9);
            doc.setTextColor(darkGray);
            doc.setFont(undefined, 'bold');
            doc.text(order.customerName, 14, yPos);

            yPos += 5;
            doc.setFont(undefined, 'normal');

            const customerRec = customers.find(c => c.id === order.customerId);
            let fullAddress = order.deliveryAddress || '';
            if (!fullAddress && customerRec) {
                fullAddress = [customerRec.location, customerRec.city, customerRec.state, customerRec.zip, customerRec.country].filter(Boolean).join(', ');
            }
            if (customerRec?.taxId) {
                fullAddress += `\nTAX ID : ${customerRec.taxId}`;
            }

            const addressLines = doc.splitTextToSize(fullAddress, 100);
            doc.text(addressLines, 14, yPos);

            // Right: No & DATE
            yPos = startSectionY;
            doc.setFontSize(8);
            doc.setTextColor(lightGray);
            doc.text("No :", rightX, yPos);
            doc.setFontSize(9);
            doc.setTextColor(darkGray);
            doc.text(order.orderNumber, rightX + 15, yPos);

            yPos += 10;
            doc.setFontSize(8);
            doc.setTextColor(lightGray);
            doc.text("DATE", rightX, yPos);
            doc.setFontSize(9);
            doc.setTextColor(darkGray);
            doc.text(new Date(order.orderDate).toLocaleDateString(), rightX + 15, yPos);

            // Check for Linked Booking
            const linkedBooking = bookings.find(b => b.salesOrderId === order.id);
            if (linkedBooking) {
                yPos += 10;
                doc.setFontSize(8);
                doc.setTextColor(lightGray);
                doc.text("BOOKING", rightX, yPos);
                doc.setFontSize(9);
                doc.setTextColor(darkGray);
                doc.text(linkedBooking.bookingNumber, rightX + 15, yPos);
            }

            // --- Terms & Incoterm ---
            // Re-calc section bottom
            let sectionBottomY = startSectionY + 5 + (addressLines.length * 5) + 5;
            if (sectionBottomY < yPos + 10) sectionBottomY = yPos + 10;

            yPos = sectionBottomY;

            // TERMS
            doc.setFontSize(8);
            doc.setTextColor(lightGray);
            doc.text("TERMS", 14, yPos);

            doc.setFontSize(9);
            doc.setTextColor(darkGray);
            doc.text(order.paymentTerms || "Prepaid", 14, yPos + 5);

            // INCOTERM (Middle-ish)
            const incotermX = 90;
            doc.setFontSize(8);
            doc.setTextColor(lightGray);
            doc.text("INCOTERM", incotermX, yPos);

            doc.setFontSize(9);
            doc.setTextColor(darkGray);
            const incotermText = `${order.incoterm || ''} ${order.pod || ''}`.trim();
            doc.text(incotermText, incotermX, yPos + 5);

            // --- Table ---
            yPos += 15;

            const tableHead = [['ACTIVITY', 'QTY LBS\nKGS', 'RATE US$/LBS\nUS$ / KG', 'AMOUNT US$']];
            const tableBody = order.items.map(item => [
                item.customerDescription || item.productName,
                `${item.quantity.toLocaleString()}\n${(item.quantity * 0.453592).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                `${item.unitPrice.toFixed(4)}\n${(item.unitPrice * 2.20462).toFixed(4)}`,
                item.total.toLocaleString(undefined, { minimumFractionDigits: 2 })
            ]);

            autoTable(doc, {
                startY: yPos,
                head: tableHead,
                body: tableBody,
                theme: 'plain',
                styles: {
                    fontSize: 9,
                    textColor: darkGray,
                    cellPadding: 3,
                    valign: 'top'
                },
                headStyles: {
                    fillColor: '#FFE0B2', // Light orange/peach
                    textColor: orangeColor,
                    fontStyle: 'bold',
                    halign: 'left'
                },
                columnStyles: {
                    0: { cellWidth: 'auto' },
                    1: { halign: 'right', cellWidth: 35 },
                    2: { halign: 'right', cellWidth: 35 },
                    3: { halign: 'right', cellWidth: 35 }
                },
            });

            // --- Footer / Totals ---
            let finalY = (doc as any).lastAutoTable.finalY + 5;

            // Left side notes
            doc.setFontSize(8);
            doc.setTextColor(lightGray);
            doc.text("Qty in LBS (or Kgs)", 14, finalY + 4);
            doc.text("Rate in US$", 14, finalY + 8);

            doc.setFontSize(9);
            doc.setTextColor(darkGray);
            doc.setFont(undefined, 'bold');
            const shipDate = order.deliveryDate || "Prompt";
            doc.text(`SHIPPING DATE : ${shipDate}`, 14, finalY + 16);

            // Right side totals
            const labelX = 140;
            const valueX = 195;
            let totalY = finalY + 4;

            doc.setFont(undefined, 'normal');
            doc.setTextColor(lightGray);
            doc.text("SUBTOTAL", labelX, totalY);
            doc.setTextColor(darkGray);
            doc.text(order.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 }), valueX, totalY, { align: 'right' });

            totalY += 6;
            doc.setTextColor(lightGray);
            doc.text("TAX", labelX, totalY);
            doc.setTextColor(darkGray);
            doc.text("0.00", valueX, totalY, { align: 'right' });

            totalY += 8;
            doc.setFont(undefined, 'bold');
            doc.setTextColor(darkGray); // Black for Total
            doc.text("TOTAL", labelX, totalY);
            doc.text(`$${order.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, valueX, totalY, { align: 'right' });

            // --- Signatures ---
            let sigY = finalY + 30;
            if (sigY > 250) {
                doc.addPage();
                sigY = 20;
            }

            doc.setFontSize(9);
            doc.setTextColor(lightGray);
            doc.setFont(undefined, 'bold');
            doc.text("Accepted By", 14, sigY);

            doc.setDrawColor(200);
            doc.line(14, sigY + 12, 90, sigY + 12);

            doc.text("Accepted Date", 14, sigY + 20);
            doc.line(14, sigY + 32, 60, sigY + 32);

            // --- Bank Info ---
            const bankY = sigY + 45;
            if (bankY > 260) {
                doc.addPage();
            }

            doc.setFontSize(8);
            doc.setTextColor(lightGray);
            doc.text("PAY TO :", 14, bankY);

            doc.setFontSize(9);
            doc.setTextColor(darkGray);
            doc.setFont(undefined, 'bold');
            const bankLineSpacing = 5;
            let currentBankY = bankY + 5;

            // Look up the bank from the order's bankId
            const selectedBank = order.bankId ? banks.find(b => b.id === order.bankId) : null;

            if (selectedBank) {
                // Company name from current company
                doc.text(companyName, 14, currentBankY); currentBankY += bankLineSpacing;
                doc.text(selectedBank.name || '', 14, currentBankY); currentBankY += bankLineSpacing;
                if (selectedBank.swift_code) {
                    doc.text(`SWIFT : ${selectedBank.swift_code}`, 14, currentBankY); currentBankY += bankLineSpacing;
                }
                if (selectedBank.routing) {
                    doc.text(`ROUTING : ${selectedBank.routing}`, 14, currentBankY); currentBankY += bankLineSpacing;
                }
                if (selectedBank.wire) {
                    doc.text(`WIRE TRANSFER : ${selectedBank.wire}`, 14, currentBankY); currentBankY += bankLineSpacing;
                }
                if (selectedBank.account_number) {
                    doc.text(`ACCOUNT # : ${selectedBank.account_number}`, 14, currentBankY);
                }
            } else {
                doc.setFont(undefined, 'italic');
                doc.text("No bank account configured for this order.", 14, currentBankY);
            }

            // --- Footer ---
            const pageHeight = doc.internal.pageSize.height;
            doc.setFontSize(7);
            doc.setTextColor(lightGray);
            doc.setFont(undefined, 'normal');
            doc.text("1. QUANTITY CAN INCREASE OR DECREASE IN +/- 5%", 14, pageHeight - 10);
            doc.text("Page 1 of 1", 180, pageHeight - 10);

            if (autoDownload) {
                doc.save(`PROFORMA_${order.orderNumber}.pdf`);
            } else {
                // Show in modal
                const blob = doc.output('blob');
                const url = URL.createObjectURL(blob);
                setPdfUrl(url);
                setPdfBlob(blob);
                setPdfTitle(`Proforma - ${order.orderNumber}`);
                setPdfFileName(`Proforma_${order.orderNumber}.pdf`);
                // Use blob download approach instead of doc.save()
                setPdfDownloadFn(() => () => {
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = URL.createObjectURL(blob);
                    a.download = `Proforma_${order.orderNumber}.pdf`;
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => {
                        document.body.removeChild(a);
                        URL.revokeObjectURL(a.href);
                    }, 150);
                });
                setShowPdfModal(true);
            }
            return doc;
        }

        // --- Header ---
        let title = '';
        if (type === 'CONTRACT') title = 'SALES CONTRACT';
        else title = 'ORDER CONFIRMATION';

        doc.text(title, 14, 20);

        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`Order #: ${order.orderNumber}`, 14, 30);
        doc.text(`Date: ${order.orderDate}`, 14, 35);

        // --- Parties ---
        doc.setFontSize(12);
        doc.setTextColor(0);
        doc.text("Bill To:", 14, 55);
        doc.setFontSize(10);
        doc.text(order.customerName, 14, 62);

        if (order.deliveryAddress) {
            const splitAddress = doc.splitTextToSize(order.deliveryAddress, 80);
            doc.text(splitAddress, 14, 67);
        }

        // Seller/Shipper (Right Side) 
        doc.setFontSize(12);
        doc.text("Seller:", 120, 55);
        doc.setFontSize(10);
        // Using "US Export Company" placeholder if company name not available in context to match InvoiceEngine visual balance
        doc.text("US Export Company", 120, 62);

        // --- Table ---
        autoTable(doc, {
            startY: 90,
            head: [['Description', 'HS Code', 'Qty', 'Unit Price', 'Amount']],
            body: order.items.map(item => [
                item.customerDescription,
                item.hsCode,
                `${item.quantity.toLocaleString()} LBS`,
                `$${item.unitPrice.toFixed(4)}`,
                `$${item.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            ]),
            theme: 'striped',
            headStyles: { fillColor: [41, 128, 185] },
        });

        // --- Totals & Footer ---
        let finalY = (doc as any).lastAutoTable.finalY + 10;

        // Check page break
        if (finalY > 220) {
            doc.addPage();
            finalY = 20;
        }

        const startY = finalY;

        // Left Column (Terms & Logistics)
        doc.setFontSize(9);
        doc.setTextColor(0);

        doc.setFont(undefined, 'bold');
        doc.text("Payment Terms:", 14, finalY);
        doc.setFont(undefined, 'normal');
        doc.text(order.paymentTerms || '-', 45, finalY);

        doc.setFont(undefined, 'bold');
        doc.text("Delivery / Incoterm:", 14, finalY + 5);
        doc.setFont(undefined, 'normal');
        doc.text(`${order.deliveryMethod || ''} ${order.incoterm || ''}`.trim() || '-', 45, finalY + 5);

        doc.setFont(undefined, 'bold');
        doc.text("Delivery Date:", 14, finalY + 10);
        doc.setFont(undefined, 'normal');
        doc.text(order.deliveryDate || '-', 45, finalY + 10);

        if (order.pod) {
            doc.setFont(undefined, 'bold');
            doc.text("Port of Dest:", 14, finalY + 15);
            doc.setFont(undefined, 'normal');
            doc.text(order.pod, 45, finalY + 15);
        }

        // Right Column (Financials)
        const labelX = 140;
        const valueX = 195;

        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text("TOTAL", labelX, startY);
        doc.text(`${order.currency} ${order.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, valueX, startY, { align: 'right' });

        // Signature Line if Contract
        if (type === 'CONTRACT') {
            const sigY = startY + 40;
            doc.line(14, sigY, 80, sigY); // Line
            doc.text("Buyer Signature", 14, sigY + 5);

            doc.line(120, sigY, 186, sigY);
            doc.text("Seller Signature", 120, sigY + 5);
        }

        if (autoDownload) {
            doc.save(`${type}_${order.orderNumber}.pdf`);
        } else {
            // Show in modal
            const blob = doc.output('blob');
            const url = URL.createObjectURL(blob);
            setPdfUrl(url);
            setPdfBlob(blob);
            setPdfTitle(`${type} - ${order.orderNumber}`);
            setPdfFileName(`${type}_${order.orderNumber}.pdf`);
            // Use blob download approach instead of doc.save()
            setPdfDownloadFn(() => () => {
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = URL.createObjectURL(blob);
                a.download = `${type}_${order.orderNumber}.pdf`;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(a.href);
                }, 150);
            });
            setShowPdfModal(true);
        }
        return doc;
    };

    // --- EMAIL TOOL ---
    const handleEmailOrder = (order: SalesOrder) => {
        const customer = customers.find(c => c.id === order.customerId);
        if (!customer || !customer.email) {
            alert("Customer email address not found in database.");
            return;
        }

        const subject = `Order Confirmation #${order.orderNumber} - ${order.customerName}`;
        const itemsList = order.items.map(i => `- ${i.productName}: ${i.quantity.toLocaleString()} lbs`).join('%0D%0A');

        const body = `Dear ${customer.contactPerson || 'Customer'},%0D%0A%0D%0A` +
            `Thank you for your order. Please find the details below:%0D%0A%0D%0A` +
            `Order Number: ${order.orderNumber}%0D%0A` +
            `Order Date: ${order.orderDate}%0D%0A` +
            `Total Amount: ${order.currency} ${order.totalAmount.toLocaleString()}%0D%0A%0D%0A` +
            `Items:%0D%0A${itemsList}%0D%0A%0D%0A` +
            `We will proceed with the shipment as agreed. Attached you will find the formal confirmation.%0D%0A%0D%0A` +
            `Best regards,%0D%0A` +
            `Sales Team`;

        const ccList = [customer.email2, (customer as any).email3].filter(Boolean).join(',');
        const ccParam = ccList ? `&cc=${encodeURIComponent(ccList)}` : '';
        window.location.href = `mailto:${customer.email}?subject=${subject}${ccParam}&body=${body}`;
    };

    // --- REQUEST BOOKING (New or From Quote) ---
    const handleProcessBookingRequests = async () => {
        if (!selectedOrderForLink || !client || !onAddBooking) return;

        if (selectedQuoteIds.length === 0) {
            alert("Please select at least one quote to book.");
            return;
        }

        let count = 0;

        for (const qId of selectedQuoteIds) {
            const quote = freightQuotes.find(fq => fq.id === qId);
            if (!quote) continue;

            const quantity = quoteQuantities[qId];
            if (!quantity || quantity <= 0) continue;

            const newBookingId = `BK${Date.now()}_${Math.floor(Math.random() * 10000)}`;
            const newBooking: Booking = {
                id: newBookingId,
                companyId: selectedOrderForLink.companyId,
                createdAt: new Date().toISOString(),
                bookingNumber: `REQ-${newBookingId.slice(-6)}`,
                customer: selectedOrderForLink.customerName,
                vesselVoyage: 'TBD',
                pol: quote.originPort || selectedOrderForLink.deliveryAddress || 'TBD',
                pod: quote.destinationPort || selectedOrderForLink.pod || 'TBD',
                equipment: `${quantity} x 40HC`,
                etd: new Date().toISOString().split('T')[0],
                eta: 'TBD',
                salesOrderId: selectedOrderForLink.id,
                status: 'REQUESTED'
            };

            await onAddBooking(newBooking);
            count++;
        }

        setShowBookingRequestModal(false);
        setQuoteQuantities({});
        setSelectedQuoteIds([]);
        alert(`${count} Booking(s) created! The cargo agent has been notified to confirm.`);
    };

    const handleRequestFreightQuote = async () => {
        if (!selectedOrderForLink || !client || !cargoAgents || cargoAgents.length === 0) {
            alert("No cargo agents found in the database to send requests to.");
            return;
        }

        // --- CHECK EMAIL CONNECTION (MSAL Interactive) ---
        let token = '';
        try {
            token = await getTokenFor('automation', loginRequest.scopes);
        } catch (e) {
            alert("No email account connected. Please sign in via Settings → Email Integration.");
            return;
        }

        if (!token) {
            alert("No email account connected. Please sign in via Settings → Email Integration.");
            return;
        }

        const { orderNumber: soNumber, companyId: soCompanyId } = selectedOrderForLink;

        const podMatch = newQuotePOD?.match(/(.*) \((.*)\)/);
        const podName = podMatch ? podMatch[1] : newQuotePOD;
        const podCode = podMatch ? podMatch[2] : '';

        const poaMatch = newQuotePOA?.match(/(.*) \((.*)\)/);
        const poaName = poaMatch ? poaMatch[1] : newQuotePOA;
        const poaCode = poaMatch ? poaMatch[2] : '';

        let locs = [...newQuotePickups];
        if (locs.length === 0 && currentPickupSelection) {
            locs.push(currentPickupSelection);
        }

        const comments = `Quote request for Sales Order #${soNumber}`;
        const pickupLocations = locs.join('; ');

        const quoteRequests: FreightQuote[] = [];
        let sentCount = 0;

        for (const agent of cargoAgents) {
            const newQuoteRequest: FreightQuote = {
                id: `FQ_REQ_${Date.now()}_${agent.id}`,
                companyId: soCompanyId,
                agentName: agent.name,
                carrier: 'TBD',
                freightType: 'PORT_PORT',
                originPort: poaName,
                originPortCode: poaCode,
                pickupLocation: pickupLocations,
                pickupZip: '',
                destinationPort: podName,
                destinationPortCode: podCode,
                deliveryLocation: '',
                deliveryZip: '',
                rate: 0,
                currency: 'USD',
                validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                comments: comments,
                status: 'PENDING',
                containerCount: 1
            };

            quoteRequests.push(newQuoteRequest);

            if (agent.email) {
                const subject = `Freight Quote Request for SO #${soNumber}`;
                const htmlBody = `
                    <div style="font-family: sans-serif;">
                        <p>Dear ${agent.contact || agent.name},</p>
                        <p>Please provide a freight quote for the following shipment:</p>
                        <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 15px 0;">
                            <p style="margin: 5px 0;"><strong>Sales Order Ref:</strong> ${soNumber}</p>
                            <p style="margin: 5px 0;"><strong>Pick Up:</strong> ${pickupLocations || 'N/A'}</p>
                            <p style="margin: 5px 0;"><strong>Port of Loading (POA):</strong> ${poaName} (${poaCode})</p>
                            <p style="margin: 5px 0;"><strong>Port of Discharge (POD):</strong> ${podName} (${podCode})</p>
                        </div>
                        <p>Please submit your best rate and transit time at your earliest convenience.</p>
                        <p>Thank you,<br/>XSolution AI Agent</p>
                    </div>
                `;

                try {
                    await fetch(`https://graph.microsoft.com/v1.0/me/sendMail`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            message: {
                                subject: subject,
                                body: {
                                    contentType: "HTML",
                                    content: htmlBody
                                },
                                toRecipients: [{ emailAddress: { address: agent.email } }]
                            },
                            saveToSentItems: true
                        })
                    });
                    sentCount++;
                } catch (e) {
                    console.error(`Failed to email ${agent.name}`, e);
                }
            }
        }

        const addQuotePromises = quoteRequests.map(quote => onAddFreightQuote(quote));
        await Promise.all(addQuotePromises);

        setShowBookingRequestModal(false);
        setNewQuotePickups([]);
        setCurrentPickupSelection('');

        alert(`Freight Quote Requests created for ${cargoAgents.length} agents.\nSuccessfully sent ${sentCount} emails via ai.agent@xsolution.com.`);
    };

    const handleLinkBooking = async (bookingId: string) => {
        if (!selectedOrderForLink || !onUpdateBooking) return;

        const bookingToLink = bookings.find(b => b.id === bookingId);
        if (!window.confirm(`Link booking ${bookingToLink?.bookingNumber} to order ${selectedOrderForLink.orderNumber}? This cannot be undone easily.`)) {
            return;
        }

        if (bookingToLink) {
            const updatedBooking = {
                ...bookingToLink,
                salesOrderId: selectedOrderForLink.id,
                status: 'ACTIVE',
                customer: selectedOrderForLink.customerName
            } as Booking;

            onUpdateBooking(updatedBooking);

            alert('Booking linked successfully! The list will update on your next page refresh.');
            setShowBookingRequestModal(false);
        }
    };

    const handlePushToInvoice = async (order: SalesOrder) => {
        if (!client) return;

        const invoiceData: Invoice = {
            id: `INV${Date.now()}`,
            companyId: order.companyId,
            createdAt: new Date().toISOString(),
            invoiceNumber: `INV-${order.orderNumber}`,
            invoiceDate: new Date().toISOString().split('T')[0],
            soldTo: order.customerName,
            shipperName: 'Your Company',
            totalAmount: order.totalAmount,
            currency: order.currency,
            paymentTerms: order.paymentTerms,
            items: JSON.stringify(order.items.map(i => ({
                description: i.customerDescription,
                quantity: i.quantity,
                unit_price: i.unitPrice,
                amount: i.total
            }))),
            shipperAddress: '',
            shipTo: order.deliveryAddress || '',
            incoterm: order.incoterm,
            dateOrder: order.orderDate,
            customerPo: '',
            carrier: '',
            transportRef: order.orderNumber,
            freightTerms: '',
            grossWeight: '',
            netWeight: '',
            tareWeight: '',
            totalQuantity: '',
            subtotal: order.totalAmount,
            remitTo: '',
            bankName: '',
            swiftCode: '',
            routingNumber: '',
            accountNumber: '',
            originalDocument: '',
            supplier: '',
            date: ''
        };

        const { error } = await client.from('invoices').insert(invoiceData);
        if (error) alert("Error creating invoice: " + error.message);
        else alert("Invoice Draft Created in Finance Module!");
    };

    if (viewMode === 'FORM') {
        return (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                <div className="flex justify-between items-center border-b border-slate-200 pb-4">
                    <h2 className="text-2xl font-bold text-slate-800">{editingId ? 'Edit Sales Order' : 'New Sales Order'}</h2>
                    <button onClick={() => setViewMode('LIST')} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition-colors"><X size={24} /></button>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Customer</label>
                            <select
                                className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                                value={formData.customerId || ''}
                                onChange={handleCustomerSelect}
                            >
                                <option value="">Select Customer...</option>
                                {[...scopedCustomers].sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Order Type</label>
                            <div className="flex bg-slate-100 rounded-lg p-1 border border-slate-200">
                                <button onClick={() => setFormData({ ...formData, orderType: 'SPOT' })} className={`flex-1 py-1.5 text-xs font-bold rounded ${formData.orderType === 'SPOT' ? 'bg-white shadow text-blue-600' : 'text-slate-500'}`}>Spot</button>
                                <button onClick={() => setFormData({ ...formData, orderType: 'CONTRACT' })} className={`flex-1 py-1.5 text-xs font-bold rounded ${formData.orderType === 'CONTRACT' ? 'bg-white shadow text-purple-600' : 'text-slate-500'}`}>Contract</button>
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Date</label>
                            <input type="date" className="w-full border border-slate-300 rounded-lg p-2 text-sm" value={formData.orderDate} onChange={(e) => setFormData({ ...formData, orderDate: e.target.value })} />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Status</label>
                            <select
                                className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                                value={formData.status || 'PENDING'}
                                onChange={(e) => setFormData({ ...formData, status: e.target.value as 'PENDING' | 'APPROVED' | 'REJECTED' | 'FULFILLED' })}
                            >
                                <option value="PENDING">Pending</option>
                                <option value="APPROVED">Approved</option>
                                <option value="REJECTED">Rejected</option>
                                <option value="FULFILLED">Fulfilled</option>
                            </select>
                        </div>
                    </div>

                    {/* --- SALE SCOPE & DELIVERY --- */}
                    <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 mb-6 space-y-4">
                        <div className="flex items-center gap-4 border-b border-slate-200 pb-4">
                            <h4 className="text-xs font-bold text-slate-600 uppercase flex items-center gap-2"><Globe size={14} /> Sale Scope</h4>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setFormData({ ...formData, saleType: 'LOCAL', deliveryMethod: 'PICKUP', incoterm: 'EXW' })}
                                    className={`px-4 py-1.5 rounded-full text-xs font-bold border transition-colors ${formData.saleType === 'LOCAL' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-white text-slate-500 border-slate-200'}`}
                                >
                                    Local Sale
                                </button>
                                <button
                                    onClick={() => setFormData({ ...formData, saleType: 'EXPORT', deliveryMethod: 'PORT_TO_PORT', incoterm: 'FOB' })}
                                    className={`px-4 py-1.5 rounded-full text-xs font-bold border transition-colors ${formData.saleType === 'EXPORT' ? 'bg-purple-100 text-purple-700 border-purple-200' : 'bg-white text-slate-500 border-slate-200'}`}
                                >
                                    Export Sale
                                </button>
                            </div>
                        </div>

                        {formData.saleType === 'LOCAL' ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Delivery Method</label>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setFormData({ ...formData, deliveryMethod: 'PICKUP', incoterm: 'EXW' })}
                                            className={`flex-1 py-2 text-sm font-bold rounded-lg border flex items-center justify-center gap-2 ${formData.deliveryMethod === 'PICKUP' ? 'bg-white border-blue-500 text-blue-700 shadow-sm ring-1 ring-blue-500' : 'bg-slate-100 border-slate-200 text-slate-500'}`}
                                        >
                                            <Package size={16} /> Customer Pickup
                                        </button>
                                        <button
                                            onClick={() => setFormData({ ...formData, deliveryMethod: 'DELIVERY', incoterm: 'DDP' })}
                                            className={`flex-1 py-2 text-sm font-bold rounded-lg border flex items-center justify-center gap-2 ${formData.deliveryMethod === 'DELIVERY' ? 'bg-white border-blue-500 text-blue-700 shadow-sm ring-1 ring-blue-500' : 'bg-slate-100 border-slate-200 text-slate-500'}`}
                                        >
                                            <Truck size={16} /> We Deliver
                                        </button>
                                    </div>
                                </div>
                                {formData.deliveryMethod === 'DELIVERY' && (
                                    <div className="animate-in slide-in-from-left-2">
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Delivery Address</label>
                                        <textarea
                                            className="w-full border border-slate-300 rounded-lg p-2 text-sm h-20 resize-none"
                                            placeholder="Confirm Delivery Address..."
                                            value={formData.deliveryAddress || ''}
                                            onChange={(e) => setFormData({ ...formData, deliveryAddress: e.target.value })}
                                        />
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Delivery Method</label>
                                    <select
                                        className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                                        value={formData.deliveryMethod || 'PORT_TO_PORT'}
                                        onChange={(e) => setFormData({ ...formData, deliveryMethod: e.target.value })}
                                    >
                                        <option value="PORT_TO_PORT">Port to Port</option>
                                        <option value="DOOR_TO_PORT">Door to Port</option>
                                        <option value="DOOR_TO_DOOR">Door to Door</option>
                                        <option value="PORT_TO_DOOR">Port to Door</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Incoterm</label>
                                    <select
                                        className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                                        value={formData.incoterm || 'FOB'}
                                        onChange={(e) => setFormData({ ...formData, incoterm: e.target.value })}
                                    >
                                        <option value="EXW">EXW (Ex Works)</option>
                                        <option value="FAS">FAS (Free Alongside Ship)</option>
                                        <option value="FOB">FOB (Free on Board)</option>
                                        <option value="CFR">CFR (Cost & Freight)</option>
                                        <option value="CIF">CIF (Cost + Insurance + Freight)</option>
                                        <option value="DDP">DDP (Delivered Duty Paid)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><Anchor size={12} /> Port of Destination (POD)</label>
                                    <select
                                        className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                                        value={formData.pod || ''}
                                        onChange={(e) => {
                                            if (e.target.value === '_ADD_NEW_') {
                                                setTargetPortField('MAIN_POD');
                                                setShowQuickAddPort(true);
                                            } else {
                                                setFormData({ ...formData, pod: e.target.value });
                                            }
                                        }}
                                    >
                                        <option value="">Select Port...</option>
                                        <option value="_ADD_NEW_" className="font-bold text-blue-600 bg-blue-50">+ Add New Port</option>
                                        {[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={`${p.name} (${p.code})`}>{p.name} ({p.code})</option>)}
                                    </select>
                                    {portAddedMessage && <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><CheckCircle2 size={10} /> {portAddedMessage}</p>}
                                </div>
                            </div>
                        )}

                        {/* Origin / Destination Details Row (Conditional) */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4 pt-4 border-t border-slate-100">
                            {/* Origin Logic */}
                            <div>
                                {(formData.deliveryMethod === 'PORT_TO_PORT' || formData.deliveryMethod === 'PORT_TO_DOOR') && (
                                    <div className="animate-in fade-in">
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><Anchor size={12} /> Port of Loading (POA)</label>
                                        <select
                                            className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                                            value={formData.poa || ''}
                                            onChange={(e) => {
                                                if (e.target.value === '_ADD_NEW_') {
                                                    setTargetPortField('MAIN_POA');
                                                    setShowQuickAddPort(true);
                                                } else {
                                                    setFormData({ ...formData, poa: e.target.value });
                                                }
                                            }}
                                        >
                                            <option value="">Select Origin Port...</option>
                                            <option value="_ADD_NEW_" className="font-bold text-blue-600 bg-blue-50">+ Add New Port</option>
                                            {[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={`${p.name} (${p.code})`}>{p.name} ({p.code})</option>)}
                                        </select>
                                    </div>
                                )}

                                {(formData.deliveryMethod === 'DOOR_TO_PORT' || formData.deliveryMethod === 'DOOR_TO_DOOR') && (
                                    <div className="animate-in fade-in">
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><MapPin size={12} /> Pick Up</label>
                                        <select
                                            className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                                            value={formData.pickupLocation || ''}
                                            onChange={(e) => {
                                                if (e.target.value === '_ADD_NEW_') {
                                                    setTargetOriginField('PICKUP');
                                                    setShowQuickAddLocation(true);
                                                } else {
                                                    setFormData({ ...formData, pickupLocation: e.target.value });
                                                }
                                            }}
                                        >
                                            <option value="">Select Pick Up...</option>
                                            <option value="_ADD_NEW_" className="font-bold text-blue-600 bg-blue-50">+ Add New Location</option>
                                            {locations.map(l => (
                                                <option key={l.id} value={`${l.name} - ${l.address}, ${l.city}, ${l.state} ${l.zip}`}>
                                                    {l.name} ({l.city}, {l.state})
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                            </div>

                            {/* Destination Logic (Always POD for Exports) */}
                            <div>
                                {/* POD Logic is already handled above in some conditions, but let's allow it here if needed or keep existing logic. 
                                      Actually, existing logic has POD inside the "grid-cols-3" above. 
                                      Let's leave POD there but maybe we want to visualize the flow? 
                                      For now, let's just make sure POA/Pickup is visible.
                                  */}
                                {/* Empty or Additional info if needed */}
                            </div>
                        </div>


                        <div className="grid grid-cols-3 gap-6 border-t border-slate-200 pt-4 mt-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><CreditCard size={12} /> Payment Terms</label>
                                <select
                                    className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                                    value={formData.paymentTerms || ''}
                                    onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })}
                                >
                                    {PAYMENT_TERM_OPTIONS.map(term => <option key={term} value={term}>{term}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><Building size={12} /> Bank</label>
                                <select
                                    className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                                    value={formData.bankId || ''}
                                    onChange={(e) => setFormData({ ...formData, bankId: e.target.value })}
                                >
                                    <option value="">Select Bank...</option>
                                    {[...banks].sort((a, b) => a.name.localeCompare(b.name)).map(bank => <option key={bank.id} value={bank.id}>{bank.name}</option>)}
                                </select>
                                {banks.length === 0 && <p className="text-xs text-amber-600 mt-1">No banks configured. Add banks in Data → Banks.</p>}
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><Calendar size={12} /> {formData.orderType === 'CONTRACT' ? 'Delivery Period' : 'Delivery Date / Term'}</label>
                                {formData.orderType === 'CONTRACT' ? (
                                    <select
                                        className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                                        value={formData.deliveryDate || ''}
                                        onChange={(e) => setFormData({ ...formData, deliveryDate: e.target.value })}
                                    >
                                        <option value="">Select Period...</option>
                                        <option value="WEEKLY">Weekly</option>
                                        <option value="MONTHLY">Monthly</option>
                                        <option value="QUARTERLY">Quarterly</option>
                                        <option value="ONCE AVAILABLE">Once Available</option>
                                    </select>
                                ) : (
                                    <div className="relative">
                                        <input
                                            className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                                            placeholder="e.g. Prompt, Dec 15th, ASAP"
                                            value={formData.deliveryDate || ''}
                                            onChange={(e) => setFormData({ ...formData, deliveryDate: e.target.value })}
                                        />
                                        {/* Option to pick date */}
                                        <input
                                            type="date"
                                            className="absolute right-1 top-1 w-6 h-6 opacity-0 cursor-pointer"
                                            onChange={(e) => setFormData({ ...formData, deliveryDate: e.target.value })}
                                        />
                                        <Calendar size={16} className="absolute right-2 top-2 text-slate-400 pointer-events-none" />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
                    <h3 className="text-sm font-bold text-slate-700 uppercase mb-4 flex items-center gap-2"><ClipboardList size={16} /> Line Items</h3>

                    {/* Add Item Row */}
                    <div className="grid grid-cols-12 gap-3 items-end mb-4 bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
                        <div className="col-span-3">
                            <label className="block text-[10px] text-slate-500 mb-1">Internal Product</label>
                            <select className="w-full border border-slate-300 rounded p-2 text-xs" value={currentItem.productId || ''} onChange={handleProductSelect}>
                                <option value="">Select...</option>
                                {[...products].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                        </div>
                        <div className="col-span-3">
                            <label className="block text-[10px] text-slate-500 mb-1 flex justify-between">
                                Customer Description
                                {currentItem.productId && <button onClick={handleAiDescription} disabled={isAiGenerating} className="text-purple-600 flex items-center gap-1 hover:underline">{isAiGenerating ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />} AI Rewrite</button>}
                            </label>
                            <input className="w-full border border-slate-300 rounded p-2 text-xs" value={currentItem.customerDescription} onChange={e => setCurrentItem({ ...currentItem, customerDescription: e.target.value })} placeholder="Description on Invoice" />
                        </div>
                        <div className="col-span-2">
                            <label className="block text-[10px] text-slate-500 mb-1">HS Code</label>
                            <input className="w-full border border-slate-300 rounded p-2 text-xs" value={currentItem.hsCode} onChange={e => setCurrentItem({ ...currentItem, hsCode: e.target.value })} />
                        </div>
                        <div className="col-span-2">
                            <QuantityInput value={currentItem.quantity || 0} onChange={val => setCurrentItem({ ...currentItem, quantity: val })} label="Qty" />
                        </div>
                        <div className="col-span-2">
                            <PriceInput value={currentItem.unitPrice || 0} onChange={val => setCurrentItem({ ...currentItem, unitPrice: val })} label="Price" />
                        </div>
                        <div className="col-span-12 flex justify-end">
                            <button onClick={handleAddItem} disabled={!currentItem.productId} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors disabled:opacity-50">Add Item</button>
                        </div>
                        {aiSuggestion && <div className="col-span-12 text-xs text-emerald-600 flex items-center gap-1"><CheckCircle2 size={12} /> {aiSuggestion}</div>}
                    </div>

                    <table className="w-full text-left text-sm">
                        <thead className="text-xs text-slate-500 uppercase bg-slate-100">
                            <tr>
                                <th className="p-2">Product / Description</th>
                                <th className="p-2">HS Code</th>
                                <th className="p-2 text-right">Qty (LBS / KG)</th>
                                <th className="p-2 text-right">Price ($/LB / $/KG)</th>
                                <th className="p-2 text-right">Total</th>
                                <th className="p-2 w-10"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                            {formData.items?.map((item, idx) => (
                                <tr key={idx} className="bg-white">
                                    <td className="p-2">
                                        <div className="font-medium text-slate-800">{item.productName}</div>
                                        <div className="text-xs text-slate-500 italic">{item.customerDescription}</div>
                                    </td>
                                    <td className="p-2 font-mono text-xs">{item.hsCode}</td>
                                    <td className="p-2 text-right">
                                        <div className="flex flex-col items-end">
                                            <span className="font-medium text-slate-800">{item.quantity.toLocaleString()} lbs</span>
                                            <span className="text-xs text-slate-400">{(item.quantity * 0.453592).toLocaleString(undefined, { maximumFractionDigits: 0 })} kg</span>
                                        </div>
                                    </td>
                                    <td className="p-2 text-right">
                                        <div className="flex flex-col items-end">
                                            <span className="font-medium text-slate-800">${item.unitPrice.toFixed(2)}/lb</span>
                                            <span className="text-xs text-slate-400">${(item.unitPrice * 2.20462).toFixed(2)}/kg</span>
                                        </div>
                                    </td>
                                    <td className="p-2 text-right font-bold text-emerald-600">${item.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                    <td className="p-2"><button onClick={() => handleRemoveItem(idx)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button></td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td colSpan={2} className="p-2 text-right font-bold uppercase text-slate-500">Totals</td>
                                <td className="p-2 text-right font-bold text-slate-700">
                                    <div className="flex flex-col items-end">
                                        <span>{(formData.items || []).reduce((sum, item) => sum + (item.quantity || 0), 0).toLocaleString()} lbs</span>
                                        <span className="text-xs text-slate-400">{(formData.items || []).reduce((sum, item) => sum + ((item.quantity || 0) * 0.453592), 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} kg</span>
                                    </div>
                                </td>
                                <td></td>
                                <td className="p-2 text-right font-bold text-lg text-emerald-600">${formData.totalAmount?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                    <button onClick={handleSaveOrder} className="bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-emerald-700 shadow-lg flex items-center gap-2">
                        <Save size={18} /> Save Order
                    </button>
                </div>
            </div>
        );
    }

    // LIST VIEW — scope orders to salesperson's customers if not admin/manager
    const scopedCustomerNames = new Set(scopedCustomers.map(c => c.name));
    const displayOrders = isAdminOrManager
        ? salesOrders
        : salesOrders.filter(o => scopedCustomerNames.has(o.customerName));

    // Dynamic Filter: If tab is FULFILLED, we check our logic
    const filteredOrders = displayOrders.filter(o => {
        // Tab filter
        let tabMatch = false;
        if (activeTab === 'FULFILLED') tabMatch = isOrderFulfilled(o);
        else if (activeTab === 'APPROVED') tabMatch = o.status === 'APPROVED' && !isOrderFulfilled(o);
        else tabMatch = o.status === activeTab;

        // Customer filter
        const customerMatch = !customerFilter ||
            (o.customerName && o.customerName === customerFilter);

        return tabMatch && customerMatch;
    }).sort((a, b) => {
        // Sort by date descending (newest first)
        const dateA = new Date(a.orderDate).getTime();
        const dateB = new Date(b.orderDate).getTime();
        return dateB - dateA;
    });
    const orderPodCodeForFilter = getPortCode(selectedOrderForLink?.pod).toLowerCase();
    const availableBookings = bookings.filter(b =>
        (b.status as any) === 'AVAILABLE' &&
        (!orderPodCodeForFilter || getPortCode(b.pod).toLowerCase() === orderPodCodeForFilter)
    );

    return (
        <div className="space-y-6">
            <div className="mb-6 flex items-start justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-xl text-white">
                        <ClipboardList size={24} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">Sales Orders</h1>
                        <p className="text-slate-500 text-sm mt-1">Manage orders, approvals, and fulfillment.</p>
                    </div>
                </div>
                <button onClick={handleNewOrder} className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-all shadow-md font-medium">
                    <FilePlus size={20} />
                    New Sales Order
                </button>
            </div>

            {/* Customer Filter */}
            <div className="flex items-center gap-3 mb-4">
                <div className="relative max-w-xs">
                    <select
                        value={customerFilter}
                        onChange={(e) => setCustomerFilter(e.target.value)}
                        className="pl-3 pr-8 py-2 w-full border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm appearance-none bg-white"
                    >
                        <option value="">All Customers</option>
                        {[...new Set(displayOrders.map(o => o.customerName).filter(Boolean))].sort().map(name => (
                            <option key={name} value={name}>{name}</option>
                        ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
                {customerFilter && (
                    <button
                        onClick={() => setCustomerFilter('')}
                        className="text-sm text-slate-500 hover:text-slate-700 underline"
                    >
                        Clear
                    </button>
                )}
            </div>

            <div className="flex gap-2 border-b border-slate-200">
                {(['PENDING', 'APPROVED', 'FULFILLED'] as const).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${activeTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                    >
                        {tab}
                        {tab === 'PENDING' && displayOrders.filter(o => o.status === 'PENDING').length > 0 && <span className="ml-1 bg-red-100 text-red-600 px-1.5 rounded-full text-xs">{displayOrders.filter(o => o.status === 'PENDING').length}</span>}
                        {tab === 'APPROVED' && displayOrders.filter(o => o.status === 'APPROVED' && !isOrderFulfilled(o)).length > 0 && <span className="ml-1 bg-emerald-100 text-emerald-600 px-1.5 rounded-full text-xs">{displayOrders.filter(o => o.status === 'APPROVED' && !isOrderFulfilled(o)).length}</span>}
                        {tab === 'FULFILLED' && displayOrders.filter(o => isOrderFulfilled(o)).length > 0 && <span className="ml-1 bg-slate-100 text-slate-600 px-1.5 rounded-full text-xs">{displayOrders.filter(o => isOrderFulfilled(o)).length}</span>}
                    </button>
                ))}
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full table-fixed text-left">
                    <colgroup>
                        <col style={{ width: '10%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '18%' }} />
                        <col style={{ width: '13%' }} />
                        <col style={{ width: '11%' }} />
                        <col style={{ width: '4%' }} />
                        <col style={{ width: '7%' }} />
                        <col style={{ width: '12%' }} />
                        <col style={{ width: '17%' }} />
                    </colgroup>
                    <thead>
                        <tr className="bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-200">
                            <th className="px-2 py-2">Order #</th>
                            <th className="px-2 py-2">Type</th>
                            <th className="px-2 py-2">Customer</th>
                            <th className="px-2 py-2">Delivery</th>
                            <th className="px-2 py-2">POD</th>
                            <th className="px-2 py-2 text-center">Items</th>
                            <th className="px-2 py-2">Date</th>
                            <th className="px-2 py-2 text-right">Amount</th>
                            <th className="px-2 py-2 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredOrders.map(order => (
                            <tr key={order.id} className="border-b border-slate-100 hover:bg-slate-50/80 transition-colors bg-white">
                                {/* Order # */}
                                <td className="px-2 py-2">
                                    <span className="text-xs font-bold text-slate-800 font-mono">{order.orderNumber}</span>
                                </td>

                                {/* Type Badges */}
                                <td className="px-2 py-2">
                                    <div className="flex items-center gap-1 flex-wrap">
                                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${order.orderType === 'CONTRACT' ? 'bg-purple-50 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>{order.orderType === 'CONTRACT' ? 'CNTR' : 'SPOT'}</span>
                                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${order.saleType === 'EXPORT' ? 'bg-indigo-50 text-indigo-700' : 'bg-emerald-50 text-emerald-700'}`}>{order.saleType === 'EXPORT' ? 'EXP' : 'LOC'}</span>
                                    </div>
                                </td>

                                {/* Customer */}
                                <td className="px-2 py-2">
                                    <span className="text-xs font-medium text-slate-700 block" title={order.customerName}>{(order.customerName || '').split(/\s+/).slice(0, 2).join(' ')}</span>
                                </td>

                                {/* Delivery / Incoterm */}
                                <td className="px-2 py-2">
                                    {(order.deliveryMethod || order.incoterm) ? (
                                        <div className="flex items-center gap-1 text-[10px] text-slate-500">
                                            <Truck size={10} className="text-slate-400 shrink-0" />
                                            {order.incoterm && <span className="font-bold bg-slate-100 px-1 rounded text-slate-600">{order.incoterm}</span>}
                                        </div>
                                    ) : <span className="text-[10px] text-slate-300">—</span>}
                                </td>

                                {/* POD */}
                                <td className="px-2 py-2">
                                    {order.pod ? (
                                        <span className="text-[10px] text-slate-600 truncate block" title={order.pod}>{order.pod}</span>
                                    ) : <span className="text-[10px] text-slate-300">—</span>}
                                </td>

                                {/* Items */}
                                <td className="px-2 py-2 text-center">
                                    <span className="text-[10px] text-slate-400">{order.items.length}</span>
                                </td>

                                {/* Date */}
                                <td className="px-2 py-2">
                                    <span className="text-[10px] text-slate-500">{new Date(order.orderDate).toLocaleDateString()}</span>
                                </td>

                                {/* Amount */}
                                <td className="px-2 py-2 text-right">
                                    <span className="text-xs font-bold text-slate-800 whitespace-nowrap">{order.currency} {order.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </td>

                                {/* Actions */}
                                <td className="px-2 py-2 text-right">
                                    <div className="flex items-center justify-end gap-1 flex-wrap">
                                        {order.status === 'PENDING' && isAdminOrManager && (
                                            <>
                                                <button onClick={() => handleStatusChange(order, 'APPROVED')} className="text-[10px] bg-emerald-600 text-white px-2 py-0.5 rounded hover:bg-emerald-700 flex items-center gap-1 whitespace-nowrap"><CheckCircle size={10} /> Approve</button>
                                                <button onClick={() => handleStatusChange(order, 'REJECTED')} className="text-[10px] bg-red-50 text-red-600 px-2 py-0.5 rounded hover:bg-red-100 flex items-center gap-1 whitespace-nowrap"><XCircle size={10} /> Reject</button>
                                            </>
                                        )}
                                        {order.status === 'APPROVED' && isAdminOrManager && (
                                            <>
                                                <button onClick={() => generateSalesDoc(order, 'PROFORMA', false)} className="text-[10px] bg-slate-50 text-slate-600 border border-slate-200 px-1.5 py-0.5 rounded hover:bg-slate-100 flex items-center gap-0.5 whitespace-nowrap"><FileText size={10} /> Proforma</button>
                                                <button onClick={() => generateSalesDoc(order, 'CONTRACT', false)} className="text-[10px] bg-slate-50 text-slate-600 border border-slate-200 px-1.5 py-0.5 rounded hover:bg-slate-100 flex items-center gap-0.5 whitespace-nowrap"><FileText size={10} /> Contract</button>
                                                <button onClick={() => handleEmailOrder(order)} className="text-[10px] bg-slate-50 text-slate-600 border border-slate-200 px-1.5 py-0.5 rounded hover:bg-slate-100 flex items-center gap-0.5 whitespace-nowrap"><Mail size={10} /></button>
                                            </>
                                        )}
                                        <button onClick={() => handleEditOrder(order)} className="text-slate-400 hover:text-blue-600 p-0.5" title="Edit"><Edit3 size={12} /></button>
                                        <button onClick={() => handleDuplicateOrder(order)} className="text-slate-400 hover:text-indigo-600 p-0.5" title="Duplicate"><Copy size={12} /></button>
                                        <button onClick={(e) => handleDeleteOrder(order.id, e)} className="text-slate-400 hover:text-red-600 p-0.5" title="Delete"><Trash2 size={12} /></button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {filteredOrders.length === 0 && (
                    <div className="text-center py-12 text-slate-400 bg-slate-50 border-dashed border-slate-200">
                        <ClipboardList size={48} className="mx-auto mb-2 opacity-20" />
                        <p>No orders in {activeTab.toLowerCase()}.</p>
                    </div>
                )}
            </div>

            {/* Request Booking Modal */}
            {showBookingRequestModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full p-0 max-h-[90vh] overflow-hidden flex flex-col">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                            <div>
                                <h3 className="font-bold text-lg flex items-center gap-2 text-slate-800"><Truck size={20} className="text-blue-600" />
                                    {bookingModalView === 'list' ? 'Booking' : 'Request Freight Quote'}
                                </h3>
                                <p className="text-sm text-slate-500 mt-1">
                                    For Order <span className="font-mono font-bold text-slate-700">{selectedOrderForLink?.orderNumber}</span>
                                    {selectedOrderForLink?.pod && <span className="ml-1">- Dest: <span className="text-blue-600 font-bold">{selectedOrderForLink.pod}</span></span>}
                                </p>
                            </div>
                            <button onClick={() => setShowBookingRequestModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-6">
                            {bookingModalView === 'list' ? (
                                <>
                                    <div>
                                        <h4 className="font-bold text-slate-700 mb-2">Select From Active Quotes</h4>
                                        <table className="w-full text-left text-sm border-collapse animate-in fade-in">
                                            <thead className="bg-slate-100 text-xs font-bold text-slate-500 uppercase sticky top-0 z-10 shadow-sm">
                                                <tr>
                                                    <th className="p-4 border-b border-slate-200 pl-6">Cargo Agent</th>
                                                    <th className="p-4 border-b border-slate-200">Pickup Address / Route</th>
                                                    <th className="p-4 border-b border-slate-200 text-center">Transit</th>
                                                    <th className="p-4 border-b border-slate-200 text-right">Rate</th>
                                                    <th className="p-4 border-b border-slate-200 text-right">Valid Until</th>
                                                    <th className="p-4 border-b border-slate-200 text-center pr-6">Containers</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {matchingQuotes.map(quote => {
                                                    const qty = quoteQuantities[quote.id] || 0;
                                                    const isSelected = selectedQuoteIds.includes(quote.id);

                                                    return (
                                                        <tr key={quote.id} className={`hover:bg-blue-50 transition-colors ${isSelected ? 'bg-blue-50' : ''}`}>
                                                            <td className="p-4 font-bold text-slate-700 pl-6">{quote.agentName}</td>
                                                            <td className="p-4 text-sm text-slate-600">
                                                                <div className="font-bold text-slate-700">{quote.pickupLocation || quote.originPort || 'Port Loading'}</div>
                                                                <div className="text-xs text-slate-400 font-mono mt-0.5">
                                                                    {quote.originPortCode || 'POA'} <span className="text-slate-300">→</span> {quote.destinationPortCode || 'POD'}
                                                                </div>
                                                            </td>
                                                            <td className="p-4 text-center text-slate-600">{quote.transitTime ? `${quote.transitTime}d` : '-'}</td>
                                                            <td className="p-4 text-right font-bold text-emerald-600">${quote.rate.toLocaleString()}</td>
                                                            <td className="p-4 text-right text-xs text-slate-500">{quote.validUntil}</td>
                                                            <td className="p-4 text-center pr-6">
                                                                <select
                                                                    className={`border rounded p-1 text-sm outline-none w-20 text-center transition-colors ${qty > 0 ? 'bg-blue-600 text-white border-blue-600 font-bold' : 'bg-white border-slate-300 text-slate-700'}`}
                                                                    value={qty}
                                                                    onChange={(e) => {
                                                                        const val = Number(e.target.value);
                                                                        setQuoteQuantities(prev => ({ ...prev, [quote.id]: val }));
                                                                        if (val > 0) {
                                                                            if (!selectedQuoteIds.includes(quote.id)) setSelectedQuoteIds(prev => [...prev, quote.id]);
                                                                        } else {
                                                                            setSelectedQuoteIds(prev => prev.filter(id => id !== quote.id));
                                                                        }
                                                                    }}
                                                                >
                                                                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n} className="bg-white text-slate-800">{n === 0 ? '0' : `${n}x`}</option>)}
                                                                </select>
                                                            </td>
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div className="mt-6 pt-6 border-t border-dashed border-slate-200">
                                        <h4 className="font-bold text-slate-700 mb-2">Or, Link an Existing Booking</h4>
                                        {availableBookings.length > 0 ? (
                                            <table className="w-full text-left text-sm border-collapse animate-in fade-in">
                                                <thead className="bg-slate-100 text-xs font-bold text-slate-500 uppercase">
                                                    <tr>
                                                        <th className="p-3 border-b border-slate-200">Booking #</th>
                                                        <th className="p-3 border-b border-slate-200">Route</th>
                                                        <th className="p-3 border-b border-slate-200">ETD</th>
                                                        <th className="p-3 border-b border-slate-200">Equipment</th>
                                                        <th className="p-3 border-b border-slate-200">Status</th>
                                                        <th className="p-3 border-b border-slate-200"></th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {availableBookings.map(booking => (
                                                        <tr key={booking.id} className="hover:bg-slate-50">
                                                            <td className="p-3 font-mono text-slate-700">{booking.bookingNumber}</td>
                                                            <td className="p-3 text-slate-600 font-mono">{getPortCode(booking.pol)} → {getPortCode(booking.pod)}</td>
                                                            <td className="p-3 text-slate-500">{booking.etd}</td>
                                                            <td className="p-3 text-slate-600">{booking.equipment}</td>
                                                            <td className="p-3"><span className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-2 py-1 rounded-full">AVAILABLE</span></td>
                                                            <td className="p-3 text-right">
                                                                <div className="flex items-center justify-end gap-2">
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => { e.stopPropagation(); openDocument(booking.originalDocument); }}
                                                                        className={`p-1.5 rounded-md transition-colors ${booking.originalDocument
                                                                            ? 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'
                                                                            : 'text-slate-300 cursor-not-allowed'
                                                                            }`}
                                                                        title={booking.originalDocument ? "View Document" : "No Document Available"}
                                                                        disabled={!booking.originalDocument}
                                                                    >
                                                                        <Eye size={16} />
                                                                    </button>
                                                                    <button onClick={() => handleLinkBooking(booking.id)} className="bg-white border border-slate-300 text-slate-600 px-3 py-1 text-xs rounded-lg hover:bg-slate-100 font-bold">
                                                                        Link
                                                                    </button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        ) : (
                                            <p className="text-xs text-center text-slate-400 bg-slate-50 p-4 rounded-lg">No available bookings found matching criteria.</p>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <div className="space-y-4 animate-in fade-in">
                                    <div className="bg-blue-50 p-4 rounded-xl border border-blue-200 text-sm text-blue-800">
                                        No active quotes found matching destination <strong>"{selectedOrderForLink?.pod}"</strong>.
                                        <p className="mt-2 text-xs">Please provide the details below to broadcast a new quote request to your cargo agents.</p>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Pick Up</label>
                                        <div className="flex gap-2">
                                            <select
                                                className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                                                value={currentPickupSelection}
                                                onChange={(e) => {
                                                    if (e.target.value === '_ADD_NEW_') {
                                                        setShowQuickAddLocation(true);
                                                    } else {
                                                        setCurrentPickupSelection(e.target.value);
                                                    }
                                                }}
                                            >
                                                <option value="">Select Location to Add...</option>
                                                <option value="_ADD_NEW_" className="font-bold text-blue-600 bg-blue-50">+ Add New Location</option>
                                                {[...locations].sort((a, b) => a.name.localeCompare(b.name)).map(l => <option key={l.id} value={`${l.address}, ${l.city}, ${l.state}`}>{`${l.name} - ${l.city}`}</option>)}
                                            </select>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (currentPickupSelection && !newQuotePickups.includes(currentPickupSelection)) {
                                                        setNewQuotePickups([...newQuotePickups, currentPickupSelection]);
                                                        setCurrentPickupSelection('');
                                                    }
                                                }}
                                                disabled={!currentPickupSelection}
                                                className="bg-blue-100 text-blue-700 px-4 rounded-lg font-bold text-xs hover:bg-blue-200 transition-colors disabled:opacity-50"
                                            >
                                                Add
                                            </button>
                                        </div>
                                        {locationAddedMessage && <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><CheckCircle2 size={10} /> {locationAddedMessage}</p>}

                                        {newQuotePickups.length > 0 && (
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                {newQuotePickups.map((loc, index) => (
                                                    <div key={index} className="bg-slate-200 text-slate-700 text-xs font-medium px-2 py-1 rounded-full flex items-center gap-2">
                                                        <span>{loc}</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => setNewQuotePickups(newQuotePickups.filter((_, i) => i !== index))}
                                                            className="text-slate-500 hover:text-slate-800"
                                                        >
                                                            <X size={12} />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Port of Loading (POA)</label>
                                        <select
                                            className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                                            value={newQuotePOA}
                                            onChange={(e) => {
                                                if (e.target.value === '_ADD_NEW_') {
                                                    setTargetPortField('QUOTE_POA');
                                                    setShowQuickAddPort(true);
                                                } else {
                                                    setNewQuotePOA(e.target.value);
                                                }
                                            }}
                                        >
                                            <option value="">Select Port...</option>
                                            <option value="_ADD_NEW_" className="font-bold text-blue-600 bg-blue-50">+ Add New Port</option>
                                            {[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={`${p.name} (${p.code})`}>{p.name} ({p.code})</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Port of Discharge (POD)</label>
                                        <select
                                            className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                                            value={newQuotePOD}
                                            onChange={(e) => {
                                                if (e.target.value === '_ADD_NEW_') {
                                                    setTargetPortField('QUOTE_POD');
                                                    setShowQuickAddPort(true);
                                                } else {
                                                    setNewQuotePOD(e.target.value);
                                                }
                                            }}
                                        >
                                            <option value="">Select Port...</option>
                                            <option value="_ADD_NEW_" className="font-bold text-blue-600 bg-blue-50">+ Add New Port</option>
                                            {[...ports].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={`${p.name} (${p.code})`}>{p.name} ({p.code})</option>)}
                                        </select>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="p-4 border-t border-slate-100 bg-white flex justify-between items-center">
                            {bookingModalView === 'list' ? (
                                <div className="flex justify-between items-center w-full">
                                    <button
                                        onClick={() => setBookingModalView('form')}
                                        className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-2 text-xs"
                                    >
                                        <Plus size={14} /> Request New Quote
                                    </button>
                                    <button
                                        onClick={handleProcessBookingRequests}
                                        disabled={selectedQuoteIds.length === 0}
                                        className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                    >
                                        <ListChecks size={18} />
                                        Booking {selectedQuoteIds.length > 0 ? `(${selectedQuoteIds.length})` : ''}
                                    </button>
                                </div>
                            ) : (
                                <div className="flex justify-between items-center w-full">
                                    {matchingQuotes.length > 0 ? (
                                        <button
                                            onClick={() => setBookingModalView('list')}
                                            className="text-xs font-bold text-slate-500 hover:text-blue-600 transition-colors flex items-center gap-1"
                                        >
                                            <ArrowLeft size={12} /> Back to List
                                        </button>
                                    ) : <span></span>}
                                    <button
                                        onClick={handleRequestFreightQuote}
                                        className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-indigo-700 transition-colors shadow-sm flex items-center gap-2"
                                    >
                                        <Plus size={18} />
                                        Submit Quote Request
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {showQuickAddPort && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    {/* Quick Add Port Modal Content */}
                </div>
            )}

            {showQuickAddLocation && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    {/* Quick Add Location Modal Content */}
                </div>
            )}

            {/* PDF Viewer Modal */}
            <PDFPreviewModal
                isOpen={showPdfModal}
                onClose={() => setShowPdfModal(false)}
                pdfUrl={pdfUrl}
                pdfBlob={pdfBlob}
                title={pdfTitle}
                fileName={pdfFileName}
                onDownload={pdfDownloadFn || undefined}
            />
        </div>
    );
};

export default SalesOrders;
