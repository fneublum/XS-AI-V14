import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Booking, BillOfLading, Port, Shipment, User, CargoAgent, Role } from '../types';
import { Search, LayoutGrid, List, FileText, ClipboardList, Eye, Trash2, Filter, CheckCircle2, Calendar, Container, X, Pencil, Save, Ship, ShoppingBag, Building2, Anchor, ArrowUp, ArrowDown, ArrowUpDown, UploadCloud, Loader2, ScanEye, Sparkles } from 'lucide-react';
import { getSupabaseClient } from '../services/supabase';
import { analyzeDocument } from '../services/geminiService';

interface LogisticsDocumentsProps {
    activeType: 'BL' | 'BOOKING';
    bookings: Booking[];
    billOfLadings: BillOfLading[];
    onDeleteBooking: (id: string) => void;
    onUpdateBooking: (b: Booking) => void;
    onSaveBooking?: (b: Booking) => Promise<void> | void;
    onDeleteBL: (id: string) => void;
    onUpdateBillOfLading: (bl: BillOfLading) => void;
    onSaveBL?: (bl: BillOfLading) => Promise<void> | void;
    ports: Port[];
    shipments: Shipment[];
    currentCompanyId?: string;
    currentUser?: User; // For cargo agent filtering
    cargoAgents?: CargoAgent[]; // For cargo agent filtering
}

// Helper to extract unique values for filtering
const getUniqueValues = (data: any[], key: string) => {
    const values = data.map(item => item[key]).filter(v => v !== undefined && v !== null && v !== '');
    return Array.from(new Set(values)).sort();
};

// --- Formatters ---
const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    // Handle YYYY-MM-DD and full ISO strings
    const date = new Date(dateStr);
    // Check if the date is valid
    if (isNaN(date.getTime())) return dateStr;
    // Add timezone offset to prevent day-before issues
    const adjustedDate = new Date(date.getTime() + date.getTimezoneOffset() * 60000);
    return adjustedDate.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
};

const getTransitTime = (etd?: string, eta?: string) => {
    if (!etd || !eta) return '-';
    const start = new Date(etd).getTime();
    const end = new Date(eta).getTime();
    if (isNaN(start) || isNaN(end)) return '-';
    const diff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : '-';
};

const getFreeTimeNum = (ft?: string) => {
    if (!ft) return '-';
    const match = ft.match(/\d+/);
    return match ? match[0] : '-';
};

const getFirstWord = (str?: string) => {
    if (!str) return '';
    return str.split(' ')[0];
};

const formatContainerDisplay = (val?: string) => {
    if (!val) return '-';
    try {
        const clean = val.trim();
        if (clean.startsWith('[') && clean.endsWith(']')) {
            const parsed = JSON.parse(clean);
            if (Array.isArray(parsed)) {
                return parsed.join(' / ');
            }
        }
    } catch (e) { }
    return val;
};

const getContainerCount = (equipment?: string) => {
    if (!equipment) return 0;
    // Try to match "2 x 40" or "2x40" or "2 * 40" pattern
    const match = equipment.match(/^(\d+)\s*[xX*]/);
    if (match) {
        return parseInt(match[1]);
    }
    // If just "40HC" or similar, assume 1
    return 1;
};

const LogisticsDocuments: React.FC<LogisticsDocumentsProps> = ({
    activeType,
    bookings,
    billOfLadings,
    onDeleteBooking,
    onUpdateBooking,
    onSaveBooking,
    onDeleteBL,
    onUpdateBillOfLading,
    onSaveBL,
    ports,
    shipments,
    currentCompanyId,
    currentUser,
    cargoAgents = []
}) => {
    // --- ROLE BASED ACCESS LOGIC (same as FreightQuotes) ---
    const isCargoAgentUser = currentUser?.role === Role.CARGO_AGENT;
    const linkedAgentName = isCargoAgentUser
        ? cargoAgents.find(a => a.id === currentUser?.linked_entity_id)?.name || ''
        : '';

    // Filter bookings: if Cargo Agent, only show bookings matching their linked agent name
    const visibleBookings = bookings.filter(bk => {
        if (!isCargoAgentUser) return true; // Non-agents see all
        if (!linkedAgentName) return true; // No linked agent = show all (fallback)

        // Match booking's agentName against the linked agent name (case-insensitive)
        const bookingAgent = (bk.agentName || '').toUpperCase();
        const targetAgent = linkedAgentName.toUpperCase();

        // Flexible match: booking agent contains target agent name OR vice versa
        return bookingAgent.includes(targetAgent) || targetAgent.includes(bookingAgent);
    });

    // Filter BLs: if Cargo Agent, only show BLs matching their linked agent name
    const visibleBillOfLadings = billOfLadings.filter(bl => {
        if (!isCargoAgentUser) return true; // Non-agents see all
        if (!linkedAgentName) return true; // No linked agent = show all (fallback)

        // Match BL's agentName against the linked agent name (case-insensitive)
        const blAgent = (bl.agentName || '').toUpperCase();
        const targetAgent = linkedAgentName.toUpperCase();

        // Flexible match: BL agent contains target agent name OR vice versa
        return blAgent.includes(targetAgent) || targetAgent.includes(blAgent);
    });

    const [viewMode, setViewMode] = useState<'grid' | 'table'>('table');
    const [searchTerm, setSearchTerm] = useState('');

    // Lookups for Reference Data
    const [soLookup, setSoLookup] = useState<Record<string, string>>({});
    const [compLookup, setCompLookup] = useState<Record<string, string>>({});

    // Data Lists for Dropdowns
    const [companiesList, setCompaniesList] = useState<{ id: string, name: string }[]>([]);
    const [customersList, setCustomersList] = useState<{ id: string, name: string }[]>([]);
    const [salesOrdersList, setSalesOrdersList] = useState<{ id: string, orderNumber: string }[]>([]);

    // Edit State for Booking
    const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
    const [bookingFormData, setBookingFormData] = useState<Partial<Booking>>({});

    // Edit State for BL
    const [editingBL, setEditingBL] = useState<BillOfLading | null>(null);
    const [blFormData, setBlFormData] = useState<{ pol: string, pod: string, etd: string, eta: string, shipmentId?: string }>({ pol: '', pod: '', etd: '', eta: '' });

    // Document Viewer State
    const [viewingDoc, setViewingDoc] = useState<{ url: string; title: string; isBlob: boolean } | null>(null);

    const [colWidths, setColWidths] = useState({
        docNumber: 150,
        agent: 120,
        party: 160,
        shipper: 160,
        salesOrder: 130,
        containerCount: 100,
        consignee: 180,
        container: 220,
        vessel: 150,
        route: 200,
        etd: 100,
        eta: 100,
        time: 120,
        status: 120,
        actions: 120
    });

    const [activeFilterColumn, setActiveFilterColumn] = useState<string | null>(null);
    const [filters, setFilters] = useState<Record<string, string[]>>({});
    const [filterSearch, setFilterSearch] = useState('');
    // Default sort: ETD Ascending (Oldest First) for Bookings - set via useEffect below
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
    const filterMenuRef = useRef<HTMLDivElement>(null);

    // OCR Upload State
    const [showOcrModal, setShowOcrModal] = useState(false);
    const [ocrFile, setOcrFile] = useState<File | null>(null);
    const [ocrPreviewUrl, setOcrPreviewUrl] = useState<string | null>(null);
    const [ocrProcessing, setOcrProcessing] = useState(false);
    const [ocrDragActive, setOcrDragActive] = useState(false);
    const [ocrError, setOcrError] = useState<string | null>(null);
    const [ocrSuccess, setOcrSuccess] = useState(false);
    const ocrFileInputRef = useRef<HTMLInputElement>(null);

    // Ensure default sort and filter is applied when switching to Bookings
    useEffect(() => {
        if (activeType === 'BOOKING') {
            setSortConfig({ key: 'etd', direction: 'asc' });
            // Default filter: show only AVAILABLE bookings
            setFilters({ status: ['AVAILABLE'] });
        } else {
            setSortConfig(null);
            setFilters({});
        }
    }, [activeType]);

    useEffect(() => {
        // Fetch auxiliary data for lookups (Sales Orders & Companies & Customers)
        const fetchLookups = async () => {
            const client = getSupabaseClient();
            if (!client) return;

            // Parallel fetch
            const [soRes, compRes, custRes] = await Promise.all([
                client.from('sales_orders').select('id, orderNumber'),
                client.from('companies').select('id, name'),
                client.from('customers').select('id, name')
            ]);

            if (soRes.data) {
                setSalesOrdersList(soRes.data);
                const map: Record<string, string> = {};
                soRes.data.forEach((so: any) => map[so.id] = so.orderNumber);
                setSoLookup(map);
            }
            if (compRes.data) {
                setCompaniesList(compRes.data);
                const map: Record<string, string> = {};
                compRes.data.forEach((c: any) => map[c.id] = c.name);
                setCompLookup(map);
            }
            if (custRes.data) {
                setCustomersList(custRes.data);
            }
        };
        fetchLookups();
    }, []);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (filterMenuRef.current && !filterMenuRef.current.contains(event.target as Node)) {
                setActiveFilterColumn(null);
                setFilterSearch('');
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const getPortCode = (portString?: string): string => {
        if (!portString) return '';
        const s = portString.trim();
        const match = s.match(/\(([^)]+)\)$/);
        if (match) return match[1];
        const portMatch = ports.find(p => p.name.toLowerCase() === s.toLowerCase());
        if (portMatch) return portMatch.code;
        const isCode = ports.some(p => p.code.toUpperCase() === s.toUpperCase());
        if (isCode) return s.toUpperCase();
        return s;
    };

    const startResize = (e: React.MouseEvent, colKey: keyof typeof colWidths) => {
        e.preventDefault();
        const startX = e.pageX;
        const startWidth = colWidths[colKey];
        const onMouseMove = (moveEvent: MouseEvent) => {
            const newWidth = Math.max(50, startWidth + (moveEvent.pageX - startX));
            setColWidths(prev => ({ ...prev, [colKey]: newWidth }));
        };
        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    const handleEditBooking = (booking: Booking) => {
        setBookingFormData(booking);
        setEditingBooking(booking);
    };

    const handleSaveBooking = async () => {
        if (!editingBooking) return;
        await onUpdateBooking({ ...bookingFormData, id: editingBooking.id } as Booking);
        setEditingBooking(null);
    };

    // --- BL EDITING LOGIC ---
    const handleEditBL = (bl: BillOfLading) => {
        const linkedShipment = shipments.find(s => s.blNumber === bl.blNumber);
        setBlFormData({
            pol: bl.portLoading || '',
            pod: bl.portDischarge || '',
            etd: bl.shippedDate || '',
            eta: bl.eta || (linkedShipment ? (linkedShipment.eta || '') : ''), // Prioritize BL's eta, fallback to shipment
            shipmentId: linkedShipment?.id
        });
        setEditingBL(bl);
    };

    const handleSaveBL = async () => {
        if (!editingBL) return;
        const client = getSupabaseClient();
        if (!client) return;

        try {
            // 1. Update BL via Prop (handles DB + UI state)
            const updatedBL: BillOfLading = {
                ...editingBL,
                portLoading: blFormData.pol,
                portDischarge: blFormData.pod,
                shippedDate: blFormData.etd || null, // Ensure empty string becomes null for Date column
                eta: blFormData.eta || null // Save ETA to BL record
            } as BillOfLading; // Cast to ensure compatibility

            await onUpdateBillOfLading(updatedBL);

            // 2. Update Shipment Table (for ETA) if linked - Side Effect
            if (blFormData.shipmentId && client) {
                // Also update origin/dest in shipment to match BL for consistency
                const { error: shipError } = await client.from('shipments').update({
                    eta: blFormData.eta,
                    origin: blFormData.pol,
                    destination: blFormData.pod
                }).eq('id', blFormData.shipmentId);

                if (shipError) console.error("Error syncing shipment:", shipError);
            }

            alert("Bill of Lading updated successfully.");
            setEditingBL(null);
        } catch (e: any) {
            console.error("Error updating BL:", e);
            alert("Failed to update: " + e.message);
        }
    };

    // --- OCR Processing Logic ---
    const BOOKING_EXTRACTION_PROMPT = `Extract the following fields from this SHIPPING BOOKING CONFIRMATION document.
    Return a valid JSON object with the exact keys listed below. If a field is not found, return null.
    
    IMPORTANT: 
    - For PORT fields (POL, POD), extract the full port name or code (e.g., "HOUSTON, TX", "MANAUS", "USMIA").
    - For DATE fields (ETD, ETA, CUT-OFF dates), convert to YYYY-MM-DD format when possible.
    
    KEYS:
    DOC_NUMBER: The Booking Number or Confirmation Number.
    CUSTOMER: Customer / Shipper / Contact name.
    CARGO_AGENT: The Cargo Agent, Freight Forwarder, or Shipping Line name (e.g., MSC, OOCL, Maersk, Hapag-Lloyd).
    VESSEL_VOYAGE: Vessel Name and Voyage Number combined (e.g., "MSC VANCOUVER / 608S").
    POL: Port of Loading / Origin Port - the port name or code where cargo is loaded.
    POD: Port of Discharge / Destination Port - the port name or code where cargo is delivered.
    EQUIPMENT: Equipment Type and Quantity (e.g., "2 x 40 DRY", "1 x 40 HC").
    ETD: Estimated Time of Departure date - format as YYYY-MM-DD if possible.
    ETA: Estimated Time of Arrival date - format as YYYY-MM-DD if possible.
    CARGO_CUT_OFF: Cargo/Terminal Cut-Off date - format as YYYY-MM-DD if possible.
    VGM_CUT_OFF: VGM Cut-Off date - format as YYYY-MM-DD if possible.
    DRAFT_CUT_OFF: Documentation/SI Cut-Off date - format as YYYY-MM-DD if possible.
    FREE_TIME: Free Time / Detention / Demurrage terms (e.g., "14 Days Free").
    TERMINAL: Terminal Information / Pickup Location / Depot.`;

    const BL_EXTRACTION_PROMPT = `Extract the following fields from this BILL OF LADING document.
    Return a valid JSON object with the exact keys listed below. If a field is not found, return null.
    
    IMPORTANT: 
    - For PORT fields (PORT_LOADING, PORT_DISCHARGE), extract the full port name or code.
    - For DATE fields (SHIPPED_DATE, ETA), convert to YYYY-MM-DD format when possible.
    
    KEYS:
    BL_NUMBER: Bill of Lading Number.
    BOOKING_NUMBER: Related Booking Number if present.
    SHIPPER: Shipper Name and Address.
    CONSIGNEE: Consignee Name and Address.
    NOTIFY_PARTY: Notify Party Name and Address.
    VESSEL_VOYAGE: Vessel Name and Voyage Number combined.
    PORT_LOADING: Port of Loading / Origin Port.
    PORT_DISCHARGE: Port of Discharge / Destination Port.
    PLACE_RECEIPT: Place of Receipt.
    PLACE_DELIVERY: Place of Delivery / Final Destination.
    SHIPPED_DATE: Shipped on Board Date - format as YYYY-MM-DD if possible.
    ETA: Estimated Time of Arrival - format as YYYY-MM-DD if possible.
    CONTAINER: Container Number(s).
    SEAL: Seal Number(s).
    DESCRIPTION: Description of Goods / Cargo Description.
    GROSS_WEIGHT: Gross Weight.
    PACKAGES: Number of Packages.
    MEASUREMENT: Measurement / Volume.
    FREIGHT_PAYABLE: Freight Payable At / Freight Terms.
    CARGO_AGENT: Shipping Line / Carrier / Agent Name (e.g., MSC, OOCL, Maersk).
    REMARKS: Special Remarks or Notes.`;

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
        setOcrSuccess(false);

        const reader = new FileReader();
        reader.onload = (e) => {
            const result = e.target?.result as string;
            if (result) {
                setOcrPreviewUrl(result);
            }
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

    const processOcrBooking = useCallback(async () => {
        if (!ocrFile || !ocrPreviewUrl || !onSaveBooking) return;

        setOcrProcessing(true);
        setOcrError(null);

        try {
            const base64Data = ocrPreviewUrl.split(',')[1];
            if (!base64Data) throw new Error("Invalid file data");

            const rawResult = await analyzeDocument(base64Data, ocrFile.type, BOOKING_EXTRACTION_PROMPT);
            const analysisResult = String(rawResult ?? '');

            // Parse JSON from response
            let cleanText = analysisResult;
            if (cleanText.startsWith('"') && cleanText.includes('\\"')) {
                cleanText = cleanText.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '').trim();
            }
            const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("No JSON found in response");

            const data = JSON.parse(jsonMatch[0]);
            console.log('OCR Extracted Data:', data); // Debug logging

            const companyId = currentCompanyId || 'ALL';
            const created = new Date().toISOString();

            // Helper to normalize dates
            const normalizeDate = (dateStr: any): string => {
                if (!dateStr) return '';
                const s = String(dateStr).trim();
                if (!s) return '';

                // Try parsing as date
                const d = new Date(s);
                if (!isNaN(d.getTime())) {
                    return d.toISOString().split('T')[0]; // YYYY-MM-DD
                }

                // Try common formats like "Jan 25, 2026" or "25-Jan-2026"
                const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
                const lower = s.toLowerCase();
                for (let i = 0; i < monthNames.length; i++) {
                    if (lower.includes(monthNames[i])) {
                        const parsed = new Date(s);
                        if (!isNaN(parsed.getTime())) {
                            return parsed.toISOString().split('T')[0];
                        }
                    }
                }
                return s; // Return as-is if unparseable
            };

            // Helper to lookup port code from name
            const lookupPortCode = (portStr: any): string => {
                if (!portStr) return '';
                const s = String(portStr).trim().toUpperCase();
                if (!s) return '';

                // Check if it's already a port code (exact match)
                const exactMatch = ports.find(p => p.code.toUpperCase() === s);
                if (exactMatch) return exactMatch.code;

                // Try matching by port name (contains or starts with)
                const byName = ports.find(p =>
                    p.name.toUpperCase().includes(s) ||
                    s.includes(p.name.toUpperCase()) ||
                    p.name.toUpperCase().startsWith(s.split(',')[0].trim()) ||
                    s.startsWith(p.name.toUpperCase())
                );
                if (byName) return byName.code;

                // Try matching by partial code or city name extraction
                const cityPart = s.split(',')[0].trim();
                const byCity = ports.find(p =>
                    p.name.toUpperCase().includes(cityPart) ||
                    p.code.toUpperCase().includes(cityPart.substring(0, 3))
                );
                if (byCity) return byCity.code;

                console.log('Port not found in lookup, returning original:', s);
                return s; // Return original if no match
            };

            const bookingData: Booking = {
                id: `BK${Date.now()}`,
                companyId,
                createdAt: created,
                bookingNumber: String(data.DOC_NUMBER || ''),
                customer: String(data.CUSTOMER || ''),
                agentName: String(data.CARGO_AGENT || ''),
                vesselVoyage: String(data.VESSEL_VOYAGE || ''),
                pol: lookupPortCode(data.POL),
                pod: lookupPortCode(data.POD),
                equipment: String(data.EQUIPMENT || ''),
                etd: normalizeDate(data.ETD),
                eta: normalizeDate(data.ETA),
                cargoCutOff: normalizeDate(data.CARGO_CUT_OFF),
                vgmCutOff: normalizeDate(data.VGM_CUT_OFF),
                draftCutOff: normalizeDate(data.DRAFT_CUT_OFF),
                freeTime: String(data.FREE_TIME || ''),
                terminal: String(data.TERMINAL || ''),
                originalDocument: ocrPreviewUrl,
                status: 'AVAILABLE'
            };

            console.log('Saving Booking:', bookingData); // Debug logging

            await onSaveBooking(bookingData);
            setOcrSuccess(true);

            // Auto-close after success
            setTimeout(() => {
                setShowOcrModal(false);
                setOcrFile(null);
                setOcrPreviewUrl(null);
                setOcrSuccess(false);
            }, 1500);

        } catch (err: any) {
            console.error("OCR processing failed:", err);
            setOcrError(`OCR failed: ${err.message || String(err)}`);
        } finally {
            setOcrProcessing(false);
        }
    }, [ocrFile, ocrPreviewUrl, onSaveBooking, currentCompanyId]);

    const processOcrBL = useCallback(async () => {
        if (!ocrFile || !ocrPreviewUrl || !onSaveBL) return;

        setOcrProcessing(true);
        setOcrError(null);

        try {
            const base64Data = ocrPreviewUrl.split(',')[1];
            if (!base64Data) throw new Error("Invalid file data");

            const rawResult = await analyzeDocument(base64Data, ocrFile.type, BL_EXTRACTION_PROMPT);
            const analysisResult = String(rawResult ?? '');

            // Parse JSON from response
            let cleanText = analysisResult;
            if (cleanText.startsWith('"') && cleanText.includes('\\"')) {
                cleanText = cleanText.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '').trim();
            }
            const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("No JSON found in response");

            const data = JSON.parse(jsonMatch[0]);
            console.log('OCR Extracted BL Data:', data);

            const companyId = currentCompanyId || 'ALL';
            const created = new Date().toISOString();

            // Helper to normalize dates
            const normalizeDate = (dateStr: any): string => {
                if (!dateStr) return '';
                const s = String(dateStr).trim();
                if (!s) return '';
                const d = new Date(s);
                if (!isNaN(d.getTime())) {
                    return d.toISOString().split('T')[0];
                }
                return s;
            };

            // Helper to lookup port code from name
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

            const blData: BillOfLading = {
                id: `BL${Date.now()}`,
                companyId,
                createdAt: created,
                blNumber: String(data.BL_NUMBER || ''),
                bookingNumber: String(data.BOOKING_NUMBER || ''),
                shipper: String(data.SHIPPER || ''),
                consignee: String(data.CONSIGNEE || ''),
                notifyParty: String(data.NOTIFY_PARTY || ''),
                vesselVoyage: String(data.VESSEL_VOYAGE || ''),
                portLoading: lookupPortCode(data.PORT_LOADING),
                portDischarge: lookupPortCode(data.PORT_DISCHARGE),
                placeReceipt: String(data.PLACE_RECEIPT || ''),
                placeDelivery: String(data.PLACE_DELIVERY || ''),
                shippedDate: normalizeDate(data.SHIPPED_DATE),
                eta: normalizeDate(data.ETA),
                container: String(data.CONTAINER || ''),
                seal: String(data.SEAL || ''),
                description: String(data.DESCRIPTION || ''),
                grossWeight: String(data.GROSS_WEIGHT || ''),
                packages: String(data.PACKAGES || ''),
                measurement: String(data.MEASUREMENT || ''),
                freightPayable: String(data.FREIGHT_PAYABLE || ''),
                agentName: String(data.CARGO_AGENT || ''),
                remarks: String(data.REMARKS || ''),
                originalDocument: ocrPreviewUrl,
                status: 'ACTIVE'
            };

            console.log('Saving BL:', blData);

            await onSaveBL(blData);
            setOcrSuccess(true);

            // Auto-close after success
            setTimeout(() => {
                setShowOcrModal(false);
                setOcrFile(null);
                setOcrPreviewUrl(null);
                setOcrSuccess(false);
            }, 1500);

        } catch (err: any) {
            console.error("OCR BL processing failed:", err);
            setOcrError(`OCR failed: ${err.message || String(err)}`);
        } finally {
            setOcrProcessing(false);
        }
    }, [ocrFile, ocrPreviewUrl, onSaveBL, currentCompanyId, ports]);

    const resetOcrModal = () => {
        setShowOcrModal(false);
        setOcrFile(null);
        setOcrPreviewUrl(null);
        setOcrError(null);
        setOcrSuccess(false);
        if (ocrFileInputRef.current) ocrFileInputRef.current.value = '';
    };

    const rawData = activeType === 'BL'
        ? visibleBillOfLadings.map(bl => {
            const linkedShipment = shipments.find(s => s.blNumber === bl.blNumber);
            return {
                id: bl.id,
                type: 'BL',
                docNumber: bl.blNumber,
                agent: getFirstWord(bl.agentName),
                party: bl.shipper,
                consignee: bl.consignee,
                container: bl.container,
                vessel: bl.vesselVoyage,
                route: `${getPortCode(bl.portLoading)} -> ${getPortCode(bl.portDischarge)}`,
                etd: bl.shippedDate,
                eta: bl.eta || linkedShipment?.eta, // Prioritize BL's eta, fallback to shipment ETA
                raw: bl
            };
        })
        : visibleBookings.map(bk => ({
            id: bk.id,
            type: 'BOOKING',
            docNumber: bk.bookingNumber,
            agent: getFirstWord(bk.agentName),
            party: bk.customer,
            vessel: bk.vesselVoyage,
            route: `${getPortCode(bk.pol)} -> ${getPortCode(bk.pod)}`,
            etd: bk.etd,
            eta: bk.eta,
            freeTime: bk.freeTime,
            transitTime: getTransitTime(bk.etd, bk.eta),
            status: bk.status || 'REQUESTED',
            // New Fields
            containerCount: getContainerCount(bk.equipment),
            salesOrder: bk.salesOrderId ? (soLookup[bk.salesOrderId] || 'Unknown') : '-',
            shipper: compLookup[bk.companyId] || '-',
            raw: bk
        }));

    const getFilteredData = () => {
        const lowerSearch = searchTerm.toLowerCase();
        return rawData.filter(row => {
            const docNum = row.docNumber, party = row.party, vessel = row.vessel || '', consignee = (row as any).consignee || '', container = (row as any).container || '';
            const matchesSearch = (docNum && docNum.toLowerCase().includes(lowerSearch)) || (party && party.toLowerCase().includes(lowerSearch)) || (vessel && vessel.toLowerCase().includes(lowerSearch)) || (consignee && consignee.toLowerCase().includes(lowerSearch)) || (container && container.toLowerCase().includes(lowerSearch));
            if (!matchesSearch) return false;
            for (const [key, selectedValues] of Object.entries(filters)) {
                const values = selectedValues as string[];
                if (values.length > 0) {
                    const cellValue = String((row as any)[key] || '');
                    if (!values.includes(cellValue)) return false;
                }
            }
            return true;
        });
    };

    // SORTING LOGIC
    const filteredData = getFilteredData();
    const data = [...filteredData].sort((a, b) => {
        if (!sortConfig) return 0;
        const key = sortConfig.key;
        let valA = (a as any)[key];
        let valB = (b as any)[key];

        // Handle Date Columns specifically
        if (key === 'etd' || key === 'eta' || key === 'createdAt') {
            const dateA = valA ? new Date(valA).getTime() : 0;
            const dateB = valB ? new Date(valB).getTime() : 0;
            return sortConfig.direction === 'asc' ? dateA - dateB : dateB - dateA;
        }

        // Generic String/Number sort
        valA = (valA || '').toString().toLowerCase();
        valB = (valB || '').toString().toLowerCase();

        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
    });

    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

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
    const clearColumnFilter = (column: string) => setFilters(prev => { const next = { ...prev }; delete next[column]; return next; });

    const openDocument = (docUrl?: string, title: string = 'Document') => {
        if (!docUrl) {
            alert("No document available for this item.");
            return;
        }
        try {
            if (docUrl.startsWith('data:')) {
                // Safe way to open base64 PDF
                const arr = docUrl.split(',');
                const mime = arr[0].match(/:(.*?);/)?.[1] || 'application/pdf';
                const bstr = atob(arr[1]);
                let n = bstr.length;
                const u8arr = new Uint8Array(n);
                while (n--) {
                    u8arr[n] = bstr.charCodeAt(n);
                }
                const blob = new Blob([u8arr], { type: mime });
                const blobUrl = URL.createObjectURL(blob);
                setViewingDoc({ url: blobUrl, title, isBlob: true });
            } else {
                // Regular URL
                setViewingDoc({ url: docUrl, title, isBlob: false });
            }
        } catch (e) {
            console.error("Error preparing document", e);
            alert("Could not load document.");
        }
    };

    const closeDocument = () => {
        if (viewingDoc && viewingDoc.isBlob) {
            URL.revokeObjectURL(viewingDoc.url);
        }
        setViewingDoc(null);
    };

    const handleDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!window.confirm(`Are you sure you want to delete this ${activeType === 'BL' ? 'Bill of Lading' : 'Booking'}?`)) return;
        if (activeType === 'BL') onDeleteBL(id); else onDeleteBooking(id);
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'REQUESTED': return 'bg-amber-100 text-amber-700';
            case 'ACTIVE': return 'bg-blue-100 text-blue-700';
            case 'SHIPPED': return 'bg-emerald-100 text-emerald-700';
            case 'CANCELLED': return 'bg-red-100 text-red-700';
            default: return 'bg-slate-100 text-slate-600';
        }
    };

    const renderColumnHeader = (id: string | null, label: string, widthKey: keyof typeof colWidths, align: 'left' | 'center' | 'right' = 'left') => {
        const uniqueValues = id ? getUniqueValues(rawData, id) : [];
        const activeValues = (id ? filters[id] : []) || [];
        const isFilterActive = activeValues.length > 0;
        const alignClass = align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left';
        // For sort buttons, we always want the sort click to cover the label, and filter separate.

        return (
            <th className={`px-4 py-4 text-xs font-semibold text-slate-500 uppercase relative group ${alignClass}`} style={{ width: colWidths[widthKey] }}>
                <div className={`flex items-center ${align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : 'justify-start'} gap-2`}>

                    {/* Sortable Button Wrapper */}
                    <button
                        onClick={() => id && handleSort(id)}
                        disabled={!id}
                        className={`flex items-center gap-1 truncate ${id ? 'hover:text-slate-700 cursor-pointer' : 'cursor-default'}`}
                    >
                        {label}
                        {id && (
                            sortConfig?.key === id ? (
                                sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                            ) : (
                                <ArrowUpDown size={12} className="text-slate-300 opacity-50 group-hover:opacity-100 transition-opacity" />
                            )
                        )}
                    </button>

                    {id && (<button onClick={(e) => { e.stopPropagation(); setActiveFilterColumn(activeFilterColumn === id ? null : id); setFilterSearch(''); }} className={`p-1 rounded hover:bg-slate-200 transition-colors shrink-0 ${isFilterActive ? 'text-blue-600 bg-blue-50' : 'text-slate-400 opacity-0 group-hover:opacity-100'}`}><Filter size={14} fill={isFilterActive ? "currentColor" : "none"} /></button>)}
                </div>
                {id && activeFilterColumn === id && (<div ref={filterMenuRef} className="absolute top-full right-0 mt-1 w-64 bg-white rounded-lg shadow-xl border border-slate-200 z-50 overflow-hidden animate-in fade-in zoom-in-95 text-left font-sans normal-case"><div className="p-2 border-b border-slate-100"><div className="relative"><Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" /><input className="w-full pl-8 pr-2 py-1.5 text-xs border border-slate-200 rounded bg-slate-50 outline-none focus:ring-1 focus:ring-blue-500" placeholder="Search..." value={filterSearch} onChange={e => setFilterSearch(e.target.value)} autoFocus /></div></div><div className="max-h-48 overflow-y-auto p-1 custom-scrollbar"><button onClick={() => clearColumnFilter(id)} className="w-full text-left px-2 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded flex items-center gap-2"><X size={12} /> Clear Filter</button>{uniqueValues.filter(v => String(v).toLowerCase().includes(filterSearch.toLowerCase())).map(val => (<button key={String(val)} onClick={() => toggleFilter(id, String(val))} className="w-full text-left px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded flex items-center gap-2"><div className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${activeValues.includes(String(val)) ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'}`}>{activeValues.includes(String(val)) && <CheckCircle2 size={10} className="text-white" />}</div><span className="truncate">{String(val)}</span></button>))}</div></div>)}
                <div onMouseDown={(e) => startResize(e, widthKey)} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300 z-10" />
            </th>
        );
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div><h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">{activeType === 'BL' ? <FileText className="text-blue-600" /> : <ClipboardList className="text-teal-600" />}{activeType === 'BL' ? 'Bill of Ladings' : 'Booking Confirmations'}</h2><p className="text-slate-500 text-sm">Manage extracted logistics documents</p></div>
                <div className="flex gap-2 w-full md:w-auto">
                    <div className="relative flex-1 md:w-64"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><input type="text" placeholder="Search documents..." className="w-full pl-10 pr-4 py-2 border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} /></div>
                    {((activeType === 'BOOKING' && onSaveBooking) || (activeType === 'BL' && onSaveBL)) && (
                        <button
                            onClick={() => setShowOcrModal(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg font-semibold text-sm hover:from-purple-700 hover:to-indigo-700 transition-all shadow-md hover:shadow-lg"
                        >
                            <ScanEye size={18} />
                            OCR Upload
                        </button>
                    )}
                    <div className="bg-white border border-slate-200 rounded-lg p-1 flex gap-1"><button onClick={() => setViewMode('grid')} className={`p-2 rounded transition-all ${viewMode === 'grid' ? 'bg-slate-100 text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}><LayoutGrid size={18} /></button><button onClick={() => setViewMode('table')} className={`p-2 rounded transition-all ${viewMode === 'table' ? 'bg-slate-100 text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}><List size={18} /></button></div>
                </div>
            </div>
            <div className="w-full">{data.length === 0 ? (<div className="p-12 text-center text-slate-400 border border-dashed border-slate-200 rounded-xl"><Container size={48} className="mx-auto mb-4 opacity-20" /><p>No documents found.</p></div>) : viewMode === 'grid' ? (<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{data.map((doc: any) => { const isBooking = activeType === 'BOOKING'; const customerFirstWord = isBooking && doc.party ? getFirstWord(doc.party) : ''; const transitTime = isBooking ? doc.transitTime : '-'; const freeTime = isBooking ? getFreeTimeNum(doc.freeTime) : '-'; const partyName = isBooking ? customerFirstWord : getFirstWord(doc.party); const hasDoc = !!doc.raw.originalDocument; return (<div key={doc.id} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow group relative"><div className="flex justify-between items-start mb-3"><div className="flex items-center gap-3"><div className={`p-2 rounded-lg ${activeType === 'BL' ? 'bg-blue-50 text-blue-600' : 'bg-teal-50 text-teal-600'}`}>{activeType === 'BL' ? <FileText size={20} /> : <ClipboardList size={20} />}</div><div><h3 className="font-bold text-slate-800 text-lg">{doc.docNumber}</h3><p className="text-xs text-slate-500 font-mono">{doc.vessel}</p>{partyName && (<p className="text-xs text-teal-600 font-bold mt-0.5 uppercase tracking-wide">{partyName}</p>)}</div></div><div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={() => hasDoc && openDocument(doc.raw.originalDocument, doc.docNumber)} disabled={!hasDoc} className={`p-1 rounded transition-colors ${hasDoc ? 'text-slate-400 hover:text-blue-500 hover:bg-blue-50' : 'text-slate-200 cursor-not-allowed'}`}><Eye size={16} /></button><button onClick={(e) => handleDelete(doc.id, e)} className="text-slate-400 hover:text-red-500 p-1 rounded hover:bg-red-50"><Trash2 size={16} /></button></div></div><div className="space-y-2 mb-3 bg-slate-50 p-3 rounded-lg text-xs border border-slate-100"><div className="flex justify-between"><span className="text-slate-500">From</span><span className="font-bold text-slate-700 font-mono">{getPortCode(doc.raw.pol || doc.raw.portLoading)}</span></div><div className="flex justify-between"><span className="text-slate-500">To</span><span className="font-bold text-slate-700 font-mono">{getPortCode(doc.raw.pod || doc.raw.portDischarge)}</span></div></div><div className="grid grid-cols-2 gap-2 text-xs border-t border-slate-100 pt-3">{isBooking ? (<><div className="flex items-center gap-2"><Calendar size={12} className="text-slate-400" /><span className="text-slate-600">{formatDate(doc.etd)} - {formatDate(doc.eta)}</span></div><div className="text-right font-mono font-bold text-teal-600">{transitTime}d / {freeTime}d</div><div className="col-span-2 pt-2 border-t border-slate-100 mt-2"><span className={`inline-block px-2 py-1 rounded-full text-xs font-bold ${getStatusColor(doc.status)}`}>{doc.status}</span></div></>) : (<div className="col-span-2 flex items-center gap-2"><Calendar size={12} className="text-slate-400" /> <span className="text-slate-600">{doc.raw.createdAt ? new Date(doc.raw.createdAt).toLocaleDateString() : 'N/A'}</span></div>)}</div></div>) })}</div>) : (<div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden overflow-x-auto"><table className="w-full text-left border-collapse table-fixed min-w-[1200px]"><thead className="bg-slate-50 border-b border-slate-200"><tr>{renderColumnHeader(activeType === 'BL' ? 'docNumber' : 'docNumber', activeType === 'BL' ? 'BL Number' : 'Booking #', 'docNumber')}{renderColumnHeader('agent', 'Cargo Agent', 'agent')}{activeType === 'BOOKING' && renderColumnHeader('shipper', 'Shipper', 'shipper')}{activeType === 'BOOKING' && renderColumnHeader('containerCount', '# Cntrs', 'containerCount', 'center')}{activeType === 'BOOKING' && renderColumnHeader('status', 'Status', 'status', 'center')}{renderColumnHeader('party', activeType === 'BL' ? 'Shipper' : 'Customer', 'party')}{activeType === 'BL' && renderColumnHeader('consignee', 'Consignee', 'consignee')}{activeType === 'BOOKING' && renderColumnHeader('salesOrder', 'Sales Order', 'salesOrder')}{activeType === 'BL' && renderColumnHeader('container', 'Container', 'container')}{renderColumnHeader('route', 'Route', 'route')}{renderColumnHeader('etd', 'ETD', 'etd', 'center')}{renderColumnHeader('eta', 'ETA', 'eta', 'center')}{activeType === 'BOOKING' && renderColumnHeader('transitTime', 'TT/FT', 'time', 'center')}{renderColumnHeader('vessel', 'Vessel', 'vessel')}{renderColumnHeader(null, 'Actions', 'actions', 'right')}</tr></thead><tbody className="divide-y divide-slate-100">{data.map((doc: any) => { const isBooking = activeType === 'BOOKING'; const customerFirstWord = isBooking && doc.party ? getFirstWord(doc.party) : ''; const displayShipper = isBooking ? customerFirstWord : getFirstWord(doc.party); const displayConsignee = !isBooking ? getFirstWord(doc.consignee) : ''; const linkedShipment = activeType === 'BL' ? shipments.find(s => s.blNumber === doc.docNumber) : null; const transitTime = isBooking ? doc.transitTime : '-'; const freeTime = isBooking ? getFreeTimeNum(doc.freeTime) : '-'; const hasDoc = !!doc.raw.originalDocument; return (<tr key={doc.id} className="hover:bg-slate-50 transition-colors"><td className="px-4 py-1 font-mono font-bold text-slate-700 text-sm truncate">{doc.docNumber}</td><td className="px-4 py-1 text-sm text-slate-600 truncate font-bold text-blue-600">{doc.agent}</td>{isBooking && (<td className="px-4 py-1 text-sm text-slate-600 truncate"><div className="flex items-center gap-1"><Building2 size={12} className="text-slate-400" /> {getFirstWord(doc.shipper)}</div></td>)}{isBooking && (<td className="px-4 py-1 text-sm text-slate-700 font-bold text-center">{doc.containerCount}</td>)}{isBooking && (<td className="px-4 py-1 text-center"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${getStatusColor(doc.status)}`}>{doc.status}</span></td>)}<td className="px-4 py-1 text-sm text-slate-700 truncate">{displayShipper}</td>{activeType === 'BL' && (<td className="px-4 py-1 text-sm text-slate-700 truncate">{displayConsignee}</td>)}{isBooking && (<td className="px-4 py-1 text-sm text-blue-600 font-mono font-bold truncate"><div className="flex items-center gap-1"><ShoppingBag size={12} /> {doc.salesOrder}</div></td>)}{activeType === 'BL' && (<td className="px-4 py-1 text-sm text-slate-700 truncate font-mono">{formatContainerDisplay(doc.container)}</td>)}<td className="px-4 py-1 text-sm text-slate-500 truncate font-mono">{doc.route}</td><td className="px-4 py-1 text-sm text-slate-600 text-center">{formatDate(isBooking ? doc.etd : doc.raw.shippedDate)}</td><td className="px-4 py-1 text-sm text-slate-600 text-center">{formatDate(doc.eta)}</td>{isBooking && (<td className="px-4 py-1 text-sm font-mono font-bold text-teal-600 text-center">{transitTime} / {freeTime}</td>)}<td className="px-4 py-1 text-sm text-slate-600 truncate">{doc.vessel}</td><td className="px-4 py-1 text-right"><div className="flex items-center justify-end gap-2"><button onClick={() => hasDoc && openDocument(doc.raw.originalDocument, doc.docNumber)} disabled={!hasDoc} className={`p-1 rounded transition-colors ${hasDoc ? 'text-slate-400 hover:text-blue-600 hover:bg-blue-50' : 'text-slate-200 cursor-not-allowed'}`} title={hasDoc ? "View Document" : "No Document"}><Eye size={16} /></button>{isBooking && <button onClick={(e) => { e.stopPropagation(); handleEditBooking(doc.raw as Booking); }} className="text-slate-400 hover:text-amber-600 p-1 rounded hover:bg-amber-50 transition-colors" title="Edit"><Pencil size={16} /></button>}{activeType === 'BL' && <button onClick={(e) => { e.stopPropagation(); handleEditBL(doc.raw as BillOfLading); }} className="text-slate-400 hover:text-amber-600 p-1 rounded hover:bg-amber-50 transition-colors" title="Edit Route/ETD"><Pencil size={16} /></button>}<button onClick={(e) => handleDelete(doc.id, e)} className="text-slate-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition-colors" title="Delete"><Trash2 size={16} /></button></div></td></tr>) })}</tbody></table></div>)}</div>

            {/* Edit Booking Modal */}
            {editingBooking && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-in zoom-in-95">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Pencil size={20} /> Edit Booking</h3>
                            <button onClick={() => setEditingBooking(null)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
                        </div>
                        <div className="p-6 space-y-4 overflow-y-auto custom-scrollbar">
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Booking #</label>
                                    <input className="w-full border border-slate-300 rounded p-2 text-sm" value={bookingFormData.bookingNumber || ''} onChange={e => setBookingFormData(p => ({ ...p, bookingNumber: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Sales Order</label>
                                    <select className="w-full border border-slate-300 rounded p-2 text-sm" value={bookingFormData.salesOrderId || ''} onChange={e => setBookingFormData(p => ({ ...p, salesOrderId: e.target.value }))}>
                                        <option value="">Select SO...</option>
                                        {salesOrdersList.map(so => <option key={so.id} value={so.id}>{so.orderNumber}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Shipper</label>
                                    <select className="w-full border border-slate-300 rounded p-2 text-sm" value={bookingFormData.companyId || ''} onChange={e => setBookingFormData(p => ({ ...p, companyId: e.target.value }))}>
                                        <option value="">Select Shipper...</option>
                                        {companiesList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Customer</label>
                                    <select className="w-full border border-slate-300 rounded p-2 text-sm" value={bookingFormData.customer || ''} onChange={e => setBookingFormData(p => ({ ...p, customer: e.target.value }))}>
                                        <option value="">Select Customer...</option>
                                        {customersList.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Vessel & Voyage</label>
                                    <input className="w-full border border-slate-300 rounded p-2 text-sm" value={bookingFormData.vesselVoyage || ''} onChange={e => setBookingFormData(p => ({ ...p, vesselVoyage: e.target.value }))} />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Port of Loading</label><select className="w-full border border-slate-300 rounded p-2 text-sm" value={bookingFormData.pol} onChange={e => setBookingFormData(p => ({ ...p, pol: e.target.value }))}><option value="">Select Port</option>{ports.map(port => <option key={port.id} value={port.code}>{port.name} ({port.code})</option>)}</select></div>
                                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Port of Discharge</label><select className="w-full border border-slate-300 rounded p-2 text-sm" value={bookingFormData.pod} onChange={e => setBookingFormData(p => ({ ...p, pod: e.target.value }))}><option value="">Select Port</option>{ports.map(port => <option key={port.id} value={port.code}>{port.name} ({port.code})</option>)}</select></div>
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Equipment</label>
                                    <input className="w-full border border-slate-300 rounded p-2 text-sm" value={bookingFormData.equipment || ''} onChange={e => setBookingFormData(p => ({ ...p, equipment: e.target.value }))} placeholder="e.g., 1 x 40' HC" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Terminal</label>
                                    <input className="w-full border border-slate-300 rounded p-2 text-sm" value={bookingFormData.terminal || ''} onChange={e => setBookingFormData(p => ({ ...p, terminal: e.target.value }))} placeholder="Terminal Name" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Free Time</label>
                                    <input className="w-full border border-slate-300 rounded p-2 text-sm" value={bookingFormData.freeTime || ''} onChange={e => setBookingFormData(p => ({ ...p, freeTime: e.target.value }))} placeholder="e.g. 14 Days" />
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">ETD</label><input type="date" className="w-full border border-slate-300 rounded p-2 text-sm" value={bookingFormData.etd || ''} onChange={e => setBookingFormData(p => ({ ...p, etd: e.target.value }))} /></div>
                                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">ETA</label><input type="date" className="w-full border border-slate-300 rounded p-2 text-sm" value={bookingFormData.eta || ''} onChange={e => setBookingFormData(p => ({ ...p, eta: e.target.value }))} /></div>
                                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cargo Cut-Off</label><input type="date" className="w-full border border-slate-300 rounded p-2 text-sm" value={bookingFormData.cargoCutOff || ''} onChange={e => setBookingFormData(p => ({ ...p, cargoCutOff: e.target.value }))} /></div>
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">VGM Cut-Off</label><input type="date" className="w-full border border-slate-300 rounded p-2 text-sm" value={bookingFormData.vgmCutOff || ''} onChange={e => setBookingFormData(p => ({ ...p, vgmCutOff: e.target.value }))} /></div>
                                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Draft Cut-Off</label><input type="date" className="w-full border border-slate-300 rounded p-2 text-sm" value={bookingFormData.draftCutOff || ''} onChange={e => setBookingFormData(p => ({ ...p, draftCutOff: e.target.value }))} /></div>
                                <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Status</label><select className="w-full border border-slate-300 rounded p-2 text-sm" value={bookingFormData.status} onChange={e => setBookingFormData(p => ({ ...p, status: e.target.value as any }))}><option>REQUESTED</option><option>ACTIVE</option><option>SHIPPED</option><option>CANCELLED</option><option>AVAILABLE</option></select></div>
                            </div>
                        </div>
                        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
                            <button onClick={() => setEditingBooking(null)} className="px-4 py-2 text-sm rounded-lg border border-slate-300 hover:bg-slate-100">Cancel</button>
                            <button onClick={handleSaveBooking} className="px-6 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-bold flex items-center gap-2"><Save size={16} /> Save Changes</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit BL Modal */}
            {editingBL && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col animate-in zoom-in-95">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Pencil size={20} /> Edit Bill of Lading</h3>
                            <button onClick={() => setEditingBL(null)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="bg-blue-50 border border-blue-100 p-3 rounded text-sm text-blue-800 mb-4">
                                <span className="font-bold">Note:</span> You are editing the Route and Dates. ETA updates will also reflect on the linked shipment if available.
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Port of Loading</label>
                                    <select
                                        className="w-full border border-slate-300 rounded p-2 text-sm"
                                        value={blFormData.pol}
                                        onChange={e => setBlFormData(p => ({ ...p, pol: e.target.value }))}
                                    >
                                        <option value="">Select Port</option>
                                        {ports.map(port => <option key={port.id} value={port.code}>{port.name} ({port.code})</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Port of Discharge</label>
                                    <select
                                        className="w-full border border-slate-300 rounded p-2 text-sm"
                                        value={blFormData.pod}
                                        onChange={e => setBlFormData(p => ({ ...p, pod: e.target.value }))}
                                    >
                                        <option value="">Select Port</option>
                                        {ports.map(port => <option key={port.id} value={port.code}>{port.name} ({port.code})</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">ETD (Shipped Date)</label>
                                    <input
                                        type="date"
                                        className="w-full border border-slate-300 rounded p-2 text-sm"
                                        value={blFormData.etd}
                                        onChange={e => setBlFormData(p => ({ ...p, etd: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1">ETA <Anchor size={10} className="text-blue-500" /></label>
                                    <input
                                        type="date"
                                        className="w-full border border-slate-300 rounded p-2 text-sm"
                                        value={blFormData.eta}
                                        onChange={e => setBlFormData(p => ({ ...p, eta: e.target.value }))}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
                            <button onClick={() => setEditingBL(null)} className="px-4 py-2 text-sm rounded-lg border border-slate-300 hover:bg-slate-100">Cancel</button>
                            <button onClick={handleSaveBL} className="px-6 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-bold flex items-center gap-2"><Save size={16} /> Save Updates</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Internal Document Viewer Modal */}
            {viewingDoc && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col animate-in zoom-in-95">
                        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                <FileText size={20} className="text-blue-600" />
                                {viewingDoc.title}
                            </h3>
                            <button onClick={closeDocument} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-200 rounded-full transition-all">
                                <X size={24} />
                            </button>
                        </div>
                        <div className="flex-1 bg-slate-100 p-2 overflow-hidden relative">
                            <iframe
                                src={viewingDoc.url}
                                className="w-full h-full rounded border border-slate-300 bg-white"
                                title="Document Preview"
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* OCR Upload Modal */}
            {showOcrModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col animate-in zoom-in-95">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-purple-50 to-indigo-50">
                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                <Sparkles size={20} className="text-purple-600" />
                                OCR {activeType === 'BL' ? 'Bill of Lading' : 'Booking'} Upload
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
                                            Drag & drop a {activeType === 'BL' ? 'Bill of Lading' : 'Booking'} PDF or image here
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

                            {/* Success */}
                            {ocrSuccess && (
                                <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm flex items-center gap-2">
                                    <CheckCircle2 size={18} />
                                    {activeType === 'BL' ? 'Bill of Lading' : 'Booking'} saved successfully!
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
                                    onClick={activeType === 'BL' ? processOcrBL : processOcrBooking}
                                    disabled={!ocrFile || ocrProcessing || ocrSuccess}
                                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-bold transition-all ${!ocrFile || ocrProcessing || ocrSuccess
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
                                            Extract & Save
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LogisticsDocuments;
