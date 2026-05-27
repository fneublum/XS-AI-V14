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

import React, { useMemo, useState } from 'react';
import { FileText, Download, ChevronDown, RefreshCw } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useStatement, useCounterpartyBalances, type StatementKind } from '../queries/useStatement';
import { useCompany } from '../providers/CompanyProvider';
import { useCompanies } from '../queries/useCompanies';
import { useToast } from '../primitives/Toast';
import { invokeEdgeFunction } from '../../services/edgeAuth';
import { useQueryClient } from '@tanstack/react-query';

function fmtMoney(n: number, c: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(n);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: '2-digit' }); }
  catch { return d; }
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

  const counterparties = useCounterpartyBalances(kind);
  const statement = useStatement({ kind, counterpartyName, asOf });

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

  // ── PDF export ───────────────────────────────────────────────────
  function exportPdf() {
    const s = statement.data;
    if (!s || !s.counterpartyName) return;
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
    doc.save(`statement-${kind.toLowerCase()}-${safe}-${asOf}.pdf`);
  }

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

          {/* Counterparty picker */}
          <div className="flex-1 min-w-[280px]">
            <div className="text-[10.5px] uppercase tracking-[0.14em] mb-1.5" style={{ color: 'var(--b-text-mute)' }}>
              {kind === 'AR' ? 'Customer' : 'Supplier'}
            </div>
            <div className="relative">
              <select
                value={counterpartyName}
                onChange={e => setCounterpartyName(e.target.value)}
                className="block w-full appearance-none rounded-[10px] px-3 py-2 pr-8 text-[13px]"
                style={{ background: 'var(--b-surface-2)', border: '1px solid var(--b-line)', color: 'var(--b-text)' }}
              >
                <option value="">— pick one —</option>
                {(counterparties.data ?? []).map(c => (
                  <option key={c.name} value={c.name}>
                    {c.name} · {c.invoices} invoice{c.invoices === 1 ? '' : 's'} · {fmtMoney(c.outstanding)}
                  </option>
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

          {/* QB pull-sync */}
          <button
            onClick={syncFromQb}
            disabled={qbSyncing || currentCompanyId === 'ALL'}
            title="Pull payments from QuickBooks for the current company"
            className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--b-surface-2)', color: 'var(--b-text-soft)', border: '1px solid var(--b-line)' }}
          >
            <RefreshCw size={12} className={qbSyncing ? 'animate-spin' : ''} />
            {qbSyncing ? 'Syncing…' : 'Pull from QuickBooks'}
          </button>

          {/* Export */}
          <button
            onClick={exportPdf}
            disabled={!statement.data || !counterpartyName}
            className="b-display flex items-center gap-1.5 text-[12.5px] font-semibold px-4 py-2 rounded-full disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            style={{ background: 'var(--b-teal-2)', color: 'white' }}
          >
            <Download size={13} /> Export PDF
          </button>
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
    </div>
  );
};

export default StatementsV2;
