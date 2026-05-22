
import React, { useState, useEffect, useRef } from 'react';
import { Invoice, PackingList, Customer, Company, SalesOrder, Booking, BillOfLading } from '../types';
import { FileText, Save, Download, Plus, Trash2, Search, CheckCircle2, ArrowRight, Building2, Calendar, DollarSign, Calculator, Receipt, ArrowLeft, Loader2, Container, Package, Pencil, List, FileCheck, User, CreditCard, X, Mail, UploadCloud, Ship, Link2 } from 'lucide-react';
import { analyzeDocument } from '../services/geminiService';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PAYMENT_TERM_OPTIONS } from '../constants';
import { FormattedInput, PriceInput, QuantityInput } from '../components/UnitInputs';
import { getSupabaseClient } from '../services/supabase';
import PDFPreviewModal from '../components/PDFPreviewModal';
import { workflowEngine } from '../services/workflowEngine';

interface InvoiceEngineProps {
    packingLists: PackingList[];
    customers: Customer[];
    invoices: Invoice[];
    salesOrders: SalesOrder[];
    bookings?: Booking[];
    billOfLadings?: BillOfLading[];
    onSave: (inv: Invoice) => void;
    onUpdate: (inv: Invoice) => void;
    onDelete: (id: string) => Promise<boolean>;
    currentCompanyId: string;
    availableCompanies: Company[];
    autoLoadPL?: PackingList | null;
    onClearAutoLoad?: () => void;
}

interface InvoiceLineItem {
    id: string;
    description: string;
    customerDescription: string;
    hsCode: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    amount: number;
    // Product Reference
    productId?: string;
    // Container Data (for Resume Per Container)
    containerNo?: string;
    sealNo?: string;
    grossLbs?: number;
    netLbs?: number;
    grossKg?: number;
    netKg?: number;
    volumes?: number;
}

interface ContainerRow {
    id: string;
    container: string;
    seal: string;
}

interface BankProfile {
    id: string;
    bankName: string;
    bankAddress: string;
    routingNumber: string;
    swiftCode: string;
    accountNumber: string;
}

// Default Bank Data for EC4 (Fallback if DB fetch fails)
const EC4_BANK_DEFAULTS = {
    bankName: 'CHASE BANK',
    bankAddress: '370 Village Oaks Dr\nSt. Johns, FL, USA 32259',
    accountNumber: '865683835',
    swiftCode: 'CHASUS33',
    routingNumber: ''
};

const InvoiceEngine: React.FC<InvoiceEngineProps> = ({
    packingLists,
    customers,
    invoices,
    salesOrders,
    onSave,
    onUpdate,
    onDelete,
    currentCompanyId,
    availableCompanies,
    autoLoadPL,
    onClearAutoLoad,
    bookings = [],
    billOfLadings = []
}) => {
    const [activeTab, setActiveTab] = useState<'BLANK' | 'PL' | 'SAVED'>('BLANK');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedPL, setSelectedPL] = useState<PackingList | null>(null);
    const [selectedSO, setSelectedSO] = useState<SalesOrder | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [invoiceSearchTerm, setInvoiceSearchTerm] = useState('');

    // Data State with Auto-Refresh
    const [localPackingLists, setLocalPackingLists] = useState<PackingList[]>(packingLists || []);
    const [localInvoices, setLocalInvoices] = useState<Invoice[]>(invoices || []);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);

    const currentCompany = availableCompanies.find(c => c.id === currentCompanyId);
    const defaultShipperName = currentCompany ? currentCompany.name : 'EC4 ENTERPRISES';
    // Check if current company is EC4 (Case insensitive check on name or ID context)
    const isEC4 = (defaultShipperName.toUpperCase().includes('EC4') || currentCompanyId === 'ALL');

    // Form State
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
    const [dueDate, setDueDate] = useState('');
    const [selectedCustomerId, setSelectedCustomerId] = useState('');
    const [billToName, setBillToName] = useState('');
    const [billToAddress, setBillToAddress] = useState('');
    const [shipperName, setShipperName] = useState(defaultShipperName);
    const [paymentTerms, setPaymentTerms] = useState('Net 30');
    const [currency, setCurrency] = useState('USD');
    const [transportRef, setTransportRef] = useState(''); // Booking Number / BL
    const [plNumber, setPlNumber] = useState('');
    const [soNumber, setSoNumber] = useState('');
    const [pod, setPod] = useState('');
    const [supplier, setSupplier] = useState('');

    // SLI Specific State
    const [incoterm, setIncoterm] = useState('EX-WORKS USA');
    const [carrier, setCarrier] = useState('GLOBAL');
    const [trackingNumber, setTrackingNumber] = useState('');
    const [commodity, setCommodity] = useState('Cotton Low Grades (COTTON PC SWEEPS - Desperdícios de Fiapos Algodão PC)');
    const [packaging, setPackaging] = useState('Bales / Fardos');
    const [origin, setOrigin] = useState('USA');

    const [items, setItems] = useState<InvoiceLineItem[]>([]);
    const [notes, setNotes] = useState('');

    // Logistics Data
    const [netWeight, setNetWeight] = useState('');
    const [grossWeight, setGrossWeight] = useState('');
    const [totalVolumes, setTotalVolumes] = useState('');
    const [containers, setContainers] = useState<ContainerRow[]>([]);

    // Bank Details
    const [bankDetails, setBankDetails] = useState({
        bankName: '',
        bankAddress: '',
        accountNumber: '',
        swiftCode: '',
        routingNumber: ''
    });

    // Bank Management State
    const [companyBanks, setCompanyBanks] = useState<BankProfile[]>([]);
    const [selectedBankId, setSelectedBankId] = useState('');
    const [showAddBank, setShowAddBank] = useState(false);

    // PDF Preview State
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewTitle, setPreviewTitle] = useState('');
    const [previewFileName, setPreviewFileName] = useState('');
    const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
    const [previewDownloadFn, setPreviewDownloadFn] = useState<(() => void) | null>(null);

    // Link BL Modal State
    const [openLinkBLModal, setOpenLinkBLModal] = useState<string | null>(null);
    const [selectedBLForModal, setSelectedBLForModal] = useState<string>('');

    // Products cache for looking up system product names by productId
    const [products, setProducts] = useState<any[]>([]);



    const handleClosePreview = () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
        setPreviewBlob(null);
        setPreviewDownloadFn(null);
    };

    // Link BL to Invoice Handler
    const handleLinkBLToInvoice = async () => {
        if (!openLinkBLModal || !selectedBLForModal) return;
        try {
            const client = getSupabaseClient();
            if (client) {
                const { error } = await client.from('invoices').update({ transportRef: selectedBLForModal }).eq('id', openLinkBLModal);
                if (error) throw error;
                // Update local state to reflect change
                setLocalInvoices(prev => prev.map(inv =>
                    inv.id === openLinkBLModal ? { ...inv, transportRef: selectedBLForModal } : inv
                ));
                setOpenLinkBLModal(null);
                setSelectedBLForModal('');
            }
        } catch (e) {
            console.error("Link BL Error:", e);
            alert("Failed to link Bill of Lading.");
        }
    };

    const openPreview = (dataUri: any, title: string, fileName: string, blob?: Blob, downloadFn?: () => void) => {
        console.log('[PDF Preview Debug] openPreview called with:', { dataUri, title, fileName, hasBlob: !!blob, hasDownloadFn: !!downloadFn });
        if (dataUri) {
            setPreviewUrl(dataUri);
            setPreviewTitle(title);
            setPreviewFileName(fileName);
            setPreviewBlob(blob || null);
            // Store download function: wrap it so React doesn't treat it as state updater
            // The wrapper should CALL downloadFn, not just return it
            if (downloadFn) {
                setPreviewDownloadFn(() => () => downloadFn());
            } else {
                setPreviewDownloadFn(null);
            }
            console.log('[PDF Preview Debug] State set successfully, downloadFn provided:', !!downloadFn);
        } else {
            console.error('[PDF Preview Debug] dataUri is falsy!');
        }
    };

    const [isSaving, setIsSaving] = useState(false);

    // Auto Load PL Effect
    useEffect(() => {
        if (autoLoadPL) {
            populateFromPL(autoLoadPL);
            if (onClearAutoLoad) {
                onClearAutoLoad();
            }
        }
    }, [autoLoadPL]);

    // Init blank invoice number on mount
    useEffect(() => {
        if (!invoiceNumber && !editingId) {
            setInvoiceNumber(`INV-${Date.now().toString().slice(-6)}`);
            // Initial Fallback if DB hasn't loaded yet
            if (isEC4) {
                setBankDetails(prev => ({ ...prev, ...EC4_BANK_DEFAULTS }));
            }
        }
    }, [editingId, isEC4]);

    useEffect(() => {
        const fetchLogo = async () => {
            const client = getSupabaseClient();
            if (!client) return;

            const targetId = currentCompanyId === 'ALL' ? 'SYSTEM' : currentCompanyId;

            const { data } = await client
                .from('imagens')
                .select('url')
                .eq('companyId', targetId)
                .eq('type', 'LOGO')
                .single();

            if (data && data.url) {
                setCompanyLogoUrl(data.url);
            } else if (targetId !== 'SYSTEM') {
                // Try system logo if company specific not found
                const { data: sysData } = await client
                    .from('imagens')
                    .select('url')
                    .eq('companyId', 'SYSTEM')
                    .eq('type', 'LOGO')
                    .single();
                if (sysData && sysData.url) {
                    setCompanyLogoUrl(sysData.url);
                }
            } else {
                setCompanyLogoUrl(null);
            }
        };
        fetchLogo();
    }, [currentCompanyId]);

    // Fetch Banks based on COMPANY ID (Shipper), NOT Customer
    useEffect(() => {
        const fetchBanks = async () => {
            const client = getSupabaseClient();
            if (!client) return;

            let query = client.from('customer_banks').select('*');

            // If we are in specific company mode, filter by it. 
            // If ALL, we fetch all (or maybe filter by EC4 if we want to be specific, but ALL usually means admin sees all)
            if (currentCompanyId !== 'ALL') {
                query = query.eq('companyId', currentCompanyId);
            }

            const { data, error } = await query;

            if (data) {
                setCompanyBanks(data);
            } else if (error) {
                console.error("Error fetching banks:", error);
            }
        };
        fetchBanks();
    }, [currentCompanyId]);

    // Auto-select bank in dropdown logic
    useEffect(() => {
        if (companyBanks.length > 0) {
            // Case 1: Editing an existing invoice - Match saved data to DB record
            if (editingId && bankDetails.bankName) {
                const match = companyBanks.find(b =>
                    (b.accountNumber && bankDetails.accountNumber && b.accountNumber === bankDetails.accountNumber) ||
                    (b.bankName.trim().toLowerCase() === bankDetails.bankName.trim().toLowerCase())
                );

                if (match) {
                    setSelectedBankId(match.id);
                } else {
                    setSelectedBankId(''); // Custom or unmatched
                }
            }
            // Case 2: New Invoice for EC4 - SPECIFICALLY HUNT FOR CHASE BANK 5835
            else if (!editingId && isEC4) {
                const chase5835 = companyBanks.find(b =>
                    b.bankName.toUpperCase().includes('CHASE') &&
                    (b.accountNumber.endsWith('5835') || b.accountNumber.includes('5835'))
                );

                if (chase5835) {
                    setSelectedBankId(chase5835.id);
                    setBankDetails({
                        bankName: chase5835.bankName,
                        bankAddress: chase5835.bankAddress,
                        accountNumber: chase5835.accountNumber,
                        swiftCode: chase5835.swiftCode,
                        routingNumber: chase5835.routingNumber
                    });
                }
            }
        }
    }, [companyBanks, editingId, isEC4]); // Dependent on banks loading or edit mode changing

    // Auto-refresh PLs when tab opens
    useEffect(() => {
        if (activeTab === 'PL') {
            const refreshPLs = async () => {
                const client = getSupabaseClient();
                if (!client) return;

                setIsRefreshing(true);
                let query = client.from('packing_lists').select('*');

                if (currentCompanyId !== 'ALL') {
                    query = query.or(`companyId.eq.${currentCompanyId},companyId.eq.ALL`);
                }

                const { data, error } = await query.order('createdAt', { ascending: false });

                if (data) {
                    setLocalPackingLists(data);
                } else if (error) {
                    console.error("Error refreshing packing lists:", error);
                }

                setIsRefreshing(false);
            };
            refreshPLs();
        }
    }, [activeTab, currentCompanyId]);

    // Fetch products for description lookups
    useEffect(() => {
        const fetchProducts = async () => {
            const client = getSupabaseClient();
            if (!client) return;
            const { data } = await client.from('products').select('id, name, grade, category');
            if (data) setProducts(data);
        };
        fetchProducts();
    }, []);

    // Derived Totals
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    const totalAmount = subtotal;

    const filteredPLs = localPackingLists.filter(pl => {
        const term = searchTerm.toLowerCase();
        const plNum = (pl.plNumber || '').toLowerCase();
        const consignee = (pl.consignee || '').toLowerCase();
        return plNum.includes(term) || consignee.includes(term);
    });

    // Sync localInvoices with props when invoices change from parent
    useEffect(() => {
        setLocalInvoices(invoices || []);
    }, [invoices]);

    const filteredInvoices = localInvoices.filter(inv => {
        const term = invoiceSearchTerm.toLowerCase();
        return (
            inv.invoiceNumber.toLowerCase().includes(term) ||
            (inv.soldTo && inv.soldTo.toLowerCase().includes(term))
        );
    });

    const resetForm = () => {
        setEditingId(null);
        setInvoiceNumber('');
        setInvoiceDate(new Date().toISOString().split('T')[0]);
        setDueDate('');
        setSelectedCustomerId('');
        setBillToName('');
        setBillToAddress('');
        setShipperName(defaultShipperName);
        setPaymentTerms('Net 30');
        setItems([]);
        setNotes('');
        setTransportRef('');
        setNetWeight('');
        setGrossWeight('');
        setTotalVolumes('');
        setContainers([]);

        // Reset Bank Details (Prefill for EC4 - Chase 5835 Priority)
        if (isEC4) {
            const chase5835 = companyBanks.find(b =>
                b.bankName.toUpperCase().includes('CHASE') &&
                (b.accountNumber.endsWith('5835') || b.accountNumber.includes('5835'))
            );

            if (chase5835) {
                setSelectedBankId(chase5835.id);
                setBankDetails({
                    bankName: chase5835.bankName,
                    bankAddress: chase5835.bankAddress,
                    accountNumber: chase5835.accountNumber,
                    swiftCode: chase5835.swiftCode,
                    routingNumber: chase5835.routingNumber
                });
            } else {
                setBankDetails(EC4_BANK_DEFAULTS);
                setSelectedBankId('');
            }
        } else {
            setBankDetails({ bankName: '', bankAddress: '', accountNumber: '', swiftCode: '', routingNumber: '' });
            setSelectedBankId('');
        }
        setPod('');
    };

    // Auto-fetch POD from bookings when Booking # changes
    useEffect(() => {
        const fetchBookingPOD = async () => {
            if (!transportRef || transportRef.length < 3) return;

            // Skip if this is a PL number (not a booking number)
            if (transportRef.toUpperCase().startsWith('PL-')) return;

            // Clean the transport reference to avoid 406 errors with special chars like colon
            const searchRef = transportRef.split(':')[0].trim();
            if (searchRef.length < 3) return;

            try {
                const client = getSupabaseClient();
                const { data, error } = await client
                    .from('bookings')
                    .select('pod')
                    .eq('bookingNumber', searchRef)
                    .single();

                if (data && data.pod) {
                    setPod(data.pod);
                }
            } catch (err) {
                console.error("Error fetching booking POD:", err);
            }
        };

        const timeoutId = setTimeout(fetchBookingPOD, 800); // 800ms debounce
        return () => clearTimeout(timeoutId);
    }, [transportRef]);

    // Auto-fetch Terms from Sales Order when SO # changes
    useEffect(() => {
        const fetchSOTerms = async () => {
            if (!soNumber || soNumber.length < 3) return;

            // 1. Try finding in props first (optimization)
            const localSO = salesOrders.find(so => so.orderNumber === soNumber);
            if (localSO) {
                if (localSO.incoterm) setIncoterm(localSO.incoterm);
                if (localSO.paymentTerms) setPaymentTerms(localSO.paymentTerms);
                if (localSO.pod) setPod(localSO.pod);
                return;
            }

            // 2. Fetch from DB if not found locally
            try {
                const client = getSupabaseClient();
                const { data, error } = await client
                    .from('sales_orders')
                    .select('incoterm, paymentTerms, pod')
                    .eq('orderNumber', soNumber)
                    .single();

                if (data) {
                    if (data.incoterm) setIncoterm(data.incoterm);
                    if (data.paymentTerms) setPaymentTerms(data.paymentTerms);
                    if (data.pod) setPod(data.pod);
                }
            } catch (err) {
                console.error("Error fetching SO terms:", err);
            }
        };

        const timeoutId = setTimeout(fetchSOTerms, 800);
        return () => clearTimeout(timeoutId);
    }, [soNumber, salesOrders]);

    const handleLoadBlank = () => {
        resetForm();
        setInvoiceNumber(`INV-${Date.now().toString().slice(-6)}`);
        setActiveTab('BLANK');
        setSelectedPL(null);
    };

    const handleSelectPL = (pl: PackingList) => {
        setSelectedPL(pl);
    };

    const handleConfirmPL = () => {
        if (!selectedPL) return;

        resetForm(); // This will trigger the bank lookup for EC4
        setInvoiceNumber(`INV-${Date.now().toString().slice(-6)}`);
        setTransportRef(selectedPL.plNumber || selectedPL.blNumber || '');
        setPlNumber(selectedPL.plNumber || ''); // Transfer PL Number
        setSoNumber(selectedPL.soNumber || ''); // Transfer SO Number

        // Logistics
        setNetWeight(selectedPL.netWeight || '');
        setGrossWeight(selectedPL.grossWeight || '');
        setTotalVolumes(selectedPL.unitCount || '');

        const contList: ContainerRow[] = [];
        const cNums = selectedPL.containerNumber ? selectedPL.containerNumber.split(',').map(s => s.trim()) : [];
        const sNums = selectedPL.sealNumber ? selectedPL.sealNumber.split(',').map(s => s.trim()) : [];

        cNums.forEach((cn, idx) => {
            if (cn) {
                contList.push({ id: `cont_${Date.now()}_${idx}`, container: cn, seal: sNums[idx] || '' });
            }
        });
        setContainers(contList);

        // Auto-select Sales Order if soNumber matches
        if (selectedPL.soNumber) {
            const matchedSO = salesOrders.find(so => so.orderNumber === selectedPL.soNumber);
            if (matchedSO) {
                setSelectedSO(matchedSO);
                const cust = customers.find(c => c.id === matchedSO.customerId);
                if (cust) {
                    setSelectedCustomerId(cust.id);
                    setBillToName(cust.name);
                    setBillToAddress(`${cust.location || ''}\n${cust.city || ''}, ${cust.state || ''} ${cust.zip || ''}\n${cust.country || ''}`.trim());
                    setPaymentTerms(cust.paymentTerms || 'Net 30');
                }
            } else {
                // If no SO found, try to match consignee
                const matchedCustomer = customers.find(c => selectedPL.consignee && c.name.toLowerCase().includes(selectedPL.consignee.toLowerCase()));
                if (matchedCustomer) {
                    setSelectedCustomerId(matchedCustomer.id);
                    setBillToName(matchedCustomer.name);
                    setBillToAddress(`${matchedCustomer.location || ''} ${matchedCustomer.city || ''} ${matchedCustomer.country || ''}`.trim());
                    setPaymentTerms(matchedCustomer.paymentTerms || 'Net 30');
                } else {
                    setBillToName(selectedPL.consignee || '');
                }
            }
        } else {
            // No SO number, try to match consignee
            const matchedCustomer = customers.find(c => selectedPL.consignee && c.name.toLowerCase().includes(selectedPL.consignee.toLowerCase()));
            if (matchedCustomer) {
                setSelectedCustomerId(matchedCustomer.id);
                setBillToName(matchedCustomer.name);
                setBillToAddress(`${matchedCustomer.location || ''} ${matchedCustomer.city || ''} ${matchedCustomer.country || ''}`.trim());
                setPaymentTerms(matchedCustomer.paymentTerms || 'Net 30');
            } else {
                setBillToName(selectedPL.consignee || '');
            }
        }

        try {
            const plItems = JSON.parse(selectedPL.items || '[]');

            // Get container list for distribution
            const containerList = contList.length > 0 ? contList : [];

            const newItems: InvoiceLineItem[] = plItems.map((item: any, idx: number) => {
                // If item doesn't have a container assigned, auto-distribute from PL containers
                let assignedContainer = item.containerNo || '';
                let assignedSeal = item.sealNo || '';

                if (!assignedContainer && containerList.length > 0) {
                    // Distribute items evenly across containers
                    const containerIndex = idx % containerList.length;
                    assignedContainer = containerList[containerIndex].container;
                    assignedSeal = containerList[containerIndex].seal;
                }

                // STRICT PRODUCT RESOLUTION (Same as populateFromPL)
                let productDescription = '';
                let resolvedProductId = item.productId || '';

                // 1. Live Lookup by ID (Authoritative)
                if (item.productId && products.length > 0) {
                    const product = products.find((p: any) => p.id === item.productId);
                    if (product) {
                        productDescription = product.grade ? `${product.name} (${product.grade})` : product.name;
                    }
                }

                // 2. Reverse Lookup by productName if no ID (Backwards Compatibility)
                if (!resolvedProductId && item.productName && products.length > 0) {
                    const product = products.find((p: any) => {
                        const expectedName = p.grade ? `${p.name} (${p.grade})` : p.name;
                        return expectedName === item.productName || p.name === item.productName;
                    });
                    if (product) {
                        resolvedProductId = product.id;
                        productDescription = product.grade ? `${product.name} (${product.grade})` : product.name;
                    }
                }

                // 3. Snapshot Fallback (System Name)
                if (!productDescription && item.productName) {
                    productDescription = item.productName;
                }

                // 4. OCR Fallback (Last Resort)
                if (!productDescription) {
                    productDescription = item.description || item.productDescription || 'Product';
                }

                return {
                    id: `item_${Date.now()}_${idx}`,
                    productId: resolvedProductId, // For dropdown selection
                    description: productDescription,
                    customerDescription: '',
                    hsCode: '',
                    quantity: Number(item.netLbs || item.quantity || 0),
                    unit: 'LBS',
                    unitPrice: 0,
                    amount: 0,
                    // Map container data
                    containerNo: assignedContainer,
                    sealNo: assignedSeal,
                    grossLbs: Number(item.grossLbs || 0),
                    netLbs: Number(item.netLbs || 0),
                    grossKg: Number(item.grossKg || 0),
                    netKg: Number(item.netKg || 0),
                    volumes: Number(item.volumes || 0)
                };
            });
            setItems(newItems);
        } catch (e) {
            console.error("Failed to parse PL items", e);
        }


        // Keep selectedPL so it shows in the SOURCE DOCUMENTS dropdown
        setActiveTab('BLANK');
    };

    const handleLoadInvoice = async (inv: Invoice) => {
        // Ensure products loaded (Strict Requirement)
        let currentProducts = products;
        if (currentProducts.length === 0) {
            const client = getSupabaseClient();
            if (client) {
                const { data } = await client.from('products').select('*');
                if (data) {
                    setProducts(data);
                    currentProducts = data;
                }
            }
        }

        resetForm();

        setEditingId(inv.id);
        setInvoiceNumber(inv.invoiceNumber);
        setInvoiceDate(inv.invoiceDate.split('T')[0]);

        // Restore PL and SO Links
        setPlNumber(inv.plNumber || '');
        setSoNumber(inv.soNumber || '');

        if (inv.plNumber) {
            const pl = packingLists.find(p => p.plNumber === inv.plNumber);
            if (pl) {
                setSelectedPL(pl);
                // Pull booking number from PL if not on invoice
                if (!inv.transportRef && pl.blNumber) {
                    setTransportRef(pl.blNumber);
                }
            }
        }

        if (inv.soNumber) {
            const so = salesOrders.find(s => s.orderNumber === inv.soNumber);
            if (so) setSelectedSO(so);
        }

        const soldToParts = (inv.soldTo || '').split('\n');
        const customerNameLine = soldToParts[0] || '';
        setBillToName(customerNameLine);
        setBillToAddress(soldToParts.slice(1).join('\n'));

        setShipperName(inv.shipperName);
        setPaymentTerms(inv.paymentTerms || 'Net 30');
        setCurrency(inv.currency || 'USD');
        // Use invoice transportRef first, else it may have been set from PL above
        if (inv.transportRef) {
            setTransportRef(inv.transportRef);
        }
        setNetWeight(inv.netWeight || '');
        setGrossWeight(inv.grossWeight || '');
        setTotalVolumes(inv.totalQuantity || '');
        setIncoterm(inv.incoterm || '');
        setPod(inv.pod || '');

        try {
            let invoiceItems = JSON.parse(inv.items || '[]');

            // If we have a linked PL, cross-reference to get productName from PL items
            if (inv.plNumber) {
                const pl = packingLists.find(p => p.plNumber === inv.plNumber);
                if (pl) {
                    try {
                        const plItems = JSON.parse(pl.items || '[]');
                        // Update invoice items description with productName from PL or products lookup
                        invoiceItems = invoiceItems.map((item: any, idx: number) => {
                            const plItem = plItems[idx];
                            if (plItem) {
                                // STRICT RESOLUTION LOGIC
                                let productDescription = '';

                                // 1. Live Lookup (Authoritative)
                                if (plItem.productId && currentProducts.length > 0) {
                                    const product = currentProducts.find((p: any) => p.id === plItem.productId);
                                    if (product) {
                                        productDescription = product.grade ? `${product.name} (${product.grade})` : product.name;
                                    }
                                }

                                // 2. Snapshot Fallback (System Name)
                                if (!productDescription && plItem.productName) {
                                    productDescription = plItem.productName;
                                }

                                // 3. Upgrade Logic: If we found a better description, use it.
                                if (productDescription) {
                                    return {
                                        ...item,
                                        productId: plItem.productId,
                                        description: productDescription
                                    };
                                }
                            }
                            return item;
                        });
                    } catch (e) { console.error('Error parsing PL items for productName lookup:', e); }
                }
            }

            setItems(invoiceItems);
        } catch (e) { setItems([]); }
        try { setContainers(JSON.parse(inv.freightTerms || '[]')); } catch (e) { setContainers([]); }

        // Robust Customer Matching
        const cleanName = customerNameLine.trim().toLowerCase();
        let matchedCustomer = customers.find(c => c.name.toLowerCase() === cleanName);

        if (!matchedCustomer) {
            // Try starts with
            matchedCustomer = customers.find(c => c.name.toLowerCase().startsWith(cleanName));
        }
        if (!matchedCustomer && cleanName.length > 3) {
            // Try includes
            matchedCustomer = customers.find(c => cleanName.includes(c.name.toLowerCase()));
        }

        if (matchedCustomer) {
            setSelectedCustomerId(matchedCustomer.id);
        } else {
            console.log("No matching customer found for:", customerNameLine);
            setSelectedCustomerId('');
        }

        setBankDetails({
            bankName: inv.bankName || '',
            bankAddress: inv.bankAddress || '',
            accountNumber: inv.accountNumber || '',
            swiftCode: inv.swiftCode || '',
            routingNumber: inv.routingNumber || ''
        });

        setActiveTab('BLANK');
    };

    const handleAddItem = () => {
        setItems([...items, {
            id: `item_${Date.now()}`, description: '', customerDescription: '', hsCode: '',
            quantity: 0, unit: 'LBS', unitPrice: 0, amount: 0
        }]);
    };

    const handleRemoveItem = (id: string) => {
        setItems(items.filter(i => i.id !== id));
    };

    const updateItem = (id: string, field: keyof InvoiceLineItem, value: any) => {
        setItems(items.map(item => {
            if (item.id === id) {
                const updated = { ...item, [field]: value };
                if (field === 'quantity' || field === 'unitPrice') {
                    updated.amount = updated.quantity * updated.unitPrice;
                }
                return updated;
            }
            return item;
        }));
    };

    const handleAddContainer = () => {
        setContainers([...containers, { id: `cont_${Date.now()}`, container: '', seal: '' }]);
    };

    const handleRemoveContainer = (id: string) => {
        setContainers(containers.filter(c => c.id !== id));
    };

    const updateContainer = (id: string, field: keyof ContainerRow, value: string) => {
        setContainers(containers.map(c => c.id === id ? { ...c, [field]: value } : c));
    };

    const populateFromPL = async (pl: PackingList) => {
        // Set the PL as selected and add to local list if not already there
        setSelectedPL(pl);
        setLocalPackingLists(prev => {
            const exists = prev.some(p => p.id === pl.id);
            return exists ? prev : [pl, ...prev];
        });

        // Generate new invoice number for the incoming PL
        setInvoiceNumber(`INV-${Date.now().toString().slice(-6)}`);
        setTransportRef(pl.blNumber || '');
        setPlNumber(pl.plNumber || '');
        setSoNumber(pl.soNumber || ''); setSupplier(pl.supplier || '');

        // Logistics
        setNetWeight(pl.netWeight || '');
        setGrossWeight(pl.grossWeight || '');
        setTotalVolumes(pl.unitCount || '');

        const contList: ContainerRow[] = [];
        const cNums = pl.containerNumber ? pl.containerNumber.split(',').map(s => s.trim()) : [];
        const sNums = pl.sealNumber ? pl.sealNumber.split(',').map(s => s.trim()) : [];

        cNums.forEach((cn, idx) => {
            if (cn) {
                contList.push({ id: `cont_${Date.now()}_${idx}`, container: cn, seal: sNums[idx] || '' });
            }
        });
        setContainers(contList);

        // Auto-select Sales Order if soNumber matches
        if (pl.soNumber) {
            const matchedSO = salesOrders.find(so => so.orderNumber === pl.soNumber);
            if (matchedSO) {
                setSelectedSO(matchedSO);
                const cust = customers.find(c => c.id === matchedSO.customerId);
                if (cust) {
                    setSelectedCustomerId(cust.id);
                    setBillToName(cust.name);
                    setBillToAddress(`${cust.location || ''}\n${cust.city || ''}, ${cust.state || ''} ${cust.zip || ''}\n${cust.country || ''}`.trim());
                    setPaymentTerms(cust.paymentTerms || 'Net 30');
                }
            }
        } else {
            // Try to match consignee if no SO
            const matchedCustomer = customers.find(c => pl.consignee && c.name.toLowerCase().includes(pl.consignee.toLowerCase()));
            if (matchedCustomer) {
                setSelectedCustomerId(matchedCustomer.id);
                setBillToName(matchedCustomer.name);
                setBillToAddress(`${matchedCustomer.location || ''} ${matchedCustomer.city || ''} ${matchedCustomer.country || ''}`.trim());
                setPaymentTerms(matchedCustomer.paymentTerms || 'Net 30');
            } else {
                setBillToName(pl.consignee || '');
            }
        }

        try {
            // Ensure products are loaded for accurate description lookup
            let currentProducts = products;
            if (currentProducts.length === 0) {
                const client = getSupabaseClient();
                if (client) {
                    const { data } = await client.from('products').select('id, name, grade, category');
                    if (data) {
                        setProducts(data);
                        currentProducts = data;
                    }
                }
            }

            const plItems = JSON.parse(pl.items || '[]');
            console.log('[populateFromPL] PL Items:', plItems);
            console.log('[populateFromPL] Products loaded:', currentProducts.length);

            // Get container info from PL level
            const plContainerNos = pl.containerNumber ? pl.containerNumber.split(',').map(s => s.trim()).filter(s => s) : [];
            const plSealNos = pl.sealNumber ? pl.sealNumber.split(',').map(s => s.trim()).filter(s => s) : [];

            // Distribute items across containers (round-robin if multiple containers)
            const newItems: InvoiceLineItem[] = plItems.map((item: any, idx: number) => {
                const containerIndex = plContainerNos.length > 0 ? idx % plContainerNos.length : 0;

                // STRICT RESOLUTION LOGIC
                let productDescription = '';
                let resolvedProductId = item.productId || '';

                // 1. Live Lookup by ID (Authoritative)
                if (item.productId && currentProducts.length > 0) {
                    const product = currentProducts.find((p: any) => p.id === item.productId);
                    if (product) {
                        productDescription = product.grade ? `${product.name} (${product.grade})` : product.name;
                    }
                }

                // 2. Reverse Lookup by productName if no ID (Backwards Compatibility)
                if (!resolvedProductId && item.productName && currentProducts.length > 0) {
                    const product = currentProducts.find((p: any) => {
                        const expectedName = p.grade ? `${p.name} (${p.grade})` : p.name;
                        return expectedName === item.productName || p.name === item.productName;
                    });
                    if (product) {
                        resolvedProductId = product.id;
                        productDescription = product.grade ? `${product.name} (${product.grade})` : product.name;
                    }
                }

                // 3. Snapshot Fallback (System Name)
                if (!productDescription && item.productName) {
                    productDescription = item.productName;
                }

                // 4. OCR Fallback (Last Resort)
                if (!productDescription) {
                    productDescription = item.description || 'Product';
                }

                return {
                    ...item, // Preserve all original properties
                    id: `item_${Date.now()}_${idx}`,
                    productId: resolvedProductId, // Now includes reverse-lookup
                    description: productDescription,
                    customerDescription: item.customerDescription || '',
                    hsCode: item.hsCode || '',
                    quantity: Number(item.netLbs || item.quantity || 0),
                    unit: 'LBS',
                    unitPrice: Number(item.unitPrice || 0),
                    amount: Number(item.amount || 0),
                    // Assign container data from PL level
                    containerNo: plContainerNos[containerIndex] || '',
                    sealNo: plSealNos[containerIndex] || '',
                    grossLbs: Number(item.grossLbs || item.grossWeight || item.quantity || 0),
                    netLbs: Number(item.netLbs || item.netWeight || item.quantity || 0),
                    grossKg: Number(item.grossKg || (item.grossLbs || item.quantity || 0) * 0.453592),
                    netKg: Number(item.netKg || (item.netLbs || item.quantity || 0) * 0.453592),
                    volumes: Number(item.volumes || item.volume || 0)
                };
            });
            setItems(newItems);
        } catch (e) {
            console.error("Failed to parse PL items", e);
        }

        // Switch to the blank/editor view to show the populated data
        setActiveTab('BLANK');
    };

    const handleSelectSO = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const soId = e.target.value;
        const so = salesOrders.find(s => s.id === soId);
        setSelectedSO(so || null);

        if (so) {
            const cust = customers.find(c => c.id === so.customerId);
            if (cust) {
                setSelectedCustomerId(cust.id);
                setBillToName(cust.name);
                setBillToAddress(`${cust.location || ''}\n${cust.city || ''}, ${cust.state || ''} ${cust.zip || ''}\n${cust.country || ''}`.trim());
                setPaymentTerms(cust.paymentTerms || 'Net 30');
            }
        }
    };

    const handleSelectPLDropdown = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const plId = e.target.value;
        const pl = packingLists.find(p => p.id === plId);
        if (pl) {
            populateFromPL(pl);
        }
    };

    const handleCustomerSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const custId = e.target.value;
        setSelectedCustomerId(custId);
        const cust = customers.find(c => c.id === custId);
        if (cust) {
            setBillToName(cust.name);
            setBillToAddress(`${cust.location || ''}\n${cust.city || ''}, ${cust.state || ''} ${cust.zip || ''}\n${cust.country || ''}`.trim());
            setPaymentTerms(cust.paymentTerms);
        }
    };

    const handleBankSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const bankId = e.target.value;
        if (bankId === '_ADD_NEW_') {
            setShowAddBank(true);
            return;
        }
        setSelectedBankId(bankId);
        const bank = companyBanks.find(b => b.id === bankId);
        if (bank) {
            setBankDetails({
                bankName: bank.bankName,
                bankAddress: bank.bankAddress,
                accountNumber: bank.accountNumber,
                swiftCode: bank.swiftCode,
                routingNumber: bank.routingNumber
            });
        }
    };

    const handleSaveNewBank = async (e: React.FormEvent) => {
        e.preventDefault();
        const client = getSupabaseClient();
        if (!client) return;

        const newBank: BankProfile = {
            id: `BANK_${Date.now()}`,
            bankName: bankDetails.bankName,
            bankAddress: bankDetails.bankAddress,
            accountNumber: bankDetails.accountNumber,
            swiftCode: bankDetails.swiftCode,
            routingNumber: bankDetails.routingNumber
        };

        const { error } = await client.from('customer_banks').insert({
            ...newBank,
            // Even though table says 'customer_banks', we use it to store Company banks too 
            // by using the companyId context. 
            // We set customerId to a placeholder or null if schema allows, 
            // but for safety in this current schema, we might link it to the selected customer 
            // IF the user wants. BUT the requirement says these are SHIPPER/COMPANY banks.
            // So we use companyId heavily.
            customerId: selectedCustomerId || 'COMPANY_GENERAL', // Fallback if no customer selected
            companyId: currentCompanyId === 'ALL' ? 'ALL' : currentCompanyId,
            createdAt: new Date().toISOString()
        });

        if (!error) {
            setCompanyBanks([...companyBanks, newBank]);
            setSelectedBankId(newBank.id);
            setShowAddBank(false);
        } else {
            alert('Failed to save bank profile: ' + error.message);
        }
    };

    const handleDeleteInvoice = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (window.confirm('Are you sure you want to delete this invoice? This action cannot be undone.')) {
            const client = getSupabaseClient();
            if (!client) return;

            // 1. Get the invoice to find the Booking # (transportRef)
            const { data: invToDelete } = await client.from('invoices').select('transportRef').eq('id', id).single();
            const bookingNum = invToDelete?.transportRef;

            // 2. If Booking # exists, set status back to AVAILABLE
            if (bookingNum) {
                await client.from('bookings').update({ status: 'AVAILABLE' }).eq('bookingNumber', bookingNum);
            }

            // 3. Delete the invoice using parent callback (ensures UI sync)
            const success = await onDelete(id);

            if (success) {
                // Update local state to remove deleted invoice - no page reload needed
                setLocalInvoices(prev => prev.filter(inv => inv.id !== id));

                // Stay on the SAVED tab to show updated list
                setActiveTab('SAVED');

                alert('Invoice deleted successfully and Booking released.');
            } else {
                alert('Failed to delete invoice. Please try again.');
            }
        }
    };

    const handleEmailInvoice = (inv: Invoice, e: React.MouseEvent) => {
        e.stopPropagation();
        const subject = `Invoice ${inv.invoiceNumber} from ${inv.shipperName}`;
        const body = `Dear Customer,\n\nPlease find attached Invoice ${inv.invoiceNumber}.\n\nBest regards,\n${inv.shipperName}`;
        window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    };

    // --- OCR / Upload Logic for Saved Invoices ---
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsAnalyzing(true);
        try {
            const reader = new FileReader();
            reader.onload = async (event) => {
                const base64Data = (event.target?.result as string).split(',')[1];
                const mimeType = file.type;

                // Prompt tailored for Invoice/PL Extraction
                const prompt = `
                    Analyze this document (Packing List or Commercial Invoice).
                    Extract the following details into a JSON format:
                    
                    1. "invoiceNumber": Look for "Invoice No", "Inv No".
                    2. "invoiceDate": Date of document (ISO YYYY-MM-DD).
                    3. "soNumber": Sales Order or PO Number.
                    4. "bookingNumber": Booking Ref or Transport Ref.
                    5. "shipper": Supplier or Shipper Name.
                    6. "consignee": Sold To / Ship To / Consignee Name.
                    7. "items": Array of line items with:
                       - "description": Product description
                       - "quantity": Numeric quantity
                       - "unitPrice": Unit Price if found (number)
                       - "amount": Total Amount if found (number)
                       - "weight": Net Weight if found (string with unit)
                    
                    Return JSON:
                    {
                        "invoiceNumber": "string",
                        "invoiceDate": "string",
                        "soNumber": "string",
                        "bookingNumber": "string",
                        "shipper": "string",
                        "consignee": "string",
                        "items": []
                    }
                `;

                const result = await analyzeDocument(base64Data, mimeType, prompt);
                const cleanJson = result.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
                const parsedData = JSON.parse(cleanJson);

                // Populate Form
                setInvoiceNumber(parsedData.invoiceNumber || `INV-${Date.now().toString().slice(-6)}`);
                setInvoiceDate(parsedData.invoiceDate || new Date().toISOString().split('T')[0]);
                setSoNumber(parsedData.soNumber || '');
                setTransportRef(parsedData.bookingNumber || '');
                setShipperName(parsedData.shipper || defaultShipperName);

                // Consignee Logic
                const matchedCustomer = customers.find(c => c.name.toLowerCase().includes((parsedData.consignee || '').toLowerCase()));
                if (matchedCustomer) {
                    setSelectedCustomerId(matchedCustomer.id);
                    setBillToName(matchedCustomer.name);
                    setBillToAddress(`${matchedCustomer.location || ''} ${matchedCustomer.city || ''} ${matchedCustomer.country || ''}`.trim());
                } else {
                    setBillToName(parsedData.consignee || '');
                }

                const newItems = (parsedData.items || []).map((item: any) => ({
                    id: Math.random().toString(36).substr(2, 9),
                    description: item.description || 'Item',
                    customerDescription: '',
                    hsCode: '',
                    quantity: Number(item.quantity) || 0,
                    unit: 'PCS', // Default
                    unitPrice: Number(item.unitPrice) || 0,
                    amount: (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)
                }));
                setItems(newItems);

                // Switch to Create/Edit View
                setActiveTab('BLANK');
                alert("Document analyzed! Please review details and save.");
            };
            reader.readAsDataURL(file);

        } catch (error) {
            console.error("OCR Error:", error);
            alert("Failed to analyze document.");
        } finally {
            setIsAnalyzing(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleSave = async () => {
        if (!billToName || items.length === 0) {
            alert("Please fill in Bill To and add at least one item.");
            return;
        }

        setIsSaving(true);
        const client = getSupabaseClient();

        if (selectedCustomerId && items.length > 0) {
            if (client) {
                const KG_TO_LBS = 2.20462;

                const uniqueDescriptions = new Map<string, InvoiceLineItem>();
                items.forEach(item => {
                    if (item.description && item.description.trim() !== '') {
                        uniqueDescriptions.set(item.description, item);
                    }
                });

                const descriptionUpserts = Array.from(uniqueDescriptions.values()).map(item => ({
                    customer_id: selectedCustomerId,
                    original_description: item.description,
                    customer_description: item.customerDescription,
                    hs_code: item.hsCode,
                    unit_price_lbs: item.unitPrice,
                    unit_price_kgs: item.unitPrice * KG_TO_LBS
                }));

                if (descriptionUpserts.length > 0) {
                    const { error } = await client
                        .from('costumer_description')
                        .upsert(descriptionUpserts, { onConflict: 'customer_id, original_description' });

                    if (error) {
                        console.error("Error saving customer descriptions:", error);
                        // Non-blocking error
                    }
                }
            }
        }

        const invoiceCore = {
            companyId: currentCompanyId === 'ALL' ? 'ALL' : currentCompanyId,
            invoiceNumber, invoiceDate, shipperName,
            soldTo: `${billToName}\n${billToAddress}`,
            paymentTerms, transportRef,
            freightTerms: JSON.stringify(containers),
            items: JSON.stringify(items),
            grossWeight, netWeight, totalQuantity: totalVolumes,
            subtotal, totalAmount, currency,
            bankName: bankDetails.bankName,
            bankAddress: bankDetails.bankAddress,
            swiftCode: bankDetails.swiftCode,
            routingNumber: bankDetails.routingNumber,
            accountNumber: bankDetails.accountNumber,
            shipperAddress: '', shipTo: '', incoterm: incoterm || '',
            dateOrder: '', customerPo: '', carrier: '',
            tareWeight: '', remitTo: '', originalDocument: '',
            supplier: supplier || '',
            date: '',
            plNumber: plNumber || '', // Save PL Number
            soNumber: soNumber || '',   // Save SO Number
            pod: pod || ''
        };

        if (editingId) {
            const originalInvoice = invoices.find(i => i.id === editingId);
            const updatedInvoice: Invoice = {
                ...invoiceCore,
                id: editingId,
                createdAt: originalInvoice?.createdAt || new Date().toISOString()
            };
            onUpdate(updatedInvoice);
        } else {
            const newInvoice: Invoice = {
                ...invoiceCore,
                id: `INV${Date.now()}`,
                createdAt: new Date().toISOString()
            };
            onSave(newInvoice);
            // Fire workflow event for new invoice
            workflowEngine.emit({
                type: 'INVOICE_CREATED',
                entityType: 'invoice',
                entityId: newInvoice.id,
                data: newInvoice as any,
                companyId: newInvoice.companyId,
                timestamp: new Date().toISOString(),
            });
        }

        // Update Booking Status to SHIPPED if applicable
        if (transportRef && client) {
            try {
                // transportRef usually holds the Booking Number or BL Number
                const { error: bookingError } = await client
                    .from('bookings')
                    .update({ status: 'SHIPPED' })
                    .eq('bookingNumber', transportRef);

                if (bookingError) {
                    console.error("Failed to update booking status:", bookingError);
                }
            } catch (err) {
                console.error("Error updating booking status:", err);
            }
        }

        setIsSaving(false);
        resetForm();
        setActiveTab('BLANK');
        alert("Invoice Saved Successfully!");
    };

    const generatePDF = (returnBlob = false, overrideData: any = null) => {
        const doc = new jsPDF();

        // Use override data or fallback to state
        const d_invoiceNumber = overrideData?.invoiceNumber || invoiceNumber;
        const d_invoiceDate = overrideData?.invoiceDate || invoiceDate;
        const d_transportRef = overrideData?.transportRef || transportRef;
        const d_shipperName = overrideData?.shipperName || shipperName;
        const d_billToName = overrideData?.billToName || billToName;
        const d_billToAddress = overrideData?.billToAddress || billToAddress;
        const d_items: InvoiceLineItem[] = overrideData?.items || items;
        const d_containers: ContainerRow[] = overrideData?.containers || containers;
        const d_netWeight = overrideData?.netWeight || netWeight;
        const d_grossWeight = overrideData?.grossWeight || grossWeight;
        const d_totalVolumes = overrideData?.totalVolumes || totalVolumes;
        const d_bankDetails = overrideData?.bankDetails || bankDetails;
        const d_pod = overrideData?.pod || pod;
        const d_subtotal = overrideData ? d_items.reduce((s: number, i: any) => s + i.amount, 0) : subtotal;
        const d_totalAmount = d_subtotal;

        const company = availableCompanies.find(c => c.id === currentCompanyId);

        // --- LOGO (LEFT) ---
        if (companyLogoUrl) {
            try {
                const imgProps = doc.getImageProperties(companyLogoUrl);
                const maxWidth = 75; const maxHeight = 37.5;
                let width = imgProps.width; let height = imgProps.height;
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width *= ratio; height *= ratio;
                doc.addImage(companyLogoUrl, 14, 10, width, height);
            } catch (e) {
                doc.setFontSize(18).setFont(undefined, 'bold').text(d_shipperName, 14, 25);
                console.error("Error adding logo to PDF", e);
            }
        } else {
            doc.setFontSize(18).setFont(undefined, 'bold').text(d_shipperName, 14, 25);
        }

        // --- COMPANY INFO / SHIPPER (TOP RIGHT) ---
        doc.setFontSize(9);
        doc.setTextColor(44, 62, 80);
        doc.setFont(undefined, 'bold');

        const companyName = company?.name || d_shipperName;
        const addressLine1 = company?.address || "";
        const addressLine2 = (company?.city && company?.state) ? `${company.city}, ${company.state} ${company.zip || ''}` : "";

        let yPos = 15;
        const rightX = doc.internal.pageSize.width - 14;

        doc.text(companyName, rightX, yPos, { align: 'right' });
        doc.setFont(undefined, 'normal');
        yPos += 5;
        doc.text(addressLine1, rightX, yPos, { align: 'right' });
        yPos += 5;
        doc.text(addressLine2, rightX, yPos, { align: 'right' });

        // --- HEADER (below logo) ---
        doc.setFontSize(22);
        doc.setTextColor(44, 62, 80);
        doc.text("INVOICE", doc.internal.pageSize.width - 14, 45, { align: 'right' });

        doc.setFontSize(10);
        doc.setTextColor(100);

        // Header Split Columns
        const leftColX = 14;
        const rightColX = 110;
        let leftY = 55;
        let rightY = 55;

        // Message: Left Column
        doc.text(`Invoice #: ${d_invoiceNumber}`, leftColX, leftY); leftY += 5;
        doc.text(`Date: ${d_invoiceDate}`, leftColX, leftY); leftY += 5;
        if (d_transportRef) { doc.text(`Booking #: ${d_transportRef}`, leftColX, leftY); leftY += 5; }

        // Message: Right Column
        if (paymentTerms) { doc.text(`Payment Terms: ${paymentTerms}`, rightColX, rightY); rightY += 5; }
        if (incoterm) { doc.text(`Incoterms: ${incoterm}`, rightColX, rightY); rightY += 5; }
        if (d_pod) { doc.text(`POD: ${d_pod}`, rightColX, rightY); rightY += 5; }

        // --- CONSIGNEE ---
        let consigneeY = Math.max(leftY, rightY) + 10;
        doc.setFontSize(12);
        doc.setTextColor(0);
        doc.text("Consignee:", 14, consigneeY);
        consigneeY += 7;

        doc.setFontSize(10);
        doc.text(d_billToName, 14, consigneeY);
        consigneeY += 5;

        const customer = customers.find(c => c.name === d_billToName);
        if (customer && customer.taxId) {
            doc.text(`TAX ID: ${customer.taxId}`, 14, consigneeY);
            consigneeY += 5;
        }
        const splitAddress = doc.splitTextToSize(d_billToAddress, 80);
        doc.text(splitAddress, 14, consigneeY);

        const tableStartY = consigneeY + (splitAddress.length * 5) + 10;

        autoTable(doc, {
            startY: tableStartY,
            head: [['Description', 'HS Code', 'Qty (KGS)', 'Price ($/KGS)', 'Amount ($)']],
            body: d_items.map(item => {
                const qtyKg = item.quantity * 0.453592;
                const priceKg = item.unitPrice * 2.20462;
                return [
                    item.customerDescription || item.description,
                    item.hsCode || '',
                    qtyKg.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                    `$${priceKg.toFixed(4)}`,
                    `$${item.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                ];
            }),
            theme: 'striped',
            headStyles: { fillColor: [41, 128, 185] },
            styles: { fontSize: 9, cellPadding: 3, overflow: 'linebreak' },
            columnStyles: {
                0: { cellWidth: 80 },
                1: { cellWidth: 25 },
                2: { cellWidth: 25, halign: 'right' },
                3: { cellWidth: 25, halign: 'right' },
                4: { cellWidth: 25, halign: 'right' }
            }
        });

        let finalY = (doc as any).lastAutoTable.finalY + 10;

        if (finalY > 220) { doc.addPage(); finalY = 20; }
        const startY = finalY;

        doc.setFontSize(9);
        doc.setTextColor(0);

        const netWeightKgs = (parseFloat((d_netWeight || '0').replace(/,/g, '')) || 0) * 0.453592;
        const grossWeightKgs = (parseFloat((d_grossWeight || '0').replace(/,/g, '')) || 0) * 0.453592;

        doc.setFont(undefined, 'bold');
        doc.text("Net weight (KGS):", 14, finalY);
        doc.setFont(undefined, 'normal');
        doc.text(netWeightKgs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), 47, finalY);

        doc.setFont(undefined, 'bold');
        doc.text("Gross weight (KGS):", 14, finalY + 5);
        doc.setFont(undefined, 'normal');
        doc.text(grossWeightKgs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), 47, finalY + 5);

        doc.setFont(undefined, 'bold');
        doc.text("Volumes:", 14, finalY + 10);
        doc.setFont(undefined, 'normal');
        doc.text(d_totalVolumes ? `${d_totalVolumes}` : '-', 45, finalY + 10);

        let containerY = finalY + 20;

        if (d_containers.length > 0) {
            doc.setFont(undefined, 'bold');
            doc.text("CONTAINER", 14, containerY);
            doc.text("SEAL", 50, containerY);

            doc.setFont(undefined, 'normal');
            containerY += 5;
            d_containers.forEach(c => {
                doc.text(c.container, 14, containerY);
                doc.text(c.seal, 50, containerY);
                containerY += 5;
            });
        }

        let totalsY = startY;
        const labelX = 140;
        const valueX = 195;

        doc.setFontSize(10);

        doc.setFont(undefined, 'normal');
        doc.text("SUBTOTAL", labelX, totalsY);
        doc.text(d_subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), valueX, totalsY, { align: 'right' });

        totalsY += 6;
        doc.text("TAX", labelX, totalsY);
        doc.text("0.00", valueX, totalsY, { align: 'right' });

        totalsY += 6;
        doc.setFont(undefined, 'bold');
        doc.text("TOTAL", labelX, totalsY);
        doc.text(d_totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), valueX, totalsY, { align: 'right' });

        let footerY = Math.max(containerY, totalsY) + 20;
        if (footerY > 270) { doc.addPage(); footerY = 20; }

        doc.setFontSize(10);
        doc.setTextColor(0);
        doc.setFont(undefined, 'bold');
        doc.text("Payment Instructions:", 14, footerY);
        doc.setFont(undefined, 'normal');
        doc.setFontSize(9);

        let paymentY = footerY + 5;
        doc.text(`Bank: ${d_bankDetails.bankName}`, 14, paymentY);
        paymentY += 5;
        if (d_bankDetails.bankAddress) {
            const addressLines = doc.splitTextToSize(d_bankDetails.bankAddress, 80);
            doc.text(addressLines, 14, paymentY);
            paymentY += addressLines.length * 5;
        }
        doc.text(`Account: ${d_bankDetails.accountNumber}`, 14, paymentY);
        paymentY += 5;
        if (d_bankDetails.swiftCode) {
            doc.text(`SWIFT: ${d_bankDetails.swiftCode}`, 14, paymentY);
        }


        if (returnBlob) {
            const blob = doc.output('blob');
            const url = URL.createObjectURL(blob);
            return { url, blob };
        }
        // Generate Blob for Preview
        const blob = doc.output('blob');
        const url = URL.createObjectURL(blob);
        const downloadFn = () => doc.save(`${d_invoiceNumber}_EXPORT.pdf`);
        openPreview(url, `Invoice Export - ${d_invoiceNumber}`, `${d_invoiceNumber}_EXPORT.pdf`, blob, downloadFn);
    };

    const generateUSAPDF = (returnBlob = false, overrideData: any = null) => {
        const doc = new jsPDF();

        // Use override data or fallback to state
        const d_invoiceNumber = overrideData?.invoiceNumber || invoiceNumber;
        const d_invoiceDate = overrideData?.invoiceDate || invoiceDate;
        const d_transportRef = overrideData?.transportRef || transportRef;
        const d_shipperName = overrideData?.shipperName || shipperName;
        const d_billToName = overrideData?.billToName || billToName;
        const d_billToAddress = overrideData?.billToAddress || billToAddress;
        const d_items: InvoiceLineItem[] = overrideData?.items || items;
        const d_containers: ContainerRow[] = overrideData?.containers || containers;
        const d_netWeight = overrideData?.netWeight || netWeight;
        const d_grossWeight = overrideData?.grossWeight || grossWeight;
        const d_totalVolumes = overrideData?.totalVolumes || totalVolumes;
        const d_bankDetails = overrideData?.bankDetails || bankDetails;
        const d_subtotal = overrideData ? d_items.reduce((s: number, i: any) => s + i.amount, 0) : subtotal;
        const d_totalAmount = d_subtotal;

        const company = availableCompanies.find(c => c.id === currentCompanyId);

        // --- LOGO (LEFT) ---
        if (companyLogoUrl) {
            try {
                const imgProps = doc.getImageProperties(companyLogoUrl);
                const maxWidth = 75; const maxHeight = 37.5;
                let width = imgProps.width; let height = imgProps.height;
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width *= ratio; height *= ratio;
                doc.addImage(companyLogoUrl, 14, 10, width, height);
            } catch (e) {
                doc.setFontSize(18).setFont(undefined, 'bold').text(shipperName, 14, 25);
                console.error("Error adding logo to PDF", e);
            }
        } else {
            doc.setFontSize(18).setFont(undefined, 'bold').text(shipperName, 14, 25);
        }

        // --- COMPANY INFO / SHIPPER (TOP RIGHT) ---
        doc.setFontSize(9);
        doc.setTextColor(44, 62, 80);
        doc.setFont(undefined, 'bold');
        const companyName = company?.name || shipperName;
        const addressLine1 = company?.address || "";
        const addressLine2 = (company?.city && company?.state) ? `${company.city}, ${company.state} ${company.zip || ''}` : "";

        let yPos = 15;
        const rightX = doc.internal.pageSize.width - 14;

        doc.text(companyName, rightX, yPos, { align: 'right' });
        doc.setFont(undefined, 'normal');
        yPos += 5;
        doc.text(addressLine1, rightX, yPos, { align: 'right' });
        yPos += 5;
        doc.text(addressLine2, rightX, yPos, { align: 'right' });

        // --- HEADER (below logo) ---
        doc.setFontSize(22);
        doc.setTextColor(44, 62, 80);
        doc.text("INVOICE", doc.internal.pageSize.width - 14, 45, { align: 'right' });

        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`Invoice #: ${invoiceNumber}`, 14, 52);
        doc.text(`Date: ${invoiceDate}`, 14, 57);
        if (transportRef) doc.text(`Ref: ${transportRef}`, 14, 62);
        if (paymentTerms) doc.text(`Payment Terms: ${paymentTerms}`, 14, 67);
        if (incoterm) doc.text(`Incoterms: ${incoterm}`, 14, 72);

        // --- CONSIGNEE ---
        let consigneeY = 70;
        doc.setFontSize(12);
        doc.setTextColor(0);
        doc.text("Consignee:", 14, consigneeY); // Changed to match
        consigneeY += 7;

        doc.setFontSize(10);
        doc.text(billToName, 14, consigneeY);
        consigneeY += 5;

        const customer = customers.find(c => c.name === billToName);
        if (customer && customer.taxId) {
            doc.text(`TAX ID: ${customer.taxId}`, 14, consigneeY);
            consigneeY += 5;
        }
        const splitAddress = doc.splitTextToSize(billToAddress, 80);
        doc.text(splitAddress, 14, consigneeY);

        const tableStartY = consigneeY + (splitAddress.length * 5) + 10;

        autoTable(doc, {
            startY: tableStartY,
            head: [['Description', 'HS Code', 'Qty (LBS)', 'Price ($/LBS)', 'Amount ($)']],
            body: items.map(item => [
                item.customerDescription || item.description,
                item.hsCode || '',
                item.quantity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                `$${item.unitPrice.toFixed(4)}`,
                `$${item.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            ]),
            theme: 'striped',
            headStyles: { fillColor: [41, 128, 185] },
        });

        let finalY = (doc as any).lastAutoTable.finalY + 10;

        if (finalY > 220) { doc.addPage(); finalY = 20; }
        const startY = finalY;

        doc.setFontSize(9);
        doc.setTextColor(0);

        const netWeightLbs = d_netWeight || '-';
        const grossWeightLbs = d_grossWeight || '-';

        doc.setFont(undefined, 'bold');
        doc.text("Net weight (LBS):", 14, finalY);
        doc.setFont(undefined, 'normal');
        doc.text(netWeightLbs, 47, finalY);

        doc.setFont(undefined, 'bold');
        doc.text("Gross weight (LBS):", 14, finalY + 5);
        doc.setFont(undefined, 'normal');
        doc.text(grossWeightLbs, 47, finalY + 5);

        doc.setFont(undefined, 'bold');
        doc.text("Volumes:", 14, finalY + 10);
        doc.setFont(undefined, 'normal');
        doc.text(totalVolumes ? `${totalVolumes}` : '-', 45, finalY + 10);

        let containerY = finalY + 20;

        if (containers.length > 0) {
            doc.setFont(undefined, 'bold');
            doc.text("CONTAINER", 14, containerY);
            doc.text("SEAL", 50, containerY);

            doc.setFont(undefined, 'normal');
            containerY += 5;
            containers.forEach(c => {
                doc.text(c.container, 14, containerY);
                doc.text(c.seal, 50, containerY);
                containerY += 5;
            });
        }

        let totalsY = startY;
        const labelX = 140;
        const valueX = 195;

        doc.setFontSize(10);

        doc.setFont(undefined, 'normal');
        doc.text("SUBTOTAL", labelX, totalsY);
        doc.text(subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), valueX, totalsY, { align: 'right' });

        totalsY += 6;
        doc.text("TAX", labelX, totalsY);
        doc.text("0.00", valueX, totalsY, { align: 'right' });

        totalsY += 6;
        doc.setFont(undefined, 'bold');
        doc.text("TOTAL", labelX, totalsY);
        doc.text(totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), valueX, totalsY, { align: 'right' });

        let footerY = Math.max(containerY, totalsY) + 20;
        if (footerY > 270) { doc.addPage(); footerY = 20; }

        doc.setFontSize(10);
        doc.setTextColor(0);
        doc.setFont(undefined, 'bold');
        doc.text("Payment Instructions:", 14, footerY);
        doc.setFont(undefined, 'normal');
        doc.setFontSize(9);

        let paymentY = footerY + 5;
        doc.text(`Bank: ${d_bankDetails.bankName}`, 14, paymentY);
        paymentY += 5;
        if (d_bankDetails.bankAddress) {
            const addressLines = doc.splitTextToSize(d_bankDetails.bankAddress, 80);
            doc.text(addressLines, 14, paymentY);
            paymentY += addressLines.length * 5;
        }
        doc.text(`Account: ${d_bankDetails.accountNumber}`, 14, paymentY);
        paymentY += 5;
        if (d_bankDetails.swiftCode) {
            doc.text(`SWIFT: ${d_bankDetails.swiftCode}`, 14, paymentY);
        }

        if (returnBlob) {
            const blob = doc.output('blob');
            const url = URL.createObjectURL(blob);
            return { url, blob };
        }
        // Generate Blob for Preview
        const blob = doc.output('blob');
        const url = URL.createObjectURL(blob);
        const downloadFn = () => doc.save(`${d_invoiceNumber}_USA.pdf`);
        openPreview(url, `Invoice USA - ${d_invoiceNumber}`, `${d_invoiceNumber}_USA.pdf`, blob, downloadFn);
    };

    const generatePackingListUSA = (returnBlob = false, overrideData: any = null) => {
        const doc = new jsPDF();

        // Resolve Data Source
        const d = overrideData || {
            invoiceNumber, invoiceDate, shipperName,
            billToName, billToAddress,
            transportRef, items, containers,
            grossWeight, netWeight, totalVolumes,
            companyId: currentCompanyId
        };

        // Handle potentially missing fields in overrideData
        // If overrideData is raw invoice, some fields might need mapping (e.g. soldTo -> billToName)
        // But for now assuming we pass correct structure or keys match.

        const finalCompanyId = d.companyId || currentCompanyId;
        const company = availableCompanies.find(c => c.id === finalCompanyId);

        // --- LOGO ---
        if (companyLogoUrl) {
            try {
                const imgProps = doc.getImageProperties(companyLogoUrl);
                const maxWidth = 75; const maxHeight = 37.5;
                let width = imgProps.width; let height = imgProps.height;
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width *= ratio; height *= ratio;
                doc.addImage(companyLogoUrl, 14, 10, width, height);
            } catch (e) {
                doc.setFontSize(18).setFont(undefined, 'bold').text(d.shipperName || 'EC4 ENTERPRISES', 14, 25);
            }
        } else {
            doc.setFontSize(18).setFont(undefined, 'bold').text(d.shipperName || 'EC4 ENTERPRISES', 14, 25);
        }

        // --- SHIPPER INFO ---
        doc.setFontSize(9);
        doc.setTextColor(44, 62, 80);
        doc.setFont(undefined, 'bold');
        const companyName = company?.name || d.shipperName;
        const addressLine1 = company?.address || "";
        const addressLine2 = (company?.city && company?.state) ? `${company.city}, ${company.state} ${company.zip || ''}` : "";

        let yPos = 15;
        const rightX = doc.internal.pageSize.width - 14;
        doc.text(companyName, rightX, yPos, { align: 'right' });
        doc.setFont(undefined, 'normal');
        yPos += 5;
        doc.text(addressLine1, rightX, yPos, { align: 'right' });
        yPos += 5;
        doc.text(addressLine2, rightX, yPos, { align: 'right' });

        // --- HEADER ---
        doc.setFontSize(22);
        doc.setTextColor(44, 62, 80);
        doc.text("PACKING LIST", doc.internal.pageSize.width - 14, 45, { align: 'right' });

        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`Invoice #: ${d.invoiceNumber}`, 14, 52);
        doc.text(`Date: ${d.invoiceDate}`, 14, 57);
        if (d.transportRef) doc.text(`Ref: ${d.transportRef}`, 14, 62);

        // --- CONSIGNEE ---
        let consigneeY = 70;
        doc.setFontSize(12);
        doc.setTextColor(0);
        doc.text("Consignee:", 14, consigneeY);
        consigneeY += 7;

        doc.setFontSize(10);
        doc.text(d.billToName || '', 14, consigneeY);
        consigneeY += 5;
        const splitAddress = doc.splitTextToSize(d.billToAddress || '', 80);
        doc.text(splitAddress, 14, consigneeY);

        const tableStartY = consigneeY + (splitAddress.length * 5) + 10;

        // --- ITEMS TABLE (No Prices) ---
        autoTable(doc, {
            startY: tableStartY,
            head: [['Description', 'HS Code', 'Qty (LBS)']],
            body: (d.items || []).map((item: any) => [
                item.customerDescription || item.description,
                item.hsCode || '',
                Number(item.quantity).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            ]),
            theme: 'striped',
            headStyles: { fillColor: [41, 128, 185] },
        });

        let finalY = (doc as any).lastAutoTable.finalY + 10;
        if (finalY > 220) { doc.addPage(); finalY = 20; }

        // --- WEIGHTS & VOLUMES ---
        doc.setFontSize(9);
        doc.setTextColor(0);

        doc.setFont(undefined, 'bold');
        doc.text("Net weight (LBS):", 14, finalY);
        doc.setFont(undefined, 'normal');
        doc.text(d.netWeight || '-', 47, finalY);

        doc.setFont(undefined, 'bold');
        doc.text("Gross weight (LBS):", 14, finalY + 5);
        doc.setFont(undefined, 'normal');
        doc.text(d.grossWeight || '-', 47, finalY + 5);

        doc.setFont(undefined, 'bold');
        doc.text("Volumes:", 14, finalY + 10);
        doc.setFont(undefined, 'normal');
        doc.text(d.totalVolumes ? `${d.totalVolumes}` : '-', 45, finalY + 10);

        let containerY = finalY + 20;

        // --- CONTAINERS ---
        const finalContainers = d.containers || [];
        if (finalContainers.length > 0) {
            doc.setFont(undefined, 'bold');
            doc.text("CONTAINER", 14, containerY);
            doc.text("SEAL", 50, containerY);
            doc.setFont(undefined, 'normal');
            containerY += 5;
            finalContainers.forEach((c: any) => {
                doc.text(c.container, 14, containerY);
                doc.text(c.seal, 50, containerY);
                containerY += 5;
            });
        }

        // --- RESUME PER CONTAINER ---
        // Use containers array and distribute total weights evenly
        const totalGrossLbs = parseFloat(String(d.grossWeight || '').replace(/,/g, '')) || 0;
        const totalNetLbs = parseFloat(String(d.netWeight || '').replace(/,/g, '')) || 0;
        const totalGrossKg = totalGrossLbs * 0.453592;
        const totalNetKg = totalNetLbs * 0.453592;
        const totalVols = parseFloat(String(d.totalVolumes || '')) || 0;

        const numContainers = finalContainers.length || 1;

        const resumeBody = finalContainers.map((c: any) => [
            c.container || 'N/A',
            c.seal || '',
            (totalGrossLbs / numContainers).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            (totalNetLbs / numContainers).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            (totalGrossKg / numContainers).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            (totalNetKg / numContainers).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            Math.round(totalVols / numContainers).toLocaleString()
        ]);

        // Calculate Totals Row
        const totalStats = {
            grossLbs: totalGrossLbs,
            netLbs: totalNetLbs,
            grossKg: totalGrossKg,
            netKg: totalNetKg,
            volumes: totalVols
        };

        resumeBody.push([
            'TOTALS',
            '',
            totalStats.grossLbs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            totalStats.netLbs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            totalStats.grossKg.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            totalStats.netKg.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            totalStats.volumes.toLocaleString()
        ]);

        if (containerY > 230) { doc.addPage(); containerY = 20; }
        else { containerY += 10; } // Spacing

        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text("RESUME PER CONTAINER", 14, containerY);

        autoTable(doc, {
            startY: containerY + 2,
            head: [['CONTAINER NO.', 'SEAL NO.', 'GROSS WT (LBS)', 'NET WT (LBS)', 'GROSS WT (KG)', 'NET WT (KG)', 'VOLUMES']],
            body: resumeBody,
            theme: 'plain',
            headStyles: {
                fillColor: [241, 245, 249],
                textColor: [71, 85, 105],
                fontSize: 7,
                fontStyle: 'bold',
                halign: 'center'
            },
            bodyStyles: {
                fontSize: 7,
                textColor: [51, 65, 85],
                halign: 'center'
            },
            columnStyles: {
                0: { halign: 'left', fontStyle: 'bold' }, // Container No
                1: { halign: 'left' }  // Seal No
            },
            didParseCell: (data) => {
                // Style the TOTALS row
                if (data.row.index === resumeBody.length - 1) {
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.fillColor = [241, 245, 249];
                }
            }
        });

        if (returnBlob) {
            const blob = doc.output('blob');
            const url = URL.createObjectURL(blob);
            return { url, blob };
        }
        // Generate Blob for Preview
        const blob = doc.output('blob');
        const url = URL.createObjectURL(blob);
        const downloadFn = () => doc.save(`${d.invoiceNumber}_PL_USA.pdf`);
        openPreview(url, `Packing List USA - ${d.invoiceNumber}`, `${d.invoiceNumber}_PL_USA.pdf`, blob, downloadFn);
    };

    const generatePackingListExport = (returnBlob = false) => {
        const doc = new jsPDF();

        const company = availableCompanies.find(c => c.id === currentCompanyId);

        // --- LOGO ---
        if (companyLogoUrl) {
            try {
                const imgProps = doc.getImageProperties(companyLogoUrl);
                const maxWidth = 75; const maxHeight = 37.5;
                let width = imgProps.width; let height = imgProps.height;
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width *= ratio; height *= ratio;
                doc.addImage(companyLogoUrl, 14, 10, width, height);
            } catch (e) {
                doc.setFontSize(18).setFont(undefined, 'bold').text(shipperName, 14, 25);
            }
        } else {
            doc.setFontSize(18).setFont(undefined, 'bold').text(shipperName, 14, 25);
        }

        // --- SHIPPER INFO ---
        doc.setFontSize(9);
        doc.setTextColor(44, 62, 80);
        doc.setFont(undefined, 'bold');
        const companyName = company?.name || shipperName;
        const addressLine1 = company?.address || "";
        const addressLine2 = (company?.city && company?.state) ? `${company.city}, ${company.state} ${company.zip || ''}` : "";

        let yPos = 15;
        const rightX = doc.internal.pageSize.width - 14;
        doc.text(companyName, rightX, yPos, { align: 'right' });
        doc.setFont(undefined, 'normal');
        yPos += 5;
        doc.text(addressLine1, rightX, yPos, { align: 'right' });
        yPos += 5;
        doc.text(addressLine2, rightX, yPos, { align: 'right' });

        // --- HEADER ---
        doc.setFontSize(22);
        doc.setTextColor(44, 62, 80);
        doc.text("PACKING LIST", doc.internal.pageSize.width - 14, 45, { align: 'right' });

        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`Invoice #: ${invoiceNumber}`, 14, 52);
        doc.text(`Date: ${invoiceDate}`, 14, 57);
        if (transportRef) doc.text(`Ref: ${transportRef}`, 14, 62);

        // --- CONSIGNEE ---
        let consigneeY = 70;
        doc.setFontSize(12);
        doc.setTextColor(0);
        doc.text("Consignee:", 14, consigneeY);
        consigneeY += 7;

        doc.setFontSize(10);
        doc.text(billToName, 14, consigneeY);
        consigneeY += 5;
        const splitAddress = doc.splitTextToSize(billToAddress, 80);
        doc.text(splitAddress, 14, consigneeY);

        const tableStartY = consigneeY + (splitAddress.length * 5) + 10;

        // --- ITEMS TABLE (Metric, No Prices) ---
        autoTable(doc, {
            startY: tableStartY,
            head: [['Description', 'HS Code', 'Qty (KGS)']],
            body: items.map(item => {
                const qtyKg = item.quantity * 0.453592;
                return [
                    item.customerDescription || item.description,
                    item.hsCode || '',
                    qtyKg.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                ];
            }),
            theme: 'striped',
            headStyles: { fillColor: [41, 128, 185] },
        });

        let finalY = (doc as any).lastAutoTable.finalY + 10;
        if (finalY > 220) { doc.addPage(); finalY = 20; }

        // --- WEIGHTS & VOLUMES (METRIC) ---
        const netWeightKgs = (parseFloat((netWeight || '0').replace(/,/g, '')) || 0) * 0.453592;
        const grossWeightKgs = (parseFloat((grossWeight || '0').replace(/,/g, '')) || 0) * 0.453592;

        doc.setFontSize(9);
        doc.setTextColor(0);

        doc.setFont(undefined, 'bold');
        doc.text("Net weight (KGS):", 14, finalY);
        doc.setFont(undefined, 'normal');
        doc.text(netWeightKgs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), 47, finalY);

        doc.setFont(undefined, 'bold');
        doc.text("Gross weight (KGS):", 14, finalY + 5);
        doc.setFont(undefined, 'normal');
        doc.text(grossWeightKgs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), 47, finalY + 5);

        doc.setFont(undefined, 'bold');
        doc.text("Volumes:", 14, finalY + 10);
        doc.setFont(undefined, 'normal');
        doc.text(totalVolumes ? `${totalVolumes}` : '-', 45, finalY + 10);

        let containerY = finalY + 20;

        // --- CONTAINERS ---
        if (containers.length > 0) {
            doc.setFont(undefined, 'bold');
            doc.text("CONTAINER", 14, containerY);
            doc.text("SEAL", 50, containerY);
            doc.setFont(undefined, 'normal');
            containerY += 5;
            containers.forEach(c => {
                doc.text(c.container, 14, containerY);
                doc.text(c.seal, 50, containerY);
                containerY += 5;
            });
        }

        // --- RESUME PER CONTAINER ---
        // Use containers array and distribute total weights evenly
        const totalGross_Lbs = parseFloat(grossWeight.replace(/,/g, '')) || 0;
        const totalNet_Lbs = parseFloat(netWeight.replace(/,/g, '')) || 0;
        const totalGross_Kg = totalGross_Lbs * 0.453592;
        const totalNet_Kg = totalNet_Lbs * 0.453592;
        const total_Vols = parseFloat(totalVolumes) || 0;

        const num_Containers = containers.length || 1;

        const resumeBody = containers.map(c => [
            c.container || 'N/A',
            c.seal || '',
            (totalGross_Lbs / num_Containers).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            (totalNet_Lbs / num_Containers).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            (totalGross_Kg / num_Containers).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            (totalNet_Kg / num_Containers).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            Math.round(total_Vols / num_Containers).toLocaleString()
        ]);

        // Calculate Totals Row
        const totalStats = {
            grossLbs: totalGross_Lbs,
            netLbs: totalNet_Lbs,
            grossKg: totalGross_Kg,
            netKg: totalNet_Kg,
            volumes: total_Vols
        };

        resumeBody.push([
            'TOTALS',
            '',
            totalStats.grossLbs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            totalStats.netLbs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            totalStats.grossKg.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            totalStats.netKg.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            totalStats.volumes.toLocaleString()
        ]);

        if (containerY > 230) { doc.addPage(); containerY = 20; }
        else { containerY += 10; } // Spacing

        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text("RESUME PER CONTAINER", 14, containerY);

        autoTable(doc, {
            startY: containerY + 2,
            head: [['CONTAINER NO.', 'SEAL NO.', 'GROSS WT (LBS)', 'NET WT (LBS)', 'GROSS WT (KG)', 'NET WT (KG)', 'VOLUMES']],
            body: resumeBody,
            theme: 'plain',
            headStyles: {
                fillColor: [241, 245, 249],
                textColor: [71, 85, 105],
                fontSize: 7,
                fontStyle: 'bold',
                halign: 'center'
            },
            bodyStyles: {
                fontSize: 7,
                textColor: [51, 65, 85],
                halign: 'center'
            },
            columnStyles: {
                0: { halign: 'left', fontStyle: 'bold' }, // Container No
                1: { halign: 'left' }  // Seal No
            },
            didParseCell: (data) => {
                // Style the TOTALS row
                if (data.row.index === resumeBody.length - 1) {
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.fillColor = [241, 245, 249];
                }
            }
        });

        if (returnBlob) {
            const blob = doc.output('blob');
            const url = URL.createObjectURL(blob);
            return { url, blob };
        }
        // Generate Blob for Preview
        const blob = doc.output('blob');
        const url = URL.createObjectURL(blob);
        const downloadFn = () => doc.save(`${invoiceNumber}_PL_EXPORT.pdf`);
        openPreview(url, `Packing List Export - ${invoiceNumber}`, `${invoiceNumber}_PL_EXPORT.pdf`, blob, downloadFn);
    };

    const generateSLI = (returnBlob = false, overrideData: any = null) => {
        const doc = new jsPDF();

        // Override Data
        const d_invoiceNumber = overrideData?.invoiceNumber || invoiceNumber;
        const d_invoiceDate = overrideData?.invoiceDate || invoiceDate;
        const d_paymentTerms = overrideData?.paymentTerms || paymentTerms;
        const d_currency = overrideData?.currency || currency;
        const d_incoterm = overrideData?.incoterm || incoterm;
        const d_dueDate = overrideData?.dueDate || dueDate;
        const d_items: InvoiceLineItem[] = overrideData?.items || items;
        const d_netWeight = overrideData?.netWeight || netWeight;
        const d_grossWeight = overrideData?.grossWeight || grossWeight;
        const d_totalVolumes = overrideData?.totalVolumes || totalVolumes;
        const d_packaging = overrideData?.packaging || packaging;
        const d_commodity = overrideData?.commodity || commodity;
        const d_origin = overrideData?.origin || origin;
        const d_carrier = overrideData?.carrier || carrier;
        const d_trackingNumber = overrideData?.trackingNumber || trackingNumber;
        const d_transportRef = overrideData?.transportRef || transportRef;
        const d_notes = overrideData?.notes || notes;
        const d_containers: ContainerRow[] = overrideData?.containers || containers;
        const d_shipperName = overrideData?.shipperName || shipperName;
        const d_billToName = overrideData?.billToName || billToName;
        const d_billToAddress = overrideData?.billToAddress || billToAddress;

        const company = availableCompanies.find(c => c.id === currentCompanyId) || (currentCompanyId === 'ALL' ? undefined : availableCompanies[0]);

        // --- LOGO ---
        if (companyLogoUrl) {
            try {
                const imgProps = doc.getImageProperties(companyLogoUrl);
                const pdfWidth = doc.internal.pageSize.getWidth();
                const logoWidth = 50;
                const logoHeight = (imgProps.height * logoWidth) / imgProps.width;
                doc.addImage(companyLogoUrl, 'PNG', 14, 10, logoWidth, logoHeight);
            } catch (e) {
                console.error("Error adding logo", e);
                doc.setFontSize(18).setFont(undefined, 'bold').text(d_shipperName, 14, 25);
            }
        } else {
            doc.setFontSize(18).setFont(undefined, 'bold').text(d_shipperName, 14, 25);
        }

        // --- CONSIGNEE INFO ---
        doc.setFontSize(9);
        doc.setTextColor(44, 62, 80);
        doc.setFont(undefined, 'bold');
        doc.text("CONSIGNEE:", 14, 35);
        doc.setFont(undefined, 'normal');
        doc.text(d_billToName, 14, 40);
        const splitAddress = doc.splitTextToSize(d_billToAddress, 80);
        doc.text(splitAddress, 14, 45);

        // --- SHIPPER INFO ---
        doc.setFontSize(9);
        doc.setTextColor(44, 62, 80);
        doc.setFont(undefined, 'bold');
        const companyName = company?.name || d_shipperName;
        const addressLine1 = company?.address || "";
        const addressLine2 = (company?.city && company?.state) ? `${company.city}, ${company.state} ${company.zip || ''}` : "";

        let yPos = 15;
        const rightX = doc.internal.pageSize.width - 14;
        doc.text(companyName, rightX, yPos, { align: 'right' });
        doc.setFont(undefined, 'normal');
        yPos += 5;
        doc.text(addressLine1, rightX, yPos, { align: 'right' });
        yPos += 5;
        doc.text(addressLine2, rightX, yPos, { align: 'right' });

        // --- SLI HEADER ---
        doc.setFontSize(16);
        doc.setTextColor(44, 62, 80);
        const title = "SHIPPER'S LETTER OF INSTRUCTION";
        const titleWidth = doc.getTextWidth(title);
        doc.text(title, (doc.internal.pageSize.width - titleWidth) / 2, 65);

        // --- DETAILS HEADER ---
        let currentY = 75;
        doc.setFontSize(10);
        doc.setTextColor(0);

        const leftColX = 14;
        const rightColX = 110;

        // Calculate Due Date (simple approximation if needed, or parse if valid date)
        const calcDueDate = d_dueDate || (d_invoiceDate ? new Date(new Date(d_invoiceDate).setDate(new Date(d_invoiceDate).getDate() + 45)).toISOString().split('T')[0] : '');

        // Row 1
        doc.setFont(undefined, 'bold'); doc.text("Invoice Number:", leftColX, currentY);
        doc.setFont(undefined, 'normal'); doc.text(d_invoiceNumber, leftColX + 35, currentY);

        doc.setFont(undefined, 'bold'); doc.text("Date:", rightColX, currentY);
        doc.setFont(undefined, 'normal'); doc.text(d_invoiceDate, rightColX + 35, currentY);
        currentY += 6;

        // Row 2
        doc.setFont(undefined, 'bold'); doc.text("Terms:", leftColX, currentY);
        doc.setFont(undefined, 'normal'); doc.text(d_paymentTerms, leftColX + 35, currentY);

        doc.setFont(undefined, 'bold'); doc.text("Due Date:", rightColX, currentY);
        doc.setFont(undefined, 'normal'); doc.text(calcDueDate, rightColX + 35, currentY);
        currentY += 6;

        // Row 3
        doc.setFont(undefined, 'bold'); doc.text("Incoterm:", leftColX, currentY);
        doc.setFont(undefined, 'normal'); doc.text(d_incoterm, leftColX + 35, currentY);

        doc.setFont(undefined, 'bold'); doc.text("Currency:", rightColX, currentY);
        doc.setFont(undefined, 'normal'); doc.text(d_currency, rightColX + 35, currentY);
        currentY += 6;

        // Row 4
        const totalAmt = d_items.reduce((sum, item) => sum + item.amount, 0);
        doc.setFont(undefined, 'bold'); doc.text("Total Amount:", leftColX, currentY);
        doc.setFont(undefined, 'normal'); doc.text(totalAmt.toLocaleString('en-US', { style: 'currency', currency: 'USD' }), leftColX + 35, currentY);
        currentY += 10;

        // --- GOODS DESCRIPTION ---
        doc.setFontSize(11);
        doc.setFont(undefined, 'bold');
        doc.setFillColor(240, 240, 240);
        doc.rect(14, currentY - 4, doc.internal.pageSize.width - 28, 6, 'F');
        doc.text("Goods Description", 16, currentY);
        currentY += 8;

        doc.setFontSize(10);

        doc.setFont(undefined, 'bold'); doc.text("Description:", leftColX, currentY);
        const d_description = d_items.map(i => i.customerDescription || i.description).join(', ');
        const splitDesc = doc.splitTextToSize(d_description, 160); // Wrap if long
        doc.setFont(undefined, 'normal'); doc.text(splitDesc, leftColX + 35, currentY);
        currentY += (splitDesc.length * 5) + 1; // Adjust Y for multiline
        currentY += 6;

        // Use first item for HS Code if multiple, or list unique ones
        const uniqueHS = Array.from(new Set(d_items.map(i => i.hsCode).filter(Boolean))).join(', ');
        doc.setFont(undefined, 'bold'); doc.text("HS Code:", leftColX, currentY);
        doc.setFont(undefined, 'normal'); doc.text(uniqueHS || d_items[0]?.hsCode || '', leftColX + 35, currentY);
        currentY += 6;

        const netWeightKgs = (parseFloat((d_netWeight || '0').replace(/,/g, '')) || 0) * 0.453592;
        const grossWeightKgs = (parseFloat((d_grossWeight || '0').replace(/,/g, '')) || 0) * 0.453592;

        doc.setFont(undefined, 'bold'); doc.text("Quantity:", leftColX, currentY);
        doc.setFont(undefined, 'normal'); doc.text(`${netWeightKgs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kg (Net Weight)`, leftColX + 35, currentY);
        currentY += 6;

        doc.setFont(undefined, 'bold'); doc.text("Gross Weight:", leftColX, currentY);
        doc.setFont(undefined, 'normal'); doc.text(`${grossWeightKgs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kg`, leftColX + 35, currentY);
        currentY += 6;

        doc.setFont(undefined, 'bold'); doc.text(`Number of ${d_packaging.split('/')[0].trim()}:`, leftColX, currentY);
        doc.setFont(undefined, 'normal'); doc.text(d_totalVolumes || '0', leftColX + 50, currentY);
        currentY += 6;

        doc.setFont(undefined, 'bold'); doc.text("Packaging:", leftColX, currentY);
        doc.setFont(undefined, 'normal'); doc.text(d_packaging, leftColX + 35, currentY);
        currentY += 6;

        // Unit Price (Avg if multiple) - Taking from first item or calculating avg
        // Request: Unit Price: $0.05/Kg
        // Calculate average price per Kg from total Amount / total Net Kg
        const totalNetKg = d_items.reduce((sum, i) => sum + (i.netKg || (i.quantity * 0.453592)), 0);
        const avgPriceKg = totalNetKg > 0 ? (totalAmt / totalNetKg) : 0;

        doc.setFont(undefined, 'bold'); doc.text("Unit Price:", leftColX, currentY);
        doc.setFont(undefined, 'normal'); doc.text(`$${avgPriceKg.toFixed(4)}/Kg`, leftColX + 35, currentY);
        currentY += 6;

        doc.setFont(undefined, 'bold'); doc.text("Country of Origin:", leftColX, currentY);
        doc.setFont(undefined, 'normal'); doc.text(d_origin, leftColX + 35, currentY);
        currentY += 10;

        // --- SHIPPING DETAILS ---
        doc.setFontSize(11);
        doc.setFont(undefined, 'bold');
        doc.setFillColor(240, 240, 240);
        doc.rect(14, currentY - 4, doc.internal.pageSize.width - 28, 6, 'F');
        doc.text("Shipping Details", 16, currentY);
        currentY += 8;

        doc.setFontSize(10);

        doc.setFont(undefined, 'bold'); doc.text("Carrier:", leftColX, currentY);
        doc.setFont(undefined, 'normal'); doc.text(d_carrier, leftColX + 35, currentY);
        currentY += 6;

        doc.setFont(undefined, 'bold'); doc.text("Booking Number:", leftColX, currentY);
        doc.setFont(undefined, 'normal'); doc.text(d_transportRef, leftColX + 35, currentY);
        currentY += 8;

        doc.setFont(undefined, 'bold'); doc.text("Containers and Seals:", leftColX, currentY);
        currentY += 5;
        doc.setFont(undefined, 'normal');
        if (d_containers.length > 0) {
            d_containers.forEach(c => {
                doc.text(`- ${c.container} / Seal: ${c.seal}`, leftColX + 5, currentY);
                currentY += 5;
            });
        } else {
            doc.text("- No Container Details Available", leftColX + 5, currentY);
            currentY += 5;
        }
        currentY += 4;

        let finalNotes = d_notes || '';
        const isBales = d_packaging.toLowerCase().includes('bales') || d_packaging.toLowerCase().includes('fardos');
        if (isBales) {
            finalNotes += (finalNotes ? '\n\n' : '') + "NO WOOD PRESENT IN THE CARGO";
        }

        if (finalNotes) {
            doc.setFont(undefined, 'bold'); doc.text("Special Notes:", leftColX, currentY);
            doc.setFont(undefined, 'normal');
            const splitNotes = doc.splitTextToSize(finalNotes, doc.internal.pageSize.width - 45);
            doc.text(splitNotes, leftColX + 30, currentY);
        }

        if (returnBlob) {
            const blob = doc.output('blob');
            const url = URL.createObjectURL(blob);
            return { url, blob };
        }
        doc.save(`${d_invoiceNumber}_SLI.pdf`);
    };

    // --- NEW DOC GENERATORS (Ported for View Actions) ---
    const formatDate = (d: string | undefined) => d ? new Date(d).toLocaleDateString() : '-';

    const createBookingPDFDoc = (booking: Booking): jsPDF => {
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
        addLine("Port of Request (POL)", booking.pol);
        addLine("Port of Discharge (POD)", booking.pod);
        if (booking.etd) addLine("Est. Departure (ETD)", formatDate(booking.etd));
        if (booking.eta) addLine("Est. Arrival (ETA)", formatDate(booking.eta));
        if (booking.carrier) addLine("Carrier", booking.carrier);
        if (booking.containerNumber) addLine("Container No.", booking.containerNumber);
        if (booking.blNumber) addLine("BL Reference", booking.blNumber);

        doc.setDrawColor(200, 200, 200);
        doc.line(20, 250, 190, 250);
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text("Generated by XSolution AI Logistics", 105, 260, { align: 'center' });
        return doc;
    };

    const createBLPDFDoc = (bl: BillOfLading): jsPDF => {
        const doc = new jsPDF();
        doc.setFillColor(30, 64, 175);
        doc.rect(0, 0, 210, 40, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(24);
        doc.setFont('helvetica', 'bold');
        doc.text("BILL OF LADING", 105, 25, { align: 'center' });

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

        doc.setDrawColor(200, 200, 200);
        doc.line(20, 250, 190, 250);
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text("Generated by XSolution AI Logistics", 105, 260, { align: 'center' });
        return doc;
    };

    const generateSalesDoc = (order: SalesOrder, type: 'PROFORMA' | 'CONTRACT' | 'CONFIRMATION'): jsPDF => {
        const doc = new jsPDF();
        const orangeColor = '#F57F25';
        const darkGray = '#333333';
        const lightGray = '#888888';

        // Logo using local state
        if (companyLogoUrl) {
            try {
                const imgProps = doc.getImageProperties(companyLogoUrl); // Might fail if URL not accessible/CORS
                const maxWidth = 75; const maxHeight = 37.5;
                const ratio = Math.min(maxWidth / imgProps.width, maxHeight / imgProps.height);
                doc.addImage(companyLogoUrl, 14, 10, imgProps.width * ratio, imgProps.height * ratio);
            } catch (e) {
                doc.setFontSize(24); doc.setTextColor('#CE1126'); doc.setFont(undefined, 'bold');
                doc.text("EC4 ENTERPRISES", 14, 25);
            }
        } else {
            doc.setFontSize(24); doc.setTextColor('#CE1126'); doc.setFont(undefined, 'bold');
            doc.text("EC4 ENTERPRISES", 14, 25);
        }

        // Company Info
        doc.setFontSize(9); doc.setTextColor(darkGray); doc.setFont(undefined, 'bold');
        const companyRec = availableCompanies.find(c => c.id === order.companyId);
        const rightX = 130; let yPos = 15;
        doc.text(companyRec?.name || "EC4 ENTERPRISES", rightX, yPos);
        doc.setFont(undefined, 'normal'); yPos += 5;
        doc.text(companyRec?.address || "112 Bartran Oaks Walk #600010", rightX, yPos); yPos += 5;
        doc.text((companyRec?.city && companyRec?.state) ? `${companyRec.city}, ${companyRec.state} ${companyRec.zip || ''}` : "St Johns, FL", rightX, yPos);

        // Title
        yPos = 55;
        doc.setFontSize(16); doc.setTextColor(orangeColor); doc.setFont(undefined, 'bold');
        doc.text(type === 'PROFORMA' ? "PROFORMA INVOICE" : type === 'CONTRACT' ? "SALES CONTRACT" : "SALES ORDER", 14, yPos);

        // Details
        yPos += 10;
        doc.setFontSize(8); doc.setTextColor(lightGray); doc.text("CONSIGNEE", 14, yPos);
        yPos += 5;
        doc.setFontSize(9); doc.setTextColor(darkGray); doc.setFont(undefined, 'bold');
        doc.text(order.customerName, 14, yPos);
        doc.setFont(undefined, 'normal'); yPos += 5;
        // Address lookup
        const customerRec = customers.find(c => c.id === order.customerId);
        let addr = order.deliveryAddress || '';
        if (!addr && customerRec) addr = [customerRec.location, customerRec.city, customerRec.country].filter(Boolean).join(', ');
        const splitAddr = doc.splitTextToSize(addr, 100);
        doc.text(splitAddr, 14, yPos);

        // Right side: Order No
        const startSectionY = 65;
        doc.setFontSize(8); doc.setTextColor(lightGray);
        doc.text("Order No:", rightX, startSectionY);
        doc.setFontSize(9); doc.setTextColor(darkGray);
        doc.text(order.orderNumber, rightX + 20, startSectionY);

        doc.setFontSize(8); doc.setTextColor(lightGray);
        doc.text("Date:", rightX, startSectionY + 10);
        doc.setFontSize(9); doc.setTextColor(darkGray);
        doc.text(formatDate(order.orderDate), rightX + 20, startSectionY + 10);

        // Items Table
        let tableY = yPos + 20;
        if (tableY < 100) tableY = 100;

        autoTable(doc, {
            startY: tableY,
            head: [['Description', 'HS Code', 'Qty', 'Unit', 'Price', 'Amount']],
            body: order.items.map(i => [
                i.productName,
                i.hsCode || '',
                i.quantity.toLocaleString(),
                'LBS', // standard
                `$${i.unitPrice.toFixed(4)}`,
                `$${(i.quantity * i.unitPrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
            ]),
            styles: { fontSize: 8 },
            headStyles: { fillColor: [245, 127, 37] }, // Orange
        });

        // Totals
        const finalY = (doc as any).lastAutoTable.finalY + 10;
        doc.setFontSize(10); doc.setFont(undefined, 'bold');
        doc.text(`Total Amount: $${order.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 140, finalY);

        return doc;
    };

    const formatWeight = (lbsValue: string | number | undefined | null) => {
        if (lbsValue === null || lbsValue === undefined || lbsValue === '') {
            return { lbs: '0.00', kg: '0.00' };
        }
        const lbs = typeof lbsValue === 'string' ? parseFloat(lbsValue.replace(/,/g, '')) : lbsValue;

        if (isNaN(lbs)) { return { lbs: 'N/A', kg: 'N/A' }; }

        const kg = lbs * 0.453592;

        return {
            lbs: lbs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            kg: kg.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        };
    };

    // --- VIEW / PREVIEW HELPERS ---

    const getInvoiceData = (inv: Invoice) => {
        const parsedContainers = inv.containers ? (typeof inv.containers === 'string' ? JSON.parse(inv.containers) : inv.containers) : [];
        const parsedBankDetails = inv.bank_details ? (typeof inv.bank_details === 'string' ? JSON.parse(inv.bank_details) : inv.bank_details) : bankDetails;

        return {
            invoiceNumber: inv.invoiceNumber,
            invoiceDate: inv.date,
            dueDate: inv.dueDate,
            transportRef: inv.transportRef || '',
            shipperName: inv.shipperName || '',
            billToName: inv.billToName || '', // Check Property Names vs DB Columns (camelCase here implies mapped or raw?)
            billToAddress: inv.billToAddress || '',
            items: inv.items ? (typeof inv.items === 'string' ? JSON.parse(inv.items) : inv.items) : [],
            containers: parsedContainers,
            netWeight: inv.netWeight || '',
            grossWeight: inv.grossWeight || '',
            totalVolumes: inv.totalVolumes || '',
            paymentTerms: inv.paymentTerms || '',
            currency: inv.currency || 'USD',
            incoterm: inv.incoterm || '',
            bankDetails: parsedBankDetails,
            packaging: inv.packaging || '',
            commodity: inv.commodity || '',
            origin: inv.origin || '',
            carrier: inv.carrier || '',
            trackingNumber: inv.trackingNumber || '',
            notes: inv.notes || ''
        };
    };

    const handleViewDocument = async (type: 'INVOICE' | 'PL' | 'SLI' | 'BOOKING' | 'BL' | 'SO', inv: Invoice) => {
        const data = getInvoiceData(inv);

        try {
            if (type === 'INVOICE') {
                try {
                    const client = getSupabaseClient();
                    const { data: fullInv, error } = await client
                        .from('invoices')
                        .select('*')
                        .eq('invoiceNumber', inv.invoiceNumber)
                        .single();

                    if (error) throw error;

                    const override = {
                        ...data, // Keep base formatted data
                        // Overwrite with DB fields if present (handling snake_case & mis-mapped fields)
                        shipperName: fullInv.shipperName || fullInv.shipper_name || '',
                        billToName: fullInv.billToName || fullInv.bill_to_name || fullInv.soldTo || fullInv.sold_to || '',
                        billToAddress: fullInv.billToAddress || fullInv.bill_to_address || fullInv.shipTo || fullInv.ship_to || '',
                        transportRef: fullInv.transportRef || fullInv.transport_ref || '',
                        items: typeof fullInv.items === 'string' ? JSON.parse(fullInv.items) : (fullInv.items || []),

                        // FIX: Logic saves containers in 'freightTerms' and volumes in 'totalQuantity'
                        containers: (typeof fullInv.freightTerms === 'string' && fullInv.freightTerms.startsWith('['))
                            ? JSON.parse(fullInv.freightTerms)
                            : (typeof fullInv.containers === 'string' ? JSON.parse(fullInv.containers) : (fullInv.containers || [])),

                        grossWeight: fullInv.grossWeight || fullInv.gross_weight || '',
                        netWeight: fullInv.netWeight || fullInv.net_weight || '',

                        // FIX: Logic saves volumes in 'totalQuantity'
                        totalVolumes: fullInv.totalQuantity || fullInv.total_quantity || fullInv.totalVolumes || fullInv.total_volumes || fullInv.volumes || '0',

                        companyId: fullInv.companyId || fullInv.company_id || ''
                    };

                    // Generate PDF using the overrides
                    const result = generatePDF(true, override) as { url: string; blob: Blob };
                    const downloadFn = () => generatePDF(false, override);
                    openPreview(result.url, `Invoice ${inv.invoiceNumber}`, `${inv.invoiceNumber}.pdf`, result.blob, downloadFn);
                } catch (err) {
                    console.error("Error fetching invoice for preview:", err);
                    // Fallback to existing data if fetch fails
                    const result = generatePDF(true, data) as { url: string; blob: Blob };
                    const downloadFn = () => generatePDF(false, data);
                    openPreview(result.url, `Invoice ${inv.invoiceNumber}`, `${inv.invoiceNumber}.pdf`, result.blob, downloadFn);
                }
            }
            else if (type === 'PL') {
                try {
                    const client = getSupabaseClient();
                    // Fetch full invoice data to ensure we have items and containers
                    // Use invoiceNumber lookup to avoid potential UUID/String ID mismatch issues
                    const { data: fullInv, error } = await client
                        .from('invoices')
                        .select('*')
                        .eq('invoiceNumber', inv.invoiceNumber)
                        .single();

                    if (error) {
                        console.error('Supabase fetch error:', error);
                        throw error;
                    }
                    if (!fullInv) throw new Error('Invoice not found');

                    // Prepare Data for Generator
                    const override = {
                        invoiceNumber: fullInv.invoiceNumber || '',
                        invoiceDate: fullInv.invoiceDate || '',
                        shipperName: fullInv.shipperName || fullInv.shipper_name || '',
                        billToName: fullInv.billToName || fullInv.bill_to_name || fullInv.soldTo || fullInv.sold_to || '',
                        billToAddress: fullInv.billToAddress || fullInv.bill_to_address || fullInv.shipTo || fullInv.ship_to || '',
                        transportRef: fullInv.transportRef || fullInv.transport_ref || '',
                        items: typeof fullInv.items === 'string' ? JSON.parse(fullInv.items) : (fullInv.items || []),

                        // FIX: Logic saves containers in 'freightTerms' and volumes in 'totalQuantity'
                        containers: (typeof fullInv.freightTerms === 'string' && fullInv.freightTerms.startsWith('['))
                            ? JSON.parse(fullInv.freightTerms)
                            : (typeof fullInv.containers === 'string' ? JSON.parse(fullInv.containers) : (fullInv.containers || [])),

                        grossWeight: fullInv.grossWeight || fullInv.gross_weight || '',
                        netWeight: fullInv.netWeight || fullInv.net_weight || '',

                        // FIX: Logic saves volumes in 'totalQuantity'
                        totalVolumes: fullInv.totalQuantity || fullInv.total_quantity || fullInv.totalVolumes || fullInv.total_volumes || fullInv.volumes || '0',

                        companyId: fullInv.companyId || fullInv.company_id || ''
                    };

                    // Generate PDF using the refactored USA generator
                    const result = (generatePackingListUSA as any)(true, override) as { url: string; blob: Blob };

                    if (result) {
                        const downloadFn = () => (generatePackingListUSA as any)(false, override);
                        openPreview(result.url, `PL ${fullInv.invoiceNumber}`, `${fullInv.invoiceNumber}_PL.pdf`, result.blob, downloadFn);
                    } else {
                        alert('Failed to generate PL PDF.');
                    }
                } catch (e) {
                    console.error('Error viewing PL:', e);
                    alert('Error loading Packing List data.');
                }
            }
            else if (type === 'SLI') {
                const result = generateSLI(true, data) as { url: string; blob: Blob };
                const downloadFn = () => generateSLI(false, data);
                openPreview(result.url, `SLI ${inv.invoiceNumber}`, `${inv.invoiceNumber}_SLI.pdf`, result.blob, downloadFn);
            }
            else if (type === 'BOOKING') {
                // Fetch directly from DB
                const bookingRef = inv.transportRef;
                if (!bookingRef) {
                    alert('No Transport Ref (Booking #) found on invoice.');
                    return;
                }

                const client = getSupabaseClient();
                const { data: booking, error } = await client
                    .from('bookings')
                    .select('*')
                    .eq('bookingNumber', bookingRef)
                    .single();

                if (booking) {
                    // Prioritize Original Document if available
                    if (booking.originalDocument) {
                        try {
                            // Fetch as blob to prevent new tab on download
                            const resp = await fetch(booking.originalDocument);
                            const blob = await resp.blob();
                            const blobUrl = URL.createObjectURL(blob);
                            // For external docs, create a download function that uses the blob we already fetched
                            const downloadFn = () => {
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = `Booking_${booking.bookingNumber}.pdf`;
                                document.body.appendChild(a);
                                a.click();
                                setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
                            };
                            openPreview(blobUrl, `Booking ${booking.bookingNumber}`, `Booking_${booking.bookingNumber}.pdf`, blob, downloadFn);
                        } catch (e) {
                            console.error("Fetch failed", e);
                            // Fallback - generate PDF instead
                            const doc = createBookingPDFDoc(booking);
                            const blob = doc.output('blob');
                            const blobUrl = URL.createObjectURL(blob);
                            const downloadFn = () => createBookingPDFDoc(booking).save(`Booking_${booking.bookingNumber}.pdf`);
                            openPreview(blobUrl, `Booking ${booking.bookingNumber}`, `Booking_${booking.bookingNumber}.pdf`, blob, downloadFn);
                        }
                    } else {
                        const doc = createBookingPDFDoc(booking);
                        const blob = doc.output('blob');
                        const blobUrl = URL.createObjectURL(blob);
                        const downloadFn = () => createBookingPDFDoc(booking).save(`Booking_${booking.bookingNumber}.pdf`);
                        openPreview(blobUrl, `Booking ${booking.bookingNumber}`, `Booking_${booking.bookingNumber}.pdf`, blob, downloadFn);
                    }
                } else {
                    console.error("Booking Fetch Error:", error);
                    alert(`Booking #${bookingRef} not found in database.`);
                }
            }
            else if (type === 'BL') {
                // Link via Transport Ref or matching Booking Number
                const bl = billOfLadings.find(b => b.blNumber === inv.transportRef || b.bookingNumber === inv.transportRef);
                if (bl) {
                    const doc = createBLPDFDoc(bl);
                    const blob = doc.output('blob');
                    const blobUrl = URL.createObjectURL(blob);
                    const downloadFn = () => createBLPDFDoc(bl).save(`BL_${bl.blNumber}.pdf`);
                    openPreview(blobUrl, `Bill of Lading ${bl.blNumber}`, `BL_${bl.blNumber}.pdf`, blob, downloadFn);
                } else {
                    alert('No associated Bill of Lading found.');
                }
            }
            else if (type === 'SO') {
                // Fetch directly from DB for speed
                let soNum = '';
                if ('soNumber' in inv) soNum = (inv as any).soNumber;
                if (!soNum && 'plNumber' in inv) soNum = (inv as any).plNumber; // Fallback

                if (!soNum) {
                    alert('No associated Sales Order number found.');
                    return;
                }

                const client = getSupabaseClient();
                const { data: so, error } = await client
                    .from('sales_orders')
                    .select('*')
                    .eq('orderNumber', soNum)
                    .single();

                if (so) {
                    const doc = generateSalesDoc(so, 'CONFIRMATION');
                    const blob = doc.output('blob');
                    const blobUrl = URL.createObjectURL(blob);
                    const downloadFn = () => generateSalesDoc(so, 'CONFIRMATION').save(`SO_${so.orderNumber}.pdf`);
                    openPreview(blobUrl, `Sales Order ${so.orderNumber}`, `SO_${so.orderNumber}.pdf`, blob, downloadFn);
                } else {
                    console.error("SO Fetch Error:", error);
                    alert(`Sales Order #${soNum} not found in database.`);
                }
            }
        } catch (error) {
            console.error("Error generating view document", error);
            alert("Error generating document preview.");
        }
    };

    return (
        <div className="h-full flex flex-col bg-slate-50 overflow-hidden">

            {/* New Submenu Navigation */}
            <div className="bg-white border-b border-slate-200 px-6 py-3 shrink-0 z-20 shadow-sm flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-r from-rose-500 to-pink-500 rounded-xl text-white"><FileText size={24} /></div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">Invoice Engine</h1>
                        <p className="text-slate-500 text-sm mt-1">Create and manage commercial invoices</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={handleLoadBlank}
                        className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'BLANK' ? 'bg-slate-800 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}
                    >
                        <Plus size={16} /> CREATE BLANK
                    </button>
                    <button
                        onClick={() => { setActiveTab('PL'); setSelectedPL(null); }}
                        className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'PL' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}
                    >
                        <FileText size={16} /> CREATE FROM PL
                    </button>
                    <button
                        onClick={() => setActiveTab('SAVED')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'SAVED' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}
                    >
                        <List size={16} /> SAVED INVOICES
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden relative">

                {activeTab === 'PL' && (
                    <div className="h-full flex flex-col md:flex-row overflow-hidden">
                        <div className="w-full md:w-1/3 border-r border-slate-200 bg-white flex flex-col h-full shrink-0 z-10">
                            <div className="p-4 border-b border-slate-100 flex items-center gap-2">
                                <div className="relative flex-1">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                    <input
                                        className="w-full pl-9 pr-4 py-3 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none shadow-sm"
                                        placeholder="Search Packing List #..."
                                        value={searchTerm}
                                        onChange={e => setSearchTerm(e.target.value)}
                                        autoFocus
                                    />
                                </div>
                                {isRefreshing && <Loader2 size={16} className="text-blue-500 animate-spin flex-shrink-0" />}
                            </div>
                            <div className="flex-1 overflow-y-auto custom-scrollbar">
                                {filteredPLs.length > 0 ? (
                                    <div className="divide-y divide-slate-100">
                                        {filteredPLs.map(pl => (
                                            <button
                                                key={pl.id}
                                                onClick={() => handleSelectPL(pl)}
                                                className={`w-full text-left p-4 hover:bg-blue-50 transition-colors flex justify-between items-center group ${selectedPL?.id === pl.id ? 'bg-blue-50 border-l-4 border-blue-600' : 'border-l-4 border-transparent'}`}
                                            >
                                                <div className="overflow-hidden">
                                                    <span className={`block font-bold text-sm truncate ${selectedPL?.id === pl.id ? 'text-blue-700' : 'text-slate-700'}`}>{pl.plNumber}</span>
                                                    <span className="block text-xs text-slate-500 truncate">{pl.consignee || 'Unknown Consignee'}</span>
                                                </div>
                                                <div className="text-xs text-slate-400 group-hover:text-blue-600 font-medium flex items-center gap-2 shrink-0">
                                                    {pl.date} <ArrowRight size={14} />
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="p-8 text-center text-slate-400">No matching packing lists found.</div>
                                )}
                            </div>
                        </div>

                        <div className="flex-1 bg-slate-50 overflow-y-auto custom-scrollbar p-6">
                            {selectedPL ? (() => {
                                const formattedGrossWeight = formatWeight(selectedPL.grossWeight);
                                const formattedNetWeight = formatWeight(selectedPL.netWeight);
                                return (
                                    <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden flex flex-col animate-in fade-in slide-in-from-right-4">
                                        <div className="p-6 bg-slate-50 border-b border-slate-200 flex justify-between items-center sticky top-0 z-10 backdrop-blur-sm bg-slate-50/90">
                                            <div>
                                                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                                                    <FileCheck size={24} className="text-blue-600" /> Review Packing List
                                                </h2>
                                                <p className="text-slate-500 text-sm mt-1">Verify details before creating invoice</p>
                                            </div>
                                            <button
                                                onClick={handleConfirmPL}
                                                className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm font-bold flex items-center gap-2 shadow-sm"
                                            >
                                                Confirm & Create Invoice <ArrowRight size={16} />
                                            </button>
                                        </div>

                                        <div className="p-6 grid grid-cols-1 gap-8">
                                            <div className="space-y-6">
                                                <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                                                    <h3 className="text-xs font-bold text-slate-500 uppercase mb-3">General Information</h3>
                                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                                        <div><p className="text-slate-400 text-xs uppercase font-bold">PL Number</p><p className="font-bold text-slate-800">{selectedPL.plNumber}</p></div>
                                                        <div><p className="text-slate-400 text-xs uppercase font-bold">Date</p><p className="font-medium text-slate-800">{selectedPL.date}</p></div>
                                                        <div><p className="text-slate-400 text-xs uppercase font-bold">Supplier</p><p className="font-medium text-slate-800 truncate" title={selectedPL.shipper}>{selectedPL.shipper}</p></div>
                                                        <div><p className="text-slate-400 text-xs uppercase font-bold">Consignee</p><p className="font-medium text-slate-800 truncate" title={selectedPL.consignee}>{selectedPL.consignee}</p></div>
                                                    </div>
                                                </div>

                                                <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                                                    <h3 className="text-xs font-bold text-slate-500 uppercase mb-3">Logistics Summary</h3>
                                                    <div className="grid grid-cols-3 gap-4 text-sm text-center">
                                                        <div className="bg-white p-3 rounded border border-slate-100">
                                                            <p className="text-slate-400 text-[10px] uppercase font-bold">Gross Weight</p>
                                                            <p className="font-bold text-slate-800 text-base">{formattedGrossWeight.lbs} lbs</p>
                                                            <p className="text-xs text-slate-500">{formattedGrossWeight.kg} kgs</p>
                                                        </div>
                                                        <div className="bg-white p-3 rounded border border-slate-100">
                                                            <p className="text-slate-400 text-[10px] uppercase font-bold">Net Weight</p>
                                                            <p className="font-bold text-slate-800 text-base">{formattedNetWeight.lbs} lbs</p>
                                                            <p className="text-xs text-slate-500">{formattedNetWeight.kg} kgs</p>
                                                        </div>
                                                        <div className="bg-white p-3 rounded border border-slate-100">
                                                            <p className="text-slate-400 text-[10px] uppercase font-bold">Total Units</p>
                                                            <p className="font-bold text-slate-800 text-lg">{selectedPL.unitCount}</p>
                                                        </div>
                                                    </div>
                                                    <div className="mt-4 pt-3 border-t border-slate-200 text-xs space-y-1">
                                                        <p className="text-slate-600"><span className="font-bold text-slate-500 uppercase mr-2">Containers:</span> {selectedPL.containerNumber}</p>
                                                        <p className="text-slate-600"><span className="font-bold text-slate-500 uppercase mr-2">Seals:</span> {selectedPL.sealNumber}</p>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 flex flex-col">
                                                <h3 className="text-xs font-bold text-slate-500 uppercase mb-3">Item Breakdown</h3>
                                                <div className="overflow-x-auto bg-white border border-slate-200 rounded">
                                                    <table className="w-full text-left text-sm">
                                                        <thead className="bg-slate-100 text-slate-500 text-xs uppercase font-bold">
                                                            <tr>
                                                                <th className="p-3 border-b">Description</th>
                                                                <th className="p-3 border-b text-right">Qty</th>
                                                                <th className="p-3 border-b text-right">Net Wt</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-slate-100">
                                                            {(() => {
                                                                try {
                                                                    const items = JSON.parse(selectedPL.items || '[]');
                                                                    return items.map((item: any, idx: number) => {
                                                                        const formattedNetWt = formatWeight(item.netLbs);
                                                                        return (
                                                                            <tr key={idx}>
                                                                                <td className="p-3 text-slate-700 font-medium">{item.productName || item.description || item.productDescription}</td>
                                                                                <td className="p-3 text-right text-slate-600">{item.volumes || item.quantity}</td>
                                                                                <td className="p-3 text-right font-mono text-slate-800">
                                                                                    <div>{formattedNetWt.lbs} lbs</div>
                                                                                    <div className="text-xs text-slate-500">{formattedNetWt.kg} kgs</div>
                                                                                </td>
                                                                            </tr>
                                                                        )
                                                                    });
                                                                } catch (e) {
                                                                    return <tr><td colSpan={3} className="p-4 text-center text-slate-400 italic">No item details available</td></tr>;
                                                                }
                                                            })()}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })() : (
                                <div className="h-full flex flex-col items-center justify-center text-slate-400">
                                    <FileText size={64} className="mb-4 opacity-10" />
                                    <p className="text-lg font-medium text-slate-500">Select a Packing List</p>
                                    <p className="text-sm opacity-60">Choose from the list on the left to review details.</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'SAVED' && (
                    <div className="h-full flex flex-col bg-white">
                        {/* Header Bar */}
                        <div className="p-6 border-b border-slate-100 flex items-center justify-between gap-4 sticky top-0 bg-white/95 backdrop-blur z-10">
                            <div className="flex items-center gap-4 flex-1">
                                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                    <Receipt className="text-blue-600" size={24} />
                                    Saved Invoices
                                </h2>
                                <div className="relative max-w-md w-full ml-4">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                    <input
                                        className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-slate-50 focus:bg-white transition-all shadow-sm"
                                        placeholder="Search by Invoice, Customer, or BL..."
                                        value={invoiceSearchTerm}
                                        onChange={e => setInvoiceSearchTerm(e.target.value)}
                                        autoFocus
                                    />
                                </div>
                            </div>

                            <div className="flex items-center gap-3">

                                <button
                                    onClick={() => handleLoadBlank()}
                                    className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm transition-all text-sm font-semibold"
                                >
                                    <Plus size={18} /> New Invoice
                                </button>
                            </div>
                        </div>

                        {/* Table Content */}
                        <div className="flex-1 overflow-auto custom-scrollbar p-6 bg-slate-50/50">
                            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                                            <th className="px-2 py-2">Invoice #</th>
                                            <th className="px-2 py-2">Date</th>
                                            <th className="px-2 py-2">Customer</th>
                                            <th className="px-2 py-2">Bill of Lading #</th>
                                            <th className="px-2 py-2 text-right">Amount</th>
                                            <th className="px-2 py-2 text-center">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 text-sm">
                                        {filteredInvoices.length === 0 ? (
                                            <tr>
                                                <td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic">
                                                    No invoices found match your search.
                                                </td>
                                            </tr>
                                        ) : (
                                            filteredInvoices.map(inv => (
                                                <tr key={inv.id} className="group hover:bg-blue-50/50 transition-colors">
                                                    <td className="py-px px-2 font-bold text-slate-700 font-mono">
                                                        {inv.invoiceNumber}
                                                    </td>
                                                    <td className="py-px px-2 text-slate-600">
                                                        {inv.invoiceDate.split('T')[0]}
                                                    </td>
                                                    <td className="py-px px-2 text-slate-700 font-medium max-w-xs truncate" title={inv.soldTo}>
                                                        {inv.soldTo?.split(/[\n\s]+/)[0] || 'Unknown'}
                                                    </td>
                                                    <td className="py-px px-2 text-slate-600 font-mono text-xs">
                                                        <div className="flex items-center gap-1">
                                                            <span className="font-medium">{inv.transportRef || <span className="text-slate-300">-</span>}</span>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); setOpenLinkBLModal(inv.id); setSelectedBLForModal(inv.transportRef || ''); }}
                                                                className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                                                title="Link Bill of Lading"
                                                            >
                                                                <Link2 size={14} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td className="py-px px-2 text-right font-mono font-medium text-slate-700">
                                                        ${Number(inv.totalAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </td>
                                                    <td className="py-px px-2 text-center">
                                                        {/* Actions Column */}
                                                        <div className="flex items-center justify-end gap-1.5 flex-wrap min-w-[300px]">
                                                            {/* View Buttons (Restored) */}
                                                            <button onClick={(e) => { e.stopPropagation(); handleViewDocument('SO', inv); }} className="px-2 py-1 text-[10px] font-bold bg-orange-100 text-orange-700 rounded hover:bg-orange-200 transition-colors uppercase whitespace-nowrap">SO View</button>
                                                            <button onClick={(e) => { e.stopPropagation(); handleViewDocument('BOOKING', inv); }} className="px-2 py-1 text-[10px] font-bold bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors uppercase whitespace-nowrap">Booking View</button>
                                                            <button onClick={(e) => { e.stopPropagation(); handleViewDocument('PL', inv); }} className="px-2 py-1 text-[10px] font-bold bg-cyan-100 text-cyan-700 rounded hover:bg-cyan-200 transition-colors uppercase whitespace-nowrap">PL View</button>
                                                            <button onClick={(e) => { e.stopPropagation(); handleViewDocument('INVOICE', inv); }} className="px-2 py-1 text-[10px] font-bold bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200 transition-colors uppercase whitespace-nowrap">Invoice View</button>
                                                            <button onClick={(e) => { e.stopPropagation(); handleViewDocument('BL', inv); }} className="px-2 py-1 text-[10px] font-bold bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 transition-colors uppercase whitespace-nowrap">BL View</button>

                                                            <div className="w-px h-4 bg-slate-300 mx-1"></div>

                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleLoadInvoice(inv); }}
                                                                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-100 rounded transition-colors"
                                                                title="Edit Invoice"
                                                            >
                                                                <Pencil size={16} />
                                                            </button>
                                                            <button
                                                                onClick={(e) => handleEmailInvoice(inv, e)}
                                                                className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-100 rounded transition-colors"
                                                                title="Email Invoice"
                                                            >
                                                                <Mail size={16} />
                                                            </button>
                                                            <button
                                                                onClick={(e) => handleDeleteInvoice(inv.id, e)}
                                                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-100 rounded transition-colors"
                                                                title="Delete Invoice"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                            <div className="mt-4 text-right text-xs text-slate-400">
                                Showing {filteredInvoices.length} record(s)
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'BLANK' && (
                    <div className="h-full flex flex-col bg-slate-50">
                        {/* Header / Actions */}
                        <div className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shrink-0 shadow-sm z-10 sticky top-0">
                            <div></div>
                            <div className="flex gap-2 text-xs">
                                <button onClick={() => generatePDF(false)} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg font-bold hover:bg-slate-50 transition-colors shadow-sm">
                                    <Download size={14} /> INV EXPORT
                                </button>
                                <button onClick={() => generatePackingListExport(false)} className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 border border-slate-200 text-slate-700 rounded-lg font-bold hover:bg-slate-200 transition-colors shadow-sm">
                                    <Download size={14} /> PL EXPORT
                                </button>

                                <div className="w-px h-6 bg-slate-300 mx-2"></div>

                                <button onClick={() => generateUSAPDF(false)} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg font-bold hover:bg-slate-50 transition-colors shadow-sm">
                                    <Download size={14} /> INV USA
                                </button>
                                <button onClick={() => generatePackingListUSA(false)} className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 border border-slate-200 text-slate-700 rounded-lg font-bold hover:bg-slate-200 transition-colors shadow-sm">
                                    <Download size={14} /> PL USA
                                </button>

                                <div className="w-px h-6 bg-slate-300 mx-2"></div>

                                <button
                                    onClick={() => generateSLI(false)}
                                    className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg transition-colors shadow-sm"
                                >
                                    <Download size={18} />
                                    <span>SLI</span>
                                </button>

                                <div className="w-px h-6 bg-slate-300 mx-2"></div>

                                <button onClick={handleSave} disabled={isSaving} className="flex items-center gap-2 px-6 py-2 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 transition-colors shadow-md hover:shadow-lg active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed">
                                    {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {editingId ? 'Update' : 'Save Invoice'}
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
                            <div className="max-w-6xl mx-auto space-y-8">

                                {/* SOURCE SELECTION */}
                                <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-6">
                                    <h3 className="text-sm font-bold text-blue-800 uppercase mb-4 flex items-center gap-2">
                                        <Search size={16} /> Source Documents
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div>
                                            <label className="block text-[11px] font-bold text-blue-600 uppercase mb-1.5">Load from Sales Order</label>
                                            <select
                                                className="w-full border border-blue-200 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                                                onChange={handleSelectSO}
                                                value={selectedSO?.id || ''}
                                            >
                                                <option value="">-- Select Sales Order --</option>
                                                {salesOrders.map(so => (
                                                    <option key={so.id} value={so.id}>{so.orderNumber} - {so.customerName}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-[11px] font-bold text-blue-600 uppercase mb-1.5">Load from Packing List</label>
                                            <select
                                                className="w-full border border-blue-200 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                                                onChange={handleSelectPLDropdown}
                                                value={selectedPL?.id || ''}
                                            >
                                                <option value="">-- Select Packing List --</option>
                                                {localPackingLists
                                                    .filter(pl => !selectedSO || (pl.invoiceNumber && pl.invoiceNumber.includes(selectedSO.orderNumber)) || (selectedSO.customerName && pl.consignee?.includes(selectedSO.customerName))) // loose matching
                                                    .map(pl => (
                                                        <option key={pl.id} value={pl.id}>{pl.plNumber} - {pl.consignee}</option>
                                                    ))}
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                {/* 1. Meta & Entities Block */}
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                    {/* Left: Shipper Details */}
                                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col h-full">
                                        <div className="flex items-center gap-2 border-b border-slate-100 pb-3 mb-4">
                                            <Building2 size={18} className="text-blue-500" />
                                            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Shipper / Exporter</h3>
                                        </div>
                                        <div className="space-y-4 flex-1">
                                            <div>
                                                <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1.5">Company Name</label>
                                                <input
                                                    className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                                    value={shipperName}
                                                    onChange={e => setShipperName(e.target.value)}
                                                    placeholder="Enter Shipper Name"
                                                />
                                            </div>
                                            {plNumber && (
                                                <div>
                                                    <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1.5">Linked PL #</label>
                                                    <div className="w-full border border-emerald-300 bg-emerald-50 rounded-lg px-3 py-2.5 text-sm font-mono text-emerald-700">
                                                        {plNumber}
                                                    </div>
                                                </div>
                                            )}
                                            <div>
                                                <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1.5">Booking #</label>
                                                <input className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm font-mono text-slate-600 focus:ring-2 focus:ring-blue-500 outline-none" value={transportRef} onChange={e => setTransportRef(e.target.value)} placeholder="Reference Number" />
                                            </div>
                                            <div>
                                                <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1.5">Currency</label>
                                                <select className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none bg-white" value={currency} onChange={e => setCurrency(e.target.value)}>
                                                    <option value="USD">USD ($)</option>
                                                    <option value="EUR">EUR (€)</option>
                                                    <option value="CNY">CNY (¥)</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1.5">POD</label>
                                                <input className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none" value={pod} onChange={e => setPod(e.target.value)} placeholder="Port of Discharge" />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Middle: Document Details */}
                                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col h-full">
                                        <div className="flex items-center gap-2 border-b border-slate-100 pb-3 mb-4">
                                            <FileText size={18} className="text-purple-500" />
                                            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Invoice Details</h3>
                                        </div>
                                        <div className="space-y-4 flex-1">
                                            <div>
                                                <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1.5">Invoice Number</label>
                                                <div className="flex items-center">
                                                    <span className="bg-slate-100 text-slate-500 border border-r-0 border-slate-300 rounded-l-lg px-3 py-2.5 text-sm font-bold">#</span>
                                                    <input className="w-full border border-slate-300 rounded-r-lg px-3 py-2.5 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-purple-500 outline-none" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1.5">Invoice Date</label>
                                                <input type="date" className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-700 focus:ring-2 focus:ring-purple-500 outline-none" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
                                            </div>
                                            <div>
                                                <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1.5">Payment Terms</label>
                                                <select className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-700 focus:ring-2 focus:ring-purple-500 outline-none bg-white" value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)}>
                                                    {PAYMENT_TERM_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-[11px] font-bold text-slate-400 uppercase mb-1.5">Incoterms</label>
                                                <input
                                                    className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-700 focus:ring-2 focus:ring-purple-500 outline-none"
                                                    placeholder="e.g. FOB, CIF, EXW"
                                                    value={incoterm}
                                                    onChange={e => setIncoterm(e.target.value)}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right: Bill To */}
                                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col h-full">
                                        <div className="flex justify-between items-center border-b border-slate-100 pb-3 mb-4">
                                            <div className="flex items-center gap-2">
                                                <User size={18} className="text-emerald-500" />
                                                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Bill To</h3>
                                            </div>
                                            <select
                                                className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-700 rounded px-2 py-1 outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer max-w-[120px]"
                                                value={selectedCustomerId}
                                                onChange={handleCustomerSelect}
                                            >
                                                <option value="">Load Customer</option>
                                                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                            </select>
                                        </div>
                                        <div className="space-y-3 flex-1 flex flex-col">
                                            <input
                                                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm font-bold text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-emerald-500 outline-none"
                                                placeholder="Customer Company Name"
                                                value={billToName}
                                                onChange={e => setBillToName(e.target.value)}
                                            />
                                            <textarea
                                                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-600 flex-1 resize-none placeholder-slate-400 focus:ring-2 focus:ring-emerald-500 outline-none min-h-[80px]"
                                                placeholder="Billing Address..."
                                                value={billToAddress}
                                                onChange={e => setBillToAddress(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* 4. Line Items Table */}
                                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                                    <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                                        <h3 className="text-sm font-bold text-slate-700 uppercase flex items-center gap-2">
                                            <List size={16} /> Line Items
                                        </h3>
                                        <button onClick={handleAddItem} className="text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg flex items-center gap-1.5 transition-all shadow-sm active:scale-95">
                                            <Plus size={14} /> Add Item
                                        </button>
                                    </div>

                                    <table className="w-full text-left text-sm">
                                        <thead className="text-xs text-slate-500 uppercase bg-slate-100 font-bold">
                                            <tr>
                                                <th className="p-3 pl-6 w-[40%]">Description</th>
                                                <th className="p-3 w-[20%]">HS Code</th>
                                                <th className="p-3 w-[15%]">Quantity</th>
                                                <th className="p-3 w-[15%]">Unit Price</th>
                                                <th className="p-3 w-[15%] text-right pr-6">Amount</th>
                                                <th className="p-3 w-[5%]"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {items.map(item => (
                                                <React.Fragment key={item.id}>
                                                    {/* Row 1: Text Inputs */}
                                                    <tr className="hover:bg-blue-50/30 group align-top transition-colors">
                                                        <td className="p-3 pl-6 pb-1">
                                                            {/* Product Dropdown */}
                                                            <select
                                                                value={item.productId || ''}
                                                                onChange={e => {
                                                                    const productId = e.target.value;
                                                                    if (productId) {
                                                                        const product = products.find(p => p.id === productId);
                                                                        if (product) {
                                                                            const desc = product.grade ? `${product.name} (${product.grade})` : product.name;
                                                                            setItems(current => current.map(i => i.id === item.id ? { ...i, productId, description: desc } : i));
                                                                        }
                                                                    } else {
                                                                        setItems(current => current.map(i => i.id === item.id ? { ...i, productId: '', description: '' } : i));
                                                                    }
                                                                }}
                                                                className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-sm font-medium focus:bg-white focus:border-blue-500 outline-none transition-all mb-2"
                                                            >
                                                                <option value="">Select Product...</option>
                                                                {products.map(p => (
                                                                    <option key={p.id} value={p.id}>{p.name} {p.grade ? `(${p.grade})` : ''}</option>
                                                                ))}
                                                            </select>
                                                            <input className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-sm focus:bg-white focus:border-blue-500 outline-none transition-all placeholder-slate-400" value={item.customerDescription} onChange={e => updateItem(item.id, 'customerDescription', e.target.value)} placeholder="Description for Invoice" />
                                                        </td>
                                                        <td className="p-3 pb-1">
                                                            <input className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-sm font-mono focus:bg-white focus:border-blue-500 outline-none transition-all placeholder-slate-400" value={item.hsCode} onChange={e => updateItem(item.id, 'hsCode', e.target.value)} placeholder="HS Code" />
                                                        </td>
                                                        {/* Quantity (LBS Top / KG Bottom) */}
                                                        <td className="p-3 pb-2">
                                                            <div className="flex flex-col gap-1">
                                                                <div className="relative">
                                                                    <FormattedInput
                                                                        value={item.quantity}
                                                                        onChange={val => updateItem(item.id, 'quantity', val)}
                                                                        className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm pr-8 focus:ring-2 focus:ring-blue-500 outline-none font-bold"
                                                                        placeholder="0"
                                                                        decimals={2}
                                                                    />
                                                                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 pointer-events-none">LBS</span>
                                                                </div>
                                                                <div className="relative">
                                                                    <FormattedInput
                                                                        value={item.quantity * 0.453592}
                                                                        onChange={val => updateItem(item.id, 'quantity', val * 2.20462)}
                                                                        className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-sm pr-8 focus:bg-white focus:border-blue-500 outline-none transition-all font-medium text-slate-600 focus:text-slate-800"
                                                                        placeholder="0"
                                                                        decimals={2}
                                                                    />
                                                                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 pointer-events-none">KG</span>
                                                                </div>
                                                            </div>
                                                        </td>

                                                        {/* Price (LBS Top / KG Bottom) */}
                                                        <td className="p-3 pb-2">
                                                            <div className="flex flex-col gap-1">
                                                                <div className="relative">
                                                                    <FormattedInput
                                                                        value={item.unitPrice}
                                                                        onChange={val => updateItem(item.id, 'unitPrice', val)}
                                                                        className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm pr-10 focus:ring-2 focus:ring-blue-500 outline-none"
                                                                        placeholder="0.00"
                                                                        decimals={4}
                                                                    />
                                                                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 pointer-events-none">$/LB</span>
                                                                </div>
                                                                <div className="relative">
                                                                    <FormattedInput
                                                                        value={item.unitPrice * 2.20462}
                                                                        onChange={val => updateItem(item.id, 'unitPrice', val * 0.453592)}
                                                                        className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-sm pr-10 focus:bg-white focus:border-blue-500 outline-none transition-all text-slate-600 focus:text-slate-800"
                                                                        placeholder="0.00"
                                                                        decimals={4}
                                                                    />
                                                                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 pointer-events-none">$/KG</span>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="p-3 pb-1 pr-6 text-right font-mono font-bold text-slate-800 text-base align-middle">
                                                            ${item.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                        </td>
                                                        <td className="p-3 pb-1 text-center align-middle">
                                                            <button onClick={() => handleRemoveItem(item.id)} className="text-slate-300 hover:text-red-500 transition-colors p-1 rounded hover:bg-red-50"><Trash2 size={16} /></button>
                                                        </td>
                                                    </tr>
                                                </React.Fragment>
                                            ))}
                                            {items.length === 0 && (
                                                <tr>
                                                    <td colSpan={5} className="p-12 text-center text-slate-400 italic">
                                                        No items added. Click "Add Item" above to start.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>

                                {/* 5. Logistics & Financials Bottom Grid */}
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                    {/* Logistics Card */}
                                    <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                                        <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
                                            <Package size={16} className="text-blue-500" /> Shipping & Containers
                                        </h3>

                                        {/* Weight/Vol Row */}
                                        <div className="grid grid-cols-3 gap-4 mb-6">
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Net Weight</label>
                                                <div className="flex flex-col gap-1">
                                                    <div className="relative">
                                                        <FormattedInput
                                                            value={Number(netWeight) || 0}
                                                            onChange={(val) => setNetWeight(val.toString())}
                                                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:bg-white focus:border-blue-500 outline-none transition-all pr-10 font-bold"
                                                            placeholder="0.00"
                                                            decimals={2}
                                                        />
                                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 pointer-events-none">LBS</span>
                                                    </div>
                                                    <div className="relative">
                                                        <div className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-sm pr-10 text-slate-500 font-medium">
                                                            {((Number(netWeight) || 0) * 0.453592).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                        </div>
                                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 pointer-events-none">KG</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Gross Weight</label>
                                                <div className="flex flex-col gap-1">
                                                    <div className="relative">
                                                        <FormattedInput
                                                            value={Number(grossWeight) || 0}
                                                            onChange={(val) => setGrossWeight(val.toString())}
                                                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:bg-white focus:border-blue-500 outline-none transition-all pr-10 font-bold"
                                                            placeholder="0.00"
                                                            decimals={2}
                                                        />
                                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 pointer-events-none">LBS</span>
                                                    </div>
                                                    <div className="relative">
                                                        <div className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-sm pr-10 text-slate-500 font-medium">
                                                            {((Number(grossWeight) || 0) * 0.453592).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                        </div>
                                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 pointer-events-none">KG</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Volumes</label>
                                                <input className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:bg-white focus:border-blue-500 outline-none transition-all" value={totalVolumes} onChange={e => setTotalVolumes(e.target.value)} placeholder="e.g. 20 Pallets" />
                                            </div>
                                        </div>

                                        {/* Container List */}
                                        <div className="border border-slate-200 rounded-xl overflow-hidden">
                                            <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex justify-between items-center">
                                                <label className="text-xs font-bold text-slate-500 uppercase">Container Manifest</label>
                                                <button onClick={handleAddContainer} className="text-[11px] text-blue-600 font-bold hover:text-blue-700 flex items-center gap-1 bg-white px-2 py-1 rounded border border-blue-100 shadow-sm transition-all active:scale-95">
                                                    <Plus size={12} /> Add Container
                                                </button>
                                            </div>
                                            <div className="p-2 space-y-2 bg-slate-50/30 min-h-[100px]">
                                                {containers.length === 0 && <div className="text-xs text-slate-400 italic text-center py-4">No containers added yet.</div>}
                                                {containers.map((cont, idx) => (
                                                    <div key={cont.id} className="flex gap-2 items-center bg-white p-2 rounded-lg border border-slate-200 shadow-sm">
                                                        <div className="w-6 text-xs font-bold text-slate-400 text-center">{idx + 1}</div>
                                                        <div className="flex-1 relative group">
                                                            <Container size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                                                            <input className="w-full bg-slate-50 border border-slate-200 rounded-md px-2 py-1.5 text-xs pl-8 font-mono text-slate-700 uppercase focus:bg-white focus:border-blue-500 outline-none transition-all" placeholder="Container Number" value={cont.container} onChange={e => updateContainer(cont.id, 'container', e.target.value)} />
                                                        </div>
                                                        <div className="flex-1 relative group">
                                                            <CheckCircle2 size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-500 transition-colors" />
                                                            <input className="w-full bg-slate-50 border border-slate-200 rounded-md px-2 py-1.5 text-xs pl-8 font-mono text-slate-700 uppercase focus:bg-white focus:border-emerald-500 outline-none transition-all" placeholder="Seal Number" value={cont.seal} onChange={e => updateContainer(cont.id, 'seal', e.target.value)} />
                                                        </div>
                                                        <button onClick={() => handleRemoveContainer(cont.id)} className="text-slate-300 hover:text-red-500 p-1.5 rounded hover:bg-red-50 transition-colors"><Trash2 size={14} /></button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Financials & Banking */}
                                    <div className="lg:col-span-1 space-y-6">
                                        {/* Totals Box */}
                                        <div className="bg-slate-900 rounded-xl shadow-lg border border-slate-800 p-6 text-white relative overflow-hidden">
                                            {/* Decorative Background Element */}
                                            <div className="absolute top-0 right-0 p-4 opacity-5">
                                                <DollarSign size={100} />
                                            </div>

                                            <div className="space-y-3 pb-4 border-b border-slate-700 mb-4 relative z-10">
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-slate-400">Subtotal</span>
                                                    <span className="font-medium">${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                                </div>
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-slate-400">Tax</span>
                                                    <span className="font-medium">$0.00</span>
                                                </div>
                                            </div>
                                            <div className="relative z-10">
                                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Total Due</p>
                                                <p className="text-3xl font-bold text-emerald-400 tracking-tight">{currency} {totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                                            </div>
                                        </div>

                                        {/* Bank Details */}
                                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 relative">
                                            <div className="flex justify-between items-center mb-4">
                                                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                                                    <CreditCard size={14} /> Banking Info
                                                </h3>
                                                <button
                                                    onClick={() => setShowAddBank(true)}
                                                    className="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded hover:bg-blue-100 font-bold"
                                                    title="Add New Bank Profile"
                                                >
                                                    + New Bank
                                                </button>
                                            </div>

                                            <div className="mb-3">
                                                <select
                                                    className="w-full border border-slate-200 rounded-lg p-2 text-xs bg-slate-50 focus:ring-2 focus:ring-blue-500 outline-none"
                                                    value={selectedBankId}
                                                    onChange={handleBankSelect}
                                                >
                                                    <option value="">{companyBanks.length === 0 ? "No saved banks found" : "-- Select Saved Bank --"}</option>
                                                    {companyBanks.map(bank => (
                                                        <option key={bank.id} value={bank.id}>{bank.bankName} (...{bank.accountNumber.slice(-4)})</option>
                                                    ))}
                                                    <option value="_ADD_NEW_">+ Add New Bank...</option>
                                                </select>
                                            </div>

                                            <div className="space-y-3">
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Bank Name</label>
                                                    <input className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-xs font-medium focus:bg-white focus:border-blue-500 outline-none transition-all" placeholder="Bank Name" value={bankDetails.bankName} onChange={e => setBankDetails({ ...bankDetails, bankName: e.target.value })} />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Address</label>
                                                    <input className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-xs font-medium focus:bg-white focus:border-blue-500 outline-none transition-all" placeholder="Bank Address" value={bankDetails.bankAddress} onChange={e => setBankDetails({ ...bankDetails, bankAddress: e.target.value })} />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Account Number</label>
                                                    <input className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-xs font-mono text-slate-600 focus:bg-white focus:border-blue-500 outline-none transition-all" placeholder="Account #" value={bankDetails.accountNumber} onChange={e => setBankDetails({ ...bankDetails, accountNumber: e.target.value })} />
                                                </div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] font-bold text-slate-400 uppercase">SWIFT</label>
                                                        <input className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-xs font-mono text-slate-600 focus:bg-white focus:border-blue-500 outline-none transition-all" placeholder="SWIFT" value={bankDetails.swiftCode} onChange={e => setBankDetails({ ...bankDetails, swiftCode: e.target.value })} />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Routing</label>
                                                        <input className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-xs font-mono text-slate-600 focus:bg-white focus:border-blue-500 outline-none transition-all" placeholder="Routing #" value={bankDetails.routingNumber} onChange={e => setBankDetails({ ...bankDetails, routingNumber: e.target.value })} />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                            </div>
                        </div>

                    </div>
                )}
            </div>

            {/* Add Bank Modal */}
            {showAddBank && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2"><Building2 size={18} /> New Bank Profile</h3>
                            <button onClick={() => setShowAddBank(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSaveNewBank} className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Bank Name</label>
                                <input required className="w-full border border-slate-300 rounded-lg p-2 text-sm" value={bankDetails.bankName} onChange={e => setBankDetails({ ...bankDetails, bankName: e.target.value })} placeholder="e.g. Chase Bank" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Bank Address</label>
                                <input className="w-full border border-slate-300 rounded-lg p-2 text-sm" value={bankDetails.bankAddress} onChange={e => setBankDetails({ ...bankDetails, bankAddress: e.target.value })} placeholder="e.g. 123 Wall St, NY" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Account Number</label>
                                <input required className="w-full border border-slate-300 rounded-lg p-2 text-sm font-mono" value={bankDetails.accountNumber} onChange={e => setBankDetails({ ...bankDetails, accountNumber: e.target.value })} />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Routing (Wire)</label>
                                    <input className="w-full border border-slate-300 rounded-lg p-2 text-sm font-mono" value={bankDetails.routingNumber} onChange={e => setBankDetails({ ...bankDetails, routingNumber: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">SWIFT / BIC</label>
                                    <input className="w-full border border-slate-300 rounded-lg p-2 text-sm font-mono" value={bankDetails.swiftCode} onChange={e => setBankDetails({ ...bankDetails, swiftCode: e.target.value })} />
                                </div>
                            </div>
                            <div className="bg-blue-50 p-3 rounded border border-blue-100 text-xs text-blue-800">
                                This bank profile will be linked to <strong>{billToName || 'the current company'}</strong> for future use.
                            </div>
                            <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 rounded-lg hover:bg-blue-700 mt-2">
                                Save Bank Profile
                            </button>
                        </form>
                    </div>
                </div>
            )}


            {/* Link BL Modal */}
            {openLinkBLModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={() => { setOpenLinkBLModal(null); setSelectedBLForModal(''); }}>
                    <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md animate-in zoom-in-95 fade-in duration-200" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                <Link2 className="text-blue-600" size={20} />
                                Link Bill of Lading
                            </h3>
                            <button onClick={() => { setOpenLinkBLModal(null); setSelectedBLForModal(''); }} className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Select Bill of Lading</label>
                                <select
                                    value={selectedBLForModal}
                                    onChange={(e) => setSelectedBLForModal(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                >
                                    <option value="">-- Select BL --</option>
                                    {billOfLadings.map(bl => (
                                        <option key={bl.id} value={bl.blNumber}>{bl.blNumber}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex gap-3 justify-end pt-2">
                                <button
                                    onClick={() => { setOpenLinkBLModal(null); setSelectedBLForModal(''); }}
                                    className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleLinkBLToInvoice}
                                    disabled={!selectedBLForModal}
                                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Save Link
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* PDF Preview Modal */}
            <PDFPreviewModal
                isOpen={!!previewUrl}
                onClose={handleClosePreview}
                pdfUrl={previewUrl}
                pdfBlob={previewBlob}
                title={previewTitle}
                fileName={previewFileName}
                onEmail={() => {
                    const mailtoLink = `mailto:?subject=${encodeURIComponent(`${previewTitle} - ${previewFileName}`)}&body=${encodeURIComponent("Please find the attached document.")}`;
                    window.open(mailtoLink, '_blank');
                }}
                onDownload={previewDownloadFn || undefined}
            />
        </div>
    );
};

export default InvoiceEngine;
