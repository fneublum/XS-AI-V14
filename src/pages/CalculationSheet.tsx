import React, { useState, useEffect, useRef } from 'react';
import { CostCalculation, Company, Product, CompanyImage, SupplierOffer, FreightQuote } from '../types';
import { Save, Trash2, Plus, Calculator, RefreshCw, AlertCircle, AlertTriangle, CheckCircle2, Search, ArrowRight, GripVertical, Filter, X, FileDown, Eye, Image as ImageIcon, Package, MapPin, Anchor, FileText, Download, ShieldCheck, Tag, DollarSign, FileCode, Ship, Copy, ExternalLink, Loader2, FilePlus, ChevronDown, Brain, Send, Mail, Edit2 } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getSupabaseClient } from '../services/supabase';
import { FormattedInput } from '../components/UnitInputs';

interface CalculationSheetProps {
    calculations: CostCalculation[];
    products: Product[];
    supplierOffers?: SupplierOffer[];
    freightQuotes?: FreightQuote[];
    onSave: (calc: CostCalculation) => void;
    onUpdate: (calc: CostCalculation) => void;
    onDelete: (id: string) => void;
    currentCompanyId: string;
    availableCompanies: Company[];
    isPriceList?: boolean;
    allowMargin?: boolean;
}

// Temporary interface for grid row state before saving
interface GridRow extends Partial<CostCalculation> {
    isDirty?: boolean;
    isNew?: boolean;
    rowId: string; // Internal key
    type: 'IMPORT' | 'EXPORT' | 'LOCAL';
}

// Helper to extract unique values for filtering
const getUniqueValues = (data: any[], key: string) => {
    const values = data.map(item => {
        const val = item[key];
        return val;
    }).filter(v => v !== undefined && v !== null && v !== '');
    return Array.from(new Set(values)).sort();
};

const CalculationSheet: React.FC<CalculationSheetProps> = ({
    calculations,
    products,
    supplierOffers = [],
    freightQuotes = [],
    onSave,
    onUpdate,
    onDelete,
    currentCompanyId,
    availableCompanies,
    isPriceList = false,
    allowMargin = true
}) => {
    const [rows, setRows] = useState<GridRow[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [notification, setNotification] = useState<{ msg: string, type: 'success' | 'error' } | null>(null);
    const [displayUnit, setDisplayUnit] = useState<'LBS' | 'KGS'>('LBS');
    const [typeFilter, setTypeFilter] = useState<'ALL' | 'IMPORT' | 'EXPORT' | 'LOCAL'>('ALL');

    // Sales Resume State
    const [viewingResume, setViewingResume] = useState<{ calc: GridRow, product: Product } | null>(null);
    const [productImages, setProductImages] = useState<CompanyImage[]>([]);

    // TDS Viewer State
    const [viewingTds, setViewingTds] = useState<{ url: string, filename: string, productName: string } | null>(null);
    const [tdsBlobUrl, setTdsBlobUrl] = useState<string | null>(null);

    // Add Row Dropdown State
    const [showAddMenu, setShowAddMenu] = useState(false);
    const [showQuoteModal, setShowQuoteModal] = useState(false);
    const [showDuplicateModal, setShowDuplicateModal] = useState(false);
    const [quoteSearch, setQuoteSearch] = useState('');
    const [duplicateSearch, setDuplicateSearch] = useState('');
    const addMenuRef = useRef<HTMLDivElement>(null);

    // Filtering State
    const [activeFilterColumn, setActiveFilterColumn] = useState<string | null>(null);
    const [filters, setFilters] = useState<Record<string, string[]>>({});
    const [filterSearch, setFilterSearch] = useState('');
    const filterMenuRef = useRef<HTMLDivElement>(null);

    // Freight Quote Request Modal State
    const [freightQuoteModal, setFreightQuoteModal] = useState<{
        row: GridRow | null;
        emailContent: string;
        subject: string;
    } | null>(null);

    // Edit Row Modal State
    const [editRowModal, setEditRowModal] = useState<GridRow | null>(null);

    const [colWidths, setColWidths] = useState({
        index: 50,
        quote: 100,
        ref: 100,
        type: 110,
        product: 220,
        hsCode: 110,
        pickup: 140,
        poa: 140,
        pod: 140,
        qty: 110,
        baseCost: 120,
        freightAI: 40,
        freight: 100,
        insurance: 90,
        clearance: 100,
        duty: 80,
        landed: 130,
        margin: 90,
        term: 100,
        sell: 130,
        actions: 120
    });

    // Constants for conversion
    const LBS_TO_KG = 0.453592;
    const KG_TO_LBS = 2.20462;

    // Find matching freight quote for a row based on POA/POD (STRICT exact match)
    const findMatchingFreightQuote = (row: GridRow): FreightQuote | null => {
        if (!freightQuotes || freightQuotes.length === 0) return null;

        // Extract port codes from row origin/destination
        const extractPortCode = (str: string | undefined): string => {
            if (!str) return '';
            const trimmed = str.trim().toUpperCase();
            // If it's already a short code (2-6 chars, uppercase letters/numbers), use it
            if (/^[A-Z0-9]{2,6}$/.test(trimmed)) return trimmed;
            // Look for code in parentheses like "Puerto Quetzal (GTPQ)"
            const parenMatch = trimmed.match(/\(([A-Z0-9]{2,6})\)/);
            if (parenMatch) return parenMatch[1];
            // Otherwise return the string uppercase
            return trimmed;
        };

        const rowPOA = extractPortCode(row.origin);
        const rowPOD = extractPortCode(row.destination);

        if (!rowPOA || !rowPOD) return null;

        // STRICT match: POA and POD must match exactly
        const match = freightQuotes.find(q => {
            const quotePOA = (q.originPortCode || '').toUpperCase();
            const quotePOD = (q.destinationPortCode || '').toUpperCase();
            return quotePOA === rowPOA && quotePOD === rowPOD;
        });

        return match || null;
    };

    // Click outside handler for add menu
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
                setShowAddMenu(false);
            }
        };
        if (showAddMenu) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showAddMenu]);

    // Initialize rows from saved calculations
    useEffect(() => {
        const mappedRows: GridRow[] = calculations.map(c => {
            let type: 'IMPORT' | 'EXPORT' | 'LOCAL' = 'IMPORT';
            if (c.origin === 'Local') type = 'LOCAL';
            else if (c.origin?.startsWith('Export:')) type = 'EXPORT';

            let cleanOrigin = c.origin;
            if (type === 'EXPORT') {
                cleanOrigin = c.origin.replace('Export: ', '').split(' -> ')[0];
            } else if (type === 'LOCAL') {
                cleanOrigin = '';
            } else {
                cleanOrigin = c.origin.split(' -> ')[0];
            }

            const displayPOA = c.poa || cleanOrigin;
            const displayPOD = c.pod || c.destination;

            // Look up HS Code from Products table
            const matchingProduct = (products || []).find(p => p.name === c.productName);
            const displayHSCode = matchingProduct?.hsCode || c.hsCode || '';

            // Check for matching freight quote if freight is 0
            let freightCostToUse = c.freightCost || 0;
            if (freightCostToUse === 0 && freightQuotes && freightQuotes.length > 0) {
                // Inline port code extraction
                const extractCode = (str: string | undefined): string => {
                    if (!str) return '';
                    const trimmed = str.trim().toUpperCase();
                    if (/^[A-Z0-9]{2,6}$/.test(trimmed)) return trimmed;
                    const parenMatch = trimmed.match(/\(([A-Z0-9]{2,6})\)/);
                    if (parenMatch) return parenMatch[1];
                    return trimmed;
                };

                const rowPOA = extractCode(displayPOA);
                const rowPOD = extractCode(displayPOD);

                console.log('🔍 Looking for quote match:', { rowPOA, rowPOD, displayPOA, displayPOD });
                console.log('📦 Available quotes:', freightQuotes.map(q => ({
                    agent: q.agentName,
                    poa: q.originPortCode,
                    pod: q.destinationPortCode,
                    rate: q.rate
                })));

                if (rowPOA && rowPOD) {
                    // STRICT match on POA/POD port codes only (flexible on pickup)
                    const bestMatch = freightQuotes.find(q => {
                        const quotePOA = (q.originPortCode || '').toUpperCase();
                        const quotePOD = (q.destinationPortCode || '').toUpperCase();

                        // Strict: POA and POD codes must match exactly
                        return quotePOA === rowPOA && quotePOD === rowPOD;
                    });

                    if (bestMatch?.rate) {
                        console.log('✅ Exact match found:', { agent: bestMatch.agentName, rate: bestMatch.rate, poa: bestMatch.originPortCode, pod: bestMatch.destinationPortCode });
                        freightCostToUse = bestMatch.rate;
                    } else {
                        console.log('❌ No exact match for POA:', rowPOA, 'POD:', rowPOD);
                    }
                }
            }

            // Auto-link supplier quote price as fobPrice if current fobPrice is 0
            let fobPriceToUse = c.fobPrice || 0;
            let quoteNumberToUse = c.quoteNumber || '';
            if (fobPriceToUse === 0 && supplierOffers && supplierOffers.length > 0) {
                const matchingOffer = supplierOffers.find(offer =>
                    offer.items.some(item => item.productName === c.productName)
                );
                if (matchingOffer) {
                    const matchingItem = matchingOffer.items.find(item => item.productName === c.productName);
                    if (matchingItem?.unitPrice) {
                        console.log('💰 Auto-linking quote price:', { product: c.productName, quote: matchingOffer.offerNumber, price: matchingItem.unitPrice });
                        fobPriceToUse = matchingItem.unitPrice;
                        quoteNumberToUse = quoteNumberToUse || matchingOffer.offerNumber;
                    }
                }
            }

            const row: GridRow = {
                ...c,
                hsCode: displayHSCode,
                origin: displayPOA,
                destination: displayPOD,
                fobPrice: fobPriceToUse,
                quoteNumber: quoteNumberToUse,
                freightCost: freightCostToUse,
                rowId: c.id,
                type: type,
                isDirty: freightCostToUse !== (c.freightCost || 0) || fobPriceToUse !== (c.fobPrice || 0),
                isNew: false
            };
            return calculateRow(row);
        });
        setRows(mappedRows);
    }, [calculations, products, freightQuotes, supplierOffers]);

    // Manage Blob URL for PDF preview with robust padding/cleaning
    useEffect(() => {
        if (viewingTds?.url) {
            try {
                const base64 = viewingTds.url.includes(',') ? viewingTds.url.split(',')[1] : viewingTds.url;
                const cleanBase64 = base64.trim().replace(/\s/g, '');
                const binaryString = atob(cleanBase64);
                const len = binaryString.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                const blob = new Blob([bytes], { type: 'application/pdf' });
                const url = URL.createObjectURL(blob);
                setTdsBlobUrl(url);
                return () => URL.revokeObjectURL(url);
            } catch (e) {
                console.error("Failed to generate PDF blob URL", e);
            }
        } else {
            setTdsBlobUrl(null);
        }
    }, [viewingTds]);

    // Handle click outside to close filter menu
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

    const showNotification = (msg: string, type: 'success' | 'error') => {
        setNotification({ msg, type });
        setTimeout(() => setNotification(null), 3000);
    };

    // Filter Logic
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

    // Column Resizing Logic
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

    const handleAddRow = () => {
        const newId = `NEW_${Date.now()}`;
        const defaultType = typeFilter !== 'ALL' ? typeFilter : 'IMPORT';

        const newRow: GridRow = {
            rowId: newId,
            id: `BC${Date.now()}`,
            companyId: currentCompanyId === 'ALL' ? (availableCompanies[0]?.id || '') : currentCompanyId,
            calculationNumber: `DRAFT-${Date.now().toString().slice(-4)}`,
            date: new Date().toISOString(),
            productName: '',
            hsCode: '',
            origin: '',
            destination: '',
            pickupLocation: '',
            quantity: 1,
            fobPrice: 0,
            freightCost: 0,
            insuranceCost: 0,
            dutyPercent: 0,
            portClearanceCost: 0,
            deliveryCost: 0,
            marginPercent: 20,
            type: defaultType,
            deliveryMethod: 'EXW',
            isNew: true,
            isDirty: true
        };
        setRows(prev => [newRow, ...prev]);
        setShowAddMenu(false);
    };

    const handleAddFromQuote = (offer: SupplierOffer, itemIndex: number) => {
        const item = offer.items[itemIndex];
        if (!item) return;

        const newId = `NEW_${Date.now()}`;
        const defaultType = typeFilter !== 'ALL' ? typeFilter : 'IMPORT';

        const newRow: GridRow = {
            rowId: newId,
            id: `BC${Date.now()}`,
            companyId: offer.companyId || (currentCompanyId === 'ALL' ? (availableCompanies[0]?.id || '') : currentCompanyId),
            calculationNumber: `DRAFT-${Date.now().toString().slice(-4)}`,
            quoteNumber: offer.offerNumber,
            date: new Date().toISOString(),
            productName: item.productName,
            supplierName: offer.supplierName,
            hsCode: '',
            origin: offer.originPort || '',
            destination: offer.destinationPort || '',
            pickupLocation: offer.loadingLocation || '',
            quantity: item.quantity || 1,
            fobPrice: item.unitPrice || 0,
            freightCost: 0,
            insuranceCost: 0,
            dutyPercent: 0,
            portClearanceCost: 0,
            deliveryCost: 0,
            marginPercent: 20,
            type: defaultType,
            deliveryMethod: (offer.incoterm as any) || 'FOB',
            isNew: true,
            isDirty: true
        };

        setRows(prev => [calculateRow(newRow), ...prev]);
        setShowQuoteModal(false);
        setQuoteSearch('');
        showNotification(`Added from Quote: ${offer.offerNumber}`, 'success');
    };

    const handleDuplicateFromSaved = (calc: CostCalculation) => {
        const newId = `NEW_${Date.now()}`;

        // Extract origin/destination from the origin string
        let originPort = calc.poa || '';
        let destPort = calc.pod || '';

        const newRow: GridRow = {
            rowId: newId,
            id: `BC${Date.now()}`,
            companyId: calc.companyId,
            calculationNumber: `DRAFT-${Date.now().toString().slice(-4)}`,
            quoteNumber: calc.quoteNumber,
            date: new Date().toISOString(),
            productName: calc.productName,
            supplierName: calc.supplierName,
            hsCode: calc.hsCode,
            origin: originPort,
            destination: destPort,
            pickupLocation: calc.pickupLocation,
            quantity: calc.quantity,
            fobPrice: calc.fobPrice,
            freightCost: calc.freightCost,
            insuranceCost: calc.insuranceCost,
            dutyPercent: calc.dutyPercent,
            portClearanceCost: calc.portClearanceCost,
            deliveryCost: calc.deliveryCost,
            marginPercent: calc.marginPercent,
            type: calc.origin === 'Local' ? 'LOCAL' : calc.origin.startsWith('Export:') ? 'EXPORT' : 'IMPORT',
            deliveryMethod: calc.deliveryMethod || 'EXW',
            isNew: true,
            isDirty: true
        };

        setRows(prev => [calculateRow(newRow), ...prev]);
        setShowDuplicateModal(false);
        setDuplicateSearch('');
        showNotification(`Duplicated: ${calc.calculationNumber}`, 'success');
    };

    const calculateRow = (row: GridRow): GridRow => {
        const qty = Number(row.quantity) || 0;
        const basePrice = Number(row.fobPrice) || 0;
        const totalBase = qty * basePrice;

        const freight = Number(row.freightCost) || 0;
        const insurance = Number(row.insuranceCost) || 0;
        const clearance = Number(row.portClearanceCost) || 0;
        const dutyRate = Number(row.dutyPercent) || 0;

        const dutiableValue = totalBase + freight;
        const dutyAmount = row.type === 'LOCAL' ? 0 : dutiableValue * (dutyRate / 100);

        const totalLanded = totalBase + freight + insurance + clearance + dutyAmount;
        const unitLanded = qty > 0 ? totalLanded / qty : 0;

        const margin = Number(row.marginPercent) || 0;
        const sellPriceTotal = margin < 100 ? totalLanded / (1 - (margin / 100)) : 0;
        const unitSellPrice = qty > 0 ? sellPriceTotal / qty : 0;

        return {
            ...row,
            totalLandedCost: totalLanded,
            unitLandedCost: unitLanded,
            recommendedSalesPrice: unitSellPrice,
        };
    };

    const openFreightQuoteModal = (row: GridRow) => {
        const qtyLbs = Number(row.quantity) || 0;
        const qtyKgs = (qtyLbs * LBS_TO_KG).toFixed(0);

        const subject = `Freight Quote Request: ${row.productName || 'Product'} - ${row.origin || 'TBD'} to ${row.destination || 'TBD'}`;

        const emailContent = `Dear Freight Partner,

We are requesting a freight quote for the following shipment:

**SHIPMENT DETAILS**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Product: ${row.productName || 'TBD'}
HS Code: ${row.hsCode || 'TBD'}

Origin (POL): ${row.origin || 'TBD'}
Destination (POD): ${row.destination || 'TBD'}
${row.pickupLocation ? `Pickup Location: ${row.pickupLocation}` : ''}

Quantity: ${qtyLbs.toLocaleString()} LBS (${Number(qtyKgs).toLocaleString()} KGS)
Estimated Commodity Value: $${((row.fobPrice || 0) * qtyLbs).toLocaleString()}

**REQUIRED INFORMATION**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Please provide:
• Ocean Freight Rate (per container or LCL rate)
• Transit Time
• Valid Through Date
• Any applicable surcharges

Thank you for your prompt response.

Best regards,
X-Solution AI Business Platform`;

        setFreightQuoteModal({
            row,
            subject,
            emailContent
        });
    };

    const handleChange = (rowId: string, field: keyof GridRow, value: any) => {
        setRows(prev => prev.map(row => {
            if (row.rowId !== rowId) return row;

            let storeValue = value;

            if (displayUnit === 'KGS') {
                if (field === 'quantity') {
                    storeValue = Number(value) * KG_TO_LBS;
                } else if (field === 'fobPrice') {
                    storeValue = Number(value) * LBS_TO_KG;
                }
            }

            const updatedRow = { ...row, [field]: storeValue, isDirty: true };
            return calculateRow(updatedRow);
        }));
    };

    const handleSave = (row: GridRow) => {
        if (!row.productName) {
            showNotification("Product Name is required", 'error');
            return;
        }

        let originStr = row.origin || '';
        const pod = row.destination || 'Unknown';

        if (row.type === 'LOCAL') {
            originStr = 'Local';
        } else if (row.type === 'EXPORT') {
            originStr = `Export: ${row.origin || 'Origin'} -> ${pod}`;
        } else {
            originStr = `${row.origin || 'Origin'} -> ${pod}`;
        }

        const calcToSave: CostCalculation = {
            id: row.id || `BC${Date.now()}`,
            companyId: row.companyId!,
            calculationNumber: row.calculationNumber!,
            date: new Date().toISOString(),
            productName: row.productName,
            hsCode: row.hsCode,
            origin: originStr,
            destination: pod,
            poa: row.origin,
            pod: row.destination,
            pickupLocation: row.pickupLocation || '',
            fobPrice: Number(row.fobPrice) || 0,
            quantity: Number(row.quantity) || 0,
            freightCost: Number(row.freightCost) || 0,
            insuranceCost: Number(row.insuranceCost) || 0,
            dutyPercent: Number(row.dutyPercent) || 0,
            portClearanceCost: Number(row.portClearanceCost) || 0,
            deliveryCost: 0,
            marginPercent: Number(row.marginPercent) || 0,
            totalLandedCost: row.totalLandedCost || 0,
            unitLandedCost: row.unitLandedCost || 0,
            recommendedSalesPrice: row.recommendedSalesPrice || 0,
            deliveryCity: row.deliveryCity,
            deliveryZip: row.deliveryZip,
            deliveryMethod: row.deliveryMethod as any,
            salesCarrierId: row.salesCarrierId,
            salesCarrierName: row.salesCarrierName
        };

        if (row.isNew) {
            onSave(calcToSave);
            showNotification("Calculation Created", 'success');
        } else {
            onUpdate(calcToSave);
            showNotification("Calculation Updated", 'success');
        }

        setRows(prev => prev.map(r => r.rowId === row.rowId ? { ...r, isDirty: false, isNew: false } : r));
    };

    const handleDeleteRow = (rowId: string, dbId?: string) => {
        if (dbId) {
            if (confirm("Are you sure you want to delete this calculation?")) {
                onDelete(dbId);
                setRows(prev => prev.filter(r => r.rowId !== rowId));
            }
        } else {
            setRows(prev => prev.filter(r => r.rowId !== rowId));
        }
    };

    // --- Sales Resume Logic ---
    const handleOpenResume = async (row: GridRow) => {
        const matchingProduct = products.find(p => p.name === row.productName);
        if (!matchingProduct) {
            showNotification("No matching product record found to display resume.", 'error');
            return;
        }

        setViewingResume({ calc: row, product: matchingProduct });

        const client = getSupabaseClient();
        if (client && matchingProduct.imageIds?.length) {
            const { data } = await client.from('imagens').select('*').in('id', matchingProduct.imageIds);
            if (data) setProductImages(data);
        } else {
            setProductImages([]);
        }
    };

    const handleOpenTDS = (row: GridRow) => {
        const matchingProduct = products.find(p => p.name === row.productName);
        if (matchingProduct?.tdsUrl) {
            setViewingTds({
                url: matchingProduct.tdsUrl,
                filename: matchingProduct.tdsFile || `${matchingProduct.name}_TDS.pdf`,
                productName: matchingProduct.name
            });
        } else {
            showNotification("No Technical Data Sheet (TDS) available for this product.", 'error');
        }
    };

    const triggerTdsDownload = (url: string, filename: string) => {
        if (!url) return;
        const link = document.createElement('a');
        link.href = url;
        link.download = filename || 'Technical_Data_Sheet.pdf';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleCopyResume = () => {
        if (!viewingResume) return;
        const { calc, product } = viewingResume;

        const specLines = [
            product.specs?.type && `• Type: ${product.specs.type}`,
            product.grade && `• Grade: ${product.grade}`,
            product.specs?.color && `• Color: ${product.specs.color}`,
            product.specs?.reinforced && `• Reinforced: ${product.specs.reinforced}`,
            product.specs?.additives && `• Additives: ${product.specs.additives}`,
            product.specs?.process && `• Process: ${product.specs.process}`,
            product.specs?.form && `• Form: ${product.specs.form}`,
            (product.specs?.rv || product.specs?.mfr) && `• RV / MFR: ${product.specs?.rv || product.specs?.mfr}`,
            product.specs?.origin && `• Origin: ${product.specs.origin}`,
            product.hsCode && `• HS Code: ${product.hsCode}`,
        ].filter(Boolean).join('\n');

        const priceStr = getDisplayPrice(calc.recommendedSalesPrice || 0);
        const unit = displayUnit.toLowerCase();
        const term = calc.deliveryMethod || 'EXW';

        const text = `Hello,

Following our conversation, please find below the technical details and commercial offer for ${calc.productName}:

--- PRODUCT SPECIFICATIONS ---
${specLines}

--- COMMERCIAL OFFER ---
• Price: $${priceStr} / ${unit}
• Delivery Term: ${term}

Please let us know if you require any further information or if you would like to proceed with an order.

Best regards,`.trim();

        navigator.clipboard.writeText(text);
        showNotification("Ready-to-send message copied!", 'success');
    };

    const handleCopyResumePT = () => {
        if (!viewingResume) return;
        const { calc, product } = viewingResume;

        const specLines = [
            product.specs?.type && `• Tipo: ${product.specs.type}`,
            product.grade && `• Grade: ${product.grade}`,
            product.specs?.color && `• Cor: ${product.specs.color}`,
            product.specs?.reinforced && `• Reforçado: ${product.specs.reinforced}`,
            product.specs?.additives && `• Aditivos: ${product.specs.additives}`,
            product.specs?.process && `• Processo: ${product.specs.process}`,
            product.specs?.form && `• Forma: ${product.specs.form}`,
            (product.specs?.rv || product.specs?.mfr) && `• RV / MFR: ${product.specs?.rv || product.specs?.mfr}`,
            product.specs?.origin && `• Origem: ${product.specs.origin}`,
            product.hsCode && `• NCM / HS Code: ${product.hsCode}`,
        ].filter(Boolean).join('\n');

        const priceStr = getDisplayPrice(calc.recommendedSalesPrice || 0);
        const unit = displayUnit.toLowerCase() === 'kgs' ? 'kg' : 'lb';
        const term = calc.deliveryMethod || 'EXW';

        const text = `Olá,

Dando continuidade à nossa conversa, seguem abaixo os detalhes técnicos e a oferta comercial para ${calc.productName}:

--- ESPECIFICAÇÕES DO PRODUTO ---
${specLines}

--- OFERTA COMERCIAL ---
• Preço: $${priceStr} / ${unit}
• Incoterm / Termo de Entrega: ${term}

Ficamos à disposição caso necessite de mais informações ou queira prosseguir com o pedido.

Atenciosamente,`.trim();

        navigator.clipboard.writeText(text);
        showNotification("Mensagem copiada com sucesso!", 'success');
    };

    const getDisplayQty = (lbs: number) => {
        const val = displayUnit === 'KGS' ? lbs * LBS_TO_KG : lbs;
        return val;
    };

    const getDisplayPrice = (pricePerLb: number) => {
        const val = displayUnit === 'KGS' ? pricePerLb * KG_TO_LBS : pricePerLb;
        return val ? val.toFixed(4) : '';
    };

    const filteredRows = rows.filter(r => {
        const matchesSearch = r.productName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            r.calculationNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            r.hsCode?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            r.type?.toLowerCase().includes(searchTerm.toLowerCase());

        const matchesType = typeFilter === 'ALL' || r.type === typeFilter;

        if (!matchesSearch || !matchesType) return false;

        for (const [key, selectedValues] of Object.entries(filters)) {
            const values = selectedValues as string[];
            if (values.length > 0) {
                let cellValue = (r as any)[key];
                cellValue = String(cellValue || '');
                if (!values.includes(cellValue)) return false;
            }
        }

        return true;
    }).sort((a, b) => {
        if (isPriceList) {
            return (a.productName || '').localeCompare(b.productName || '');
        }
        return 0;
    });

    const showTypeColumn = typeFilter === 'ALL';
    const showCostColumns = !isPriceList;
    const showSalesColumns = isPriceList;
    const showMarginColumn = showSalesColumns && allowMargin;
    const showPickupColumn = !(isPriceList && (typeFilter === 'EXPORT' || typeFilter === 'ALL'));
    const showDutyColumn = (typeFilter === 'ALL' || typeFilter === 'IMPORT') && !isPriceList;

    const handleDownloadPDF = () => {
        const doc = new jsPDF({ orientation: 'landscape' });
        const currentDate = new Date().toLocaleDateString();

        doc.setFontSize(18);
        doc.text("Official Price List", 14, 20);
        doc.setFontSize(11);
        doc.text(`Generated on: ${currentDate}`, 14, 28);
        doc.text(`Unit: ${displayUnit}`, 14, 34);

        const tableColumns = [
            { header: 'Ref #', dataKey: 'ref' },
            { header: 'Product Name', dataKey: 'product' },
            { header: 'HS Code', dataKey: 'hscode' },
            { header: 'POA', dataKey: 'poa' },
            { header: 'POD', dataKey: 'pod' },
            { header: 'Term', dataKey: 'term' },
            { header: `Price ($/${displayUnit})`, dataKey: 'price' },
        ];

        const tableRows = filteredRows.map(row => ({
            ref: row.calculationNumber,
            product: row.productName,
            hscode: row.hsCode || '-',
            poa: row.origin || '-',
            pod: row.destination || '-',
            term: row.deliveryMethod || 'EXW',
            price: getDisplayPrice(row.recommendedSalesPrice || 0)
        }));

        autoTable(doc, {
            head: [tableColumns.map(col => col.header)],
            body: tableRows.map(row => Object.values(row)),
            startY: 40,
            theme: 'grid',
            headStyles: { fillColor: [66, 66, 66] },
            styles: { fontSize: 9 }
        });

        doc.save(`Price_List_${currentDate.replace(/\//g, '-')}.pdf`);
    };

    const renderColumnFilter = (key: keyof GridRow, alwaysVisible: boolean = false) => {
        const uniqueValues = getUniqueValues(rows, key as string);
        const activeValues = filters[key as string] || [];
        const isFilterActive = activeValues.length > 0;

        return (
            <>
                <button
                    onClick={(e) => { e.stopPropagation(); setActiveFilterColumn(activeFilterColumn === key ? null : key as string); setFilterSearch(''); }}
                    className={`p-1 rounded hover:bg-slate-200 transition-colors ml-1 ${isFilterActive ? 'text-blue-600 bg-blue-50' : alwaysVisible ? 'text-slate-500' : 'text-slate-400 opacity-0 group-hover:opacity-100'}`}
                >
                    <Filter size={12} fill={isFilterActive ? "currentColor" : "none"} />
                </button>
                {activeFilterColumn === key && (
                    <div ref={filterMenuRef} className="absolute top-full right-0 mt-1 w-48 bg-white rounded-lg shadow-xl border border-slate-200 z-50 overflow-hidden text-left font-normal normal-case">
                        <div className="p-2 border-b border-slate-100">
                            <input
                                className="w-full px-2 py-1 text-xs border border-slate-200 rounded bg-slate-50 outline-none"
                                placeholder="Search..."
                                value={filterSearch}
                                onChange={e => setFilterSearch(e.target.value)}
                                autoFocus
                                onClick={e => e.stopPropagation()}
                            />
                        </div>
                        <div className="max-h-40 overflow-y-auto p-1 custom-scrollbar">
                            <button onClick={() => clearColumnFilter(key as string)} className="w-full text-left px-2 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded flex items-center gap-2 font-bold">
                                <X size={10} /> Clear Filter
                            </button>
                            {uniqueValues.filter(v => String(v).toLowerCase().includes(filterSearch.toLowerCase())).map(val => (
                                <button key={String(val)} onClick={() => toggleFilter(key as string, String(val))} className="w-full text-left px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded flex items-center gap-2">
                                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${activeValues.includes(String(val)) ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'}`}>
                                        {activeValues.includes(String(val)) && <CheckCircle2 size={10} className="text-white" />}
                                    </div>
                                    <span className="truncate">{String(val)}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </>
        );
    };

    return (
        <div className="h-full flex flex-col bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col md:flex-row justify-between items-center gap-4 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="bg-emerald-600 p-2 rounded-lg text-white shadow-sm">
                        <Calculator size={20} />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">{isPriceList ? 'Price List' : 'Master Calculation Sheet'}</h2>
                        <p className="text-xs text-slate-500">{isPriceList ? 'Simplified Sales View' : 'Unified view for Import, Export, and Local pricing'}</p>
                    </div>
                </div>

                <div className="flex items-center gap-3 w-full md:w-auto">
                    <div className="flex bg-slate-200/50 rounded-lg p-1 border border-slate-300/50">
                        <button onClick={() => setTypeFilter('ALL')} className={`px-3 py-1.5 text-xs font-bold rounded transition-all ${typeFilter === 'ALL' ? 'bg-white text-slate-800 shadow-sm ring-1 ring-black/5' : 'text-slate-500 hover:text-slate-700'}`}>ALL</button>
                        <button onClick={() => setTypeFilter('IMPORT')} className={`px-3 py-1.5 text-xs font-bold rounded transition-all ${typeFilter === 'IMPORT' ? 'bg-white text-blue-600 shadow-sm ring-1 ring-black/5' : 'text-slate-500 hover:text-blue-600'}`}>IMPORT</button>
                        <button onClick={() => setTypeFilter('EXPORT')} className={`px-3 py-1.5 text-xs font-bold rounded transition-all ${typeFilter === 'EXPORT' ? 'bg-white text-purple-600 shadow-sm ring-1 ring-black/5' : 'text-slate-500 hover:text-purple-600'}`}>EXPORT</button>
                        <button onClick={() => setTypeFilter('LOCAL')} className={`px-3 py-1.5 text-xs font-bold rounded transition-all ${typeFilter === 'LOCAL' ? 'bg-white text-emerald-600 shadow-sm ring-1 ring-black/5' : 'text-slate-500 hover:text-emerald-600'}`}>LOCAL</button>
                    </div>

                    <div className="flex bg-slate-200/50 rounded-lg p-1 border border-slate-300/50">
                        <button onClick={() => setDisplayUnit('LBS')} className={`px-3 py-1.5 text-xs font-bold rounded ${displayUnit === 'LBS' ? 'bg-white text-blue-700 shadow-sm ring-1 ring-black/5' : 'text-slate-500 hover:text-slate-700'}`}>LBS</button>
                        <button onClick={() => setDisplayUnit('KGS')} className={`px-3 py-1.5 text-xs font-bold rounded ${displayUnit === 'KGS' ? 'bg-white text-blue-700 shadow-sm ring-1 ring-black/5' : 'text-slate-500 hover:text-slate-700'}`}>KGS</button>
                    </div>

                    <div className="relative flex-1 md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input className="w-full pl-9 pr-4 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="Filter rows..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                    </div>
                    {isPriceList && <button onClick={handleDownloadPDF} className="bg-slate-800 hover:bg-slate-900 text-white p-2 rounded-lg text-sm font-bold flex items-center gap-2 shadow-sm transition-colors" title="Download PDF"><FileDown size={20} /></button>}

                    {/* Add Row Dropdown */}
                    <div className="relative" ref={addMenuRef}>
                        <button
                            onClick={() => setShowAddMenu(!showAddMenu)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg text-sm font-bold shadow-sm transition-colors flex items-center gap-2"
                        >
                            <FilePlus size={18} />
                            <span className="hidden sm:inline">Add Row</span>
                            <ChevronDown size={16} className={`transition-transform ${showAddMenu ? 'rotate-180' : ''}`} />
                        </button>

                        {showAddMenu && (
                            <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-50 animate-in fade-in slide-in-from-top-2">
                                <button
                                    onClick={handleAddRow}
                                    className="w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                                >
                                    <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                                        <Plus size={16} className="text-emerald-600" />
                                    </div>
                                    <div>
                                        <p className="font-bold">New Blank Row</p>
                                        <p className="text-xs text-slate-400">Start from scratch</p>
                                    </div>
                                </button>
                                <button
                                    onClick={() => { setShowAddMenu(false); setShowQuoteModal(true); }}
                                    className="w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                                >
                                    <div className="w-8 h-8 rounded-lg bg-teal-100 flex items-center justify-center">
                                        <Tag size={16} className="text-teal-600" />
                                    </div>
                                    <div>
                                        <p className="font-bold">From Supplier Quote</p>
                                        <p className="text-xs text-slate-400">Import from SQ-XXXXX</p>
                                    </div>
                                </button>
                                <button
                                    onClick={() => { setShowAddMenu(false); setShowDuplicateModal(true); }}
                                    className="w-full px-4 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                                >
                                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                                        <Copy size={16} className="text-blue-600" />
                                    </div>
                                    <div>
                                        <p className="font-bold">Duplicate from Saved</p>
                                        <p className="text-xs text-slate-400">Copy existing calculation</p>
                                    </div>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {notification && (
                <div className={`absolute top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full shadow-lg flex items-center gap-2 text-sm font-bold animate-in slide-in-from-top-2 ${notification.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-50 text-white'}`}>
                    {notification.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                    {notification.msg}
                </div>
            )}

            <div className="flex-1 overflow-auto custom-scrollbar relative">
                <table className="w-full text-left border-collapse min-w-[1300px] table-fixed">
                    <thead className="bg-slate-100 sticky top-0 z-10 shadow-sm text-xs font-bold text-slate-600 uppercase tracking-wider">
                        <tr>
                            <th className="px-3 py-3 border-b border-r border-slate-200 text-center relative group" style={{ width: colWidths.index }}>#<div onMouseDown={(e) => startResize(e, 'index')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300 z-10" /></th>
                            <th className="px-3 py-3 border-b border-r border-slate-200 relative group" style={{ width: colWidths.quote }}><div className="flex items-center justify-between"><span>Quote #</span>{renderColumnFilter('quoteNumber', true)}</div><div onMouseDown={(e) => startResize(e, 'quote')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300 z-10" /></th>
                            <th className="px-3 py-3 border-b border-r border-slate-200 relative group" style={{ width: colWidths.ref }}><div className="flex items-center justify-between"><span>Ref #</span>{renderColumnFilter('calculationNumber', true)}</div><div onMouseDown={(e) => startResize(e, 'ref')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300 z-10" /></th>
                            {showTypeColumn && <th className="px-3 py-3 border-b border-r border-slate-200 relative group" style={{ width: colWidths.type }}><div className="flex items-center justify-between"><span>Type</span>{renderColumnFilter('type')}</div><div onMouseDown={(e) => startResize(e, 'type')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300 z-10" /></th>}
                            <th className="px-3 py-3 border-b border-r border-slate-200 relative group" style={{ width: colWidths.product }}><div className="flex items-center justify-between"><span>{isPriceList ? 'Product' : 'Product & Supplier'}</span>{renderColumnFilter('productName', true)}</div><div onMouseDown={(e) => startResize(e, 'product')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300 z-10" /></th>
                            {isPriceList && <th className="px-3 py-3 border-b border-r border-slate-200 relative group" style={{ width: colWidths.hsCode }}><div className="flex items-center justify-between"><span>HS Code</span>{renderColumnFilter('hsCode')}</div><div onMouseDown={(e) => startResize(e, 'hsCode')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300 z-10" /></th>}
                            {showPickupColumn && <th className="px-3 py-3 border-b border-r border-slate-200 relative group" style={{ width: colWidths.pickup }}><div className="flex items-center justify-between"><span>Pick Up</span>{renderColumnFilter('pickupLocation')}</div><div onMouseDown={(e) => startResize(e, 'pickup')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300 z-10" /></th>}
                            <th className="px-3 py-3 border-b border-r border-slate-200 relative group" style={{ width: colWidths.poa }}><div className="flex items-center justify-between"><span>POA</span>{renderColumnFilter('origin')}</div><div onMouseDown={(e) => startResize(e, 'poa')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300 z-10" /></th>
                            <th className="px-3 py-3 border-b border-r border-slate-200 relative group" style={{ width: colWidths.pod }}><div className="flex items-center justify-between"><span>POD</span>{renderColumnFilter('destination')}</div><div onMouseDown={(e) => startResize(e, 'pod')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300 z-10" /></th>
                            <th className="px-3 py-3 border-b border-r border-slate-200 text-right relative group" style={{ width: colWidths.qty }}><div className="flex items-center justify-end gap-2"><span>Qty ({displayUnit})</span>{renderColumnFilter('quantity')}</div><div onMouseDown={(e) => startResize(e, 'qty')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300 z-10" /></th>
                            {showCostColumns && <th className="px-3 py-3 border-b border-r border-slate-200 text-right bg-blue-50/20 text-blue-700 relative group" style={{ width: colWidths.baseCost }}><div className="flex items-center justify-end gap-2"><span>Base Cost</span>{renderColumnFilter('fobPrice')}</div><div onMouseDown={(e) => startResize(e, 'baseCost')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300 z-10" /></th>}
                            {showCostColumns && <th className="px-1 py-3 border-b border-r border-slate-200 text-center bg-gradient-to-b from-violet-50 to-blue-50 relative" style={{ width: colWidths.freightAI }} title="AI Freight Quote Status"><Brain size={16} className="mx-auto text-violet-500" /></th>}
                            {showCostColumns && <th className="px-3 py-3 border-b border-r border-slate-200 text-right bg-blue-50/20 text-blue-700 relative group" style={{ width: colWidths.freight }}><div className="flex items-center justify-end gap-2"><span>Freight</span>{renderColumnFilter('freightCost')}</div><div onMouseDown={(e) => startResize(e, 'freight')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300 z-10" /></th>}
                            {showCostColumns && <th className="px-3 py-3 border-b border-r border-slate-200 text-right bg-cyan-50/50 text-cyan-700 relative group" style={{ width: colWidths.insurance }}><div className="flex items-center justify-end gap-2"><span>INS+</span>{renderColumnFilter('insuranceCost')}</div><div onMouseDown={(e) => startResize(e, 'insurance')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300 z-10" /></th>}
                            {showCostColumns && <th className="px-3 py-3 border-b border-r border-slate-200 text-right bg-amber-50/50 text-amber-700 relative group" style={{ width: colWidths.clearance }}><div className="flex items-center justify-end gap-2"><span>CLEAR+</span>{renderColumnFilter('portClearanceCost')}</div><div onMouseDown={(e) => startResize(e, 'clearance')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300 z-10" /></th>}
                            {showDutyColumn && <th className="px-3 py-3 border-b border-r border-slate-200 text-right bg-amber-50/50 text-amber-700 relative group" style={{ width: colWidths.duty }}><div className="flex items-center justify-end gap-2"><span>Duty %</span>{renderColumnFilter('dutyPercent')}</div><div onMouseDown={(e) => startResize(e, 'duty')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300 z-10" /></th>}
                            {showCostColumns && <th className="px-3 py-3 border-b border-r border-slate-200 text-right bg-slate-200/50 text-slate-800 relative group" style={{ width: colWidths.landed }}><div className="flex items-center justify-end gap-2"><span>Unit Landed</span>{renderColumnFilter('unitLandedCost')}</div><div onMouseDown={(e) => startResize(e, 'landed')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300 z-10" /></th>}
                            {showSalesColumns && <th className="px-3 py-3 border-b border-r border-slate-200 text-center bg-emerald-50/50 text-emerald-700 relative group" style={{ width: colWidths.term }}><div className="flex items-center justify-center gap-2"><span>Sale Term</span>{renderColumnFilter('deliveryMethod')}</div><div onMouseDown={(e) => startResize(e, 'term')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300 z-10" /></th>}
                            {showMarginColumn && <th className="px-3 py-3 border-b border-r border-slate-200 text-right bg-emerald-50/50 text-emerald-700 relative group" style={{ width: colWidths.margin }}><div className="flex items-center justify-end gap-2"><span>Margin %</span>{renderColumnFilter('marginPercent')}</div><div onMouseDown={(e) => startResize(e, 'margin')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300 z-10" /></th>}
                            {showSalesColumns && <th className="px-3 py-3 border-b border-r border-slate-200 text-right bg-emerald-100/50 text-emerald-800 relative group" style={{ width: colWidths.sell }}><div className="flex items-center justify-end gap-2"><span>Sell Price</span>{renderColumnFilter('recommendedSalesPrice')}</div><div onMouseDown={(e) => startResize(e, 'sell')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300 z-10" /></th>}
                            <th className="px-3 py-3 border-b border-slate-200 text-center relative group" style={{ width: colWidths.actions }}>Actions<div onMouseDown={(e) => startResize(e, 'actions')} className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300 z-10" /></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                        {filteredRows.map((row, index) => {
                            const matchingProduct = products.find(p => p.name === row.productName);
                            const hasTds = !!matchingProduct?.tdsUrl;
                            return (
                                <tr key={row.rowId} className={`group hover:bg-slate-50 transition-colors ${row.isDirty ? 'bg-amber-50/30' : ''}`}>
                                    <td className="px-3 py-2 border-r border-slate-100 text-center text-xs text-slate-400">{index + 1}</td>
                                    <td className="px-3 py-2 border-r border-slate-100 text-xs font-mono text-teal-600">{row.quoteNumber || '-'}</td>
                                    <td className="px-3 py-2 border-r border-slate-100 text-xs font-mono font-bold text-slate-500">{row.calculationNumber}</td>
                                    {showTypeColumn && <td className="px-3 py-2 border-r border-slate-100"><select className={`w-full bg-transparent text-xs font-bold rounded py-1 px-2 border border-transparent hover:border-slate-300 focus:border-blue-500 focus:bg-white outline-none cursor-pointer ${row.type === 'IMPORT' ? 'text-blue-600' : row.type === 'EXPORT' ? 'text-purple-600' : 'text-emerald-600'}`} value={row.type} onChange={(e) => handleChange(row.rowId, 'type', e.target.value)}><option value="IMPORT">IMPORT</option><option value="EXPORT">EXPORT</option><option value="LOCAL">LOCAL</option></select></td>}
                                    <td className="px-3 py-2 border-r border-slate-100"><input className="w-full text-sm font-medium text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 focus:bg-white outline-none" value={row.productName} onChange={(e) => handleChange(row.rowId, 'productName', e.target.value)} placeholder="Product Name" /></td>
                                    {isPriceList && <td className="px-3 py-2 border-r border-slate-100"><input className="w-full text-xs font-mono text-slate-600 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 focus:bg-white outline-none" value={row.hsCode || ''} onChange={(e) => handleChange(row.rowId, 'hsCode', e.target.value)} placeholder="HS Code" /></td>}
                                    {showPickupColumn && <td className="px-3 py-2 border-r border-slate-100"><input className="w-full text-xs text-slate-600 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 focus:bg-white outline-none" value={row.pickupLocation || ''} onChange={(e) => handleChange(row.rowId, 'pickupLocation', e.target.value)} placeholder="Pickup" /></td>}
                                    <td className="px-3 py-2 border-r border-slate-100"><input className="w-full text-xs text-slate-600 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 focus:bg-white outline-none" value={row.origin} onChange={(e) => handleChange(row.rowId, 'origin', e.target.value)} placeholder="POA" /></td>
                                    <td className="px-3 py-2 border-r border-slate-100"><input className="w-full text-xs text-slate-600 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 focus:bg-white outline-none" value={row.destination} onChange={(e) => handleChange(row.rowId, 'destination', e.target.value)} placeholder="POD" /></td>
                                    <td className="px-3 py-2 border-r border-slate-100 text-right"><FormattedInput value={getDisplayQty(row.quantity || 0)} onChange={(val) => handleChange(row.rowId, 'quantity', val)} decimals={0} className="w-full text-right bg-transparent border-b border-transparent hover:border-blue-500 focus:border-blue-500 focus:bg-white outline-none" /></td>
                                    {showCostColumns && <td className="px-3 py-2 border-r border-slate-100 text-right bg-blue-50/20"><input type="number" className="w-full text-right font-mono text-slate-700 bg-transparent border-b border-transparent hover:border-blue-300 focus:border-blue-500 focus:bg-white outline-none" value={getDisplayPrice(row.fobPrice || 0)} onChange={(e) => handleChange(row.rowId, 'fobPrice', e.target.value)} placeholder="0.00" /></td>}
                                    {showCostColumns && (() => {
                                        const matchingQuote = findMatchingFreightQuote(row);
                                        const hasQuote = matchingQuote !== null;
                                        return (
                                            <td className="px-1 py-2 border-r border-slate-100 text-center bg-gradient-to-b from-violet-50/50 to-blue-50/50">
                                                <button
                                                    onClick={() => {
                                                        if (hasQuote && matchingQuote.rate) {
                                                            // Auto-apply the freight rate
                                                            handleChange(row.rowId, 'freightCost', matchingQuote.rate);
                                                            showNotification(`Applied $${matchingQuote.rate.toLocaleString()} freight from ${matchingQuote.agentName}`, 'success');
                                                        } else {
                                                            openFreightQuoteModal(row);
                                                        }
                                                    }}
                                                    className={`p-1.5 rounded-lg transition-all hover:scale-110 ${hasQuote
                                                        ? 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200'
                                                        : 'bg-red-100 text-red-500 hover:bg-red-200'
                                                        }`}
                                                    title={hasQuote
                                                        ? `Match found: $${matchingQuote.rate?.toLocaleString()} via ${matchingQuote.agentName} (click to apply)`
                                                        : 'No matching quote - click to request'
                                                    }
                                                >
                                                    <Brain size={14} />
                                                </button>
                                            </td>
                                        );
                                    })()}
                                    {showCostColumns && <td className="px-3 py-2 border-r border-slate-100 text-right bg-blue-50/20"><FormattedInput value={row.freightCost || 0} onChange={(val) => handleChange(row.rowId, 'freightCost', val)} decimals={2} className="w-full text-right font-mono text-slate-700 bg-transparent border-b border-transparent hover:border-blue-300 focus:border-blue-500 focus:bg-white outline-none" /></td>}
                                    {showCostColumns && <td className="px-3 py-2 border-r border-slate-100 text-right bg-cyan-50/20"><FormattedInput value={row.insuranceCost || 0} onChange={(val) => handleChange(row.rowId, 'insuranceCost', val)} decimals={2} className="w-full text-right font-mono text-slate-700 bg-transparent border-b border-transparent hover:border-cyan-300 focus:border-cyan-500 focus:bg-white outline-none" /></td>}
                                    {showCostColumns && <td className="px-3 py-2 border-r border-slate-100 text-right bg-amber-50/20"><FormattedInput value={row.portClearanceCost || 0} onChange={(val) => handleChange(row.rowId, 'portClearanceCost', val)} decimals={2} className="w-full text-right font-mono text-slate-700 bg-transparent border-b border-transparent hover:border-amber-300 focus:border-amber-500 focus:bg-white outline-none" /></td>}
                                    {showDutyColumn && <td className="px-3 py-2 border-r border-slate-100 text-right bg-amber-50/20"><FormattedInput value={row.dutyPercent || 0} onChange={(val) => handleChange(row.rowId, 'dutyPercent', val)} decimals={2} disabled={row.type === 'LOCAL'} className={`w-full text-right font-mono bg-transparent border-b border-transparent hover:border-amber-300 focus:border-amber-500 focus:bg-white outline-none ${row.type === 'LOCAL' ? 'text-slate-300 cursor-not-allowed' : 'text-slate-700'}`} /></td>}
                                    {showCostColumns && <td className="px-3 py-2 border-r border-slate-100 text-right bg-slate-100"><span className="font-mono font-bold text-slate-700 block">${getDisplayPrice(row.unitLandedCost || 0)}</span><span className="text-[10px] text-slate-400 block">Total: ${(row.totalLandedCost || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></td>}
                                    {showSalesColumns && <td className="px-3 py-2 border-r border-slate-100 bg-emerald-50/20">{isPriceList ? <div className="w-full text-xs font-bold text-slate-700 text-center py-1">{row.deliveryMethod || 'EXW'}</div> : <select className="w-full bg-transparent text-xs font-bold text-slate-700 outline-none cursor-pointer" value={row.deliveryMethod || 'EXW'} onChange={(e) => handleChange(row.rowId, 'deliveryMethod', e.target.value)}><option value="EXW">EXW</option><option value="FCA">FCA</option><option value="FAS">FAS</option><option value="FOB">FOB</option><option value="CFR">CFR</option><option value="CIF">CIF</option><option value="CPT">CPT</option><option value="CIP">CIP</option><option value="DAP">DAP</option><option value="DPU">DPU</option><option value="DDP">DDP</option></select>}</td>}
                                    {showMarginColumn && <td className="px-3 py-2 border-r border-slate-100 text-right bg-emerald-50/20"><input type="number" className="w-full text-right font-bold text-emerald-600 bg-transparent border-b border-transparent hover:border-emerald-300 focus:border-emerald-500 focus:bg-white outline-none" value={row.marginPercent} onChange={(e) => handleChange(row.rowId, 'marginPercent', e.target.value)} placeholder="0" /></td>}
                                    {showSalesColumns && <td className="px-3 py-2 border-r border-slate-100 text-right bg-emerald-100/30"><span className="font-mono font-bold text-emerald-700 block">${getDisplayPrice(row.recommendedSalesPrice || 0)}</span>{!isPriceList && row.recommendedSalesPrice && row.quantity ? <span className="text-[10px] text-emerald-600/70 block">Profit: ${((row.recommendedSalesPrice - (row.unitLandedCost || 0)) * row.quantity).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span> : null}</td>}
                                    <td className="px-3 py-2 text-center">
                                        <div className="flex justify-center gap-1.5">
                                            {!row.isNew && <button onClick={() => handleOpenResume(row)} className="p-1.5 text-blue-500 hover:bg-blue-50 rounded transition-colors" title="View Sales Resume"><Eye size={16} /></button>}

                                            {/* TDS View Action - Always visible but pale and disabled if no TDS */}
                                            {!row.isNew && (
                                                <button
                                                    onClick={() => handleOpenTDS(row)}
                                                    disabled={!hasTds}
                                                    className={`p-1.5 rounded transition-colors ${hasTds ? 'text-indigo-500 hover:bg-indigo-50' : 'text-slate-300 cursor-not-allowed opacity-50'}`}
                                                    title={hasTds ? "View Product TDS" : "No TDS Available"}
                                                >
                                                    <FileText size={16} />
                                                </button>
                                            )}

                                            {/* Edit Row Action */}
                                            <button
                                                onClick={() => setEditRowModal(row)}
                                                className="p-1.5 text-amber-500 hover:bg-amber-50 rounded transition-colors"
                                                title="Edit Row"
                                            >
                                                <Edit2 size={16} />
                                            </button>

                                            <button onClick={() => handleSave(row)} disabled={!row.isDirty} className={`p-1.5 rounded transition-colors ${row.isDirty ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-300'}`} title="Save Row"><Save size={16} /></button>
                                            <button onClick={() => handleDeleteRow(row.rowId, row.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors" title="Delete Row"><Trash2 size={16} /></button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                        {filteredRows.length === 0 && (
                            <tr><td colSpan={15} className="px-6 py-12 text-center text-slate-400 bg-slate-50/50"><div className="flex flex-col items-center"><Calculator size={32} className="mb-2 opacity-50" /><p>No calculations found. Click "Add Row" to start.</p></div></td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="bg-slate-50 border-t border-slate-200 p-3 flex justify-between items-center text-xs text-slate-500 shrink-0"><span>Showing {filteredRows.length} records</span><div className="flex gap-4"><span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500"></div> Import</span><span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-purple-500"></div> Export</span><span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500"></div> Local</span></div></div>

            {/* Sales Resume Modal */}
            {viewingResume && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
                    <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full overflow-hidden animate-in zoom-in-95 duration-300 max-h-[90vh] flex flex-col">
                        <div className="p-6 bg-slate-900 text-white flex justify-between items-center shrink-0">
                            <div className="flex items-center gap-4"><div className="p-3 bg-blue-600 rounded-2xl shadow-lg shadow-blue-900/50"><Tag size={28} /></div>{viewingResume.product && (<div><h2 className="text-2xl font-bold tracking-tight">{viewingResume.calc.productName}</h2><div className="flex items-center gap-2 mt-1 opacity-80"><span className="bg-white/10 px-2 py-0.5 rounded text-xs font-mono">{viewingResume.product.grade}</span><span className="text-xs">•</span><span className="text-xs">{viewingResume.product.category}</span></div></div>)}</div>
                            <button onClick={() => setViewingResume(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X size={24} /></button>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
                            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                                <div className="lg:col-span-5 space-y-8">
                                    <div className="space-y-3"><h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2"><ImageIcon size={14} /> Product Visuals</h3><div className="grid grid-cols-1 gap-4">{productImages.length > 0 ? (<div className="aspect-square rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden shadow-inner"><img src={productImages[0].url} alt="Primary" className="w-full h-full object-cover" /></div>) : (<div className="aspect-square rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center text-slate-300"><ImageIcon size={48} className="mb-2 opacity-20" /><span className="text-xs font-medium">No Images Available</span></div>)}{productImages.length > 1 && (<div className="grid grid-cols-2 gap-3">{productImages.slice(1).map((img, idx) => (<div key={idx} className="aspect-square rounded-xl border border-slate-200 overflow-hidden shadow-sm"><img src={img.url} alt={`View ${idx}`} className="w-full h-full object-cover" /></div>))}</div>)}</div></div>
                                </div>
                                <div className="lg:col-span-7 space-y-8">
                                    <div className="space-y-4"><h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2"><FileCode size={14} /> Technical Specifications</h3><div className="grid grid-cols-2 gap-x-8 gap-y-4">{viewingResume.product?.specs?.type && <SpecItem label="Type" value={viewingResume.product.specs.type} />}{viewingResume.product?.grade && <SpecItem label="Grade" value={viewingResume.product.grade} />}{viewingResume.product?.specs?.color && <SpecItem label="Color" value={viewingResume.product.specs.color} />}{viewingResume.product?.specs?.reinforced && <SpecItem label="Reinforced" value={viewingResume.product.specs.reinforced} />}{viewingResume.product?.specs?.additives && <SpecItem label="Additives" value={viewingResume.product.specs.additives} />}{viewingResume.product?.specs?.process && <SpecItem label="Process" value={viewingResume.product.specs.process} />}{viewingResume.product?.specs?.form && <SpecItem label="Form" value={viewingResume.product.specs.form} />}{(viewingResume.product?.specs?.rv || viewingResume.product?.specs?.mfr) && <SpecItem label="RV / MFR" value={viewingResume.product.specs?.rv || viewingResume.product.specs?.mfr} />}{viewingResume.product?.specs?.origin && <SpecItem label="Origin" value={viewingResume.product.specs.origin} />}{viewingResume.product?.hsCode && <SpecItem label="HS Code" value={viewingResume.product.hsCode} />}</div></div>
                                </div>
                            </div>
                        </div>
                        <div className="p-6 bg-slate-50 border-t border-slate-200 flex justify-between items-center shrink-0"><span className="text-xs text-slate-400 italic">Resume generated from master database. Validate details before sending to client.</span><div className="flex gap-3"><button onClick={handleCopyResumePT} className="px-6 py-3 bg-white border border-slate-300 text-slate-700 rounded-xl font-bold hover:bg-slate-50 transition-all shadow-sm flex items-center gap-2 active:scale-95"><Copy size={18} /> Copiar Texto</button><button onClick={handleCopyResume} className="px-6 py-3 bg-white border border-slate-300 text-slate-700 rounded-xl font-bold hover:bg-slate-50 transition-all shadow-sm flex items-center gap-2 active:scale-95"><Copy size={18} /> Copy Text</button><button onClick={() => setViewingResume(null)} className="px-8 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-black transition-all shadow-lg shadow-slate-900/20 active:scale-95">Close Presentation</button></div></div>
                    </div>
                </div>
            )}

            {/* TDS Viewer Modal */}
            {viewingTds && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-300">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
                        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0">
                            <div className="flex items-center gap-3"><div className="p-2 bg-blue-600 rounded-lg text-white"><FileText size={20} /></div><div><h3 className="font-bold text-slate-800">TDS Preview</h3><p className="text-xs text-slate-500">{viewingTds.productName} • {viewingTds.filename}</p></div></div>
                            <div className="flex items-center gap-3"><button onClick={() => triggerTdsDownload(viewingTds.url, viewingTds.filename)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors flex items-center gap-2 shadow-sm"><Download size={16} /> Download PDF</button><button onClick={() => setViewingTds(null)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-all"><X size={20} /></button></div>
                        </div>
                        <div className="flex-1 bg-slate-100 p-2 overflow-hidden relative">
                            {tdsBlobUrl ? (
                                <object
                                    data={tdsBlobUrl}
                                    type="application/pdf"
                                    className="w-full h-full rounded-lg shadow-inner border border-slate-200 bg-white"
                                >
                                    <iframe
                                        src={tdsBlobUrl}
                                        className="w-full h-full rounded-lg"
                                        title="TDS Viewer Fallback"
                                    />
                                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50 p-10 text-center pointer-events-none">
                                        <AlertTriangle size={48} className="text-amber-500 mb-4" />
                                        <p className="text-slate-600 mb-4">If the PDF doesn't display, your browser might be blocking the preview.</p>
                                        <button
                                            onClick={() => triggerTdsDownload(viewingTds.url, viewingTds.filename)}
                                            className="pointer-events-auto bg-blue-600 text-white px-6 py-2 rounded-lg font-bold shadow-lg"
                                        >
                                            Download and View Externally
                                        </button>
                                    </div>
                                </object>
                            ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center text-slate-400">
                                    <Loader2 className="animate-spin mb-2" size={32} />
                                    <p>Preparing document...</p>
                                </div>
                            )}
                        </div>
                        <div className="p-3 border-t border-slate-200 bg-slate-50 flex justify-end shrink-0"><button onClick={() => setViewingTds(null)} className="px-6 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-bold hover:bg-slate-100 transition-all">Close Viewer</button></div>
                    </div>
                </div>
            )}

            {/* Quote Selection Modal */}
            {showQuoteModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col animate-in zoom-in-95">
                        <div className="p-4 border-b border-slate-200 flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center">
                                    <Tag size={20} className="text-teal-600" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-800">Select Supplier Quote</h3>
                                    <p className="text-xs text-slate-500">Choose a quote to create a new calculation row</p>
                                </div>
                            </div>
                            <button onClick={() => { setShowQuoteModal(false); setQuoteSearch(''); }} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                                <X size={20} className="text-slate-400" />
                            </button>
                        </div>
                        <div className="p-4 border-b border-slate-100">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                <input
                                    className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none"
                                    placeholder="Search quotes by number, supplier, or product..."
                                    value={quoteSearch}
                                    onChange={e => setQuoteSearch(e.target.value)}
                                    autoFocus
                                />
                            </div>
                        </div>
                        <div className="flex-1 overflow-auto p-4 space-y-2">
                            {supplierOffers.length === 0 ? (
                                <div className="text-center py-12 text-slate-400">
                                    <Tag size={48} className="mx-auto mb-4 opacity-30" />
                                    <p className="font-medium">No supplier quotes available</p>
                                    <p className="text-xs mt-1">Create quotes in the Supplier Quotes module first</p>
                                </div>
                            ) : (
                                supplierOffers
                                    .filter(o => {
                                        if (!quoteSearch) return true;
                                        const term = quoteSearch.toLowerCase();
                                        return o.offerNumber?.toLowerCase().includes(term) ||
                                            o.supplierName?.toLowerCase().includes(term) ||
                                            o.items.some(i => i.productName?.toLowerCase().includes(term));
                                    })
                                    .map(offer => (
                                        <div key={offer.id} className="border border-slate-200 rounded-xl overflow-hidden hover:border-teal-300 transition-colors">
                                            <div className="bg-slate-50 px-4 py-2 border-b border-slate-100 flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <span className="font-mono font-bold text-teal-600">{offer.offerNumber}</span>
                                                    <span className="text-sm text-slate-600">{offer.supplierName}</span>
                                                </div>
                                                <span className="text-xs text-slate-400">{offer.items.length} items</span>
                                            </div>
                                            <div className="divide-y divide-slate-100">
                                                {offer.items.map((item, idx) => (
                                                    <button
                                                        key={idx}
                                                        onClick={() => handleAddFromQuote(offer, idx)}
                                                        className="w-full px-4 py-3 text-left hover:bg-teal-50/50 flex items-center justify-between transition-colors"
                                                    >
                                                        <div>
                                                            <p className="font-medium text-slate-700">{item.productName}</p>
                                                            <p className="text-xs text-slate-400">Qty: {item.quantity?.toLocaleString()} • ${item.unitPrice?.toFixed(2)}/unit</p>
                                                        </div>
                                                        <ArrowRight size={16} className="text-slate-300" />
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    ))
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Duplicate Selection Modal */}
            {showDuplicateModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col animate-in zoom-in-95">
                        <div className="p-4 border-b border-slate-200 flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                                    <Copy size={20} className="text-blue-600" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-800">Duplicate from Saved</h3>
                                    <p className="text-xs text-slate-500">Choose a saved calculation to duplicate</p>
                                </div>
                            </div>
                            <button onClick={() => { setShowDuplicateModal(false); setDuplicateSearch(''); }} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                                <X size={20} className="text-slate-400" />
                            </button>
                        </div>
                        <div className="p-4 border-b border-slate-100">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                <input
                                    className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                    placeholder="Search by ref #, product, or supplier..."
                                    value={duplicateSearch}
                                    onChange={e => setDuplicateSearch(e.target.value)}
                                    autoFocus
                                />
                            </div>
                        </div>
                        <div className="flex-1 overflow-auto p-4 space-y-1">
                            {calculations.length === 0 ? (
                                <div className="text-center py-12 text-slate-400">
                                    <Calculator size={48} className="mx-auto mb-4 opacity-30" />
                                    <p className="font-medium">No saved calculations</p>
                                    <p className="text-xs mt-1">Save a calculation first to duplicate it</p>
                                </div>
                            ) : (
                                calculations
                                    .filter(c => {
                                        if (!duplicateSearch) return true;
                                        const term = duplicateSearch.toLowerCase();
                                        return c.calculationNumber?.toLowerCase().includes(term) ||
                                            c.productName?.toLowerCase().includes(term) ||
                                            c.supplierName?.toLowerCase().includes(term);
                                    })
                                    .map(calc => (
                                        <button
                                            key={calc.id}
                                            onClick={() => handleDuplicateFromSaved(calc)}
                                            className="w-full px-4 py-3 text-left hover:bg-blue-50/50 rounded-lg flex items-center justify-between transition-colors border border-transparent hover:border-blue-200"
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className="bg-slate-100 rounded-lg px-2 py-1">
                                                    <span className="font-mono text-xs font-bold text-slate-600">{calc.calculationNumber}</span>
                                                </div>
                                                <div>
                                                    <p className="font-medium text-slate-700">{calc.productName}</p>
                                                    <p className="text-xs text-slate-400">
                                                        {calc.supplierName && <span>{calc.supplierName} • </span>}
                                                        ${calc.unitLandedCost?.toFixed(2)}/unit landed
                                                    </p>
                                                </div>
                                            </div>
                                            <ArrowRight size={16} className="text-slate-300" />
                                        </button>
                                    ))
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Freight Quote Request Modal */}
            {freightQuoteModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col animate-in zoom-in-95">
                        <div className="p-4 border-b border-slate-200 flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center shadow-lg">
                                    <Brain size={24} className="text-white" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-800">AI Freight Quote Request</h3>
                                    <p className="text-xs text-slate-500">{freightQuoteModal.row?.productName} • {freightQuoteModal.row?.origin} → {freightQuoteModal.row?.destination}</p>
                                </div>
                            </div>
                            <button onClick={() => setFreightQuoteModal(null)} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                                <X size={20} className="text-slate-400" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-auto p-4 space-y-4">
                            <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
                                <div className="flex items-center gap-2 mb-2">
                                    <Mail size={16} className="text-violet-600" />
                                    <span className="text-sm font-bold text-violet-800">Email to Cargo Agents</span>
                                </div>
                                <p className="text-xs text-violet-600">This email will be sent to all registered freight forwarders and cargo agents.</p>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Subject</label>
                                <input
                                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm font-medium focus:ring-2 focus:ring-violet-500 outline-none"
                                    value={freightQuoteModal.subject}
                                    onChange={(e) => setFreightQuoteModal(prev => prev ? { ...prev, subject: e.target.value } : null)}
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Message</label>
                                <textarea
                                    className="w-full px-4 py-3 border border-slate-300 rounded-lg text-sm font-mono leading-relaxed focus:ring-2 focus:ring-violet-500 outline-none resize-none"
                                    rows={16}
                                    value={freightQuoteModal.emailContent}
                                    onChange={(e) => setFreightQuoteModal(prev => prev ? { ...prev, emailContent: e.target.value } : null)}
                                />
                            </div>
                        </div>

                        <div className="p-4 border-t border-slate-200 flex items-center justify-between shrink-0 bg-slate-50">
                            <div className="text-xs text-slate-400">
                                Quotes received will automatically update the Freight column
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setFreightQuoteModal(null)}
                                    className="px-5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-bold hover:bg-slate-100 transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        showNotification('Freight quote request sent to cargo agents!', 'success');
                                        setFreightQuoteModal(null);
                                    }}
                                    className="px-5 py-2.5 bg-gradient-to-r from-violet-600 to-blue-600 text-white rounded-lg text-sm font-bold hover:from-violet-700 hover:to-blue-700 transition-all shadow-lg flex items-center gap-2"
                                >
                                    <Send size={16} />
                                    Send to Agents
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Row Modal */}
            {editRowModal && (
                <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center animate-in fade-in" onClick={() => setEditRowModal(null)}>
                    <div
                        className="bg-white rounded-2xl shadow-2xl w-[600px] max-h-[90vh] flex flex-col animate-in zoom-in-95"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="shrink-0 p-4 border-b border-slate-200 bg-gradient-to-r from-amber-50 to-orange-50">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-gradient-to-br from-amber-500 to-orange-500 text-white rounded-lg">
                                    <Edit2 size={20} />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-slate-800">Edit Calculation Row</h2>
                                    <p className="text-sm text-slate-500">{editRowModal.calculationNumber} - {editRowModal.productName}</p>
                                </div>
                            </div>
                        </div>

                        {/* Form */}
                        <div className="flex-1 overflow-auto p-4 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Product Name</label>
                                    <input
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                                        value={editRowModal.productName}
                                        onChange={(e) => setEditRowModal(prev => prev ? { ...prev, productName: e.target.value } : null)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Type</label>
                                    <select
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                                        value={editRowModal.type}
                                        onChange={(e) => setEditRowModal(prev => prev ? { ...prev, type: e.target.value as 'IMPORT' | 'EXPORT' | 'LOCAL' } : null)}
                                    >
                                        <option value="IMPORT">IMPORT</option>
                                        <option value="EXPORT">EXPORT</option>
                                        <option value="LOCAL">LOCAL</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Pickup Location</label>
                                    <input
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                                        value={editRowModal.pickupLocation || ''}
                                        onChange={(e) => setEditRowModal(prev => prev ? { ...prev, pickupLocation: e.target.value } : null)}
                                        placeholder="City, ZIP"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">POA (Origin)</label>
                                    <input
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                                        value={editRowModal.origin}
                                        onChange={(e) => setEditRowModal(prev => prev ? { ...prev, origin: e.target.value } : null)}
                                        placeholder="Port of Origin"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">POD (Destination)</label>
                                    <input
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                                        value={editRowModal.destination}
                                        onChange={(e) => setEditRowModal(prev => prev ? { ...prev, destination: e.target.value } : null)}
                                        placeholder="Port of Destination"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Quantity (LBS)</label>
                                    <input
                                        type="number"
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                                        value={editRowModal.quantity || ''}
                                        onChange={(e) => setEditRowModal(prev => prev ? { ...prev, quantity: parseFloat(e.target.value) || 0 } : null)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Base Cost ($/lb)</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                                        value={editRowModal.fobPrice || ''}
                                        onChange={(e) => setEditRowModal(prev => prev ? { ...prev, fobPrice: parseFloat(e.target.value) || 0 } : null)}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-4 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Freight</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                                        value={editRowModal.freightCost || ''}
                                        onChange={(e) => setEditRowModal(prev => prev ? { ...prev, freightCost: parseFloat(e.target.value) || 0 } : null)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Insurance</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                                        value={editRowModal.insuranceCost || ''}
                                        onChange={(e) => setEditRowModal(prev => prev ? { ...prev, insuranceCost: parseFloat(e.target.value) || 0 } : null)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Clearance</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                                        value={editRowModal.portClearanceCost || ''}
                                        onChange={(e) => setEditRowModal(prev => prev ? { ...prev, portClearanceCost: parseFloat(e.target.value) || 0 } : null)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Duty %</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                                        value={editRowModal.dutyPercent || ''}
                                        onChange={(e) => setEditRowModal(prev => prev ? { ...prev, dutyPercent: parseFloat(e.target.value) || 0 } : null)}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Sale Term</label>
                                    <select
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                                        value={editRowModal.deliveryMethod || 'EXW'}
                                        onChange={(e) => setEditRowModal(prev => prev ? { ...prev, deliveryMethod: e.target.value } : null)}
                                    >
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
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Margin %</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                                        value={editRowModal.marginPercent || ''}
                                        onChange={(e) => setEditRowModal(prev => prev ? { ...prev, marginPercent: parseFloat(e.target.value) || 0 } : null)}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t border-slate-200 flex items-center justify-end gap-3 shrink-0 bg-slate-50">
                            <button
                                onClick={() => setEditRowModal(null)}
                                className="px-5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-bold hover:bg-slate-100 transition-all"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => {
                                    if (editRowModal) {
                                        // Apply all changes to the row in local state
                                        const updatedRow = calculateRow({ ...editRowModal, isDirty: true });
                                        setRows(prev => prev.map(r => r.rowId === editRowModal.rowId ? updatedRow : r));
                                        // Also persist to database
                                        handleSave(updatedRow);
                                        showNotification('Row saved successfully!', 'success');
                                        setEditRowModal(null);
                                    }
                                }}
                                className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg text-sm font-bold hover:from-amber-600 hover:to-orange-600 transition-all shadow-lg flex items-center gap-2"
                            >
                                <Save size={16} />
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const SpecItem = ({ label, value }: { label: string, value: any }) => (
    <div className="flex flex-col border-b border-slate-100 pb-2">
        <span className="text-[10px] font-bold text-slate-400 uppercase mb-0.5">{label}</span>
        <span className={`text-sm font-semibold ${value ? 'text-slate-700' : 'text-slate-300 italic'}`}>{value || 'Not Specified'}</span>
    </div>
);

export default CalculationSheet;