// AI Sales Agent — proposal/cover-letter PDF generator.
//
// Renders a clean B2B proposal letter: sender identity in the header,
// recipient block, proposal body (AI-drafted), optional line-items
// table, totals, signature. Kept deliberately simple vs. the proforma
// layout — a sales proposal is a letter, not an invoice.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { PdfCompany } from './types';
import type { AiSalesProposal, AiAgentIdentity } from '../../../types';

export interface ProposalPdfCtx {
  company: PdfCompany | undefined;
  identity: AiAgentIdentity | undefined;
  logoUrl: string | null;
}

const BRAND = '#F57F25';
const INK = '#1f2937';
const MUTED = '#6b7280';

export function generateProposalPdf(proposal: AiSalesProposal, ctx: ProposalPdfCtx): jsPDF {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;

  if (ctx.logoUrl) {
    try { doc.addImage(ctx.logoUrl, 'PNG', margin, 12, 28, 12); } catch { /* ignore */ }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(BRAND);
  doc.text(ctx.company?.name ?? 'XS-ERP', pageW - margin, 18, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  const companyLines = [
    ctx.company?.address,
    [ctx.company?.city, ctx.company?.state, ctx.company?.zip].filter(Boolean).join(', '),
    ctx.company?.country,
    ctx.company?.phone,
  ].filter(Boolean) as string[];
  companyLines.forEach((line, i) => {
    doc.text(line, pageW - margin, 23 + i * 4, { align: 'right' });
  });

  doc.setDrawColor(BRAND);
  doc.setLineWidth(0.6);
  doc.line(margin, 42, pageW - margin, 42);

  doc.setFontSize(10);
  doc.setTextColor(INK);
  doc.setFont('helvetica', 'bold');
  doc.text('Proposal', margin, 52);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(MUTED);
  doc.text(new Date(proposal.createdAt || Date.now()).toLocaleDateString(), pageW - margin, 52, { align: 'right' });

  doc.setTextColor(INK);
  doc.setFont('helvetica', 'bold');
  doc.text('To:', margin, 62);
  doc.setFont('helvetica', 'normal');
  const toLines = [
    proposal.recipientName,
    proposal.recipientEmail ?? undefined,
    proposal.recipientPhone ?? undefined,
  ].filter(Boolean) as string[];
  toLines.forEach((line, i) => {
    doc.text(line, margin + 10, 62 + i * 5);
  });

  let cursorY = 62 + toLines.length * 5 + 10;

  if (proposal.subject) {
    doc.setFont('helvetica', 'bold');
    doc.text(`Re: ${proposal.subject}`, margin, cursorY);
    cursorY += 8;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(INK);
  const body = proposal.body ?? '';
  const wrapped = doc.splitTextToSize(body, pageW - margin * 2);
  doc.text(wrapped, margin, cursorY);
  cursorY += wrapped.length * 5 + 6;

  const items = proposal.items ?? [];
  if (items.length > 0) {
    autoTable(doc, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      head: [['Product', 'Description', 'Qty', 'Unit', 'Total']],
      body: items.map(it => [
        it.productName,
        it.customerDescription ?? '',
        it.quantity != null ? String(it.quantity) : '',
        it.unitPrice != null ? `${proposal.currency ?? 'USD'} ${it.unitPrice.toFixed(2)}` : '',
        it.total != null ? `${proposal.currency ?? 'USD'} ${it.total.toFixed(2)}` : '',
      ]),
      headStyles: { fillColor: BRAND, textColor: '#ffffff', fontSize: 9 },
      bodyStyles: { fontSize: 9, textColor: INK },
      alternateRowStyles: { fillColor: '#fafafa' },
    });
    // @ts-expect-error — lastAutoTable injected by jspdf-autotable plugin
    cursorY = (doc.lastAutoTable?.finalY ?? cursorY) + 6;

    if (proposal.totalAmount != null) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(
        `Total: ${proposal.currency ?? 'USD'} ${proposal.totalAmount.toFixed(2)}`,
        pageW - margin,
        cursorY,
        { align: 'right' },
      );
      cursorY += 10;
    }
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(INK);
  cursorY += 6;
  doc.text('Best regards,', margin, cursorY);
  cursorY += 6;
  doc.setFont('helvetica', 'bold');
  doc.text(ctx.identity?.displayName ?? 'Sales Agent', margin, cursorY);
  if (ctx.identity?.emailAddress) {
    cursorY += 5;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(MUTED);
    doc.text(ctx.identity.emailAddress, margin, cursorY);
  }
  if (ctx.identity?.signature) {
    cursorY += 6;
    doc.setTextColor(MUTED);
    const sig = doc.splitTextToSize(ctx.identity.signature, pageW - margin * 2);
    doc.text(sig, margin, cursorY);
  }

  return doc;
}
