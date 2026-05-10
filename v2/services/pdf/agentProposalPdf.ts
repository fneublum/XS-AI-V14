// Agent Sales Order — supplier proposal PDF.
//
// Mirrors generateAgentOfferPdf for the header layout, party blocks
// and items table, then layers in the localized labels + intro /
// closing paragraphs that come from generateProposalLabels (Gemini).
// When `labels` is empty we fall back to English. The buyer-facing
// description (customerDescription) is shown beneath each line's
// canonical description when present.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { AgentOrderRow } from '../../queries/useAgentSalesOrders';
import type { AgentPartyDetails } from './agentOfferPdf';
import type { ProposalLabels } from '../agentTranslation';

const BRAND = '#F57F25';
const INK = '#1f2937';
const MUTED = '#6b7280';

export interface AgentProposalPdfInputs {
  order: AgentOrderRow;
  /** PI / proposal number — e.g. PROP-002438. */
  docNumber: string;
  /** ISO date for the document. */
  docDate: string;
  /** Optional resolved seller details (full address). */
  seller?: AgentPartyDetails | null;
  /** Optional resolved buyer details (full address). */
  buyer?: AgentPartyDetails | null;
  /** Resolved payment-terms description (preferred over the code). */
  paymentTermsLabel?: string | null;
  /** Resolved POD name (preferred over the code). */
  podLabel?: string | null;
  /** Localized labels + intro/closing in buyer's language. */
  labels?: ProposalLabels | null;
  /** Optional seller logo data URL (rendered top-left). */
  logoUrl?: string | null;
}

const fmt = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

function joinNonEmpty(parts: Array<string | null | undefined>, sep = ', '): string {
  return parts.map(p => (p ?? '').trim()).filter(Boolean).join(sep);
}

function partyLines(name: string, p?: AgentPartyDetails | null): string[] {
  const lines = [name];
  if (!p) return lines;
  if (p.location)               lines.push(p.location);
  const cityLine = joinNonEmpty([p.city, p.state, p.zip], ', ');
  if (cityLine)                 lines.push(cityLine);
  if (p.country)                lines.push(p.country);
  if (p.taxId)                  lines.push(`Tax ID: ${p.taxId}`);
  if (p.contactPerson)          lines.push(`Attn: ${p.contactPerson}`);
  const contact = joinNonEmpty([p.email, p.phone], ' · ');
  if (contact)                  lines.push(contact);
  return lines;
}

const L = (labels: ProposalLabels | null | undefined, key: keyof ProposalLabels, fallback: string): string => {
  const v = labels?.[key];
  return (typeof v === 'string' && v.trim()) ? v.trim() : fallback;
};

export function generateAgentProposalPdf(input: AgentProposalPdfInputs): jsPDF {
  const { order, docNumber, docDate, seller, buyer,
          paymentTermsLabel, podLabel, labels, logoUrl } = input;
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const title = L(labels, 'title', 'COMMERCIAL PROPOSAL');

  // Optional seller logo on the left, brand name overlaid below it.
  if (logoUrl) {
    try { doc.addImage(logoUrl, 'PNG', margin, 12, 22, 22); } catch { /* non-fatal */ }
  }
  const sellerNameX = logoUrl ? margin + 26 : margin;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(BRAND);
  doc.text(order.sellerName, sellerNameX, 20);

  // Seller address block.
  const sellerLines = partyLines(order.sellerName, seller).slice(1);
  if (sellerLines.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(MUTED);
    let sy = 25;
    for (const line of sellerLines) { doc.text(line, sellerNameX, sy); sy += 4; }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(INK);
  doc.text(title, pageW - margin, 20, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(MUTED);
  doc.text(`No.  ${docNumber}`, pageW - margin, 27, { align: 'right' });
  doc.text(`${L(labels, 'labelDate', 'Date')}  ${docDate}`, pageW - margin, 32, { align: 'right' });

  const sellerBlockBottom = 25 + Math.max(0, sellerLines.length) * 4;
  const ruleY = Math.max(42, sellerBlockBottom + 2);

  doc.setDrawColor(BRAND);
  doc.setLineWidth(0.6);
  doc.line(margin, ruleY, pageW - margin, ruleY);

  // Optional intro paragraph in buyer's language, sits between the
  // rule and the BUYER block.
  let cursorY = ruleY + 6;
  const intro = (labels?.intro ?? '').trim();
  if (intro) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(INK);
    const wrapped = doc.splitTextToSize(intro, pageW - margin * 2);
    doc.text(wrapped, margin, cursorY);
    cursorY += wrapped.length * 4.5 + 4;
  }

  // BUYER block (left) + TERMS block (right).
  const buyerY0 = cursorY;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(INK);
  doc.text(L(labels, 'labelBuyer', 'BUYER'), margin, buyerY0);

  const buyerLines = partyLines(order.customerName, buyer);
  let by = buyerY0 + 6;
  for (const line of buyerLines) {
    if (line === order.customerName) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(INK);
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(MUTED);
    }
    doc.text(line, margin, by);
    by += line === order.customerName ? 5 : 4;
  }

  const termsX = pageW - margin - 80;
  const termsW = pageW - margin - termsX;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(INK);
  doc.text('TERMS', termsX, buyerY0);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  let ty = buyerY0 + 6;
  const termsLine = (label: string, value: string | null | undefined) => {
    if (!value) return;
    const wrapped = doc.splitTextToSize(`${label} ${value}`, termsW);
    doc.text(wrapped, termsX, ty);
    ty += (wrapped.length || 1) * 4 + 1;
  };
  termsLine(`${L(labels, 'labelIncoterm', 'Incoterm')}:`, order.incoterm ?? '—');
  termsLine(`${L(labels, 'labelPayment',  'Payment')}:`,
            paymentTermsLabel ?? order.paymentTerms ?? '—');
  termsLine('POD:', podLabel ?? order.pod);
  termsLine('Delivery:', order.deliveryDate);

  const tableStartY = Math.max(by + 4, ty + 4);

  // Items table — uses customerDescription beneath description when set.
  autoTable(doc, {
    startY: tableStartY,
    margin: { left: margin, right: margin },
    head: [[
      L(labels, 'labelDescription', 'Description'),
      L(labels, 'labelQty',         'Qty'),
      'Unit',
      L(labels, 'labelUnitPrice',   'Unit price'),
      L(labels, 'labelAmount',      'Amount'),
    ]],
    body: order.items.map(it => {
      const desc = it.description || it.productName || '—';
      const trans = (it.customerDescription ?? '').trim();
      return [
        trans ? `${desc}\n${trans}` : desc,
        (it.quantity ?? 0).toLocaleString('en-US'),
        it.unit ?? 'Lbs',
        fmt(it.unitPrice ?? 0),
        fmt(it.total ?? ((it.quantity ?? 0) * (it.unitPrice ?? 0))),
      ];
    }),
    headStyles: { fillColor: BRAND, textColor: '#ffffff', fontSize: 9, halign: 'center' },
    bodyStyles: { fontSize: 9, textColor: INK, valign: 'top' },
    columnStyles: {
      0: { halign: 'left' },
      1: { halign: 'center' },
      2: { halign: 'center' },
      3: { halign: 'center' },
      4: { halign: 'center', fontStyle: 'bold' },
    },
  });

  // @ts-expect-error injected by jspdf-autotable
  let y: number = doc.lastAutoTable?.finalY ?? tableStartY + 20;
  y += 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(INK);
  doc.text(`${L(labels, 'labelTotal', 'Total')}: ${fmt(order.orderTotal)}`,
           pageW - margin, y, { align: 'right' });
  y += 10;

  // Validity bar — small muted strip under the totals.
  const validityValue = (labels?.validityValue ?? '30 days from the date of this proposal').trim();
  doc.setFillColor('#fff7ed');
  doc.setDrawColor(BRAND);
  doc.rect(margin, y - 4, pageW - margin * 2, 8, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(BRAND);
  doc.text(`${L(labels, 'labelValidity', 'Validity')}: `, margin + 2, y + 1);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(INK);
  const validityLabel = `${L(labels, 'labelValidity', 'Validity')}: `;
  const validityW = doc.getTextWidth(validityLabel);
  doc.text(validityValue, margin + 2 + validityW, y + 1);
  y += 12;

  // Closing paragraph in buyer's language.
  const closing = (labels?.closing ?? '').trim();
  if (closing) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(INK);
    const wrapped = doc.splitTextToSize(closing, pageW - margin * 2);
    doc.text(wrapped, margin, y);
    y += wrapped.length * 4.5 + 4;
  }

  // Footer.
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  doc.text(
    `${order.sellerName} · ${docNumber} · ${docDate}`,
    margin,
    pageH - 8,
  );

  return doc;
}
