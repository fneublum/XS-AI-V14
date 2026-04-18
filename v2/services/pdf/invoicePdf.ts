// Phase 3B — Invoice PDF generator. Ported 1:1 from v1's
// `pages/PLInvoiceEngine.tsx::generateInvoicePDF` with React closures
// replaced by an explicit `ctx` parameter. Any bug fixed here should
// be mirrored in v1 until v1 is retired.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { InvoicePdfCtx, PdfInvoice, findLinkedPL } from './types';

// Friendly names for Incoterm codes — keeps parity with v1 PDF.
const INCOTERM_NAMES: Record<string, string> = {
  EXW: 'EX WORKS',
  FCA: 'FREE CARRIER',
  CPT: 'CARRIAGE PAID TO',
  CIP: 'CARRIAGE AND INSURANCE PAID TO',
  DAT: 'DELIVERED AT TERMINAL',
  DAP: 'DELIVERED AT PLACE',
  DDP: 'DELIVERED DUTY PAID',
  FAS: 'FREE ALONGSIDE SHIP',
  FOB: 'FREE ON BOARD',
  CFR: 'COST AND FREIGHT',
  CIF: 'COST, INSURANCE AND FREIGHT',
};

const parseItems = (raw: unknown): any[] => {
  try {
    if (typeof raw === 'string') return JSON.parse(raw);
    if (Array.isArray(raw)) return raw;
    return [];
  } catch { return []; }
};

/** Generate the Invoice PDF. Returns the jsPDF doc; caller handles
 *  download / preview. When `autoDownload` is true the doc is saved
 *  with the filename `Invoice_<number>.pdf` via the browser. */
export function generateInvoicePdf(
  inv: PdfInvoice,
  ctx: InvoicePdfCtx,
  autoDownload = false,
): jsPDF {
  const doc = new jsPDF();
  const linkedPL = findLinkedPL(inv, ctx.packingLists);

  // Color scheme matching EC4 Enterprises.
  const cyanColor = '#00A0B0';
  const darkGray  = '#333333';
  const tableHeaderBg = '#E8F4F5';

  // Company info — fall back to EC4 defaults so the PDF is never
  // unrenderable even if the company row is missing a field.
  const company = ctx.company;
  const companyName = company?.name || 'EC4 ENTERPRISES LLC';
  const companyAddress = company?.address || '112 Bartran Oaks Walk #600010';
  const companyCity = `${company?.city || 'ST Johns'}, ${company?.state || 'FL'} ${company?.zip || '32260'} US`;
  const companyPhone = company?.phone || '9044399343';
  const companyEmail = 'felipe@ec4.enterprises';
  const companyWeb   = 'www.ec4.enterprises';

  // ─── HEADER ────────────────────────────────────────────────────
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

  // Logo on the right edge.
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
    } catch (e) {
      console.error('[Invoice PDF] Logo load failed:', e);
    }
  }

  // ─── INVOICE TITLE ────────────────────────────────────────────
  doc.setFontSize(20);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(cyanColor);
  doc.text('INVOICE', 14, 54);

  // ─── BILL TO / SHIP TO / INVOICE INFO ────────────────────────
  let y = 68;
  const billToName = inv.billToName || inv.soldTo || '';
  const customer = ctx.customers.find(
    c => c.name === billToName || c.id === inv.customerId,
  );
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

  const lineHeight = 6;
  doc.setTextColor(darkGray);
  doc.text('INVOICE #', 140, y);
  doc.setFont('helvetica', 'normal');
  doc.text(inv.invoiceNumber || '', 175, y);

  y += lineHeight;
  doc.setFont('helvetica', 'bold');
  doc.text('DATE', 140, y);
  doc.setFont('helvetica', 'normal');
  const dateSrc = inv.date || inv.invoiceDate || '';
  doc.text(dateSrc ? new Date(dateSrc).toLocaleDateString() : '-', 175, y);

  y += lineHeight;
  doc.setFont('helvetica', 'bold');
  doc.text('SO #', 140, y);
  doc.setFont('helvetica', 'normal');
  doc.text(inv.salesOrderNumber || inv.soNumber || inv.customerPo || '-', 175, y);

  y += lineHeight;
  doc.setFont('helvetica', 'bold');
  doc.text('BOOKING #', 140, y);
  doc.setFont('helvetica', 'normal');
  doc.text(inv.bookingNumber || inv.transportRef || '-', 175, y);

  // Bill To content
  const contentLineHeight = 4;
  y = 74;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  let billToY = y;

  doc.setFont('helvetica', 'bold');
  const billToNameLines = doc.splitTextToSize(billToName, 55);
  doc.text(billToNameLines, 14, billToY);
  billToY += billToNameLines.length * contentLineHeight;

  doc.setFont('helvetica', 'normal');
  if (customerAddress) {
    const addrLines = doc.splitTextToSize(customerAddress, 55);
    doc.text(addrLines, 14, billToY);
    billToY += addrLines.length * contentLineHeight;
  }
  if (customer?.email) {
    doc.text(customer.email, 14, billToY);
    billToY += contentLineHeight;
  }
  if (customer?.taxId) {
    doc.text(`CNPJ : ${customer.taxId}`, 14, billToY);
  }

  // Ship To content
  let shipToY = y;
  const shipToName = inv.consignee || billToName;
  const shipToCustomer = ctx.customers.find(c => c.name === shipToName) || customer;
  let shipToAddress = '';
  if (shipToCustomer) {
    shipToAddress = [shipToCustomer.location, shipToCustomer.city, shipToCustomer.state, shipToCustomer.zip, shipToCustomer.country]
      .filter(Boolean).join(', ');
  }

  doc.setFont('helvetica', 'bold');
  const shipToNameLines = doc.splitTextToSize(shipToName, 55);
  doc.text(shipToNameLines, 75, shipToY);
  shipToY += shipToNameLines.length * contentLineHeight;

  doc.setFont('helvetica', 'normal');
  if (shipToAddress) {
    const addrLines = doc.splitTextToSize(shipToAddress, 55);
    doc.text(addrLines, 75, shipToY);
    shipToY += addrLines.length * contentLineHeight;
  }
  if (shipToCustomer?.email) {
    doc.text(shipToCustomer.email, 75, shipToY);
    shipToY += contentLineHeight;
  }
  if (shipToCustomer?.taxId) {
    doc.text(`CNPJ : ${shipToCustomer.taxId}`, 75, shipToY);
  }

  // ─── TERMS / INCOTERM / POD ──────────────────────────────────
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

  // ─── ITEMS TABLE ─────────────────────────────────────────────
  y += 12;
  const items = parseItems(inv.items);

  const tableHead = [[
    'DESCRIPTION', 'HS CODE', 'QTY (LBS/KG)', 'UNIT PRICE ($/LB - $/KG)', 'AMOUNT US$',
  ]];

  // Consolidate items by HS code + description so rows merge.
  type Consolidated = { description: string; hsCode: string; netLbs: number; netKg: number; amount: number };
  const consolidated: Consolidated[] = [];
  const cmap = new Map<string, number>();
  items.forEach((item: any) => {
    let description = (item.customerDescription || '').trim();
    if (!description && item.productId && ctx.products.length > 0) {
      const p = ctx.products.find(p => p.id === item.productId);
      if (p?.name) description = p.name;
    }
    if (!description) description = `${item.productDescription || item.description || ''}`.trim();
    const hsCode = item.hsCode || '';
    const key = `${hsCode}|||${description}`;
    const netLbs = item.netLbs || item.quantity || 0;
    const netKg  = item.netKg  || (netLbs * 0.453592);
    const amount = item.amount || (netLbs * (item.unitPrice || 0)) || 0;
    const existing = cmap.get(key);
    if (existing !== undefined) {
      consolidated[existing].netLbs += netLbs;
      consolidated[existing].netKg  += netKg;
      consolidated[existing].amount += amount;
    } else {
      cmap.set(key, consolidated.length);
      consolidated.push({ description, hsCode, netLbs, netKg, amount });
    }
  });

  const tableBody = consolidated.map(ci => {
    const qty = `${ci.netLbs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lbs\n${ci.netKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;
    const unitLb = ci.netLbs > 0 ? ci.amount / ci.netLbs : 0;
    const unitKg = unitLb * 2.20462;
    const price  = `$${unitLb.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/lb\n$${unitKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/kg`;
    const amt    = `$${ci.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return [ci.description, ci.hsCode || '-', qty, price, amt];
  });

  autoTable(doc, {
    startY: y,
    head: tableHead,
    body: tableBody,
    theme: 'plain',
    styles: { fontSize: 9, textColor: darkGray, cellPadding: 4, valign: 'top' },
    headStyles: { fillColor: tableHeaderBg, textColor: cyanColor, fontStyle: 'bold', halign: 'left' },
    columnStyles: {
      0: { cellWidth: 50 },
      1: { cellWidth: 25 },
      2: { halign: 'right', cellWidth: 35 },
      3: { halign: 'right', cellWidth: 25 },
      4: { halign: 'right', cellWidth: 35 },
    },
  });

  let finalY = (doc as any).lastAutoTable.finalY + 10;

  // ─── TOTAL ───────────────────────────────────────────────────
  const totalAmount = items.reduce((sum: number, item: any) => sum + (item.amount || 0), 0);
  const labelX = 130;
  const valueX = 195;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('TOTAL', labelX, finalY);
  doc.text(`$${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, valueX, finalY, { align: 'right' });
  finalY += 10;

  // ─── WEIGHTS ─────────────────────────────────────────────────
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(darkGray);
  const totalNetKg = consolidated.reduce((s, ci) => s + ci.netKg, 0);
  const totalGrossKg = items.reduce((s: number, item: any) => s + (item.grossKg || (item.grossLbs || 0) * 0.453592), 0);
  const totalVolumes = items.reduce((s: number, item: any) => s + (item.volumes || 0), 0);
  doc.text(`Net weight : ${totalNetKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kgs`, 14, finalY);
  doc.text(`Gross Weight : ${totalGrossKg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Kgs`, 14, finalY + 5);
  doc.text(`Total volumes : ${totalVolumes}`, 14, finalY + 10);

  // ─── CONTAINERS ─────────────────────────────────────────────
  let savedContainers: any[] = [];
  try {
    savedContainers = typeof inv.containers === 'string' ? JSON.parse(inv.containers || '[]') : (inv.containers as any[] | undefined) || [];
  } catch { savedContainers = []; }

  const containerRows: { container: string; seal: string; volumes: number; amount: number }[] = [];
  if (savedContainers.length > 0) {
    savedContainers.forEach((cont: any) => {
      const contItems = items.filter((i: any) => i.containerNo === cont.container);
      const contVolumes = contItems.reduce((s: number, i: any) => s + (i.volumes || 0), 0);
      const contAmount  = contItems.reduce((s: number, i: any) => s + (i.amount || 0), 0);
      containerRows.push({
        container: cont.container || '-',
        seal: cont.seal || '',
        volumes: contVolumes,
        amount: contAmount,
      });
    });
    const assigned = items.filter((i: any) => savedContainers.some((c: any) => c.container === i.containerNo));
    if (assigned.length === 0 && items.length > 0 && containerRows.length > 0) {
      containerRows[0].volumes = items.reduce((s: number, i: any) => s + (i.volumes || 0), 0);
      containerRows[0].amount  = items.reduce((s: number, i: any) => s + (i.amount || 0), 0);
    }
  }

  const hasBank = !!inv.bankName;
  const containerStartY = finalY + 18;

  const drawBank = (sectionY: number) => {
    const bankColX = 110;
    const bankValueX = bankColX + 28;
    let bY = sectionY;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(cyanColor);
    doc.text('BANK DETAILS', bankColX, bY);

    bY += 6;
    doc.setFontSize(9);
    doc.setTextColor(darkGray);

    if (inv.bankName) {
      doc.setFont('helvetica', 'bold'); doc.text('Bank Name:', bankColX, bY);
      doc.setFont('helvetica', 'normal'); doc.text(inv.bankName, bankValueX, bY);
      bY += 5;
    }
    if (inv.bankAddress) {
      doc.setFont('helvetica', 'bold'); doc.text('Bank Address:', bankColX, bY);
      doc.setFont('helvetica', 'normal');
      const addrLines = doc.splitTextToSize(inv.bankAddress, 55);
      doc.text(addrLines, bankValueX, bY);
      bY += addrLines.length * 4 + 1;
    }
    if (inv.swiftCode) {
      doc.setFont('helvetica', 'bold'); doc.text('SWIFT Code:', bankColX, bY);
      doc.setFont('helvetica', 'normal'); doc.text(inv.swiftCode, bankValueX, bY);
      bY += 5;
    }
    if (inv.routingNumber) {
      doc.setFont('helvetica', 'bold'); doc.text('Routing #:', bankColX, bY);
      doc.setFont('helvetica', 'normal'); doc.text(inv.routingNumber, bankValueX, bY);
      bY += 5;
    }
    if (inv.accountNumber) {
      doc.setFont('helvetica', 'bold'); doc.text('Account #:', bankColX, bY);
      doc.setFont('helvetica', 'normal'); doc.text(inv.accountNumber, bankValueX, bY);
      bY += 5;
    }
    return bY;
  };

  if (containerRows.length > 0) {
    finalY = containerStartY;
    if (finalY > 260) { doc.addPage(); finalY = 20; }

    const allVolumes = containerRows.reduce((s, r) => s + r.volumes, 0);
    const body = containerRows.map(r => [r.container, r.seal || '-', r.volumes.toString()]);
    body.push(['TOTAL', '', allVolumes.toString()]);

    autoTable(doc, {
      startY: finalY,
      head: [['Container No.', 'Seal No.', 'Volumes']],
      body,
      theme: 'plain',
      tableWidth: 85,
      margin: { left: 14 },
      styles: { fontSize: 7.5, textColor: darkGray, cellPadding: { top: 1, bottom: 1, left: 1, right: 1 } },
      headStyles: { fontStyle: 'bold', textColor: darkGray },
      columnStyles: {
        0: { cellWidth: 35 },
        1: { cellWidth: 25 },
        2: { halign: 'center', cellWidth: 20 },
      },
      didParseCell: (data: any) => {
        if (data.row.index === body.length - 1) data.cell.styles.fontStyle = 'bold';
      },
    });

    const containerEndY = (doc as any).lastAutoTable.finalY + 5;
    const bankEndY = hasBank ? drawBank(finalY) : finalY;
    finalY = Math.max(containerEndY, bankEndY) + 5;
  } else if (hasBank) {
    let sectionY = finalY + 10;
    if (sectionY > 270) { doc.addPage(); sectionY = 20; }
    finalY = drawBank(sectionY) + 5;
  }

  // ─── ADDITIONAL INFORMATION ─────────────────────────────────
  const countryOfAcquisition = company?.country || 'USA';
  const poaCode = inv.poa || '';
  const originPort = poaCode ? ctx.ports.find(p => p.code === poaCode || p.name === poaCode) : null;
  const countryOfOrigin = originPort?.country || poaCode || '';

  let memoY = finalY + 5;
  if (memoY > 270) { doc.addPage(); memoY = 20; }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(cyanColor);
  doc.text('ADDITIONAL INFORMATION', 14, memoY);
  memoY += 6;

  doc.setFontSize(9);
  doc.setTextColor(darkGray);

  doc.setFont('helvetica', 'bold'); doc.text('Country of Acquisition:', 14, memoY);
  doc.setFont('helvetica', 'normal'); doc.text(countryOfAcquisition, 60, memoY);
  memoY += 5;

  doc.setFont('helvetica', 'bold'); doc.text('Country of Origin:', 14, memoY);
  doc.setFont('helvetica', 'normal'); doc.text(countryOfOrigin || '—', 60, memoY);
  memoY += 5;

  doc.setFont('helvetica', 'bold'); doc.text('Country of Provenance:', 14, memoY);
  doc.setFont('helvetica', 'normal'); doc.text(countryOfOrigin || '—', 60, memoY);
  memoY += 6;

  // Hardcoded EC4 manufacturer line.
  if (companyName.toUpperCase().includes('EC4')) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(darkGray);
    doc.text('Manufacturer: Various generators, all goods collected and consolidated by EC4 ENTERPRISES LLC', 14, memoY);
    memoY += 6;
  }

  // Memo (strip duplicate MANUFACTURER lines).
  if (inv.memo && inv.memo.trim()) {
    const cleaned = inv.memo.split('\n').filter(l => !l.toUpperCase().includes('MANUFACTURER')).join('\n').trim();
    if (cleaned) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(darkGray);
      const memoLines = doc.splitTextToSize(cleaned, 170);
      doc.text(memoLines, 14, memoY);
      memoY += memoLines.length * 4 + 5;
    }
  }

  finalY = memoY;

  // EC4 stamp in bottom-right.
  if (ctx.stampUrl && companyName.toUpperCase().includes('EC4')) {
    try {
      const stampSize = 35;
      const stampX = 196 - stampSize;
      const stampY = Math.min(finalY + 5, 255);
      doc.addImage(ctx.stampUrl, 'JPEG', stampX, stampY, stampSize, stampSize);
    } catch (e) {
      console.warn('[Invoice PDF] Could not add stamp:', e);
    }
  }

  if (autoDownload) {
    doc.save(`Invoice_${inv.invoiceNumber || 'unknown'}.pdf`);
  }
  // Note: `linkedPL` is currently unused in the invoice PDF (used by
  // the packing list + SLI generators). Kept resolved here so the
  // calling side can inspect the same derivation.
  void linkedPL;
  return doc;
}
