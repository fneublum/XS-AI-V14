// Phase 3B — Customer Financial Balances (v2 port).
//
// Full port of pages/FinanceBalances.tsx. Same data model, same PDF
// layout, same MSAL/Gmail-backed `sendEmail` flow — re-skinned in the
// v2 dark palette. Three-quarter feature parity with v1:
//   • QuickBooks customer list + statement fetch
//   • ERP↔QB customer matching (normalized-name intersection)
//   • Chronological running balance (invoices + receipts)
//   • jsPDF + autoTable statement export
//   • Inline email draft + real send via the shared email service
// Deferred vs. v1: None of the above. The preset calculator was
// extracted into v2/lib/datePresets.ts so it isn't duplicated.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, Ban, Calendar, CheckCircle2, Download, EyeOff, FileText, Loader2, Mail,
  Plus, RefreshCw, Scale, Send, User, X as XIcon,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Card, CardBody, Badge, EmptyState, StatCard, StatGrid,
} from '../primitives';
import { cn } from '../primitives/utils';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import { useCompanies } from '../queries/useCompanies';
import { useCustomers } from '../queries/useCustomers';
import {
  PRESETS, PresetId, computeRange,
} from '../lib/datePresets';
import { formatDate } from '../lib/formatDate';
import {
  fetchQBCustomers, fetchCustomerStatement, voidQbInvoice,
  QBCustomer, QBCustomerStatement, QBStatementInvoice, QBStatementReceipt,
} from '../../services/quickbooksService';
import { sendEmail } from '../../services/emailService';
import { getSupabaseClient } from '../../services/supabase';

// ── Helpers ─────────────────────────────────────────────────────

const normalizeCustomerName = (s: string | undefined | null): string =>
  (s || '')
    .toLowerCase()
    .replace(/[.,'"`()\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const formatCurrency = (val: number | null | undefined, currency = 'USD'): string => {
  const num = typeof val === 'number' ? val : parseFloat(val as unknown as string);
  if (num == null || Number.isNaN(num)) return '—';
  const opts = { style: 'currency' as const, minimumFractionDigits: 2, maximumFractionDigits: 2 };
  try {
    return new Intl.NumberFormat('en-US', { ...opts, currency }).format(num);
  } catch {
    return new Intl.NumberFormat('en-US', { ...opts, currency: 'USD' }).format(num);
  }
};


const DEFAULT_PRESET: PresetId = 'last_12_months';

type StatementEntry =
  | { kind: 'invoice'; date: string; data: QBStatementInvoice }
  | { kind: 'receipt'; date: string; data: QBStatementReceipt };

interface EmailDraft {
  to: string;
  cc: string;
  subject: string;
  htmlBody: string;
  attachments: { name: string; contentBytes: string; contentType: string }[];
}

// ── Component ───────────────────────────────────────────────────

const FinanceBalancesV2: React.FC = () => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const companies = useCompanies();
  const erpCustomersQ = useCustomers();

  const companyId = currentCompanyId || 'ALL';
  const currentCompany = useMemo(
    () => (companies.data ?? []).find(c => c.id === currentCompanyId),
    [companies.data, currentCompanyId],
  );

  // ERP customer name set — used to intersect the QB list so users
  // only see their own accounts (not the full QB customer book).
  const erpNameSet = useMemo(() => {
    const set = new Set<string>();
    for (const c of (erpCustomersQ.data ?? [])) {
      const n = normalizeCustomerName(c.name);
      if (n) set.add(n);
      const nick = normalizeCustomerName(c.nickname);
      if (nick) set.add(nick);
    }
    return set;
  }, [erpCustomersQ.data]);

  const initialRange = useMemo(
    () => computeRange(DEFAULT_PRESET) ?? { startDate: '', endDate: '' },
    [],
  );

  // QB connection + data state
  const [connected, setConnected] = useState<boolean | null>(null);
  const [customers, setCustomers] = useState<QBCustomer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);

  // Filters
  const [selectedCustomer, setSelectedCustomer] = useState<string>('');
  const [preset, setPreset] = useState<PresetId>(DEFAULT_PRESET);
  const [startDate, setStartDate] = useState(initialRange.startDate);
  const [endDate, setEndDate]     = useState(initialRange.endDate);

  const applyPreset = useCallback((id: PresetId) => {
    setPreset(id);
    const r = computeRange(id);
    if (r) { setStartDate(r.startDate); setEndDate(r.endDate); }
  }, []);

  // Statement + loading + error
  const [statement, setStatement] = useState<QBCustomerStatement | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  // "All customers" summary mode — when the user picks the ALL option in
  // the customer dropdown, we fan out fetchCustomerStatement across every
  // visible QB↔ERP customer and roll the per-customer totals into a single
  // summary table. Invoice details are intentionally NOT shown here — the
  // user wanted a one-glance "who owes what" view.
  type CustomerBalanceRow = {
    customerName: string;
    customerId: string | null;
    totalInvoiced: number;
    totalPaid: number;
    outstandingBalance: number;
    error?: string;
  };
  const ALL_SENTINEL = '__ALL__';
  const [allBalances, setAllBalances] = useState<CustomerBalanceRow[] | null>(null);
  const [loadingAll, setLoadingAll]   = useState(false);
  const [allProgress, setAllProgress] = useState({ done: 0, total: 0 });

  // Per-user hide list for the ALL summary. Persists across reloads so a
  // customer the user dismissed (e.g. an obvious error row, or a
  // long-tail customer they don't care about) stays out of view next
  // time. Keyed by customerName (the same value used for QB lookup).
  const HIDDEN_LS_KEY = 'cb-hidden-customers-v1';
  const [hiddenCustomers, setHiddenCustomers] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_LS_KEY);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch { return new Set(); }
  });
  useEffect(() => {
    try { localStorage.setItem(HIDDEN_LS_KEY, JSON.stringify([...hiddenCustomers])); } catch { /* quota / private mode */ }
  }, [hiddenCustomers]);
  const hideCustomer    = (name: string) => setHiddenCustomers(prev => new Set([...prev, name]));
  const unhideCustomer  = (name: string) => setHiddenCustomers(prev => {
    const next = new Set(prev); next.delete(name); return next;
  });
  const clearHidden     = () => setHiddenCustomers(new Set());

  // Void-invoice dialog state
  const [voidTarget, setVoidTarget] = useState<QBStatementInvoice | null>(null);
  const [voidingId, setVoidingId]   = useState<string | null>(null);

  // Email draft
  const [emailPreviewOpen, setEmailPreviewOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState<EmailDraft>({
    to: '', cc: '', subject: '', htmlBody: '', attachments: [],
  });
  const [sendingEmail, setSendingEmail] = useState(false);

  // Company logo (for PDF)
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);
  useEffect(() => {
    const fetchLogo = async () => {
      const client = getSupabaseClient();
      if (!client) return;
      const targetId = !currentCompanyId || currentCompanyId === 'ALL' ? 'SYSTEM' : currentCompanyId;
      try {
        const { data } = await client.from('imagens').select('url').eq('companyId', targetId).eq('type', 'LOGO').single();
        if (data && (data as { url: string }).url) { setCompanyLogoUrl((data as { url: string }).url); return; }
      } catch { /* fall through */ }
      if (targetId !== 'SYSTEM') {
        try {
          const { data: sys } = await client.from('imagens').select('url').eq('companyId', 'SYSTEM').eq('type', 'LOGO').single();
          if (sys && (sys as { url: string }).url) setCompanyLogoUrl((sys as { url: string }).url);
        } catch { /* no logo */ }
      }
    };
    fetchLogo();
  }, [currentCompanyId]);

  // Load QB customers on mount / company change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingCustomers(true);
      setError(null);
      try {
        const list = await fetchQBCustomers(companyId);
        if (cancelled) return;
        list.sort((a, b) => a.displayName.localeCompare(b.displayName));
        setCustomers(list);
        setConnected(true);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('not connected') || msg.includes('reconnect')) {
          setConnected(false);
        } else {
          setConnected(true);
          setError(msg || 'Failed to load QuickBooks customers');
        }
      } finally {
        if (!cancelled) setLoadingCustomers(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  // Intersect the QB customer list against the ERP customer set. If
  // the ERP list hasn't loaded, show the full QB list so the page
  // stays usable.
  const visibleCustomers = useMemo(() => {
    if (erpNameSet.size === 0) return customers;
    return customers.filter(c => erpNameSet.has(normalizeCustomerName(c.displayName)));
  }, [customers, erpNameSet]);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load statement');
      setStatement(null);
    } finally {
      setLoading(false);
    }
  }, [companyId, selectedCustomer, startDate, endDate]);

  // Bulk: pull a statement per visible customer, in batches of 5 (cap QB
  // rate). Per-customer errors don't fail the whole run — they surface
  // inline on the summary row so the user still sees everything else.
  const runAllBalances = useCallback(async () => {
    if (visibleCustomers.length === 0) {
      setError('No matching customers');
      return;
    }
    setLoadingAll(true);
    setError(null);
    setStatement(null);
    setAllBalances([]);
    setAllProgress({ done: 0, total: visibleCustomers.length });

    const results: CustomerBalanceRow[] = [];
    const BATCH = 5;
    for (let i = 0; i < visibleCustomers.length; i += BATCH) {
      const slice = visibleCustomers.slice(i, i + BATCH);
      const settled = await Promise.allSettled(
        slice.map(c => fetchCustomerStatement(companyId, c.displayName, startDate, endDate)),
      );
      settled.forEach((s, idx) => {
        const c = slice[idx];
        if (s.status === 'fulfilled') {
          results.push({
            customerName: c.displayName,
            customerId: s.value.customerId,
            totalInvoiced: s.value.totals.totalInvoiced,
            totalPaid: s.value.totals.totalPaid,
            outstandingBalance: s.value.totals.outstandingBalance,
          });
        } else {
          const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
          results.push({
            customerName: c.displayName, customerId: null,
            totalInvoiced: 0, totalPaid: 0, outstandingBalance: 0,
            error: msg,
          });
        }
      });
      setAllProgress({ done: Math.min(i + BATCH, visibleCustomers.length), total: visibleCustomers.length });
    }
    // Sort by outstanding balance descending — biggest debtors first.
    results.sort((a, b) => b.outstandingBalance - a.outstandingBalance);
    setAllBalances(results);
    setLoadingAll(false);
  }, [companyId, visibleCustomers, startDate, endDate]);

  const handleConfirmVoid = useCallback(async () => {
    if (!voidTarget) return;
    setVoidingId(voidTarget.id);
    try {
      await voidQbInvoice(companyId, voidTarget.id);
      toast.push({
        kind: 'success',
        title: 'Invoice voided',
        description: `INVOICE # ${voidTarget.docNumber || voidTarget.id} has been voided in QuickBooks.`,
      });
      setVoidTarget(null);
      await runStatement();
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Void failed',
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setVoidingId(null);
    }
  }, [voidTarget, companyId, runStatement, toast]);

  // Merge invoices + receipts into a single chronological entry list
  // with running balance. Prefer `receipts` (deposit-grouped) when
  // the backend returns them — collapses multi-payment deposits.
  // One-off client-side void: hide these invoice numbers from every
  // Customer Balances view (rows + totals + PDF + email). Remove an
  // entry once the corresponding invoice is voided upstream in QB.
  const HIDDEN_INVOICE_NUMBERS = useMemo(() => new Set(['INV-4358', '4358']), []);

  const hiddenAmount = useMemo(() => {
    if (!statement) return 0;
    return statement.invoices
      .filter(inv => HIDDEN_INVOICE_NUMBERS.has((inv.docNumber || '').trim()))
      .reduce((s, inv) => s + (inv.totalAmount || 0), 0);
  }, [statement, HIDDEN_INVOICE_NUMBERS]);

  const adjustedTotals = useMemo(() => {
    if (!statement) return { totalInvoiced: 0, totalPaid: 0 };
    return {
      totalInvoiced: statement.totals.totalInvoiced - hiddenAmount,
      totalPaid: statement.totals.totalPaid,
    };
  }, [statement, hiddenAmount]);

  const entries = useMemo<Array<StatementEntry & { runningBalance: number }>>(() => {
    if (!statement) return [];
    const visibleInvoices = statement.invoices.filter(
      inv => !HIDDEN_INVOICE_NUMBERS.has((inv.docNumber || '').trim()),
    );
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
      ...visibleInvoices.map<StatementEntry>(inv => ({ kind: 'invoice', date: inv.txnDate, data: inv })),
      ...receiptRows.map<StatementEntry>(r  => ({ kind: 'receipt', date: r.txnDate,   data: r   })),
    ];
    merged.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    let running = 0;
    return merged.map(e => {
      if (e.kind === 'invoice') running += e.data.totalAmount;
      else                      running -= e.data.totalAmount;
      return { ...e, runningBalance: running };
    });
  }, [statement]);

  // ── PDF ──────────────────────────────────────────────────────

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

    // Header: logo (top-left) + company address (top-right).
    let headerBottom = 48;
    if (companyLogoUrl) {
      try {
        const imgProps = doc.getImageProperties(companyLogoUrl);
        const maxWidth = 140;
        const maxHeight = 54;
        const ratio = Math.min(maxWidth / imgProps.width, maxHeight / imgProps.height);
        const w = imgProps.width * ratio;
        const h = imgProps.height * ratio;
        doc.addImage(companyLogoUrl, marginX, 30, w, h);
        headerBottom = Math.max(headerBottom, 30 + h);
      } catch (e) {
        console.error('Failed to add company logo to statement PDF', e);
      }
    }

    const pageWidth = doc.internal.pageSize.getWidth();
    const rightX = pageWidth - marginX;
    const companyName = currentCompany?.name || '';
    const addressLine1 = currentCompany?.address || '';
    const addressLine2 = [currentCompany?.city, currentCompany?.state, currentCompany?.zip]
      .filter(Boolean)
      .join(currentCompany?.state ? ', ' : ' ')
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
      if (addressLine1)          { doc.text(addressLine1,              rightX, rY, { align: 'right' }); rY += 12; }
      if (addressLine2)          { doc.text(addressLine2,              rightX, rY, { align: 'right' }); rY += 12; }
      if (currentCompany?.phone) { doc.text(currentCompany.phone,      rightX, rY, { align: 'right' }); rY += 12; }
      headerBottom = Math.max(headerBottom, rY);
    }

    // Title
    const titleY = headerBottom + 24;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor('#0f172a');
    doc.text('Customer Statement', marginX, titleY);

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(statement.customerName, marginX, titleY + 20);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor('#475569');
    doc.text(`Period: ${periodLabel}`,      marginX, titleY + 36);
    doc.text(`Generated: ${generatedAt}`,   marginX, titleY + 50);
    const tableStartY = titleY + 66;

    // Rows
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
        ? `Received on ${last4 ? `${bankOnly} **${last4}` : bankOnly}`
        : 'Received on Bank';
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

    const periodBalance = adjustedTotals.totalInvoiced - adjustedTotals.totalPaid;

    autoTable(doc, {
      startY: tableStartY,
      head: [['Date', 'Type', 'Reference', 'Details', 'Invoice', 'Received', 'Balance']],
      body,
      foot: [[
        { content: 'TOTALS', colSpan: 4, styles: { halign: 'right', fontStyle: 'bold' } },
        { content: formatCurrency(adjustedTotals.totalInvoiced), styles: { halign: 'right', fontStyle: 'bold' } },
        { content: formatCurrency(adjustedTotals.totalPaid),     styles: { halign: 'right', fontStyle: 'bold', textColor: '#047857' } },
        {
          content: formatCurrency(periodBalance),
          styles: {
            halign: 'right', fontStyle: 'bold',
            textColor: periodBalance > 0 ? '#e11d48' : '#0f172a',
          },
        },
      ]],
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [241, 245, 249], textColor: '#334155' },
      footStyles: { fillColor: [241, 245, 249], textColor: '#0f172a' },
      columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
      margin: { left: marginX, right: marginX },
    });

    const finalY = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY) || 140;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor('#94a3b8');
    doc.text(
      `Statement for ${statement.customerName} · ${periodLabel} · generated ${generatedAt}`,
      marginX,
      Math.min(finalY + 24, doc.internal.pageSize.getHeight() - 20),
    );

    return doc;
  }, [statement, entries, companyLogoUrl, currentCompany, adjustedTotals]);

  const handleDownloadPDF = useCallback(() => {
    const doc = buildStatementPDF();
    if (!doc || !statement) return;
    const safeName = statement.customerName.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
    const periodTag = [statement.startDate, statement.endDate].filter(Boolean).join('_to_') || 'all';
    doc.save(`Statement_${safeName}_${periodTag}.pdf`);
    toast.push({ kind: 'success', title: 'Statement downloaded', description: `Statement_${safeName}_${periodTag}.pdf` });
  }, [buildStatementPDF, statement, toast]);

  const handleDownloadXlsx = useCallback(() => {
    if (!statement || entries.length === 0) return;
    const periodLabel =
      statement.startDate && statement.endDate
        ? `${formatDate(statement.startDate)} — ${formatDate(statement.endDate)}`
        : 'All dates';

    const header = ['Date', 'Type', 'Reference', 'Details', 'Invoice', 'Received', 'Balance'];
    const body = entries.map(e => {
      if (e.kind === 'invoice') {
        const inv = e.data;
        return [
          formatDate(inv.txnDate),
          'Invoice',
          `INVOICE # ${inv.docNumber || inv.id}`,
          `Due ${formatDate(inv.dueDate)}`,
          inv.totalAmount || 0,
          '',
          e.runningBalance,
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
        ? `Received on ${last4 ? `${bankOnly} **${last4}` : bankOnly}`
        : 'Received on Bank';
      return [
        formatDate(r.txnDate),
        isDeposit ? 'Deposit' : 'Payment',
        refText,
        isDeposit ? 'Bank deposit' : 'Payment',
        '',
        r.totalAmount || 0,
        e.runningBalance,
      ];
    });
    const periodBalance = adjustedTotals.totalInvoiced - adjustedTotals.totalPaid;
    const totalsRow = [
      '', '', '', '', adjustedTotals.totalInvoiced, adjustedTotals.totalPaid, periodBalance,
    ];

    const titleRows = [
      ['Customer Statement'],
      [statement.customerName],
      [`Period: ${periodLabel}`],
      [],
    ];
    const aoa = [...titleRows, header, ...body, totalsRow];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 12 }, { wch: 10 }, { wch: 32 }, { wch: 20 },
      { wch: 14 }, { wch: 14 }, { wch: 14 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Statement');

    const safeName = statement.customerName.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
    const periodTag = [statement.startDate, statement.endDate].filter(Boolean).join('_to_') || 'all';
    const filename = `Statement_${safeName}_${periodTag}.xlsx`;
    XLSX.writeFile(wb, filename);
    toast.push({ kind: 'success', title: 'Statement downloaded', description: filename });
  }, [statement, entries, adjustedTotals, toast]);

  // ── Email ────────────────────────────────────────────────────

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
    const periodBalance = adjustedTotals.totalInvoiced - adjustedTotals.totalPaid;

    const customer = customers.find(c => c.displayName === statement.customerName);
    const toAddress = customer?.primaryEmail || '';

    const body =
      `Dear ${statement.customerName},\n\n` +
      `Please find attached your account statement.\n\n` +
      `Period: ${periodLabel}\n` +
      `Total Invoiced: ${formatCurrency(adjustedTotals.totalInvoiced)}\n` +
      `Total Paid: ${formatCurrency(adjustedTotals.totalPaid)}\n` +
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
    setEmailPreviewOpen(true);
  }, [buildStatementPDF, statement, customers, adjustedTotals]);

  const sendEmailFromPreview = useCallback(async () => {
    if (!emailDraft.to) {
      toast.push({ kind: 'error', title: 'Recipient required', description: 'Enter a recipient email address.' });
      return;
    }
    setSendingEmail(true);
    try {
      const toList = emailDraft.to.split(/[;,]/).map(e => e.trim()).filter(Boolean);
      const ccList = emailDraft.cc.split(/[;,]/).map(e => e.trim()).filter(Boolean);
      if (toList.length === 0) {
        toast.push({ kind: 'error', title: 'Invalid recipient', description: 'Enter a valid recipient email address.' });
        setSendingEmail(false);
        return;
      }
      const escaped = emailDraft.htmlBody.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const htmlBody = `<div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">
        <h2 style="color: #4F46E5; margin-bottom: 8px;">${emailDraft.subject}</h2>
        <div style="white-space: pre-wrap; line-height: 1.6; color:#0f172a;">${escaped}</div>
      </div>`;
      const result = await sendEmail({
        to: toList,
        cc: ccList.length > 0 ? ccList : undefined,
        subject: emailDraft.subject,
        htmlBody,
        attachments: emailDraft.attachments,
      });
      if (result.success) {
        toast.push({ kind: 'success', title: 'Email sent', description: `Sent via ${result.provider}` });
        setTimeout(() => setEmailPreviewOpen(false), 800);
      } else {
        toast.push({ kind: 'error', title: 'Email failed', description: result.message });
      }
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Email failed',
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setSendingEmail(false);
    }
  }, [emailDraft, toast]);

  // ── UI ───────────────────────────────────────────────────────

  const periodBalance = statement
    ? adjustedTotals.totalInvoiced - adjustedTotals.totalPaid
    : 0;

  const hasStatement = statement !== null;

  return (
    <div className="max-w-[1200px] space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">
            Customer Balances
          </h1>
          <Badge variant="info">Live</Badge>
          {connected === false && <Badge variant="warning">QuickBooks not connected</Badge>}
          {connected === true && <Badge variant="success" dot>QB connected</Badge>}
        </div>
        <p className="text-[13px] text-slate-500 mt-1">
          Per-customer QuickBooks statement — invoices, receipts, running balance, PDF &amp; email.
        </p>
      </div>

      {/* QB-disconnected state */}
      {connected === false && (
        <Card>
          <CardBody>
            <div className="flex items-start gap-3 p-1">
              <div className="p-1.5 rounded-md bg-amber-500/10 text-amber-300 shrink-0">
                <AlertCircle size={16} />
              </div>
              <div>
                <div className="text-[13px] font-semibold text-amber-200">QuickBooks is not connected</div>
                <div className="text-[12px] text-amber-200/80 mt-1">
                  Connect QuickBooks from the Connections page, then refresh this view.
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Filters */}
      {connected !== false && (
        <Card>
          <CardBody>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div className="md:col-span-2">
                <FilterLabel icon={<User size={11} />} text="Customer" />
                <select
                  value={selectedCustomer}
                  onChange={e => {
                    setSelectedCustomer(e.target.value);
                    setStatement(null);
                    setAllBalances(null);
                  }}
                  disabled={loadingCustomers || visibleCustomers.length === 0}
                  className="mt-1 w-full px-2.5 py-1.5 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] rounded-md text-slate-200 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
                >
                  <option value="">
                    {loadingCustomers
                      ? 'Loading QuickBooks customers…'
                      : visibleCustomers.length === 0
                        ? 'No matching customers'
                        : `Select a customer (${visibleCustomers.length})`}
                  </option>
                  {visibleCustomers.length > 0 && (
                    <option value={ALL_SENTINEL}>
                      ⌘ All customers — totals only ({visibleCustomers.length})
                    </option>
                  )}
                  {visibleCustomers.map(c => (
                    <option key={c.id} value={c.displayName}>{c.displayName}</option>
                  ))}
                </select>
              </div>

              <div>
                <FilterLabel icon={<Calendar size={11} />} text="Range" />
                <select
                  value={preset}
                  onChange={e => applyPreset(e.target.value as PresetId)}
                  className="mt-1 w-full px-2.5 py-1.5 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] rounded-md text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  {PRESETS.map(p => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <FilterLabel icon={<Calendar size={11} />} text="From" />
                <input
                  type="date"
                  value={startDate}
                  onChange={e => { setStartDate(e.target.value); setPreset('custom'); }}
                  className="mt-1 w-full px-2.5 py-1.5 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] rounded-md text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <FilterLabel icon={<Calendar size={11} />} text="To" />
                <input
                  type="date"
                  value={endDate}
                  onChange={e => { setEndDate(e.target.value); setPreset('custom'); }}
                  className="mt-1 w-full px-2.5 py-1.5 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] rounded-md text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="mt-3 flex items-center gap-3 flex-wrap">
              {(() => {
                const isAll = selectedCustomer === ALL_SENTINEL;
                const busy = loading || loadingAll;
                const enabled = !!selectedCustomer && !busy;
                const label = isAll
                  ? (loadingAll
                      ? `Loading balances… (${allProgress.done}/${allProgress.total})`
                      : 'Load all customer balances')
                  : 'Generate Statement';
                return (
                  <button
                    type="button"
                    onClick={isAll ? runAllBalances : runStatement}
                    disabled={!enabled}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors',
                      enabled
                        ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                        : 'bg-[#141414] text-slate-600 cursor-not-allowed',
                    )}
                  >
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    {label}
                  </button>
                );
              })()}
              {error && (
                <span className="text-[11px] text-red-400 flex items-center gap-1">
                  <AlertCircle size={11} /> {error}
                </span>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── All customers summary ───────────────────────────────── */}
      {selectedCustomer === ALL_SENTINEL && allBalances && allBalances.length > 0 && (
        <Card>
          <CardBody>
            <div className="mb-3">
              <div className="text-[13px] font-semibold text-slate-100">
                All customers — outstanding balances
              </div>
              <div className="text-[11.5px] text-slate-500 mt-0.5">
                {allBalances.filter(r => !hiddenCustomers.has(r.customerName)).length} visible
                {hiddenCustomers.size > 0 ? ` · ${hiddenCustomers.size} hidden` : ''} ·
                period {formatDate(startDate) || '—'} → {formatDate(endDate) || '—'} ·
                grand total in the footer row · click − to hide a row
              </div>
            </div>

            {/* Hidden-customers chip strip — clicking + restores the row. */}
            {hiddenCustomers.size > 0 && (
              <div className="mb-3 p-2 rounded-md border border-[#1f1f1f] bg-[#0a0a0a]">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10.5px] uppercase tracking-wider text-slate-500 flex items-center gap-1">
                    <EyeOff size={11} /> Hidden ({hiddenCustomers.size})
                  </span>
                  {[...hiddenCustomers].sort().map(name => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => unhideCustomer(name)}
                      title={`Restore ${name} to the table`}
                      className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] bg-[#141414] hover:bg-[#1a1a1a] text-slate-300 border border-[#1f1f1f] transition-colors"
                    >
                      <Plus size={11} className="text-emerald-400" />
                      <span className="truncate max-w-[160px]">{name}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={clearHidden}
                    className="ml-auto text-[10.5px] text-slate-500 hover:text-slate-300 underline-offset-2 hover:underline"
                  >
                    Show all
                  </button>
                </div>
              </div>
            )}
            <div className="rounded-md border border-[#1f1f1f] overflow-hidden">
              <table className="w-full text-[12px]">
                <thead className="bg-[#0a0a0a] text-slate-500">
                  <tr>
                    <th className="text-left  px-3 py-2 font-medium uppercase tracking-wider">Customer</th>
                    <th className="text-right px-3 py-2 font-medium uppercase tracking-wider">Total invoiced</th>
                    <th className="text-right px-3 py-2 font-medium uppercase tracking-wider">Total paid</th>
                    <th className="text-right px-3 py-2 font-medium uppercase tracking-wider">Balance</th>
                    <th className="w-9"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1a1a1a] bg-[#0f0f0f]">
                  {allBalances
                    .filter(r => !hiddenCustomers.has(r.customerName))
                    .map(r => {
                      const owes = r.outstandingBalance > 0.005;
                      return (
                        <tr key={r.customerName} className="hover:bg-[#161616] group">
                          <td className="px-3 py-2 text-slate-200">
                            {r.customerName}
                            {r.error && (
                              <span className="ml-2 text-[10.5px] text-rose-400" title={r.error}>error</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-300">
                            {formatCurrency(r.totalInvoiced)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-emerald-300/80">
                            {formatCurrency(r.totalPaid)}
                          </td>
                          <td className={cn(
                            'px-3 py-2 text-right font-mono tabular-nums font-semibold',
                            owes ? 'text-amber-300' : 'text-emerald-300/80',
                          )}>
                            {formatCurrency(r.outstandingBalance)}
                          </td>
                          <td className="px-1 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => hideCustomer(r.customerName)}
                              title={`Hide ${r.customerName} from this view (excluded from total)`}
                              className="inline-flex items-center justify-center w-6 h-6 rounded text-slate-600 hover:text-rose-300 hover:bg-rose-500/10 transition-colors opacity-40 group-hover:opacity-100"
                            >
                              <span className="text-[14px] leading-none font-mono">−</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
                {/* Grand total — totals only the rows still visible, so
                    hiding rows immediately drops them from the bottom. */}
                <tfoot className="bg-[#0a0a0a] border-t-2 border-[#2a2a2a]">
                  {(() => {
                    const visible = allBalances.filter(r => !hiddenCustomers.has(r.customerName));
                    const grand = visible.reduce(
                      (acc, r) => ({
                        inv: acc.inv + r.totalInvoiced,
                        pay: acc.pay + r.totalPaid,
                        bal: acc.bal + r.outstandingBalance,
                      }),
                      { inv: 0, pay: 0, bal: 0 },
                    );
                    const owes = grand.bal > 0.005;
                    return (
                      <tr>
                        <td className="px-3 py-2.5 text-slate-100 font-semibold uppercase text-[11px] tracking-wider">
                          Total · {visible.length} customer{visible.length === 1 ? '' : 's'}
                          {hiddenCustomers.size > 0 && (
                            <span className="ml-2 text-slate-500 font-normal normal-case tracking-normal">
                              ({hiddenCustomers.size} hidden)
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-100 font-semibold">
                          {formatCurrency(grand.inv)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-emerald-300 font-semibold">
                          {formatCurrency(grand.pay)}
                        </td>
                        <td className={cn(
                          'px-3 py-2.5 text-right font-mono tabular-nums font-bold text-[13px]',
                          owes ? 'text-amber-300' : 'text-emerald-300',
                        )}>
                          {formatCurrency(grand.bal)}
                        </td>
                        <td></td>
                      </tr>
                    );
                  })()}
                </tfoot>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Totals */}
      {hasStatement && statement && (
        <StatGrid columns={3}>
          <StatCard
            label="Total Invoiced"
            value={formatCurrency(adjustedTotals.totalInvoiced)}
            delta={{ text: `${statement.invoices.length} invoice${statement.invoices.length === 1 ? '' : 's'}`, tone: 'neutral' }}
          />
          <StatCard
            label="Total Paid"
            value={formatCurrency(adjustedTotals.totalPaid)}
            delta={{
              text: `${(statement.receipts?.length ?? statement.payments.length)} receipt${(statement.receipts?.length ?? statement.payments.length) === 1 ? '' : 's'}`,
              tone: 'positive',
            }}
          />
          <StatCard
            label="Period Balance"
            value={formatCurrency(periodBalance)}
            delta={{
              text: periodBalance > 0 ? 'Outstanding' : periodBalance < 0 ? 'Overpaid / credit' : 'Settled',
              tone: periodBalance > 0 ? 'warning' : periodBalance < 0 ? 'positive' : 'neutral',
            }}
          />
        </StatGrid>
      )}

      {/* Statement table + actions */}
      {hasStatement && statement && (
        <Card>
          <div className="px-4 py-3 border-b border-[#1f1f1f] flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-[13px] font-semibold text-slate-100">{statement.customerName}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Period: {formatDate(statement.startDate) || 'Any'} → {formatDate(statement.endDate) || 'Any'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadPDF}
                disabled={entries.length === 0}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium bg-[#161616] border border-[#1f1f1f] text-slate-200 hover:bg-[#1a1a1a] hover:border-[#2a2a2a] disabled:opacity-50 transition-colors"
              >
                <Download size={12} /> Download PDF
              </button>
              <button
                type="button"
                onClick={handleDownloadXlsx}
                disabled={entries.length === 0}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium bg-[#161616] border border-[#1f1f1f] text-slate-200 hover:bg-[#1a1a1a] hover:border-[#2a2a2a] disabled:opacity-50 transition-colors"
              >
                <Download size={12} /> Download XLSX
              </button>
              <button
                type="button"
                onClick={handlePrepareEmailDraft}
                disabled={entries.length === 0}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
              >
                <Mail size={12} /> Email
              </button>
            </div>
          </div>

          {entries.length === 0 ? (
            <EmptyState
              title="No invoices or receipts"
              description="This customer has no QuickBooks activity in the selected period."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-[#0f0f0f] border-b border-[#1f1f1f]">
                  <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Reference</th>
                    <th className="px-3 py-2 font-medium">Details</th>
                    <th className="px-3 py-2 font-medium text-right">Invoice</th>
                    <th className="px-3 py-2 font-medium text-right">Received</th>
                    <th className="px-3 py-2 font-medium text-right">Balance</th>
                    <th className="px-3 py-2 font-medium text-right w-[60px]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(entry => {
                    if (entry.kind === 'invoice') {
                      const inv = entry.data;
                      return (
                        <tr key={`inv-${inv.id}`} className="border-b border-[#141414] hover:bg-[#0f0f0f] transition-colors">
                          <td className="px-3 py-1.5 whitespace-nowrap text-slate-400 font-mono tabular-nums">{formatDate(inv.txnDate)}</td>
                          <td className="px-3 py-1.5">
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-sm bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                              <FileText size={9} /> Invoice
                            </span>
                          </td>
                          <td className="px-3 py-1.5 font-mono text-[11px] text-slate-300">
                            INVOICE # {inv.docNumber || inv.id}
                          </td>
                          <td className="px-3 py-1.5 text-[11px] text-slate-500">Due {formatDate(inv.dueDate)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-100">{formatCurrency(inv.totalAmount, inv.currency)}</td>
                          <td className="px-3 py-1.5 text-right text-slate-700">—</td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-medium text-slate-100">{formatCurrency(entry.runningBalance)}</td>
                          <td className="px-3 py-1.5 text-right">
                            <button
                              type="button"
                              onClick={() => setVoidTarget(inv)}
                              disabled={voidingId === inv.id}
                              title={`Void invoice ${inv.docNumber || inv.id} in QuickBooks`}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-semibold border bg-[#141414] text-slate-400 border-[#1f1f1f] hover:text-rose-300 hover:border-rose-500/40 transition-colors disabled:opacity-50 disabled:cursor-wait"
                            >
                              {voidingId === inv.id ? <Loader2 size={10} className="animate-spin" /> : <Ban size={10} />}
                              {voidingId === inv.id ? 'Voiding…' : 'Void'}
                            </button>
                          </td>
                        </tr>
                      );
                    }
                    const r = entry.data;
                    const isDeposit = r.kind === 'deposit';
                    const acctName  = (r.depositAccount || '').trim();
                    const digitMatch = acctName.match(/(\d{3,})\s*$/);
                    const last4     = digitMatch ? digitMatch[1].slice(-4) : '';
                    const bankOnly  = digitMatch
                      ? acctName.slice(0, digitMatch.index).replace(/[\s*#•-]+$/, '').trim()
                      : acctName;
                    const refText   = acctName
                      ? `Received on ${last4 ? `${bankOnly} **${last4}` : bankOnly}`
                      : 'Received on Bank';
                    return (
                      <tr key={`rec-${r.id}`} className="border-b border-[#141414] hover:bg-[#0f0f0f] transition-colors">
                        <td className="px-3 py-1.5 whitespace-nowrap text-slate-400 font-mono tabular-nums">{formatDate(r.txnDate)}</td>
                        <td className="px-3 py-1.5">
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-sm bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                            <Scale size={9} /> {isDeposit ? 'Deposit' : 'Payment'}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[11px] text-slate-300">{refText}</td>
                        <td className="px-3 py-1.5 text-[11px] text-slate-500">{isDeposit ? 'Bank deposit' : 'Payment'}</td>
                        <td className="px-3 py-1.5 text-right text-slate-700">—</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-emerald-300">{formatCurrency(r.totalAmount, r.currency)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium text-slate-100">{formatCurrency(entry.runningBalance)}</td>
                        <td className="px-3 py-1.5" />
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-[#0f0f0f] border-t-2 border-[#1f1f1f]">
                  <tr className="text-[11.5px]">
                    <td className="px-3 py-2 font-semibold text-slate-300" colSpan={4}>TOTALS</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-100">{formatCurrency(adjustedTotals.totalInvoiced)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-300">{formatCurrency(adjustedTotals.totalPaid)}</td>
                    <td className={cn(
                      'px-3 py-2 text-right tabular-nums font-semibold',
                      periodBalance > 0 ? 'text-amber-300' : 'text-slate-100',
                    )}>
                      {formatCurrency(periodBalance)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Pre-generate guidance */}
      {/* Per-customer empty state — hide it when the ALL summary is in
          view, otherwise the page shows two competing placeholders. */}
      {!hasStatement && connected !== false && !(selectedCustomer === ALL_SENTINEL && allBalances && allBalances.length > 0) && (
        <Card>
          <EmptyState
            title="Pick a customer and range"
            description="Choose a customer and date range, then press Generate Statement. The combined invoice + receipt ledger will appear here."
          />
        </Card>
      )}

      {/* Email preview modal */}
      <Dialog.Root open={emailPreviewOpen} onOpenChange={setEmailPreviewOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-[7%] -translate-x-1/2 z-50 w-[min(96vw,720px)] rounded-md border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_16px_48px_rgba(0,0,0,0.6)] flex flex-col max-h-[86vh]">
            <div className="px-5 py-4 border-b border-[#1f1f1f] flex items-start gap-3">
              <div className="p-1.5 rounded-md bg-indigo-600/10 text-indigo-300">
                <Mail size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <Dialog.Title className="text-[14px] font-semibold text-slate-100">
                  Email customer statement
                </Dialog.Title>
                <Dialog.Description className="text-[12px] text-slate-500 mt-0.5">
                  Review and send — routes through your signed-in Outlook / Gmail account. PDF is attached.
                </Dialog.Description>
              </div>
              <Dialog.Close
                aria-label="Close"
                className="text-slate-500 hover:text-slate-100 transition-colors p-1 -m-1"
              >
                <XIcon size={14} />
              </Dialog.Close>
            </div>

            <div className="px-5 py-4 overflow-y-auto space-y-3">
              <EmailField label="To">
                <input
                  type="text"
                  value={emailDraft.to}
                  onChange={e => setEmailDraft(d => ({ ...d, to: e.target.value }))}
                  placeholder="recipient@example.com"
                  className="w-full px-2.5 py-1.5 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] rounded-md text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </EmailField>
              <EmailField label="CC">
                <input
                  type="text"
                  value={emailDraft.cc}
                  onChange={e => setEmailDraft(d => ({ ...d, cc: e.target.value }))}
                  placeholder="Optional — comma or semicolon separated"
                  className="w-full px-2.5 py-1.5 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] rounded-md text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </EmailField>
              <EmailField label="Subject">
                <input
                  type="text"
                  value={emailDraft.subject}
                  onChange={e => setEmailDraft(d => ({ ...d, subject: e.target.value }))}
                  className="w-full px-2.5 py-1.5 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] rounded-md text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </EmailField>
              <EmailField label="Message">
                <textarea
                  value={emailDraft.htmlBody}
                  onChange={e => setEmailDraft(d => ({ ...d, htmlBody: e.target.value }))}
                  rows={10}
                  className="w-full px-2.5 py-1.5 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] rounded-md text-slate-200 focus:outline-none focus:border-indigo-500 resize-y"
                />
              </EmailField>
              {emailDraft.attachments.length > 0 && (
                <div className="flex items-center gap-2 text-[11.5px] text-slate-400 border border-[#1f1f1f] rounded-md bg-[#0f0f0f] px-3 py-2">
                  <FileText size={12} className="text-indigo-300" />
                  <span className="font-mono truncate">{emailDraft.attachments[0].name}</span>
                  <span className="ml-auto text-slate-600">PDF attached</span>
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-[#1f1f1f] flex items-center gap-2 justify-end">
              <Dialog.Close className="px-3 py-1.5 text-[12px] text-slate-400 hover:text-slate-100 rounded-md hover:bg-[#141414] transition-colors">
                Cancel
              </Dialog.Close>
              <button
                type="button"
                onClick={sendEmailFromPreview}
                disabled={sendingEmail}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors',
                  sendingEmail
                    ? 'bg-[#141414] text-slate-600'
                    : 'bg-indigo-600 text-white hover:bg-indigo-500',
                )}
              >
                {sendingEmail
                  ? <Loader2 size={12} className="animate-spin" />
                  : <Send size={12} />}
                {sendingEmail ? 'Sending…' : 'Send email'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Void-invoice confirm dialog */}
      <Dialog.Root open={!!voidTarget} onOpenChange={(o) => !o && !voidingId && setVoidTarget(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/60 z-40" />
          <Dialog.Content className="fixed left-1/2 top-[30%] -translate-x-1/2 z-50 w-[min(96vw,460px)] rounded-md border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_16px_48px_rgba(0,0,0,0.6)]">
            <div className="px-5 py-4 border-b border-[#1f1f1f] flex items-start gap-3">
              <div className="p-1.5 rounded-md bg-rose-500/10 text-rose-300">
                <Ban size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <Dialog.Title className="text-[14px] font-semibold text-slate-100">
                  Void invoice in QuickBooks?
                </Dialog.Title>
                <Dialog.Description className="text-[12px] text-slate-500 mt-0.5">
                  {voidTarget
                    ? `INVOICE # ${voidTarget.docNumber || voidTarget.id} — ${formatCurrency(voidTarget.totalAmount, voidTarget.currency)}`
                    : ''}
                </Dialog.Description>
              </div>
            </div>
            <div className="px-5 py-4 text-[12.5px] text-slate-400">
              This marks the invoice as Voided in QuickBooks and zeroes the balance. The action is recorded by QuickBooks and cannot be reversed through this app.
            </div>
            <div className="px-5 py-3 border-t border-[#1f1f1f] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setVoidTarget(null)}
                disabled={!!voidingId}
                className="px-3 py-1.5 rounded-md text-[12px] font-medium bg-[#141414] border border-[#1f1f1f] text-slate-300 hover:text-slate-100 hover:border-[#2a2a2a] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmVoid}
                disabled={!!voidingId}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-rose-600 text-white hover:bg-rose-500 transition-colors disabled:opacity-60 disabled:cursor-wait"
              >
                {voidingId ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                {voidingId ? 'Voiding…' : 'Void invoice'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
};

const FilterLabel: React.FC<{ icon: React.ReactNode; text: string }> = ({ icon, text }) => (
  <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium flex items-center gap-1">
    {icon} {text}
  </label>
);

const EmailField: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium block mb-1">
      {label}
    </label>
    {children}
  </div>
);

export default FinanceBalancesV2;
