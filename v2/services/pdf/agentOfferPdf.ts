// Agent offer / proforma PDF.
//
// A single generator that renders two close cousins:
//   - Offer    — our first offer to the customer (pre-accept)
//   - Proforma — the sales contract once the customer accepts
// Both carry the same header / line items / totals layout; only the
// document title and reference number prefix differ.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { AgentOrderRow } from '../../queries/useAgentSalesOrders';

const BRAND = '#F57F25';
const INK = '#1f2937';
const MUTED = '#6b7280';

export interface AgentPartyDetails {
  name?: string | null;
  taxId?: string | null;
  contactPerson?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
}

export interface AgentOfferPdfInputs {
  order: AgentOrderRow;
  /** 'OFFER' or 'PROFORMA'. */
  kind: 'OFFER' | 'PROFORMA';
  /** Document number — e.g. OFF-SO-1234 or PI-SO-1234. */
  docNumber: string;
  /** ISO date for the document. */
  docDate: string;
  /** Optional closing remarks / terms. */
  notes?: string | null;
  /** Optional full seller details (resolved from suppliers/customers). */
  seller?: AgentPartyDetails | null;
  /** Optional full buyer details (resolved from customers). */
  buyer?: AgentPartyDetails | null;
  /** Resolved payment terms description (preferred over the code on the order). */
  paymentTermsLabel?: string | null;
  /** Resolved POD name (preferred over the code on the order). */
  podLabel?: string | null;
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

export function generateAgentOfferPdf(input: AgentOfferPdfInputs): jsPDF {
  const { order, kind, docNumber, docDate, notes, seller, buyer,
          paymentTermsLabel, podLabel } = input;
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  const title = kind === 'OFFER' ? 'OFFER' : 'PROFORMA INVOICE';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(BRAND);
  doc.text(order.sellerName, margin, 20);

  // Seller address block, immediately under the brand line.
  const sellerLines = partyLines(order.sellerName, seller).slice(1);
  if (sellerLines.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(MUTED);
    let sy = 25;
    for (const line of sellerLines) { doc.text(line, margin, sy); sy += 4; }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(INK);
  doc.text(title, pageW - margin, 20, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(MUTED);
  doc.text(`No.  ${docNumber}`, pageW - margin, 27, { align: 'right' });
  doc.text(`Date ${docDate}`, pageW - margin, 32, { align: 'right' });

  // Push the divider down if the seller block has more than ~3 lines so
  // the address never collides with the brand rule.
  const sellerBlockBottom = 25 + Math.max(0, sellerLines.length) * 4;
  const ruleY = Math.max(42, sellerBlockBottom + 2);

  doc.setDrawColor(BRAND);
  doc.setLineWidth(0.6);
  doc.line(margin, ruleY, pageW - margin, ruleY);

  // Buyer block on the left, full address.
  const buyerY0 = ruleY + 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(INK);
  doc.text('BUYER', margin, buyerY0);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(INK);
  const buyerLines = partyLines(order.customerName, buyer);
  let by = buyerY0 + 6;
  for (const line of buyerLines) {
    if (line === order.customerName) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
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
  termsLine('Incoterm:', order.incoterm ?? '—');
  termsLine('Payment:',  paymentTermsLabel ?? order.paymentTerms ?? '—');
  termsLine('POD:',      podLabel ?? order.pod);
  termsLine('Delivery:', order.deliveryDate);

  // Items table starts under whichever column is taller.
  const tableStartY = Math.max(by + 4, ty + 4);

  autoTable(doc, {
    startY: tableStartY,
    margin: { left: margin, right: margin },
    head: [['Description', 'Qty', 'Unit', 'Unit price', 'Amount']],
    body: order.items.map(it => [
      it.customerDescription || it.description || it.productName || '—',
      (it.quantity ?? 0).toLocaleString('en-US'),
      it.unit ?? 'Lbs',
      fmt(it.unitPrice ?? 0),
      fmt(it.total ?? ((it.quantity ?? 0) * (it.unitPrice ?? 0))),
    ]),
    headStyles: { fillColor: BRAND, textColor: '#ffffff', fontSize: 9, halign: 'center' },
    bodyStyles: { fontSize: 9, textColor: INK },
    columnStyles: {
      0: { halign: 'left' },
      1: { halign: 'center' },
      2: { halign: 'center' },
      3: { halign: 'center' },
      4: { halign: 'center', fontStyle: 'bold' },
    },
  });

  // @ts-expect-error injected by jspdf-autotable
  let y: number = doc.lastAutoTable?.finalY ?? 110;
  y += 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(INK);
  doc.text(`Total: ${fmt(order.orderTotal)}`, pageW - margin, y, { align: 'right' });
  y += 12;

  if (notes && notes.trim()) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(MUTED);
    const wrapped = doc.splitTextToSize(notes.trim(), pageW - margin * 2);
    doc.text(wrapped, margin, y);
    y += wrapped.length * 4 + 4;
  }

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  const footer = kind === 'OFFER'
    ? 'This offer is subject to acceptance. Price validity: 30 days.'
    : 'Proforma invoice — not a commercial invoice. Payable per terms stated above.';
  doc.text(footer, margin, y);

  return doc;
}
