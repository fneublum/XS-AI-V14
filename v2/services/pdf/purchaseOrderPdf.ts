// Purchase Order PDF — ported from v1 PurchaseOrders.tsx::handleDownloadPDF.
//
// Renders the same layout the v1 page produced (logo top-left, big
// "PURCHASE ORDER" heading top-right, vendor + ship-to address blocks,
// items table, totals, optional notes) so customers see no regression
// when the v2 list opens the preview modal.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { PurchaseOrder } from '../../queries/usePurchaseOrders';
import type { Supplier } from '../../queries/useSuppliers';
import type { PdfCompany } from './types';

export interface PoPdfCtx {
  /** Buyer company (ship-to). Accepts the trimmed PdfCompany shape used
   *  by other PDF generators so `findCompany()` output drops in directly. */
  company: PdfCompany | null;
  supplier: Supplier | null;
  logoUrl: string | null;
}

const fmtMoney = (n: number, currency: string): string =>
  `${currency} ${(Number.isFinite(n) ? n : 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export function generatePurchaseOrderPdf(po: PurchaseOrder, ctx: PoPdfCtx): jsPDF {
  const doc = new jsPDF();

  // Header — logo (if present) + PURCHASE ORDER heading.
  if (ctx.logoUrl) {
    try {
      const ext = ctx.logoUrl.split('.').pop()?.toUpperCase() || 'PNG';
      const format = ext === 'JPG' ? 'JPEG' : ext;
      // width 30mm, height auto.
      doc.addImage(ctx.logoUrl, format, 14, 15, 30, 0);
    } catch {
      // logo failure shouldn't kill the doc
    }
  }

  doc.setFontSize(22);
  doc.setTextColor(44, 62, 80);
  doc.text('PURCHASE ORDER', 196, 25, { align: 'right' });

  doc.setFontSize(10);
  doc.setTextColor(100);
  const idLabel = po.id;
  doc.text(`PO Number: ${idLabel}`, 196, 33, { align: 'right' });
  doc.text(`Date: ${(po.orderDate ?? '').slice(0, 10) || '—'}`, 196, 38, { align: 'right' });
  doc.text(`Status: ${po.status ?? '—'}`, 196, 43, { align: 'right' });

  // Address blocks (vendor left, ship-to right).
  const startY = 60;
  const supplier = ctx.supplier;
  const company = ctx.company;

  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text('VENDOR', 14, startY);
  doc.setDrawColor(200);
  doc.line(14, startY + 2, 90, startY + 2);

  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text(po.supplierName || (supplier?.name ?? '—'), 14, startY + 8);

  doc.setFontSize(10);
  doc.setTextColor(80);
  let vendorY = startY + 13;
  if (supplier) {
    const parts = [
      supplier.location,
      supplier.city,
      [supplier.state, supplier.zip].filter(Boolean).join(' ').trim(),
      supplier.country,
    ].filter((v): v is string => Boolean(v && v.trim()));
    parts.forEach(p => {
      doc.text(p, 14, vendorY);
      vendorY += 5;
    });
    vendorY += 2;
    if (supplier.contactPerson) { doc.text(supplier.contactPerson, 14, vendorY); vendorY += 5; }
    if (supplier.email)         { doc.text(supplier.email,         14, vendorY); vendorY += 5; }
  }

  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text('SHIP TO', 110, startY);
  doc.line(110, startY + 2, 196, startY + 2);

  let shipY = startY + 8;
  if (company) {
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text(company.name ?? '—', 110, shipY);
    shipY += 5;
    doc.setFontSize(10);
    doc.setTextColor(80);
    const parts = [
      company.address ?? '',
      company.city ?? '',
      [company.state, company.zip].filter(Boolean).join(' ').trim(),
      company.country ?? '',
    ].filter(v => v && v.trim());
    parts.forEach(p => {
      doc.text(p, 110, shipY);
      shipY += 5;
    });
    shipY += 2;
    const companyEmail = (company as { email?: string | null }).email;
    if (companyEmail) { doc.text(companyEmail, 110, shipY); shipY += 5; }
  }

  // Payment terms (single line under address blocks if present).
  const termsY = Math.max(vendorY, shipY) + 3;
  if (po.paymentTerms) {
    doc.setFontSize(10);
    doc.setTextColor(80);
    doc.text(`Payment Terms: ${po.paymentTerms}`, 14, termsY);
  }

  // Items table.
  const tableStartY = termsY + (po.paymentTerms ? 8 : 5);
  const currency = po.currency || 'USD';
  const tableHead = [['Item Description', 'Qty', 'Unit Price', 'Total']];
  const tableBody = (po.items ?? []).map(it => {
    const qty = Number(it.quantity) || 0;
    const unit = Number(it.unitPrice) || 0;
    const total = Number(it.total) || qty * unit;
    return [
      String(it.productName ?? ''),
      qty.toLocaleString(),
      fmtMoney(unit, currency),
      fmtMoney(total, currency),
    ];
  });

  autoTable(doc, {
    head: tableHead,
    body: tableBody,
    startY: tableStartY,
    theme: 'grid',
    headStyles: { fillColor: [44, 62, 80], textColor: 255 },
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right', fontStyle: 'bold' },
    },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? tableStartY;
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text('Subtotal:', 140, finalY + 10);
  doc.text(fmtMoney(po.totalAmount, currency), 196, finalY + 10, { align: 'right' });

  doc.setFontSize(12);
  doc.setTextColor(0);
  doc.setFont('helvetica', 'bold');
  doc.text('Total:', 140, finalY + 17);
  doc.text(fmtMoney(po.totalAmount, currency), 196, finalY + 17, { align: 'right' });
  doc.setFont('helvetica', 'normal');

  if (po.notes) {
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text('Notes:', 14, finalY + 30);
    const split = doc.splitTextToSize(po.notes, 180);
    doc.text(split, 14, finalY + 35);
  }

  return doc;
}
