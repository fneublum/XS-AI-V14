// Statements — Phase 3 AR/AP statement viewer.
//
// Replaces the QuickBooks-only Customer Balances flow. Reads
// invoices + transactions from Supabase, builds a per-counterparty
// ledger with running balance + aging buckets, exports PDF.
//
// One unified screen with an AR/AP toggle at the top.
//
//   AR: Customer statement — invoices_we_issued + payments_received
//   AP: Supplier statement — bills_received + payments_we_made
//
// PDF generation reuses the jsPDF + jspdf-autotable pattern that
// already powers the other V14 statement PDFs (Trading Follow Up,
// Logistics Follow Up).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FileText, Download, ChevronDown, RefreshCw, Database, Cloud,
  Mail, Loader2, Send, X as XIcon, FileSpreadsheet,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import * as Dialog from '@radix-ui/react-dialog';
import { sendEmail } from '../../services/emailService';
import {
  useStatement, useCounterpartyBalances,
  type StatementKind, type Statement, type StatementLine,
} from '../queries/useStatement';
import { useCompany } from '../providers/CompanyProvider';
import { useCompanies } from '../queries/useCompanies';
import { useToast } from '../primitives/Toast';
import { invokeEdgeFunction } from '../../services/edgeAuth';
import { useQueryClient } from '@tanstack/react-query';
import {
  fetchQBCustomers, fetchCustomerStatement, getQBConnectionStatus,
  type QBCustomer, type QBCustomerStatement,
} from '../../services/quickbooksService';
import { isEc4Company } from '../services/pdf/isEc4Company';
import { useCustomers } from '../queries/useCustomers';

// Same normalisation FinanceBalancesV2 uses to intersect the QB
// customer book against ERP customers — strips punctuation and
// folds whitespace so "JP MORGAN" / "Jp Morgan, NA" / "jp-morgan"
// all collide on the same key.
const normalizeCustomerName = (s: string | undefined | null): string =>
  (s || '')
    .toLowerCase()
    .replace(/[.,'"`()\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function fmtMoney(n: number, c: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(n);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: '2-digit' }); }
  catch { return d; }
}

// ── QB ⇄ Statement adapter ──────────────────────────────────────────
// Normalize a QBCustomerStatement into the local Statement shape so the
// existing render path (aging tiles + ledger table + PDF export) works
// regardless of source. Aging is computed client-side from the QB
// invoices' dueDate / balance because the QB statement only returns
// gross totals.
function ageInDays(date: string, asOf: string): number {
  const d = new Date(date);
  const a = new Date(asOf);
  const ms = a.getTime() - d.getTime();
  return Math.floor(ms / 86_400_000);
}

function adaptQbStatementToLocal(
  qb: QBCustomerStatement,
  asOf: string,
  companyId: string,
): Statement {
  const lines: StatementLine[] = [];
  // Invoices → debit lines
  for (const inv of qb.invoices) {
    lines.push({
      id: `qb-inv-${inv.id}`,
      kind: 'INVOICE',
      date: inv.txnDate,
      ref: inv.docNumber || inv.id,
      description: `Invoice ${inv.docNumber || inv.id}`,
      debit: inv.totalAmount,
      credit: 0,
    });
  }
  // Receipts (grouped deposits) or raw payments → credit lines.
  const receipts = qb.receipts && qb.receipts.length > 0
    ? qb.receipts.map(r => ({
        id: r.id, txnDate: r.txnDate, totalAmount: r.totalAmount,
        ref: r.paymentRefNum || r.id, method: r.paymentMethod,
        currency: r.currency,
      }))
    : qb.payments.map(p => ({
        id: p.id, txnDate: p.txnDate, totalAmount: p.totalAmount,
        ref: p.paymentRefNum || p.id, method: p.paymentMethod,
        currency: p.currency,
      }));
  for (const r of receipts) {
    lines.push({
      id: `qb-pay-${r.id}`,
      kind: 'PAYMENT',
      date: r.txnDate,
      ref: r.ref,
      description: `Payment · ${r.method || 'QB'} · ${r.ref}`,
      debit: 0,
      credit: r.totalAmount,
    });
  }
  lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  // Aging — bucket by invoice age (from txnDate) on the open balance.
  const aging = { bucket_0_30: 0, bucket_31_60: 0, bucket_61_90: 0, bucket_90_plus: 0, total: 0 };
  for (const inv of qb.invoices) {
    const open = inv.balance;
    if (open <= 0.005) continue;
    const age = ageInDays(inv.txnDate, asOf);
    if (age <= 30) aging.bucket_0_30 += open;
    else if (age <= 60) aging.bucket_31_60 += open;
    else if (age <= 90) aging.bucket_61_90 += open;
    else aging.bucket_90_plus += open;
    aging.total += open;
  }
  return {
    kind: 'AR',
    counterpartyName: qb.customerName,
    companyId,
    asOf,
    lines,
    openingBalance: 0,
    closingBalance: qb.totals.outstandingBalance,
    aging,
  };
}

const StatementsV2: React.FC = () => {
  const { currentCompanyId } = useCompany();
  const companies = useCompanies();
  const toast = useToast();
  const qc = useQueryClient();
  const currentCompany = useMemo(
    () => companies.data?.find(c => c.id === currentCompanyId),
    [companies.data, currentCompanyId],
  );

  const [kind, setKind] = useState<StatementKind>('AR');
  const [counterpartyName, setCounterpartyName] = useState<string>('');
  const today = new Date().toISOString().slice(0, 10);
  const [asOf, setAsOf] = useState(today);
  const [qbSyncing, setQbSyncing] = useState(false);

  // ── Auto-detect EC4 → merge local + QuickBooks ────────────────────
  // EC4 uses QuickBooks as the source-of-truth for AR, but users also
  // record payments directly in V14 (manual OCR receipts that haven't
  // synced back to QB yet). Statements for EC4 must show BOTH so the
  // ledger matches reality. For every other company (GENRYO etc.)
  // we stay local — they don't have QB connected.
  //
  // EC4 detection is by company name (mirrors isEc4Company elsewhere
  // — avoids hardcoding a tenant id). AP statements always use local
  // because QB's vendor side has a different shape.
  const isEc4 = isEc4Company(currentCompany ? { name: currentCompany.name } : null);
  const useQbSource = kind === 'AR' && isEc4;

  const [qbStatus, setQbStatus] = useState<'unknown' | 'connected' | 'disconnected' | 'error'>('unknown');
  const [qbStatusError, setQbStatusError] = useState<string | null>(null);
  const [qbCustomers, setQbCustomers] = useState<QBCustomer[]>([]);
  const [qbStatement, setQbStatement] = useState<QBCustomerStatement | null>(null);
  const [qbLoading, setQbLoading] = useState(false);

  // Probe the QB connection on EC4 + AR. Uses the dedicated
  // qb-auth/status endpoint first (cheap + accurate), then loads the
  // customer list. Customer Balances uses fetchQBCustomers directly
  // and infers connection from its error; we split the two so the
  // connection signal is clean and a failing customer fetch doesn't
  // hide a working OAuth token.
  useEffect(() => {
    let cancelled = false;
    if (!useQbSource || !currentCompanyId || currentCompanyId === 'ALL') {
      setQbStatus('disconnected');
      setQbCustomers([]);
      setQbStatement(null);
      return;
    }
    setQbStatus('unknown');
    setQbStatusError(null);
    (async () => {
      try {
        const status = await getQBConnectionStatus(currentCompanyId);
        if (cancelled) return;
        if (!status.connected) {
          setQbStatus('disconnected');
          return;
        }
        // Connected — load customers. Force refresh so the singleton
        // cache from a different company's prior session doesn't leak.
        const list = await fetchQBCustomers(currentCompanyId, /* forceRefresh */ true);
        if (cancelled) return;
        list.sort((a, b) => a.displayName.localeCompare(b.displayName));
        setQbCustomers(list);
        setQbStatus('connected');
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error('[StatementsV2] QB connection probe failed:', err);
        if (msg.includes('not connected') || msg.includes('reconnect')) {
          setQbStatus('disconnected');
        } else {
          setQbStatus('error');
          setQbStatusError(msg);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [useQbSource, currentCompanyId]);

  // Fetch the QB statement when the user picks a customer (EC4 only).
  // Local statement is always fetched in parallel below so the merge
  // produces a complete picture.
  useEffect(() => {
    let cancelled = false;
    if (!useQbSource || qbStatus !== 'connected' || !counterpartyName || !currentCompanyId || currentCompanyId === 'ALL') {
      setQbStatement(null);
      return;
    }
    setQbLoading(true);
    (async () => {
      try {
        const result = await fetchCustomerStatement(
          currentCompanyId,
          counterpartyName,
          undefined,
          asOf,
        );
        if (cancelled) return;
        setQbStatement(result);
      } catch (err) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error('[StatementsV2] QB statement fetch failed:', err);
        setQbStatement(null);
        setQbStatusError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setQbLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [useQbSource, qbStatus, counterpartyName, asOf, currentCompanyId]);

  const counterparties = useCounterpartyBalances(kind);
  // Always fetch the local statement — for EC4 it's MERGED on top of
  // the QB statement; for everyone else it's the only source.
  const localStatement = useStatement({ kind, counterpartyName, asOf });

  // Build the effective Statement passed to the render. Three cases:
  //   1. Non-EC4 (or AP): local only — pass through.
  //   2. EC4 + QB connected + statement loaded: MERGE QB invoices/
  //      payments with local payments that haven't been pushed to QB
  //      yet (transaction.qbId === null). QB-side data is the trunk,
  //      local payments are added so freshly-recorded receipts show
  //      immediately even before the next qb-pull-payments sync.
  //   3. EC4 + QB error/disconnected: fall back to local + surface
  //      an info banner above the table.
  const statement = useMemo(() => {
    if (!useQbSource) return localStatement;
    const qbAdapted = qbStatement
      ? adaptQbStatementToLocal(qbStatement, asOf, currentCompanyId || 'ALL')
      : null;
    if (!qbAdapted) {
      // QB unavailable / not picked yet — degrade to local only.
      return localStatement;
    }
    // Merge: take QB lines as the base, append local payment lines
    // that aren't already mirrored in QB. We can't reliably dedupe
    // line-by-line without a shared id; the closest signal is the
    // `qbId` field on the local transaction, which is non-null
    // iff the payment was pulled FROM or pushed TO QB. Local
    // payments with qbId === null are the manual receipts that
    // haven't been QB-synced yet.
    const localLines = localStatement.data?.lines ?? [];
    const localOnlyPayments = localLines.filter(l =>
      l.kind === 'PAYMENT' && !l.id.includes('qb-pull-')
      // The local statement hook embeds the source in the line id —
      // 'qb-pull-' prefixes pulled-from-QB allocations. Filter those
      // out so we don't double-count after a pull.
    );
    const mergedLines: StatementLine[] = [...qbAdapted.lines, ...localOnlyPayments]
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    // Re-derive the closing balance from the merged ledger so the
    // running total + footer match what's actually displayed.
    const closingBalance = mergedLines.reduce((s, l) => s + l.debit - l.credit, 0);
    return {
      data: {
        ...qbAdapted,
        lines: mergedLines,
        closingBalance,
      } as Statement,
      isLoading: qbLoading || localStatement.isLoading,
      error: null,
    } as { data: Statement | null; isLoading: boolean; error: Error | null };
  }, [useQbSource, qbStatement, qbLoading, localStatement, asOf, currentCompanyId]);

  // Intersect QB customer list against the ERP customer book — the
  // raw QB book carries hundreds of customers (every account ever
  // sold to), but the user only wants to see the ones present in
  // this ERP install. Same pattern + name normaliser as
  // FinanceBalancesV2. Falls back to the full QB list when the ERP
  // hasn't loaded yet so the page is never empty.
  const erpCustomersQ = useCustomers();
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

  // Counterparty options shown in the dropdown — QB list (filtered
  // to ERP customers) for EC4, local list for everyone else.
  const counterpartyOptions = useMemo(() => {
    if (useQbSource && qbStatus === 'connected') {
      const filtered = erpNameSet.size === 0
        ? qbCustomers
        : qbCustomers.filter(c => erpNameSet.has(normalizeCustomerName(c.displayName)));
      return filtered.map(c => ({
        value: c.displayName,
        label: c.displayName + (c.balance ? ` · ${fmtMoney(c.balance)} open` : ''),
      }));
    }
    return (counterparties.data ?? []).map(c => ({
      value: c.name,
      label: `${c.name} · ${c.invoices} invoice${c.invoices === 1 ? '' : 's'} · ${fmtMoney(c.outstanding)}`,
    }));
  }, [useQbSource, qbStatus, qbCustomers, erpNameSet, counterparties.data]);

  // ── QuickBooks pull-sync ───────────────────────────────────────
  async function syncFromQb() {
    if (currentCompanyId === 'ALL') {
      toast.push({ kind: 'warning', title: 'Pick a specific company first' });
      return;
    }
    setQbSyncing(true);
    try {
      const res: any = await invokeEdgeFunction('qb-pull-payments', {
        companyId: currentCompanyId,
        // Pull the last 90 days by default — full history would take
        // longer and most users only care about current AR/AP.
        since: new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10),
      });
      if (res?.error) throw new Error(res.error);
      toast.push({
        kind: 'success',
        title: `QuickBooks sync · ${res.pulled} payment${res.pulled === 1 ? '' : 's'} pulled`,
        description: res.allocated > 0
          ? `${res.allocated} allocation${res.allocated === 1 ? '' : 's'} matched to invoices.`
          : res.pulled === 0
            ? 'Already up to date.'
            : 'No invoice matches found — payments saved as unallocated.',
      });
      // Refresh every view that reads transactions/balances.
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['ar_invoice_balances'] });
      qc.invalidateQueries({ queryKey: ['ap_supplier_invoice_balances'] });
      qc.invalidateQueries({ queryKey: ['statement'] });
      qc.invalidateQueries({ queryKey: ['counterparty_balances'] });
    } catch (e: any) {
      toast.push({
        kind: 'error',
        title: 'QuickBooks sync failed',
        description: (e?.message ?? String(e)).slice(0, 240),
      });
    } finally {
      setQbSyncing(false);
    }
  }

  // ── Email draft state ────────────────────────────────────────────
  // Same EmailDraft + sendEmail flow Customer Balances uses — routes
  // through the signed-in Outlook / Gmail account via emailService.
  interface EmailDraft {
    to: string;
    cc: string;
    subject: string;
    htmlBody: string;
    attachments: { name: string; contentBytes: string; contentType: string }[];
  }
  const [emailPreviewOpen, setEmailPreviewOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState<EmailDraft>({
    to: '', cc: '', subject: '', htmlBody: '', attachments: [],
  });
  const [sendingEmail, setSendingEmail] = useState(false);

  // ── PDF export ───────────────────────────────────────────────────
  // Builds the jsPDF document. Returned (instead of just `.save()`'d)
  // so the email-draft path can attach it as base64 without rebuilding.
  function buildStatementPdf(): { doc: jsPDF; filename: string } | null {
    const s = statement.data;
    if (!s || !s.counterpartyName) return null;
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const pageW = doc.internal.pageSize.getWidth();

    // Header
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(`${kind === 'AR' ? 'Customer' : 'Supplier'} Statement`, 40, 50);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`From ${currentCompany?.name ?? currentCompanyId}`, 40, 68);

    // Counterparty + as-of
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(s.counterpartyName, 40, 100);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`As of ${fmtDate(s.asOf)}`, 40, 116);

    // Aging buckets
    autoTable(doc, {
      startY: 140,
      head: [['0-30 days', '31-60 days', '61-90 days', '90+ days', 'Total outstanding']],
      body: [[
        fmtMoney(s.aging.bucket_0_30),
        fmtMoney(s.aging.bucket_31_60),
        fmtMoney(s.aging.bucket_61_90),
        fmtMoney(s.aging.bucket_90_plus),
        fmtMoney(s.aging.total),
      ]],
      theme: 'grid',
      headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontSize: 9 },
      bodyStyles:  { fontSize: 9 },
      styles: { halign: 'right' },
      columnStyles: { 4: { fontStyle: 'bold' } },
    });

    // Line items
    let running = 0;
    const body = s.lines.map(l => {
      running += l.debit - l.credit;
      return [
        fmtDate(l.date),
        l.kind === 'INVOICE' ? `Invoice ${l.ref}` : `Payment · ${l.ref}`,
        l.debit > 0 ? fmtMoney(l.debit) : '',
        l.credit > 0 ? fmtMoney(l.credit) : '',
        fmtMoney(running),
      ];
    });

    const last = (doc as any).lastAutoTable?.finalY ?? 200;
    autoTable(doc, {
      startY: last + 20,
      head: [['Date', 'Description', 'Debit', 'Credit', 'Balance']],
      body,
      foot: [['', '', '', `Closing balance`, fmtMoney(s.closingBalance)]],
      theme: 'striped',
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontSize: 9 },
      bodyStyles:  { fontSize: 9 },
      footStyles:  { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 70 },
        2: { halign: 'right', cellWidth: 80 },
        3: { halign: 'right', cellWidth: 80 },
        4: { halign: 'right', cellWidth: 90 },
      },
    });

    // Footer
    const pageH = doc.internal.pageSize.getHeight();
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Generated ${new Date().toLocaleString()} · ${currentCompany?.name ?? ''}`, 40, pageH - 30);

    const safe = s.counterpartyName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const filename = `statement-${kind.toLowerCase()}-${safe}-${asOf}.pdf`;
    return { doc, filename };
  }

  function exportPdf() {
    const built = buildStatementPdf();
    if (!built) return;
    built.doc.save(built.filename);
  }

  // ── XLSX export ──────────────────────────────────────────────────
  // Mirrors the FinanceBalancesV2 layout: title rows + aging row +
  // header + line items + totals. Column widths matched to PDF so
  // the artifact reads the same in either format.
  function exportXlsx() {
    const s = statement.data;
    if (!s || !s.counterpartyName) return;
    const titleRows = [
      [`${kind === 'AR' ? 'Customer' : 'Supplier'} Statement`],
      [s.counterpartyName],
      [`From ${currentCompany?.name ?? currentCompanyId} · As of ${fmtDate(s.asOf)}`],
      [],
    ];
    const agingRows = [
      ['0-30 days', '31-60 days', '61-90 days', '90+ days', 'Total outstanding'],
      [
        s.aging.bucket_0_30, s.aging.bucket_31_60, s.aging.bucket_61_90,
        s.aging.bucket_90_plus, s.aging.total,
      ],
      [],
    ];
    const header = ['Date', 'Description', 'Debit', 'Credit', 'Balance'];
    let running = 0;
    const body = s.lines.map(l => {
      running += l.debit - l.credit;
      return [
        l.date,
        l.kind === 'INVOICE' ? `Invoice ${l.ref}` : `Payment · ${l.ref}`,
        l.debit > 0 ? l.debit : '',
        l.credit > 0 ? l.credit : '',
        running,
      ];
    });
    const totals = ['', 'Closing balance', '', '', s.closingBalance];
    const aoa = [...titleRows, ...agingRows, header, ...body, totals];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      { wch: 12 }, { wch: 36 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Statement');
    const safe = s.counterpartyName.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
    const filename = `statement-${kind.toLowerCase()}-${safe}-${asOf}.xlsx`;
    XLSX.writeFile(wb, filename);
    toast.push({ kind: 'success', title: 'Statement downloaded', description: filename });
  }

  // ── Open email preview modal with the PDF pre-attached ──────────
  const openEmailPreview = useCallback(() => {
    const built = buildStatementPdf();
    if (!built) return;
    const s = statement.data!;
    const base64 = built.doc.output('datauristring').split(',')[1];

    // Pull a default recipient from the QB customer record when in
    // EC4 + QB-connected mode (primaryEmail is the QB-stored email).
    const qbMatch = qbCustomers.find(c => c.displayName === s.counterpartyName);
    const toAddress = qbMatch?.primaryEmail ?? '';

    const periodLabel = `As of ${fmtDate(s.asOf)}`;
    const body =
      `Dear ${s.counterpartyName},\n\n` +
      `Please find attached your account statement.\n\n` +
      `${periodLabel}\n` +
      `Closing balance: ${fmtMoney(s.closingBalance)}\n\n` +
      `If you have any questions about your account, please don't hesitate to reach out.\n\n` +
      `Best regards`;
    setEmailDraft({
      to: toAddress,
      cc: '',
      subject: `${kind === 'AR' ? 'Customer' : 'Supplier'} Statement — ${s.counterpartyName} (${periodLabel})`,
      htmlBody: body,
      attachments: [{
        name: built.filename,
        contentBytes: base64,
        contentType: 'application/pdf',
      }],
    });
    setEmailPreviewOpen(true);
  }, [statement.data, kind, qbCustomers, currentCompany, currentCompanyId, asOf]);

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
      const htmlBody =
        `<div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto;">` +
        `<h2 style="color: #14b8a6; margin-bottom: 8px;">${emailDraft.subject}</h2>` +
        `<div style="white-space: pre-wrap; line-height: 1.6; color:#0f172a;">${escaped}</div>` +
        `</div>`;
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

  return (
    <div className="bento-scope p-4 space-y-4" style={{ maxWidth: '1280px' }}>
      {/* HEADER */}
      <div className="flex items-end gap-4 flex-wrap pb-2">
        <div className="flex items-center gap-3">
          <span className="block w-1 h-9 rounded-full" style={{ background: 'var(--b-teal-2)' }} />
          <div>
            <h1 className="b-display font-semibold leading-none"
                style={{ color: 'var(--b-text)', fontSize: '32px', fontVariationSettings: "'opsz' 64, 'wght' 600", letterSpacing: '-0.02em' }}>
              Statements
            </h1>
            <p className="text-[13px] mt-1.5" style={{ color: 'var(--b-text-mute)' }}>
              AR (customer) and AP (supplier) statements with aging + PDF export. Reads the unified transactions ledger.
            </p>
          </div>
        </div>
      </div>

      {/* CONTROLS — kind toggle + counterparty picker + as-of + export */}
      <div className="rounded-[14px] border p-4" style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)' }}>
        <div className="flex flex-wrap items-end gap-3">
          {/* AR / AP toggle */}
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.14em] mb-1.5" style={{ color: 'var(--b-text-mute)' }}>Statement type</div>
            <div className="flex items-center gap-1 p-1 rounded-full" style={{ background: 'var(--b-surface-2)', border: '1px solid var(--b-line)' }}>
              {(['AR', 'AP'] as StatementKind[]).map(k => (
                <button
                  key={k}
                  onClick={() => { setKind(k); setCounterpartyName(''); }}
                  className="px-3 py-1 rounded-full text-[12px] font-medium transition-colors"
                  style={{
                    background: kind === k ? 'var(--b-teal-2)' : 'transparent',
                    color: kind === k ? 'white' : 'var(--b-text-mute)',
                  }}
                >
                  {k === 'AR' ? 'AR · Customer' : 'AP · Supplier'}
                </button>
              ))}
            </div>
          </div>

          {/* Source badge — auto-merged for EC4, local-only elsewhere.
              No user toggle; the choice is driven by company. */}
          {useQbSource && (
            <div>
              <div className="text-[10.5px] uppercase tracking-[0.14em] mb-1.5" style={{ color: 'var(--b-text-mute)' }}>Source</div>
              <div
                title={
                  qbStatus === 'connected'
                    ? 'EC4 → merging QuickBooks invoices/payments with local ERP payments.'
                    : qbStatus === 'disconnected'
                      ? 'QuickBooks not connected for this company. Showing local payments only.'
                      : qbStatus === 'error'
                        ? `QuickBooks error: ${qbStatusError ?? 'unknown'}. Showing local payments only.`
                        : 'Checking QuickBooks connection…'
                }
                className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-full"
                style={{
                  background: 'var(--b-surface-2)',
                  border: '1px solid var(--b-line)',
                  color: qbStatus === 'connected' ? 'var(--b-emerald)'
                    : qbStatus === 'error' ? 'var(--b-rose)'
                    : 'var(--b-text-mute)',
                }}
              >
                <Cloud size={11} />
                {qbStatus === 'connected' ? 'QuickBooks + Local'
                  : qbStatus === 'unknown' ? 'Checking QB…'
                  : qbStatus === 'disconnected' ? 'QB disconnected'
                  : 'QB error'}
                <Database size={11} />
              </div>
            </div>
          )}

          {/* Counterparty picker */}
          <div className="flex-1 min-w-[280px]">
            <div className="text-[10.5px] uppercase tracking-[0.14em] mb-1.5" style={{ color: 'var(--b-text-mute)' }}>
              {kind === 'AR' ? 'Customer' : 'Supplier'}
            </div>
            <div className="relative">
              <select
                value={counterpartyName}
                onChange={e => setCounterpartyName(e.target.value)}
                disabled={useQbSource && qbStatus === 'unknown'}
                className="block w-full appearance-none rounded-[10px] px-3 py-2 pr-8 text-[13px]"
                style={{ background: 'var(--b-surface-2)', border: '1px solid var(--b-line)', color: 'var(--b-text)' }}
              >
                <option value="">
                  {useQbSource && qbStatus === 'unknown'
                    ? 'Loading QB customers…'
                    : '— pick one —'}
                </option>
                {counterpartyOptions.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--b-text-mute)' }} />
            </div>
          </div>

          {/* As-of date */}
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.14em] mb-1.5" style={{ color: 'var(--b-text-mute)' }}>As of</div>
            <input
              type="date"
              value={asOf}
              onChange={e => setAsOf(e.target.value)}
              className="rounded-[10px] px-3 py-2 text-[13px]"
              style={{ background: 'var(--b-surface-2)', border: '1px solid var(--b-line)', color: 'var(--b-text)' }}
            />
          </div>

          {/* QB pull-sync button removed (v14.57). The Statements
              screen auto-fetches QB live for EC4 via the merge path
              in `statement` useMemo, so the manual pull was just a
              redundant button. The underlying syncFromQb() handler
              is kept below so we can re-expose it from a Settings /
              admin panel later — its job (mirror QB payments INTO
              the local transactions table) still matters for the
              Receivables list, drawer history, and AR aging view. */}

          {/* Exports — PDF / XLSX / Email. Mirrors the Customer
              Balances action cluster so finance ops have one mental
              model across the two screens. All three are disabled
              when no statement is loaded. */}
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={exportPdf}
              disabled={!statement.data || !counterpartyName}
              title="Download statement as PDF"
              className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'var(--b-surface-2)', color: 'var(--b-text-soft)', border: '1px solid var(--b-line)' }}
            >
              <Download size={12} /> Download PDF
            </button>
            <button
              onClick={exportXlsx}
              disabled={!statement.data || !counterpartyName}
              title="Download statement as Excel spreadsheet"
              className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'var(--b-surface-2)', color: 'var(--b-text-soft)', border: '1px solid var(--b-line)' }}
            >
              <FileSpreadsheet size={12} /> Download XLSX
            </button>
            <button
              onClick={openEmailPreview}
              disabled={!statement.data || !counterpartyName}
              title="Email statement to the customer (PDF attached)"
              className="b-display flex items-center gap-1.5 text-[12.5px] font-semibold px-4 py-2 rounded-full disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              style={{ background: 'var(--b-teal-2)', color: 'white' }}
            >
              <Mail size={13} /> Email
            </button>
          </div>
        </div>
      </div>

      {/* AGING + LEDGER */}
      {!counterpartyName ? (
        <div className="rounded-[14px] border-2 border-dashed p-10 text-center" style={{ borderColor: 'var(--b-line)', background: 'var(--b-surface-2)' }}>
          <FileText size={32} className="mx-auto mb-3" style={{ color: 'var(--b-text-faint)' }} />
          <div className="b-display text-[16px] font-semibold" style={{ color: 'var(--b-text-soft)' }}>Pick a {kind === 'AR' ? 'customer' : 'supplier'}</div>
          <div className="text-[12.5px] mt-1" style={{ color: 'var(--b-text-mute)' }}>The aging buckets and ledger will render here.</div>
        </div>
      ) : statement.isLoading ? (
        <div className="rounded-[14px] border p-6" style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)' }}>
          <div className="text-[13px]" style={{ color: 'var(--b-text-mute)' }}>Loading statement…</div>
        </div>
      ) : statement.data ? (
        <>
          {/* Aging strip */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {([
              { label: '0–30 days', value: statement.data.aging.bucket_0_30, color: 'var(--b-emerald)' },
              { label: '31–60 days', value: statement.data.aging.bucket_31_60, color: 'var(--b-teal-2)' },
              { label: '61–90 days', value: statement.data.aging.bucket_61_90, color: 'var(--b-gold)' },
              { label: '90+ days', value: statement.data.aging.bucket_90_plus, color: 'var(--b-rose)' },
              { label: 'Total outstanding', value: statement.data.aging.total, color: 'var(--b-text)' },
            ]).map(b => (
              <div key={b.label} className="rounded-[14px] border p-4" style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)' }}>
                <div className="text-[10.5px] uppercase tracking-[0.14em] mb-2" style={{ color: 'var(--b-text-mute)' }}>{b.label}</div>
                <div className="b-display font-semibold tabular-nums" style={{ color: b.color, fontSize: '22px', letterSpacing: '-0.02em' }}>
                  {fmtMoney(b.value)}
                </div>
              </div>
            ))}
          </div>

          {/* Ledger table */}
          <div className="rounded-[14px] border overflow-hidden" style={{ background: 'var(--b-surface)', borderColor: 'var(--b-line)' }}>
            <div className="flex items-baseline gap-2 px-5 py-3.5 border-b" style={{ borderColor: 'var(--b-line-soft)' }}>
              <h2 className="b-display text-[15px] font-semibold" style={{ color: 'var(--b-text)' }}>
                {statement.data.counterpartyName}
              </h2>
              <span className="text-[11.5px]" style={{ color: 'var(--b-text-mute)' }}>
                {statement.data.lines.length} line{statement.data.lines.length === 1 ? '' : 's'} · as of {fmtDate(statement.data.asOf)}
              </span>
              <span className="ml-auto text-[12.5px] b-mono" style={{ color: 'var(--b-text-soft)' }}>
                Closing balance: <strong className="ml-1" style={{ color: 'var(--b-text)' }}>{fmtMoney(statement.data.closingBalance)}</strong>
              </span>
            </div>
            {statement.data.lines.length === 0 ? (
              <div className="p-8 text-center text-[13px]" style={{ color: 'var(--b-text-mute)' }}>
                No invoices or payments for this {kind === 'AR' ? 'customer' : 'supplier'} in scope.
              </div>
            ) : (
              <div>
                <div className="grid items-center gap-3 px-5 py-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] border-b"
                     style={{ gridTemplateColumns: '90px 1fr 110px 110px 130px', borderColor: 'var(--b-line-soft)', color: 'var(--b-text-mute)' }}>
                  <span>Date</span>
                  <span>Description</span>
                  <span className="text-right">Debit</span>
                  <span className="text-right">Credit</span>
                  <span className="text-right">Balance</span>
                </div>
                {(() => {
                  let running = 0;
                  return statement.data.lines.map(l => {
                    running += l.debit - l.credit;
                    return (
                      <div
                        key={l.id}
                        className="grid items-center gap-3 px-5 py-2 text-[12.5px] border-b"
                        style={{
                          gridTemplateColumns: '90px 1fr 110px 110px 130px',
                          borderColor: 'var(--b-line-soft)',
                          color: 'var(--b-text)',
                        }}
                      >
                        <span className="b-mono text-[11.5px]" style={{ color: 'var(--b-text-mute)' }}>{fmtDate(l.date)}</span>
                        <span>
                          {l.kind === 'INVOICE'
                            ? <span><span className="font-semibold">Invoice</span> {l.ref}</span>
                            : <span style={{ color: 'var(--b-emerald)' }}>{l.description}</span>}
                        </span>
                        <span className="text-right b-mono tabular-nums">{l.debit > 0 ? fmtMoney(l.debit) : '—'}</span>
                        <span className="text-right b-mono tabular-nums" style={{ color: l.credit > 0 ? 'var(--b-emerald)' : 'var(--b-text-faint)' }}>
                          {l.credit > 0 ? fmtMoney(l.credit) : '—'}
                        </span>
                        <span className="text-right b-mono tabular-nums font-semibold">{fmtMoney(running)}</span>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>
        </>
      ) : null}

      {/* ── Email preview modal ───────────────────────────────────────
          Mirrors the layout/behaviour of the Customer Balances email
          modal so finance ops see the same UX in both places. PDF is
          attached automatically; the user reviews the To / CC /
          Subject / Body before sending via the signed-in Outlook /
          Gmail account (emailService picks the provider). */}
      <Dialog.Root open={emailPreviewOpen} onOpenChange={setEmailPreviewOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-[7%] -translate-x-1/2 z-50 w-[min(96vw,720px)] rounded-md border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_16px_48px_rgba(0,0,0,0.6)] flex flex-col max-h-[86vh]">
            <div className="px-5 py-4 border-b border-[#1f1f1f] flex items-start gap-3">
              <div className="p-1.5 rounded-md bg-teal-600/10 text-teal-300">
                <Mail size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <Dialog.Title className="text-[14px] font-semibold text-slate-100">
                  Email {kind === 'AR' ? 'customer' : 'supplier'} statement
                </Dialog.Title>
                <Dialog.Description className="text-[12px] text-slate-500 mt-0.5">
                  Review and send — routes through your signed-in Outlook / Gmail. PDF is attached.
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
              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium block mb-1">To</label>
                <input
                  type="text"
                  value={emailDraft.to}
                  onChange={e => setEmailDraft(d => ({ ...d, to: e.target.value }))}
                  placeholder="recipient@example.com"
                  className="w-full px-2.5 py-1.5 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] rounded-md text-slate-200 focus:outline-none focus:border-teal-500"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium block mb-1">CC</label>
                <input
                  type="text"
                  value={emailDraft.cc}
                  onChange={e => setEmailDraft(d => ({ ...d, cc: e.target.value }))}
                  placeholder="Optional — comma or semicolon separated"
                  className="w-full px-2.5 py-1.5 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] rounded-md text-slate-200 focus:outline-none focus:border-teal-500"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium block mb-1">Subject</label>
                <input
                  type="text"
                  value={emailDraft.subject}
                  onChange={e => setEmailDraft(d => ({ ...d, subject: e.target.value }))}
                  className="w-full px-2.5 py-1.5 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] rounded-md text-slate-200 focus:outline-none focus:border-teal-500"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-medium block mb-1">Message</label>
                <textarea
                  value={emailDraft.htmlBody}
                  onChange={e => setEmailDraft(d => ({ ...d, htmlBody: e.target.value }))}
                  rows={10}
                  className="w-full px-2.5 py-1.5 text-[12.5px] bg-[#0f0f0f] border border-[#1f1f1f] rounded-md text-slate-200 focus:outline-none focus:border-teal-500 resize-y"
                />
              </div>
              {emailDraft.attachments.length > 0 && (
                <div className="flex items-center gap-2 text-[11.5px] text-slate-400 border border-[#1f1f1f] rounded-md bg-[#0f0f0f] px-3 py-2">
                  <FileText size={12} className="text-teal-300" />
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
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors bg-teal-600 text-white hover:bg-teal-500 disabled:bg-[#141414] disabled:text-slate-600"
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
    </div>
  );
};

export default StatementsV2;
