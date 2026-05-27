// Phase 3B — Invoice PDF generator. Ported 1:1 from v1's
// `pages/PLInvoiceEngine.tsx::generateInvoicePDF` with React closures
// replaced by an explicit `ctx` parameter. Any bug fixed here should
// be mirrored in v1 until v1 is retired.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { InvoicePdfCtx, PdfInvoice, findLinkedPL } from './types';
import { wrapByChars } from './wrapText';

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
  const companyEmail = company?.email || 'felipe@ec4.enterprises';
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

  // ─── CONSIGNEE (bill to) / NOTIFY (ship to) / INVOICE INFO ──
  //
  // Drawer model:
  //   • "Consignee (Sold to)" → inv.soldTo  — the consignee / bill-to
  //   • "Notify (Bill to)"    → inv.billToName — the notify / ship-to
  //
  // Customer rows are matched case- and whitespace-tolerant because
  // the DB sometimes carries trailing whitespace on the name.
  const normalize = (s: string) => (s ?? '').trim().toLowerCase();
  const findCust = (name: string) => {
    const key = normalize(name);
    if (!key) return undefined;
    return ctx.customers.find(c => normalize(c.name) === key);
  };
  let y = 68;
  const consigneeName = inv.soldTo || inv.billToName || inv.consignee || '';
  const notifyName    = inv.billToName || inv.consignee || consigneeName;
  const consigneeCust = findCust(consigneeName)
    ?? ctx.customers.find(c => c.id === inv.customerId);
  const notifyCust = findCust(notifyName) ?? consigneeCust;
  const fmtAddr = (c: typeof consigneeCust) => c
    ? [c.location, c.city, c.state, c.zip, c.country].filter(Boolean).join(', ')
    : '';
  const consigneeAddress = fmtAddr(consigneeCust);
  const notifyAddress    = fmtAddr(notifyCust);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(darkGray);
  doc.text('CONSIGNEE', 14, y);
  doc.text('NOTIFY', 75, y);

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

  // Consignee (bill to) content.
  //
  // contentLineHeight must match jsPDF's *actual* per-line advance
  // for the current font size — otherwise multi-line text (the
  // address, typically 5 wrapped lines) drifts and creates a visible
  // gap before the next field (email, CNPJ).
  // Math: fontSize=9pt × lineHeightFactor=1.15 = 10.35pt × 25.4/72
  // ≈ 3.65 mm/line. Pull the values from the doc so it stays correct
  // if the font/factor changes upstream.
  y = 74;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const contentLineHeight = doc.getFontSize() * doc.getLineHeightFactor() * 25.4 / 72;
  let consigneeY = y;

  doc.setFont('helvetica', 'bold');
  const consigneeLines = wrapByChars(consigneeName, 30);
  doc.text(consigneeLines, 14, consigneeY);
  consigneeY += consigneeLines.length * contentLineHeight;

  doc.setFont('helvetica', 'normal');
  if (consigneeAddress) {
    const addrLines = wrapByChars(consigneeAddress, 30);
    doc.text(addrLines, 14, consigneeY);
    consigneeY += addrLines.length * contentLineHeight;
  }
  if (consigneeCust?.email) {
    doc.text(consigneeCust.email, 14, consigneeY);
    consigneeY += contentLineHeight;
  }
  if (consigneeCust?.taxId) {
    doc.text(`CNPJ : ${consigneeCust.taxId}`, 14, consigneeY);
  }

  // Notify (ship to) content
  let notifyY = y;
  doc.setFont('helvetica', 'bold');
  const notifyLines = wrapByChars(notifyName, 30);
  doc.text(notifyLines, 75, notifyY);
  notifyY += notifyLines.length * contentLineHeight;

  doc.setFont('helvetica', 'normal');
  if (notifyAddress) {
    const addrLines = wrapByChars(notifyAddress, 30);
    doc.text(addrLines, 75, notifyY);
    notifyY += addrLines.length * contentLineHeight;
  }
  if (notifyCust?.email) {
    doc.text(notifyCust.email, 75, notifyY);
    notifyY += contentLineHeight;
  }
  if (notifyCust?.taxId) {
    doc.text(`CNPJ : ${notifyCust.taxId}`, 75, notifyY);
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

  // Wrap each column's value to its actual column width using
  // jsPDF's splitTextToSize. Earlier the INCOTERM rendered as one
  // line of "CIF - COST, INSURANCE AND FREIGHT" and bled into the
  // POD column (text became "...FREIGHTBRMAO - Manaus"). Column
  // gaps: TERMS x14→90 = 76mm; INCOTERM x90→155 = 65mm; POD x155→
  // 196 = 41mm. Subtract ~3mm padding so the wrapped text doesn't
  // touch the next header.
  const termsText = inv.paymentTerms || 'ADV / CAD';
  const termsLines = doc.splitTextToSize(termsText, 73);
  doc.text(termsLines, 14, y);

  const incotermCode = inv.incoterm || 'CFR';
  const incotermText = `${incotermCode} - ${INCOTERM_NAMES[incotermCode] || incotermCode}`;
  const incotermLines = doc.splitTextToSize(incotermText, 62);
  doc.text(incotermLines, 90, y);

  const podCode = inv.pod || '';
  const podPort = ctx.ports.find(p => p.code === podCode);
  const podText = podPort ? `${podCode} - ${podPort.name}` : (podCode || '-');
  const podLines = doc.splitTextToSize(podText, 38);
  doc.text(podLines, 155, y);

  // ─── ITEMS TABLE ─────────────────────────────────────────────
  // Advance y by the TALLEST of the three wrapped values so the
  // items table doesn't overlap a 2-line INCOTERM / TERMS row.
  // ~5mm per line at fontSize 10; baseline gap of 7mm before the
  // table starts.
  const maxValueLines = Math.max(termsLines.length, incotermLines.length, podLines.length);
  y += 7 + (maxValueLines * 5);
  const items = parseItems(inv.items);

  const tableHead = [[
    'DESCRIPTION', 'HS CODE', 'QTY (LBS/KG)', 'Rate\n($/LB - $/KG)', 'AMOUNT US$',
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
  doc.text(`$${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, valueX, finalY, { align: 'right' });
  finalY += 10;

  // ─── WEIGHTS ─────────────────────────────────────────────────
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(darkGray);
  const parseNum = (v: unknown): number => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'string') {
      const n = Number(v.replace(/[^\d.\-]/g, ''));
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  };
  // Always use the row-level totals saved on the invoice (drawer's
  // GROSS WEIGHT / NET WEIGHT / TOTAL VOLUMES fields) when present.
  // The user has explicitly typed those numbers — line items can drift
  // when they're imported from OCR or copied between PLs/invoices, so
  // item-level sums are only a fallback when nothing was saved.
  const itemsNetKg = consolidated.reduce((s, ci) => s + ci.netKg, 0);
  const itemsGrossKg = items.reduce((s: number, item: any) => s + (item.grossKg || (item.grossLbs || 0) * 0.453592), 0);
  const itemsVolumes = items.reduce((s: number, item: any) => s + (item.volumes || 0), 0);
  // Also read from `containers` JSON — recent invoices persist
  // per-container `volumes` there (drawer edits / OCR).
  const parseContainers = (raw: unknown): any[] => {
    try {
      if (typeof raw === 'string') return JSON.parse(raw);
      if (Array.isArray(raw)) return raw;
      return [];
    } catch { return []; }
  };
  const containerList = parseContainers((inv as any).containers);
  const containerVolumes = containerList.reduce((s: number, c: any) => s + (Number(c?.volumes) || 0), 0);
  const invNetRaw   = parseNum((inv as any).netWeight);
  const invGrossRaw = parseNum((inv as any).grossWeight);
  const invVolumes  = parseNum((inv as any).totalVolumes ?? (inv as any).volumes);
  // Same heuristic as v2/components/InvoiceDrawer.tsx: legacy invoices
  // sometimes stored `netWeight` / `grossWeight` as lbs even though the
  // column is documented in kg. Detect by comparing against the
  // kg-sum of line items: if the saved value is >1.5x the line-item
  // kg total, the lbs/kg ratio (~2.2x) makes it clear the raw is lbs,
  // so convert before printing. Without this the PDF would render
  // e.g. 42,955 lbs as "42,955.00 Kgs" (off by 2.2x).
  const looksLikeLbs = (raw: number, itemsKg: number): boolean =>
    raw > 0 && itemsKg > 0 && raw > itemsKg * 1.5;
  const toKg = (raw: number, itemsKg: number): number =>
    looksLikeLbs(raw, itemsKg) ? raw * 0.453592 : raw;
  const invNetKg   = toKg(invNetRaw,   itemsNetKg);
  const invGrossKg = toKg(invGrossRaw, itemsGrossKg);
  const totalNetKg   = invNetKg   > 0 ? invNetKg   : itemsNetKg;
  const totalGrossKg = invGrossKg > 0 ? invGrossKg : itemsGrossKg;
  const totalVolumes = invVolumes > 0
    ? invVolumes
    : (containerVolumes > 0 ? containerVolumes : itemsVolumes);
  const fmt = (n: number) => n > 0 ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';
  doc.text(`Net weight : ${fmt(totalNetKg)} Kgs`, 14, finalY);
  doc.text(`Gross Weight : ${fmt(totalGrossKg)} Kgs`, 14, finalY + 5);
  doc.text(`Total volumes : ${totalVolumes > 0 ? totalVolumes : '-'}`, 14, finalY + 10);

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
      // Prefer the container's own persisted `volumes` field when
      // present — items often don't carry `containerNo`/`volumes`
      // after older drawer saves stripped those fields.
      const rowVolumes = contVolumes > 0 ? contVolumes : (Number(cont?.volumes) || 0);
      containerRows.push({
        container: cont.container || '-',
        seal: cont.seal || '',
        volumes: rowVolumes,
        amount: contAmount,
      });
    });
    const assigned = items.filter((i: any) => savedContainers.some((c: any) => c.container === i.containerNo));
    if (assigned.length === 0 && items.length > 0 && containerRows.length > 0) {
      // Only fall back to the items-level total on row 0 if no
      // per-container volumes were supplied explicitly.
      const anyExplicit = containerRows.some(r => r.volumes > 0);
      if (!anyExplicit) {
        containerRows[0].volumes = items.reduce((s: number, i: any) => s + (i.volumes || 0), 0);
      }
      containerRows[0].amount = items.reduce((s: number, i: any) => s + (i.amount || 0), 0);
    }
  }

  // Resolve bank fields. Priority:
  //   1. Denormalized fields on the invoice row itself (legacy + manual override).
  //   2. The first bank in ctx.banks belonging to this invoice's company —
  //      so newly-onboarded companies don't need every historic invoice
  //      to be re-saved with bank fields.
  const fallbackBank = ctx.company?.id
    ? (ctx.banks ?? []).find(b => b.company_id === ctx.company!.id)
    : undefined;
  const joinAddr = (b: typeof fallbackBank) => b
    ? [b.address_line1, b.address_line2, [b.city, b.state, b.zip_code].filter(Boolean).join(' '), b.country].filter(Boolean).join(', ')
    : '';
  const effBankName    = inv.bankName       || fallbackBank?.name           || '';
  const effBankAddress = inv.bankAddress    || joinAddr(fallbackBank)        || '';
  const effSwift       = inv.swiftCode      || fallbackBank?.swift_code      || '';
  const effRouting     = inv.routingNumber  || fallbackBank?.routing         || '';
  const effAccount     = inv.accountNumber  || fallbackBank?.account_number  || '';

  const hasBank = !!effBankName;
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

    if (effBankName) {
      doc.setFont('helvetica', 'bold'); doc.text('Bank Name:', bankColX, bY);
      doc.setFont('helvetica', 'normal'); doc.text(effBankName, bankValueX, bY);
      bY += 5;
    }
    if (effBankAddress) {
      doc.setFont('helvetica', 'bold'); doc.text('Bank Address:', bankColX, bY);
      doc.setFont('helvetica', 'normal');
      const addrLines = doc.splitTextToSize(effBankAddress, 55);
      doc.text(addrLines, bankValueX, bY);
      bY += addrLines.length * 4 + 1;
    }
    if (effSwift) {
      doc.setFont('helvetica', 'bold'); doc.text('SWIFT Code:', bankColX, bY);
      doc.setFont('helvetica', 'normal'); doc.text(effSwift, bankValueX, bY);
      bY += 5;
    }
    if (effRouting) {
      doc.setFont('helvetica', 'bold'); doc.text('Routing #:', bankColX, bY);
      doc.setFont('helvetica', 'normal'); doc.text(effRouting, bankValueX, bY);
      bY += 5;
    }
    if (effAccount) {
      doc.setFont('helvetica', 'bold'); doc.text('Account #:', bankColX, bY);
      doc.setFont('helvetica', 'normal'); doc.text(effAccount, bankValueX, bY);
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

  // Stamp — renders whenever `ctx.stampUrl` is available. Positioned
  // just below the Bank Details / Containers block at the right edge.
  if (ctx.stampUrl) {
    try {
      const stampSize = 30;
      const stampX = 130;
      const stampY = Math.min(finalY + 2, 255);
      let fmt = 'PNG';
      const m = ctx.stampUrl.match(/^data:image\/(\w+);/i);
      if (m) { fmt = m[1].toUpperCase(); if (fmt === 'JPG') fmt = 'JPEG'; }
      doc.addImage(ctx.stampUrl, fmt, stampX, stampY, stampSize, stampSize);
      finalY = Math.max(finalY, stampY + stampSize + 5);
    } catch (e) {
      console.warn('[Invoice PDF] Could not add stamp:', e);
    }
  }

  // ─── ADDITIONAL INFORMATION ─────────────────────────────────
  const countryOfAcquisition = company?.country || 'USA';
  // POA priority: the invoice's own poa, else the linked booking's
  // pol (so PLs that haven't manually set POA still yield the right
  // origin country).
  const linkedBooking = inv.bookingNumber
    ? ctx.bookings.find(b =>
        (b as { bookingNumber?: string | null }).bookingNumber === inv.bookingNumber)
    : null;
  const poaCode = ((inv.poa || '') || (linkedBooking as { pol?: string | null } | null)?.pol || '').toString().trim();
  // Match by code (exact, case-insensitive) or by name so either a
  // 5-letter UN/LOCODE ("USCHS") or a human name ("Charleston")
  // resolves to the port row. Fall back to an em-dash when no match —
  // showing the raw code as if it were a country name ("USCHS") is
  // the wrong thing.
  const originPort = poaCode
    ? ctx.ports.find(p =>
        p.code?.toUpperCase() === poaCode.toUpperCase() ||
        p.name?.toLowerCase() === poaCode.toLowerCase(),
      )
    : null;
  // Fallback order: resolved-port country → shipper/company country →
  // literal USA. For domestic EC4 shipments the shipper is always the
  // origin, so even a blank POA should never render "-".
  const countryOfOrigin = originPort?.country
    ?? company?.country
    ?? 'USA';

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

  // (Stamp rendered directly below the Bank Details block above.)

  if (autoDownload) {
    doc.save(`Invoice_${inv.invoiceNumber || 'unknown'}.pdf`);
  }
  // Note: `linkedPL` is currently unused in the invoice PDF (used by
  // the packing list + SLI generators). Kept resolved here so the
  // calling side can inspect the same derivation.
  void linkedPL;
  return doc;
}
