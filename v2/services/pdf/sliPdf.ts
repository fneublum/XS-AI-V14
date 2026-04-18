// Phase 3B — Shipper's Letter of Instruction PDF. Ported 1:1 from
// v1's `pages/PLInvoiceEngine.tsx::generateSLIPreview`, closures
// replaced by an explicit `ctx` parameter.

import jsPDF from 'jspdf';
import { InvoicePdfCtx, PdfInvoice, findLinkedPL } from './types';

const DEFAULT_MEMO =
  'NO WOOD PRESENT ON THE CARGO\nManufacturer: Various generators in the USA. Goods collected and consolidated by EC4 ENTERPRISES LLC';

const parseItems = (raw: unknown): any[] => {
  try {
    if (typeof raw === 'string') return JSON.parse(raw);
    if (Array.isArray(raw)) return raw;
    return [];
  } catch { return []; }
};

const normalizeName = (n: string) =>
  (n || '').toLowerCase().replace(/[.,\-\/\\()]/g, '').replace(/\s+/g, ' ').trim();

export function generateSliPdf(
  inv: PdfInvoice,
  ctx: InvoicePdfCtx,
  autoDownload = false,
): jsPDF {
  const doc = new jsPDF();
  const linkedPL = findLinkedPL(inv, ctx.packingLists);

  const cyanColor = '#00A0B0';
  const darkGray = '#333333';

  const company = ctx.company;
  const companyName = company?.name || 'EC4 ENTERPRISES LLC';
  const companyAddress = company?.address || '112 Bartran Oaks Walk #600010';
  const companyCity = `${company?.city || 'St Johns'}, ${company?.state || 'FL'} ${company?.zip || '32260'}`;
  const companyEIN = company?.ein || '';
  const companyPhone = company?.phone || '';
  const companyState = company?.state || 'FL';

  // Consignee info
  const consigneeName = inv.consignee || inv.billToName || '';
  const customer = ctx.customers.find(c => c.name === consigneeName || c.name === inv.billToName);
  const customerCountry = customer?.country || '';
  const customerAddress = customer
    ? [customer.location, customer.city, customer.state, customer.zip, customer.country].filter(Boolean).join(', ')
    : '';

  const items = parseItems(inv.items);

  // Supplier resolution — point of origin for Field 4
  const plSupplierName = linkedPL?.supplier || linkedPL?.shipper || '';
  const invSupplierName = inv.supplier || inv.shipperName || inv.shipper || '';
  const itemSupplier = items.length > 0 ? (items[0].supplier || '') : '';
  const effectiveSupplier = plSupplierName || invSupplierName || itemSupplier;

  let supplierObj: any = null;
  if (effectiveSupplier && ctx.suppliers.length > 0) {
    const normalizedEffective = normalizeName(effectiveSupplier);
    supplierObj = ctx.suppliers.find((s: any) => s.name === effectiveSupplier);
    if (!supplierObj) {
      supplierObj = ctx.suppliers.find((s: any) => normalizeName(s.name || '') === normalizedEffective);
    }
    if (!supplierObj) {
      supplierObj = ctx.suppliers.find((s: any) =>
        normalizeName(s.nickname || '') === normalizedEffective ||
        normalizedEffective.includes(normalizeName(s.name || '')) ||
        normalizeName(s.name || '').includes(normalizedEffective),
      );
    }
  }
  const freightOriginState = supplierObj?.state || inv.originState || companyState;

  // Field 15 (Port of Export): inv.pod → inv.poa → booking.pol → linkedPL.shippingPoint
  let poaValue = inv.pod || inv.poa || '';
  if (!poaValue && inv.bookingNumber) {
    const booking = ctx.bookings.find(b => b.bookingNumber === inv.bookingNumber);
    if (booking?.pol) poaValue = booking.pol;
  }
  if (!poaValue && (linkedPL as any)?.shippingPoint) {
    poaValue = (linkedPL as any).shippingPoint;
  }

  const totalNetLbs = items.reduce((s: number, i: any) => s + Number(i.netLbs || i.quantity || 0), 0);
  const totalNetKg = totalNetLbs * 0.453592;
  const totalGrossLbs = items.reduce((s: number, i: any) => s + Number(i.grossLbs || 0), 0);
  const totalGrossKg = totalGrossLbs > 0 ? totalGrossLbs * 0.453592 : totalNetKg * 1.02;
  const totalVolumes = items.reduce((s: number, i: any) => s + Number(i.volumes || 0), 0);

  // Header (logo left, company right)
  if (ctx.logoUrl) {
    try {
      let format = 'JPEG';
      if (ctx.logoUrl.startsWith('data:image/')) {
        const m = ctx.logoUrl.match(/data:image\/(\w+);/);
        if (m) { format = m[1].toUpperCase(); if (format === 'JPG') format = 'JPEG'; }
      }
      const imgProps = doc.getImageProperties(ctx.logoUrl);
      const maxW = 60;
      const maxH = 25;
      let w = imgProps.width;
      let h = imgProps.height;
      const r = Math.min(maxW / w, maxH / h);
      w *= r; h *= r;
      doc.addImage(ctx.logoUrl, format, 14, 10, w, h);
    } catch (e) { console.error('[SLI PDF] Logo load failed:', e); }
  }

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(darkGray);
  doc.text(companyName, 196, 15, { align: 'right' });

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(companyAddress, 196, 21, { align: 'right' });
  doc.text(companyCity, 196, 26, { align: 'right' });

  let y = 40;

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(cyanColor);
  doc.text("SHIPPER'S LETTER OF INSTRUCTION", 105, y, { align: 'center' });
  y += 10;

  const leftCol = 14;
  const rightCol = 110;
  const lineHeight = 5;

  const drawFieldLabel = (fieldNum: string, label: string, x: number, yPos: number) => {
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor('#888888');
    doc.text(`${fieldNum}. ${label}`, x, yPos);
  };

  const drawFieldValue = (value: string, x: number, yPos: number, maxWidth = 85) => {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(darkGray);
    const lines = doc.splitTextToSize(value || '-', maxWidth);
    doc.text(lines, x, yPos);
    return lines.length * 4;
  };

  doc.setDrawColor('#cccccc');
  doc.setLineWidth(0.3);

  // Row 1 — USPPI
  drawFieldLabel('1a', 'U.S. PRINCIPAL PARTY IN INTEREST (USPPI)', leftCol, y);
  y += 4;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(darkGray);
  doc.text(companyName, leftCol, y);
  y += 4;
  doc.setFont('helvetica', 'normal');
  doc.text(companyAddress, leftCol, y);
  y += 4;
  doc.text(companyCity, leftCol, y);
  if (companyPhone) {
    y += 4;
    doc.text(`Tel: ${companyPhone}`, leftCol, y);
  }

  y += 6;
  drawFieldLabel('1b', 'USPPI EIN (IRS) NO.', leftCol, y);
  y += 4;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(darkGray);
  doc.text(companyEIN ? `EIN: ${companyEIN}` : 'EIN: ______________', leftCol, y);

  let rightY = y - 22;
  drawFieldLabel('2', 'DATE OF EXPORTATION', rightCol, rightY);
  rightY += 4;
  drawFieldValue(new Date(inv.date || inv.invoiceDate || new Date()).toISOString().split('T')[0], rightCol, rightY);
  rightY += 8;

  drawFieldLabel('3', 'TRANSPORTATION REFERENCE NO.', rightCol, rightY);
  rightY += 4;
  drawFieldValue(inv.bookingNumber || inv.transportRef || '-', rightCol, rightY);

  y += 8;
  doc.line(leftCol, y, 196, y);
  y += 4;

  // Row 2 — Origin / Consignee
  drawFieldLabel('4', 'POINT (STATE) OF ORIGIN OR FTZ NO.', leftCol, y);
  y += 4;
  drawFieldValue(freightOriginState || '-', leftCol, y);

  drawFieldLabel('5', 'ULTIMATE CONSIGNEE', rightCol, y - 4);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(darkGray);
  const consigneeLines = doc.splitTextToSize(consigneeName, 82);
  doc.text(consigneeLines, rightCol, y);
  let consigneeEndY = y + consigneeLines.length * 4;
  if (customerAddress) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const addrLines = doc.splitTextToSize(customerAddress, 82);
    doc.text(addrLines, rightCol, consigneeEndY);
    consigneeEndY += addrLines.length * 3.5;
  }

  y = Math.max(y + 8, consigneeEndY + 4);
  doc.line(leftCol, y, 196, y);
  y += 4;

  // Row 3 — Country / Parties / Mode / Port
  drawFieldLabel('7', 'COUNTRY OF ULTIMATE DESTINATION', leftCol, y);
  y += 4;
  drawFieldValue(customerCountry || 'N/A', leftCol, y);

  drawFieldLabel('8', 'PARTIES TO TRANSACTION', rightCol, y - 4);
  drawFieldValue('Non-Related', rightCol, y);

  y += 8;
  doc.line(leftCol, y, 196, y);
  y += 4;

  drawFieldLabel('11', 'MODE OF TRANSPORT', leftCol, y);
  y += 4;
  drawFieldValue('VESSEL (Ocean)', leftCol, y);

  drawFieldLabel('15', 'PORT OF EXPORT', rightCol, y - 4);
  let portOfExportDisplay = poaValue;
  if (poaValue && ctx.ports.length > 0) {
    const port = ctx.ports.find(p => p.code === poaValue || p.name === poaValue);
    if (port) portOfExportDisplay = `${port.name} (${port.code})`;
  }
  drawFieldValue(portOfExportDisplay || '-', rightCol, y);

  y += 8;
  doc.line(leftCol, y, 196, y);
  y += 4;

  // Goods table
  doc.setFillColor(232, 244, 245);
  doc.rect(leftCol, y - 2, 182, 7, 'F');
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor('#555555');
  doc.text('18. D/F', leftCol + 1, y + 2);
  doc.text('19. SCHEDULE B DESCRIPTION', leftCol + 14, y + 2);
  doc.text('20. QTY', leftCol + 95, y + 2);
  doc.text('22. SHIP WT (KG)', leftCol + 113, y + 2);
  doc.text('23. ECCN', leftCol + 140, y + 2);
  doc.text('26. VALUE ($)', leftCol + 160, y + 2);
  y += 8;

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(darkGray);

  if (items.length > 0) {
    items.forEach((item: any) => {
      if (y > 260) return;
      let desc = (item.customerDescription || '').trim();
      if (!desc && item.productId && ctx.products.length > 0) {
        const p = ctx.products.find(p => p.id === item.productId);
        if (p?.name) desc = p.name;
      }
      if (!desc) desc = item.productDescription || item.description || '';
      const hsCode = item.hsCode || '';
      const descWithHS = hsCode ? `${hsCode} - ${desc}` : desc;
      const qty = Number(item.netLbs || item.quantity || 0);
      const qtyKg = qty * 0.453592;
      const amount = Number(item.amount || 0);

      doc.text('D', leftCol + 4, y);
      const descLines = doc.splitTextToSize(descWithHS.substring(0, 70), 78);
      doc.text(descLines, leftCol + 14, y);
      doc.text(qtyKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), leftCol + 95, y);
      doc.text(qtyKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), leftCol + 113, y);
      doc.text('EAR99', leftCol + 140, y);
      doc.text(`$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, leftCol + 160, y);

      y += Math.max(descLines.length * 4, 5) + 1;
    });
  } else {
    doc.text('No items', leftCol + 14, y);
    y += 6;
  }

  // Totals
  y += 2;
  doc.setFillColor(240, 240, 240);
  doc.rect(leftCol, y - 3, 182, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('TOTALS:', leftCol + 14, y);
  doc.text(`${totalNetKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KG`, leftCol + 95, y);
  doc.text(`${totalNetKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KG`, leftCol + 113, y);
  doc.text(`$${Number((inv as any).totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, leftCol + 160, y);
  y += 10;

  doc.line(leftCol, y - 3, 196, y - 3);

  drawFieldLabel('25', 'LICENSE EXCEPTION / AUTHORIZATION', leftCol, y);
  y += 4;
  drawFieldValue('NLR (No License Required)', leftCol, y);

  drawFieldLabel('9', 'ROUTED EXPORT TRANSACTION', rightCol, y - 4);
  drawFieldValue('No', rightCol, y);

  y += 10;

  // Shipping details
  doc.setFillColor(232, 244, 245);
  doc.rect(14, y, 182, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(darkGray);
  doc.text('Shipping Details', 16, y + 5);
  y += 12;

  doc.setFontSize(9);
  const leftValCol = 50;
  const rightValCol = 145;

  doc.setFont('helvetica', 'bold');
  doc.text('Carrier:', leftCol, y);
  doc.setFont('helvetica', 'normal');
  doc.text(inv.carrier || '', leftValCol, y);

  doc.setFont('helvetica', 'bold');
  doc.text('Booking #:', rightCol, y);
  doc.setFont('helvetica', 'normal');
  doc.text(inv.bookingNumber || inv.transportRef || '-', rightValCol, y);
  y += lineHeight + 1;

  doc.setFont('helvetica', 'bold');
  doc.text('Incoterm:', leftCol, y);
  doc.setFont('helvetica', 'normal');
  doc.text(inv.incoterm || 'EX-WORKS USA', leftValCol, y);

  doc.setFont('helvetica', 'bold');
  doc.text('Invoice #:', rightCol, y);
  doc.setFont('helvetica', 'normal');
  doc.text(inv.invoiceNumber || '', rightValCol, y);
  y += lineHeight + 1;

  doc.setFont('helvetica', 'bold');
  doc.text('Total Amount:', leftCol, y);
  doc.setFont('helvetica', 'normal');
  doc.text(`$${Number((inv as any).totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, leftValCol, y);

  doc.setFont('helvetica', 'bold');
  doc.text('Currency:', rightCol, y);
  doc.setFont('helvetica', 'normal');
  doc.text((inv as any).currency || 'USD', rightValCol, y);
  y += lineHeight + 1;

  doc.setFont('helvetica', 'bold');
  doc.text('Gross Weight:', leftCol, y);
  doc.setFont('helvetica', 'normal');
  doc.text(`${totalGrossKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KG`, leftValCol, y);

  doc.setFont('helvetica', 'bold');
  doc.text('Net Weight:', rightCol, y);
  doc.setFont('helvetica', 'normal');
  doc.text(`${totalNetKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KG`, rightValCol, y);
  y += lineHeight + 1;

  doc.setFont('helvetica', 'bold');
  doc.text('Packaging:', leftCol, y);
  doc.setFont('helvetica', 'normal');
  doc.text((inv as any).packaging || 'Bales / Fardos', leftValCol, y);

  doc.setFont('helvetica', 'bold');
  doc.text('Number of Bales:', rightCol, y);
  doc.setFont('helvetica', 'normal');
  doc.text(totalVolumes > 0 ? totalVolumes.toString() : '-', rightValCol, y);
  y += lineHeight + 1;

  doc.setFont('helvetica', 'bold');
  doc.text('Country of Origin:', leftCol, y);
  doc.setFont('helvetica', 'normal');
  doc.text('USA', leftValCol, y);
  y += lineHeight + 3;

  // Containers and seals
  doc.setFont('helvetica', 'bold');
  doc.text('Containers and Seals:', leftCol, y);
  y += 5;

  const containersMap = new Map<string, string>();
  items.forEach((item: any) => {
    if (item.containerNo && String(item.containerNo).toLowerCase() !== 'unknown') {
      containersMap.set(item.containerNo, item.sealNo || '');
    }
  });

  doc.setFont('helvetica', 'normal');
  if (containersMap.size > 0) {
    containersMap.forEach((seal, container) => {
      doc.text(`- ${container}${seal ? ` / Seal: ${seal}` : ''}`, leftCol + 2, y);
      y += 4;
    });
  } else {
    doc.text('- N/A', leftCol + 2, y);
    y += 4;
  }
  y += 4;

  // Special notes
  doc.setFont('helvetica', 'bold');
  doc.text('Special Notes:', leftCol, y);
  doc.setFont('helvetica', 'normal');
  const specialNotes = (inv as any).specialNotes || inv.memo || DEFAULT_MEMO;
  doc.text(specialNotes, leftValCol, y);

  if (ctx.stampUrl && companyName.toUpperCase().includes('EC4')) {
    try {
      const stampSize = 30;
      const stampX = 196 - stampSize;
      const stampY = Math.min(y + 10, 255);
      doc.addImage(ctx.stampUrl, 'JPEG', stampX, stampY, stampSize, stampSize);
    } catch (e) { console.warn('[SLI PDF] Could not add stamp:', e); }
  }

  if (autoDownload) {
    doc.save(`SLI_${inv.invoiceNumber || 'unknown'}.pdf`);
  }
  return doc;
}
