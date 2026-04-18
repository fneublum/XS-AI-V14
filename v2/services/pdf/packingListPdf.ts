// Phase 3B — Packing List PDF generator. Ported 1:1 from v1's
// `pages/PLInvoiceEngine.tsx::generatePackingListPDF`, closures
// replaced by an explicit `ctx` parameter.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { InvoicePdfCtx, PdfInvoice } from './types';

const INCOTERM_NAMES: Record<string, string> = {
  EXW: 'EX WORKS', FCA: 'FREE CARRIER', CPT: 'CARRIAGE PAID TO',
  CIP: 'CARRIAGE AND INSURANCE PAID TO', DAT: 'DELIVERED AT TERMINAL',
  DAP: 'DELIVERED AT PLACE', DDP: 'DELIVERED DUTY PAID',
  FAS: 'FREE ALONGSIDE SHIP', FOB: 'FREE ON BOARD',
  CFR: 'COST AND FREIGHT', CIF: 'COST, INSURANCE AND FREIGHT',
};

const parseItems = (raw: unknown): any[] => {
  try {
    if (typeof raw === 'string') return JSON.parse(raw);
    if (Array.isArray(raw)) return raw;
    return [];
  } catch { return []; }
};

export function generatePackingListPdf(
  inv: PdfInvoice,
  ctx: InvoicePdfCtx,
  autoDownload = false,
): jsPDF {
  const doc = new jsPDF();

  const cyanColor = '#00A0B0';
  const darkGray  = '#333333';
  const tableHeaderBg = '#E8F4F5';

  const company = ctx.company;
  const companyName = company?.name || 'EC4 ENTERPRISES LLC';
  const companyAddress = company?.address || '112 Bartran Oaks Walk #600010';
  const companyCity = `${company?.city || 'ST Johns'}, ${company?.state || 'FL'} ${company?.zip || '32260'} US`;
  const companyPhone = company?.phone || '9044399343';
  const companyEmail = 'felipe@ec4.enterprises';
  const companyWeb   = 'www.ec4.enterprises';

  // Header
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(darkGray);
  doc.text(companyName, 14, 15);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(companyAddress, 14, 21);
  doc.text(companyCity, 14, 26);
  doc.text(companyPhone, 14, 31);
  doc.text(companyEmail, 14, 36);
  doc.text(companyWeb, 14, 41);

  if (ctx.logoUrl) {
    try {
      let format = 'JPEG';
      if (ctx.logoUrl.startsWith('data:image/')) {
        const m = ctx.logoUrl.match(/data:image\/(\w+);/);
        if (m) { format = m[1].toUpperCase(); if (format === 'JPG') format = 'JPEG'; }
      }
      const imgProps = doc.getImageProperties(ctx.logoUrl);
      const maxW = 60;
      const maxH = 30;
      let w = imgProps.width;
      let h = imgProps.height;
      const r = Math.min(maxW / w, maxH / h);
      w *= r; h *= r;
      const logoX = 210 - 14 - w;
      doc.addImage(ctx.logoUrl, format, logoX, 10, w, h);
    } catch (e) { console.error('[PL PDF] Logo load failed:', e); }
  }

  doc.setFontSize(20);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(cyanColor);
  doc.text('Packing Slip', 14, 54);

  // Bill to / Ship to / Invoice info
  let y = 68;
  const billToName = inv.billToName || inv.soldTo || '';
  const customer = ctx.customers.find(c => c.name === billToName || c.id === inv.customerId);
  let customerAddress = '';
  if (customer) {
    customerAddress = [customer.location, customer.city, customer.state, customer.zip, customer.country]
      .filter(Boolean).join(', ');
  }

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(darkGray);
  doc.text('BILL TO', 14, y);
  doc.text('SHIP TO', 75, y);

  doc.text('INVOICE #', 140, y);
  doc.setFont('helvetica', 'normal');
  doc.text(inv.invoiceNumber || '', 170, y);

  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.text('DATE', 140, y);
  doc.setFont('helvetica', 'normal');
  const ds = inv.date || inv.invoiceDate || '';
  doc.text(ds ? new Date(ds).toLocaleDateString() : '-', 170, y);

  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.text('SO #', 140, y);
  doc.setFont('helvetica', 'normal');
  doc.text(inv.soNumber || inv.customerPo || '-', 170, y);

  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.text('BOOKING #', 140, y);
  doc.setFont('helvetica', 'normal');
  doc.text(inv.bookingNumber || inv.transportRef || '-', 170, y);

  // Bill to content
  y = 74;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  let billToY = y;

  doc.setFont('helvetica', 'bold');
  const billToLines = doc.splitTextToSize(billToName, 55);
  doc.text(billToLines, 14, billToY);
  billToY += billToLines.length * 4;

  doc.setFont('helvetica', 'normal');
  if (customerAddress) {
    const lines = doc.splitTextToSize(customerAddress, 55);
    doc.text(lines, 14, billToY);
    billToY += lines.length * 4;
  }
  if (customer?.email) { doc.text(customer.email, 14, billToY); billToY += 4; }
  if (customer?.taxId) { doc.text(`CNPJ : ${customer.taxId}`, 14, billToY); }

  // Ship to
  let shipToY = y;
  const shipToName = inv.consignee || billToName;
  const shipToCustomer = ctx.customers.find(c => c.name === shipToName) || customer;
  let shipToAddress = '';
  if (shipToCustomer) {
    shipToAddress = [shipToCustomer.location, shipToCustomer.city, shipToCustomer.state, shipToCustomer.zip, shipToCustomer.country]
      .filter(Boolean).join(', ');
  }

  doc.setFont('helvetica', 'bold');
  const shipToLines = doc.splitTextToSize(shipToName, 55);
  doc.text(shipToLines, 75, shipToY);
  shipToY += shipToLines.length * 4;

  doc.setFont('helvetica', 'normal');
  if (shipToAddress) {
    const lines = doc.splitTextToSize(shipToAddress, 55);
    doc.text(lines, 75, shipToY);
    shipToY += lines.length * 4;
  }
  if (shipToCustomer?.email) { doc.text(shipToCustomer.email, 75, shipToY); shipToY += 4; }
  if (shipToCustomer?.taxId) { doc.text(`CNPJ : ${shipToCustomer.taxId}`, 75, shipToY); }

  // Terms / Incoterm / POD
  y = 110;
  doc.setDrawColor(200);
  doc.line(14, y, 196, y);

  y += 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(darkGray);
  doc.text('TERMS', 14, y);
  doc.text('INCOTERM', 90, y);
  doc.text('POD', 155, y);

  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(cyanColor);

  const termsText = inv.paymentTerms || 'ADV / CAD';
  doc.text(termsText.length > 25 ? termsText.substring(0, 25) : termsText, 14, y);

  const incotermCode = inv.incoterm || 'CFR';
  doc.text(`${incotermCode} - ${INCOTERM_NAMES[incotermCode] || incotermCode}`, 90, y);

  const podCode = inv.pod || '';
  const podPort = ctx.ports.find(p => p.code === podCode);
  doc.text(podPort ? `${podCode} - ${podPort.name}` : (podCode || '-'), 155, y);

  // Items table (no unit price)
  y += 12;
  const items = parseItems(inv.items);

  const tableHead = [['DESCRIPTION', 'HS CODE', 'QTY (LBS/KG)']];

  type PlRow = { description: string; hsCode: string; netLbs: number; netKg: number };
  const plItems: PlRow[] = [];
  const plMap = new Map<string, number>();
  items.forEach((item: any) => {
    let desc = (item.customerDescription || '').trim();
    if (!desc && item.productId && ctx.products.length > 0) {
      const p = ctx.products.find(p => p.id === item.productId);
      if (p?.name) desc = p.name;
    }
    if (!desc) desc = `${item.productDescription || item.description || ''}`.trim();
    const hsCode = item.hsCode || '';
    const key = `${hsCode}|||${desc}`;
    const netLbs = item.netLbs || item.quantity || 0;
    const netKg = item.netKg || (netLbs * 0.453592);
    const existing = plMap.get(key);
    if (existing !== undefined) {
      plItems[existing].netLbs += netLbs;
      plItems[existing].netKg += netKg;
    } else {
      plMap.set(key, plItems.length);
      plItems.push({ description: desc, hsCode, netLbs, netKg });
    }
  });

  const tableBody = plItems.map(ci => {
    const qty = `${ci.netLbs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lbs\n${ci.netKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;
    return [ci.description, ci.hsCode || '-', qty];
  });

  autoTable(doc, {
    startY: y,
    head: tableHead,
    body: tableBody,
    theme: 'plain',
    styles: { fontSize: 9, textColor: darkGray, cellPadding: 4, valign: 'top' },
    headStyles: { fillColor: tableHeaderBg, textColor: cyanColor, fontStyle: 'bold', halign: 'left' },
    columnStyles: {
      0: { cellWidth: 100 },
      1: { cellWidth: 35 },
      2: { halign: 'right', cellWidth: 35 },
    },
  });

  let finalY = (doc as any).lastAutoTable.finalY + 15;

  // Summary by container
  let containerData: any[] = [];
  try {
    containerData = typeof inv.containers === 'string' ? JSON.parse(inv.containers || '[]') : (inv.containers as any[] | undefined) || [];
  } catch { containerData = []; }

  if (containerData.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(darkGray);
    doc.text('SUMMARY BY CONTAINER', 14, finalY);
    finalY += 5;

    type CRow = { container: string; seal: string; volumes: number; netKg: number; grossKg: number };
    const rows: CRow[] = containerData.map((cont: any) => {
      const contItems = items.filter((i: any) => i.containerNo === cont.container);
      const vols = contItems.reduce((s: number, i: any) => s + (i.volumes || 0), 0);
      const netKg = contItems.reduce((s: number, i: any) => s + (i.netKg || (i.netLbs || 0) * 0.453592), 0);
      const grossKg = contItems.reduce((s: number, i: any) => s + (i.grossKg || (i.grossLbs || 0) * 0.453592), 0);
      return { container: cont.container || '-', seal: cont.seal || '-', volumes: vols, netKg, grossKg };
    });

    const anyMatched = rows.some(r => r.volumes > 0 || r.netKg > 0 || r.grossKg > 0);
    if (!anyMatched && items.length > 0 && rows.length > 0) {
      const allVolumes = items.reduce((s: number, i: any) => s + (i.volumes || 0), 0);
      const allNetKg = items.reduce((s: number, i: any) => s + (i.netKg || (i.netLbs || 0) * 0.453592), 0);
      const allGrossKg = items.reduce((s: number, i: any) => s + (i.grossKg || (i.grossLbs || 0) * 0.453592), 0);
      const n = rows.length;
      rows.forEach(r => {
        r.volumes = Math.round(allVolumes / n);
        r.netKg = allNetKg / n;
        r.grossKg = allGrossKg / n;
      });
      const assignedVols = rows.reduce((s, r) => s + r.volumes, 0);
      if (assignedVols !== allVolumes) rows[0].volumes += (allVolumes - assignedVols);
    }

    const head2 = [['CONTAINER NO.', 'SEAL NO.', 'VOLUMES', 'NET WEIGHT (KG)', 'GROSS WEIGHT (KG)']];
    const body2 = rows.map(r => [
      r.container, r.seal, r.volumes.toString(),
      r.netKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      r.grossKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    ]);

    const totalVols = items.reduce((s: number, i: any) => s + (i.volumes || 0), 0);
    const totalNet  = items.reduce((s: number, i: any) => s + (i.netKg || (i.netLbs || 0) * 0.453592), 0);
    const totalGross = items.reduce((s: number, i: any) => s + (i.grossKg || (i.grossLbs || 0) * 0.453592), 0);
    body2.push([
      'TOTAL', '', totalVols.toString(),
      totalNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      totalGross.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    ]);

    autoTable(doc, {
      startY: finalY,
      head: head2,
      body: body2,
      theme: 'plain',
      styles: { fontSize: 8, textColor: darkGray, cellPadding: 1 },
      headStyles: { fillColor: tableHeaderBg, textColor: cyanColor, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 40 },
        1: { cellWidth: 35 },
        2: { halign: 'center', cellWidth: 25 },
        3: { halign: 'right', cellWidth: 35 },
        4: { halign: 'right', cellWidth: 35 },
      },
    });

    finalY = (doc as any).lastAutoTable.finalY + 15;
  }

  // Summary by product
  const productSummary: Record<string, { description: string; netLbs: number; netKg: number; grossKg: number; volumes: number }> = {};
  items.forEach((item: any) => {
    let desc = (item.customerDescription || '').trim();
    if (!desc && item.productId && ctx.products.length > 0) {
      const p = ctx.products.find(p => p.id === item.productId);
      if (p?.name) desc = p.name;
    }
    if (!desc) desc = (item.productDescription || item.description || '').trim();
    const key = desc || 'Unknown Product';
    if (!productSummary[key]) {
      productSummary[key] = { description: key, netLbs: 0, netKg: 0, grossKg: 0, volumes: 0 };
    }
    productSummary[key].netLbs  += item.netLbs || item.quantity || 0;
    productSummary[key].netKg   += item.netKg || (item.netLbs || 0) * 0.453592;
    productSummary[key].grossKg += item.grossKg || (item.grossLbs || 0) * 0.453592;
    productSummary[key].volumes += item.volumes || 0;
  });

  const productRows = Object.values(productSummary);
  if (productRows.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(darkGray);
    doc.text('SUMMARY BY PRODUCT', 14, finalY);
    finalY += 5;

    const head3 = [['PRODUCT DESCRIPTION', 'VOLUMES', 'NET WEIGHT (KG)', 'GROSS WEIGHT (KG)']];
    const body3 = productRows.map(p => [
      p.description.length > 60 ? p.description.substring(0, 60) + '...' : p.description,
      p.volumes.toString(),
      p.netKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      p.grossKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    ]);

    const grandVol = productRows.reduce((s, p) => s + p.volumes, 0);
    const grandNet = productRows.reduce((s, p) => s + p.netKg, 0);
    const grandGross = productRows.reduce((s, p) => s + p.grossKg, 0);
    body3.push([
      'TOTAL', grandVol.toString(),
      grandNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      grandGross.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    ]);

    autoTable(doc, {
      startY: finalY,
      head: head3,
      body: body3,
      theme: 'plain',
      styles: { fontSize: 8, textColor: darkGray, cellPadding: 1 },
      headStyles: { fillColor: tableHeaderBg, textColor: cyanColor, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 80 },
        1: { halign: 'center', cellWidth: 25 },
        2: { halign: 'right', cellWidth: 35 },
        3: { halign: 'right', cellWidth: 35 },
      },
    });
  }

  if (ctx.stampUrl && companyName.toUpperCase().includes('EC4')) {
    try {
      const lastPage = (doc as any).lastAutoTable?.finalY || 200;
      const stampSize = 35;
      const stampX = 196 - stampSize;
      const stampY = Math.min(lastPage + 5, 255);
      doc.addImage(ctx.stampUrl, 'JPEG', stampX, stampY, stampSize, stampSize);
    } catch (e) { console.warn('[PL PDF] Could not add stamp:', e); }
  }

  if (autoDownload) {
    doc.save(`PackingList_${inv.invoiceNumber || 'unknown'}.pdf`);
  }
  return doc;
}
