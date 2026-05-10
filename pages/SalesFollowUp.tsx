import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Phone, Loader2, RefreshCw, AlertCircle, Calendar, User, FileText, Package, Download, Mail, X, Send, CheckCircle2, Scale, DollarSign, Landmark } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { sendEmail } from '../services/emailService';
import { getSupabaseClient } from '../services/supabase';
import {
    fetchQBCustomers,
    fetchCustomerStatement,
    QBCustomer,
    QBCustomerStatement,
    QBStatementInvoice,
    QBStatementReceipt,
} from '../services/quickbooksService';
import { Company, Customer, SalesOrder, Invoice } from '../types';

interface SalesFollowUpProps {
    currentCompanyId?: string;
    availableCompanies?: Company[];
    customers?: Customer[];
    salesOrders?: SalesOrder[];
    invoices?: Invoice[];
}

const normalizeName = (s: string | undefined | null): string =>
    (s || '')
        .toLowerCase()
        .replace(/[.,'"`()\-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

// Product-name key: like normalizeName but also drops anything in parentheses
// (e.g. "(New)", "(Original)") since those are typically data-entry qualifiers
// for the same underlying product, not a different SKU.
const productKey = (s: string | undefined | null): string =>
    (s || '')
        .toLowerCase()
        .replace(/\([^)]*\)/g, ' ')
        .replace(/[.,'"`\-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const toNum = (val: any): number => {
    if (val == null) return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    const cleaned = String(val).replace(/,/g, '').replace(/[^0-9.-]/g, '');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
};

const LBS_TO_KGS = 0.453592;

type Unit = 'LBS' | 'KGS';

const formatQty = (lbs: number, unit: Unit): string => {
    if (!lbs) return '—';
    if (unit === 'KGS') return `${Math.round(lbs * LBS_TO_KGS).toLocaleString()} kgs`;
    return `${Math.round(lbs).toLocaleString()} lbs`;
};

const unitLabel = (unit: Unit) => unit === 'KGS' ? 'KGS' : 'LBS';

const parseInvoiceItems = (inv: Invoice): Array<{ productName: string; quantity: number }> => {
    const raw = inv.items;
    if (!raw) return [];
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!Array.isArray(parsed)) return [];
        return parsed.map((i: any) => ({
            productName: String(i.productName || i.description || i.productDescription || i.product || '').trim(),
            quantity: toNum(i.quantity ?? i.qty ?? i.qtyLbs ?? i.quantityLbs),
        }));
    } catch {
        return [];
    }
};

const orderProducts = (so: SalesOrder): Array<{ productName: string; quantity: number }> =>
    (so.items || []).map(i => ({ productName: String(i.productName || '').trim(), quantity: toNum(i.quantity) }));

const joinProductNames = (items: Array<{ productName: string }>): string => {
    const names = items.map(i => i.productName).filter(Boolean);
    if (names.length === 0) return '—';
    if (names.length === 1) return names[0];
    return `${names[0]} +${names.length - 1}`;
};

const totalQty = (items: Array<{ quantity: number }>): number =>
    items.reduce((s, i) => s + (i.quantity || 0), 0);

// Match an ERP customer to a QB customer when the names differ slightly
// (e.g. QB = "ALGOPOR", ERP = "ALGOPOR LIMITED"). Tries in order:
// exact normalized name, nickname, then token-prefix containment.
const findQbMatch = (customer: Customer, qbCustomers: QBCustomer[]): QBCustomer | undefined => {
    const nameKey = normalizeName(customer.name);
    const nickKey = normalizeName(customer.nickname);
    // 1. exact match on name or nickname
    let hit = qbCustomers.find(c => {
        const qb = normalizeName(c.displayName);
        return qb === nameKey || (nickKey && qb === nickKey);
    });
    if (hit) return hit;
    // 2. containment either direction (handles suffixes like "LIMITED", "LTDA", "S.A.")
    const candidates = [nameKey, nickKey].filter(Boolean);
    for (const key of candidates) {
        hit = qbCustomers.find(c => {
            const qb = normalizeName(c.displayName);
            return qb && (qb.startsWith(key + ' ') || key.startsWith(qb + ' ') || qb === key);
        });
        if (hit) return hit;
    }
    // 3. first-token match as last resort (e.g. "AXIOS COMERCIO" vs "AXIOS")
    for (const key of candidates) {
        const firstTok = key.split(' ')[0];
        if (firstTok.length < 3) continue;
        hit = qbCustomers.find(c => {
            const qb = normalizeName(c.displayName);
            const qbFirst = qb.split(' ')[0];
            return qbFirst === firstTok;
        });
        if (hit) return hit;
    }
    return undefined;
};

const formatCurrency = (val: number | undefined | null, currency: string = 'USD') => {
    const num = typeof val === 'number' ? val : parseFloat(val as any);
    if (num == null || isNaN(num)) return '—';
    try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(num);
    } catch {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
    }
};

const formatDate = (dateStr: string | undefined | null) => {
    if (!dateStr) return '—';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return dateStr; }
};

const iso = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
};
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(d.getDate() + n); return x; };
const addMonths = (d: Date, n: number) => {
    const x = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const lastDay = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
    x.setDate(Math.min(d.getDate(), lastDay));
    return x;
};
const addYears = (d: Date, n: number) => addMonths(d, n * 12);
const startOfWeek = (d: Date) => { const x = new Date(d); x.setDate(d.getDate() - d.getDay()); return x; };
const endOfWeek = (d: Date) => addDays(startOfWeek(d), 6);
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const startOfQuarter = (d: Date) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
const endOfQuarter = (d: Date) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + 3, 0);
const startOfYear = (d: Date) => new Date(d.getFullYear(), 0, 1);
const endOfYear = (d: Date) => new Date(d.getFullYear(), 11, 31);

type PresetId =
    | 'custom' | 'this_week' | 'this_month' | 'this_quarter' | 'this_year' | 'this_year_to_date'
    | 'last_week' | 'last_month' | 'last_quarter' | 'last_year'
    | 'last_7_days' | 'last_30_days' | 'last_90_days' | 'last_6_months' | 'last_12_months';

const PRESETS: Array<{ id: PresetId; label: string }> = [
    { id: 'custom', label: 'Custom' },
    { id: 'this_week', label: 'This week' },
    { id: 'this_month', label: 'This month' },
    { id: 'this_quarter', label: 'This quarter' },
    { id: 'this_year', label: 'This year' },
    { id: 'this_year_to_date', label: 'This year to date' },
    { id: 'last_week', label: 'Last week' },
    { id: 'last_month', label: 'Last month' },
    { id: 'last_quarter', label: 'Last quarter' },
    { id: 'last_year', label: 'Last year' },
    { id: 'last_7_days', label: 'Last 7 days' },
    { id: 'last_30_days', label: 'Last 30 days' },
    { id: 'last_90_days', label: 'Last 90 days' },
    { id: 'last_6_months', label: 'Last 6 months' },
    { id: 'last_12_months', label: 'Last 12 months' },
];

function computeRange(id: PresetId, today: Date = new Date()): { startDate: string; endDate: string } | null {
    const T = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    switch (id) {
        case 'custom': return null;
        case 'this_week': return { startDate: iso(startOfWeek(T)), endDate: iso(endOfWeek(T)) };
        case 'this_month': return { startDate: iso(startOfMonth(T)), endDate: iso(endOfMonth(T)) };
        case 'this_quarter': return { startDate: iso(startOfQuarter(T)), endDate: iso(endOfQuarter(T)) };
        case 'this_year': return { startDate: iso(startOfYear(T)), endDate: iso(endOfYear(T)) };
        case 'this_year_to_date': return { startDate: iso(startOfYear(T)), endDate: iso(T) };
        case 'last_week': return { startDate: iso(addDays(startOfWeek(T), -7)), endDate: iso(addDays(endOfWeek(T), -7)) };
        case 'last_month': return { startDate: iso(startOfMonth(addMonths(T, -1))), endDate: iso(endOfMonth(addMonths(T, -1))) };
        case 'last_quarter': return { startDate: iso(startOfQuarter(addMonths(T, -3))), endDate: iso(endOfQuarter(addMonths(T, -3))) };
        case 'last_year': return { startDate: iso(startOfYear(addYears(T, -1))), endDate: iso(endOfYear(addYears(T, -1))) };
        case 'last_7_days': return { startDate: iso(addDays(T, -7)), endDate: iso(T) };
        case 'last_30_days': return { startDate: iso(addDays(T, -30)), endDate: iso(T) };
        case 'last_90_days': return { startDate: iso(addDays(T, -90)), endDate: iso(T) };
        case 'last_6_months': return { startDate: iso(addMonths(T, -6)), endDate: iso(T) };
        case 'last_12_months': return { startDate: iso(addYears(T, -1)), endDate: iso(T) };
    }
}

const DEFAULT_PRESET: PresetId = 'last_12_months';

type Entry =
    | { kind: 'order'; date: string; data: SalesOrder }
    | { kind: 'shipped'; date: string; data: Invoice };

const SalesFollowUp: React.FC<SalesFollowUpProps> = ({
    currentCompanyId,
    availableCompanies = [],
    customers = [],
    salesOrders = [],
    invoices = [],
}) => {
    const currentCompany = availableCompanies.find(c => c.id === currentCompanyId);

    const initialRange = useMemo(() => computeRange(DEFAULT_PRESET) || { startDate: '', endDate: '' }, []);

    const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
    const [dateRangePreset, setDateRangePreset] = useState<PresetId>(DEFAULT_PRESET);
    const [startDate, setStartDate] = useState(initialRange.startDate);
    const [endDate, setEndDate] = useState(initialRange.endDate);
    const [generated, setGenerated] = useState(false);

    const applyPreset = useCallback((id: PresetId) => {
        setDateRangePreset(id);
        const r = computeRange(id);
        if (r) {
            setStartDate(r.startDate);
            setEndDate(r.endDate);
        }
    }, []);

    // Email draft state — mirrors FinanceBalances for consistency
    type EmailDraft = {
        to: string;
        cc: string;
        subject: string;
        htmlBody: string;
        attachments: { name: string; contentBytes: string; contentType: string }[];
    };
    const [unit, setUnit] = useState<Unit>('LBS');

    // Financial balance (QuickBooks statement) — mirrors FinanceBalances.
    // Loaded lazily on Generate so the page is usable without QB connected.
    const [qbCustomers, setQbCustomers] = useState<QBCustomer[]>([]);
    const [qbConnected, setQbConnected] = useState<boolean | null>(null);
    const [qbStatement, setQbStatement] = useState<QBCustomerStatement | null>(null);
    const [qbLoading, setQbLoading] = useState(false);
    const [qbError, setQbError] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const list = await fetchQBCustomers(currentCompanyId || 'ALL');
                list.sort((a, b) => a.displayName.localeCompare(b.displayName));
                setQbCustomers(list);
                setQbConnected(true);
            } catch (err: any) {
                const msg = String(err?.message || '');
                if (msg.includes('not connected') || msg.includes('reconnect')) {
                    setQbConnected(false);
                } else {
                    setQbConnected(true); // keep UI usable on other errors
                }
            }
        })();
    }, [currentCompanyId]);

    const [emailPreviewOpen, setEmailPreviewOpen] = useState(false);
    const [emailDraft, setEmailDraft] = useState<EmailDraft>({ to: '', cc: '', subject: '', htmlBody: '', attachments: [] });
    const [sendingEmail, setSendingEmail] = useState(false);
    const [emailStatus, setEmailStatus] = useState<{ show: boolean; success: boolean; message: string }>({ show: false, success: false, message: '' });

    const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);
    useEffect(() => {
        const fetchLogo = async () => {
            const client = getSupabaseClient();
            if (!client) return;
            const targetId = !currentCompanyId || currentCompanyId === 'ALL' ? 'SYSTEM' : currentCompanyId;
            try {
                const { data } = await client.from('imagens').select('url').eq('companyId', targetId).eq('type', 'LOGO').single();
                if (data && data.url) { setCompanyLogoUrl(data.url); return; }
            } catch { /* fall through */ }
            if (targetId !== 'SYSTEM') {
                try {
                    const { data: sysData } = await client.from('imagens').select('url').eq('companyId', 'SYSTEM').eq('type', 'LOGO').single();
                    if (sysData && sysData.url) setCompanyLogoUrl(sysData.url);
                } catch { /* no logo */ }
            }
        };
        fetchLogo();
    }, [currentCompanyId]);

    const sortedCustomers = useMemo(
        () => [...customers].sort((a, b) => (a.name || '').localeCompare(b.name || '')),
        [customers]
    );

    const selectedCustomer = useMemo(
        () => sortedCustomers.find(c => c.id === selectedCustomerId),
        [sortedCustomers, selectedCustomerId]
    );

    const inRange = useCallback((dateStr: string | undefined | null): boolean => {
        if (!dateStr) return false;
        if (startDate && dateStr < startDate) return false;
        if (endDate && dateStr > endDate) return false;
        return true;
    }, [startDate, endDate]);

    // Filter SOs and invoices against the selected customer.
    // SO has customerId; Invoice links via `soldTo` (name) — match by both id and normalized name.
    const customerOrders = useMemo<SalesOrder[]>(() => {
        if (!selectedCustomer) return [];
        const cname = normalizeName(selectedCustomer.name);
        return salesOrders.filter(so => {
            if (so.status === 'REJECTED') return false;
            const match = so.customerId === selectedCustomer.id || normalizeName(so.customerName) === cname;
            return match && inRange(so.orderDate);
        });
    }, [salesOrders, selectedCustomer, inRange]);

    const customerInvoices = useMemo<Invoice[]>(() => {
        if (!selectedCustomer) return [];
        const cname = normalizeName(selectedCustomer.name);
        return invoices.filter(inv => {
            const soldTo = normalizeName(inv.soldTo || inv.billToName);
            const match = soldTo === cname || normalizeName(inv.shipperName) === cname;
            return match && inRange(inv.invoiceDate);
        });
    }, [invoices, selectedCustomer, inRange]);

    const entries = useMemo<Array<Entry & { runningBalance: number }>>(() => {
        const merged: Entry[] = [
            ...customerOrders.map<Entry>(so => ({ kind: 'order', date: so.orderDate, data: so })),
            ...customerInvoices.map<Entry>(inv => ({ kind: 'shipped', date: inv.invoiceDate, data: inv })),
        ];
        merged.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        let running = 0;
        return merged.map(e => {
            const amt = toNum(e.data.totalAmount);
            if (e.kind === 'order') running += amt;
            else running -= amt;
            return { ...e, runningBalance: running };
        });
    }, [customerOrders, customerInvoices]);

    const totals = useMemo(() => {
        const totalOrdered = customerOrders.reduce((s, so) => s + toNum(so.totalAmount), 0);
        const totalShipped = customerInvoices.reduce((s, inv) => s + toNum(inv.totalAmount), 0);
        const qtyOrdered = customerOrders.reduce((s, so) => s + totalQty(orderProducts(so)), 0);
        const qtyShipped = customerInvoices.reduce((s, inv) => s + (totalQty(parseInvoiceItems(inv)) || toNum(inv.grossWeight)), 0);
        return { totalOrdered, totalShipped, pending: totalOrdered - totalShipped, qtyOrdered, qtyShipped };
    }, [customerOrders, customerInvoices]);

    // Per-product aggregation: sum quantities and amounts across orders and invoices,
    // keyed by a normalized product name so minor spelling variants merge.
    const productSummary = useMemo(() => {
        type Row = { productName: string; orderedLbs: number; orderedAmount: number; shippedLbs: number; shippedAmount: number };
        const map = new Map<string, Row>();
        const keyFor = (name: string) => productKey(name) || '__unnamed__';
        const ensure = (name: string): Row => {
            const k = keyFor(name);
            let row = map.get(k);
            if (!row) {
                row = { productName: name || '(unspecified)', orderedLbs: 0, orderedAmount: 0, shippedLbs: 0, shippedAmount: 0 };
                map.set(k, row);
            }
            return row;
        };
        for (const so of customerOrders) {
            for (const item of (so.items || [])) {
                const row = ensure(item.productName || '');
                row.orderedLbs += toNum(item.quantity);
                row.orderedAmount += toNum(item.total);
            }
        }
        for (const inv of customerInvoices) {
            const items = parseInvoiceItems(inv);
            if (items.length === 0) continue;
            for (const item of items) {
                const row = ensure(item.productName);
                row.shippedLbs += toNum(item.quantity);
            }
            // Split invoice total proportionally by quantity so per-product shipped amount
            // approximates without needing item-level unit price from the parsed invoice.
            const invQtyTotal = items.reduce((s, i) => s + toNum(i.quantity), 0);
            const invAmount = toNum(inv.totalAmount);
            if (invQtyTotal > 0 && invAmount > 0) {
                for (const item of items) {
                    const row = ensure(item.productName);
                    row.shippedAmount += invAmount * (toNum(item.quantity) / invQtyTotal);
                }
            }
        }
        return Array.from(map.values()).sort((a, b) => b.orderedLbs + b.shippedLbs - (a.orderedLbs + a.shippedLbs));
    }, [customerOrders, customerInvoices]);

    const handleGenerate = useCallback(async () => {
        if (!selectedCustomerId) return;
        setGenerated(true);

        // Fire QB statement fetch if we can match the ERP customer to a QB customer.
        if (!selectedCustomer || qbConnected === false) {
            setQbStatement(null);
            return;
        }
        const qbMatch = findQbMatch(selectedCustomer, qbCustomers);
        if (!qbMatch) {
            setQbStatement(null);
            setQbError('Customer not found in QuickBooks');
            return;
        }
        setQbLoading(true);
        setQbError(null);
        try {
            const result = await fetchCustomerStatement(currentCompanyId || 'ALL', qbMatch.displayName, startDate, endDate);
            setQbStatement(result);
        } catch (err: any) {
            setQbError(err?.message || 'Failed to load QuickBooks statement');
            setQbStatement(null);
        } finally {
            setQbLoading(false);
        }
    }, [selectedCustomerId, selectedCustomer, qbCustomers, qbConnected, currentCompanyId, startDate, endDate]);

    type QbStatementEntry =
        | { kind: 'invoice'; date: string; data: QBStatementInvoice }
        | { kind: 'receipt'; date: string; data: QBStatementReceipt };

    const qbEntries = useMemo<Array<QbStatementEntry & { runningBalance: number }>>(() => {
        if (!qbStatement) return [];
        const receiptRows: QBStatementReceipt[] = qbStatement.receipts && qbStatement.receipts.length > 0
            ? qbStatement.receipts
            : qbStatement.payments.map<QBStatementReceipt>(p => ({
                id: `pay-${p.id}`,
                kind: 'payment',
                txnDate: p.txnDate,
                totalAmount: p.totalAmount,
                appliedAmount: p.appliedAmount,
                unappliedAmount: p.unappliedAmount,
                paymentRefNum: p.paymentRefNum,
                paymentMethod: p.paymentMethod,
                currency: p.currency,
                appliedInvoices: p.appliedInvoices,
                paymentIds: [p.id],
                paymentCount: 1,
            }));
        const merged: QbStatementEntry[] = [
            ...qbStatement.invoices.map<QbStatementEntry>(inv => ({ kind: 'invoice', date: inv.txnDate, data: inv })),
            ...receiptRows.map<QbStatementEntry>(r => ({ kind: 'receipt', date: r.txnDate, data: r })),
        ];
        merged.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        let running = 0;
        return merged.map(e => {
            if (e.kind === 'invoice') running += e.data.totalAmount;
            else running -= e.data.totalAmount;
            return { ...e, runningBalance: running };
        });
    }, [qbStatement]);

    const periodLabel = useMemo(() => {
        if (startDate && endDate) return `${formatDate(startDate)} — ${formatDate(endDate)}`;
        return 'All dates';
    }, [startDate, endDate]);

    const buildPDF = useCallback((): jsPDF | null => {
        if (!selectedCustomer) return null;
        const doc = new jsPDF({ unit: 'pt', format: 'letter' });
        const marginX = 40;
        const generatedAt = new Date().toLocaleString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        });

        let headerBottom = 48;
        if (companyLogoUrl) {
            try {
                const imgProps = doc.getImageProperties(companyLogoUrl);
                const maxWidth = 140;
                const maxHeight = 54;
                let w = imgProps.width;
                let h = imgProps.height;
                const ratio = Math.min(maxWidth / w, maxHeight / h);
                w *= ratio; h *= ratio;
                doc.addImage(companyLogoUrl, marginX, 30, w, h);
                headerBottom = Math.max(headerBottom, 30 + h);
            } catch (e) {
                console.error('Failed to add company logo to Sales Follow Up PDF', e);
            }
        }

        const pageWidth = doc.internal.pageSize.getWidth();
        const rightX = pageWidth - marginX;
        const companyName = currentCompany?.name || '';
        const addressLine1 = currentCompany?.address || '';
        const addressLine2 = [currentCompany?.city, currentCompany?.state, currentCompany?.zip]
            .filter(Boolean).join(currentCompany?.state ? ', ' : ' ').trim();
        if (companyName) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(12);
            doc.setTextColor('#0f172a');
            doc.text(companyName, rightX, 42, { align: 'right' });
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor('#475569');
            let rY = 56;
            if (addressLine1) { doc.text(addressLine1, rightX, rY, { align: 'right' }); rY += 12; }
            if (addressLine2) { doc.text(addressLine2, rightX, rY, { align: 'right' }); rY += 12; }
            if (currentCompany?.phone) { doc.text(currentCompany.phone, rightX, rY, { align: 'right' }); rY += 12; }
            if (currentCompany?.email) { doc.text(currentCompany.email, rightX, rY, { align: 'right' }); rY += 12; }
            headerBottom = Math.max(headerBottom, rY);
        }

        const titleY = headerBottom + 24;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.setTextColor('#0f172a');
        doc.text('Sales Follow Up', marginX, titleY);

        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text(selectedCustomer.name, marginX, titleY + 20);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor('#475569');
        doc.text(`Period: ${periodLabel}`, marginX, titleY + 36);
        doc.text(`Generated: ${generatedAt}`, marginX, titleY + 50);
        const tableStartY = titleY + 66;

        const body = entries.map(e => {
            if (e.kind === 'order') {
                const so = e.data;
                const items = orderProducts(so);
                const qty = totalQty(items);
                return [
                    formatDate(so.orderDate),
                    'Sales Order',
                    so.orderNumber || so.id,
                    so.status || '—',
                    joinProductNames(items),
                    formatQty(qty, unit),
                    formatCurrency(so.totalAmount, so.currency),
                    '—',
                    formatCurrency(e.runningBalance),
                ];
            }
            const inv = e.data;
            const invItems = parseInvoiceItems(inv);
            const invQty = totalQty(invItems) || toNum(inv.grossWeight);
            return [
                formatDate(inv.invoiceDate),
                'Shipped',
                inv.invoiceNumber || inv.id,
                inv.soNumber || inv.pod || '—',
                joinProductNames(invItems),
                formatQty(invQty, unit),
                '—',
                formatCurrency(inv.totalAmount, inv.currency),
                formatCurrency(e.runningBalance),
            ];
        });

        autoTable(doc, {
            startY: tableStartY,
            head: [['Date', 'Type', 'Reference', 'Details', 'Product', `Qty (${unitLabel(unit)})`, 'Ordered', 'Shipped', 'Balance']],
            body,
            foot: [[
                { content: 'TOTALS', colSpan: 5, styles: { halign: 'right', fontStyle: 'bold' } },
                { content: `${formatQty(totals.qtyOrdered, unit)} / ${formatQty(totals.qtyShipped, unit)}`, styles: { halign: 'right', fontStyle: 'bold' } },
                { content: formatCurrency(totals.totalOrdered), styles: { halign: 'right', fontStyle: 'bold' } },
                { content: formatCurrency(totals.totalShipped), styles: { halign: 'right', fontStyle: 'bold', textColor: '#047857' } },
                { content: formatCurrency(totals.pending), styles: { halign: 'right', fontStyle: 'bold', textColor: totals.pending > 0 ? '#e11d48' : '#0f172a' } },
            ]],
            styles: { fontSize: 8, cellPadding: 3 },
            headStyles: { fillColor: [241, 245, 249], textColor: '#334155' },
            footStyles: { fillColor: [241, 245, 249], textColor: '#0f172a' },
            columnStyles: { 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } },
            margin: { left: marginX, right: marginX },
        });

        // Per-product summary — ordered vs invoiced, aggregated by product.
        if (productSummary.length > 0) {
            const summaryStartY = (doc as any).lastAutoTable?.finalY
                ? (doc as any).lastAutoTable.finalY + 24
                : tableStartY + 200;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(12);
            doc.setTextColor('#0f172a');
            doc.text('Per-Product Summary', marginX, summaryStartY);

            autoTable(doc, {
                startY: summaryStartY + 8,
                head: [['Product', `Ordered (${unitLabel(unit)})`, `Invoiced (${unitLabel(unit)})`, `Pending (${unitLabel(unit)})`, 'Ordered $', 'Invoiced $', 'Balance $']],
                body: productSummary.map(row => {
                    const pendingLbs = row.orderedLbs - row.shippedLbs;
                    const balanceAmount = row.orderedAmount - row.shippedAmount;
                    return [
                        row.productName,
                        formatQty(row.orderedLbs, unit),
                        formatQty(row.shippedLbs, unit),
                        formatQty(pendingLbs, unit),
                        formatCurrency(row.orderedAmount),
                        formatCurrency(row.shippedAmount),
                        formatCurrency(balanceAmount),
                    ];
                }),
                styles: { fontSize: 8, cellPadding: 3 },
                headStyles: { fillColor: [241, 245, 249], textColor: '#334155' },
                columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
                margin: { left: marginX, right: marginX },
            });
        }

        const finalY = (doc as any).lastAutoTable?.finalY || 140;
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor('#94a3b8');
        doc.text(
            `Sales follow-up for ${selectedCustomer.name} · ${periodLabel} · generated ${generatedAt}`,
            marginX,
            Math.min(finalY + 24, doc.internal.pageSize.getHeight() - 20),
        );

        return doc;
    }, [selectedCustomer, entries, totals, productSummary, companyLogoUrl, currentCompany, periodLabel, unit]);

    const handleDownloadPDF = useCallback(() => {
        const doc = buildPDF();
        if (!doc || !selectedCustomer) return;
        const safeName = selectedCustomer.name.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
        const periodTag = [startDate, endDate].filter(Boolean).join('_to_') || 'all';
        doc.save(`SalesFollowUp_${safeName}_${periodTag}.pdf`);
    }, [buildPDF, selectedCustomer, startDate, endDate]);

    const handlePrepareEmailDraft = useCallback(() => {
        if (!selectedCustomer) return;
        const doc = buildPDF();
        if (!doc) return;

        const safeName = selectedCustomer.name.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
        const periodTag = [startDate, endDate].filter(Boolean).join('_to_') || 'all';
        const base64 = doc.output('datauristring').split(',')[1];

        const body =
            `Dear ${selectedCustomer.name},\n\n` +
            `Please find attached the sales follow-up report.\n\n` +
            `Period: ${periodLabel}\n` +
            `Total Ordered: ${formatCurrency(totals.totalOrdered)}\n` +
            `Total Shipped: ${formatCurrency(totals.totalShipped)}\n` +
            `Pending to Ship: ${formatCurrency(totals.pending)}\n\n` +
            `Let us know if you have any questions.\n\n` +
            `Best regards`;

        setEmailDraft({
            to: selectedCustomer.email || '',
            cc: '',
            subject: `Sales Follow Up — ${selectedCustomer.name} (${periodLabel})`,
            htmlBody: body,
            attachments: [{
                name: `SalesFollowUp_${safeName}_${periodTag}.pdf`,
                contentBytes: base64,
                contentType: 'application/pdf',
            }],
        });
        setEmailStatus({ show: false, success: false, message: '' });
        setEmailPreviewOpen(true);
    }, [buildPDF, selectedCustomer, startDate, endDate, periodLabel, totals]);

    const sendEmailFromPreview = useCallback(async () => {
        if (!emailDraft.to) {
            setEmailStatus({ show: true, success: false, message: 'Please enter a recipient email address.' });
            return;
        }
        setSendingEmail(true);
        setEmailStatus({ show: false, success: false, message: '' });
        try {
            const toList = emailDraft.to.split(/[;,]/).map(e => e.trim()).filter(Boolean);
            const ccList = emailDraft.cc.split(/[;,]/).map(e => e.trim()).filter(Boolean);
            if (toList.length === 0) {
                setEmailStatus({ show: true, success: false, message: 'Please enter a valid recipient email address.' });
                setSendingEmail(false);
                return;
            }
            const htmlBody = `<div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
                <h2 style="color: #4F46E5; margin-bottom: 8px;">${emailDraft.subject}</h2>
                <div style="white-space: pre-wrap; line-height: 1.6; color:#0f172a;">${emailDraft.htmlBody.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
            </div>`;
            const result = await sendEmail({
                to: toList,
                cc: ccList.length > 0 ? ccList : undefined,
                subject: emailDraft.subject,
                htmlBody,
                attachments: emailDraft.attachments,
            });
            if (result.success) {
                setEmailStatus({ show: true, success: true, message: `Email sent successfully via ${result.provider}` });
                setTimeout(() => setEmailPreviewOpen(false), 1200);
            } else {
                setEmailStatus({ show: true, success: false, message: result.message });
            }
        } catch (err: any) {
            setEmailStatus({ show: true, success: false, message: `Failed to send: ${err?.message || 'Unknown error'}` });
        } finally {
            setSendingEmail(false);
            setTimeout(() => setEmailStatus(prev => ({ ...prev, show: false })), 6000);
        }
    }, [emailDraft]);

    return (
        <div className="p-6 space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center">
                        <Phone className="w-5 h-5" />
                    </div>
                    <div>
                        <h1 className="text-xl font-semibold text-slate-900">Sales Follow Up</h1>
                        <p className="text-sm text-slate-500">Balance of sales orders vs invoices shipped — by customer and period</p>
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="p-4 bg-white border border-slate-200 rounded-lg">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                    <div className="md:col-span-2">
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                            <User className="inline w-3 h-3 mr-1" /> Customer
                        </label>
                        <select
                            value={selectedCustomerId}
                            onChange={e => { setSelectedCustomerId(e.target.value); setGenerated(false); }}
                            disabled={sortedCustomers.length === 0}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-slate-50 disabled:text-slate-400"
                        >
                            <option value="">
                                {sortedCustomers.length === 0
                                    ? 'No customers available'
                                    : `Select a customer (${sortedCustomers.length})`}
                            </option>
                            {sortedCustomers.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                            <Calendar className="inline w-3 h-3 mr-1" /> Date Range
                        </label>
                        <select
                            value={dateRangePreset}
                            onChange={e => applyPreset(e.target.value as PresetId)}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                        >
                            {PRESETS.map(p => (
                                <option key={p.id} value={p.id}>{p.label}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                            <Calendar className="inline w-3 h-3 mr-1" /> From
                        </label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={e => { setStartDate(e.target.value); setDateRangePreset('custom'); }}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                            <Calendar className="inline w-3 h-3 mr-1" /> To
                        </label>
                        <input
                            type="date"
                            value={endDate}
                            onChange={e => { setEndDate(e.target.value); setDateRangePreset('custom'); }}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                        />
                    </div>
                </div>

                <div className="mt-4 flex items-center gap-3 flex-wrap">
                    <div className="inline-flex rounded-md border border-slate-300 overflow-hidden" role="group" aria-label="Quantity unit">
                        <button
                            type="button"
                            onClick={() => setUnit('LBS')}
                            className={`px-3 py-1.5 text-xs font-semibold ${unit === 'LBS' ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                        >
                            LBS
                        </button>
                        <button
                            type="button"
                            onClick={() => setUnit('KGS')}
                            className={`px-3 py-1.5 text-xs font-semibold border-l border-slate-300 ${unit === 'KGS' ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                        >
                            KGS
                        </button>
                    </div>
                    <button
                        onClick={handleGenerate}
                        disabled={!selectedCustomerId}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-md hover:bg-teal-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Generate Balance
                    </button>
                </div>
            </div>

            {/* Totals */}
            {generated && selectedCustomer && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 bg-white border border-slate-200 rounded-lg">
                        <div className="text-xs text-slate-500">Total Ordered</div>
                        <div className="text-2xl font-semibold text-slate-900 mt-1">
                            {formatCurrency(totals.totalOrdered)}
                        </div>
                        <div className="text-xs text-slate-500 mt-1">{customerOrders.length} sales order(s)</div>
                    </div>
                    <div className="p-4 bg-white border border-slate-200 rounded-lg">
                        <div className="text-xs text-slate-500">Total Shipped</div>
                        <div className="text-2xl font-semibold text-emerald-600 mt-1">
                            {formatCurrency(totals.totalShipped)}
                        </div>
                        <div className="text-xs text-slate-500 mt-1">{customerInvoices.length} invoice(s)</div>
                    </div>
                    <div className="p-4 bg-white border border-slate-200 rounded-lg">
                        <div className="text-xs text-slate-500">Pending to Ship</div>
                        <div className={`text-2xl font-semibold mt-1 ${totals.pending > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                            {formatCurrency(totals.pending)}
                        </div>
                        <div className="text-xs text-slate-500 mt-1">Orders − Shipped</div>
                    </div>
                </div>
            )}

            {/* Balance table */}
            {generated && selectedCustomer && (
                <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
                        <div>
                            <div className="text-sm font-semibold text-slate-900">{selectedCustomer.name}</div>
                            <div className="text-xs text-slate-500">
                                Period: {formatDate(startDate) || 'Any'} → {formatDate(endDate) || 'Any'}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                                Generated {new Date().toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleDownloadPDF}
                                disabled={entries.length === 0}
                                className="flex items-center gap-2 px-5 py-2.5 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-all shadow-md font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Download as PDF"
                            >
                                <Download size={18} />
                                Download PDF
                            </button>
                            <button
                                onClick={handlePrepareEmailDraft}
                                disabled={entries.length === 0}
                                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-all shadow-md font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Compose and send email"
                            >
                                <Mail size={18} />
                                Email
                            </button>
                        </div>
                    </div>
                    {entries.length === 0 ? (
                        <div className="p-8 text-center text-sm text-slate-500">
                            <FileText className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                            No sales orders or invoices for this customer in the selected range.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50 text-xs text-slate-600 uppercase">
                                    <tr>
                                        <th className="px-4 py-2 text-left">Date</th>
                                        <th className="px-4 py-2 text-left">Type</th>
                                        <th className="px-4 py-2 text-left">Reference</th>
                                        <th className="px-4 py-2 text-left">Details</th>
                                        <th className="px-4 py-2 text-left">Product</th>
                                        <th className="px-4 py-2 text-right">Qty ({unitLabel(unit)})</th>
                                        <th className="px-4 py-2 text-right">Ordered</th>
                                        <th className="px-4 py-2 text-right">Shipped</th>
                                        <th className="px-4 py-2 text-right">Balance</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {entries.map((entry, idx) => {
                                        if (entry.kind === 'order') {
                                            const so = entry.data;
                                            const items = orderProducts(so);
                                            const qty = totalQty(items);
                                            return (
                                                <tr key={`so-${so.id}`} className={idx % 2 ? 'bg-slate-50/50' : ''}>
                                                    <td className="px-4 py-2 whitespace-nowrap text-slate-700">{formatDate(so.orderDate)}</td>
                                                    <td className="px-4 py-2">
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-indigo-100 text-indigo-700">
                                                            <FileText className="w-3 h-3" /> Sales Order
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-2 font-mono text-xs text-slate-700">{so.orderNumber || so.id}</td>
                                                    <td className="px-4 py-2 text-xs text-slate-500">{so.status || '—'}</td>
                                                    <td className="px-4 py-2 text-xs text-slate-700" title={items.map(i => i.productName).filter(Boolean).join(', ')}>
                                                        {joinProductNames(items)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right tabular-nums text-xs text-slate-700">
                                                        {formatQty(qty, unit)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right tabular-nums text-slate-900">
                                                        {formatCurrency(so.totalAmount, so.currency)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-slate-300">—</td>
                                                    <td className="px-4 py-2 text-right tabular-nums font-medium text-slate-900">
                                                        {formatCurrency(entry.runningBalance)}
                                                    </td>
                                                </tr>
                                            );
                                        }
                                        const inv = entry.data;
                                        const invItems = parseInvoiceItems(inv);
                                        const invQty = totalQty(invItems) || toNum(inv.grossWeight);
                                        return (
                                            <tr key={`inv-${inv.id}`} className={idx % 2 ? 'bg-slate-50/50' : ''}>
                                                <td className="px-4 py-2 whitespace-nowrap text-slate-700">{formatDate(inv.invoiceDate)}</td>
                                                <td className="px-4 py-2">
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-emerald-100 text-emerald-700">
                                                        <Package className="w-3 h-3" /> Shipped
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2 font-mono text-xs text-slate-700">{inv.invoiceNumber || inv.id}</td>
                                                <td className="px-4 py-2 text-xs text-slate-500">
                                                    {inv.soNumber || inv.pod || '—'}
                                                </td>
                                                <td className="px-4 py-2 text-xs text-slate-700" title={invItems.map(i => i.productName).filter(Boolean).join(', ')}>
                                                    {joinProductNames(invItems)}
                                                </td>
                                                <td className="px-4 py-2 text-right tabular-nums text-xs text-slate-700">
                                                    {formatQty(invQty, unit)}
                                                </td>
                                                <td className="px-4 py-2 text-right text-slate-300">—</td>
                                                <td className="px-4 py-2 text-right tabular-nums text-emerald-700">
                                                    {formatCurrency(inv.totalAmount, inv.currency)}
                                                </td>
                                                <td className="px-4 py-2 text-right tabular-nums font-medium text-slate-900">
                                                    {formatCurrency(entry.runningBalance)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot className="bg-slate-50 font-semibold">
                                    <tr>
                                        <td colSpan={5} className="px-4 py-2 text-right text-slate-600 text-xs uppercase">Totals</td>
                                        <td className="px-4 py-2 text-right tabular-nums text-xs text-slate-700">
                                            {formatQty(totals.qtyOrdered, unit)} / {formatQty(totals.qtyShipped, unit)}
                                        </td>
                                        <td className="px-4 py-2 text-right tabular-nums text-slate-900">
                                            {formatCurrency(totals.totalOrdered)}
                                        </td>
                                        <td className="px-4 py-2 text-right tabular-nums text-emerald-700">
                                            {formatCurrency(totals.totalShipped)}
                                        </td>
                                        <td className={`px-4 py-2 text-right tabular-nums ${totals.pending > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                                            {formatCurrency(totals.pending)}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {generated && selectedCustomer && productSummary.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200">
                        <div className="text-sm font-semibold text-slate-900">Per-Product Summary</div>
                        <div className="text-xs text-slate-500">Ordered vs invoiced quantities and amounts, aggregated by product</div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 text-xs text-slate-600 uppercase">
                                <tr>
                                    <th className="px-4 py-2 text-left">Product</th>
                                    <th className="px-4 py-2 text-right">Ordered ({unitLabel(unit)})</th>
                                    <th className="px-4 py-2 text-right">Invoiced ({unitLabel(unit)})</th>
                                    <th className="px-4 py-2 text-right">Pending ({unitLabel(unit)})</th>
                                    <th className="px-4 py-2 text-right">Ordered $</th>
                                    <th className="px-4 py-2 text-right">Invoiced $</th>
                                    <th className="px-4 py-2 text-right">Balance $</th>
                                </tr>
                            </thead>
                            <tbody>
                                {productSummary.map((row, idx) => {
                                    const pendingLbs = row.orderedLbs - row.shippedLbs;
                                    const balanceAmount = row.orderedAmount - row.shippedAmount;
                                    return (
                                        <tr key={row.productName + idx} className={idx % 2 ? 'bg-slate-50/50' : ''}>
                                            <td className="px-4 py-2 text-slate-800">{row.productName}</td>
                                            <td className="px-4 py-2 text-right tabular-nums text-xs text-slate-700">{formatQty(row.orderedLbs, unit)}</td>
                                            <td className="px-4 py-2 text-right tabular-nums text-xs text-emerald-700">{formatQty(row.shippedLbs, unit)}</td>
                                            <td className={`px-4 py-2 text-right tabular-nums text-xs ${pendingLbs > 0 ? 'text-rose-600' : 'text-slate-500'}`}>
                                                {formatQty(pendingLbs, unit)}
                                            </td>
                                            <td className="px-4 py-2 text-right tabular-nums text-slate-900">{formatCurrency(row.orderedAmount)}</td>
                                            <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{formatCurrency(row.shippedAmount)}</td>
                                            <td className={`px-4 py-2 text-right tabular-nums font-medium ${balanceAmount > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                                                {formatCurrency(balanceAmount)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Financial balance from QuickBooks (same view as Finance → Balances) */}
            {generated && selectedCustomer && (
                <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center">
                                <Scale className="w-4 h-4" />
                            </div>
                            <div>
                                <div className="text-sm font-semibold text-slate-900">Financial Balance</div>
                                <div className="text-xs text-slate-500">Invoices vs payments — sourced from QuickBooks</div>
                            </div>
                        </div>
                        {qbLoading && (
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                                <Loader2 className="w-3 h-3 animate-spin" /> Loading statement…
                            </div>
                        )}
                    </div>

                    {qbConnected === false && (
                        <div className="p-4 text-sm text-amber-900 bg-amber-50 border-b border-amber-200 flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                            <div>QuickBooks is not connected. Connect it from Settings → Integrations to see the financial balance.</div>
                        </div>
                    )}
                    {qbError && qbConnected !== false && (
                        <div className="p-4 text-sm text-rose-700 bg-rose-50 border-b border-rose-200 flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                            <div>{qbError}</div>
                        </div>
                    )}

                    {qbStatement && (
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4">
                                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                                    <div className="text-xs text-slate-500">Total Invoiced</div>
                                    <div className="text-xl font-semibold text-slate-900 mt-1">
                                        {formatCurrency(qbStatement.totals.totalInvoiced)}
                                    </div>
                                    <div className="text-xs text-slate-500 mt-1">{qbStatement.invoices.length} invoice(s)</div>
                                </div>
                                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                                    <div className="text-xs text-slate-500">Total Paid</div>
                                    <div className="text-xl font-semibold text-emerald-600 mt-1">
                                        {formatCurrency(qbStatement.totals.totalPaid)}
                                    </div>
                                    <div className="text-xs text-slate-500 mt-1">{qbStatement.payments.length} payment(s)</div>
                                </div>
                                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                                    <div className="text-xs text-slate-500">Period Balance</div>
                                    {(() => {
                                        const periodBalance = qbStatement.totals.totalInvoiced - qbStatement.totals.totalPaid;
                                        return (
                                            <div className={`text-xl font-semibold mt-1 ${periodBalance > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                                                {formatCurrency(periodBalance)}
                                            </div>
                                        );
                                    })()}
                                    <div className="text-xs text-slate-500 mt-1">Invoiced − Paid</div>
                                </div>
                            </div>

                            {qbEntries.length === 0 ? (
                                <div className="p-8 text-center text-sm text-slate-500">
                                    No invoices or payments in QuickBooks for this customer in the selected range.
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-slate-50 text-xs text-slate-600 uppercase">
                                            <tr>
                                                <th className="px-4 py-2 text-left">Date</th>
                                                <th className="px-4 py-2 text-left">Type</th>
                                                <th className="px-4 py-2 text-left">Reference</th>
                                                <th className="px-4 py-2 text-left">Details</th>
                                                <th className="px-4 py-2 text-right">Invoice</th>
                                                <th className="px-4 py-2 text-right">Received</th>
                                                <th className="px-4 py-2 text-right">Balance</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {qbEntries.map((entry, idx) => {
                                                if (entry.kind === 'invoice') {
                                                    const inv = entry.data;
                                                    return (
                                                        <tr key={`qinv-${inv.id}`} className={idx % 2 ? 'bg-slate-50/50' : ''}>
                                                            <td className="px-4 py-2 whitespace-nowrap text-slate-700">{formatDate(inv.txnDate)}</td>
                                                            <td className="px-4 py-2">
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-indigo-100 text-indigo-700">
                                                                    <FileText className="w-3 h-3" /> Invoice
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-2 font-mono text-xs text-slate-700">{inv.docNumber || inv.id}</td>
                                                            <td className="px-4 py-2 text-xs text-slate-500">Due {formatDate(inv.dueDate)}</td>
                                                            <td className="px-4 py-2 text-right tabular-nums text-slate-900">{formatCurrency(inv.totalAmount, inv.currency)}</td>
                                                            <td className="px-4 py-2 text-right text-slate-300">—</td>
                                                            <td className="px-4 py-2 text-right tabular-nums font-medium text-slate-900">{formatCurrency(entry.runningBalance)}</td>
                                                        </tr>
                                                    );
                                                }
                                                const r = entry.data;
                                                const isDeposit = r.kind === 'deposit';
                                                const acctName = (r.depositAccount || '').trim();
                                                const digitMatch = acctName.match(/(\d{3,})\s*$/);
                                                const last4 = digitMatch ? digitMatch[1].slice(-4) : '';
                                                const bankOnly = digitMatch
                                                    ? acctName.slice(0, digitMatch.index).replace(/[\s*#•-]+$/, '').trim()
                                                    : acctName;
                                                const refText = acctName
                                                    ? (last4 ? `${bankOnly} ••${last4}` : bankOnly)
                                                    : (r.paymentRefNum || (isDeposit ? `${r.paymentCount} payments` : r.id));
                                                return (
                                                    <tr key={`qrcpt-${r.id}`} className={idx % 2 ? 'bg-slate-50/50' : ''}>
                                                        <td className="px-4 py-2 whitespace-nowrap text-slate-700">{formatDate(r.txnDate)}</td>
                                                        <td className="px-4 py-2">
                                                            {isDeposit ? (
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-sky-100 text-sky-700">
                                                                    <Landmark className="w-3 h-3" /> Deposit
                                                                </span>
                                                            ) : (
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-emerald-100 text-emerald-700">
                                                                    <DollarSign className="w-3 h-3" /> Payment
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-2 font-mono text-xs text-slate-700">{refText}</td>
                                                        <td className="px-4 py-2 text-xs text-slate-500">{isDeposit ? 'Bank deposit' : 'Payment'}</td>
                                                        <td className="px-4 py-2 text-right text-slate-300">—</td>
                                                        <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{formatCurrency(r.totalAmount, r.currency)}</td>
                                                        <td className="px-4 py-2 text-right tabular-nums font-medium text-slate-900">{formatCurrency(entry.runningBalance)}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                        <tfoot className="bg-slate-50 font-semibold">
                                            <tr>
                                                <td colSpan={4} className="px-4 py-2 text-right text-slate-600 text-xs uppercase">Totals</td>
                                                <td className="px-4 py-2 text-right tabular-nums text-slate-900">{formatCurrency(qbStatement.totals.totalInvoiced)}</td>
                                                <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{formatCurrency(qbStatement.totals.totalPaid)}</td>
                                                {(() => {
                                                    const periodBalance = qbStatement.totals.totalInvoiced - qbStatement.totals.totalPaid;
                                                    return (
                                                        <td className={`px-4 py-2 text-right tabular-nums ${periodBalance > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                                                            {formatCurrency(periodBalance)}
                                                        </td>
                                                    );
                                                })()}
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {!generated && (
                <div className="p-8 text-center text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg">
                    Pick a customer and a date range, then click <span className="font-medium">Generate Balance</span>.
                </div>
            )}

            {/* Email Preview Modal */}
            {emailPreviewOpen && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
                        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 flex items-center justify-between">
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

                        <div className="flex-1 overflow-y-auto p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">To</label>
                                <input
                                    type="email"
                                    value={emailDraft.to}
                                    onChange={(e) => setEmailDraft(prev => ({ ...prev, to: e.target.value }))}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="recipient@example.com"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">CC <span className="font-normal text-slate-400 normal-case">(comma-separated)</span></label>
                                <input
                                    type="text"
                                    value={emailDraft.cc}
                                    onChange={(e) => setEmailDraft(prev => ({ ...prev, cc: e.target.value }))}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="cc1@example.com, cc2@example.com"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Subject</label>
                                <input
                                    type="text"
                                    value={emailDraft.subject}
                                    onChange={(e) => setEmailDraft(prev => ({ ...prev, subject: e.target.value }))}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Message</label>
                                <textarea
                                    value={emailDraft.htmlBody}
                                    onChange={(e) => setEmailDraft(prev => ({ ...prev, htmlBody: e.target.value }))}
                                    rows={10}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none font-mono"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                                    Attachments ({emailDraft.attachments.length})
                                </label>
                                <div className="bg-slate-50 rounded-lg border border-slate-200 divide-y divide-slate-100">
                                    {emailDraft.attachments.map((att, idx) => (
                                        <div key={idx} className="flex items-center gap-3 px-3 py-2">
                                            <FileText size={16} className="text-red-500" />
                                            <span className="text-sm text-slate-700">{att.name}</span>
                                            <span className="text-xs text-slate-400 ml-auto">
                                                {Math.round(att.contentBytes.length * 0.75 / 1024)} KB
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            {emailStatus.show && (
                                <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${emailStatus.success
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : 'bg-red-50 text-red-700 border border-red-200'
                                    }`}>
                                    {emailStatus.success ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                                    {emailStatus.message}
                                </div>
                            )}
                        </div>

                        <div className="border-t border-slate-200 px-6 py-4 flex items-center justify-end gap-3 bg-slate-50">
                            <button
                                onClick={() => setEmailPreviewOpen(false)}
                                className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg transition-colors font-medium"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={sendEmailFromPreview}
                                disabled={sendingEmail || !emailDraft.to}
                                className="px-6 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
    );
};

export default SalesFollowUp;
