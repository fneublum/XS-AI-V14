// Phase 3B — Proforma Invoice PDF generator.
//
// Ported from pages/SalesOrders.tsx `generateSalesDoc(..., 'PROFORMA')`
// with the v1 EC4 Enterprises layout preserved verbatim. Inputs are
// passed in via a ctx bag so v2 can call this without the v1 React
// state closures.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  PdfCompany, PdfCustomer, PdfBooking,
} from './types';

export interface PdfBank {
  id?: string;
  name?: string | null;
  swift_code?: string | null;
  routing?: string | null;
  wire?: string | null;
  account_number?: string | null;
}

export interface ProformaLineItem {
  productName?: string;
  customerDescription?: string | null;
  hsCode?: string | null;
  quantity?: number;
  unitPrice?: number;
}

export interface ProformaOrder {
  id: string;
  companyId?: string | null;
  orderNumber: string;
  orderDate?: string | null;
  customerId?: string | null;
  customerName: string;
  notifyPartyId?: string | null;
  notifyPartyName?: string | null;
  deliveryAddress?: string | null;
  deliveryDate?: string | null;
  paymentTerms?: string | null;
  incoterm?: string | null;
  pod?: string | null;
  bankId?: string | null;
  items?: ProformaLineItem[];
}

export interface ProformaPdfCtx {
  company: PdfCompany | undefined;
  customers: PdfCustomer[];
  bookings: PdfBooking[];
  banks: PdfBank[];
  logoUrl: string | null;
  stampUrl: string | null;
}

export function generateProformaPdf(order: ProformaOrder, ctx: ProformaPdfCtx): jsPDF {
  const { company, customers, bookings, banks, logoUrl, stampUrl } = ctx;
  const doc = new jsPDF();

  const orangeColor = '#F57F25';
  const darkGray = '#333333';
  const lightGray = '#888888';

  // ── Header ──────────────────────────────────────────────────
  if (logoUrl) {
    try {
      const imgProps = doc.getImageProperties(logoUrl);
      const maxWidth = 75;
      const maxHeight = 37.5;
      let width = imgProps.width;
      let height = imgProps.height;
      const ratio = Math.min(maxWidth / width, maxHeight / height);
      width *= ratio;
      height *= ratio;
      doc.addImage(logoUrl, 14, 10, width, height);
    } catch {
      doc.setFontSize(24);
      doc.setTextColor('#CE1126');
      doc.setFont('helvetica', 'bold');
      doc.text('EC4 ENTERPRISES', 14, 25);
    }
  } else {
    doc.setFontSize(24);
    doc.setTextColor('#CE1126');
    doc.setFont('helvetica', 'bold');
    doc.text('EC4 ENTERPRISES', 14, 25);
  }

  doc.setFontSize(9);
  doc.setTextColor(darkGray);
  doc.setFont('helvetica', 'bold');

  const companyName  = company?.name || 'EC4 ENTERPRISES';
  const addressLine1 = company?.address || '112 Bartran Oaks Walk #600010';
  const addressLine2 = (company?.city && company?.state)
    ? `${company.city}, ${company.state} ${company.zip || ''}`
    : 'St Johns, FL';
  const phone = '(904) 439-9343';
  const email = 'felipe@ec4.enterprises';

  let yPos = 15;
  const rightX = 130;
  doc.text(companyName,  rightX, yPos); doc.setFont('helvetica', 'normal'); yPos += 5;
  doc.text(addressLine1, rightX, yPos); yPos += 5;
  doc.text(addressLine2, rightX, yPos); yPos += 5;
  doc.text(phone,        rightX, yPos); yPos += 5;
  doc.text(email,        rightX, yPos);

  // ── Title ───────────────────────────────────────────────────
  yPos = 55;
  doc.setFontSize(16);
  doc.setTextColor(orangeColor);
  doc.setFont('helvetica', 'bold');
  doc.text('PROFORMA INVOICE', 14, yPos);

  // ── 3-column header block: Consignee / Notify / No+Date ─────
  yPos += 10;
  const startSectionY = yPos;
  const col1X = 14;
  const col2X = 82;
  const col3X = 155;

  const normalizeAddr = (s: string | undefined | null) =>
    (s || '').toUpperCase().replace(/\s+/g, ' ').trim();

  const renderPartyBlock = (
    label: string,
    name: string,
    customerRec: PdfCustomer | undefined,
    overrideStreet: string | undefined | null,
    xPos: number,
    startY: number,
    colWidth: number,
  ): number => {
    let y = startY;
    doc.setFontSize(8);
    doc.setTextColor(lightGray);
    doc.text(label, xPos, y);
    y += 5;

    doc.setFontSize(9);
    doc.setTextColor(darkGray);
    doc.setFont('helvetica', 'bold');
    doc.text(name || '', xPos, y);
    y += 5;
    doc.setFont('helvetica', 'normal');

    const city    = customerRec?.city    || '';
    const state   = customerRec?.state   || '';
    const zip     = customerRec?.zip     || '';
    const country = customerRec?.country || '';
    const taxId   = customerRec?.taxId   || '';

    const dropSet = new Set<string>(
      [
        city, state, zip, country,
        [state, zip].filter(Boolean).join(' '),
        [city, state].filter(Boolean).join(' '),
        [city, state].filter(Boolean).join(', '),
        [city, state, zip].filter(Boolean).join(' '),
        [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      ]
        .map(normalizeAddr)
        .filter(Boolean),
    );

    const rawStreet = overrideStreet || customerRec?.location || (customerRec as { address?: string })?.address || '';
    if (rawStreet) {
      const streetOnly = rawStreet
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)
        .filter((s: string) => !dropSet.has(normalizeAddr(s)))
        .join(', ');
      if (streetOnly) {
        const lines = doc.splitTextToSize(streetOnly, colWidth);
        doc.text(lines, xPos, y);
        y += (lines as string[]).length * 4;
      }
    }

    const stateZip = [state, zip].filter(Boolean).join(' ');
    const cityStateZip = [city, stateZip].filter(Boolean).join(', ');
    if (cityStateZip) {
      const lines = doc.splitTextToSize(cityStateZip, colWidth);
      doc.text(lines, xPos, y);
      y += (lines as string[]).length * 4;
    }
    if (taxId)   { doc.text(`TAX ID : ${taxId}`, xPos, y); y += 4; }
    if (country) { doc.text(country, xPos, y); y += 4; }

    return y;
  };

  const customerRec = customers.find(c => c.id === (order.customerId ?? ''));
  const col1Y = renderPartyBlock(
    'CONSIGNEE',
    order.customerName,
    customerRec,
    order.deliveryAddress ?? undefined,
    col1X, startSectionY, 62,
  );

  let col2Y = startSectionY;
  if (order.notifyPartyName) {
    const notifyCust = customers.find(c => c.id === (order.notifyPartyId ?? ''));
    col2Y = renderPartyBlock(
      'NOTIFY PARTY',
      order.notifyPartyName,
      notifyCust,
      undefined,
      col2X, startSectionY, 62,
    );
  }

  let col3Y = startSectionY;
  doc.setFontSize(8);
  doc.setTextColor(lightGray);
  doc.text('No :', col3X, col3Y);
  doc.setFontSize(9);
  doc.setTextColor(darkGray);
  doc.text(order.orderNumber, col3X + 15, col3Y);

  col3Y += 10;
  doc.setFontSize(8);
  doc.setTextColor(lightGray);
  doc.text('DATE', col3X, col3Y);
  doc.setFontSize(9);
  doc.setTextColor(darkGray);
  doc.text(
    order.orderDate ? new Date(order.orderDate).toLocaleDateString() : '',
    col3X + 15, col3Y,
  );

  const linkedBooking = bookings.find(
    b => (b as { salesOrderId?: string | null }).salesOrderId === order.id,
  );
  if (linkedBooking) {
    col3Y += 10;
    doc.setFontSize(8);
    doc.setTextColor(lightGray);
    doc.text('BOOKING', col3X, col3Y);
    doc.setFontSize(9);
    doc.setTextColor(darkGray);
    doc.text(linkedBooking.bookingNumber || '', col3X + 15, col3Y);
  }

  // ── Terms & Incoterm ────────────────────────────────────────
  const sectionBottomY = Math.max(col1Y + 5, col2Y + 10, col3Y + 5);
  yPos = sectionBottomY;

  doc.setFontSize(8);
  doc.setTextColor(lightGray);
  doc.text('TERMS', 14, yPos);
  doc.setFontSize(9);
  doc.setTextColor(darkGray);
  doc.text(order.paymentTerms || 'Prepaid', 14, yPos + 5);

  const incotermX = 90;
  doc.setFontSize(8);
  doc.setTextColor(lightGray);
  doc.text('INCOTERM', incotermX, yPos);
  doc.setFontSize(9);
  doc.setTextColor(darkGray);
  const incotermText = `${order.incoterm || ''} ${order.pod || ''}`.trim();
  doc.text(incotermText, incotermX, yPos + 5);

  // ── Items table ─────────────────────────────────────────────
  yPos += 15;

  const items = order.items ?? [];
  const tableHead = [['ACTIVITY', 'HS CODE', 'QTY LBS\nKGS', 'RATE US$/LBS\nUS$ / KG', 'AMOUNT US$']];
  const tableBody = items.map(item => {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.unitPrice) || 0;
    const qtyKgs = Math.round(quantity * 0.453592);
    const priceKg = Math.round(unitPrice * 2.20462 * 100) / 100;
    const amountKg = Math.round(qtyKgs * priceKg * 100) / 100;
    return [
      item.customerDescription || item.productName || '',
      item.hsCode || '',
      `${quantity.toLocaleString()}\n${qtyKgs.toLocaleString()}`,
      `${unitPrice.toFixed(4)}\n${priceKg.toFixed(2)}`,
      amountKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    ];
  });

  autoTable(doc, {
    startY: yPos,
    head: tableHead,
    body: tableBody,
    theme: 'plain',
    styles: { fontSize: 9, textColor: darkGray, cellPadding: 3, valign: 'top' },
    headStyles: { fillColor: '#FFE0B2', textColor: orangeColor, fontStyle: 'bold', halign: 'left' },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 25, fontSize: 8 },
      2: { halign: 'right', cellWidth: 30 },
      3: { halign: 'right', cellWidth: 32 },
      4: { halign: 'right', cellWidth: 30 },
    },
  });

  // ── Totals ──────────────────────────────────────────────────
  const finalY = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY) || 140;

  doc.setFontSize(8);
  doc.setTextColor(lightGray);
  doc.text('Qty in LBS (or Kgs)', 14, finalY + 4);
  doc.text('Rate in US$', 14, finalY + 8);

  doc.setFontSize(9);
  doc.setTextColor(darkGray);
  doc.setFont('helvetica', 'bold');
  const shipDate = order.deliveryDate || 'Prompt';
  doc.text(`SHIPPING DATE : ${shipDate}`, 14, finalY + 16);

  const labelX = 140;
  const valueX = 195;
  let totalY = finalY + 4;

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(lightGray);
  doc.text('SUBTOTAL', labelX, totalY);
  doc.setTextColor(darkGray);

  const pdfSubtotal = items.reduce((sum, item) => {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.unitPrice) || 0;
    const qtyKgs = Math.round(quantity * 0.453592);
    const priceKg = Math.round(unitPrice * 2.20462 * 100) / 100;
    return sum + Math.round(qtyKgs * priceKg * 100) / 100;
  }, 0);

  doc.text(
    pdfSubtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    valueX, totalY, { align: 'right' },
  );

  totalY += 6;
  doc.setTextColor(lightGray);
  doc.text('TAX', labelX, totalY);
  doc.setTextColor(darkGray);
  doc.text('0.00', valueX, totalY, { align: 'right' });

  if (stampUrl) {
    try {
      const stampSize = 30;
      const stampX = labelX + 10;
      const stampY = totalY + 22;
      doc.addImage(stampUrl, 'PNG', stampX, stampY, stampSize, stampSize);
    } catch (e) {
      console.warn('[Proforma PDF] Could not add stamp:', e);
    }
  }

  totalY += 8;
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(darkGray);
  doc.text('TOTAL', labelX, totalY);
  doc.text(
    `$${pdfSubtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    valueX, totalY, { align: 'right' },
  );

  // ── Signatures ──────────────────────────────────────────────
  let sigY = finalY + 30;
  if (sigY > 250) { doc.addPage(); sigY = 20; }

  doc.setFontSize(9);
  doc.setTextColor(lightGray);
  doc.setFont('helvetica', 'bold');
  doc.text('Accepted By', 14, sigY);
  doc.setDrawColor(200);
  doc.line(14, sigY + 12, 90, sigY + 12);
  doc.text('Accepted Date', 14, sigY + 20);
  doc.line(14, sigY + 32, 60, sigY + 32);

  // ── Bank info ───────────────────────────────────────────────
  const bankY = sigY + 45;
  if (bankY > 260) doc.addPage();

  doc.setFontSize(8);
  doc.setTextColor(lightGray);
  doc.text('PAY TO :', 14, bankY);

  doc.setFontSize(9);
  doc.setTextColor(darkGray);
  doc.setFont('helvetica', 'bold');
  const bankLineSpacing = 5;
  let currentBankY = bankY + 5;

  const selectedBank = order.bankId ? banks.find(b => b.id === order.bankId) : null;

  if (selectedBank) {
    doc.text(companyName,             14, currentBankY); currentBankY += bankLineSpacing;
    doc.text(selectedBank.name || '', 14, currentBankY); currentBankY += bankLineSpacing;
    if (selectedBank.swift_code)     { doc.text(`SWIFT : ${selectedBank.swift_code}`,       14, currentBankY); currentBankY += bankLineSpacing; }
    if (selectedBank.routing)        { doc.text(`ROUTING : ${selectedBank.routing}`,       14, currentBankY); currentBankY += bankLineSpacing; }
    if (selectedBank.wire)           { doc.text(`WIRE TRANSFER : ${selectedBank.wire}`,    14, currentBankY); currentBankY += bankLineSpacing; }
    if (selectedBank.account_number) { doc.text(`ACCOUNT # : ${selectedBank.account_number}`, 14, currentBankY); }
  } else {
    doc.setFont('helvetica', 'italic');
    doc.text('No bank account configured for this order.', 14, currentBankY);
  }

  // ── Footer ──────────────────────────────────────────────────
  const pageHeight = doc.internal.pageSize.height;
  doc.setFontSize(7);
  doc.setTextColor(lightGray);
  doc.setFont('helvetica', 'normal');
  doc.text('1. QUANTITY CAN INCREASE OR DECREASE IN +/- 5%', 14, pageHeight - 10);
  doc.text('Page 1 of 1', 180, pageHeight - 10);

  return doc;
}
