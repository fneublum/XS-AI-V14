import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { ArrowDownRight, Search, FileText, AlertCircle, Clock, CheckCircle, DollarSign, Eye, Pencil, Trash2, X, ChevronDown, ChevronUp, Upload, Loader2, Save, UploadCloud, Send, RefreshCw } from 'lucide-react';
import { SupplierInvoice, Bank, QBSyncStatus } from '../types';
import { analyzeDocument } from '../services/geminiService';
import { syncPayableBill, batchGetSyncStatuses, getQBConnectionStatus, fetchQBItems, QBItem, checkPaymentStatuses } from '../services/quickbooksService';

interface FinancePayablesProps {
    invoices: SupplierInvoice[];
    onDelete?: (id: string) => void;
    onUpdate?: (record: any) => Promise<any>;
    onSave?: (record: any) => Promise<void>;
    currentCompanyId?: string;
    banks?: Bank[];
}

const formatCurrency = (val: number | string | undefined | null) => {
    const num = typeof val === 'string' ? parseFloat(val) : val;
    if (num == null || isNaN(num)) return '$0.00';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
};

const formatDate = (dateStr: string | undefined | null) => {
    if (!dateStr) return '—';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return dateStr; }
};

const calcDueDate = (invoiceDate: string | undefined | null, paymentTerms: string | undefined | null): Date | null => {
    if (!invoiceDate) return null;
    try {
        const base = new Date(invoiceDate);
        if (isNaN(base.getTime())) return null;
        const days = paymentTerms ? parseInt((paymentTerms.match(/\d+/) || ['0'])[0], 10) : 0;
        if (days > 0) {
            base.setDate(base.getDate() + days);
        }
        return base;
    } catch { return null; }
};

const getDueStatus = (inv: SupplierInvoice) => {
    const due = calcDueDate(inv.invoiceDate || inv.date, inv.paymentTerms);
    if (!due) return { label: 'No Date', color: 'slate', priority: 3, dueDate: null };
    const now = new Date();
    const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { label: 'Overdue', color: 'rose', priority: 1, dueDate: due };
    if (diffDays <= 7) return { label: 'Due Soon', color: 'amber', priority: 2, dueDate: due };
    return { label: 'On Track', color: 'emerald', priority: 4, dueDate: due };
};

// Get raw item description from invoice
const getRawItemDescription = (inv: SupplierInvoice): string => {
    try {
        if (inv.items) {
            const parsed = typeof inv.items === 'string' ? JSON.parse(inv.items) : inv.items;
            if (Array.isArray(parsed) && parsed.length > 0) {
                const desc = parsed[0].description || parsed[0].productName || parsed[0].product || parsed[0].name || '';
                return desc || '';
            }
        }
    } catch { /* ignore parse errors */ }
    return '';
};

// Match invoice item description to a system product name
const getMaterialDescription = (inv: SupplierInvoice, systemProducts: Array<{ name: string }>): string => {
    const rawDesc = getRawItemDescription(inv);
    if (!rawDesc) return '—';

    // Try to find a matching product from the system catalog
    const descLower = rawDesc.toLowerCase();
    let bestMatch = '';
    let bestScore = 0;

    for (const product of systemProducts) {
        const prodLower = product.name.toLowerCase().trim();
        const prodWords = prodLower.split(/\s+/).filter(w => w.length > 2);
        // Count how many product words appear in the description
        const matchCount = prodWords.filter(w => descLower.includes(w)).length;
        const score = prodWords.length > 0 ? matchCount / prodWords.length : 0;
        if (score > bestScore && score >= 0.5) {
            bestScore = score;
            bestMatch = product.name;
        }
    }

    return bestMatch || rawDesc || '—';
};

const formatWeight = (weight: string | undefined | null): { lbs: string; kgs: string } => {
    if (!weight) return { lbs: '—', kgs: '—' };
    const num = parseFloat(weight.replace(/[^\d.-]/g, ''));
    if (isNaN(num)) return { lbs: weight, kgs: '—' };
    const kgs = num * 0.453592;
    return {
        lbs: num.toLocaleString('en-US', { maximumFractionDigits: 2 }),
        kgs: kgs.toLocaleString('en-US', { maximumFractionDigits: 2 })
    };
};

type SortKey = 'invoiceNumber' | 'supplier' | 'invoiceDate' | 'totalAmount' | 'status';
type SortDir = 'asc' | 'desc';

const SUPPLIER_INVOICE_EXTRACTION_PROMPT = `You are a document OCR and extraction AI. Extract the following fields from this supplier invoice document. Return a valid JSON object with these keys:

INVOICE_NUMBER: Invoice Number or Reference.
INVOICE_DATE: Invoice Date.
SELLER_NAME: Seller/Shipper/Supplier Company Name.
SELLER_ADDRESS: Seller/Shipper Address.
BUYER_NAME_ADDRESS: Buyer / Sold To Name and Address.
SHIP_TO_ADDRESS: Ship To Address.
PAYMENT_TERMS: Payment Terms (e.g. Net 30).
INCOTERMS: Incoterms (e.g. CFR HCM Port).
DATE_SHIPPED: Date of Order or Date Shipped.
PO_NUMBER: Customer PO Number.
CARRIER: Carrier or Shipped Via.
TRANSPORT_ID: Car No / Container / BL Number.
FREIGHT_TERMS: Freight Terms (e.g. Collect).
ITEMS: Array of items { description, hs_code, quantity, unit_price, amount }.
WEIGHT_GROSS: Gross Weight.
WEIGHT_NET: Net Weight.
WEIGHT_TARE: Tare Weight.
TOTAL_QUANTITY: Total count (Bales/Cases).
SUBTOTAL: Subtotal amount.
TOTAL_AMOUNT: Total Due / Invoice Total.
CURRENCY: Currency (e.g. USD).
REMIT_TO_NAME: Remit To / Beneficiary Name.
BANK_NAME: Intermediary/Beneficiary Bank Name.
SWIFT_CODE: SWIFT/BIC Code.
ROUTING_NUMBER: Routing Number (ABA).
ACCOUNT_NUMBER: Account Number.
SUPPLIER: Supplier company name (same as SELLER_NAME if not separate).`;

const INCOTERMS_OPTIONS = [
    '', 'EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'
];

const OCR_FIELD_MAP: { key: string; label: string; type: 'text' | 'number' | 'select'; ocrKey: string }[] = [
    { key: 'invoiceNumber', label: 'Invoice Number', type: 'text', ocrKey: 'INVOICE_NUMBER' },
    { key: 'invoiceDate', label: 'Invoice Date', type: 'text', ocrKey: 'INVOICE_DATE' },
    { key: 'shipperName', label: 'Supplier / Shipper', type: 'text', ocrKey: 'SELLER_NAME' },
    { key: 'shipperAddress', label: 'Shipper Address', type: 'text', ocrKey: 'SELLER_ADDRESS' },
    { key: 'soldTo', label: 'Sold To', type: 'text', ocrKey: 'BUYER_NAME_ADDRESS' },
    { key: 'shipTo', label: 'Ship To', type: 'text', ocrKey: 'SHIP_TO_ADDRESS' },
    { key: 'paymentTerms', label: 'Payment Terms', type: 'text', ocrKey: 'PAYMENT_TERMS' },
    { key: 'incoterms', label: 'Incoterms', type: 'select', ocrKey: 'INCOTERMS' },
    { key: 'dateOrder', label: 'Date Shipped', type: 'text', ocrKey: 'DATE_SHIPPED' },
    { key: 'customerPo', label: 'Customer PO', type: 'text', ocrKey: 'PO_NUMBER' },
    { key: 'carrier', label: 'Carrier', type: 'text', ocrKey: 'CARRIER' },
    { key: 'transportRef', label: 'Transport Ref', type: 'text', ocrKey: 'TRANSPORT_ID' },
    { key: 'freightTerms', label: 'Freight Terms', type: 'text', ocrKey: 'FREIGHT_TERMS' },
    { key: 'grossWeight', label: 'Gross Weight', type: 'text', ocrKey: 'WEIGHT_GROSS' },
    { key: 'netWeight', label: 'Net Weight', type: 'text', ocrKey: 'WEIGHT_NET' },
    { key: 'tareWeight', label: 'Tare Weight', type: 'text', ocrKey: 'WEIGHT_TARE' },
    { key: 'totalQuantity', label: 'Total Quantity', type: 'text', ocrKey: 'TOTAL_QUANTITY' },
    { key: 'subtotal', label: 'Subtotal', type: 'number', ocrKey: 'SUBTOTAL' },
    { key: 'totalAmount', label: 'Total Amount', type: 'number', ocrKey: 'TOTAL_AMOUNT' },
    { key: 'currency', label: 'Currency', type: 'text', ocrKey: 'CURRENCY' },
    { key: 'remitTo', label: 'Remit To', type: 'text', ocrKey: 'REMIT_TO_NAME' },
    { key: 'bankName', label: 'Bank Name', type: 'text', ocrKey: 'BANK_NAME' },
    { key: 'swiftCode', label: 'SWIFT Code', type: 'text', ocrKey: 'SWIFT_CODE' },
    { key: 'routingNumber', label: 'Routing Number', type: 'text', ocrKey: 'ROUTING_NUMBER' },
    { key: 'accountNumber', label: 'Account Number', type: 'text', ocrKey: 'ACCOUNT_NUMBER' },
];

const EDIT_FIELDS: { key: string; label: string; type: 'text' | 'number' | 'select' }[] = [
    { key: 'invoiceNumber', label: 'Invoice Number', type: 'text' },
    { key: 'invoiceDate', label: 'Invoice Date', type: 'text' },
    { key: 'shipperName', label: 'Supplier / Shipper', type: 'text' },
    { key: 'shipperAddress', label: 'Shipper Address', type: 'text' },
    { key: 'soldTo', label: 'Sold To', type: 'text' },
    { key: 'shipTo', label: 'Ship To', type: 'text' },
    { key: 'paymentTerms', label: 'Payment Terms', type: 'text' },
    { key: 'incoterms', label: 'Incoterms', type: 'select' },
    { key: 'dateOrder', label: 'Date Shipped', type: 'text' },
    { key: 'customerPo', label: 'Customer PO', type: 'text' },
    { key: 'carrier', label: 'Carrier', type: 'text' },
    { key: 'transportRef', label: 'Transport Ref', type: 'text' },
    { key: 'freightTerms', label: 'Freight Terms', type: 'text' },
    { key: 'grossWeight', label: 'Gross Weight', type: 'text' },
    { key: 'netWeight', label: 'Net Weight', type: 'text' },
    { key: 'tareWeight', label: 'Tare Weight', type: 'text' },
    { key: 'totalQuantity', label: 'Total Quantity', type: 'text' },
    { key: 'subtotal', label: 'Subtotal', type: 'number' },
    { key: 'totalAmount', label: 'Total Amount', type: 'number' },
    { key: 'currency', label: 'Currency', type: 'text' },
    { key: 'remitTo', label: 'Remit To', type: 'text' },
    { key: 'bankName', label: 'Bank Name', type: 'text' },
    { key: 'swiftCode', label: 'SWIFT Code', type: 'text' },
    { key: 'routingNumber', label: 'Routing Number', type: 'text' },
    { key: 'accountNumber', label: 'Account Number', type: 'text' },
];

const FinancePayables: React.FC<FinancePayablesProps> = ({ invoices, onDelete, onUpdate, onSave, currentCompanyId, banks = [] }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [sortKey, setSortKey] = useState<SortKey>('invoiceDate');
    const [sortDir, setSortDir] = useState<SortDir>('desc');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    // Autofilter state
    const [supplierFilter, setSupplierFilter] = useState<Set<string>>(new Set());
    const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
    const [qbFilter, setQbFilter] = useState<Set<string>>(new Set());
    const [openFilter, setOpenFilter] = useState<string | null>(null);

    // OCR Upload Modal state
    const [showOcrModal, setShowOcrModal] = useState(false);
    const [ocrStep, setOcrStep] = useState<'upload' | 'processing' | 'review'>('upload');
    const [ocrStatus, setOcrStatus] = useState('');
    const [ocrFiles, setOcrFiles] = useState<File[]>([]);
    const [ocrCurrentIndex, setOcrCurrentIndex] = useState(0);
    const [ocrPreview, setOcrPreview] = useState<string | null>(null);
    const [ocrFormData, setOcrFormData] = useState<Record<string, any>>({});
    const [ocrItems, setOcrItems] = useState<any[]>([]);
    const [ocrOriginalDoc, setOcrOriginalDoc] = useState<string>('');
    const [isDragging, setIsDragging] = useState(false);
    const [ocrSaving, setOcrSaving] = useState(false);
    const [ocrSaved, setOcrSaved] = useState(false);

    // Edit Modal state
    const [editInvoice, setEditInvoice] = useState<SupplierInvoice | null>(null);
    const [editFormData, setEditFormData] = useState<Record<string, any>>({});
    const [editSaving, setEditSaving] = useState(false);

    // View Document Modal state
    const [viewInvoice, setViewInvoice] = useState<SupplierInvoice | null>(null);

    // Payment Modal state
    const [payInvoice, setPayInvoice] = useState<SupplierInvoice | null>(null);
    const [payDate, setPayDate] = useState('');
    const [payBankId, setPayBankId] = useState('');

    // QuickBooks sync state
    const [qbSyncStatuses, setQbSyncStatuses] = useState<Record<string, QBSyncStatus>>({});
    const [qbSyncing, setQbSyncing] = useState<string | null>(null);
    const [qbConnected, setQbConnected] = useState(true);

    // QB Items (Products/Services) for dropdown
    const [qbItems, setQbItems] = useState<QBItem[]>([]);
    // Local state map to track Product/Service selections per invoice
    const [productServiceMap, setProductServiceMap] = useState<Record<string, string>>({});
    // System products for Material column lookup
    const [systemProducts, setSystemProducts] = useState<Array<{ name: string }>>([]);

    // Load QB connection status and sync statuses
    useEffect(() => {
        const loadQbStatuses = async () => {
            try {
                const status = await getQBConnectionStatus(currentCompanyId || 'ALL');
                setQbConnected(status.connected);
                if (status.connected && invoices.length > 0) {
                    const ids = invoices.map(inv => inv.id);
                    const statuses = await batchGetSyncStatuses(ids, 'invoices_suppliers');
                    setQbSyncStatuses(statuses);
                }
            } catch (err) {
                console.warn('QB status check failed:', err);
            }
        };
        loadQbStatuses();
    }, [invoices, currentCompanyId]);

    // Fetch QB items (Products/Services) for dropdown - independent of QB status
    useEffect(() => {
        const loadItems = async () => {
            try {
                const items = await fetchQBItems(currentCompanyId || 'ALL');
                setQbItems(items);
            } catch (e) {
                console.warn('QB items fetch failed:', e);
            }
        };
        loadItems();
    }, [currentCompanyId]);

    // Fetch system products for Material column
    useEffect(() => {
        const loadProducts = async () => {
            try {
                const { getSupabaseClient } = await import('../services/supabase');
                const supabase = getSupabaseClient();
                const { data } = await supabase.from('products').select('name').not('name', 'is', null);
                if (data) setSystemProducts(data);
            } catch (e) { console.warn('Products fetch failed:', e); }
        };
        loadProducts();
    }, []);

    // Load QB sync statuses from qb_sync_log so QB column shows on refresh
    useEffect(() => {
        if (invoices.length === 0) return;
        const loadQbStatuses = async () => {
            try {
                const { getSupabaseClient } = await import('../services/supabase');
                const supabase = getSupabaseClient();
                const invoiceIds = invoices.map(inv => inv.id);
                const { data: logs } = await supabase
                    .from('qb_sync_log')
                    .select('source_id, qb_entity_id, sync_status, synced_at')
                    .eq('source_table', 'invoices_suppliers')
                    .in('source_id', invoiceIds)
                    .eq('sync_status', 'success');
                if (logs && logs.length > 0) {
                    const statuses: Record<string, QBSyncStatus> = {};
                    logs.forEach((log: any) => {
                        statuses[log.source_id] = {
                            synced: true,
                            qbEntityId: log.qb_entity_id,
                            qbEntityType: 'Bill',
                            syncedAt: log.synced_at,
                        };
                    });
                    setQbSyncStatuses(prev => ({ ...statuses, ...prev }));
                }
            } catch (e) { console.warn('QB sync log load failed:', e); }
        };
        loadQbStatuses();
    }, [invoices]);

    // Load saved material→product/service mappings and auto-fill
    useEffect(() => {
        if (invoices.length === 0) return;
        const loadMappings = async () => {
            try {
                const { getSupabaseClient } = await import('../services/supabase');
                const supabase = getSupabaseClient();
                const { data: mappings } = await supabase.from('qb_material_mappings').select('material_name, qb_product_service');
                if (!mappings || mappings.length === 0) return;
                const mapByMaterial: Record<string, string> = {};
                mappings.forEach((m: any) => { mapByMaterial[m.material_name.toLowerCase()] = m.qb_product_service; });
                const autoFilled: Record<string, string> = {};
                invoices.forEach(inv => {
                    if ((inv as any).qb_product_service) return;
                    const material = getMaterialDescription(inv, systemProducts);
                    if (material && material !== '—') {
                        const matched = mapByMaterial[material.toLowerCase()];
                        if (matched) autoFilled[inv.id] = matched;
                    }
                });
                if (Object.keys(autoFilled).length > 0) {
                    setProductServiceMap(prev => ({ ...prev, ...autoFilled }));
                }
            } catch (e) { console.warn('Material mappings load failed:', e); }
        };
        loadMappings();
    }, [invoices, systemProducts]);

    // Handle Product/Service selection change
    const handleProductServiceChange = async (invId: string, value: string) => {
        // Update local state immediately for UI responsiveness
        setProductServiceMap(prev => ({ ...prev, [invId]: value }));
        try {
            const { getSupabaseClient } = await import('../services/supabase');
            const supabase = getSupabaseClient();
            await supabase.from('invoices_suppliers').update({ qb_product_service: value || null }).eq('id', invId);

            // Save material→product/service mapping for future auto-fill
            if (value) {
                const inv = invoices.find(i => i.id === invId);
                if (inv) {
                    const material = getMaterialDescription(inv, systemProducts);
                    if (material && material !== '—') {
                        await supabase.from('qb_material_mappings').upsert({
                            company_id: currentCompanyId || 'ALL',
                            material_name: material,
                            qb_product_service: value,
                            updated_at: new Date().toISOString()
                        }, { onConflict: 'company_id,material_name' });
                    }
                }
            }
        } catch (err) {
            console.warn('Product/Service update failed:', err);
        }
    };

    // Send to QuickBooks handler
    const handleSendToQB = async (inv: SupplierInvoice) => {
        if (qbSyncing) return;
        setQbSyncing(inv.id);
        try {
            const result = await syncPayableBill(currentCompanyId || 'ALL', inv);
            setQbSyncStatuses(prev => ({ ...prev, [inv.id]: result }));
            // Update qb_status on the record in Supabase
            try {
                const { getSupabaseClient } = await import('../services/supabase');
                const supabase = getSupabaseClient();
                await supabase.from('invoices_suppliers').update({ qb_status: 'Sent' }).eq('id', inv.id);
            } catch (dbErr) {
                console.warn('qb_status update failed:', dbErr);
            }
        } catch (err: any) {
            console.error('QB sync failed:', err);
            setQbSyncStatuses(prev => ({ ...prev, [inv.id]: { synced: false, error: err.message } }));
            alert(`QuickBooks sync failed: ${err.message}`);
        } finally {
            setQbSyncing(null);
        }
    };

    // Bulk transmit to QuickBooks
    const [qbTransmitting, setQbTransmitting] = useState(false);
    const [qbTransmitProgress, setQbTransmitProgress] = useState({ sent: 0, total: 0 });
    const [qbSyncingPayment, setQbSyncingPayment] = useState(false);

    const handleTransmitToQB = async () => {
        const unsent = invoices.filter(inv => (inv as any).qb_status !== 'Sent' && !qbSyncStatuses[inv.id]?.synced);
        if (unsent.length === 0) {
            alert('All invoices have already been sent to QuickBooks.');
            return;
        }
        if (!confirm(`Send ${unsent.length} invoice(s) to QuickBooks?`)) return;
        setQbTransmitting(true);
        setQbTransmitProgress({ sent: 0, total: unsent.length });
        let successCount = 0;
        for (const inv of unsent) {
            try {
                const result = await syncPayableBill(currentCompanyId || 'ALL', inv);
                setQbSyncStatuses(prev => ({ ...prev, [inv.id]: result }));
                try {
                    const { getSupabaseClient } = await import('../services/supabase');
                    const supabase = getSupabaseClient();
                    await supabase.from('invoices_suppliers').update({ qb_status: 'Sent' }).eq('id', inv.id);
                } catch (dbErr) {
                    console.warn('qb_status update failed:', dbErr);
                }
                successCount++;
            } catch (err: any) {
                console.error(`QB sync failed for ${inv.invoiceNumber}:`, err);
                setQbSyncStatuses(prev => ({ ...prev, [inv.id]: { synced: false, error: err.message } }));
            }
            setQbTransmitProgress(prev => ({ ...prev, sent: prev.sent + 1 }));
        }
        setQbTransmitting(false);
        alert(`Transmitted ${successCount} of ${unsent.length} invoices to QuickBooks.`);
    };

    const [paySaving, setPaySaving] = useState(false);

    // View PDF handler — show in-app modal
    const handleViewPdf = (inv: SupplierInvoice) => {
        if (!inv.originalDocument) {
            alert('No document attached to this invoice.');
            return;
        }
        setViewInvoice(inv);
    };

    // Edit Modal handlers
    const openEditModal = (inv: SupplierInvoice) => {
        const formData: Record<string, any> = {};
        EDIT_FIELDS.forEach(f => { formData[f.key] = (inv as any)[f.key] || ''; });
        setEditFormData(formData);
        setEditInvoice(inv);
    };

    const handleEditSave = async () => {
        if (!editInvoice || !onUpdate) return;
        setEditSaving(true);
        try {
            const updated = { ...editInvoice, ...editFormData };
            await onUpdate(updated);
            setEditInvoice(null);
        } catch (err) {
            console.error('Edit save failed:', err);
        } finally {
            setEditSaving(false);
        }
    };

    // Mark as Paid handler
    const openPayModal = (inv: SupplierInvoice) => {
        setPayInvoice(inv);
        setPayDate(new Date().toISOString().split('T')[0]);
        setPayBankId('');
    };

    const handleMarkPaid = async () => {
        if (!payInvoice || !onUpdate) return;
        setPaySaving(true);
        try {
            const selectedBank = banks.find(b => b.id === payBankId);
            const updated = {
                ...payInvoice,
                paidDate: payDate,
                paidBankId: payBankId || undefined,
                paidBankName: selectedBank?.name || undefined,
                status: 'Paid',
            };
            await onUpdate(updated);
            setPayInvoice(null);
        } catch (err) {
            console.error('Mark as paid failed:', err);
        } finally {
            setPaySaving(false);
        }
    };

    const filteredAndSorted = useMemo(() => {
        let filtered = invoices.filter(inv => {
            const q = searchQuery.toLowerCase();
            if (!q) return true;
            return (
                (inv.invoiceNumber || '').toLowerCase().includes(q) ||
                (inv.supplier || inv.shipperName || '').toLowerCase().includes(q) ||
                (inv.soldTo || '').toLowerCase().includes(q) ||
                (inv.currency || '').toLowerCase().includes(q)
            );
        });

        // Apply autofilters
        if (supplierFilter.size > 0) {
            filtered = filtered.filter(inv => {
                const name = (inv.supplier || inv.shipperName || '—').split(/\s+/)[0];
                return supplierFilter.has(name);
            });
        }
        if (statusFilter.size > 0) {
            filtered = filtered.filter(inv => statusFilter.has(getDueStatus(inv).label));
        }
        if (qbFilter.size > 0) {
            filtered = filtered.filter(inv => {
                const isSent = (inv as any).qb_status === 'Sent' || qbSyncStatuses[inv.id]?.synced;
                const label = isSent ? 'Sent' : 'Not Sent';
                return qbFilter.has(label);
            });
        }

        filtered.sort((a, b) => {
            let valA: any, valB: any;
            switch (sortKey) {
                case 'invoiceNumber': valA = a.invoiceNumber || ''; valB = b.invoiceNumber || ''; break;
                case 'supplier': valA = a.supplier || a.shipperName || ''; valB = b.supplier || b.shipperName || ''; break;
                case 'invoiceDate': valA = a.invoiceDate || a.date || ''; valB = b.invoiceDate || b.date || ''; break;
                case 'totalAmount': valA = a.totalAmount || 0; valB = b.totalAmount || 0; break;
                case 'status':
                    valA = getDueStatus(a).priority;
                    valB = getDueStatus(b).priority;
                    break;
                default: valA = ''; valB = '';
            }
            if (typeof valA === 'string') {
                const cmp = valA.localeCompare(valB);
                return sortDir === 'asc' ? cmp : -cmp;
            }
            return sortDir === 'asc' ? valA - valB : valB - valA;
        });

        return filtered;
    }, [invoices, searchQuery, sortKey, sortDir, supplierFilter, statusFilter, qbFilter, qbSyncStatuses]);

    // Unique values for autofilter dropdowns
    const uniqueSuppliers = useMemo(() => {
        const set = new Set<string>();
        invoices.forEach(inv => set.add((inv.supplier || inv.shipperName || '—').split(/\s+/)[0]));
        return Array.from(set).sort();
    }, [invoices]);

    const uniqueStatuses = useMemo(() => {
        const set = new Set<string>();
        invoices.forEach(inv => set.add(getDueStatus(inv).label));
        return Array.from(set).sort();
    }, [invoices]);

    const uniqueQbStatuses = useMemo(() => ['Sent', 'Not Sent'], []);

    const summary = useMemo(() => {
        let total = 0, overdue = 0, dueSoon = 0, count = invoices.length;
        invoices.forEach(inv => {
            const raw = inv.totalAmount;
            const amt = typeof raw === 'string' ? parseFloat(raw) || 0 : (raw || 0);
            total += amt;
            const status = getDueStatus(inv);
            if (status.label === 'Overdue') overdue += amt;
            if (status.label === 'Due Soon') dueSoon += amt;
        });
        return { total, overdue, dueSoon, count };
    }, [invoices]);

    const handleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir('asc');
        }
    };

    const SortIcon = ({ col }: { col: SortKey }) => {
        if (sortKey !== col) return <ChevronDown size={12} className="text-slate-300 ml-1" />;
        return sortDir === 'asc'
            ? <ChevronUp size={12} className="text-indigo-600 ml-1" />
            : <ChevronDown size={12} className="text-indigo-600 ml-1" />;
    };

    // --- OCR Upload Handlers ---
    const resetOcrModal = () => {
        setShowOcrModal(false);
        setOcrStep('upload');
        setOcrStatus('');
        setOcrFiles([]);
        setOcrCurrentIndex(0);
        setOcrPreview(null);
        setOcrFormData({});
        setOcrItems([]);
        setOcrOriginalDoc('');
        setIsDragging(false);
        setOcrSaving(false);
        setOcrSaved(false);
    };

    const processFileAtIndex = useCallback(async (files: File[], index: number) => {
        const file = files[index];
        if (!file) return;
        setOcrStep('processing');
        setOcrStatus('Reading file...');
        setOcrPreview(null);
        setOcrFormData({});
        setOcrItems([]);
        setOcrOriginalDoc('');
        setOcrSaving(false);
        setOcrSaved(false);

        try {
            const reader = new FileReader();
            const base64 = await new Promise<string>((resolve, reject) => {
                reader.onload = () => {
                    const result = reader.result as string;
                    const base64Part = result.split(',')[1];
                    resolve(base64Part);
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            setOcrOriginalDoc(`data:${file.type};base64,${base64}`);
            setOcrPreview(`data:${file.type};base64,${base64}`);
            setOcrStatus('AI extracting invoice data...');

            const rawResult = await analyzeDocument(base64, file.type, SUPPLIER_INVOICE_EXTRACTION_PROMPT);
            setOcrStatus('Parsing results...');

            let cleanText = typeof rawResult === 'string' ? rawResult : String(rawResult);
            if (cleanText.startsWith('"') && cleanText.includes('\\"')) {
                cleanText = cleanText.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '').trim();
            }
            const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No JSON found in AI response');

            const extracted = JSON.parse(jsonMatch[0]);

            // Build form data from OCR field map
            const formData: Record<string, any> = {};
            OCR_FIELD_MAP.forEach(field => {
                const val = extracted[field.ocrKey];
                if (field.type === 'number') {
                    formData[field.key] = val ? Number(val) : 0;
                } else {
                    formData[field.key] = val ? String(val) : '';
                }
            });

            // Handle supplier fallback
            if (!formData.supplier && formData.shipperName) {
                formData.supplier = formData.shipperName;
            }

            setOcrFormData(formData);
            setOcrItems(extracted.ITEMS || []);
            setOcrStep('review');
            setOcrStatus('');
        } catch (err: any) {
            console.error('OCR extraction failed:', err);
            setOcrStatus(`Error: ${err.message || 'Extraction failed'}`);
            setTimeout(() => setOcrStep('upload'), 2000);
        }
    }, []);

    const handleFilesSelect = useCallback((files: File[]) => {
        if (files.length === 0) return;
        setOcrFiles(files);
        setOcrCurrentIndex(0);
        processFileAtIndex(files, 0);
    }, [processFileAtIndex]);

    const handleOcrDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) handleFilesSelect(files);
    }, [handleFilesSelect]);

    const handleOcrSave = async () => {
        if (!onSave) return;
        setOcrSaving(true);
        try {
            const d = ocrFormData;
            const cleanNum = (v: any) => {
                if (v == null || v === '') return 0;
                const n = typeof v === 'string' ? parseFloat(v.replace(/[^0-9.-]/g, '')) : Number(v);
                return isNaN(n) ? 0 : n;
            };
            const recordId = `SINV${Date.now()}`;
            // Step 1: Insert record WITHOUT the large originalDocument
            const record = {
                id: recordId,
                companyId: currentCompanyId || 'ALL',
                createdAt: new Date().toISOString(),
                invoiceNumber: String(d.invoiceNumber || ''),
                invoiceDate: String(d.invoiceDate || ''),
                shipperName: String(d.shipperName || d.supplier || ''),
                shipperAddress: String(d.shipperAddress || ''),
                soldTo: String(d.soldTo || ''),
                shipTo: String(d.shipTo || ''),
                paymentTerms: String(d.paymentTerms || ''),
                incoterms: String(d.incoterms || ''),
                dateOrder: String(d.dateOrder || ''),
                customerPo: String(d.customerPo || ''),
                carrier: String(d.carrier || ''),
                transportRef: String(d.transportRef || ''),
                freightTerms: String(d.freightTerms || ''),
                items: JSON.stringify(ocrItems),
                grossWeight: String(d.grossWeight || ''),
                netWeight: String(d.netWeight || ''),
                tareWeight: String(d.tareWeight || ''),
                totalQuantity: String(d.totalQuantity || ''),
                subtotal: cleanNum(d.subtotal),
                totalAmount: cleanNum(d.totalAmount),
                currency: String(d.currency || 'USD'),
                remitTo: String(d.remitTo || ''),
                bankName: String(d.bankName || ''),
                swiftCode: String(d.swiftCode || ''),
                routingNumber: String(d.routingNumber || ''),
                accountNumber: String(d.accountNumber || ''),
                originalDocument: '',
            };
            const result = await onSave(record);
            if (result === null) {
                setOcrStatus('Save failed — check console for details');
                setOcrSaving(false);
                return;
            }

            // Step 2: Update the record with the originalDocument via direct Supabase call
            if (ocrOriginalDoc) {
                try {
                    const { getSupabaseClient } = await import('../services/supabase');
                    const supabase = getSupabaseClient();
                    await supabase
                        .from('invoices_suppliers')
                        .update({ originalDocument: ocrOriginalDoc })
                        .eq('id', recordId);
                } catch (docErr) {
                    console.warn('Document attachment failed, record saved without PDF:', docErr);
                }
            }

            setOcrSaved(true);
            // If more files in queue, advance to next after brief delay
            const nextIndex = ocrCurrentIndex + 1;
            if (nextIndex < ocrFiles.length) {
                setTimeout(() => {
                    setOcrCurrentIndex(nextIndex);
                    processFileAtIndex(ocrFiles, nextIndex);
                }, 1000);
            } else {
                setTimeout(() => resetOcrModal(), 1500);
            }
        } catch (err: any) {
            console.error('Save failed:', err);
            setOcrStatus(`Save error: ${err.message || 'Unknown error'}`);
            setOcrSaving(false);
        }
    };

    return (
        <div className="p-4 mx-auto" onClick={() => openFilter && setOpenFilter(null)}>
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2.5 bg-gradient-to-br from-rose-500 to-pink-600 rounded-xl text-white shadow-lg shadow-rose-200">
                    <ArrowDownRight size={22} />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">Payables</h1>
                    <p className="text-sm text-slate-500">Track supplier invoices, amounts and due dates</p>
                </div>
                <div className="ml-auto flex items-center gap-3">
                    <button
                        onClick={() => setShowOcrModal(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-lg text-sm font-semibold hover:from-indigo-700 hover:to-violet-700 transition-all shadow-md shadow-indigo-200 active:scale-[0.97]"
                    >
                        <Upload size={16} />
                        OCR Upload
                    </button>
                    <button
                        onClick={handleTransmitToQB}
                        disabled={qbTransmitting}
                        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-lg text-sm font-semibold hover:from-green-700 hover:to-emerald-700 transition-all shadow-md shadow-green-200 active:scale-[0.97] disabled:opacity-60"
                    >
                        {qbTransmitting ? (
                            <><Loader2 size={16} className="animate-spin" /> Sending {qbTransmitProgress.sent}/{qbTransmitProgress.total}...</>
                        ) : (
                            <><Send size={16} /> Transmit to QB</>
                        )}
                    </button>
                    <button
                        onClick={async () => {
                            setQbSyncingPayment(true);
                            try {
                                const result = await checkPaymentStatuses(currentCompanyId || 'ALL');
                                if (result.paidCount > 0) {
                                    alert(`Updated ${result.paidCount} bill(s) to Paid status.\nRefresh the page to see changes.`);
                                    window.location.reload();
                                } else {
                                    alert(`Checked ${result.checked} bill(s) — none newly paid in QuickBooks.`);
                                }
                            } catch (err: any) {
                                alert(`Sync failed: ${err.message}`);
                            } finally {
                                setQbSyncingPayment(false);
                            }
                        }}
                        disabled={qbSyncingPayment}
                        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-lg text-sm font-semibold hover:from-blue-700 hover:to-cyan-700 transition-all shadow-md shadow-blue-200 active:scale-[0.97] disabled:opacity-60"
                    >
                        {qbSyncingPayment ? (
                            <><Loader2 size={16} className="animate-spin" /> Syncing...</>
                        ) : (
                            <><RefreshCw size={16} /> Sync from QB</>
                        )}
                    </button>
                </div>
            </div>

            {/* Summary Row */}
            <div className="flex items-center gap-6 mb-4 bg-white rounded-xl border border-slate-200 px-5 py-2.5">
                <div className="flex items-center gap-2">
                    <DollarSign size={14} className="text-blue-600" />
                    <span className="text-xs font-semibold text-slate-400 uppercase">Total Outstanding</span>
                    <span className="text-sm font-bold text-slate-800">{formatCurrency(summary.total)}</span>
                </div>
                <div className="w-px h-5 bg-slate-200" />
                <div className="flex items-center gap-2">
                    <AlertCircle size={14} className="text-rose-600" />
                    <span className="text-xs font-semibold text-slate-400 uppercase">Overdue</span>
                    <span className="text-sm font-bold text-rose-600">{formatCurrency(summary.overdue)}</span>
                </div>
                <div className="w-px h-5 bg-slate-200" />
                <div className="flex items-center gap-2">
                    <Clock size={14} className="text-amber-600" />
                    <span className="text-xs font-semibold text-slate-400 uppercase">Due Soon</span>
                    <span className="text-sm font-bold text-amber-600">{formatCurrency(summary.dueSoon)}</span>
                </div>
                <div className="w-px h-5 bg-slate-200" />
                <div className="flex items-center gap-2">
                    <CheckCircle size={14} className="text-emerald-600" />
                    <span className="text-xs font-semibold text-slate-400 uppercase">Invoices</span>
                    <span className="text-sm font-bold text-slate-800">{summary.count}</span>
                </div>
            </div>

            {/* Search */}
            <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                    type="text"
                    placeholder="Search by invoice #, supplier, customer..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-rose-500 focus:border-rose-500 outline-none text-sm"
                />
            </div>

            {/* Data Table */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200">
                                {[
                                    { key: 'invoiceDate' as SortKey, label: 'Date', filterable: false },
                                    { key: 'supplier' as SortKey, label: 'Supplier', filterable: true, filterKey: 'supplier' },
                                    { key: 'invoiceNumber' as SortKey, label: 'Invoice #', filterable: false },
                                    { key: 'invoiceDate' as SortKey, label: 'Product/Service', filterable: false },
                                    { key: 'supplier' as SortKey, label: 'Material', filterable: false },
                                    { key: 'supplier' as SortKey, label: 'Net Weight', filterable: false },
                                    { key: 'invoiceDate' as SortKey, label: 'Incoterms', filterable: false },
                                    { key: 'invoiceDate' as SortKey, label: 'Pay Terms', filterable: false },
                                    { key: 'totalAmount' as SortKey, label: 'Amount', filterable: false },
                                    { key: 'invoiceDate' as SortKey, label: 'Due Date', filterable: false },
                                    { key: 'status' as SortKey, label: 'Status', filterable: true, filterKey: 'status' },
                                    { key: 'status' as SortKey, label: 'QB', filterable: true, filterKey: 'qb' },
                                ].map((col) => (
                                    <th
                                        key={col.label}
                                        className="px-2 py-1 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider select-none whitespace-nowrap relative"
                                    >
                                        <div className="flex items-center gap-1">
                                            <span className="cursor-pointer hover:text-slate-700" onClick={() => handleSort(col.key)}>
                                                {col.label}
                                                <SortIcon col={col.key} />
                                            </span>
                                            {col.filterable && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setOpenFilter(openFilter === col.filterKey ? null : (col.filterKey || null)); }}
                                                    className={`p-0.5 rounded hover:bg-slate-200 transition-colors ${(col.filterKey === 'supplier' && supplierFilter.size > 0) || (col.filterKey === 'status' && statusFilter.size > 0) || (col.filterKey === 'qb' && qbFilter.size > 0)
                                                        ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400'
                                                        }`}
                                                    title={`Filter ${col.label}`}
                                                >
                                                    <ChevronDown size={12} />
                                                </button>
                                            )}
                                        </div>
                                        {/* Autofilter Dropdown */}
                                        {col.filterable && openFilter === col.filterKey && (
                                            <div className="absolute top-full left-0 z-40 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl min-w-[170px] max-h-64 overflow-y-auto py-1" onClick={e => e.stopPropagation()}>
                                                <div className="flex items-center gap-2 px-3 py-1 border-b border-slate-100 mb-1">
                                                    <button
                                                        onClick={() => {
                                                            const allVals = col.filterKey === 'supplier' ? uniqueSuppliers : col.filterKey === 'status' ? uniqueStatuses : uniqueQbStatuses;
                                                            const setter = col.filterKey === 'supplier' ? setSupplierFilter : col.filterKey === 'status' ? setStatusFilter : setQbFilter;
                                                            setter(new Set(allVals));
                                                        }}
                                                        className="text-[10px] text-indigo-600 hover:underline font-medium"
                                                    >All</button>
                                                    <span className="text-slate-300">|</span>
                                                    <button
                                                        onClick={() => {
                                                            const setter = col.filterKey === 'supplier' ? setSupplierFilter : col.filterKey === 'status' ? setStatusFilter : setQbFilter;
                                                            setter(new Set());
                                                        }}
                                                        className="text-[10px] text-slate-500 hover:underline font-medium"
                                                    >Clear</button>
                                                </div>
                                                {(col.filterKey === 'supplier' ? uniqueSuppliers : col.filterKey === 'status' ? uniqueStatuses : uniqueQbStatuses).map(val => {
                                                    const currentSet = col.filterKey === 'supplier' ? supplierFilter : col.filterKey === 'status' ? statusFilter : qbFilter;
                                                    const setter = col.filterKey === 'supplier' ? setSupplierFilter : col.filterKey === 'status' ? setStatusFilter : setQbFilter;
                                                    const isChecked = currentSet.has(val);
                                                    return (
                                                        <label key={val} className="flex items-center gap-2 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                checked={isChecked}
                                                                onChange={() => {
                                                                    const next = new Set(currentSet);
                                                                    isChecked ? next.delete(val) : next.add(val);
                                                                    setter(next);
                                                                }}
                                                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                                                            />
                                                            {val}
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </th>
                                ))}
                                <th className="px-2 py-1 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredAndSorted.length === 0 ? (
                                <tr><td colSpan={13} className="text-center py-12 text-slate-400">
                                    <div className="flex flex-col items-center">
                                        <FileText className="w-10 h-10 text-slate-200 mb-2" />
                                        <p className="font-medium text-slate-500">No invoices match the current filters</p>
                                        <p className="text-xs mt-1">Try adjusting your filters or search</p>
                                    </div>
                                </td></tr>
                            ) : filteredAndSorted.map(inv => {
                                const status = getDueStatus(inv);
                                const isExpanded = expandedId === inv.id;
                                const weight = formatWeight(inv.netWeight);
                                return (
                                    <React.Fragment key={inv.id}>
                                        <tr
                                            className={`hover:bg-slate-50 transition-colors cursor-pointer ${isExpanded ? 'bg-slate-50' : ''}`}
                                            onClick={() => setExpandedId(isExpanded ? null : inv.id)}
                                        >
                                            <td className="px-2 py-0.5 text-slate-600 whitespace-nowrap text-xs">
                                                {formatDate(inv.invoiceDate || inv.date)}
                                            </td>
                                            <td className="px-2 py-0.5 text-slate-700 text-xs truncate max-w-[100px]" title={inv.supplier || inv.shipperName || ''}>
                                                {(inv.supplier || inv.shipperName || '—').split(/\s+/)[0]}
                                            </td>
                                            <td className="px-2 py-0.5">
                                                <span className="font-semibold text-slate-800 font-mono text-xs">
                                                    {inv.invoiceNumber || '—'}
                                                </span>
                                            </td>
                                            <td className="px-2 py-0.5" onClick={e => e.stopPropagation()}>
                                                <select
                                                    className="text-[10px] bg-white border border-slate-200 rounded px-1 py-0.5 text-slate-700 max-w-[130px] focus:outline-none focus:ring-1 focus:ring-indigo-300 cursor-pointer"
                                                    value={productServiceMap[inv.id] ?? (inv as any).qb_product_service ?? ''}
                                                    onChange={e => {
                                                        handleProductServiceChange(inv.id, e.target.value);
                                                    }}
                                                >
                                                    <option value="">— Select —</option>
                                                    {qbItems.filter(it => it.type !== 'Category').map(item => (
                                                        <option key={item.id} value={item.fullyQualifiedName}>
                                                            {item.fullyQualifiedName}
                                                        </option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td className="px-2 py-0.5 text-slate-700 max-w-[180px] truncate text-xs">
                                                {getMaterialDescription(inv, systemProducts)}
                                            </td>
                                            <td className="px-2 py-0.5 text-slate-600 whitespace-nowrap text-xs">
                                                {weight.lbs} lbs <span className="text-slate-400">/ {weight.kgs} kg</span>
                                            </td>
                                            <td className="px-2 py-0.5 text-slate-600 whitespace-nowrap text-xs">
                                                {(inv as any).incoterms || inv.incoterm || '—'}
                                            </td>
                                            <td className="px-2 py-0.5 text-slate-600 whitespace-nowrap text-xs">
                                                {inv.paymentTerms || '—'}
                                            </td>
                                            <td className="px-2 py-0.5 text-slate-800 whitespace-nowrap text-xs font-semibold">
                                                {formatCurrency(inv.totalAmount)}
                                            </td>
                                            <td className="px-2 py-0.5 text-slate-600 whitespace-nowrap text-xs">
                                                {status.dueDate ? formatDate(status.dueDate.toISOString()) : '—'}
                                            </td>
                                            <td className="px-2 py-0.5">
                                                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-${status.color}-50 text-${status.color}-700`}>
                                                    {status.label === 'Overdue' && <AlertCircle size={9} />}
                                                    {status.label === 'Due Soon' && <Clock size={9} />}
                                                    {status.label === 'On Track' && <CheckCircle size={9} />}
                                                    {status.label}
                                                </span>
                                            </td>
                                            <td className="px-2 py-0.5 whitespace-nowrap text-xs">
                                                {(inv as any).qb_status === 'Sent' || qbSyncStatuses[inv.id]?.synced ? (
                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-green-50 text-green-700">
                                                        <CheckCircle size={9} /> Sent
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-400">
                                                        —
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-2 py-0.5" onClick={(e) => e.stopPropagation()}>
                                                <div className="flex items-center gap-1">
                                                    <button
                                                        onClick={() => handleViewPdf(inv)}
                                                        className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                                                        title="View PDF"
                                                    >
                                                        <Eye size={14} />
                                                    </button>
                                                    <button
                                                        onClick={() => openEditModal(inv)}
                                                        className="p-1 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-md transition-colors"
                                                        title="Edit"
                                                    >
                                                        <Pencil size={14} />
                                                    </button>
                                                    <button
                                                        onClick={() => openPayModal(inv)}
                                                        className={`p-1.5 rounded-md transition-colors ${(inv as any).status === 'Paid' ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'}`}
                                                        title={(inv as any).status === 'Paid' ? 'Paid' : 'Mark as Paid'}
                                                    >
                                                        <DollarSign size={14} />
                                                    </button>
                                                    {/* QuickBooks Sync Button */}
                                                    {(
                                                        qbSyncStatuses[inv.id]?.synced ? (
                                                            <span
                                                                className="p-1.5 rounded-md text-green-600 bg-green-50 cursor-default"
                                                                title={`Synced to QB as Bill #${qbSyncStatuses[inv.id].qbEntityId} on ${qbSyncStatuses[inv.id].syncedAt ? new Date(qbSyncStatuses[inv.id].syncedAt!).toLocaleDateString() : ''}`}
                                                            >
                                                                <CheckCircle size={14} />
                                                            </span>
                                                        ) : (
                                                            <button
                                                                onClick={() => handleSendToQB(inv)}
                                                                disabled={qbSyncing === inv.id}
                                                                className={`p-1.5 rounded-md transition-colors ${qbSyncing === inv.id ? 'text-indigo-400 bg-indigo-50 animate-pulse' : 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'}`}
                                                                title={qbSyncStatuses[inv.id]?.error ? `Retry — last error: ${qbSyncStatuses[inv.id].error}` : 'Send to QuickBooks'}
                                                            >
                                                                {qbSyncing === inv.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                                            </button>
                                                        )
                                                    )}
                                                    {deleteConfirmId === inv.id ? (
                                                        <div className="flex items-center gap-1">
                                                            <button
                                                                onClick={() => { onDelete?.(inv.id); setDeleteConfirmId(null); }}
                                                                className="px-2 py-0.5 text-xs font-semibold text-white bg-rose-500 hover:bg-rose-600 rounded-md transition-colors"
                                                            >
                                                                Yes
                                                            </button>
                                                            <button
                                                                onClick={() => setDeleteConfirmId(null)}
                                                                className="px-2 py-0.5 text-xs font-semibold text-slate-500 hover:text-slate-700 bg-slate-100 rounded-md transition-colors"
                                                            >
                                                                No
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => setDeleteConfirmId(inv.id)}
                                                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                                                            title="Delete"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                        {isExpanded && (
                                            <tr>
                                                <td colSpan={12} className="px-4 py-4 bg-slate-50/80">
                                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                                                        <div>
                                                            <p className="text-slate-400 font-semibold uppercase mb-0.5">Payment Terms</p>
                                                            <p className="text-slate-700">{inv.paymentTerms || '—'}</p>
                                                        </div>
                                                        <div>
                                                            <p className="text-slate-400 font-semibold uppercase mb-0.5">Due Date</p>
                                                            <p className="text-slate-700">{status.dueDate ? formatDate(status.dueDate.toISOString()) : '—'}</p>
                                                        </div>
                                                        <div>
                                                            <p className="text-slate-400 font-semibold uppercase mb-0.5">Currency</p>
                                                            <p className="text-slate-700">{inv.currency || 'USD'}</p>
                                                        </div>
                                                        <div>
                                                            <p className="text-slate-400 font-semibold uppercase mb-0.5">Subtotal</p>
                                                            <p className="text-slate-700">{formatCurrency(inv.subtotal)}</p>
                                                        </div>
                                                        {inv.soldTo && (
                                                            <div>
                                                                <p className="text-slate-400 font-semibold uppercase mb-0.5">Sold To</p>
                                                                <p className="text-slate-700">{inv.soldTo}</p>
                                                            </div>
                                                        )}
                                                        {inv.shipTo && (
                                                            <div>
                                                                <p className="text-slate-400 font-semibold uppercase mb-0.5">Ship To</p>
                                                                <p className="text-slate-700">{inv.shipTo}</p>
                                                            </div>
                                                        )}
                                                        {inv.bankName && (
                                                            <div>
                                                                <p className="text-slate-400 font-semibold uppercase mb-0.5">Bank</p>
                                                                <p className="text-slate-700">{inv.bankName}</p>
                                                            </div>
                                                        )}
                                                        {inv.swiftCode && (
                                                            <div>
                                                                <p className="text-slate-400 font-semibold uppercase mb-0.5">SWIFT</p>
                                                                <p className="text-slate-700 font-mono">{inv.swiftCode}</p>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* OCR Upload Modal */}
            {showOcrModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
                        {/* Modal Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-indigo-50 to-violet-50">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-lg text-white">
                                    <Upload size={18} />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-slate-800">OCR Upload</h2>
                                    <p className="text-xs text-slate-500">Upload a supplier invoice for AI extraction</p>
                                </div>
                            </div>
                            <button onClick={resetOcrModal} className="p-2 hover:bg-slate-200 rounded-lg transition-colors">
                                <X size={18} className="text-slate-500" />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="flex-1 overflow-y-auto p-6">
                            {/* Step 1: Upload */}
                            {ocrStep === 'upload' && (
                                <div
                                    className={`border-2 border-dashed rounded-2xl p-16 text-center transition-all cursor-pointer
                                        ${isDragging ? 'border-indigo-500 bg-indigo-50 scale-[1.01]' : 'border-slate-300 hover:border-indigo-400 hover:bg-slate-50'}`}
                                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                    onDragLeave={() => setIsDragging(false)}
                                    onDrop={handleOcrDrop}
                                    onClick={() => {
                                        const input = document.createElement('input');
                                        input.type = 'file';
                                        input.accept = '.pdf,.png,.jpg,.jpeg,.tiff,.webp';
                                        input.multiple = true;
                                        input.onchange = (e) => {
                                            const fileList = (e.target as HTMLInputElement).files;
                                            if (fileList && fileList.length > 0) handleFilesSelect(Array.from(fileList));
                                        };
                                        input.click();
                                    }}
                                >
                                    <UploadCloud size={48} className={`mx-auto mb-4 ${isDragging ? 'text-indigo-600' : 'text-slate-300'}`} />
                                    <p className="text-lg font-semibold text-slate-700 mb-1">
                                        {isDragging ? 'Drop your files here' : 'Drag & drop supplier invoices'}
                                    </p>
                                    <p className="text-sm text-slate-400 mb-4">or click to browse — multiple files supported</p>
                                    <p className="text-xs text-slate-300">Supports PDF, PNG, JPEG, TIFF</p>
                                </div>
                            )}

                            {/* Step 2: Processing */}
                            {ocrStep === 'processing' && (
                                <div className="text-center py-20">
                                    <Loader2 size={48} className="text-indigo-600 animate-spin mx-auto mb-6" />
                                    <p className="text-lg font-semibold text-slate-700 mb-2">Processing Document</p>
                                    <p className="text-sm text-slate-500">{ocrStatus}</p>
                                    {ocrFiles.length > 0 && (
                                        <p className="text-xs text-slate-400 mt-3">
                                            {ocrFiles[ocrCurrentIndex]?.name}
                                            {ocrFiles.length > 1 && ` (file ${ocrCurrentIndex + 1} of ${ocrFiles.length})`}
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Step 3: Review & Edit */}
                            {ocrStep === 'review' && (
                                <div className="space-y-6">
                                    <div className="flex items-center gap-2 mb-2">
                                        <CheckCircle size={16} className="text-emerald-600" />
                                        <p className="text-sm font-semibold text-emerald-700">
                                            Extraction complete{ocrFiles.length > 1 ? ` (file ${ocrCurrentIndex + 1} of ${ocrFiles.length})` : ''} — review and edit below
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {OCR_FIELD_MAP.map(field => (
                                            <div key={field.key}>
                                                <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">{field.label}</label>
                                                {field.type === 'select' ? (
                                                    <select
                                                        value={ocrFormData[field.key] ?? ''}
                                                        onChange={(e) => setOcrFormData(prev => ({
                                                            ...prev,
                                                            [field.key]: e.target.value
                                                        }))}
                                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-white"
                                                    >
                                                        {INCOTERMS_OPTIONS.map(opt => (
                                                            <option key={opt} value={opt}>{opt || '— Select —'}</option>
                                                        ))}
                                                        {/* Keep OCR value if not in standard list */}
                                                        {ocrFormData[field.key] && !INCOTERMS_OPTIONS.includes(ocrFormData[field.key]) && (
                                                            <option value={ocrFormData[field.key]}>{ocrFormData[field.key]} (OCR)</option>
                                                        )}
                                                    </select>
                                                ) : (
                                                    <input
                                                        type={field.type}
                                                        value={ocrFormData[field.key] ?? ''}
                                                        onChange={(e) => setOcrFormData(prev => ({
                                                            ...prev,
                                                            [field.key]: field.type === 'number' ? Number(e.target.value) : e.target.value
                                                        }))}
                                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                                    />
                                                )}
                                            </div>
                                        ))}
                                    </div>

                                    {/* Items Table */}
                                    {ocrItems.length > 0 && (
                                        <div>
                                            <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Line Items ({ocrItems.length})</p>
                                            <div className="border border-slate-200 rounded-lg overflow-hidden">
                                                <table className="w-full text-xs">
                                                    <thead className="bg-slate-50">
                                                        <tr>
                                                            <th className="px-3 py-2 text-left font-semibold text-slate-500">Description</th>
                                                            <th className="px-3 py-2 text-right font-semibold text-slate-500">Qty</th>
                                                            <th className="px-3 py-2 text-right font-semibold text-slate-500">Unit Price</th>
                                                            <th className="px-3 py-2 text-right font-semibold text-slate-500">Amount</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {ocrItems.map((item: any, idx: number) => (
                                                            <tr key={idx}>
                                                                <td className="px-3 py-2 text-slate-700">{item.description || '—'}</td>
                                                                <td className="px-3 py-2 text-right text-slate-600">{item.quantity || '—'}</td>
                                                                <td className="px-3 py-2 text-right text-slate-600">{item.unit_price || '—'}</td>
                                                                <td className="px-3 py-2 text-right font-semibold text-slate-800">{item.amount || '—'}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Modal Footer */}
                        {ocrStep === 'review' && (
                            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
                                <button
                                    onClick={resetOcrModal}
                                    className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleOcrSave}
                                    disabled={ocrSaving || ocrSaved || !onSave}
                                    className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all
                                        ${ocrSaved
                                            ? 'bg-emerald-500 text-white'
                                            : 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:from-indigo-700 hover:to-violet-700 shadow-md shadow-indigo-200 active:scale-[0.97]'
                                        } disabled:opacity-60`}
                                >
                                    {ocrSaved ? (
                                        <><CheckCircle size={16} /> Saved!</>
                                    ) : ocrSaving ? (
                                        <><Loader2 size={16} className="animate-spin" /> Saving...</>
                                    ) : (
                                        <><Save size={16} /> {ocrCurrentIndex < ocrFiles.length - 1 ? 'Save & Next' : 'Save Invoice'}</>
                                    )}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
            {/* View Document Modal */}
            {viewInvoice && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[90vh] overflow-hidden flex flex-col">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-indigo-50 to-blue-50">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-lg text-white">
                                    <FileText size={18} />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-slate-800">View Document</h2>
                                    <p className="text-xs text-slate-500">{viewInvoice.invoiceNumber || viewInvoice.id}</p>
                                </div>
                            </div>
                            <button onClick={() => setViewInvoice(null)} className="p-2 hover:bg-slate-200 rounded-lg transition-colors">
                                <X size={18} className="text-slate-500" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-hidden">
                            {viewInvoice.originalDocument?.startsWith('data:application/pdf') ? (
                                <iframe src={viewInvoice.originalDocument} className="w-full h-full border-none" title="Invoice PDF" />
                            ) : viewInvoice.originalDocument?.startsWith('data:image/') ? (
                                <div className="w-full h-full overflow-auto flex items-start justify-center p-4 bg-slate-100">
                                    <img src={viewInvoice.originalDocument} alt="Invoice" className="max-w-full shadow-lg rounded-lg" />
                                </div>
                            ) : (
                                <iframe src={viewInvoice.originalDocument} className="w-full h-full border-none" title="Invoice" />
                            )}
                        </div>
                    </div>
                </div>
            )}
            {/* Edit Modal */}
            {editInvoice && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-amber-50 to-orange-50">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-gradient-to-br from-amber-500 to-orange-500 rounded-lg text-white">
                                    <Pencil size={18} />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-slate-800">Edit Invoice</h2>
                                    <p className="text-xs text-slate-500">{editInvoice.invoiceNumber || editInvoice.id}</p>
                                </div>
                            </div>
                            <button onClick={() => setEditInvoice(null)} className="p-2 hover:bg-slate-200 rounded-lg transition-colors">
                                <X size={18} className="text-slate-500" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {EDIT_FIELDS.map(field => (
                                    <div key={field.key}>
                                        <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">{field.label}</label>
                                        {field.type === 'select' ? (
                                            <select
                                                value={editFormData[field.key] ?? ''}
                                                onChange={(e) => setEditFormData(prev => ({ ...prev, [field.key]: e.target.value }))}
                                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none bg-white"
                                            >
                                                {INCOTERMS_OPTIONS.map(opt => (
                                                    <option key={opt} value={opt}>{opt || '— Select —'}</option>
                                                ))}
                                                {editFormData[field.key] && !INCOTERMS_OPTIONS.includes(editFormData[field.key]) && (
                                                    <option value={editFormData[field.key]}>{editFormData[field.key]}</option>
                                                )}
                                            </select>
                                        ) : (
                                            <input
                                                type={field.type}
                                                value={editFormData[field.key] ?? ''}
                                                onChange={(e) => setEditFormData(prev => ({
                                                    ...prev,
                                                    [field.key]: field.type === 'number' ? Number(e.target.value) : e.target.value
                                                }))}
                                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                                            />
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
                            <button onClick={() => setEditInvoice(null)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors">
                                Cancel
                            </button>
                            <button
                                onClick={handleEditSave}
                                disabled={editSaving || !onUpdate}
                                className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg text-sm font-semibold hover:from-amber-600 hover:to-orange-600 shadow-md shadow-amber-200 active:scale-[0.97] disabled:opacity-60 transition-all"
                            >
                                {editSaving ? (<><Loader2 size={16} className="animate-spin" /> Saving...</>) : (<><Save size={16} /> Save Changes</>)}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Mark as Paid Modal */}
            {payInvoice && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-emerald-50 to-green-50">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-gradient-to-br from-emerald-500 to-green-600 rounded-lg text-white">
                                    <DollarSign size={18} />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-slate-800">Mark as Paid</h2>
                                    <p className="text-xs text-slate-500">{payInvoice.invoiceNumber || payInvoice.id} — {formatCurrency(payInvoice.totalAmount)}</p>
                                </div>
                            </div>
                            <button onClick={() => setPayInvoice(null)} className="p-2 hover:bg-slate-200 rounded-lg transition-colors">
                                <X size={18} className="text-slate-500" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">Payment Date</label>
                                <input
                                    type="date"
                                    value={payDate}
                                    onChange={(e) => setPayDate(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">Bank</label>
                                <select
                                    value={payBankId}
                                    onChange={(e) => setPayBankId(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none bg-white"
                                >
                                    <option value="">— Select Bank —</option>
                                    {banks.map(b => (
                                        <option key={b.id} value={b.id}>{b.name} {b.code ? `(${b.code})` : ''}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
                            <button onClick={() => setPayInvoice(null)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors">
                                Cancel
                            </button>
                            <button
                                onClick={handleMarkPaid}
                                disabled={paySaving || !payDate || !onUpdate}
                                className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-lg text-sm font-semibold hover:from-emerald-600 hover:to-green-700 shadow-md shadow-emerald-200 active:scale-[0.97] disabled:opacity-60 transition-all"
                            >
                                {paySaving ? (<><Loader2 size={16} className="animate-spin" /> Saving...</>) : (<><CheckCircle size={16} /> Confirm Payment</>)}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default FinancePayables;
