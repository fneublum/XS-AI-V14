import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Scale, Loader2, RefreshCw, AlertCircle, Calendar, User, FileText, DollarSign, Landmark, Download, Mail, X, Send, CheckCircle2 } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
    fetchQBCustomers,
    fetchCustomerStatement,
    QBCustomer,
    QBCustomerStatement,
    QBStatementInvoice,
    QBStatementReceipt,
} from '../services/quickbooksService';
import { sendEmail } from '../services/emailService';
import { getSupabaseClient } from '../services/supabase';
import { Company, Customer } from '../types';

interface FinanceBalancesProps {
    currentCompanyId?: string;
    availableCompanies?: Company[];
    erpCustomers?: Customer[];
}

// Normalize a customer name for cross-system matching. QB and the ERP may use
// slightly different casing / punctuation / whitespace for the same account —
// collapse those so "ALGOPOR S.A." and "Algopor SA" match.
const normalizeCustomerName = (s: string | undefined | null): string =>
    (s || '')
        .toLowerCase()
        .replace(/[.,'"`()\-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

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

// ── Date helpers ─────────────────────────────────────────────
// Note: fiscal periods mirror calendar periods (Jan-Dec). Plug in a
// configurable fiscal-year-start here if needed.

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
const startOfWeek = (d: Date) => { const x = new Date(d); x.setDate(d.getDate() - d.getDay()); return x; }; // Sunday-based
const endOfWeek = (d: Date) => addDays(startOfWeek(d), 6);
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const startOfQuarter = (d: Date) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
const endOfQuarter = (d: Date) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + 3, 0);
const startOfYear = (d: Date) => new Date(d.getFullYear(), 0, 1);
const endOfYear = (d: Date) => new Date(d.getFullYear(), 11, 31);

type PresetId =
    | 'custom'
    | 'this_week' | 'this_week_to_date' | 'this_fiscal_week'
    | 'this_month' | 'this_month_to_date'
    | 'this_quarter' | 'this_quarter_to_date' | 'this_fiscal_quarter' | 'this_fiscal_quarter_to_date'
    | 'this_year' | 'this_year_to_date' | 'this_year_to_last_month'
    | 'this_fiscal_year' | 'this_fiscal_year_to_date' | 'this_fiscal_year_to_last_month'
    | 'last_6_months'
    | 'yesterday' | 'recent'
    | 'last_week' | 'last_week_to_date' | 'last_week_to_today'
    | 'last_month' | 'last_month_to_date' | 'last_month_to_today'
    | 'last_quarter' | 'last_quarter_to_date' | 'last_quarter_to_today'
    | 'last_fiscal_quarter' | 'last_fiscal_quarter_to_date'
    | 'last_year' | 'last_year_to_date' | 'last_year_to_today'
    | 'last_fiscal_year' | 'last_fiscal_year_to_date'
    | 'last_7_days' | 'last_30_days' | 'last_90_days' | 'last_12_months'
    | 'since_30_days_ago' | 'since_60_days_ago' | 'since_90_days_ago' | 'since_365_days_ago'
    | 'next_week' | 'next_4_weeks' | 'next_month' | 'next_quarter'
    | 'next_fiscal_quarter' | 'next_year' | 'next_fiscal_year';

// Grouped preset list for the dropdown (matches QuickBooks ordering).
const PRESETS: Array<{ id: PresetId; label: string; group?: string }> = [
    { id: 'custom', label: 'Custom' },
    { id: 'this_week', label: 'This week', group: 'This' },
    { id: 'this_week_to_date', label: 'This week to date' },
    { id: 'this_fiscal_week', label: 'This fiscal week' },
    { id: 'this_month', label: 'This month' },
    { id: 'this_month_to_date', label: 'This month to date' },
    { id: 'this_quarter', label: 'This quarter' },
    { id: 'this_quarter_to_date', label: 'This quarter to date' },
    { id: 'this_fiscal_quarter', label: 'This fiscal quarter' },
    { id: 'this_fiscal_quarter_to_date', label: 'This fiscal quarter to date' },
    { id: 'this_year', label: 'This year' },
    { id: 'this_year_to_date', label: 'This year to date' },
    { id: 'this_year_to_last_month', label: 'This year to last month' },
    { id: 'this_fiscal_year', label: 'This fiscal year' },
    { id: 'this_fiscal_year_to_date', label: 'This fiscal year to date' },
    { id: 'this_fiscal_year_to_last_month', label: 'This fiscal year to last month' },
    { id: 'last_6_months', label: 'Last 6 months', group: 'Rolling' },
    { id: 'yesterday', label: 'Yesterday', group: 'Past' },
    { id: 'recent', label: 'Recent' },
    { id: 'last_week', label: 'Last week' },
    { id: 'last_week_to_date', label: 'Last week to date' },
    { id: 'last_week_to_today', label: 'Last week to today' },
    { id: 'last_month', label: 'Last month' },
    { id: 'last_month_to_date', label: 'Last month to date' },
    { id: 'last_month_to_today', label: 'Last month to today' },
    { id: 'last_quarter', label: 'Last quarter' },
    { id: 'last_quarter_to_date', label: 'Last quarter to date' },
    { id: 'last_quarter_to_today', label: 'Last quarter to today' },
    { id: 'last_fiscal_quarter', label: 'Last fiscal quarter' },
    { id: 'last_fiscal_quarter_to_date', label: 'Last fiscal quarter to date' },
    { id: 'last_year', label: 'Last year' },
    { id: 'last_year_to_date', label: 'Last year to date' },
    { id: 'last_year_to_today', label: 'Last year to today' },
    { id: 'last_fiscal_year', label: 'Last fiscal year' },
    { id: 'last_fiscal_year_to_date', label: 'Last fiscal year to date' },
    { id: 'last_7_days', label: 'Last 7 days' },
    { id: 'last_30_days', label: 'Last 30 days' },
    { id: 'last_90_days', label: 'Last 90 days' },
    { id: 'last_12_months', label: 'Last 12 months' },
    { id: 'since_30_days_ago', label: 'Since 30 days ago' },
    { id: 'since_60_days_ago', label: 'Since 60 days ago' },
    { id: 'since_90_days_ago', label: 'Since 90 days ago' },
    { id: 'since_365_days_ago', label: 'Since 365 days ago' },
    { id: 'next_week', label: 'Next week', group: 'Future' },
    { id: 'next_4_weeks', label: 'Next 4 weeks' },
    { id: 'next_month', label: 'Next month' },
    { id: 'next_quarter', label: 'Next quarter' },
    { id: 'next_fiscal_quarter', label: 'Next fiscal quarter' },
    { id: 'next_year', label: 'Next year' },
    { id: 'next_fiscal_year', label: 'Next fiscal year' },
];

function computeRange(id: PresetId, today: Date = new Date()): { startDate: string; endDate: string } | null {
    const T = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    switch (id) {
        case 'custom': return null;
        case 'this_week':
        case 'this_fiscal_week':
            return { startDate: iso(startOfWeek(T)), endDate: iso(endOfWeek(T)) };
        case 'this_week_to_date':
            return { startDate: iso(startOfWeek(T)), endDate: iso(T) };
        case 'this_month':
            return { startDate: iso(startOfMonth(T)), endDate: iso(endOfMonth(T)) };
        case 'this_month_to_date':
            return { startDate: iso(startOfMonth(T)), endDate: iso(T) };
        case 'this_quarter':
        case 'this_fiscal_quarter':
            return { startDate: iso(startOfQuarter(T)), endDate: iso(endOfQuarter(T)) };
        case 'this_quarter_to_date':
        case 'this_fiscal_quarter_to_date':
            return { startDate: iso(startOfQuarter(T)), endDate: iso(T) };
        case 'this_year':
        case 'this_fiscal_year':
            return { startDate: iso(startOfYear(T)), endDate: iso(endOfYear(T)) };
        case 'this_year_to_date':
        case 'this_fiscal_year_to_date':
            return { startDate: iso(startOfYear(T)), endDate: iso(T) };
        case 'this_year_to_last_month':
        case 'this_fiscal_year_to_last_month':
            return { startDate: iso(startOfYear(T)), endDate: iso(endOfMonth(addMonths(T, -1))) };
        case 'last_6_months':
            return { startDate: iso(addMonths(T, -6)), endDate: iso(T) };
        case 'yesterday': {
            const y = addDays(T, -1);
            return { startDate: iso(y), endDate: iso(y) };
        }
        case 'recent':
            return { startDate: iso(addDays(T, -30)), endDate: iso(T) };
        case 'last_week':
            return { startDate: iso(addDays(startOfWeek(T), -7)), endDate: iso(addDays(endOfWeek(T), -7)) };
        case 'last_week_to_date':
            return { startDate: iso(addDays(startOfWeek(T), -7)), endDate: iso(addDays(T, -7)) };
        case 'last_week_to_today':
            return { startDate: iso(addDays(startOfWeek(T), -7)), endDate: iso(T) };
        case 'last_month':
            return { startDate: iso(startOfMonth(addMonths(T, -1))), endDate: iso(endOfMonth(addMonths(T, -1))) };
        case 'last_month_to_date':
            return { startDate: iso(startOfMonth(addMonths(T, -1))), endDate: iso(addMonths(T, -1)) };
        case 'last_month_to_today':
            return { startDate: iso(startOfMonth(addMonths(T, -1))), endDate: iso(T) };
        case 'last_quarter':
        case 'last_fiscal_quarter':
            return { startDate: iso(startOfQuarter(addMonths(T, -3))), endDate: iso(endOfQuarter(addMonths(T, -3))) };
        case 'last_quarter_to_date':
        case 'last_fiscal_quarter_to_date':
            return { startDate: iso(startOfQuarter(addMonths(T, -3))), endDate: iso(addMonths(T, -3)) };
        case 'last_quarter_to_today':
            return { startDate: iso(startOfQuarter(addMonths(T, -3))), endDate: iso(T) };
        case 'last_year':
        case 'last_fiscal_year':
            return { startDate: iso(startOfYear(addYears(T, -1))), endDate: iso(endOfYear(addYears(T, -1))) };
        case 'last_year_to_date':
        case 'last_fiscal_year_to_date':
            return { startDate: iso(startOfYear(addYears(T, -1))), endDate: iso(addYears(T, -1)) };
        case 'last_year_to_today':
            return { startDate: iso(startOfYear(addYears(T, -1))), endDate: iso(T) };
        case 'last_7_days':
            return { startDate: iso(addDays(T, -7)), endDate: iso(T) };
        case 'last_30_days':
            return { startDate: iso(addDays(T, -30)), endDate: iso(T) };
        case 'last_90_days':
            return { startDate: iso(addDays(T, -90)), endDate: iso(T) };
        case 'last_12_months':
            return { startDate: iso(addYears(T, -1)), endDate: iso(T) };
        case 'since_30_days_ago':
            return { startDate: iso(addDays(T, -30)), endDate: iso(T) };
        case 'since_60_days_ago':
            return { startDate: iso(addDays(T, -60)), endDate: iso(T) };
        case 'since_90_days_ago':
            return { startDate: iso(addDays(T, -90)), endDate: iso(T) };
        case 'since_365_days_ago':
            return { startDate: iso(addDays(T, -365)), endDate: iso(T) };
        case 'next_week':
            return { startDate: iso(addDays(startOfWeek(T), 7)), endDate: iso(addDays(endOfWeek(T), 7)) };
        case 'next_4_weeks':
            return { startDate: iso(T), endDate: iso(addDays(T, 28)) };
        case 'next_month':
            return { startDate: iso(startOfMonth(addMonths(T, 1))), endDate: iso(endOfMonth(addMonths(T, 1))) };
        case 'next_quarter':
        case 'next_fiscal_quarter':
            return { startDate: iso(startOfQuarter(addMonths(T, 3))), endDate: iso(endOfQuarter(addMonths(T, 3))) };
        case 'next_year':
        case 'next_fiscal_year':
            return { startDate: iso(startOfYear(addYears(T, 1))), endDate: iso(endOfYear(addYears(T, 1))) };
    }
}

const DEFAULT_PRESET: PresetId = 'last_12_months';

type StatementEntry =
    | { kind: 'invoice'; date: string; data: QBStatementInvoice }
    | { kind: 'receipt'; date: string; data: QBStatementReceipt };

const FinanceBalances: React.FC<FinanceBalancesProps> = ({ currentCompanyId, availableCompanies = [], erpCustomers = [] }) => {
    const companyId = currentCompanyId || 'ALL';
    const currentCompany = availableCompanies.find(c => c.id === currentCompanyId);

    // Build a set of normalized ERP customer names so we can intersect the QB
    // list against it. Also index nickname so ERP alternates still match.
    const erpNameSet = useMemo(() => {
        const set = new Set<string>();
        for (const c of erpCustomers) {
            const n = normalizeCustomerName(c.name);
            if (n) set.add(n);
            const nick = normalizeCustomerName(c.nickname);
            if (nick) set.add(nick);
        }
        return set;
    }, [erpCustomers]);
    const initialRange = useMemo(() => computeRange(DEFAULT_PRESET) || { startDate: '', endDate: '' }, []);

    const [connected, setConnected] = useState<boolean | null>(null);
    const [customers, setCustomers] = useState<QBCustomer[]>([]);
    const [loadingCustomers, setLoadingCustomers] = useState(false);
    const [selectedCustomer, setSelectedCustomer] = useState<string>('');
    const [dateRangePreset, setDateRangePreset] = useState<PresetId>(DEFAULT_PRESET);
    const [startDate, setStartDate] = useState(initialRange.startDate);
    const [endDate, setEndDate] = useState(initialRange.endDate);

    const applyPreset = useCallback((id: PresetId) => {
        setDateRangePreset(id);
        const r = computeRange(id);
        if (r) {
            setStartDate(r.startDate);
            setEndDate(r.endDate);
        }
    }, []);
    const [statement, setStatement] = useState<QBCustomerStatement | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Email preview modal state — mirrors the Delivery Documents flow so we
    // use the same MSAL/Gmail-backed `sendEmail` service (real email, not mailto).
    type EmailDraft = {
        to: string;
        cc: string;
        subject: string;
        htmlBody: string;
        attachments: { name: string; contentBytes: string; contentType: string }[];
    };
    const [emailPreviewOpen, setEmailPreviewOpen] = useState(false);
    const [emailDraft, setEmailDraft] = useState<EmailDraft>({ to: '', cc: '', subject: '', htmlBody: '', attachments: [] });
    const [sendingEmail, setSendingEmail] = useState(false);
    const [emailStatus, setEmailStatus] = useState<{ show: boolean; success: boolean; message: string }>({ show: false, success: false, message: '' });

    // Company logo for PDF header (pulled from Supabase `imagens` table; falls
    // back to the system-wide LOGO if the current company has none).
    const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);
    useEffect(() => {
        const fetchLogo = async () => {
            const client = getSupabaseClient();
            if (!client) return;
            const targetId = !currentCompanyId || currentCompanyId === 'ALL' ? 'SYSTEM' : currentCompanyId;
            try {
                const { data } = await client
                    .from('imagens')
                    .select('url')
                    .eq('companyId', targetId)
                    .eq('type', 'LOGO')
                    .single();
                if (data && data.url) {
                    setCompanyLogoUrl(data.url);
                    return;
                }
            } catch { /* fall through to SYSTEM */ }
            if (targetId !== 'SYSTEM') {
                try {
                    const { data: sysData } = await client
                        .from('imagens')
                        .select('url')
                        .eq('companyId', 'SYSTEM')
                        .eq('type', 'LOGO')
                        .single();
                    if (sysData && sysData.url) setCompanyLogoUrl(sysData.url);
                } catch { /* no logo available */ }
            }
        };
        fetchLogo();
    }, [currentCompanyId]);

    // Visible customer list = intersection of the QB customer list and the ERP
    // customer table. When the ERP list hasn't loaded yet (empty), fall back to
    // showing the full QB list so the page stays usable.
    const visibleCustomers = useMemo(() => {
        if (erpNameSet.size === 0) return customers;
        return customers.filter(c => erpNameSet.has(normalizeCustomerName(c.displayName)));
    }, [customers, erpNameSet]);

    // Load customers directly — the edge function falls back to any valid QB
    // token if the exact company_id isn't found, so this works even when the
    // strict status check would say "not connected". Success = connected.
    useEffect(() => {
        (async () => {
            setLoadingCustomers(true);
            try {
                const list = await fetchQBCustomers(companyId);
                list.sort((a, b) => a.displayName.localeCompare(b.displayName));
                setCustomers(list);
                setConnected(true);
            } catch (err: any) {
                // Only flag disconnected if QB explicitly says so
                const msg = String(err?.message || '');
                if (msg.includes('not connected') || msg.includes('reconnect')) {
                    setConnected(false);
                } else {
                    // Other errors (network, permissions) — keep UI usable, surface error
                    setConnected(true);
                    setError(msg || 'Failed to load QuickBooks customers');
                }
            } finally {
                setLoadingCustomers(false);
            }
        })();
    }, [companyId]);

    const runStatement = useCallback(async () => {
        if (!selectedCustomer) {
            setError('Select a customer first');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const result = await fetchCustomerStatement(companyId, selectedCustomer, startDate, endDate);
            setStatement(result);
        } catch (err: any) {
            setError(err.message || 'Failed to load statement');
            setStatement(null);
        } finally {
            setLoading(false);
        }
    }, [companyId, selectedCustomer, startDate, endDate]);

    // Build a merged chronological entry list with running balance.
    // Prefer `receipts` (deposit-grouped) over raw payments when the backend
    // provides them — this collapses multi-payment bank deposits into one row.
    const entries = useMemo<Array<StatementEntry & { runningBalance: number }>>(() => {
        if (!statement) return [];
        const receiptRows: QBStatementReceipt[] = statement.receipts && statement.receipts.length > 0
            ? statement.receipts
            : statement.payments.map<QBStatementReceipt>(p => ({
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
        const merged: StatementEntry[] = [
            ...statement.invoices.map<StatementEntry>(inv => ({ kind: 'invoice', date: inv.txnDate, data: inv })),
            ...receiptRows.map<StatementEntry>(r => ({ kind: 'receipt', date: r.txnDate, data: r })),
        ];
        merged.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        let running = 0;
        return merged.map(e => {
            if (e.kind === 'invoice') running += e.data.totalAmount;
            else running -= e.data.totalAmount;
            return { ...e, runningBalance: running };
        });
    }, [statement]);

    // ── Export helpers (must come after `entries` is declared) ───
    const buildStatementPDF = useCallback((): jsPDF | null => {
        if (!statement) return null;
        const doc = new jsPDF({ unit: 'pt', format: 'letter' });
        const marginX = 40;
        const generatedAt = new Date().toLocaleString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit',
        });
        const periodLabel =
            statement.startDate && statement.endDate
                ? `${formatDate(statement.startDate)} — ${formatDate(statement.endDate)}`
                : (statement.startDate || statement.endDate
                    ? `${formatDate(statement.startDate) || '—'} → ${formatDate(statement.endDate) || '—'}`
                    : 'All dates');

        // ── Header band ────────────────────────────────────────
        // Logo (top-left); falls back to nothing if the image fails to load.
        // We keep the logo box small (≤ 54pt tall) so it doesn't collide with
        // the title/customer stack below.
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
                console.error('Failed to add company logo to statement PDF', e);
            }
        }

        // Company name / address (top-right) — mirrors the InvoiceEngine layout
        // so both documents feel like they come from the same sender.
        const pageWidth = doc.internal.pageSize.getWidth();
        const rightX = pageWidth - marginX;
        const companyName = currentCompany?.name || '';
        const addressLine1 = currentCompany?.address || '';
        const addressLine2 = [currentCompany?.city, currentCompany?.state, currentCompany?.zip]
            .filter(Boolean)
            .join(currentCompany?.state ? ', ' : ' ')
            .replace(', ', ', ')
            .trim();
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

        // Title sits below the header band
        const titleY = headerBottom + 24;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.setTextColor('#0f172a');
        doc.text('Customer Statement', marginX, titleY);

        // Customer + meta
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text(statement.customerName, marginX, titleY + 20);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor('#475569');
        doc.text(`Period: ${periodLabel}`, marginX, titleY + 36);
        doc.text(`Generated: ${generatedAt}`, marginX, titleY + 50);
        const tableStartY = titleY + 66;

        // Table rows
        const body = entries.map(e => {
            if (e.kind === 'invoice') {
                const inv = e.data;
                return [
                    formatDate(inv.txnDate),
                    'Invoice',
                    `INVOICE # ${inv.docNumber || inv.id}`,
                    `Due ${formatDate(inv.dueDate)}`,
                    formatCurrency(inv.totalAmount, inv.currency),
                    '—',
                    formatCurrency(e.runningBalance),
                ];
            }
            const r = e.data;
            const isDeposit = r.kind === 'deposit';
            const acctName = (r.depositAccount || '').trim();
            const digitMatch = acctName.match(/(\d{3,})\s*$/);
            const last4 = digitMatch ? digitMatch[1].slice(-4) : '';
            const bankOnly = digitMatch
                ? acctName.slice(0, digitMatch.index).replace(/[\s*#•-]+$/, '').trim()
                : acctName;
            const refText = acctName
                ? (last4 ? `${bankOnly} **${last4}` : bankOnly)
                : (r.paymentRefNum || (isDeposit ? `${r.paymentCount} payments` : r.id));
            return [
                formatDate(r.txnDate),
                isDeposit ? 'Deposit' : 'Payment',
                refText,
                isDeposit ? 'Bank deposit' : 'Payment',
                '—',
                formatCurrency(r.totalAmount, r.currency),
                formatCurrency(e.runningBalance),
            ];
        });

        const periodBalance = statement.totals.totalInvoiced - statement.totals.totalPaid;

        autoTable(doc, {
            startY: tableStartY,
            head: [['Date', 'Type', 'Reference', 'Details', 'Invoice', 'Received', 'Balance']],
            body,
            foot: [[
                { content: 'TOTALS', colSpan: 4, styles: { halign: 'right', fontStyle: 'bold' } },
                { content: formatCurrency(statement.totals.totalInvoiced), styles: { halign: 'right', fontStyle: 'bold' } },
                { content: formatCurrency(statement.totals.totalPaid), styles: { halign: 'right', fontStyle: 'bold', textColor: '#047857' } },
                {
                    content: formatCurrency(periodBalance),
                    styles: {
                        halign: 'right',
                        fontStyle: 'bold',
                        textColor: periodBalance > 0 ? '#e11d48' : '#0f172a',
                    },
                },
            ]],
            styles: { fontSize: 9, cellPadding: 4 },
            headStyles: { fillColor: [241, 245, 249], textColor: '#334155' },
            footStyles: { fillColor: [241, 245, 249], textColor: '#0f172a' },
            columnStyles: {
                4: { halign: 'right' },
                5: { halign: 'right' },
                6: { halign: 'right' },
            },
            margin: { left: marginX, right: marginX },
        });

        // Footer note
        const finalY = (doc as any).lastAutoTable?.finalY || 140;
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor('#94a3b8');
        doc.text(
            `Statement for ${statement.customerName} · ${periodLabel} · generated ${generatedAt}`,
            marginX,
            Math.min(finalY + 24, doc.internal.pageSize.getHeight() - 20)
        );

        return doc;
    }, [statement, entries, companyLogoUrl, currentCompany]);

    const handleDownloadPDF = useCallback(() => {
        const doc = buildStatementPDF();
        if (!doc || !statement) return;
        const safeName = statement.customerName.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
        const periodTag = [statement.startDate, statement.endDate].filter(Boolean).join('_to_') || 'all';
        doc.save(`Statement_${safeName}_${periodTag}.pdf`);
    }, [buildStatementPDF, statement]);

    // Prepare the email draft and open the preview modal. Mirrors the
    // Delivery Documents flow (PLInvoiceEngine.handlePrepareEmailDraft) — the
    // PDF is embedded as a base64 attachment and the user reviews/edits the
    // message before hitting Send.
    const handlePrepareEmailDraft = useCallback(() => {
        if (!statement) return;
        const doc = buildStatementPDF();
        if (!doc) return;

        const safeName = statement.customerName.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
        const periodTag = [statement.startDate, statement.endDate].filter(Boolean).join('_to_') || 'all';
        const base64 = doc.output('datauristring').split(',')[1];

        const periodLabel =
            statement.startDate && statement.endDate
                ? `${formatDate(statement.startDate)} — ${formatDate(statement.endDate)}`
                : 'All dates';
        const periodBalance = statement.totals.totalInvoiced - statement.totals.totalPaid;

        // Look up customer's primary email for the To field (pulled via QB
        // customer query). User can edit before sending.
        const customer = customers.find(c => c.displayName === statement.customerName);
        const toAddress = customer?.primaryEmail || '';

        const body =
            `Dear ${statement.customerName},\n\n` +
            `Please find attached your account statement.\n\n` +
            `Period: ${periodLabel}\n` +
            `Total Invoiced: ${formatCurrency(statement.totals.totalInvoiced)}\n` +
            `Total Paid: ${formatCurrency(statement.totals.totalPaid)}\n` +
            `Balance: ${formatCurrency(periodBalance)}\n\n` +
            `If you have any questions about your account, please don't hesitate to reach out.\n\n` +
            `Best regards`;

        setEmailDraft({
            to: toAddress,
            cc: '',
            subject: `Customer Statement — ${statement.customerName} (${periodLabel})`,
            htmlBody: body,
            attachments: [{
                name: `Statement_${safeName}_${periodTag}.pdf`,
                contentBytes: base64,
                contentType: 'application/pdf',
            }],
        });
        setEmailStatus({ show: false, success: false, message: '' });
        setEmailPreviewOpen(true);
    }, [buildStatementPDF, statement, customers]);

    // Send the drafted email via the shared MSAL/Gmail-backed email service.
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

    // ── UI ───────────────────────────────────────────────────────

    if (connected === false) {
        return (
            <div className="p-8 max-w-4xl mx-auto">
                <div className="flex items-start gap-3 p-5 rounded-lg border border-amber-300 bg-amber-50 text-amber-900">
                    <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                    <div>
                        <div className="font-semibold">QuickBooks is not connected</div>
                        <div className="text-sm mt-1">
                            Connect QuickBooks from Settings → Integrations to view customer statements.
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center">
                        <Scale className="w-5 h-5" />
                    </div>
                    <div>
                        <h1 className="text-xl font-semibold text-slate-900">Customer Balances</h1>
                        <p className="text-sm text-slate-500">Statement of invoices vs payments — sourced from QuickBooks</p>
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="p-4 bg-white border border-slate-200 rounded-lg">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                    {/* Customer filter */}
                    <div className="md:col-span-2">
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                            <User className="inline w-3 h-3 mr-1" /> Customer
                        </label>
                        <select
                            value={selectedCustomer}
                            onChange={e => setSelectedCustomer(e.target.value)}
                            disabled={loadingCustomers || visibleCustomers.length === 0}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50 disabled:text-slate-400"
                        >
                            <option value="">
                                {loadingCustomers
                                    ? 'Loading customers…'
                                    : visibleCustomers.length === 0
                                        ? 'No customers matched between QB and ERP'
                                        : `Select a customer (${visibleCustomers.length})`}
                            </option>
                            {visibleCustomers.map(c => (
                                <option key={c.id} value={c.displayName}>
                                    {c.displayName}
                                    {c.balance > 0 ? ` — ${formatCurrency(c.balance)} open` : ''}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Date range preset */}
                    <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                            <Calendar className="inline w-3 h-3 mr-1" /> Date Range
                        </label>
                        <select
                            value={dateRangePreset}
                            onChange={e => applyPreset(e.target.value as PresetId)}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            {PRESETS.map(p => (
                                <option key={p.id} value={p.id}>{p.label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Start date */}
                    <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                            <Calendar className="inline w-3 h-3 mr-1" /> From
                        </label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={e => { setStartDate(e.target.value); setDateRangePreset('custom'); }}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>

                    {/* End date */}
                    <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">
                            <Calendar className="inline w-3 h-3 mr-1" /> To
                        </label>
                        <input
                            type="date"
                            value={endDate}
                            onChange={e => { setEndDate(e.target.value); setDateRangePreset('custom'); }}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                </div>

                <div className="mt-4 flex items-center gap-3">
                    <button
                        onClick={runStatement}
                        disabled={loading || !selectedCustomer}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                        {loading ? 'Loading…' : 'Generate Statement'}
                    </button>
                    {error && (
                        <div className="flex items-center gap-2 text-sm text-rose-600">
                            <AlertCircle className="w-4 h-4" /> {error}
                        </div>
                    )}
                </div>
            </div>

            {/* Totals */}
            {statement && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 bg-white border border-slate-200 rounded-lg">
                        <div className="text-xs text-slate-500">Total Invoiced</div>
                        <div className="text-2xl font-semibold text-slate-900 mt-1">
                            {formatCurrency(statement.totals.totalInvoiced)}
                        </div>
                        <div className="text-xs text-slate-500 mt-1">{statement.invoices.length} invoice(s)</div>
                    </div>
                    <div className="p-4 bg-white border border-slate-200 rounded-lg">
                        <div className="text-xs text-slate-500">Total Paid</div>
                        <div className="text-2xl font-semibold text-emerald-600 mt-1">
                            {formatCurrency(statement.totals.totalPaid)}
                        </div>
                        <div className="text-xs text-slate-500 mt-1">{statement.payments.length} payment(s)</div>
                    </div>
                    <div className="p-4 bg-white border border-slate-200 rounded-lg">
                        <div className="text-xs text-slate-500">Period Balance</div>
                        {(() => {
                            const periodBalance = statement.totals.totalInvoiced - statement.totals.totalPaid;
                            return (
                                <>
                                    <div className={`text-2xl font-semibold mt-1 ${periodBalance > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                                        {formatCurrency(periodBalance)}
                                    </div>
                                    <div className="text-xs text-slate-500 mt-1">Invoices − Payments</div>
                                </>
                            );
                        })()}
                    </div>
                </div>
            )}

            {/* Statement table */}
            {statement && (
                <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
                        <div>
                            <div className="text-sm font-semibold text-slate-900">{statement.customerName}</div>
                            <div className="text-xs text-slate-500">
                                Period: {formatDate(statement.startDate) || 'Any'} → {formatDate(statement.endDate) || 'Any'}
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
                                title="Download statement as PDF"
                            >
                                <Download size={18} />
                                Download PDF
                            </button>
                            <button
                                onClick={handlePrepareEmailDraft}
                                disabled={entries.length === 0}
                                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-all shadow-md font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Compose and send statement email"
                            >
                                <Mail size={18} />
                                Email
                            </button>
                        </div>
                    </div>
                    {entries.length === 0 ? (
                        <div className="p-8 text-center text-sm text-slate-500">
                            <FileText className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                            No invoices or payments for this customer in the selected range.
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
                                    {entries.map((entry, idx) => {
                                        if (entry.kind === 'invoice') {
                                            const inv = entry.data;
                                            return (
                                                <tr key={`inv-${inv.id}`} className={idx % 2 ? 'bg-slate-50/50' : ''}>
                                                    <td className="px-4 py-2 whitespace-nowrap text-slate-700">{formatDate(inv.txnDate)}</td>
                                                    <td className="px-4 py-2">
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-indigo-100 text-indigo-700">
                                                            <FileText className="w-3 h-3" /> Invoice
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-2 font-mono text-xs text-slate-700">INVOICE # {inv.docNumber || inv.id}</td>
                                                    <td className="px-4 py-2 text-xs text-slate-500">
                                                        Due {formatDate(inv.dueDate)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right tabular-nums text-slate-900">
                                                        {formatCurrency(inv.totalAmount, inv.currency)}
                                                    </td>
                                                    <td className="px-4 py-2 text-right text-slate-300">—</td>
                                                    <td className="px-4 py-2 text-right tabular-nums font-medium text-slate-900">
                                                        {formatCurrency(entry.runningBalance)}
                                                    </td>
                                                </tr>
                                            );
                                        }
                                        const r = entry.data;
                                        const isDeposit = r.kind === 'deposit';
                                        // Reference for payments/deposits: bank name + last 4 digits of
                                        // the account (parsed from the QB account name, e.g.
                                        // "Chase Checking *1234" or "BofA 5678").
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
                                            <tr key={r.id} className={idx % 2 ? 'bg-slate-50/50' : ''}>
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
                                                <td className="px-4 py-2 text-xs text-slate-500">
                                                    {isDeposit ? 'Bank deposit' : 'Payment'}
                                                </td>
                                                <td className="px-4 py-2 text-right text-slate-300">—</td>
                                                <td className="px-4 py-2 text-right tabular-nums text-emerald-700">
                                                    {formatCurrency(r.totalAmount, r.currency)}
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
                                        <td colSpan={4} className="px-4 py-2 text-right text-slate-600 text-xs uppercase">Totals</td>
                                        <td className="px-4 py-2 text-right tabular-nums text-slate-900">
                                            {formatCurrency(statement.totals.totalInvoiced)}
                                        </td>
                                        <td className="px-4 py-2 text-right tabular-nums text-emerald-700">
                                            {formatCurrency(statement.totals.totalPaid)}
                                        </td>
                                        {(() => {
                                            // Period balance = invoices − payments in this period.
                                            // This matches the final running-balance value and is what
                                            // customers expect on a statement.
                                            const periodBalance = statement.totals.totalInvoiced - statement.totals.totalPaid;
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
                </div>
            )}

            {!statement && !loading && !error && connected && (
                <div className="p-8 text-center text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg">
                    Pick a customer and a date range, then click <span className="font-medium">Generate Statement</span>.
                </div>
            )}

            {/* Email Preview Modal — copied from Delivery Documents (PLInvoiceEngine) */}
            {emailPreviewOpen && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
                        {/* Header */}
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
                            {/* To */}
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
                            {/* CC */}
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
                            {/* Subject */}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Subject</label>
                                <input
                                    type="text"
                                    value={emailDraft.subject}
                                    onChange={(e) => setEmailDraft(prev => ({ ...prev, subject: e.target.value }))}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                />
                            </div>
                            {/* Body */}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Message</label>
                                <textarea
                                    value={emailDraft.htmlBody}
                                    onChange={(e) => setEmailDraft(prev => ({ ...prev, htmlBody: e.target.value }))}
                                    rows={10}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none font-mono"
                                />
                            </div>
                            {/* Attachments */}
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
                            {/* Status */}
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

                        {/* Footer */}
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

export default FinanceBalances;
